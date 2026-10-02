#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, readFile, rename, rm, writeFile, chmod, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { home, privateDir, VERSION, readJSON, atomicWrite } from '../src/config.mjs';
import { npmCommandSpec, capture } from '../src/process.mjs';
import { assert, safeError } from '../src/errors.mjs';

const source = path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const MARKER = 'RubyCLI managed launcher v1';
const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const literalPS = value => "'" + value.replaceAll("'", "''") + "'";
async function exists(file) { try { return await lstat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }

export async function install({ prefix = home(), offline = false } = {}) {
  const [major,minor] = process.versions.node.split('.').map(Number);
  assert(major > 22 || (major === 22 && minor >= 16),'NODE_TOO_OLD','Instale Node.js 22.16+ antes de continuar.');
  const root = path.resolve(prefix);
  assert(root !== path.parse(root).root && root !== source,'UNSAFE_PREFIX','Escolha um diretório próprio para instalar a RubyCLI.');
  await privateDir(root);
  const manifestPath = path.join(root,'installation.json');
  const previous = await readJSON(manifestPath,null);
  assert(!previous || previous.app === 'rubycli-installer','INSTALL_CONFLICT','installation.json pertence a outro aplicativo.');
  const bin = path.join(root,'bin'); await privateDir(bin);
  const names = process.platform === 'win32' ? ['rubycli.cmd','rubycli.ps1','rubycli-mcp.cmd','rubycli-mcp.ps1'] : ['rubycli','rubycli-mcp'];
  for (const name of names) {
    const file = path.join(bin,name), stat = await exists(file);
    if (stat) assert(previous && !stat.isSymbolicLink() && stat.isFile() && (await readFile(file,'utf8')).includes(MARKER),'INSTALL_CONFLICT',`O destino ${name} já existe e não será substituído.`);
  }
  const apps = path.join(root,'app'); await privateDir(apps);
  const build = `${VERSION}-${randomUUID().slice(0,8)}`, stage = path.join(apps,'.stage-'+build), final = path.join(apps,build);
  await privateDir(stage);
  try {
    for (const name of ['package.json','package-lock.json','bin','src','scripts','assets','docs','install.sh','install.ps1','README.md','LICENSE','THIRD_PARTY_NOTICES.md','SECURITY.md','CHANGELOG.md']) {
      if (await exists(path.join(source,name))) await cp(path.join(source,name),path.join(stage,name),{ recursive: true, dereference: false });
    }
    // No lifecycle scripts, global installs, sudo, shell startup edits, or client installs.
    const spec = await npmCommandSpec(['ci','--prefix',stage,'--omit=dev','--ignore-scripts','--no-audit','--no-fund',...(offline ? ['--offline'] : [])]);
    console.log('RubyCLI · Instalando dependências em diretório próprio…');
    await capture(spec.file,spec.args,{ timeout: 180000, label: 'npm' });
    await rename(stage,final);
    // Prepare every launcher before replacing any current launcher. Roll back on failure.
    const originals = new Map();
    try {
      for (const name of names) {
        const entry = path.join(final,'bin',name.startsWith('rubycli-mcp') ? 'rubycli-mcp.mjs' : 'rubycli.mjs');
        const file = path.join(bin,name), old = await exists(file);
        originals.set(file,old ? await readFile(file) : null);
        let content;
        if (name.endsWith('.cmd')) {
          const cmdLiteral = s => s.replaceAll('%','%%');
          content = `@echo off\r\nrem ${MARKER}\r\nsetlocal DisableDelayedExpansion\r\n"${cmdLiteral(process.execPath)}" "${cmdLiteral(entry)}" %*\r\nexit /b %errorlevel%\r\n`;
        } else if (name.endsWith('.ps1')) content = `\uFEFF# ${MARKER}\n& ${literalPS(process.execPath)} ${literalPS(entry)} @args\nexit $LASTEXITCODE\n`;
        else content = `#!/bin/sh\n# ${MARKER}\nexec ${quote(process.execPath)} ${quote(entry)} "$@"\n`;
        await atomicWrite(file,content); if (process.platform !== 'win32') await chmod(file,0o755);
      }
      await atomicWrite(manifestPath,JSON.stringify({ app: 'rubycli-installer', version: VERSION, current: final, previous: previous?.current || null, bin, node: process.execPath },null,2)+'\n');
    } catch (error) {
      for (const [file,old] of originals) { if (old) { await atomicWrite(file,old); if (process.platform !== 'win32') await chmod(file,0o755); } else await rm(file,{ force: true }); }
      throw error;
    }
  } catch (error) { await rm(stage,{ recursive: true, force: true }); await rm(final,{ recursive: true, force: true }); throw error; }
  console.log(`\nRubyCLI instalada: ${bin}\nSeu PATH e seus clientes foram preservados.\n`);
  if (process.platform === 'win32') console.log(`Execute: & ${literalPS(path.join(bin,'rubycli.cmd'))} setup\nPara o PATH da sessão: $env:Path = ${literalPS(bin+';')} + $env:Path`);
  else console.log(`Execute: ${quote(path.join(bin,'rubycli'))} setup\nPara o PATH da sessão: export PATH=${quote(bin)}:"$PATH"`);
  console.log('Para manter o comando entre sessões, adicione somente esse diretório ao PATH nas configurações do sistema.');
  return { root, bin, app: final };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { prefix: { type: 'string' }, offline: { type: 'boolean' }, help: { type: 'boolean' } }, strict: true });
    if (values.help) console.log('node scripts/install.mjs [--prefix DIRETORIO] [--offline]\nO prefixo escolhe a instalação; RUBYCLI_HOME escolhe o estado.');
    else await install(values);
  } catch (error) { const e = safeError(error); console.error(`RubyCLI · ${e.code}: ${e.message}`); process.exitCode = 1; }
}
