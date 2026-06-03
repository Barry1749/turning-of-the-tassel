import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // allow tunnel hostnames (cloudflared / ngrok) to reach the dev server
    allowedHosts: true,
  },
});
