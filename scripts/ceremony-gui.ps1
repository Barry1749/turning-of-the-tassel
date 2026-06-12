<#
  Small control-panel app for running the ceremony. One window, a green Start button, a red Stop
  button, a Docker/Native runtime choice, and the MC (host) link with Copy / Open. It delegates the
  real work to ceremony.ps1 (run in a background job so the long build never freezes the window).

  Launch it by double-clicking "Start Ceremony.cmd" in the project root, or:
    powershell -NoProfile -ExecutionPolicy Bypass -STA -File scripts/ceremony-gui.ps1
#>
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$scriptPath = Join-Path $PSScriptRoot 'ceremony.ps1'
$script:job = $null
$script:mode = $null      # 'start' | 'stop'
$script:link = $null

# --- window ---------------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Turning of the Tassel - Ceremony Control'
$form.Size = New-Object System.Drawing.Size(660, 620)
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Turning of the Tassel'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(20, 16)
$form.Controls.Add($title)

$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = "`u{25B6}  Start ceremony"
$btnStart.Size = New-Object System.Drawing.Size(190, 50)
$btnStart.Location = New-Object System.Drawing.Point(20, 58)
$btnStart.BackColor = [System.Drawing.Color]::FromArgb(40, 167, 69)
$btnStart.ForeColor = [System.Drawing.Color]::White
$btnStart.FlatStyle = 'Flat'
$btnStart.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($btnStart)

$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = "`u{25A0}  Stop"
$btnStop.Size = New-Object System.Drawing.Size(130, 50)
$btnStop.Location = New-Object System.Drawing.Point(220, 58)
$btnStop.BackColor = [System.Drawing.Color]::FromArgb(220, 53, 69)
$btnStop.ForeColor = [System.Drawing.Color]::White
$btnStop.FlatStyle = 'Flat'
$btnStop.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($btnStop)

$lblRun = New-Object System.Windows.Forms.Label
$lblRun.Text = 'Run with:'
$lblRun.AutoSize = $true
$lblRun.Location = New-Object System.Drawing.Point(365, 56)
$form.Controls.Add($lblRun)

$rbDocker = New-Object System.Windows.Forms.RadioButton
$rbDocker.Text = 'Docker'
$rbDocker.AutoSize = $true
$rbDocker.Checked = $true
$rbDocker.Location = New-Object System.Drawing.Point(365, 74)
$form.Controls.Add($rbDocker)

$rbNative = New-Object System.Windows.Forms.RadioButton
$rbNative.Text = 'Native (Node)'
$rbNative.AutoSize = $true
$rbNative.Location = New-Object System.Drawing.Point(445, 74)
$form.Controls.Add($rbNative)

$chkLocal = New-Object System.Windows.Forms.CheckBox
$chkLocal.Text = "Local only (this PC; no public link)"
$chkLocal.AutoSize = $true
$chkLocal.Location = New-Object System.Drawing.Point(365, 98)
$form.Controls.Add($chkLocal)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Style = 'Marquee'
$progress.MarqueeAnimationSpeed = 30
$progress.Location = New-Object System.Drawing.Point(20, 122)
$progress.Size = New-Object System.Drawing.Size(605, 14)
$progress.Visible = $false
$form.Controls.Add($progress)

$status = New-Object System.Windows.Forms.Label
$status.Text = 'Idle. Click Start to build and launch the ceremony.'
$status.AutoSize = $false
$status.Size = New-Object System.Drawing.Size(605, 24)
$status.Location = New-Object System.Drawing.Point(20, 144)
$form.Controls.Add($status)

$lblLink = New-Object System.Windows.Forms.Label
$lblLink.Text = 'MC (host) console link - open this yourself:'
$lblLink.AutoSize = $true
$lblLink.Location = New-Object System.Drawing.Point(20, 180)
$form.Controls.Add($lblLink)

$txtLink = New-Object System.Windows.Forms.TextBox
$txtLink.ReadOnly = $true
$txtLink.Location = New-Object System.Drawing.Point(20, 202)
$txtLink.Size = New-Object System.Drawing.Size(605, 26)
$txtLink.Font = New-Object System.Drawing.Font('Consolas', 11)
$form.Controls.Add($txtLink)

$btnCopy = New-Object System.Windows.Forms.Button
$btnCopy.Text = 'Copy link'
$btnCopy.Size = New-Object System.Drawing.Size(120, 34)
$btnCopy.Location = New-Object System.Drawing.Point(20, 236)
$btnCopy.Enabled = $false
$form.Controls.Add($btnCopy)

$btnOpen = New-Object System.Windows.Forms.Button
$btnOpen.Text = 'Open in browser'
$btnOpen.Size = New-Object System.Drawing.Size(150, 34)
$btnOpen.Location = New-Object System.Drawing.Point(150, 236)
$btnOpen.Enabled = $false
$form.Controls.Add($btnOpen)

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Multiline = $true
$txtLog.ReadOnly = $true
$txtLog.ScrollBars = 'Vertical'
$txtLog.Location = New-Object System.Drawing.Point(20, 282)
$txtLog.Size = New-Object System.Drawing.Size(605, 220)
$txtLog.Font = New-Object System.Drawing.Font('Consolas', 9)
$txtLog.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
$txtLog.ForeColor = [System.Drawing.Color]::Gainsboro
$form.Controls.Add($txtLog)

$note = New-Object System.Windows.Forms.Label
$note.Text = 'Run with Docker (isolated; auto-installs Docker) or Native (uses Node directly). Closing this window leaves the ceremony running - use Stop (or "Stop Ceremony.cmd") to shut it down. Remote cameras need the public link (https); the local-only link works only on this PC.'
$note.AutoSize = $false
$note.Size = New-Object System.Drawing.Size(605, 50)
$note.Location = New-Object System.Drawing.Point(20, 512)
$note.ForeColor = [System.Drawing.Color]::Gray
$form.Controls.Add($note)

# --- helpers --------------------------------------------------------------
function Add-Log([string]$text) {
  if ([string]::IsNullOrWhiteSpace($text)) { return }
  $txtLog.AppendText($text.TrimEnd() + "`r`n")
}

# 'ready' (engine responds) | 'stopped' (installed, down) | 'missing' (not installed).
function Get-DockerState {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return 'missing' }
  cmd /c "docker info >nul 2>nul"
  if ($LASTEXITCODE -eq 0) { return 'ready' } else { return 'stopped' }
}

function Set-State([string]$s) {
  switch ($s) {
    'idle' {
      $progress.Visible = $false; $btnStart.Enabled = $true; $btnStop.Enabled = $false
      $btnCopy.Enabled = $false; $btnOpen.Enabled = $false
      $chkLocal.Enabled = $true; $rbDocker.Enabled = $true; $rbNative.Enabled = $true
    }
    'working' {
      $progress.Visible = $true; $btnStart.Enabled = $false; $btnStop.Enabled = $false
      $btnCopy.Enabled = $false; $btnOpen.Enabled = $false
      $chkLocal.Enabled = $false; $rbDocker.Enabled = $false; $rbNative.Enabled = $false
    }
    'running' {
      $progress.Visible = $false; $btnStart.Enabled = $false; $btnStop.Enabled = $true
      $hasLink = -not [string]::IsNullOrEmpty($txtLink.Text)
      $btnCopy.Enabled = $hasLink; $btnOpen.Enabled = $hasLink
      $chkLocal.Enabled = $false; $rbDocker.Enabled = $false; $rbNative.Enabled = $false
    }
  }
}

# --- background-job polling ----------------------------------------------
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({
    if ($null -eq $script:job) { return }
    try {
      $out = Receive-Job $script:job 2>&1
      foreach ($line in $out) { Add-Log ([string]$line) }
    }
    catch {}
    if ($script:job.State -in @('Completed', 'Failed', 'Stopped')) {
      $timer.Stop()
      $finished = $script:mode
      Remove-Job $script:job -Force
      $script:job = $null
      $script:mode = $null
      if ($finished -eq 'start') {
        $m = [regex]::Match($txtLog.Text, 'MCLINK=(\S+)')
        if ($m.Success) {
          $script:link = $m.Groups[1].Value
          $txtLink.Text = $script:link
          Set-State 'running'
          $status.Text = 'Ready - open the MC link above. Keep this app running during the ceremony.'
        }
        else {
          Set-State 'idle'
          $em = [regex]::Match($txtLog.Text, 'ERROR: (.+)')
          $status.Text = if ($em.Success) { 'Error: ' + $em.Groups[1].Value } else { 'Start finished but no link was found - see the log below.' }
        }
      }
      elseif ($finished -eq 'stop') {
        $script:link = $null
        $txtLink.Text = ''
        Set-State 'idle'
        $status.Text = 'Stopped.'
      }
    }
  })

# Run ceremony.ps1 in a child powershell with -ExecutionPolicy Bypass so the default machine
# policy can't block it; capture all of its output (incl. docker build) for the log box.
function Start-Action([string]$mode, [string[]]$scriptArgs) {
  if ($script:job) { return }
  $txtLog.Clear()
  Set-State 'working'
  $script:mode = $mode
  $script:job = Start-Job -ScriptBlock {
    param($exe, $path, $a)
    & $exe -NoProfile -ExecutionPolicy Bypass -File $path @a 2>&1
  } -ArgumentList 'powershell.exe', $scriptPath, $scriptArgs
  $timer.Start()
}

$btnStart.Add_Click({
    $auto = $false
    if ($rbNative.Checked) {
      # Native (Node) runtime — check for Node, offer to install it.
      if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        $msg = "Node.js isn't installed (needed to run without Docker).`n`nInstall it now automatically? You'll get a Windows administrator prompt and a short download."
        $r = [System.Windows.Forms.MessageBox]::Show($msg, 'Install Node.js?',
          [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
        if ($r -ne [System.Windows.Forms.DialogResult]::Yes) {
          $status.Text = 'Node.js is required for native mode. Install cancelled.'
          return
        }
        $auto = $true
      }
      $status.Text = if ($auto) { 'Installing Node, then starting...' } else { 'Starting on Node - first run installs dependencies (a minute)...' }
    }
    else {
      # Docker runtime — check the engine, offer to install Docker Desktop.
      $st = Get-DockerState
      if ($st -eq 'missing') {
        $msg = "Docker Desktop isn't installed.`n`nInstall it now automatically? You'll get a Windows administrator prompt, and it downloads a few hundred MB (a few minutes). The first time, Windows may need a restart to finish."
        $r = [System.Windows.Forms.MessageBox]::Show($msg, 'Install Docker Desktop?',
          [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
        if ($r -ne [System.Windows.Forms.DialogResult]::Yes) {
          $status.Text = 'Docker is required for this mode (or pick Native). Install cancelled.'
          return
        }
        $auto = $true
      }
      $status.Text =
      if ($auto) { 'Installing Docker, then starting - approve the admin prompt and wait...' }
      elseif ($st -eq 'stopped') { 'Starting Docker, then the ceremony...' }
      else { 'Building and starting containers - first run can take several minutes...' }
    }
    $a = @('start')
    if ($rbNative.Checked) { $a += @('-Runtime', 'native') }
    if ($chkLocal.Checked) { $a += '-NoTunnel' }
    if ($auto) { $a += '-AutoInstall' }
    Start-Action 'start' $a
  })

$btnStop.Add_Click({
    $status.Text = 'Stopping containers...'
    Start-Action 'stop' @('stop')
  })

$btnCopy.Add_Click({
    if ($script:link) { Set-Clipboard -Value $script:link; $status.Text = 'Link copied to clipboard.' }
  })

$btnOpen.Add_Click({
    if ($script:link) { Start-Process $script:link }
  })

$form.Add_FormClosing({
    param($sender, $e)
    if ($script:job -and $script:mode -eq 'start') {
      $r = [System.Windows.Forms.MessageBox]::Show(
        'A start is still in progress. Close anyway? (Containers may be left half-built.)',
        'Still working', [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning)
      if ($r -ne [System.Windows.Forms.DialogResult]::Yes) { $e.Cancel = $true }
    }
  })

Set-State 'idle'
[void]$form.ShowDialog()
