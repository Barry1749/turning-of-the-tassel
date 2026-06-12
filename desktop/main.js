'use strict';
// Electron main process for the "Turning of the Tassel" desktop app.
//
//   Chooser window  ->  Host (run the ceremony) | Join (open an invite link)
//
// Why Electron: P2P video is WebRTC (getUserMedia + RTCPeerConnection), which needs a Chromium
// engine. Electron bundles Chromium, so camera + the P2P mesh work exactly like Chrome.
//
// Host mode reuses the verified launcher scripts (scripts/ceremony.ps1 / ceremony.sh) so the app
// and the command-line / one-click launchers all run the ceremony the same way. Join mode just
// loads the public invite link in a window with camera access granted.

const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const isWin = process.platform === 'win32';
// In a packaged build the repo is bundled under resources/repo (see build.extraResources);
// in dev (`npm start` inside the project) it's the parent folder.
const repoRoot = app.isPackaged ? path.join(process.resourcesPath, 'repo') : path.join(__dirname, '..');

// Absolute path to powershell.exe so spawning never depends on PATH (a bare 'powershell.exe' can
// fail with ENOENT in a packaged app). bash on macOS/Linux is reliably on PATH.
const POWERSHELL = isWin
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : null;
const PS1 = path.join(repoRoot, 'scripts', 'ceremony.ps1');
const SH = path.join(repoRoot, 'scripts', 'ceremony.sh');

// Last-resort guard: surface a stray main-process error as a status line instead of Electron's
// default crash dialog. Real failures are also handled at each spawn via an 'error' listener.
process.on('uncaughtException', (err) => {
  try { console.error('uncaughtException:', err); sendStatus('Something went wrong: ' + (err && err.message)); } catch { /* ignore */ }
});

let chooserWin = null;
let appWin = null;     // the host console / join window
let hostProc = null;   // the `ceremony start` child (exits after printing the link; the stack stays up)
let hosting = false;

// Grant the permissions the ceremony needs to our own windows; deny everything else.
// 'media' = camera/mic for the video call. The clipboard ones let the MC panel's copy-link
// buttons work: navigator.clipboard.writeText is gated by 'clipboard-sanitized-write' in
// Electron, so without this the copy buttons silently fail in the app (they work in a browser
// because Chrome auto-grants it on a user gesture).
function configurePermissions() {
  const ses = session.defaultSession;
  const ALLOW = new Set(['media', 'clipboard-sanitized-write', 'clipboard-read']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOW.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOW.has(permission));
}

function createChooser() {
  chooserWin = new BrowserWindow({
    width: 780,
    height: 600,
    resizable: true,
    title: 'Turning of the Tassel',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  chooserWin.loadFile(path.join(__dirname, 'renderer', 'chooser.html'));
  chooserWin.on('closed', () => { chooserWin = null; });
}

// A freshly-started cloudflare tunnel often prints its URL a few seconds before it actually
// routes, so the first navigation can fail and leave a blank window. Retry on main-frame load
// failure until it comes up (covers ~tunnel warmup + a slow server boot).
function loadUrlWithRetry(win, url, attempts) {
  if (!win || win.isDestroyed()) return;
  win.loadURL(url).catch(() => { /* did-fail-load handles it */ });
  win.webContents.once('did-fail-load', (_e, code, _desc, _failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3 /* ERR_ABORTED: superseded navigation */ || win.isDestroyed()) return;
    if (attempts > 0) {
      const html = '<body style="font:16px/1.5 sans-serif;padding:2rem;color:#666;background:#fff">Connecting to the ceremony… (retrying)</body>';
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      setTimeout(() => loadUrlWithRetry(win, url, attempts - 1), 2000);
    } else {
      const html = '<body style="font:16px/1.5 sans-serif;padding:2rem;color:#666;background:#fff">Could not reach the ceremony. Close this window and press Start again.</body>';
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    }
  });
}

function openAppWindow(url, title) {
  if (appWin && !appWin.isDestroyed()) { loadUrlWithRetry(appWin, url, 10); appWin.focus(); return; }
  appWin = new BrowserWindow({
    width: 1200,
    height: 820,
    title: title || 'Turning of the Tassel',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  loadUrlWithRetry(appWin, url, 10);
  appWin.on('closed', () => { appWin = null; if (chooserWin && !chooserWin.isDestroyed()) chooserWin.show(); });
}

function sendStatus(msg) {
  if (chooserWin && !chooserWin.isDestroyed()) chooserWin.webContents.send('status', msg);
}

// --- Join: open an invite link ---
ipcMain.handle('join', (_e, url) => {
  url = (url || '').trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Paste a full link starting with https://' };
  openAppWindow(url, 'Ceremony');
  if (chooserWin && !chooserWin.isDestroyed()) chooserWin.hide();
  return { ok: true };
});

// Build + spawn a ceremony command (start / stop) with the right interpreter for this OS, using the
// absolute powershell path, and ALWAYS attach an 'error' listener so a launch failure (e.g. spawn
// ENOENT, which surfaces asynchronously) is reported as a status line instead of crashing the
// main process with an "Uncaught Exception" dialog.
function spawnCeremony(o, spawnOpts = {}) {
  let cmd, args;
  if (isWin) {
    cmd = POWERSHELL;
    args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, o.action];
    if (o.action === 'start') {
      if (o.autoInstall) args.push('-AutoInstall');
      if (o.runtime === 'native') args.push('-Runtime', 'native');
      if (o.local) args.push('-NoTunnel');
    }
  } else {
    cmd = 'bash';
    args = [SH, o.action];
    if (o.action === 'start') {
      if (o.autoInstall) args.push('--auto-install');
      if (o.runtime === 'native') args.push('--native');
      if (o.local) args.push('--local');
    }
  }
  const child = spawn(cmd, args, { cwd: repoRoot, ...spawnOpts });
  child.on('error', (err) => sendStatus('Could not run the ceremony helper: ' + (err && err.message)));
  return child;
}

// --- Host: run the ceremony via the launcher scripts, then load the MC link ---
ipcMain.handle('host', (_e, opts) => {
  if (hosting) return { ok: false, error: 'Already running.' };
  const runtime = opts && opts.runtime === 'native' ? 'native' : 'docker';
  const local = !!(opts && opts.local);

  hosting = true;
  sendStatus(`Starting ${runtime}${local ? ' (local only)' : ' (public link)'} — first run can take a few minutes...`);

  let buf = '';
  let opened = false;
  hostProc = spawnCeremony({ action: 'start', runtime, local, autoInstall: true });
  hostProc.on('error', () => { hosting = false; });   // baseline handler already reported it
  const onData = (d) => {
    const text = d.toString();
    buf += text;
    text.split(/\r?\n/).forEach((line) => { if (line.trim()) sendStatus(line.trim()); });
    if (!opened) {
      const m = buf.match(/MCLINK=(\S+)/);
      if (m) {
        opened = true;
        sendStatus('Ready: ' + m[1]);
        openAppWindow(m[1], 'MC Console');
        if (chooserWin && !chooserWin.isDestroyed()) chooserWin.hide();
      }
    }
  };
  if (hostProc.stdout) hostProc.stdout.on('data', onData);
  if (hostProc.stderr) hostProc.stderr.on('data', onData);
  hostProc.on('exit', () => {
    hostProc = null;
    // The `start` script exits after printing the link; the ceremony stack keeps running detached.
    if (!opened) { hosting = false; sendStatus('Startup finished without a link — see the messages above.'); }
  });
  return { ok: true };
});

// Best-effort teardown of a running ceremony (Stop button, and on quit).
function stopCeremony() {
  spawnCeremony({ action: 'stop' }, { detached: true, stdio: 'ignore' }).unref();
}

ipcMain.handle('stop', () => { stopCeremony(); hosting = false; return { ok: true }; });

app.whenReady().then(() => {
  configurePermissions();
  createChooser();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createChooser(); });
});

app.on('before-quit', () => { if (hosting) stopCeremony(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
