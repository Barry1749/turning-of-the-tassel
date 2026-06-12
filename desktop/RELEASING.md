# Building a new version of the desktop app

Your code lives in the repo; **building** turns the current code into the double-click installer.
Build whenever you've changed the code and want a fresh installer to hand out.

```
source code  ──  npm run dist:win  ──▶  desktop/dist/…Setup X.Y.Z.exe
```

## Build it (Windows)

1. **Close the app** — any running or installed copy. (If it's open, the build fails with
   *"Can't open output file"* because the `.exe` it's writing is locked.)
2. Open **PowerShell** and go to the desktop folder:
   ```powershell
   cd path\to\turning_of_the_tassel\desktop
   ```
3. Build:
   ```powershell
   npm run dist:win
   ```
4. Find the output in **`desktop\dist\`**:
   - `Turning of the Tassel Setup X.Y.Z.exe` — the installer
   - `Turning of the Tassel X.Y.Z.exe` — the portable (runs without installing)

`npm install` is only needed the **first** time (or after you change dependencies) — not every build.

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
- `desktop/dist/` and `desktop/node_modules/` are git-ignored, so building never dirties the repo.

## Cheat sheet

```powershell
cd path\to\turning_of_the_tassel\desktop
npm install          # first time only
# set the version (pick one):
npm version 1.2.0 --no-git-tag-version
npm run dist:win     # build installer + portable  ->  desktop\dist\
npm start            # run without building (quick testing)
```
