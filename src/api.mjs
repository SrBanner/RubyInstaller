import { baseURL, validateKey, VERSION } from './config.mjs';
import { assert, RubyError } from './errors.mjs';

const MAX_BYTES = 32 * 1024 * 1024;
export async function readLimited(response, limit = MAX_BYTES) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.byteLength;
    if (size > limit) throw new RubyError('RESPONSE_TOO_LARGE', 'A resposta excedeu o limite local.', 502);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
export async function* parseSSE(body) {
  const decoder = new TextDecoder(); let buffer = '', bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    assert(bytes <= MAX_BYTES, 'RESPONSE_TOO_LARGE', 'O stream excedeu o limite local.', 502);
    buffer += decoder.decode(chunk, { stream: true });
    // CRLF may be split between network chunks. Match complete separators only.
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const raw = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
      const data = raw.split(/\r?\n/).filter(x => x.startsWith('data:')).map(x => x.slice(5).replace(/^ /, '')).join('\n');
      if (!data) continue;
      if (data === '[DONE]') { yield { done: true }; return; }
      let event; try { event = JSON.parse(data); } catch { throw new RubyError('INVALID_STREAM', 'O provedor enviou um evento SSE inválido.', 502); }
      if (event.error) throw new RubyError('UPSTREAM_STREAM_ERROR', 'O provedor interrompeu a geração.', 502);
      yield { data: event };
    }
    assert(buffer.length <= 2 * 1024 * 1024, 'INVALID_STREAM', 'Evento SSE acima do limite local.', 502);
  }
  buffer += decoder.decode();
  assert(!buffer.trim() || buffer.trim().startsWith(':'), 'TRUNCATED_STREAM', 'A conexão terminou no meio de um evento SSE.', 502);
}

export class RubyAPI {
  constructor({ baseURL: base, key, timeout = 300000, fetchImpl = fetch, onUsage = async () => {} }) {
    this.base = baseURL(base); this.key = validateKey(key); this.timeout = timeout; this.fetchImpl = fetchImpl; this.onUsage = onUsage;
  }
  async request(endpoint, { body, signal, method = body ? 'POST' : 'GET' } = {}) {
    let response;
    try {
      response = await this.fetchImpl(this.base + endpoint, {
        method, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(this.timeout), ...(signal ? [signal] : [])]),
        headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json', 'user-agent': `RubyCLI/${VERSION}` },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw new RubyError('CANCELLED', 'Operação cancelada.', 499);
      if (error.name === 'TimeoutError') throw new RubyError('API_TIMEOUT', 'A API excedeu o tempo limite.', 504);
      throw new RubyError('NETWORK_ERROR', 'Não foi possível conectar à API RubyCLI. Confira a URL e a rede.', 502);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const hint = response.status === 401 ? 'Chave inválida ou revogada.' : response.status === 402 ? 'Verifique seus créditos na plataforma.' : response.status === 429 ? 'Limite do provedor atingido. Tente novamente mais tarde.' : 'Confira o modelo e o status na plataforma.';
      // Do not retry billable POSTs: an interrupted generation may already have been billed.
      throw new RubyError(`API_${response.status}`, `RubyCLI retornou HTTP ${response.status}. ${hint}`, response.status);
    }
    return response;
  }
  async models({ signal } = {}) {
    const response = await this.request('/models', { signal });
    let payload; try { payload = JSON.parse(await readLimited(response, 2 * 1024 * 1024)); } catch { throw new RubyError('INVALID_CATALOG', 'O catálogo da API não contém JSON válido.', 502); }
    assert(Array.isArray(payload.data), 'INVALID_CATALOG', 'A API deve retornar data com a lista de modelos.', 502);
    const seen = new Set();
    return payload.data.filter(x => typeof x?.id === 'string' && x.id.length <= 256 && !/[\x00-\x1f\x7f]/.test(x.id) && x.id.trim() && !seen.has(x.id) && seen.add(x.id)).map(x => ({ id: x.id, ...(x.owned_by ? { owned_by: x.owned_by } : {}) }));
  }
  async complete(request, { signal, onDelta } = {}) {
    assert(typeof request.model === 'string' && request.model, 'MODEL_REQUIRED', 'Escolha um modelo do catálogo.');
    assert(Array.isArray(request.messages) && request.messages.length, 'MESSAGES_REQUIRED', 'A conversa precisa conter mensagens.');
    assert(request.n === undefined || request.n === 1, 'UNSUPPORTED_N', 'A ponte suporta uma resposta por chamada (n=1).');
    const stream = Boolean(onDelta);
    const body = { ...request, stream, ...(stream ? { stream_options: { include_usage: true } } : {}) };
    if (!stream) delete body.stream_options;
    const response = await this.request('/chat/completions', { body, signal });
    let result;
    if (!stream) {
      try { result = JSON.parse(await readLimited(response)); } catch { throw new RubyError('INVALID_RESPONSE', 'A API não retornou JSON válido.', 502); }
      assert(result.choices?.[0]?.message && !result.error, 'INVALID_RESPONSE', 'Resposta sem mensagem de conclusão.', 502);
    } else {
      assert(response.headers.get('content-type')?.includes('text/event-stream'), 'INVALID_STREAM', 'A API não retornou text/event-stream.', 502);
      const message = { role: 'assistant', content: '', tool_calls: [] }; const calls = new Map();
      let finished = false, done = false, usage, finishReason, id, model;
      for await (const event of parseSSE(response.body)) {
        if (event.done) { done = true; break; }
        const item = event.data; id ||= item.id; model ||= item.model;
        if (item.usage) usage = item.usage;
        const choice = item.choices?.[0]; if (!choice) continue;
        if (choice.finish_reason) { finishReason = choice.finish_reason; finished = true; }
        const delta = choice.delta || {};
        if (typeof delta.content === 'string') { message.content += delta.content; await onDelta({ text: delta.content }); }
        if (delta.refusal) { message.refusal = (message.refusal || '') + delta.refusal; await onDelta({ refusal: delta.refusal }); }
        for (const t of delta.tool_calls || []) {
          assert(Number.isInteger(t.index) && t.index >= 0 && t.index < 256, 'INVALID_TOOL_CALL', 'Índice de ferramenta inválido.', 502);
          const call = calls.get(t.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (t.id) call.id += t.id;
          if (t.function?.name) call.function.name += t.function.name;
          if (t.function?.arguments) call.function.arguments += t.function.arguments;
          calls.set(t.index, call);
        }
      }
      assert(done && finished, 'TRUNCATED_STREAM', 'O stream terminou sem confirmação de conclusão.', 502);
      message.tool_calls = [...calls.entries()].sort((a,b) => a[0]-b[0]).map(([,v]) => v);
      if (!message.tool_calls.length) delete message.tool_calls;
      result = { id, object: 'chat.completion', created: Math.floor(Date.now()/1000), model: model || request.model, choices: [{ index: 0, message, finish_reason: finishReason }], ...(usage ? { usage } : {}) };
    }
    try { await this.onUsage({ model: result.model || request.model, usage: result.usage }); } catch { /* Accounting is informational, never invent a balance. */ }
    return result;
  }
}
