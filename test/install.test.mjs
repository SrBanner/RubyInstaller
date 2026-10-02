import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { temporary,run } from './helpers.mjs';
import { VERSION } from '../src/config.mjs';
const installer=path.resolve('scripts/install.mjs');
test('instalação privada, atualização, recusa de conflito e desinstalação preservando dados', {timeout:120000},async t=>{
  const dir=await temporary(t),prefix=path.join(dir,'Ruby com espaços');
  const installed=process.platform==='win32'
    ? await run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',path.resolve('install.ps1'),'-Prefix',prefix,'-Offline'],{timeout:100000})
    : await run(process.execPath,[installer,'--prefix',prefix,'--offline'],{timeout:100000});
  assert.equal(installed.code,0,installed.stderr);
  const first=JSON.parse(await readFile(path.join(prefix,'installation.json'),'utf8'));
  const help=await run(process.execPath,[path.join(first.current,'bin/rubycli.mjs'),'--version']); assert.equal(help.stdout.trim(),VERSION);
  // The actual POSIX launcher must work even when its path contains spaces.
  if(process.platform!=='win32'){const r=await run(path.join(prefix,'bin/rubycli'),['--version']);assert.equal(r.stdout.trim(),VERSION);}
  else {
    const wrapper=path.join(prefix,'bin','rubycli.ps1');
    assert.deepEqual([...(await readFile(wrapper)).subarray(0,3)],[0xef,0xbb,0xbf]);
    const r=await run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',wrapper,'--version']);
    assert.equal(r.code,0,r.stderr);assert.equal(r.stdout.trim(),VERSION);
  }
  await mkdir(path.join(prefix,'profiles'),{recursive:true});await writeFile(path.join(prefix,'profiles/keep.txt'),'KEEP');
  const update=await run(process.execPath,[installer,'--prefix',prefix,'--offline'],{timeout:100000});assert.equal(update.code,0,update.stderr);
  const second=JSON.parse(await readFile(path.join(prefix,'installation.json'),'utf8'));assert.equal(second.previous,first.current);assert.notEqual(second.current,first.current);
  const removed=await run(process.execPath,[path.resolve('scripts/uninstall.mjs'),'--prefix',prefix,'--yes']);assert.equal(removed.code,0,removed.stderr);assert.equal(await readFile(path.join(prefix,'profiles/keep.txt'),'utf8'),'KEEP');
  const conflict=path.join(dir,'conflict');await mkdir(path.join(conflict,'bin'),{recursive:true});const name=process.platform==='win32'?'rubycli.cmd':'rubycli';await writeFile(path.join(conflict,'bin',name),'existing program');
  const refused=await run(process.execPath,[installer,'--prefix',conflict]);assert.equal(refused.code,1);assert.equal(await readFile(path.join(conflict,'bin',name),'utf8'),'existing program');
});
