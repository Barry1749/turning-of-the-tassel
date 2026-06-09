# Deploying for the real ceremony

Three pieces:

| Piece | Host | Gives you |
|---|---|---|
| Web app (Vite build) | **Vercel** | the HTTPS site everyone opens |
| WebSocket control server | **Render** | the WSS server the app syncs through |
| Video | **built-in P2P** (optional LiveKit SFU / Daily) | live multi-party video |

Everything is in one repo. The web app and the server deploy as **two separate services**
from it.

> **Prerequisite:** push this repo to GitHub (Vercel/Render deploy from a Git repo):
> ```bash
> # create an empty repo on github.com first, then:
> git remote add origin https://github.com/<you>/turning_of_the_tassel.git
> git push -u origin main
> ```
> (Or with the GitHub CLI: `gh repo create turning_of_the_tassel --private --source . --push`.)

---

## 1. WebSocket server → Render (do this first — you'll need its URL)

1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Web Service** → connect your repo.
2. Settings:
   - **Root Directory:** `server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
3. Create. You'll get a URL like `https://tassel-server.onrender.com`.
   The WebSocket URL is the **same host with `wss://`** → `wss://tassel-server.onrender.com`.

   *(Shortcut: this repo includes `render.yaml`, so you can instead use **New → Blueprint**.)*

4. *(optional — only if you want the LiveKit SFU fallback, see step 3)* under **Environment**, add
   `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`. The server signs LiveKit join tokens at `/token`
   with these and will auto-promote the room to the SFU once it outgrows the P2P mesh.

> **Free-tier note:** the free instance **sleeps after ~15 min idle** (first connection then
> takes ~30–60s to wake) and **resets the in-memory roster on restart**. For a real event,
> open the server URL a few minutes beforehand to wake it, set up the roster at the start,
> and keep at least one person connected. For zero cold-starts, use a paid instance.

## 2. Web app → Vercel

1. [vercel.com/new](https://vercel.com/new) → import your repo. It auto-detects **Vite**.
2. **Environment Variables:**
   - `VITE_WS_URL` = `wss://tassel-server.onrender.com` ← your Render URL from step 1 (required)
   - *(optional — LiveKit SFU)* `VITE_LIVEKIT_URL` = `wss://your-livekit-host` — turns on the SFU
     fallback. Set this **and** the matching keys on Render (step 1, item 4); both are needed.
   - *(optional — Daily)* `VITE_DAILY_ROOM_URL` = your Daily room URL. Used only when LiveKit
     isn't configured (step 3).
3. Deploy. You'll get `https://<your-app>.vercel.app`.

> If you change env vars later, **redeploy** — Vite bakes them in at build time.

## 3. Video — P2P by default, LiveKit/Daily optional

Video is **peer-to-peer by default — nothing to configure.** Everyone's cameras connect directly
in a mesh, which is fine for a small group. There are two optional upgrades for bigger rooms:

- **LiveKit SFU (recommended for large ceremonies).** Set `VITE_LIVEKIT_URL` on Vercel (step 2)
  **and** `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` on Render (step 1, item 4). The server then runs
  a **hybrid**: the room starts on the free P2P mesh and the server **auto-promotes the whole room
  to the SFU** once the headcount outgrows the mesh (~6 participants), so everyone flips together.
  You can use **LiveKit Cloud** or self-host your own server for $0/uncapped — step-by-step in
  **[ORACLE.md](ORACLE.md)** (and see [Free uncapped video](#free-uncapped-video-for-a-large-ceremony-self-hosted-livekit) below).
- **Daily (alternative, only when LiveKit isn't configured).** [daily.co](https://www.daily.co) →
  free account → create a **room** (privacy **public**). Set `VITE_DAILY_ROOM_URL` in Vercel
  (step 2), or paste the room URL via the `?room=` link param. Used as the transport only when
  `VITE_LIVEKIT_URL` is unset.

---

## Running the ceremony

There's no role picker any more. **Who you are is decided by the link you open**, and the server —
not the URL — resolves it, so a join link can't be edited to change someone's role or name:

- **Master of Ceremony** — opens the **bare Vercel URL** (no token). That *is* the host console:
  on a phone is fine, no camera. The MC builds the roster in the panel (add people, or Import a CSV)
  and shares a join link per person with the 🔗 buttons, plus one shared guest link.
- **Professor** — opens their **personal link** (the 🔗 next to their name). Laptop with a webcam;
  performs the tassel gesture (or toggles it off and turns manually). Allow the camera.
- **Students** — open their **own personal link**. Their name and degree (tassel colour) are already
  set by the MC, so they're spotlighted correctly — no name entry on their end.
- **Guests** — open the **shared guest link** (the 🔗 guest link button). Watch only; counted, not
  listed.

Editing any participant link invalidates its token and shows a "this invite link isn't valid" screen,
so links can't be tampered with or guessed. The MC can also **⬇ Download** a CSV of everyone's name,
role and personal link to mail-merge the invites.

Everyone sees live video (P2P, or the LiveKit SFU once the room is big enough); the professor's
grab → sweep → release turns the spotlighted student's tassel, synced to all, with confetti.

**Do a full dry run** a day before — wake the Render server, open the MC console and a couple of the
per-person links on their real devices, and confirm the camera + gesture on the actual machines.

---

## Quick alternative: tunnel (no deploy)

For a fast run with remote users without deploying. Requires cloudflared
(`winget install --id Cloudflare.cloudflared`).

**One command** (recommended) — runs web + server + tunnel together:

```bash
npm run dev:share      # dev server + api + tunnel, prints the share link
npm run prod:share     # same, but serves the release build (vite build → preview)
```

Or run the pieces in **two terminals** if you prefer:

```bash
npm run dev:all     # terminal 1: web :5173 + server :3001
npm run share       # terminal 2: starts ONE tunnel, prints the share link
```

Either way, cloudflared prints **one** link like `https://<web>.trycloudflare.com`. That link is
the **MC (host) console** — open it yourself to run the ceremony. **Don't share the bare link**;
anyone who opens it becomes the host. Invite people with the per-person 🔗 links from the MC panel
(and the shared guest link). One tunnel is all you need: the dev/preview server proxies `/ws` and
`/token` to the backend, so there's no separate server URL and **no `VITE_WS_URL`** for tunnel/local
use — the per-person links already carry the right backend.

(Manual equivalent: `cloudflared tunnel --url http://localhost:5173`, then share that URL. For the
release build the preview server is pinned to `:4173` — `prod:share` tunnels that port.)

> Tunnel URLs are random and change on every restart, so re-share the links each session.
> For video over a tunnel: set `VITE_LIVEKIT_URL` (+ `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`) for
> the LiveKit SFU, or `VITE_DAILY_ROOM_URL` for Daily, in `.env.local` (then restart). With neither
> set, video stays on the built-in P2P mesh.

---

## Free uncapped video for a large ceremony (self-hosted LiveKit)

For 15–20+ cameras with no per-minute caps, run your own LiveKit SFU on a free Oracle Cloud
"Always Free" VM. Step-by-step in **[ORACLE.md](ORACLE.md)**. The app is unchanged — you just
set `VITE_LIVEKIT_URL` + `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` to your server.

## Hosting alternatives

- **Web app:** Netlify or Cloudflare Pages work the same way (build `npm run build`, output `dist`, set `VITE_WS_URL`).
- **WS server:** Fly.io or Railway instead of Render. The server only needs Node + a public port and WebSocket support; it reads `PORT` from the environment.
