// Starts two Cloudflare quick tunnels (web + ceremony server) and prints ONE share
// link for remote users — no hunting through cloudflared's logs.
//
// Usage: keep `npm run dev:all` running in one terminal, then run `npm run share`
// in another. Requires cloudflared (winget install --id Cloudflare.cloudflared).
import { spawn } from 'node:child_process';

let webUrl = null;
let serverUrl = null;
let printed = false;
const procs = [];

function startTunnel(label, port) {
  const p = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], { shell: true });
  procs.push(p);
  const onData = (buf) => {
    for (const line of buf.toString().split('\n')) {
      const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (!m) continue;
      if (label === 'web' && !webUrl) {
        webUrl = m[0];
        console.log(`  web    → ${webUrl}`);
      }
      if (label === 'server' && !serverUrl) {
        serverUrl = m[0];
        console.log(`  server → ${serverUrl}`);
      }
      printIfReady();
    }
  };
  p.stdout.on('data', onData);
  p.stderr.on('data', onData);
  p.on('error', (e) => {
    console.error(`\n[${label}] could not start cloudflared: ${e.message}`);
    console.error('Install it with:  winget install --id Cloudflare.cloudflared\n');
  });
  return p;
}

function printIfReady() {
  if (printed || !webUrl || !serverUrl) return;
  printed = true;
  const link = `${webUrl}/?ws=${serverUrl.replace(/^https:/, 'wss:')}`;
  console.log('\n============================================================');
  console.log(' Tunnels are up. SHARE THIS LINK with remote users:\n');
  console.log('   ' + link + '\n');
  console.log(' Keep this window AND your `npm run dev:all` window open.');
  console.log(' (The link changes each time you restart this.)');
  console.log('============================================================\n');
}

console.log('Starting tunnels — make sure `npm run dev:all` is running.');
console.log('This takes ~5–10 seconds…\n');
startTunnel('web', 5173);
startTunnel('server', 3001);

function shutdown() {
  procs.forEach((p) => {
    try {
      p.kill();
    } catch {
      /* ignore */
    }
  });
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
