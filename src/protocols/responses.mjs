import { randomUUID } from 'node:crypto';
import { assert, RubyError } from '../errors.mjs';
const uid = prefix => `${prefix}_${randomUUID().replaceAll('-','')}`;
function contentToChat(content) {
  if (typeof content === 'string') return content;
  assert(Array.isArray(content), 'INVALID_CONTENT', 'O conteúdo Responses precisa ser texto ou lista.');
  return content.map(part => {
    if (['input_text','output_text','text'].includes(part.type)) return { type: 'text', text: part.text };
    if (part.type === 'refusal') return { type: 'text', text: part.refusal };
    if (part.type === 'input_image') {
      assert(typeof part.image_url === 'string', 'UNSUPPORTED_IMAGE', 'Imagens por file_id não são suportadas. Use uma URL ou data URL.');
      return { type: 'image_url', image_url: { url: part.image_url, ...(part.detail ? { detail: part.detail } : {}) } };
    }
    throw new RubyError('UNSUPPORTED_CONTENT', 'Este tipo de conteúdo Responses ainda não é suportado pela ponte.');
  });
}
export function responsesToChat(body, previous = []) {
  assert(!body.background, 'UNSUPPORTED_BACKGROUND', 'Use os jobs MCP para tarefas em segundo plano.');
  assert(body.input !== undefined, 'INPUT_REQUIRED', 'input é obrigatório.');
  const messages = [...previous];
  if (body.instructions) messages.unshift({ role: 'system', content: body.instructions });
  const input = typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : body.input;
  assert(Array.isArray(input), 'INVALID_INPUT', 'input precisa ser texto ou lista.');
  for (const item of input) {
    if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
      const content = typeof item.output === 'string' ? item.output : contentToChat(item.output).map(p => { assert(p.type === 'text', 'UNSUPPORTED_TOOL_RESULT', 'Resultado de ferramenta precisa ser texto.'); return p.text; }).join('\n');
      messages.push({ role: 'tool', tool_call_id: item.call_id, content });
    } else if (item.type === 'function_call' || item.type === 'custom_tool_call') {
      const call = { id: item.call_id, type: 'function', function: { name: item.name, arguments: item.type === 'custom_tool_call' ? JSON.stringify({ input: item.input }) : item.arguments } };
      const last = messages.at(-1);
      if (last?.role === 'assistant' && last.tool_calls) last.tool_calls.push(call);
      else messages.push({ role: 'assistant', content: null, tool_calls: [call] });
    } else if (item.type === 'reasoning') {
      // Reasoning replay is provider-specific. The public answer is retained separately.
    } else if (item.type === 'message' || !item.type) {
      assert(['system','developer','assistant','user'].includes(item.role), 'UNSUPPORTED_ROLE', 'Papel Responses não suportado.');
      messages.push({ role: item.role === 'developer' ? 'system' : item.role, content: contentToChat(item.content) });
    } else throw new RubyError('UNSUPPORTED_INPUT', 'Item Responses não suportado. Envie o histórico completo em texto/funções.');
  }
  const customNames = new Set();
  const request = { model: body.model, messages };
  if (body.tools?.length) request.tools = body.tools.map(tool => {
    assert(tool.type === 'function' || tool.type === 'custom', 'UNSUPPORTED_TOOL', 'Web search, computer use e ferramentas de servidor não são traduzidas pela ponte.');
    if (tool.type === 'custom') {
      customNames.add(tool.name);
      return { type: 'function', function: { name: tool.name, description: tool.description || '', parameters: { type: 'object', properties: { input: { type: 'string', description: 'Exact textual input for this tool.' } }, required: ['input'], additionalProperties: false } } };
    }
    return { type: 'function', function: { name: tool.name, description: tool.description || '', parameters: tool.parameters || { type: 'object', properties: {} }, ...(tool.strict !== undefined ? { strict: tool.strict } : {}) } };
  });
  if (body.tool_choice !== undefined) {
    assert(typeof body.tool_choice === 'string' || ['function','custom'].includes(body.tool_choice.type), 'UNSUPPORTED_TOOL_CHOICE', 'Seleção de ferramenta não suportada.');
    request.tool_choice = typeof body.tool_choice === 'string' ? body.tool_choice : { type: 'function', function: { name: body.tool_choice.name } };
  }
  for (const key of ['temperature','top_p','parallel_tool_calls']) if (body[key] !== undefined) request[key] = body[key];
  if (body.max_output_tokens !== undefined) request.max_tokens = body.max_output_tokens;
  if (body.text?.format) {
    const format = body.text.format;
    if (format.type === 'json_schema') request.response_format = { type: 'json_schema', json_schema: { name: format.name, schema: format.schema, ...(format.strict !== undefined ? { strict: format.strict } : {}) } };
    else if (format.type === 'json_object') request.response_format = { type: 'json_object' };
    else assert(format.type === 'text', 'UNSUPPORTED_FORMAT', 'Formato de saída não suportado.');
  }
  return { request, customNames };
}
export function responseEnvelope(model, id = uid('resp')) {
  return { id, object: 'response', created_at: Math.floor(Date.now()/1000), status: 'in_progress', error: null, incomplete_details: null, instructions: null, model, output: [], parallel_tool_calls: true, tool_choice: 'auto', tools: [], usage: null, store: false, metadata: {} };
}
export function responseResult(result, { customNames = new Set(), envelope = responseEnvelope(result.model), messageId = uid('msg') } = {}) {
  const choice = result.choices[0], msg = choice.message, output = [];
  const content = [];
  if (msg.content) content.push({ type: 'output_text', text: typeof msg.content === 'string' ? msg.content : msg.content.map(p => p.text || '').join(''), annotations: [], logprobs: [] });
  if (msg.refusal) content.push({ type: 'refusal', refusal: msg.refusal });
  if (content.length) output.push({ id: messageId, type: 'message', role: 'assistant', status: choice.finish_reason === 'length' ? 'incomplete' : 'completed', content });
  for (const tool of msg.tool_calls || []) {
    let args; try { args = JSON.parse(tool.function.arguments || '{}'); } catch { throw new RubyError('INVALID_TOOL_ARGUMENTS', 'O modelo retornou argumentos de ferramenta inválidos.', 502); }
    if (customNames.has(tool.function.name)) {
      assert(typeof args.input === 'string', 'INVALID_CUSTOM_TOOL', 'A ferramenta custom exige input textual.', 502);
      output.push({ id: uid('ct'), type: 'custom_tool_call', call_id: tool.id, name: tool.function.name, input: args.input });
    } else output.push({ id: uid('fc'), type: 'function_call', call_id: tool.id, name: tool.function.name, arguments: tool.function.arguments || '{}', status: 'completed' });
  }
  const u = result.usage || {};
  return { ...envelope, model: result.model || envelope.model, status: choice.finish_reason === 'length' ? 'incomplete' : 'completed', incomplete_details: choice.finish_reason === 'length' ? { reason: 'max_output_tokens' } : null, output, usage: result.usage ? { input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0, total_tokens: u.total_tokens ?? (u.prompt_tokens || 0) + (u.completion_tokens || 0), input_tokens_details: { cached_tokens: u.prompt_tokens_details?.cached_tokens || 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: u.completion_tokens_details?.reasoning_tokens || 0 } } : null };
}
export function responseStream(send, model, customNames) {
  const envelope = responseEnvelope(model), messageId = uid('msg');
  let sequence = 0, started = false, text = '', refusal = '', activePart = null, contentIndex = -1;
  const emit = (type, fields) => send(type, { type, sequence_number: sequence++, ...fields });
  const part = kind => kind === 'refusal' ? { type: 'refusal', refusal: '' } : { type: 'output_text', text: '', annotations: [], logprobs: [] };
  const closePart = () => {
    if (!activePart) return;
    const value = activePart === 'refusal' ? refusal : text;
    const donePart = activePart === 'refusal' ? { type: 'refusal', refusal: value } : { ...part('text'), text: value };
    emit(activePart === 'refusal' ? 'response.refusal.done' : 'response.output_text.done', { item_id: messageId, output_index: 0, content_index: contentIndex, ...(activePart === 'refusal' ? { refusal: value } : { text: value, logprobs: [] }) });
    emit('response.content_part.done', { item_id: messageId, output_index: 0, content_index: contentIndex, part: donePart }); activePart = null;
  };
  emit('response.created', { response: envelope }); emit('response.in_progress', { response: envelope });
  return {
    delta(delta) {
      const kind = delta.refusal ? 'refusal' : 'text', value = delta.refusal || delta.text;
      if (!value) return;
      if (!started) { emit('response.output_item.added', { output_index: 0, item: { id: messageId, type: 'message', role: 'assistant', status: 'in_progress', content: [] } }); started = true; }
      if (activePart !== kind) { closePart(); activePart = kind; contentIndex++; emit('response.content_part.added', { item_id: messageId, output_index: 0, content_index: contentIndex, part: part(kind) }); }
      if (kind === 'refusal') refusal += value; else text += value;
      emit(kind === 'refusal' ? 'response.refusal.delta' : 'response.output_text.delta', { item_id: messageId, output_index: 0, content_index: contentIndex, delta: value, ...(kind === 'text' ? { logprobs: [] } : {}) });
    },
    finish(result) {
      const response = responseResult(result, { envelope, customNames, messageId }); closePart();
      response.output.forEach((item, index) => {
        if (item.type === 'message') {
          // Normal providers emit content in deltas; also tolerate buffered text responses.
          if (!started) { emit('response.output_item.added', { output_index: index, item: { ...item, status: 'in_progress', content: [] } }); }
        } else {
          const custom = item.type === 'custom_tool_call', key = custom ? 'input' : 'arguments';
          emit('response.output_item.added', { output_index: index, item: { ...item, [key]: '', ...(custom ? {} : { status: 'in_progress' }) } });
          const family = custom ? 'response.custom_tool_call_input' : 'response.function_call_arguments';
          emit(family + '.delta', { item_id: item.id, output_index: index, delta: item[key] });
          emit(family + '.done', { item_id: item.id, output_index: index, [key]: item[key] });
        }
        emit('response.output_item.done', { output_index: index, item });
      });
      emit(response.status === 'incomplete' ? 'response.incomplete' : 'response.completed', { response }); return response;
    },
    fail(error) { emit('response.failed', { response: { ...envelope, status: 'failed', error: { code: error.code, message: error.message } } }); }
  };
}
