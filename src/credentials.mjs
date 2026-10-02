import path from 'node:path';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { atomicWrite, readJSON, profileDir, envKey, validateKey } from './config.mjs';
import { capture, findExecutable } from './process.mjs';
import { assert, RubyError } from './errors.mjs';

const SERVICE = 'cloud.rubycli.installer';
function identity(profile, base, env) { return createHash('sha256').update(profileDir(profile, env) + '\n' + base).digest('hex'); }
function fileFor(profile, env) { return path.join(profileDir(profile, env), 'credential.json'); }
const ps = script => ['-NoProfile','-NonInteractive','-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
const dpapi = direction => `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=${direction === 'Protect' ? '[Text.Encoding]::UTF8.GetBytes($s)' : '[Convert]::FromBase64String($s)'}; $v=[Security.Cryptography.ProtectedData]::${direction}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write(${direction === 'Protect' ? '[Convert]::ToBase64String($v)' : '[Text.Encoding]::UTF8.GetString($v)'});`;

export async function recommendedStore() {
  if (process.platform === 'darwin') return 'keychain';
  if (process.platform === 'win32') return 'dpapi';
  return await findExecutable('secret-tool') ? 'secret-service' : 'env';
}
export async function saveKey(profile, base, key, store, env = process.env) {
  validateKey(key);
  assert(['env','file','keychain','dpapi','secret-service'].includes(store), 'INVALID_STORE', 'Armazenamento inválido.');
  // Choosing env explicitly means no persisted credential fallback for this profile.
  if (store === 'env') { await removeKey(profile,env); return; }
  const account = identity(profile, base, env);
  const record = { schema: 1, baseURL: base, store, account };
  try {
    if (store === 'keychain') {
      assert(process.platform === 'darwin', 'UNSUPPORTED_STORE', 'Keychain requer macOS.');
      // Interactive security input avoids placing a secret in the process argument list.
      const hex = Buffer.from(key).toString('hex');
      await capture('/usr/bin/security', ['-i'], { input: `add-generic-password -U -a ${account} -s ${SERVICE} -X ${hex}\n` });
      assert(await capture('/usr/bin/security', ['find-generic-password','-a',account,'-s',SERVICE,'-w']) === key, 'CREDENTIAL_SAVE_FAILED', 'O Chaves não confirmou a gravação.');
    } else if (store === 'secret-service') {
      await capture('secret-tool', ['store','--label=RubyCLI API key','service',SERVICE,'account',account], { input: key });
    } else if (store === 'dpapi') {
      assert(process.platform === 'win32', 'UNSUPPORTED_STORE', 'DPAPI requer Windows.');
      record.encrypted = await capture('powershell.exe', ps(dpapi('Protect')), { input: key });
    } else record.key = key;
    await atomicWrite(fileFor(profile, env), JSON.stringify(record) + '\n');
  } catch (error) {
    if (error instanceof RubyError) throw error;
    throw new RubyError('CREDENTIAL_SAVE_FAILED', 'Não foi possível guardar a chave. Use uma variável de ambiente ou selecione file explicitamente.');
  }
}
export async function loadKey(profile, base, env = process.env, { optional = false } = {}) {
  const value = envKey(env);
  if (value) return validateKey(value);
  const record = await readJSON(fileFor(profile, env), null);
  if (!record) {
    if (optional) return null;
    throw new RubyError('AUTH_REQUIRED', 'Configure sua chave com rubycli setup ou defina RUBY_API_KEY.', 401);
  }
  assert(record.baseURL === base, 'CREDENTIAL_ENDPOINT_MISMATCH', 'A chave salva pertence a outra URL. Execute setup para este endpoint.');
  let key;
  try {
    if (record.store === 'file') key = record.key;
    else if (record.store === 'keychain') key = await capture('/usr/bin/security', ['find-generic-password','-a',record.account,'-s',SERVICE,'-w']);
    else if (record.store === 'secret-service') key = await capture('secret-tool', ['lookup','service',SERVICE,'account',record.account]);
    else if (record.store === 'dpapi') key = await capture('powershell.exe', ps(dpapi('Unprotect')), { input: record.encrypted });
    else throw new Error();
  } catch { throw new RubyError('CREDENTIAL_UNAVAILABLE', 'A credencial está indisponível. Desbloqueie o cofre ou execute rubycli setup.'); }
  return validateKey(key);
}
export async function removeKey(profile, env = process.env) {
  const record = await readJSON(fileFor(profile, env), null);
  if (record?.store === 'keychain') await capture('/usr/bin/security', ['delete-generic-password','-a',record.account,'-s',SERVICE]);
  if (record?.store === 'secret-service') await capture('secret-tool', ['clear','service',SERVICE,'account',record.account]);
  await rm(fileFor(profile, env), { force: true });
}
