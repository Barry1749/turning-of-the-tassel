#!/usr/bin/env node
// Versioned release build for the desktop app.
//   • Forces the version into the build (electron-builder extraMetadata override).
//   • Writes output to desktop/dist_v<version>/  (one folder per version).
//   • If a build with the SAME or a NEWER version already exists, asks before continuing.
//
// Usage (from the desktop/ folder):
//   node release.mjs --win                 # version from package.json
//   node release.mjs --mac
//   node release.mjs --win 1.2.0           # override the version just for this build
//   node release.mjs --win --dry-run       # show what it would do, don't build
// Or via npm:  npm run release:win        (add  -- 1.2.0  to override the version)

import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const platform = argv.find((a) => ['--win', '--mac', '--linux'].includes(a)) || '--win';
const versionArg = argv.find((a) => /^\d+\.\d+\.\d+([-.].+)?$/.test(a));
const version = versionArg || pkg.version;
const outDir = `dist_v${version}`;

// Compare X.Y.Z versions: >0 if a>b, 0 if equal, <0 if a<b.
const parse = (v) => v.split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
const cmp = (a, b) => {
  const x = parse(a), y = parse(b);
  return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
};

// Versions already built (from existing dist_v* folders).
const existing = readdirSync(here, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^dist_v\d+\.\d+\.\d+/.test(d.name))
  .map((d) => d.name.slice('dist_v'.length));
const blocking = existing.filter((v) => cmp(v, version) >= 0).sort(cmp).reverse();

const ask = (q) => new Promise((res) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); res(a); });
});

const main = async () => {
  console.log(`Target version : ${version}${versionArg ? ' (from argument)' : ' (from package.json)'}`);
  console.log(`Output folder  : desktop/${outDir}`);
  if (blocking.length) {
    console.log(`\n!  A build at the same or a newer version already exists: ${blocking.join(', ')}`);
    if (!process.stdin.isTTY) {
      console.log('   Non-interactive shell — continuing.');
    } else {
      const a = await ask('   Build anyway? This overwrites/duplicates that version. (y/N) ');
      if (!/^y(es)?$/i.test(a.trim())) { console.log('Aborted — nothing built.'); process.exit(0); }
    }
  }
  const ebArgs = [platform, `--config.extraMetadata.version=${version}`, `--config.directories.output=${outDir}`];
  if (dryRun) {
    console.log(`\n[dry-run] would run: electron-builder ${ebArgs.join(' ')}`);
    process.exit(0);
  }
  console.log(`\nBuilding v${version} into desktop/${outDir} ...`);
  const r = spawnSync('npx', ['--no-install', 'electron-builder', ...ebArgs], { cwd: here, stdio: 'inherit', shell: true });
  process.exit(r.status ?? 1);
};

main();
