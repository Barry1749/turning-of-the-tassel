# 🎓 Turning of the Tassel

A live, multi-party web app for performing the **turning of the tassel** (撥穗) graduation
ritual for students on exchange abroad. Everyone joins a Google-Meet-style room with a
graduation cap pinned to their head via face tracking. The **Master of Ceremony / Professor**
sequences the program, switches the room into ceremony mode, and performs a real hand
gesture (grab → sweep → release) that turns the spotlighted student's tassel live — with
confetti and a fanfare synced to everyone.

See [PLAN.md](PLAN.md) for the full design.

## Architecture — control plane + media plane

- **Backend** (`server/index.js`, Node + `ws`) = **control plane**: owns the ordered roster,
  the spotlighted student, the mode (`normal`/`ceremony`), the 3-2-1 countdown, and relays
  the host's live tassel-angle stream. Broadcasts authoritative state to all clients.
- **Frontend** (React + Vite) = the clients. Each one composites its **own** camera + cap
  into a canvas (the cap is baked into the outgoing video). The host additionally runs hand
  tracking and streams the gesture.
- **Daily.co** (optional) = **media plane** (real multi-party video). With no room URL the
  app runs in **local mode** — your own tile is live; others show as name cards.

## Run

```bash
npm install
npm run dev:all      # web on http://localhost:5173, ceremony server on ws://localhost:3001
```

Open **http://localhost:5173** in Chrome/Edge. (You can also run the two separately:
`npm run server` and `npm run dev`.)

## Roles

The MC and the Professor can be **two different devices** (e.g. MC on a phone, Professor on a
laptop with a webcam):

- **Master of Ceremony** (`mc`) — control panel only: build the program (add/remove students
  **and professors**, share each person's join link), sequence it, next/prev, mode, countdown.
  **No camera needed — runs fine on a phone.**
- **Professor** (`professor`) — the camera device that performs the **hand gesture** (plus the
  manual/commit fallback). Only this device runs hand tracking.
- **Professor + MC** (`host`) — both jobs on one device (solo case).
- **Student** (graduating) — appears with an AR cap; spotlighted on their turn. Use the
  **same name as on the program** so the MC can match you.
- **Guest** — watch only, no camera.

## Try it locally right now (no accounts, no Daily)

Open a few browser tabs to http://localhost:5173:

- Tab 1 → join as **Host**.
- Tab 2+ → join as **Student**, name matching a program entry (e.g. `Wei Kang`).

All tabs share ceremony state through the backend. The host can reorder the program, switch
to **Ceremony**, pick a student, and hit **Turn (manual)** or use the hand gesture. In local
mode you won't see each other's video (others are name cards), but mode, spotlight, tassel
motion, countdown, and confetti all sync live.

## Real multi-party video (Daily)

1. Create a free **Daily** account → make a room (set it **public** for dev) → copy the room URL.
2. Paste it into the **Daily room URL** field when joining (or set `VITE_DAILY_ROOM_URL`).

Everyone who joins with the same room URL shares live video; each person's cap is baked into
their own published stream.

## The tassel gesture (host)

In **Ceremony** mode, enable **Use hand gesture** in the MC panel. Pinch (thumb + index) to
grab, sweep **right → left**, and release on the left to graduate the student. **Turn
(manual)** is the always-available fallback.

## Config (env vars)

- `VITE_WS_URL` — backend WebSocket URL (default `ws://<host>:3001`).
- `VITE_DAILY_ROOM_URL` — a default Daily room URL.

## Deploy (for the real event)

For a durable hosted version — web app on **Vercel**, WebSocket server on **Render**, video
via **Daily** — see **[DEPLOY.md](DEPLOY.md)**. In production set `VITE_WS_URL` to your
deployed `wss://` server URL.

## Notes

- Use **Chrome / Edge desktop** and allow the camera. A student with no camera still appears
  as a name card (with the cap) — this doubles as the photo/lite fallback.
- **Flag emoji** show as 2-letter codes on **Windows** (Windows ships no flag glyphs) — purely
  cosmetic; they render as flags on macOS/iOS/Android.
- The sample roster lives in memory and **resets when the server restarts**.

## Status

- ✅ Backend control plane (roster / order / mode / countdown / gesture relay / commit)
- ✅ MC control panel (reorder, add/remove, next/prev, mode toggle, countdown, turn/commit)
- ✅ Gallery (normal) + Spotlight (ceremony) with captions & flags
- ✅ AR cap compositor + self-stream + name-card fallback
- ✅ Grab→sweep→release gesture logic + manual fallback + synced confetti/fanfare
- ✅ Daily media-plane integration (code-split, opt-in via room URL)
- ⬜ Validate live-webcam AR + hand gesture on real hardware
- ⬜ Validate Daily multi-party with a real room; deploy + dry run
