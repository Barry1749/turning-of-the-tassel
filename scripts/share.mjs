// Starts a Cloudflare quick tunnel for the web app and prints the host (Master of Ceremony)
// console link. The ceremony server is reached through the SAME tunnel at /ws (Vite proxies it),
// so one tunnel is all you need. The host link now carries a secret per-restart token (read from
// the .host-token.local file the server writes), so the bare URL is locked — only this link opens
// the MC console. Participants each get their own ?t=… link from the MC panel.
//
// Usage: keep `npm run dev:all` running in one terminal, then run `npm run share` in
// another. Requires cloudflared (winget install --id Cloudflare.cloudflared).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

let printed = false;
const procs = [];

// Which local port to expose. Defaults to the dev server (5173); pass another port
// (e.g. `node scripts/share.mjs 4173`) to tunnel the `vite preview` release build instead.
const port = process.argv[2] || '5173';
const p = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], { shell: true });
procs.push(p);

// Read the secret host token the server wrote on startup, so we can print a complete, ready-to-open
// MC link. If it isn't there yet (server still starting, or run without it), fall back to the bare
// tunnel URL and point at the server log.
function readHostToken() {
  try {
    return readFileSync('.host-token.local', 'utf8').trim();
  } catch {
    return '';
  }
}

const onData = (buf) => {
  const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (m && !printed) {
    printed = true;
    const base = m[0];
    const token = readHostToken();
    const hostLink = token ? `${base}/?t=${token}` : base;
    console.log('\n============================================================');
    console.log(' Tunnel is up. This is the HOST (Master of Ceremony) console:\n');
    console.log('   ' + hostLink + '\n');
    if (token) {
      console.log(' Open it yourself to run the ceremony. It carries your secret host');
      console.log(' token (new every restart), so the bare URL is locked — opening the');
      console.log(' link without it just shows "this link isn\'t valid". Invite people');
      console.log(' with the per-person ?t=… links in the MC panel.\n');
    } else {
      console.log(' Append your host token (printed in the server log above) as ?t=…');
      console.log(' to open the MC console. Invite people with the per-person ?t=… links.\n');
    }
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
