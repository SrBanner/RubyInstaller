// Opt-in: real installed CLIs, local fake API. No production credentials or billing.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mockAPI,temporary,run } from './helpers.mjs';
import { RubyAPI } from '../src/api.mjs';
import { createBridge } from '../src/bridge.mjs';
import { prepareClient } from '../src/launcher.mjs';
import { mkdtemp,rm } from 'node:fs/promises';
for(const client of ['codex','claude']){
  const bin=process.env[`RUBYCLI_TEST_${client.toUpperCase()}_BIN`];
  test(`cliente real ${client}: texto através da ponte local`,{skip:!bin,timeout:60000},async t=>{
    // Codex refuses to place its sandbox helpers under /tmp. Use a private workspace fixture.
    const dir=await mkdtemp(path.join(process.cwd(),'.ruby-native-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
    const mock=await mockAPI(t,async(req,res,body)=>{
      if(!body)return false;
      res.writeHead(200,{'content-type':'text/event-stream'});
      const send=data=>res.write('data: '+JSON.stringify(data)+'\n\n');
      send({id:'chat-smoke',model:body.model,choices:[{index:0,delta:{role:'assistant',content:'RUBY_SMOKE_OK'}}]});
      send({id:'chat-smoke',model:body.model,choices:[{index:0,delta:{},finish_reason:'stop'}]});
      send({choices:[],usage:{prompt_tokens:10,completion_tokens:4,total_tokens:14}});res.end('data: [DONE]\n\n');return true;
    });
    const bridge=await createBridge({api:new RubyAPI({baseURL:mock.baseURL,key:'fake-smoke-key'})});t.after(()=>bridge.close());
    const trace=[];bridge.server.on('request',req=>{let text='';req.on('data',c=>{text+=c;});req.on('end',()=>{try{const p=JSON.parse(text);trace.push({url:req.url,tools:p.tools?.map(x=>({type:x.type,name:x.name})),inputTypes:p.input?.map?.(x=>x.type),messageRoles:p.messages?.map(x=>x.role),contentTypes:p.messages?.map(x=>Array.isArray(x.content)?x.content.map(c=>c.type):typeof x.content)});}catch{trace.push({url:req.url});}});});t.after(()=>t.diagnostic(JSON.stringify(trace)));
    const prepared=await prepareClient({client,model:'ruby-test',bridge,temporary:true,sourceEnv:{...process.env,RUBYCLI_HOME:path.join(dir,'ruby')}});t.after(()=>prepared.cleanup());
    const tail=client==='codex'?['exec','--disable','plugins','--disable','apps','--skip-git-repo-check','--sandbox','read-only','--ephemeral','Reply OK without tools.']:['-p','Reply OK without tools.'];
    const r=await run(bin,[...prepared.args,...tail],{cwd:dir,env:prepared.env,timeout:55000,replaceEnv:true});
    assert.equal(r.code,0,r.stderr+'\n'+r.stdout);assert.match(r.stdout,/RUBY_SMOKE_OK/);assert.ok(mock.requests.some(x=>x.url==='/v1/chat/completions'));
  });
}
