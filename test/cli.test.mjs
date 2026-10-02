import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { temporary, mockAPI, run } from './helpers.mjs';
import { loadConfig, saveConfig, profileName } from '../src/config.mjs';
import { saveKey,loadKey } from '../src/credentials.mjs';
import { prepareClient,isolatedEnvironment } from '../src/launcher.mjs';
const entry = path.resolve('bin/rubycli.mjs');
test('setup sem TTY, modelos, ask, doctor e chave nunca em stdout',async t => {
  const dir = await temporary(t), mock = await mockAPI(t);
  const env = { RUBYCLI_HOME:dir, RUBY_API_KEY:'test-very-secret',RUBYCLI_API_KEY:'',RUBYCLI_BASE_URL:mock.baseURL };
  for (const args of [['setup','--model','ruby-test','--store-key','file'],['models'],['ask','Explique','--json'],['doctor','--json']]) {
    const r = await run(process.execPath,[entry,...args],{ env });
    assert.equal(r.code,0,r.stderr); assert.ok(!r.stdout.includes('test-very-secret'));
  }
  const config = await readFile(path.join(dir,'profiles/default/config.json'),'utf8'); assert.ok(!config.includes('test-very-secret'));
  const usage = await run(process.execPath,[entry,'usage'],{ env }); assert.equal(JSON.parse(usage.stdout).requests,1);
});
test('perfil inválido e troca de URL não revelam a chave salva',async t => {
  const dir = await temporary(t), env = { RUBYCLI_HOME:dir };
  assert.throws(() => profileName('../personal'),e => e.code === 'INVALID_PROFILE');
  await saveKey('default','https://app.rubycli.cloud/v1','a-secret','file',env);
  await assert.rejects(loadKey('default','https://elsewhere.example/v1',env),e => e.code === 'CREDENTIAL_ENDPOINT_MISMATCH');
  assert.equal(await loadKey('default','https://app.rubycli.cloud/v1',env),'a-secret');
  if (process.platform !== 'win32') assert.equal((await stat(path.join(dir,'profiles/default/credential.json'))).mode & 0o777,0o600);
  await saveKey('default','https://app.rubycli.cloud/v1','new-env-key','env',env);
  await assert.rejects(loadKey('default','https://app.rubycli.cloud/v1',env),e=>e.code==='AUTH_REQUIRED');
});
test('perfis de quatro clientes preservam configurações originais byte a byte',async t => {
  const dir = await temporary(t), official = path.join(dir,'pessoal'), ruby = path.join(dir,'ruby'); await mkdir(official);
  const files = ['.codex/config.toml','.codex/auth.json','.claude/settings.json','.claude.json','.config/opencode/opencode.json'];
  for (const file of files) { await mkdir(path.dirname(path.join(official,file)),{ recursive:true }); await writeFile(path.join(official,file),'preservar segredo '+file); }
  const sourceEnv = { ...process.env,HOME:official,USERPROFILE:official,RUBYCLI_HOME:ruby,RUBY_API_KEY:'real-ruby-secret',OPENAI_API_KEY:'personal-key',ANTHROPIC_AUTH_TOKEN:'personal-token',CLAUDE_CODE_OAUTH_TOKEN:'oauth',CODEX_HOME:path.join(official,'.codex'),OPENCODE_CONFIG:'official.json' };
  for (const client of ['claude','codex','opencode','aider']) {
    const p = await prepareClient({ client,model:'ruby-test',bridge:{ url:'http://127.0.0.1:1234',token:'local-token' },sourceEnv });
    const serialized = JSON.stringify(p.env); assert.ok(!serialized.includes('real-ruby-secret')); assert.ok(!serialized.includes('personal-key')); assert.ok(!serialized.includes('personal-token')); assert.equal(p.env.CLAUDE_CODE_OAUTH_TOKEN,undefined);
    assert.ok(p.env.HOME.startsWith(ruby)); assert.ok(p.env.USERPROFILE.startsWith(ruby));
    for (const file of files) assert.equal(await readFile(path.join(official,file),'utf8'),'preservar segredo '+file);
  }
});
test('launch preserva argumentos literais, saída do filho e limpa perfil temporário',async t => {
  const dir = await temporary(t), mock = await mockAPI(t), output = path.join(dir,'capture.json'), fake = path.join(dir,'fake.mjs');
  await writeFile(fake,'#!/usr/bin/env node\nimport fs from "node:fs"; fs.writeFileSync(process.env.RUBY_TEST_CAPTURE,JSON.stringify({args:process.argv.slice(2),env:process.env})); process.exitCode=7;\n',{ mode:0o755 });
  let bin = fake;
  if (process.platform === 'win32') { bin = path.join(dir,'fake.cmd'); await writeFile(bin,'@node "%dp0%\\fake.mjs" %*\r\n'); }
  const literal = 'hello; $(touch HACKED) "quoted" & %PATH%';
  const r = await run(process.execPath,[entry,'launch','codex','--model','ruby-test','--temporary','--bin',bin,'--','exec',literal],{ env:{ RUBYCLI_HOME:path.join(dir,'ruby'),RUBYCLI_BASE_URL:mock.baseURL,RUBY_API_KEY:'real-key',RUBYCLI_API_KEY:'',RUBY_TEST_CAPTURE:output } });
  assert.equal(r.code,7,r.stderr); const saved = JSON.parse(await readFile(output,'utf8'));
  assert.equal(saved.args.at(-1),literal); assert.ok(!JSON.stringify(saved).includes('real-key')); await assert.rejects(stat(saved.env.HOME),e => e.code === 'ENOENT');
});
test('MCP config é JSON/TOML e não modifica arquivos do cliente',async t => {
  const dir = await temporary(t), env = { RUBYCLI_HOME:dir,RUBY_API_KEY:'never-print' };
  const r = await run(process.execPath,[entry,'mcp-config'],{ env }); assert.equal(r.code,0); const cfg = JSON.parse(r.stdout); assert.equal(cfg.mcpServers.rubycli.command,process.execPath); assert.ok(!r.stdout.includes('never-print'));
  const c = await run(process.execPath,[entry,'mcp-config','--format','codex'],{ env }); assert.match(c.stdout,/\[mcp_servers.rubycli\]/);
});
