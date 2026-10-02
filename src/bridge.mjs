import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { assert, RubyError, safeError } from './errors.mjs';
import { messagesToChat, messageResult, messageStream } from './protocols/messages.mjs';
import { responsesToChat, responseResult, responseStream } from './protocols/responses.mjs';

function equal(a, b) { const x = Buffer.from(String(a || '')), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x,y); }
async function bodyJSON(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; assert(size <= 16 * 1024 * 1024, 'BODY_TOO_LARGE', 'A requisição excedeu 16 MiB.', 413); chunks.push(c); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); assert(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_JSON', 'Corpo deve ser um objeto JSON.'); return value; }
  catch (e) { if (e instanceof RubyError) throw e; throw new RubyError('INVALID_JSON', 'Corpo JSON inválido.'); }
}
function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }

export async function createBridge({ api, port = 0, token = randomBytes(32).toString('hex'), model, maxConcurrency = 4 } = {}) {
  assert(token.length >= 24 && !/[\s\x00-\x1f]/.test(token), 'WEAK_LOCAL_TOKEN', 'A credencial local precisa ter pelo menos 24 caracteres.');
  const controllers = new Set(), conversations = new Map();
  let active = 0, cacheBytes = 0;
  const prune = () => {
    for (const [id,v] of conversations) if (v.expiry < Date.now()) { conversations.delete(id); cacheBytes -= v.bytes; }
    while (conversations.size > 50 || cacheBytes > 32 * 1024 * 1024) { const [id,v] = conversations.entries().next().value; conversations.delete(id); cacheBytes -= v.bytes; }
  };
  const server = http.createServer(async (req, res) => {
    const controller = new AbortController(); controllers.add(controller); let admitted = false, heartbeat, adapter;
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    req.on('aborted', disconnect); res.on('close', disconnect);
    const route = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    try {
      assert(!req.headers.origin, 'ORIGIN_DENIED', 'A ponte não aceita requisições de páginas web.', 403);
      assert(req.headers.host === `127.0.0.1:${server.address().port}` || req.headers.host === `localhost:${server.address().port}`, 'HOST_DENIED', 'Host local inválido.', 403);
      const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      assert(equal(bearer, token) || equal(req.headers['x-api-key'], token), 'LOCAL_AUTH_REQUIRED', 'Credencial local inválida.', 401);
      if (req.method === 'GET' && route === '/health') return json(res,200,{ status: 'ok', service: 'rubycli-local-bridge' });
      if (req.method === 'GET' && route === '/v1/models') return json(res,200,{ object: 'list', data: await api.models({ signal: controller.signal }) });
      assert(req.method === 'POST' && ['/v1/messages','/v1/responses','/v1/chat/completions'].includes(route), 'UNSUPPORTED_ENDPOINT', 'Endpoint não suportado. Consulte docs/COMPATIBILITY.md.', 404);
      assert(active < maxConcurrency, 'BRIDGE_BUSY', 'A ponte local está ocupada. Aguarde uma requisição concluir.', 429);
      active++; admitted = true;
      const body = await bodyJSON(req); body.model ||= model;
      let request, customNames;
      if (route === '/v1/messages') request = messagesToChat(body);
      else if (route === '/v1/responses') {
        prune(); let previous = [];
        if (body.previous_response_id) {
          const stored = conversations.get(body.previous_response_id);
          assert(stored, 'PREVIOUS_RESPONSE_NOT_FOUND', 'Resposta anterior expirada ou não armazenada. Envie o histórico completo.', 400); previous = structuredClone(stored.messages);
        }
        ({ request, customNames } = responsesToChat(body, previous));
      } else request = { ...body };
      let send;
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'connection': 'keep-alive', 'x-accel-buffering': 'no' });
        send = (event,data) => { if (!res.destroyed) res.write((event ? `event: ${event}\n` : '') + `data: ${JSON.stringify(data)}\n\n`); };
        heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15000); heartbeat.unref();
        if (route === '/v1/messages') adapter = messageStream(send, body.model);
        if (route === '/v1/responses') adapter = responseStream(send, body.model, customNames);
      }
      const streamId = 'chatcmpl-ruby-' + randomBytes(10).toString('hex');
      const chunk = delta => ({ id: streamId, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: body.model, choices: [{ index: 0, delta, finish_reason: null }] });
      if (body.stream && !adapter) send(null, chunk({ role: 'assistant' }));
      const result = await api.complete(request, { signal: controller.signal, ...(body.stream ? { onDelta: async d => {
        if (adapter) adapter.delta(d); else send(null, chunk(d.refusal ? { refusal: d.refusal } : { content: d.text }));
        if (res.writableLength > 1024 * 1024) await once(res, 'drain', { signal: controller.signal });
      } } : {}) });
      let output;
      if (adapter) output = adapter.finish(result);
      else if (route === '/v1/messages') output = messageResult(result);
      else if (route === '/v1/responses') output = responseResult(result, { customNames });
      else output = result;
      if (route === '/v1/responses' && body.store !== false) {
        // Keep only an in-memory, bounded continuation context for this local process.
        const messages = [...request.messages, result.choices[0].message];
        const bytes = Buffer.byteLength(JSON.stringify(messages));
        conversations.set(output.id,{ messages, bytes, expiry: Date.now() + 600000 }); cacheBytes += bytes; prune();
      }
      if (!body.stream) json(res,200,output);
      else {
        if (!adapter) {
          const calls = result.choices[0].message.tool_calls;
          if (calls?.length) send(null,chunk({ tool_calls: calls.map((c,index) => ({ index, ...c })) }));
          const end = chunk({}); end.choices[0].finish_reason = result.choices[0].finish_reason; send(null,end);
          if (result.usage) send(null,{ ...chunk({}), choices: [], usage: result.usage });
          res.write('data: [DONE]\n\n');
        }
        res.end();
      }
    } catch (error) {
      const safe = safeError(error);
      if (!res.destroyed) {
        if (!res.headersSent) json(res,safe.status,route === '/v1/messages' ? { type: 'error', error: { type: safe.code, message: safe.message } } : { error: { code: safe.code, message: safe.message } });
        else {
          if (adapter?.fail) adapter.fail(safe);
          else res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: safe.code, code: safe.code, message: safe.message } })}\n\n`);
          res.end();
        }
      }
    } finally { clearInterval(heartbeat); controllers.delete(controller); if (admitted) active--; }
  });
  server.requestTimeout = 60000; server.headersTimeout = 15000;
  server.listen({ host: '127.0.0.1', port });
  await once(server, 'listening');
  const address = `http://127.0.0.1:${server.address().port}`;
  return { url: address, token, server, async close() {
    for (const c of controllers) c.abort(); conversations.clear();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  } };
}
