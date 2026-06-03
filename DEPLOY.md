# Deploying for the real ceremony

Three pieces:

| Piece | Host | Gives you |
|---|---|---|
| Web app (Vite build) | **Vercel** | the HTTPS site everyone opens |
| WebSocket control server | **Render** | the WSS server the app syncs through |
| Video | **Daily** | live multi-party video |

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

> **Free-tier note:** the free instance **sleeps after ~15 min idle** (first connection then
> takes ~30–60s to wake) and **resets the in-memory roster on restart**. For a real event,
> open the server URL a few minutes beforehand to wake it, set up the roster at the start,
> and keep at least one person connected. For zero cold-starts, use a paid instance.

## 2. Web app → Vercel

1. [vercel.com/new](https://vercel.com/new) → import your repo. It auto-detects **Vite**.
2. **Environment Variables:**
   - `VITE_WS_URL` = `wss://tassel-server.onrender.com` ← your Render URL from step 1
   - *(optional)* `VITE_DAILY_ROOM_URL` = your Daily room URL (step 3)
3. Deploy. You'll get `https://<your-app>.vercel.app`.

> If you change env vars later, **redeploy** — Vite bakes them in at build time.

## 3. Video → Daily

1. [daily.co](https://www.daily.co) → free account → create a **room** (set privacy to **public**).
2. Either set `VITE_DAILY_ROOM_URL` in Vercel (step 2) or just paste the room URL on the
   join screen each time.

---

## Running the ceremony

Everyone opens the **Vercel URL** and picks a role:

- **Professor** — on a laptop with a webcam; performs the tassel gesture. Allow the camera.
- **Master of Ceremony** — on a phone; drives the program (sequence, next, mode). No camera needed.
- **Students** — join with the **same name as on the program** so they can be spotlighted.
- **Guests** — watch only.

With the same Daily room, everyone sees live video; the professor's grab → sweep → release
turns the spotlighted student's tassel, synced to all, with confetti.

**Do a full dry run** a day before — wake the Render server, check each role on its real
device, and confirm the camera + gesture on the actual machines.

---

## Quick alternative: tunnel (no deploy)

For a fast cross-device test without deploying, run locally and expose both ports over HTTPS:

```bash
npm run dev:all                      # web :5173, server :3001
# in two more terminals (cloudflared):
cloudflared tunnel --url http://localhost:5173   # -> https web URL
cloudflared tunnel --url http://localhost:3001   # -> https server URL
```

Then open the web tunnel URL with the server tunnel as the WS override:
`https://<web>.trycloudflare.com/?ws=wss://<server>.trycloudflare.com`
(camera works because the tunnel is HTTPS).

---

## Hosting alternatives

- **Web app:** Netlify or Cloudflare Pages work the same way (build `npm run build`, output `dist`, set `VITE_WS_URL`).
- **WS server:** Fly.io or Railway instead of Render. The server only needs Node + a public port and WebSocket support; it reads `PORT` from the environment.
