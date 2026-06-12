import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Which ceremony backend the dev server proxies /ws + /token to. Defaults to localhost:3001
// (the usual `npm run server`). API_PORT lets a worktree point at its own backend without
// disturbing a :3001 already in use — e.g. `$env:API_PORT='3016'; npm run dev`. API_HOST lets
// the web server reach the backend on a different host — e.g. `API_HOST=api` when the control
// server runs in a separate Docker container (see docker-compose.yml).
const apiHost = process.env.API_HOST || 'localhost';
const apiPort = process.env.API_PORT || 3001;

// Expose the ceremony WebSocket server same-origin at /ws (and /token for LiveKit), so a
// single tunnel (or the plain localhost URL) is all anyone needs — no separate server URL.
// Shared by BOTH the dev server and `vite preview`, so the release build (`npm run preview`)
// reaches the backend exactly like dev does — no VITE_WS_URL baked in at build time required.
const proxy = {
  '/ws': { target: `ws://${apiHost}:${apiPort}`, ws: true, changeOrigin: true },
  '/token': { target: `http://${apiHost}:${apiPort}`, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // honor a PORT env var (e.g. from the preview harness); falls back to Vite's default
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    strictPort: !!process.env.PORT,
    // allow tunnel hostnames (cloudflared / ngrok) to reach the dev server
    allowedHosts: true,
    proxy,
  },
  // `vite preview` serves the built dist/ (the release bundle). It needs the same proxy +
  // host/allowedHosts as dev so the release build works behind the quick tunnel just like
  // `npm run dev`. Pinned to 4173 so `npm run share` can tunnel a known port.
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
    allowedHosts: true,
    proxy,
  },
});
