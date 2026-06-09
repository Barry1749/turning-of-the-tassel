# 🎓 Turning of the Tassel

A live, multi-party web app for performing the **turning of the tassel** (撥穗) graduation
ritual — built for students graduating on exchange abroad. Everyone joins a Google-Meet-style
room with a 3D graduation cap pinned to their head by face tracking. The **Master of Ceremony**
runs the program from a control panel; a **Professor** performs a real hand gesture
(grab → sweep → release) that turns the spotlighted student's tassel live — with confetti and a
fanfare synced to everyone in the room.

This README is the **user guide**: how to start it, share links, and run a ceremony. For the
system design see [PLAN.md](PLAN.md); for a hosted production deploy see [DEPLOY.md](DEPLOY.md).

---

## 1. One-time setup

You need [Node.js](https://nodejs.org) (v18+). Then, in the project folder:

```bash
npm install
```

That's it — installed once.

---

## 2. Starting the app

There are four ways to run it. Pick based on **(a)** dev vs. release and **(b)** whether you
need a link other devices/phones can open.

| | **Local only** (this computer) | **+ public link** (phones, remote people) |
|---|---|---|
| **Development** (live code, for editing) | `npm run dev:all` | `npm run dev:share` |
| **Release** (optimized build, for the event) | `npm run prod` | `npm run prod:share` |

- **`npm run dev:all`** — runs the web app (http://localhost:5173) + the ceremony server together. Best while developing.
- **`npm run dev:share`** — same, plus a **Cloudflare tunnel** that prints a public `https://…trycloudflare.com` link.
- **`npm run prod`** — builds the optimized bundle, then serves it (http://localhost:4173) + the server. This is what you'd use for the real event locally.
- **`npm run prod:share`** — the release build **plus** the public tunnel link. **One command to run a real ceremony for remote guests.**

> **Phones need the public link.** Browsers only allow the camera on `https://` (or
> `localhost`). A phone opening your computer's LAN address over plain `http://` will be blocked.
> Use `dev:share` / `prod:share` (or a real deploy) so everyone gets an HTTPS link.

Whichever `*:share` command you run, watch for this banner in the terminal:

```
============================================================
 Tunnel is up. This is the HOST (Master of Ceremony) console:

   https://random-words-here.trycloudflare.com
============================================================
```

That URL is **your MC console** — open it yourself. **Don't share the bare link** (anyone who
opens it becomes a host). Invite people with the per-person links below.

*(Lower-level scripts also exist if you want them: `npm run dev`, `npm run server`,
`npm run build`, `npm run preview`, `npm run share`.)*

---

## 3. Roles & how people join

There's no role picker. **The link you open decides who you are.**

| Role | How they join | Camera? | What they do |
|---|---|---|---|
| **Master of Ceremony (MC)** | Opens the **bare URL** (no `?t=`) | No — phone-friendly | Builds & runs the program: roster, order, mode, spotlight, countdown |
| **Professor** | Opens their personal `?t=…` link | **Yes** | Performs the hand gesture that turns the tassel |
| **Student** | Opens their personal `?t=…` link | Yes | Appears with an AR cap; spotlighted on their turn |
| **Guest** | Opens the shared guest link | No | Watches only |

The **MC and Professor can be the same person** (open the bare URL on a webcam laptop — you get
both jobs), or two different devices (e.g. MC on a phone, Professor on a laptop).

Each personal link carries a secret **token** that pins that person's name and role on the
server. Editing the link just invalidates it (they'll see *"This invite link isn't valid"*), so
nobody can change their role or impersonate someone by fiddling with the URL.

---

## 4. Run a ceremony (step by step)

Everything below happens in the **MC panel** on the right side of your console.

### a. Name the ceremony
The title in the top bar is editable — click it and type (e.g. *"Class of 2026"*). Press Enter.

### b. Build the program
Add people with the **Add participant** box: type a name, pick a role
(**Bachelor / Master / PhD** for a student, or **Professor**), and click **Add**. The degree
sets the student's **tassel colour** (shown as a coloured dot next to their name).

Got a spreadsheet? Use **Roster · CSV → ⬆ Import**:
- **Column 1** = name, **Column 2** = role (`bachelor` / `master` / `phd` / `professor`).
- A header row is auto-detected and skipped; common spellings (`BSc`, `Masters`, `Ph.D.`, `Prof`…) are understood.
- Re-importing the same file is safe — duplicates are skipped.

Reorder students by dragging the **⠿** handle (works on touch too). Click a student's name to
**spotlight** them. Use the degree dropdown on any row to change their tassel colour.

### c. Share the join links
- Click the **🔗** next to any student or professor to copy **their personal link** — send it to them (WhatsApp, email, etc.).
- Click **🔗 guest link** to copy the one shared **watch-only** link for the audience.
- Or **Roster · CSV → ⬇ Download** to get a `name, role, link` spreadsheet for everyone at once (the guest link is the last row).

### d. Warm up — Gallery mode
The top toggle has **Gallery** and **Ceremony**. Start in **Gallery**: everyone sees each other
in a grid with their caps, like a normal video call.

### e. Perform the ceremony
1. Switch to **Ceremony**. The room focuses on one spotlighted student.
2. Use **◀ Prev / Next ▶** (or click a name) to move through the program in order.
3. For each student, optionally hit **3·2·1** for a synced countdown.
4. **Turn the tassel** — two ways:
   - **Hand gesture (Professor):** tick **Use hand gesture**, then **pinch** (thumb + index) → **sweep right → left** → **release**. The status line shows `✋ hand ready` / `✊ grabbing`.
   - **Manual:** click **Turn (manual)** — always works, no camera needed. Good as the MC's fallback.
5. The tassel turns live for everyone, with **confetti + fanfare** and a congratulations banner.
6. Click **Mark graduated ✓** to tick them off (a ✓ appears by their name).
7. **Reset tassel** re-arms the current student if you want a retake.

### f. Wrap up
**↺ reset all** un-turns everyone and returns the room to Gallery — handy for a rehearsal before
the real run.

---

## 5. Video (how people see each other)

- **Default: peer-to-peer (P2P).** No setup, free, great for small groups (up to ~6 cameras). The top bar shows `P2P 4`.
- **Large ceremonies: LiveKit (optional).** For ~15–20+ cameras, point the app at a LiveKit server and it will **automatically** switch the whole room over once the headcount outgrows the mesh. Setup is in [ORACLE.md](ORACLE.md) (free self-hosted) — set `VITE_LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- **Daily.co (alternative):** if you set a Daily room URL and *don't* use LiveKit, it uses Daily for video.

A student with **no camera** still appears as a name card with their cap — a graceful fallback.

> Want to just see the AR cap on yourself? Open the app with **`?solo=1`** for a no-room demo.

---

## 6. Configuration (env vars)

Optional — the defaults work out of the box for local + tunnel use.

**Frontend** (baked in at build time; set before `npm run build`):
- `VITE_WS_URL` — the deployed backend WebSocket URL for a hosted build, e.g. `wss://your-server.example.com/ws`. *(Not needed for `dev:*` / `prod:*` here — the dev and preview servers proxy `/ws` and `/token` to the backend automatically.)*
- `VITE_LIVEKIT_URL` — your LiveKit server URL (enables the SFU fallback).
- `VITE_DAILY_ROOM_URL` — a default Daily room URL.

**Backend** (read from `.env.local` / `.env`):
- `PORT` — server port (default `3001`).
- `API_PORT` — which backend the dev/preview server proxies to (default `3001`; lets a second copy run without clobbering `3001`).
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — required for LiveKit token signing.

---

## 7. Tips & troubleshooting

- **Use Chrome or Edge** and **allow the camera** when prompted. Desktop is most reliable; phones work for the MC/guest roles and for students on a good connection.
- **Camera blocked on a phone?** You're on `http://` — use a `*:share` command (or a real deploy) so the link is `https://`.
- **"This invite link isn't valid"** — the personal link was edited or the server restarted. The MC should copy a fresh 🔗 link.
- **The roster lives in memory and resets when the server restarts.** Re-import your CSV after a restart. (Links also change, since tokens are regenerated.)
- **Tunnel links are random and change every restart** — re-share the new link each session.
- **Flag emoji show as 2-letter codes on Windows** (Windows ships no flag glyphs) — purely cosmetic; they render as flags on macOS/iOS/Android.

---

## Architecture (in brief)

- **Backend** (`server/index.js`, Node + `ws`) — the **control plane**: owns the ordered roster, the spotlighted student, the mode, the countdown, and relays the host's live tassel-angle stream. It also signs LiveKit join tokens. Pure control + sync; it carries no video.
- **Frontend** (React + Vite) — the clients. Each composites its own camera + 3D cap into a canvas (the cap is baked into the outgoing video). The Professor additionally runs hand tracking and streams the gesture.
- **Video plane** — P2P mesh by default, LiveKit (or Daily) when configured.

## Deploy for the real event

For a durable hosted version (web app + WebSocket server + video) see **[DEPLOY.md](DEPLOY.md)**,
and **[ORACLE.md](ORACLE.md)** for a free self-hosted LiveKit SFU for large ceremonies.
