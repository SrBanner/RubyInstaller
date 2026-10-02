import { randomUUID } from 'node:crypto';
import { assert, RubyError } from '../errors.mjs';

function textContent(content) {
  if (typeof content === 'string') return content;
  assert(Array.isArray(content), 'UNSUPPORTED_CONTENT', 'Conteúdo deve ser texto ou uma lista de blocos.');
  return content.map(block => { assert(block.type === 'text', 'UNSUPPORTED_CONTENT', 'Este campo aceita somente blocos de texto.'); return block.text; }).join('\n');
}
function image(block) {
  const src = block.source;
  if (src?.type === 'url') return { type: 'image_url', image_url: { url: src.url } };
  if (src?.type === 'base64') return { type: 'image_url', image_url: { url: `data:${src.media_type};base64,${src.data}` } };
  throw new RubyError('UNSUPPORTED_IMAGE', 'Imagem precisa usar source URL ou base64.');
}
export function messagesToChat(body) {
  assert(Array.isArray(body.messages) && body.messages.length, 'MESSAGES_REQUIRED', 'messages é obrigatório.');
  const messages = [];
  if (body.system) messages.push({ role: 'system', content: textContent(body.system) });
  for (const entry of body.messages) {
    assert(['user','assistant','system','developer'].includes(entry.role), 'UNSUPPORTED_ROLE', 'Papel de mensagem não suportado.');
    const role = entry.role === 'developer' ? 'system' : entry.role;
    if (typeof entry.content === 'string') { messages.push({ role, content: entry.content }); continue; }
    assert(Array.isArray(entry.content), 'INVALID_CONTENT', 'content precisa ser uma lista de blocos.');
    let parts = [], calls = [];
    const flush = () => {
      if (parts.length || calls.length) messages.push({ role, content: parts.length ? parts : null, ...(calls.length ? { tool_calls: calls } : {}) });
      parts = []; calls = [];
    };
    for (const block of entry.content) {
      if (block.type === 'text') parts.push({ type: 'text', text: block.text });
      else if (block.type === 'image') parts.push(image(block));
      else if (block.type === 'tool_use') {
        assert(entry.role === 'assistant', 'INVALID_TOOL_CALL', 'tool_use requer assistant.');
        calls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input) } });
      } else if (block.type === 'tool_result') {
        assert(entry.role === 'user', 'INVALID_TOOL_RESULT', 'tool_result requer user.'); flush();
        messages.push({ role: 'tool', tool_call_id: block.tool_use_id, content: (block.is_error ? 'Tool error: ' : '') + textContent(block.content ?? '') });
      } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        // Previous provider reasoning signatures are not portable. Never fabricate them.
      } else throw new RubyError('UNSUPPORTED_CONTENT', `Bloco Messages não suportado: ${String(block.type).slice(0,60)}.`);
    }
    flush();
  }
  const result = { model: body.model, messages };
  if (body.tools?.length) result.tools = body.tools.map(t => {
    assert(!t.type || t.type === 'custom', 'UNSUPPORTED_TOOL', 'A ponte aceita ferramentas definidas pelo cliente. Ferramentas de servidor não são suportadas.');
    return { type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } } };
  });
  if (body.tool_choice) {
    const t = body.tool_choice;
    result.tool_choice = t.type === 'tool' ? { type: 'function', function: { name: t.name } } : t.type === 'any' ? 'required' : t.type === 'none' ? 'none' : 'auto';
    if (t.disable_parallel_tool_use !== undefined) result.parallel_tool_calls = !t.disable_parallel_tool_use;
  }
  for (const key of ['max_tokens','temperature','top_p']) if (body[key] !== undefined) result[key] = body[key];
  if (body.stop_sequences?.length) result.stop = body.stop_sequences;
  return result;
}
export function messageResult(result, id = `msg_${randomUUID().replaceAll('-','')}`) {
  const choice = result.choices[0], msg = choice.message, content = [];
  if (msg.content) content.push({ type: 'text', text: typeof msg.content === 'string' ? msg.content : msg.content.map(x => x.text || '').join('') });
  if (msg.refusal) content.push({ type: 'text', text: msg.refusal });
  for (const tool of msg.tool_calls || []) {
    let input;
    try { input = JSON.parse(tool.function.arguments || '{}'); } catch { throw new RubyError('INVALID_TOOL_ARGUMENTS', 'O modelo retornou argumentos de ferramenta inválidos.', 502); }
    assert(input !== null && typeof input === 'object' && !Array.isArray(input), 'INVALID_TOOL_ARGUMENTS', 'Argumentos da ferramenta precisam ser um objeto JSON.', 502);
    content.push({ type: 'tool_use', id: tool.id, name: tool.function.name, input });
  }
  const usage = result.usage || {};
  const cached = usage.prompt_tokens_details?.cached_tokens || 0;
  return { id, type: 'message', role: 'assistant', model: result.model, content,
    stop_reason: choice.finish_reason === 'length' ? 'max_tokens' : msg.tool_calls?.length ? 'tool_use' : choice.finish_reason === 'content_filter' ? 'refusal' : 'end_turn',
    stop_sequence: null, usage: { input_tokens: Math.max(0,(usage.prompt_tokens || 0) - cached), output_tokens: usage.completion_tokens || 0, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 } };
}
export function messageStream(send, model) {
  const id = `msg_${randomUUID().replaceAll('-','')}`; let textStarted = false, text = '';
  send('message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  return {
    delta({ text: delta, refusal }) {
      delta = delta || refusal; if (!delta) return;
      if (!textStarted) { send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }); textStarted = true; }
      text += delta; send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta } });
    },
    finish(result) {
      const converted = messageResult(result, id); let index = textStarted ? 1 : 0;
      if (textStarted) send('content_block_stop', { type: 'content_block_stop', index: 0 });
      for (const block of converted.content) {
        if (block.type === 'text' && text) continue;
        send('content_block_start', { type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
        send('content_block_delta', { type: 'content_block_delta', index, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
        send('content_block_stop', { type: 'content_block_stop', index }); index++;
      }
      send('message_delta', { type: 'message_delta', delta: { stop_reason: converted.stop_reason, stop_sequence: null }, usage: converted.usage });
      send('message_stop', { type: 'message_stop' }); return converted;
    }
  };
}
