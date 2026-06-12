# Turning of the Tassel — Desktop app (Electron)

A double-click desktop app for Windows and macOS that can **host** a ceremony or **join** one with an
invite link. It's built on Electron (Chromium), so the camera and the peer-to-peer (WebRTC) video work
exactly like they do in Chrome.

> Mobile participants don't need this — they open their invite link in the phone's browser. An app user
> and a browser user connect to each other peer-to-peer just fine.

## Run from source (dev)

```bash
cd desktop
npm install        # downloads Electron (~150 MB) the first time
npm start          # opens the chooser window
```

- **Host** → pick Docker or Native, optionally "Local only", click *Start hosting*. It runs the same
  `scripts/ceremony.*` launchers as everything else, then opens the MC console and shows the share link.
- **Join** → paste an invite link, click *Join*. The camera turns on with the cap.

## Build installers (unsigned)

```bash
npm run dist:win    # Windows: NSIS installer + portable .exe  (build on Windows)
npm run dist:mac    # macOS: .dmg + .zip                       (build on a Mac)
```

Output lands in `desktop/dist/`. Builds are produced per-OS (Windows on Windows, Mac on a Mac).

### Notes
- **Unsigned for now.** First launch shows a publisher warning: on Windows click *More info → Run anyway*;
  on macOS right-click the app → *Open* (once). Add an Apple Developer ID later to notarize and remove this.
- **macOS camera** needs the usage strings (already set in `build.mac.extendInfo`) and, for a clean prompt,
  a signed/notarized build. Unsigned, you may have to allow the camera in System Settings → Privacy.
- **Host mode** shells out to the bundled `scripts/ceremony.*`, which auto-install Docker or Node if missing
  (one admin prompt). The whole project is bundled into the app's resources so this works when packaged.
