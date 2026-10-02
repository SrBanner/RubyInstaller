import { mkdir, readFile, writeFile, rename, rm, chmod, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assert, RubyError } from './errors.mjs';

export const VERSION = '0.1.1';
export const DEFAULT_BASE_URL = 'https://app.rubycli.cloud/v1';
export function home(env = process.env) { return path.resolve(env.RUBYCLI_HOME || path.join(homedir(), '.rubycli')); }
export function profileName(value = 'default') {
  assert(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(value), 'INVALID_PROFILE', 'Perfil: use até 48 letras, números, hífen ou sublinhado.');
  return value;
}
export function profileDir(profile = 'default', env = process.env) { return path.join(home(env), 'profiles', profileName(profile)); }
export function baseURL(value = DEFAULT_BASE_URL) {
  let url; try { url = new URL(value); } catch { throw new RubyError('INVALID_URL', 'A URL da API é inválida.'); }
  assert(!url.username && !url.password && !url.search && !url.hash, 'INVALID_URL', 'A URL não pode conter senha, consulta ou fragmento.');
  assert(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)), 'INSECURE_URL', 'Use HTTPS. HTTP é permitido apenas em loopback.');
  const clean = url.href.replace(/\/+$/, '');
  return clean.endsWith('/v1') ? clean : `${clean}/v1`;
}
export function validateKey(value) {
  assert(typeof value === 'string' && value.length >= 1 && value.length <= 4096 && !/[\s\x00-\x1f\x7f]/.test(value), 'INVALID_KEY', 'Chave vazia ou com caracteres inválidos.');
  return value;
}
export async function privateDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await lstat(dir);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_PATH', 'Diretório de estado não pode ser um link simbólico.');
  if (process.platform !== 'win32') await chmod(dir, 0o700);
}
export async function atomicWrite(file, contents) {
  await privateDir(path.dirname(file));
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, contents, { mode: 0o600, flag: 'wx' });
    await rename(tmp, file);
  } finally { await rm(tmp, { force: true }); }
}
export async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new RubyError('INVALID_CONFIG', 'Arquivo de configuração inválido ou ilegível. Preserve o arquivo e execute setup novamente.');
  }
}
export async function loadConfig(profile = 'default', env = process.env) {
  const stored = await readJSON(path.join(profileDir(profile, env), 'config.json'), {});
  assert(stored && typeof stored === 'object' && !Array.isArray(stored) && (!stored.schema || stored.schema === 1), 'INVALID_CONFIG', 'Versão de configuração não suportada.');
  return { ...stored, profile: profileName(profile), baseURL: baseURL(env.RUBYCLI_BASE_URL || stored.baseURL), model: env.RUBYCLI_MODEL || stored.model || null };
}
export async function saveConfig(profile, config, env = process.env) {
  const file = path.join(profileDir(profile, env), 'config.json');
  const previous = await readFile(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (previous) await atomicWrite(`${file}.backup`, previous);
  await atomicWrite(file, JSON.stringify({ schema: 1, baseURL: baseURL(config.baseURL), model: config.model || null }, null, 2) + '\n');
}
export function envKey(env = process.env) {
  assert(!(env.RUBY_API_KEY && env.RUBYCLI_API_KEY && env.RUBY_API_KEY !== env.RUBYCLI_API_KEY), 'KEY_CONFLICT', 'RUBY_API_KEY e RUBYCLI_API_KEY possuem valores diferentes. Use uma só.');
  return env.RUBY_API_KEY || env.RUBYCLI_API_KEY || null;
}
