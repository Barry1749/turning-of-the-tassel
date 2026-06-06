import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Which ceremony backend the dev server proxies /ws + /token to. Defaults to :3001 (the
// usual `npm run server`), but API_PORT lets a worktree point at its own backend without
// disturbing a :3001 already in use — e.g. `$env:API_PORT='3016'; npm run dev`.
const apiPort = process.env.API_PORT || 3001;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // honor a PORT env var (e.g. from the preview harness); falls back to Vite's default
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    strictPort: !!process.env.PORT,
    // allow tunnel hostnames (cloudflared / ngrok) to reach the dev server
    allowedHosts: true,
    // Expose the ceremony WebSocket server same-origin at /ws, so a single tunnel
    // (or the plain localhost URL) is all anyone needs — no separate server URL.
    proxy: {
      '/ws': { target: `ws://localhost:${apiPort}`, ws: true, changeOrigin: true },
      '/token': { target: `http://localhost:${apiPort}`, changeOrigin: true },
    },
  },
});
