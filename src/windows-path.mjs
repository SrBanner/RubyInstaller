import path from 'node:path';
import { capture } from './process.mjs';
import { RubyError } from './errors.mjs';

// Paths and registry contents travel as JSON on stdin, never as PowerShell code.
// Reading without expansion and reusing GetValueKind preserves existing %VAR%
// references and REG_SZ / REG_EXPAND_SZ. Only the current user's PATH is edited.
const registryScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$key = $null
try {
  if ($request.operation -notin @('read', 'write')) { throw 'Invalid operation' }
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', ($request.operation -eq 'write'))
  $exists = ($null -ne $key) -and ($key.GetValueNames() -contains 'Path')
  $value = ''
  $kind = 'ExpandString'
  if ($exists) {
    $kind = $key.GetValueKind('Path').ToString()
    if ($kind -notin @('String', 'ExpandString')) { throw 'Unsupported PATH value kind' }
    $value = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  }
  if ($request.operation -eq 'read') {
    @{ exists = $exists; value = $value; kind = $kind } | ConvertTo-Json -Compress
  } elseif (($exists -ne $request.expected.exists) -or ($kind -cne $request.expected.kind) -or ($value -cne $request.expected.value)) {
    @{ conflict = $true } | ConvertTo-Json -Compress
  } else {
    if ($null -eq $key) { $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment') }
    $key.SetValue('Path', [string]$request.value, [Microsoft.Win32.RegistryValueKind]::$kind)
    $key.Flush()
    # Notification is best effort: persistence succeeded even if a desktop is unavailable.
    try {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RubyPathNotification {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, UIntPtr wParam,
    string lParam, uint flags, uint timeout, out UIntPtr result);
}
'@
      $result = [UIntPtr]::Zero
      [void][RubyPathNotification]::SendMessageTimeout([IntPtr]0xffff, 0x001a, [UIntPtr]::Zero, 'Environment', 2, 1000, [ref]$result)
    } catch { }
    @{ changed = $true } | ConvertTo-Json -Compress
  }
} finally {
  if ($null -ne $key) { $key.Dispose() }
}
`;

function comparableDirectory(value, env) {
  let expanded = value.trim().replace(/^"(.*)"$/, '$1');
  // Expansion is for comparison only. Never rewrite the caller's existing text.
  expanded = expanded.replace(/%([^%]+)%/g, (original, name) => env.get(name.toUpperCase()) ?? original);
  return path.win32.normalize(expanded).replace(/[\\/]+$/, '').toLowerCase();
}

export function editWindowsPath(value, bin, { remove = false, env = process.env } = {}) {
  if (typeof value !== 'string' || typeof bin !== 'string' || !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(bin) || /[;"\x00-\x1f]|%[^%]+%/.test(bin)) {
    throw new RubyError('WINDOWS_PATH_INVALID', 'O diretório da RubyCLI não pode ser representado com segurança no PATH do Windows.');
  }
  const variables = new Map(Object.entries(env).map(([name, entry]) => [name.toUpperCase(), entry]));
  const target = comparableDirectory(bin, variables);
  const entries = value.split(';');
  const matches = entry => entry.trim() !== '' && comparableDirectory(entry, variables) === target;
  const found = entries.some(matches);
  if (remove) return { changed: found, value: found ? entries.filter(entry => !matches(entry)).join(';') : value };
  if (found) return { changed: false, value };
  // Appending (rather than prepending) preserves precedence of existing tools.
  return { changed: true, value: value ? `${value};${bin}` : bin };
}

/** Call remove only for an entry recorded as added by this installation. */
export async function configureWindowsPath(bin, { remove = false, runner = capture, env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return { changed: false };
  const systemRoot = Object.entries(env).find(([name]) => name.toUpperCase() === 'SYSTEMROOT')?.[1] || 'C:\\Windows';
  const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(registryScript, 'utf16le').toString('base64')];
  const invoke = async request => {
    const output = await runner(powershell, args, { input: JSON.stringify(request), env, timeout: 60000, label: 'configuração do PATH do usuário' });
    try { return JSON.parse(output); }
    catch { throw new RubyError('WINDOWS_PATH_RESPONSE', 'Não foi possível confirmar a configuração do PATH do usuário.'); }
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await invoke({ operation: 'read' });
    if (typeof state?.value !== 'string' || typeof state.exists !== 'boolean' || !['String', 'ExpandString'].includes(state.kind)) {
      throw new RubyError('WINDOWS_PATH_RESPONSE', 'O PATH do usuário não possui um formato de texto compatível.');
    }
    const update = editWindowsPath(state.value, bin, { remove, env });
    if (!update.changed) return { changed: false };
    const result = await invoke({ operation: 'write', expected: state, value: update.value });
    if (result?.changed === true) return { changed: true };
    if (result?.conflict !== true) throw new RubyError('WINDOWS_PATH_RESPONSE', 'Não foi possível confirmar a configuração do PATH do usuário.');
  }
  throw new RubyError('WINDOWS_PATH_CONFLICT', 'O PATH foi alterado por outro processo. Execute o instalador novamente.');
}
