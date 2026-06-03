// Starts a Cloudflare quick tunnel for the web app and prints the share link for remote
// users. The ceremony server is reached through the SAME tunnel at /ws (Vite proxies it),
// so one tunnel is all you need.
//
// Usage: keep `npm run dev:all` running in one terminal, then run `npm run share` in
// another. Requires cloudflared (winget install --id Cloudflare.cloudflared).
import { spawn } from 'node:child_process';

let printed = false;
const procs = [];

const p = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:5173'], { shell: true });
procs.push(p);

const onData = (buf) => {
  const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (m && !printed) {
    printed = true;
    console.log('\n============================================================');
    console.log(' Tunnel is up. SHARE THIS LINK with remote users:\n');
    console.log('   ' + m[0] + '\n');
    console.log(' Keep this window AND your `npm run dev:all` window open.');
    console.log(' (The link changes each time you restart this.)');
    console.log('============================================================\n');
  }
};
p.stdout.on('data', onData);
p.stderr.on('data', onData);
p.on('error', (e) => {
  console.error(`could not start cloudflared: ${e.message}`);
  console.error('Install it with:  winget install --id Cloudflare.cloudflared');
});

console.log('Starting tunnel — make sure `npm run dev:all` is running.');
console.log('This takes ~5–10 seconds…');

function shutdown() {
  procs.forEach((proc) => {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  });
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
