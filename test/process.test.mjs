import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { capture, commandSpec, findExecutable, npmCommandSpec } from '../src/process.mjs';
import { temporary } from './helpers.mjs';

const node = String.raw`C:\Program Files\nodejs\node.exe`;
const cli = String.raw`C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js`;
const args = ['ci', '--prefix', String.raw`C:\Users\João\Ruby com espaços & dados`, '--ignore-scripts'];

// These fixtures exercise Windows paths and real shim formats on every CI OS.
// They do not claim to execute a Windows process on a non-Windows host.
function windows(files) {
  const key = file => path.win32.normalize(file).toLowerCase();
  const entries = new Map(Object.entries(files).map(([file, text]) => [key(file), text]));
  const get = file => {
    if (!entries.has(key(file))) throw Object.assign(new Error('Fixture file missing'), { code: 'ENOENT' });
    return entries.get(key(file));
  };
  return {
    platform: 'win32', nodePath: node, cwd: 'C:\\work',
    fs: {
      access: async file => { get(file); },
      stat: async file => { get(file); return { isFile: () => true }; },
      readFile: async file => get(file)
    }
  };
}

test('Windows ignora o script POSIX npm e reconhece Path com espaços', async () => {
  const shim = String.raw`C:\Program Files\nodejs\npm.cmd`;
  const runtime = windows({ [shim]: '', [String.raw`C:\Program Files\nodejs\npm`]: '#!/bin/sh' });
  assert.equal(await findExecutable('npm', { Path: 'C:\\missing;"C:\\Program Files\\nodejs"' }, 'win32', runtime), shim);
});

test('Windows prioriza executáveis nativos em relação a wrappers no mesmo diretório', async () => {
  const exe = String.raw`C:\tools\claude.exe`;
  const runtime = windows({ [exe]: '', [String.raw`C:\tools\claude.cmd`]: '' });
  assert.deepEqual(await commandSpec('claude', args, { PATH: 'C:\\tools' }, runtime), { file: exe, args });
});

test('npm distribuído com Node é iniciado pelo npm-cli.js, sem depender do PATH', async () => {
  const runtime = windows({ [cli]: '' });
  assert.deepEqual(await npmCommandSpec(args, {}, runtime), { file: node, args: [cli, ...args] });
});

test('npm.cmd oficial seleciona npm-cli.js, sem confundir node.exe ou npm-prefix.js', async () => {
  const shim = String.raw`D:\Node alternativo\npm.cmd`;
  const target = String.raw`D:\Node alternativo\node_modules\npm\bin\npm-cli.js`;
  const contents = String.raw`@ECHO OFF
SETLOCAL
SET "NODE_EXE=%~dp0\node.exe"
IF NOT EXIST "%NODE_EXE%" ( SET "NODE_EXE=node" )
SET "NPM_PREFIX_JS=%~dp0\node_modules\npm\bin\npm-prefix.js"
SET "NPM_CLI_JS=%~dp0\node_modules\npm\bin\npm-cli.js"
FOR /F "delims=" %%F IN ('CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"') DO (
  SET "NPM_CLI_JS=%%F\node_modules\npm\bin\npm-cli.js"
)
"%NODE_EXE%" "%NPM_CLI_JS%" %*
`;
  const runtime = windows({ [shim]: contents, [target]: '' });
  assert.deepEqual(await npmCommandSpec(args, { PATH: 'D:\\Node alternativo' }, runtime), { file: node, args: [target, ...args] });
});

test('cmd-shim do npm resolve o script invocado e preserva argumentos literais', async () => {
  const shim = String.raw`C:\Users\João\AppData\Roaming\npm\claude.cmd`;
  const target = String.raw`C:\Users\João\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js`;
  const contents = String.raw`@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
IF EXIST "%dp0%\node.exe" (
  SET "_prog=%dp0%\node.exe"
) ELSE (
  SET "_prog=node"
)
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "%dp0%\node_modules\@anthropic-ai\claude-code\cli.js" %*
`;
  const runtime = windows({ [shim]: contents, [target]: '' });
  const literalArgs = ['--print', 'literal & echo %PATH% | > ^ "quoted"'];
  assert.deepEqual(await commandSpec(shim, literalArgs, {}, runtime), { file: node, args: [target, ...literalArgs] });
});

test('npm instalado como pacote global também aceita o formato cmd-shim', async () => {
  const shim = String.raw`D:\npm global\npm.cmd`;
  const target = String.raw`D:\npm global\node_modules\npm\bin\npm-cli.js`;
  const runtime = windows({ [shim]: String.raw`"%_prog%" "%dp0%\node_modules\npm\bin\npm-cli.js" %*`, [target]: '' });
  assert.deepEqual(await npmCommandSpec(args, { PATH: 'D:\\npm global' }, runtime), { file: node, args: [target, ...args] });
});

test('wrapper Windows de executável nativo resolve o binário sem cmd.exe', async () => {
  const shim = String.raw`C:\tools\client.cmd`;
  const target = String.raw`C:\tools\vendor\client.exe`;
  const runtime = windows({ [shim]: String.raw`"%~dp0\vendor\client.exe" %*`, [target]: '' });
  assert.deepEqual(await commandSpec(shim, args, {}, runtime), { file: target, args });
});

test('entrypoint JavaScript explícito no Windows usa o Node atual', async () => {
  const entry = String.raw`C:\tools\client.mjs`;
  const runtime = windows({ [entry]: '' });
  assert.deepEqual(await commandSpec(entry, args, {}, runtime), { file: node, args: [entry, ...args] });
});

test('wrapper incompleto informa o destino ausente', async () => {
  const shim = String.raw`C:\tools\client.cmd`;
  const runtime = windows({ [shim]: String.raw`"%_prog%" "%dp0%\missing.js" %*` });
  await assert.rejects(commandSpec(shim, [], {}, runtime), { code: 'SHIM_TARGET_NOT_FOUND' });
});

test('wrapper desconhecido não é executado em um shell como fallback', async () => {
  const shim = String.raw`C:\tools\client.cmd`;
  const runtime = windows({ [shim]: '@echo off\r\necho not a supported launcher' });
  await assert.rejects(commandSpec(shim, [], {}, runtime), { code: 'UNSUPPORTED_SHIM' });
});

test('npm ausente gera orientação específica, sem tentar executar um script POSIX', async () => {
  const runtime = windows({ [String.raw`C:\tools\npm`]: '#!/bin/sh' });
  await assert.rejects(npmCommandSpec(args, { PATH: 'C:\\tools' }, runtime), { code: 'NPM_NOT_FOUND' });
});

test('resolução POSIX continua aceitando executável sem extensão', { skip: process.platform === 'win32' }, async t => {
  const dir = await temporary(t), file = path.join(dir, 'npm');
  await writeFile(file, '#!/bin/sh\nexit 0\n'); await chmod(file, 0o755);
  assert.deepEqual(await commandSpec('npm', args, { PATH: dir }), { file, args });
});

test('falha de spawn informa ENOENT sem expor argumentos ou entrada', async t => {
  const dir = await temporary(t);
  await assert.rejects(capture(path.join(dir, 'missing.exe'), ['secret-argument'], { input: 'secret-input', label: 'npm' }), error => {
    assert.equal(error.code, 'COMMAND_FAILED');
    assert.match(error.message, /npm \(ENOENT\)/);
    assert.doesNotMatch(error.message, /secret-/);
    return true;
  });
});

test('falha de subprocesso informa código de saída sem divulgar stderr sensível', async () => {
  await assert.rejects(capture(process.execPath, ['-e', 'process.stderr.write("secret-key");process.exit(7)'], { label: 'npm' }), error => {
    assert.equal(error.code, 'COMMAND_FAILED');
    assert.match(error.message, /npm encerrou com código 7/);
    assert.doesNotMatch(error.message, /secret-key/);
    return true;
  });
});

test('install.ps1 usa BOM UTF-8 e acentos legíveis no Windows PowerShell 5.1', async () => {
  const bytes = await readFile(new URL('../install.ps1', import.meta.url));
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(bytes.toString('utf8').includes('A instalação RubyCLI não foi concluída.'));
  // Git checkouts and source archives may use LF; PowerShell accepts LF and CRLF.
  assert.match(bytes.toString('utf8'), /\r?\n/);
  assert.ok(!bytes.toString('utf8').includes('\\r\\n'));
});
