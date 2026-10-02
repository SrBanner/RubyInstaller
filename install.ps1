param([string]$Prefix, [switch]$Offline, [switch]$NoPath)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'RubyCLI requer Node.js 22.16+. Instale por https://nodejs.org e execute novamente.'
}
$rubyInstallRoot = if ($Prefix) { $Prefix } elseif ($env:RUBYCLI_HOME) { $env:RUBYCLI_HOME } else { Join-Path $env:USERPROFILE '.rubycli' }
$rubyInstallRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($rubyInstallRoot)
$rubyInstallerArgs = @((Join-Path $PSScriptRoot 'scripts/install.mjs'), '--prefix', $rubyInstallRoot)
if ($Offline) { $rubyInstallerArgs += '--offline' }
if ($NoPath) { $rubyInstallerArgs += '--no-path' }
& node @rubyInstallerArgs
if ($LASTEXITCODE -ne 0) { throw 'A instalação RubyCLI não foi concluída.' }
if (-not $NoPath) {
  $rubyBin = Join-Path $rubyInstallRoot 'bin'
  # A child process cannot update its parent's environment. Keep this session's
  # custom entries, and append only the installed bin directory when missing.
  $rubyPathPresent = @($env:Path -split ';' | Where-Object {
    [Environment]::ExpandEnvironmentVariables($_.Trim().Trim('"')).Replace('/', '\').TrimEnd('\') -ieq $rubyBin.TrimEnd('\')
  }).Count -gt 0
  if (-not $rubyPathPresent -and $rubyBin -notmatch '[;\x00-\x1f]|%[^%]+%') {
    $env:Path = if ([string]::IsNullOrEmpty($env:Path)) { $rubyBin } elseif ($env:Path.EndsWith(';')) { $env:Path + $rubyBin } else { $env:Path + ';' + $rubyBin }
  }
}
