import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { capture } from '../src/process.mjs';
import { configureWindowsPath, editWindowsPath } from '../src/windows-path.mjs';

const bin = String.raw`C:\Users\João\.rubycli\bin`;
const env = { USERPROFILE: String.raw`C:\Users\João`, SystemRoot: String.raw`C:\Windows` };

test('PATH acrescenta somente o bin ao fim, preservando entradas, variáveis e separadores', () => {
  const current = String.raw`%SystemRoot%\System32;;"D:\Meus programas\bin";`;
  assert.deepEqual(editWindowsPath(current, bin, { env }), { changed: true, value: `${current};${bin}` });
  assert.deepEqual(editWindowsPath('', bin, { env }), { changed: true, value: bin });
});

test('PATH não duplica diretórios equivalentes com caixa, barras, aspas ou variáveis', () => {
  for (const entry of ['c:\\users\\JOÃO\\.RUBYCLI\\BIN\\', String.raw`"%userprofile%\.rubycli\bin\"`, 'C:/Users/João/.rubycli/bin', String.raw`C:\Users\João\.rubycli\outro\..\bin`]) {
    const current = `C:\\other;${entry};D:\\other`;
    assert.deepEqual(editWindowsPath(current, bin, { env }), { changed: false, value: current });
  }
});

test('PATH remove somente entradas do mesmo diretório e preserva caminhos parecidos', () => {
  const current = `C:\\tools;${bin}-other;"%USERPROFILE%\\.rubycli\\bin\\";;${bin}\\child`;
  assert.deepEqual(editWindowsPath(current, bin, { env, remove: true }), { changed: true, value: `C:\\tools;${bin}-other;;${bin}\\child` });
  assert.deepEqual(editWindowsPath('C:\\tools', bin, { env, remove: true }), { changed: false, value: 'C:\\tools' });
  assert.deepEqual(editWindowsPath(bin, bin, { env, remove: true }), { changed: true, value: '' });
});

test('PATH preserva conteúdo longo, Unicode e metacaracteres sem truncar', () => {
  const current = Array.from({ length: 300 }, (_, i) => `C:\\long-directory-${i}`).join(';');
  const literal = String.raw`C:\João & Maria\a'$(test)[x]^!\bin`;
  const update = editWindowsPath(current, literal, { env });
  assert.equal(update.value, `${current};${literal}`);
  assert.ok(update.value.length > 4096);
  assert.deepEqual(editWindowsPath(update.value, literal, { env, remove: true }), { changed: true, value: current });
});

test('PATH rejeita diretórios impossíveis de representar sem alterar seu significado', () => {
  for (const invalid of ['relative\\bin', 'C:relative\\bin', 'C:\\name;other\\bin', 'C:\\name\nother\\bin', 'C:\\%USERPROFILE%\\bin', 'C:\\name"other\\bin']) {
    assert.throws(() => editWindowsPath('C:\\tools', invalid, { env }), { code: 'WINDOWS_PATH_INVALID' });
  }
});

function registry(initial, { conflicts = 0 } = {}) {
  let state = { ...initial };
  const calls = [];
  const runner = async (file, args, options) => {
    const request = JSON.parse(options.input);
    calls.push({ file, args, options, request });
    if (request.operation === 'read') return JSON.stringify(state);
    assert.deepEqual(request.expected, state);
    if (conflicts-- > 0) {
      state.value += ';C:\\concurrent';
      return JSON.stringify({ conflict: true });
    }
    state = { exists: true, value: request.value, kind: state.kind };
    return JSON.stringify({ changed: true });
  };
  return { runner, calls, get state() { return state; } };
}

test('configuração conserva REG_SZ/REG_EXPAND_SZ e envia os dados somente por stdin', async () => {
  for (const kind of ['String', 'ExpandString']) {
    const fixture = registry({ exists: true, value: String.raw`%SystemRoot%\System32`, kind });
    assert.deepEqual(await configureWindowsPath(bin, { platform: 'win32', runner: fixture.runner, env }), { changed: true });
    assert.deepEqual(fixture.state, { exists: true, value: String.raw`%SystemRoot%\System32` + ';' + bin, kind });
    assert.equal(fixture.calls.length, 2);
    for (const call of fixture.calls) {
      assert.equal(call.file, String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`);
      assert.deepEqual(call.args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
      const script = Buffer.from(call.args[4], 'base64').toString('utf16le');
      assert.ok(!script.includes(bin));
      assert.match(script, /DoNotExpandEnvironmentNames/);
      assert.doesNotMatch(script, /LocalMachine|setx/i);
    }
  }
});

test('configuração é idempotente e não executa gravação desnecessária', async () => {
  const fixture = registry({ exists: true, value: '"%USERPROFILE%\\.rubycli\\bin"', kind: 'ExpandString' });
  assert.deepEqual(await configureWindowsPath(bin, { platform: 'win32', runner: fixture.runner, env }), { changed: false });
  assert.equal(fixture.calls.length, 1);
});

test('configuração relê o PATH após edição concorrente antes de tentar acrescentar', async () => {
  const fixture = registry({ exists: true, value: 'C:\\tools', kind: 'String' }, { conflicts: 1 });
  assert.deepEqual(await configureWindowsPath(bin, { platform: 'win32', runner: fixture.runner, env }), { changed: true });
  assert.equal(fixture.state.value, `C:\\tools;C:\\concurrent;${bin}`);
  assert.equal(fixture.calls.length, 4);
});

test('configuração limita conflitos e não expõe o PATH em mensagens de erro', async () => {
  const fixture = registry({ exists: true, value: 'C:\\private-secret', kind: 'String' }, { conflicts: 3 });
  await assert.rejects(configureWindowsPath(bin, { platform: 'win32', runner: fixture.runner, env }), error => {
    assert.equal(error.code, 'WINDOWS_PATH_CONFLICT');
    assert.doesNotMatch(error.message, /private-secret/);
    return true;
  });
  assert.equal(fixture.calls.length, 6);
  await assert.rejects(configureWindowsPath(bin, { platform: 'win32', env, runner: async () => 'private-secret' }), error => {
    assert.equal(error.code, 'WINDOWS_PATH_RESPONSE');
    assert.doesNotMatch(error.message, /private-secret/);
    return true;
  });
});

test('configuração não inicia PowerShell fora do Windows', async () => {
  assert.deepEqual(await configureWindowsPath('/tmp/bin', { platform: 'linux', runner: () => assert.fail('PowerShell inesperado') }), { changed: false });
});

test('ponte PowerShell preserva dados reais em chave de registro temporária isolada', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  // Never touch HKCU\\Environment: redirect only the bridge's two hardcoded key
  // lookups to a random, dedicated test key and suppress desktop notifications.
  const key = `Software\\RubyCLIPathTests-${randomUUID()}`;
  let powershell;
  const raw = String.raw`%SystemRoot%\System32;C:\João & Maria\a'$(test)[x]^!`;
  const setup = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($request.key -notmatch '^Software\\RubyCLIPathTests-[0-9a-f-]+$') { throw 'Unsafe test key' }
if ($request.remove) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($request.key, $false) }
else {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($request.key)
  try { $key.SetValue('Path', $request.value, [Microsoft.Win32.RegistryValueKind]::$($request.kind)) }
  finally { $key.Dispose() }
}
`;
  const execute = (script, input) => capture(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { input: JSON.stringify(input), timeout: 10000 });
  const runner = async (file, args, options) => {
    powershell = file;
    let script = Buffer.from(args[4], 'base64').toString('utf16le');
    assert.equal((script.match(/SubKey\('Environment'/g) || []).length, 2);
    script = script.replaceAll("SubKey('Environment'", `SubKey('${key}'`);
    script = script.replace(/^\s*\[void\]\[RubyPathNotification\]::SendMessageTimeout\(.+$/m, '');
    assert.ok(!script.includes("SubKey('Environment'"));
    return capture(file, [...args.slice(0, 4), Buffer.from(script, 'utf16le').toString('base64')], options);
  };
  // Obtain the bridge executable without invoking it or reading the real PATH.
  await configureWindowsPath(bin, { platform: 'win32', runner: async file => {
    powershell = file;
    return JSON.stringify({ exists: true, value: bin, kind: 'String' });
  } });
  t.after(() => execute(setup, { key, remove: true }));
  for (const kind of ['String', 'ExpandString']) {
    await execute(setup, { key, value: raw, kind });
    assert.deepEqual(await configureWindowsPath(bin, { runner }), { changed: true });
    assert.deepEqual(await configureWindowsPath(bin, { runner }), { changed: false });
    assert.deepEqual(await configureWindowsPath(bin, { runner, remove: true }), { changed: true });
    let actual;
    await configureWindowsPath(bin, { runner: async (file, args, options) => {
      actual = JSON.parse(await runner(file, args, options));
      // Force a no-op after reading the isolated key.
      return JSON.stringify({ exists: true, value: bin, kind });
    } });
    assert.deepEqual(actual, { exists: true, value: raw, kind });
  }
});
