import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, symlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { temporary, run } from './helpers.mjs';
import { VERSION } from '../src/config.mjs';

const installer = path.resolve('scripts/install.mjs');
// Each npm invocation has a 180s production timeout. Let it report its own
// failure before the subprocess/phase deadlines, and budget for both installs.
const installTimeout = 210000;

test('instalação privada, atualização, recusa de conflito e desinstalação preservando dados', { timeout: 600000 }, async t => {
  const dir = await temporary(t);
  const actual = path.join(dir, 'real'), alias = path.join(dir, 'alias');
  await mkdir(actual);
  await symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const prefix = path.join(alias, 'Ruby com espaços');
  let first, second;

  await t.test('instalação offline com espaços e ancestral simbólico', { timeout: 240000 }, async () => {
    const installed = process.platform === 'win32'
      ? await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.resolve('install.ps1'), '-Prefix', prefix, '-Offline'], { timeout: installTimeout })
      : await run(process.execPath, [installer, '--prefix', prefix, '--offline'], { timeout: installTimeout });
    assert.equal(installed.code, 0, installed.stderr);
    first = JSON.parse(await readFile(path.join(prefix, 'installation.json'), 'utf8'));
    assert.notEqual(await realpath(prefix), prefix, 'o teste deve exercitar um ancestral simbólico');
  });
  if (!first) return;

  await t.test('comando instalado e launcher nativo', { timeout: 60000 }, async () => {
    const help = await run(process.execPath, [path.join(first.current, 'bin/rubycli.mjs'), '--version']);
    assert.equal(help.code, 0, help.stderr);
    assert.equal(help.stdout.trim(), VERSION);
    if (process.platform !== 'win32') {
      const result = await run(path.join(prefix, 'bin/rubycli'), ['--version']);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout.trim(), VERSION);
    } else {
      const wrapper = path.join(prefix, 'bin', 'rubycli.ps1');
      assert.deepEqual([...(await readFile(wrapper)).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      const result = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', wrapper, '--version']);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout.trim(), VERSION);
    }
  });

  await mkdir(path.join(prefix, 'profiles'), { recursive: true });
  await writeFile(path.join(prefix, 'profiles/keep.txt'), 'KEEP');
  await t.test('atualização offline preserva a instalação anterior', { timeout: 240000 }, async () => {
    const update = await run(process.execPath, [installer, '--prefix', prefix, '--offline'], { timeout: installTimeout });
    assert.equal(update.code, 0, update.stderr);
    second = JSON.parse(await readFile(path.join(prefix, 'installation.json'), 'utf8'));
    assert.equal(second.previous, first.current);
    assert.notEqual(second.current, first.current);
  });
  if (!second) return;

  await t.test('desinstalação preserva os dados do perfil', { timeout: 75000 }, async () => {
    const removed = await run(process.execPath, [path.resolve('scripts/uninstall.mjs'), '--prefix', prefix, '--yes'], { timeout: 60000 });
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(await readFile(path.join(prefix, 'profiles/keep.txt'), 'utf8'), 'KEEP');
  });

  await t.test('recusa de conflito preserva o programa existente', { timeout: 30000 }, async () => {
    const conflict = path.join(dir, 'conflict');
    await mkdir(path.join(conflict, 'bin'), { recursive: true });
    const name = process.platform === 'win32' ? 'rubycli.cmd' : 'rubycli';
    await writeFile(path.join(conflict, 'bin', name), 'existing program');
    const refused = await run(process.execPath, [installer, '--prefix', conflict]);
    assert.equal(refused.code, 1);
    assert.equal(await readFile(path.join(conflict, 'bin', name), 'utf8'), 'existing program');
  });
});
