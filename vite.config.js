import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // allow tunnel hostnames (cloudflared / ngrok) to reach the dev server
    allowedHosts: true,
    // Expose the ceremony WebSocket server same-origin at /ws, so a single tunnel
    // (or the plain localhost URL) is all anyone needs — no separate server URL.
    proxy: {
      '/ws': { target: 'ws://localhost:3001', ws: true, changeOrigin: true },
      '/token': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
