import test from 'node:test';
import assert from 'node:assert/strict';
import { RubyAPI, parseSSE } from '../src/api.mjs';
import { baseURL } from '../src/config.mjs';
import { mockAPI } from './helpers.mjs';

test('API consulta catálogo, usa autenticação e suporta streaming UTF-8',async t => {
  const mock = await mockAPI(t); const usage = [];
  const api = new RubyAPI({ baseURL: mock.baseURL, key: 'ruby-secret', onUsage: x => usage.push(x) });
  assert.deepEqual(await api.models(),[{ id: 'ruby-test' }]);
  let text = ''; const result = await api.complete({ model: 'ruby-test', messages: [{ role: 'user', content: 'oi' }] },{ onDelta: d => { text += d.text; } });
  assert.equal(text,'Olá, Ruby 💎'); assert.equal(result.usage.total_tokens,20); assert.equal(usage.length,1);
  assert.equal(mock.requests[0].headers.authorization,'Bearer ruby-secret');
});
test('SSE lida com CRLF e emoji fragmentados byte a byte',async () => {
  const bytes = Buffer.from('data: {"x":"💎"}\r\n\r\ndata: [DONE]\r\n\r\n');
  async function* body() { for (const byte of bytes) yield Uint8Array.of(byte); }
  const events = []; for await (const e of parseSSE(body())) events.push(e);
  assert.deepEqual(events,[{ data: { x: '💎' } },{ done: true }]);
});
test('stream truncado é erro e não uma conclusão bem-sucedida',async t => {
  const mock = await mockAPI(t,async (_req,res,body) => {
    if (!body) return false;
    res.writeHead(200,{ 'content-type': 'text/event-stream' }); res.end('data: {"choices":[{"delta":{"content":"parcial"}}]}\n\n'); return true;
  });
  const api = new RubyAPI({ baseURL: mock.baseURL, key: 'secret' });
  await assert.rejects(api.complete({ model: 'm', messages: [{}] },{ onDelta: () => {} }),e => e.code === 'TRUNCATED_STREAM');
});
test('erro não vaza corpo do provedor e não repete POST cobrável',async t => {
  const mock = await mockAPI(t,async (_req,res) => { res.writeHead(429); res.end('SECRET-API-KEY prompt private'); return true; });
  const api = new RubyAPI({ baseURL: mock.baseURL, key: 'secret' });
  await assert.rejects(api.complete({ model: 'm', messages: [{}] }),e => e.code === 'API_429' && !e.message.includes('SECRET'));
  assert.equal(mock.requests.length,1);
});
test('redirecionamento não recebe credencial e HTTP remoto é recusado',async t => {
  const target = await mockAPI(t); const source = await mockAPI(t,async (_req,res) => { res.writeHead(302,{ location: target.baseURL+'/models' }); res.end(); return true; });
  const api = new RubyAPI({ baseURL: source.baseURL, key: 'secret' });
  await assert.rejects(api.models(),e => e.code === 'NETWORK_ERROR'); assert.equal(target.requests.length,0);
  assert.throws(() => baseURL('http://example.com'),e => e.code === 'INSECURE_URL');
  assert.throws(() => baseURL('https://user:key@example.com'),e => e.code === 'INVALID_URL');
  assert.equal(baseURL('https://app.rubycli.cloud/v1/'),'https://app.rubycli.cloud/v1');
});
