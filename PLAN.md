# Turning of the Tassel — Remote Graduation Ceremony

A live, multi-party web app (Google-Meet-style) for performing the **turning of the
tassel** (撥穗) graduation ritual for students on exchange abroad who cannot attend in
person. Each participant has a graduation cap pinned to their head via face tracking.
The professor performs a **real hand gesture** (grab → sweep → release) and the selected
student's tassel follows it live, with celebration effects synced to everyone in the room.

## Locked decisions

| Topic | Decision |
|---|---|
| Form factor | Standalone **web app** (no Chrome extension); live multi-party via WebRTC |
| Video transport | Managed **SFU SDK** — **Daily.co** (default) or LiveKit; 6–15 on camera |
| Sync model | Real-time remote; gallery view + **spotlight/zoom** during each turn |
| Student visual | Live webcam + **AR cap** (MediaPipe FaceLandmarker) |
| Tassel control | Professor **hand gesture** (MediaPipe HandLandmarker), **grab → sweep → release** |
| Coupling | Gesture **mapped** (not pixel-pinned) → streamed as a small value → physics tassel |
| Stack | **React + Vite**, `canvas-confetti` + Web Audio; deploy on Vercel/Netlify |
| Timeline | Target **1 week**, hard deadline **2 weeks** |
| Roles | Via join link: `?role=professor` (control panel) vs student / guest (view-only) |

## Architecture

- **Each client face-tracks its own camera**, composites the cap onto a `<canvas>`, and
  publishes that canvas as its video track — so the cap is baked in and everyone sees it.
  (We never face-track other people's compressed video.)
- The **professor client also runs hand tracking**, maps grab + horizontal sweep to a
  tassel angle, and **broadcasts it ~20×/sec (latest-value-wins)** over the data channel.
- The target **student's cap renders the tassel as a damped pendulum**, so it follows the
  sweep and settles naturally on the other side.
- A **ceremony state machine** drives spotlight → countdown → gesture stream → commit → exit.

### Ceremony event protocol (data channel)
```
ceremony:spotlight  { professorId, studentId }   → all clients zoom to those two tiles
ceremony:countdown  { n }                         → dramatic 3-2-1 overlay
tassel:value        { studentId, angle, engaged } → continuous, ~20Hz, lossy/latest-wins
ceremony:commit     { studentId }                 → confetti + cheers fire for everyone
ceremony:exit                                     → back to the gallery
```

## Phase plan

- **Phase 0a** — AR cap prototype (local): webcam + cap on head + confetti + sound.
- **Phase 0b** — gesture prototype (local): your own hand turns your own tassel
  (grab → sweep → release) with physics. *Biggest unknown — de-risk first.*
- **Phase 1** — Daily multi-party gallery (join, grid, names, roles).
- **Phase 2** — bake the AR cap into each published stream.
- **Phase 3** — professor panel + ceremony events + spotlight zoom + gesture value stream
  (professor → student) + synced effects/countdown.
- **Phase 4** — polish: country flag, "Studying at [Univ], [Country]" caption, slow-mo,
  glow, student queue, transitions, photo/lite fallback.
- **Test & deploy** — cross-machine/network, fallbacks, timed dry run.

## Risks & mitigations

- **CPU** (face + hand tracking + N streams): throttle to ~15–20 fps, downscale the
  processing canvas, ship a **Lite mode** (static cap) + **photo fallback**.
- **Gesture jitter / hand leaves frame**: one-euro smoothing, hold last position,
  button fallback to complete the turn.
- **Control-stream latency** (~0.3s): lossy latest-wins + interpolation; the **3-2-1
  countdown** hides the offset so the moment feels synced.
- **Face-tracking wobble** (glasses, lighting): smoothing; park cap at last-known position.
- **Browser**: target **Chrome/Edge desktop**; require camera permission; mobile Safari
  is not supported.
- **Free-tier minutes**: confirm limits and run a timed dry run before the real event.

## Status & setup (updated)

**Built + verified headlessly:** WebSocket control-plane backend, MC panel (reorder /
next / prev / mode toggle / countdown), gallery + spotlight, AR mortarboard rendering,
select → turn → commit → synced confetti/banner, and a clean production build. The Daily
video layer and live-webcam AR + hand gesture are fully built but need a Daily room / a real
camera to validate.

A new **backend control plane** was added (the MC requirement): `server/index.js` owns the
ordered roster, spotlight, mode, countdown, and relays the host's tassel-angle stream. Daily
is now purely the media plane. The app runs in **local mode** with no Daily account.

Run: `npm install` then `npm run dev:all` (web `:5173`, server `:3001`). See
[README.md](README.md) for roles, local multi-tab testing, and Daily setup.

**Still needed from you:**
- A free **Daily** room URL for real multi-party video (paste on join, or `VITE_DAILY_ROOM_URL`).
- A webcam test of the AR cap + the hand gesture.
