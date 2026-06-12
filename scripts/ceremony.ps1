<#
.SYNOPSIS
  Start / stop the "Turning of the Tassel" ceremony and surface the MC console link.

.DESCRIPTION
  Runs the app one of two ways, chosen with -Runtime:
    docker  (default) — the containerized stack from docker-compose.yml (api + web + cloudflared).
    native            — directly on Node via `npm run prod` / `prod:share` (no Docker).
  Handles preflight + auto-install for whichever runtime you pick, builds + starts, waits for the
  Master-of-Ceremony link, and can copy/open it. Used by the GUI (ceremony-gui.ps1) and standalone.

  Docker/native CLIs are invoked through `cmd /c` on purpose: in Windows PowerShell 5.1, redirecting
  a native command's stderr inside PowerShell wraps each line in a terminating error. Letting cmd own
  the redirection avoids that and keeps $LASTEXITCODE meaningful.

.EXAMPLE
  powershell -File scripts/ceremony.ps1 start                       # Docker, public MC link
  powershell -File scripts/ceremony.ps1 start -Runtime native       # no Docker, runs on Node
  powershell -File scripts/ceremony.ps1 start -NoTunnel             # local-only (http://localhost:4173)
  powershell -File scripts/ceremony.ps1 start -AutoInstall          # install the runtime first if missing
  powershell -File scripts/ceremony.ps1 link|open|status|logs|stop
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'link', 'open', 'status', 'logs')]
  [string]$Action = 'start',
  [ValidateSet('docker', 'native')]
  [string]$Runtime = 'docker',
  [switch]$NoTunnel,
  [switch]$AutoInstall,    # install the chosen runtime automatically if it's missing (admin prompt)
  [int]$TimeoutSeconds = 180
)

# Native stderr is handled via cmd /c (see header) — keep PowerShell errors non-terminating and
# drive control flow off $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent     # repo root — docker-compose.yml / package.json live here
$PidFile = Join-Path $root '.ceremony-native.pid'    # tracks the native (npm) process tree
$NativeLog = Join-Path $root '.ceremony-native.log'  # native stdout (tunnel link is printed here)
$HostTokenFile = Join-Path $root '.host-token.local' # the server writes the MC token here at boot

function Fail($msg) { Write-Output "ERROR: $msg"; exit 1 }

# Pick up PATH changes a winget install just made, without needing a fresh shell.
function Update-PathFromRegistry {
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
  [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

# ============================ Docker runtime ============================

# 'ready' (engine responds) | 'stopped' (installed, engine down) | 'missing' (not installed).
function Get-DockerState {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return 'missing' }
  cmd /c "docker info >nul 2>nul"
  if ($LASTEXITCODE -eq 0) { return 'ready' } else { return 'stopped' }
}

function Start-DockerDesktop {
  $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $exe) { Start-Process $exe | Out-Null; return $true }
  return $false
}

function Wait-DockerEngine([int]$Seconds = 180) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    cmd /c "docker info >nul 2>nul"
    if ($LASTEXITCODE -eq 0) { return $true }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Install-DockerDesktop {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Output "Installing Docker Desktop via winget (approve the administrator prompt)..."
    cmd /c "winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements"
    if ($LASTEXITCODE -eq 0) { return $true }
    Write-Output "winget install returned $LASTEXITCODE; trying the direct installer..."
  }
  $url = 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe'
  $dst = Join-Path $env:TEMP 'DockerDesktopInstaller.exe'
  try {
    Write-Output "Downloading the Docker Desktop installer..."
    Invoke-WebRequest -Uri $url -OutFile $dst -UseBasicParsing
    Write-Output "Running the installer (approve the administrator prompt)..."
    $p = Start-Process -FilePath $dst -ArgumentList 'install', '--quiet', '--accept-license' -Verb RunAs -PassThru -Wait
    return ($p.ExitCode -eq 0)
  }
  catch {
    Write-Output "Automatic install failed: $($_.Exception.Message)"
    return $false
  }
}

# Make sure Docker is installed AND its engine is up. Installs + starts as needed.
function Ensure-Docker([switch]$AutoInstall) {
  $state = Get-DockerState
  if ($state -eq 'ready') { return }
  if ($state -eq 'missing') {
    if (-not $AutoInstall) {
      Fail "Docker isn't installed. Re-run with -AutoInstall, get it from https://www.docker.com/products/docker-desktop/, or use -Runtime native to run without Docker."
    }
    Write-Output "Docker not found. Installing Docker Desktop (downloads a few hundred MB; takes a few minutes)..."
    if (-not (Install-DockerDesktop)) {
      Fail "Couldn't install Docker automatically. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ then try again."
    }
    Write-Output "Docker Desktop installed. Starting it..."
  }
  else {
    Write-Output "Docker is installed but not running. Starting Docker Desktop..."
  }
  Start-DockerDesktop | Out-Null
  Write-Output "Waiting for the Docker engine to come up (first start can take a minute)..."
  if (-not (Wait-DockerEngine $TimeoutSeconds)) {
    Fail "Docker isn't responding yet. If it was just installed, Windows may need a restart to enable WSL2 — reboot and run this again."
  }
}

function Get-DockerLink([switch]$Local) {
  if ($Local) {
    $log = (cmd /c "docker compose logs api 2>&1") -join "`n"
    $m = [regex]::Match($log, '\?t=([A-Za-z0-9_\-]{16,})')
    if ($m.Success) { return "http://localhost:4173/?t=$($m.Groups[1].Value)" }
    return $null
  }
  $log = (cmd /c "docker compose logs tunnel 2>&1") -join "`n"
  $hits = [regex]::Matches($log, 'https://[a-z0-9-]+\.trycloudflare\.com[^\s|]*')
  if ($hits.Count -eq 0) { return $null }
  foreach ($h in $hits) { if ($h.Value -match '\?t=') { return $h.Value } }
  return $hits[$hits.Count - 1].Value
}

# ============================ Native (Node) runtime ============================

function Test-NodeReady {
  (Get-Command node -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue)
}

function Ensure-Node([switch]$AutoInstall) {
  if (Test-NodeReady) { return }
  if (-not $AutoInstall) { Fail "Node.js isn't installed. Re-run with -AutoInstall, or get it from https://nodejs.org/" }
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Output "Installing Node.js LTS via winget (approve the administrator prompt)..."
    cmd /c "winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements"
    Update-PathFromRegistry
  }
  else {
    Fail "winget isn't available. Install Node.js from https://nodejs.org/ then try again."
  }
  if (-not (Test-NodeReady)) { Fail "Node.js installed but not on PATH yet. Close this window and run again." }
}

function Ensure-Cloudflared([switch]$AutoInstall) {
  if (Get-Command cloudflared -ErrorAction SilentlyContinue) { return }
  if (-not $AutoInstall) { Fail "cloudflared isn't installed (needed for the public link). Re-run with -AutoInstall, or use -NoTunnel for a local-only run." }
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Output "Installing cloudflared via winget..."
    cmd /c "winget install -e --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements"
    Update-PathFromRegistry
  }
  if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Fail "Couldn't install cloudflared. Install it, or use -NoTunnel for a local-only run."
  }
}

function Start-Native([switch]$NoTunnel) {
  Ensure-Node -AutoInstall:$AutoInstall
  if (-not $NoTunnel) { Ensure-Cloudflared -AutoInstall:$AutoInstall }
  if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Output "Installing app dependencies (npm install — first time only)..."
    cmd /c "npm install"
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
  }
  Remove-Item $HostTokenFile -ErrorAction SilentlyContinue   # so we read a fresh token
  '' | Set-Content $NativeLog
  $npmScript = if ($NoTunnel) { 'prod' } else { 'prod:share' }
  Write-Output "Starting the app on Node (npm run $npmScript)..."
  # Track cmd.exe as the parent so a later `taskkill /T` tears down the whole npm/node/vite tree.
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm', 'run', $npmScript `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $NativeLog -RedirectStandardError ($NativeLog + '.err')
  $p.Id | Set-Content $PidFile
}

function Get-NativeLink([switch]$Local) {
  if ($Local) {
    if (Test-Path $HostTokenFile) {
      $tok = (Get-Content $HostTokenFile -Raw -ErrorAction SilentlyContinue)
      if ($tok) { return "http://localhost:4173/?t=$($tok.Trim())" }
    }
    return $null
  }
  if (Test-Path $NativeLog) {
    $log = Get-Content $NativeLog -Raw -ErrorAction SilentlyContinue
    if ($log) {
      $hits = [regex]::Matches($log, 'https://[a-z0-9-]+\.trycloudflare\.com[^\s|]*')
      foreach ($h in $hits) { if ($h.Value -match '\?t=') { return $h.Value } }
      if ($hits.Count) { return $hits[$hits.Count - 1].Value }
    }
  }
  return $null
}

function Stop-Native {
  if (-not (Test-Path $PidFile)) { return $false }
  $procId = (Get-Content $PidFile -Raw -ErrorAction SilentlyContinue)
  if ($procId) { cmd /c "taskkill /PID $($procId.Trim()) /T /F >nul 2>nul" }
  Remove-Item $PidFile, $NativeLog, ($NativeLog + '.err') -ErrorAction SilentlyContinue
  return $true
}

function Test-NativeRunning { Test-Path $PidFile }

# ============================ Shared helpers ============================

# Resolve the link for the runtime we're starting (we know the mode here).
function Resolve-StartLink {
  if ($Runtime -eq 'native') { return (Get-NativeLink -Local:$NoTunnel) }
  return (Get-DockerLink -Local:$NoTunnel)
}

# Auto-detect for the standalone link/open actions (don't assume which runtime is up).
function Resolve-AnyLink {
  if (Test-NativeRunning) {
    $l = Get-NativeLink; if ($l) { return $l }
    return (Get-NativeLink -Local)
  }
  $l = Get-DockerLink; if ($l) { return $l }
  return (Get-DockerLink -Local)
}

function Wait-Link {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $link = Resolve-StartLink
    if ($link) { return $link }
    Start-Sleep -Seconds 2
  }
  return $null
}

Push-Location $root
try {
  switch ($Action) {
    'start' {
      if ($Runtime -eq 'native') {
        Start-Native -NoTunnel:$NoTunnel
        Write-Output "Started. Waiting for the MC link..."
      }
      else {
        Ensure-Docker -AutoInstall:$AutoInstall
        $svc = if ($NoTunnel) { ' api web' } else { '' }
        Write-Output "Building images and starting containers (first run pulls base images + builds — can take a few minutes)..."
        cmd /c "docker compose up -d --build$svc"
        if ($LASTEXITCODE -ne 0) { Fail "docker compose failed to start. Run 'docker compose logs' for details." }
        Write-Output "Containers up. Resolving the MC link..."
      }
      $link = Wait-Link
      if (-not $link) {
        Write-Output "Started, but couldn't read the MC link yet. Try '$($MyInvocation.MyCommand.Name) link' shortly, or check the logs."
        exit 2
      }
      Write-Output ""
      Write-Output "============================================================"
      Write-Output " HOST (Master of Ceremony) console -- open this yourself:"
      Write-Output ""
      Write-Output "   $link"
      Write-Output ""
      Write-Output " Don't share the bare URL. Invite people with the per-person"
      Write-Output " links from the MC panel."
      Write-Output "============================================================"
      Write-Output "MCLINK=$link"   # machine-readable marker the GUI parses
    }
    'stop' {
      Write-Output "Stopping..."
      $stoppedNative = Stop-Native
      if ((Get-DockerState) -eq 'ready') { cmd /c "docker compose down" }
      Write-Output "Stopped."
    }
    'link' {
      $link = Resolve-AnyLink
      if ($link) { Write-Output $link; Write-Output "MCLINK=$link" } else { Fail "No link found. Is it running? Try 'start'." }
    }
    'open' {
      $link = Resolve-AnyLink
      if ($link) { Start-Process $link; Write-Output "Opened $link" } else { Fail "No link found. Is it running? Try 'start'." }
    }
    'status' {
      if (Test-NativeRunning) { Write-Output "Native (Node) ceremony running. Link: $(Resolve-AnyLink)" }
      else { cmd /c "docker compose ps" }
    }
    'logs' {
      if (Test-NativeRunning) { Get-Content $NativeLog -Wait -Tail 50 }
      else { cmd /c "docker compose logs -f" }
    }
  }
}
finally { Pop-Location }
