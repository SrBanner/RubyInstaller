#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { rm, readFile, lstat } from 'node:fs/promises';
import { home, readJSON } from '../src/config.mjs';
import { assert, safeError } from '../src/errors.mjs';
import { configureWindowsPath } from '../src/windows-path.mjs';
try {
  const { values } = parseArgs({ options: { prefix: { type: 'string' }, yes: { type: 'boolean' } }, strict: true });
  assert(values.yes,'CONFIRM_REQUIRED','Use node scripts/uninstall.mjs --yes [--prefix DIRETORIO]. Os perfis serão preservados.');
  const root = path.resolve(values.prefix || home()), manifest = await readJSON(path.join(root,'installation.json'),null);
  assert(manifest?.app === 'rubycli-installer','NOT_INSTALLED','Instalação RubyCLI não identificada neste diretório.');
  for (const name of ['rubycli','rubycli-mcp','rubycli.cmd','rubycli.ps1','rubycli-mcp.cmd','rubycli-mcp.ps1']) {
    const file = path.join(root,'bin',name);
    try { const stat = await lstat(file); if (stat.isFile() && !stat.isSymbolicLink() && (await readFile(file,'utf8')).includes('RubyCLI managed launcher v1')) await rm(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  for (const dir of [manifest.current,manifest.previous].filter(Boolean)) {
    assert(path.dirname(dir) === path.join(root,'app') && /^0\.[0-9.]+-[a-f0-9]{8}$/.test(path.basename(dir)),'UNSAFE_PATH','Diretório de instalação inesperado.');
    await rm(dir,{ recursive: true, force: true });
  }
  if (process.platform === 'win32' && manifest.pathAdded === true) {
    await configureWindowsPath(path.join(root,'bin'),{ remove: true });
  }
  await rm(path.join(root,'installation.json')); console.log('Aplicativo removido. Perfis, chaves e históricos RubyCLI preservados. Nenhum cliente foi removido.');
} catch (error) { const e = safeError(error); console.error(`RubyCLI · ${e.code}: ${e.message}`); process.exitCode = 1; }
