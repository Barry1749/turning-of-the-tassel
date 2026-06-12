# syntax=docker/dockerfile:1
#
# One image, three roles. docker-compose.yml runs this same image three ways:
#   api    -> node server/index.js        (the WebSocket control server, :3001)
#   web    -> npm run preview             (the built Vite app, :4173, proxies /ws + /token -> api)
#   tunnel -> node scripts/share.mjs 4173 (cloudflared quick tunnel -> public HTTPS link)
#
# `vite preview` needs the dev dependency `vite` at runtime, so this is a single full-deps
# image (no prod-only prune). cloudflared is baked in for the tunnel role.

FROM node:20-bookworm-slim

# cloudflared — only the `tunnel` service uses it, but all three share this image.
# TARGETARCH is provided automatically by BuildKit (amd64 / arm64); cloudflared publishes
# release binaries under exactly those names.
ARG TARGETARCH=amd64
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${TARGETARCH}" \
      -o /usr/local/bin/cloudflared \
 && chmod +x /usr/local/bin/cloudflared \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for layer caching — only re-runs when the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci

# App source, then the production client build.
COPY . .

# Frontend env is baked into the bundle by Vite at build time. Leave VITE_WS_URL EMPTY so the
# client reaches the server same-origin at /ws (the web service proxies it to api) — that's what
# makes a single tunnel enough. Set the LiveKit/Daily vars only to enable the SFU video fallback.
ARG VITE_WS_URL=
ARG VITE_LIVEKIT_URL=
ARG VITE_DAILY_ROOM_URL=
ENV VITE_WS_URL=$VITE_WS_URL \
    VITE_LIVEKIT_URL=$VITE_LIVEKIT_URL \
    VITE_DAILY_ROOM_URL=$VITE_DAILY_ROOM_URL
RUN npm run build

# 3001 = control server (api), 4173 = vite preview (web). The default command is the web role;
# compose overrides it per service.
EXPOSE 3001 4173
CMD ["npm", "run", "preview"]
