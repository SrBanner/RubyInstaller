import { spawn } from 'node:child_process';
import { access, stat, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { RubyError } from './errors.mjs';

const nativeFS = { access, stat, readFile };

export async function findExecutable(name, env = process.env, platform = process.platform, runtime = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const fs = runtime.fs || nativeFS;
  const searchPath = env[Object.keys(env).find(key => key.toUpperCase() === 'PATH')] || '';
  const dirs = name.includes('/') || name.includes('\\') ? [''] : searchPath.split(paths.delimiter).filter(Boolean);
  // Node/npm ship an extensionless POSIX shell script next to npm.cmd on Windows.
  // CreateProcess cannot execute that shell script. Never select it on Windows.
  const extensions = platform === 'win32' && !paths.extname(name) ? ['.exe', '.com', '.cmd', '.bat'] : [''];
  for (const dir of dirs) for (const ext of extensions) {
    const file = paths.resolve(runtime.cwd || process.cwd(), dir.replace(/^"(.*)"$/, '$1'), name + ext);
    try { await fs.access(file, platform === 'win32' ? constants.F_OK : constants.X_OK); if ((await fs.stat(file)).isFile()) return file; } catch { /* Next candidate. */ }
  }
  return null;
}

export function windowsShimTarget(shim, file) {
  let relative;
  if (/^npm\.cmd$/i.test(path.win32.basename(file))) {
    // npm's own shim uses variables and has both npm-prefix.js and npm-cli.js.
    // Choose the CLI assignment, never the node.exe or prefix helper assignment.
    relative = shim.match(/\bSET\s+"?NPM_CLI_JS=(?:%~dp0|%dp0%)[\\/]([^"\r\n]*npm-cli\.js)"?\s*$/im)?.[1];
  }
  // cmd-shim-generated launchers end their actual target invocation with %*.
  // Do not pick an earlier IF EXIST "%dp0%\node.exe" condition.
  relative ||= shim.match(/"(?:%~dp0|%dp0%)[\\/]([^"\r\n]+\.(?:c?js|mjs|exe|com))"\s+%\*\s*$/im)?.[1];
  if (!relative || /[%\x00-\x1f]/.test(relative)) throw new RubyError('UNSUPPORTED_SHIM', 'Wrapper Windows não reconhecido. Use o executável .exe ou o entrypoint .js do cliente.');
  return path.win32.resolve(path.win32.dirname(file),relative);
}

export async function commandSpec(name, args = [], env = process.env, runtime = {}) {
  const platform = runtime.platform || process.platform;
  const fs = runtime.fs || nativeFS;
  const node = runtime.nodePath || process.execPath;
  const file = await findExecutable(name, env, platform, runtime);
  if (!file) throw new RubyError('CLIENT_NOT_FOUND', `Executável ${path.basename(name)} não encontrado. Consulte docs/CLIENTS.md.`, 404);
  if (platform !== 'win32') return { file, args };
  if (/\.(c?js|mjs)$/i.test(file)) return { file: node, args: [file,...args] };
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args };
  const target = windowsShimTarget(await fs.readFile(file, 'utf8'),file);
  let exists = false; try { exists = (await fs.stat(target)).isFile(); } catch { /* Explain a broken installation without spawning it. */ }
  if (!exists) throw new RubyError('SHIM_TARGET_NOT_FOUND', `O destino do wrapper ${path.win32.basename(file)} não existe. Reinstale esse programa.`);
  return /\.(exe|com)$/i.test(target) ? { file: target, args } : { file: node, args: [target, ...args] };
}

export async function npmCommandSpec(args = [], env = process.env, runtime = {}) {
  const platform = runtime.platform || process.platform, fs = runtime.fs || nativeFS, node = runtime.nodePath || process.execPath;
  if (platform === 'win32') {
    const bundled = path.win32.join(path.win32.dirname(node),'node_modules','npm','bin','npm-cli.js');
    try { if ((await fs.stat(bundled)).isFile()) return { file: node, args: [bundled,...args] }; } catch { /* npm may be installed at another PATH entry. */ }
  }
  try { return await commandSpec('npm',args,env,runtime); }
  catch (error) {
    if (error.code === 'CLIENT_NOT_FOUND') throw new RubyError('NPM_NOT_FOUND', 'npm não encontrado. Instale Node.js com npm e abra um novo terminal.');
    throw error;
  }
}

export function capture(file, args, { input, timeout = 15000, env = process.env, label = 'comando auxiliar' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, stdio: ['pipe','pipe','pipe'], windowsHide: true });
    let out = '', size = 0, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) child.kill(); else out += chunk; });
    child.stderr.resume();
    child.on('error', error => { clearTimeout(timer); const code = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'SPAWN_ERROR'; reject(new RubyError('COMMAND_FAILED', `Não foi possível iniciar ${label} (${code}). Confira o executável e suas permissões.`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new RubyError('COMMAND_TIMEOUT', `${label} excedeu o tempo limite.`));
      else if (size > 8 * 1024 * 1024) reject(new RubyError('COMMAND_OUTPUT_LIMIT', `${label} excedeu o limite de saída.`));
      else if (code !== 0) reject(new RubyError('COMMAND_FAILED', `${label} encerrou com código ${code ?? 'desconhecido'}.`));
      else resolve(out.trim());
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}
export async function runInteractive(name, args, { env = process.env, cwd = process.cwd() } = {}) {
  const spec = await commandSpec(name, args, env);
  return new Promise((resolve, reject) => {
    const child = spawn(spec.file, spec.args, { env, cwd, stdio: 'inherit', shell: false });
    const forward = signal => { if (!child.killed) child.kill(signal); };
    const onInt = () => forward('SIGINT'), onTerm = () => forward('SIGTERM');
    process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
    const cleanup = () => { process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); };
    child.once('error', () => { cleanup(); reject(new RubyError('LAUNCH_FAILED', 'Não foi possível iniciar o cliente.')); });
    child.once('exit', (code, signal) => { cleanup(); resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)); });
  });
}
