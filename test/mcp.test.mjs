import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mockAPI, temporary } from './helpers.mjs';

test('MCP stdio real: descoberta, consulta, fila, recursos, prompts e erros',async t => {
  const dir = await temporary(t), mock = await mockAPI(t);
  const client = new Client({ name:'ruby-test-client',version:'1' });
  const transport = new StdioClientTransport({ command:process.execPath,args:[path.resolve('bin/rubycli-mcp.mjs')],env:{ ...process.env,RUBYCLI_HOME:dir,RUBYCLI_BASE_URL:mock.baseURL,RUBY_API_KEY:'secret',RUBYCLI_API_KEY:'',RUBYCLI_MODEL:'ruby-test' },stderr:'pipe' });
  let stderr=''; transport.stderr.on('data',c=>{stderr+=c;});
  await client.connect(transport); t.after(()=>client.close());
  const tools=await client.listTools(); assert.ok(tools.tools.some(x=>x.name==='ruby_job_start'));
  const ask=await client.callTool({name:'ruby_ask',arguments:{prompt:'oi'}}); assert.equal(ask.isError,undefined); assert.equal(JSON.parse(ask.content[0].text).text,'Olá, Ruby 💎');
  const job=JSON.parse((await client.callTool({name:'ruby_job_start',arguments:{prompt:'revisar'}})).content[0].text);
  assert.ok(job.job_id); let result;
  for(let i=0;i<100;i++){ result=JSON.parse((await client.callTool({name:'ruby_job',arguments:{job_id:job.job_id}})).content[0].text); if(result.status==='succeeded')break; await delay(20); }
  assert.equal(result.status,'succeeded'); assert.equal(result.result.output,'Olá, Ruby 💎');
  const bad=await client.callTool({name:'ruby_ask',arguments:{prompt:'oi',model:'not-real'}}); assert.equal(bad.isError,true);
  assert.ok((await client.listResources()).resources.length>=2);
  assert.ok((await client.getPrompt({name:'revisar-codigo',arguments:{code:'const a=1'}})).messages[0].content.text.includes('const a=1'));
  assert.ok(!stderr.includes('secret'));
});
