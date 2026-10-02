import test from 'node:test';
import assert from 'node:assert/strict';
import { RubyAPI } from '../src/api.mjs';
import { createBridge } from '../src/bridge.mjs';
import { mockAPI } from './helpers.mjs';
import { messagesToChat } from '../src/protocols/messages.mjs';
import { responsesToChat } from '../src/protocols/responses.mjs';
import http from 'node:http';
async function fixture(t) {
  const mock = await mockAPI(t), api = new RubyAPI({ baseURL: mock.baseURL, key: 'upstream-secret' });
  const bridge = await createBridge({ api, model: 'ruby-test' }); t.after(() => bridge.close());
  const post = (endpoint,body,extra = {}) => fetch(bridge.url+endpoint,{ method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bridge.token}`, ...extra }, body: JSON.stringify(body) });
  return { mock,bridge,post };
}
function events(text) { return text.split('\n').filter(l => l.startsWith('data: {')).map(l => JSON.parse(l.slice(6))); }
test('Messages traduz ferramentas, imagens e resultados sem executar nada',async t => {
  const { post,mock } = await fixture(t);
  const body = { model: 'ruby-test', system: [{ type: 'text', text: 'sistema' }], messages: [{ role: 'user', content: [{ type: 'text', text: 'oi' },{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }] }], max_tokens: 128, tools: [{ name: 'echo', input_schema: { type: 'object', properties: { text: { type: 'string' } } } }] };
  const response = await post('/v1/messages',body); assert.equal(response.status,200); const value = await response.json();
  assert.equal(value.stop_reason,'tool_use'); assert.deepEqual(value.content[0].input,{ text: 'OK' });
  assert.equal(value.usage.input_tokens,10); assert.equal(mock.requests[0].body.messages[1].content[1].image_url.url,'data:image/png;base64,AAA');
  const continuation = messagesToChat({ messages: [{ role: 'assistant', content: value.content },{ role: 'user', content: [{ type: 'tool_result',tool_use_id:'call_ruby1',content:'resultado' }] }] });
  assert.equal(continuation.messages[1].role,'tool'); assert.equal(continuation.messages[1].tool_call_id,'call_ruby1');
});
test('Messages SSE respeita início, delta e fim de blocos e mensagem',async t => {
  const { post } = await fixture(t);
  const r = await post('/v1/messages',{ model: 'ruby-test', stream: true, messages: [{ role: 'user', content: 'olá' }] });
  const e = events(await r.text()); assert.equal(e[0].type,'message_start'); assert.equal(e.at(-1).type,'message_stop');
  assert.equal(e.filter(x => x.type === 'content_block_delta').map(x => x.delta.text).join(''),'Olá, Ruby 💎');
  assert.equal(e.at(-2).usage.output_tokens,8);
});
test('Responses oferece texto, SSE, usage e identificadores estáveis',async t => {
  const { post } = await fixture(t);
  const r = await post('/v1/responses',{ input: 'olá', stream: true }); const e = events(await r.text());
  assert.equal(e[0].type,'response.created'); assert.equal(e.at(-1).type,'response.completed');
  assert.deepEqual(e.map(x => x.sequence_number),e.map((_,i) => i));
  const final = e.at(-1).response;
  assert.equal(final.output[0].content[0].text,'Olá, Ruby 💎'); assert.equal(final.usage.total_tokens,20);
  assert.equal(e.find(x => x.type === 'response.output_item.added').item.id,final.output[0].id);
});
test('Responses converte apply_patch custom e retém relação call_id no retorno',async t => {
  const { post,mock } = await fixture(t);
  const r = await post('/v1/responses',{ input: 'edite', stream: true, tools: [{ type: 'custom', name: 'apply_patch', description: 'Patch tool' }] });
  const e = events(await r.text()), call = e.at(-1).response.output[0];
  assert.equal(call.type,'custom_tool_call'); assert.equal(call.input,'*** Begin Patch\n*** End Patch');
  assert.ok(e.some(x => x.type === 'response.custom_tool_call_input.delta'));
  const response = e.at(-1).response;
  const r2 = await post('/v1/responses',{ input: [{ type: 'custom_tool_call_output', call_id: call.call_id, output: 'ok' }], previous_response_id: response.id });
  assert.equal(r2.status,200); assert.equal(mock.requests.at(-1).body.messages.at(-1).tool_call_id,'call_ruby1');
});
test('function arguments completos são enviados antes de response.completed',async t => {
  const { post } = await fixture(t);
  const r = await post('/v1/responses',{ input: 'tool', stream: true, tools: [{ type: 'function', name: 'echo', parameters: { type: 'object' } }] });
  const e = events(await r.text());
  assert.equal(e.find(x => x.type === 'response.function_call_arguments.done').arguments,'{"text":"OK"}');
  assert.equal(e.at(-1).response.output[0].type,'function_call');
});
test('store false não mantém contexto para previous_response_id',async t => {
  const { post } = await fixture(t); const a = await (await post('/v1/responses',{ input: 'oi', store: false })).json();
  const b = await post('/v1/responses',{ input: 'continua', previous_response_id: a.id }); assert.equal(b.status,400);
});
test('sem token, origem web, host falso e endpoint desconhecido são recusados',async t => {
  const { bridge,post,mock } = await fixture(t);
  assert.equal((await fetch(bridge.url+'/health')).status,401);
  assert.equal((await post('/v1/responses',{ input:'oi' },{ origin:'https://evil.example' })).status,403);
  const hostStatus = await new Promise((resolve,reject) => { const r = http.request(bridge.url+'/health',{ headers:{ host:'evil.example',authorization:`Bearer ${bridge.token}` } },res=>{ res.resume();resolve(res.statusCode); });r.on('error',reject);r.end(); });
  assert.equal(hostStatus,403);
  assert.equal((await post('/v1/responses/compact',{})).status,404);
  assert.equal(mock.requests.length,0);
});
test('recursos não traduzíveis falham explicitamente antes da API',async () => {
  assert.throws(() => responsesToChat({ input:'oi',tools:[{ type:'web_search' }] }),e => e.code === 'UNSUPPORTED_TOOL');
  assert.throws(() => messagesToChat({ messages:[{ role:'user',content:[{ type:'document' }] }] }),e => e.code === 'UNSUPPORTED_CONTENT');
});
test('Claude atual envia mensagem system junto à conversa; sua prioridade é preservada',()=>{
  const request=messagesToChat({messages:[{role:'user',content:'oi'},{role:'system',content:[{type:'text',text:'contexto de sistema'}]}]});
  assert.equal(request.messages[1].role,'system');assert.equal(request.messages[1].content[0].text,'contexto de sistema');
});
