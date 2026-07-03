import config from '../../../template.config.json';

const base = String(config.vercelUrl).replace(/\/+$/, '');

export async function GET() {
  // PowerShell installer for Windows (parity with install.sh). TS interpolates
  // ${...}; every backslash that must survive into the script is written as \\.
  const script = `# ${config.brandName} installer for Windows
# Usage:  irm ${base}/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$Base = $env:INSTALL_BASE
if (-not $Base) { $Base = '${base}' }
$Cmd = '${config.commandName}'
$Dest = Join-Path $env:USERPROFILE ".$Cmd"
$BinDir = $env:INSTALL_BIN_DIR
if (-not $BinDir) { $BinDir = Join-Path $env:USERPROFILE '.local\\bin' }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'error: node is required (https://nodejs.org)'; return
}
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
  Write-Host 'error: tar is required (ships with Windows 10 1803 and later)'; return
}

$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/api/bundle" -OutFile "$Tmp\\bundle.tar.gz"
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  tar -xzf "$Tmp\\bundle.tar.gz" -C $Dest

  # Per-install random key sealing the local session state (clock-tamper
  # defense). Created once; survives updates.
  $KeyFile = Join-Path $Dest 'install-key'
  if (-not (Test-Path $KeyFile)) {
    node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" | Out-File -FilePath $KeyFile -Encoding ascii -NoNewline
  }

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $Launcher = Join-Path $BinDir "$Cmd.cmd"
  @('@echo off', 'node "' + $Dest + '\\cli\\index.mjs" %*') | Out-File -FilePath $Launcher -Encoding ascii

  $onPath = ($env:Path -split ';') -contains $BinDir
  if ($onPath) {
    Write-Host "Installed ${config.brandName} to $Dest - run '$Cmd' to start"
  } else {
    Write-Host "Installed ${config.brandName} to $Dest"
    Write-Host "Run it with: $Launcher"
    Write-Host "(or add $BinDir to your PATH to use '$Cmd' directly)"
  }
} finally {
  Remove-Item -Recurse -Force $Tmp
}
`;
  return new Response(script, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
