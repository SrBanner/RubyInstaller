import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
export async function temporary(t) { const dir = await mkdtemp(path.join(tmpdir(),'ruby test ')); t.after(() => rm(dir,{ recursive: true, force: true })); return dir; }
export async function mockAPI(t, handler) {
  const requests = [];
  const server = http.createServer(async (req,res) => {
    let text = ''; for await (const c of req) text += c;
    const body = text ? JSON.parse(text) : null;
    requests.push({ url: req.url, headers: req.headers, body });
    if (handler && await handler(req,res,body)) return;
    if (req.url === '/v1/models') { res.writeHead(200,{ 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'ruby-test' }] })); }
    if (req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end('{}'); }
    const message = { role: 'assistant', content: body.messages.at(-1)?.role === 'tool' ? 'Ferramenta recebida.' : 'Olá, Ruby 💎' };
    if (body.tools?.length) {
      const name = body.tools[0].function.name;
      message.content = null; message.tool_calls = [{ id: 'call_ruby1', type: 'function', function: { name, arguments: name === 'apply_patch' ? '{"input":"*** Begin Patch\\n*** End Patch"}' : '{"text":"OK"}' } }];
    }
    const usage = { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20, prompt_tokens_details: { cached_tokens: 2 } };
    const finish_reason = message.tool_calls ? 'tool_calls' : 'stop';
    if (!body.stream) { res.writeHead(200,{ 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'chat-1', model: body.model, choices: [{ message, finish_reason }], usage })); }
    else {
      res.writeHead(200,{ 'content-type': 'text/event-stream' });
      const send = obj => res.write('data: '+JSON.stringify(obj)+'\r\n\r\n');
      if (message.tool_calls) {
        const c = message.tool_calls[0];
        send({ choices: [{ delta: { tool_calls: [{ index: 0, ...c, function: { name: c.function.name, arguments: c.function.arguments.slice(0,5) } }] } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: c.function.arguments.slice(5) } }] } }] });
      } else {
        for (const text of ['Olá, ','Ruby ','💎']) send({ choices: [{ delta: { content: text } }] });
      }
      send({ choices: [{ delta: {}, finish_reason }] }); send({ choices: [], usage }); res.end('data: [DONE]\r\n\r\n');
    }
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { baseURL: `http://127.0.0.1:${server.address().port}/v1`, requests, server };
}
export function run(file,args,{ env = {}, input = '', cwd, timeout = 15000, replaceEnv = false } = {}) {
  return new Promise((resolve,reject) => {
    const child = spawn(file,args,{ env: replaceEnv ? env : { ...process.env, ...env }, cwd, stdio: ['pipe','pipe','pipe'] });
    let stdout = '', stderr = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Child timeout\n'+stderr+'\n'+stdout)); },timeout);
    child.stdout.on('data',c => { stdout += c; }); child.stderr.on('data',c => { stderr += c; });
    child.once('error',e => { clearTimeout(timer); reject(e); }); child.once('exit',(code,signal) => { clearTimeout(timer); resolve({ code,signal,stdout,stderr }); });
    child.stdin.on('error',() => {}); child.stdin.end(input);
  });
}
