param([string]$Prefix, [switch]$Offline)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'RubyCLI requer Node.js 22.16+. Instale por https://nodejs.org e execute novamente.'
}
$rubyInstallerArgs = @((Join-Path $PSScriptRoot 'scripts/install.mjs'))
if ($Prefix) { $rubyInstallerArgs += @('--prefix', $Prefix) }
if ($Offline) { $rubyInstallerArgs += '--offline' }
& node @rubyInstallerArgs
if ($LASTEXITCODE -ne 0) { throw 'A instalação RubyCLI não foi concluída.' }
