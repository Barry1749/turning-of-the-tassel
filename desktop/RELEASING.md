# Building a new version of the desktop app

Your code lives in the repo; **building** turns the current code into the double-click installer.
Build whenever you've changed the code and want a fresh installer to hand out.

```
source code  ──  npm run release:win  ──▶  desktop/dist_vX.Y.Z/…Setup X.Y.Z.exe
```

## Recommended: versioned build (`release`)

```powershell
cd path\to\turning_of_the_tassel\desktop
npm run release:win
```

This wrapper (`release.mjs`):
- forces the build's version to match `package.json` (`--config.extraMetadata.version`),
- writes the output to its **own folder per version: `desktop\dist_vX.Y.Z\`** (so versions don't overwrite each other),
- and **if a build at the same or a newer version already exists, asks before continuing** — so you
  can't clobber an existing version by accident.

To build a specific version without editing `package.json`, pass it through:
```powershell
npm run release:win -- 1.2.0
```
Add `-- --dry-run` to see what it would do without building. macOS: `npm run release:mac` (on a Mac).

Before building: **close the app** (any running/installed copy), or the build fails with
*"Can't open output file"* (the `.exe` it's writing is locked).

`npm install` is only needed the **first** time (or after you change dependencies) — not every build.

## Plain build (single `dist/` folder)

If you don't want the per-version folder, `npm run dist:win` builds straight into `desktop\dist\`
(overwriting the previous build, no version check).

## Setting the version number

The version is the `"version"` field in **`desktop/package.json`**. electron-builder uses it for the
output filenames and the app's version metadata. It must be valid **semver** (`MAJOR.MINOR.PATCH`,
e.g. `1.2.0`). Three ways to set it:

**1. Edit the file (simplest, persistent).**
Open `desktop/package.json`, change `"version": "0.1.0"` to e.g. `"0.2.0"`, save, then `npm run dist:win`.

**2. Bump it from the command line (persistent, no git side effects):**
```powershell
npm version 0.2.0 --no-git-tag-version    # updates desktop/package.json only
npm run dist:win
```
(Without `--no-git-tag-version`, npm also makes a git commit + tag — usually not what you want here.)

**3. Override for one build only (doesn't change package.json):**
```powershell
npm run dist:win -- --config.extraMetadata.version=0.2.0
```
The `--` passes the flag through to electron-builder. Good for a quick one-off build.

## Test a change without building

```powershell
npm start
```
Runs the app straight from your current code — instant, no installer. Use it to check a change, then
build when you're happy.

## What a rebuild includes

- Edits to the **desktop app** (`desktop/`) — picked up automatically.
- Edits to the **ceremony UI** (`src/`) or **server** (`server/`) — also included, because the app
  bundles a copy of the project (for Host mode) at build time.

## Gotchas

- **Close the app before building** (the file lock).
- A build that fails once with antivirus/lock noise → just **run it again**.
- The **first** installer build on a *brand-new* machine may need one run as **Administrator**
  (a Windows quirk extracting the signing tool). After one elevated build the cache is warm and
  later builds don't need admin.
- **Per platform:** the Windows installer builds on Windows; the macOS `.dmg` builds **on a Mac**
  with `npm run dist:mac`.
- `desktop/dist/`, `desktop/dist_v*/`, and `desktop/node_modules/` are git-ignored, so building never dirties the repo.

## Cheat sheet

```powershell
cd path\to\turning_of_the_tassel\desktop
npm install                              # first time only
npm version 1.2.0 --no-git-tag-version   # set the version
npm run release:win                      # build -> desktop\dist_v1.2.0\  (asks if that version exists)
# one-off without editing package.json:
npm run release:win -- 1.2.0
npm start                                # run without building (quick testing)
```
