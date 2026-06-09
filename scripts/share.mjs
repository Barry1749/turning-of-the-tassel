// Starts a Cloudflare quick tunnel for the web app and prints the host (Master of Ceremony)
// console link. The ceremony server is reached through the SAME tunnel at /ws (Vite proxies it),
// so one tunnel is all you need. The host opens the bare link to run the ceremony; participants
// each get their own ?t=… link from the MC panel — do NOT share the bare link, since anyone who
// opens it becomes the host.
//
// Usage: keep `npm run dev:all` running in one terminal, then run `npm run share` in
// another. Requires cloudflared (winget install --id Cloudflare.cloudflared).
import { spawn } from 'node:child_process';

let printed = false;
const procs = [];

// Which local port to expose. Defaults to the dev server (5173); pass another port
// (e.g. `node scripts/share.mjs 4173`) to tunnel the `vite preview` release build instead.
const port = process.argv[2] || '5173';
const p = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], { shell: true });
procs.push(p);

const onData = (buf) => {
  const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (m && !printed) {
    printed = true;
    console.log('\n============================================================');
    console.log(' Tunnel is up. This is the HOST (Master of Ceremony) console:\n');
    console.log('   ' + m[0] + '\n');
    console.log(' Open it yourself to run the ceremony. Do NOT share this bare');
    console.log(' link — anyone who opens it becomes the host. To invite people,');
    console.log(' use the per-person link buttons in the MC panel to copy each');
    console.log(' guest / student / professor their own ?t=… link.\n');
    console.log(' Keep the web + api servers running while this tunnel is up.');
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

console.log(`Starting tunnel for http://localhost:${port} — make sure the web server is running.`);
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
