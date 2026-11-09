# Your own STUN/TURN relay (coturn) — no third-party service

The ceremony's video is **peer-to-peer** (browser → browser). When a participant is behind a
**symmetric NAT / CGNAT** (mobile data, many home ISPs — including most Taiwan connections), the two
browsers can't open a direct path and their *already-encrypted* media has to be **forwarded by a
relay**. This runs that relay on **your own server**, so no outside service is ever involved.

**You need:** a small Linux VPS with a **public IP** (e.g. Hetzner, DigitalOcean, Vultr, Linode —
about US$4–6/month, the smallest size is plenty).

---

## 1. Put these two files on the VPS
Copy `turnserver.conf` and `docker-compose.yml` from this folder to the VPS, e.g. into `~/coturn/`.
Install Docker if needed: `curl -fsSL https://get.docker.com | sh`

## 2. Edit two lines
In `turnserver.conf`, set your VPS's public IP:

    external-ip=203.0.113.45        # ← your VPS IP

…and replace the placeholder password `YOUR_TURN_SECRET` with your own random one (e.g. the
output of `openssl rand -hex 16`). Keep it private, and use the same value in steps 5 and 6:

    user=tassel:YOUR_TURN_SECRET    # ← your own password

## 3. Open the firewall
Open these in **both** your VPS provider's firewall panel **and** the OS firewall (`ufw`, if on):

| Port | Proto | Purpose |
|------|-------|---------|
| 3478 | UDP + TCP | STUN / TURN |
| 49152–65535 | UDP | media relay range |
| 5349 | UDP + TCP | TURN over TLS (optional) |

`ufw` example:

    sudo ufw allow 3478
    sudo ufw allow 5349
    sudo ufw allow 49152:65535/udp

## 4. Start it

    cd ~/coturn
    docker compose up -d
    docker compose logs --tail=30          # should list listeners and show NO errors

## 5. Verify it works — before any ceremony
Open **`turn-test.html`** (in the repo root) in a browser. Paste this into the "Servers to test"
box, with **your** VPS IP swapped in, and click **Run the test** — you want the green
**"TURN RELAY WORKS"**. Have a remote participant run the same test on their network too.

    [
      {"urls":"stun:YOUR_VPS_IP:3478"},
      {"urls":"turn:YOUR_VPS_IP:3478","username":"tassel","credential":"YOUR_TURN_SECRET"},
      {"urls":"turn:YOUR_VPS_IP:3478?transport=tcp","username":"tassel","credential":"YOUR_TURN_SECRET"}
    ]

## 6. Point the app at your relay
**No-rebuild way (works mid-ceremony):** in the app's Master-of-Ceremony panel open
**“Video relay”**, enter the server's public IP + username + password, and click *Use this relay* —
every participant switches automatically. See [RUN-YOUR-OWN-SERVER.md](RUN-YOUR-OWN-SERVER.md).

**Permanent way:** in the repo-root `.env.local` (one line):

    VITE_ICE_SERVERS=[{"urls":"stun:YOUR_VPS_IP:3478"},{"urls":"turn:YOUR_VPS_IP:3478","username":"tassel","credential":"YOUR_TURN_SECRET"},{"urls":"turn:YOUR_VPS_IP:3478?transport=tcp","username":"tassel","credential":"YOUR_TURN_SECRET"}]

Rebuild / restart the app (`VITE_` vars are inlined at build time). That's it — the video now relays
through **your** server, and the top-bar pill will climb past `P2P 0`.

---

## Troubleshooting

- **Test still red?** Re-check `external-ip` (must be the public IP), the firewall (the 49152–65535
  UDP range is the one people forget), and that the password matches in both places.
- **A participant is on a locked-down 443-only network** (some corporate/campus wifi). Their firewall
  may block 3478 entirely. The fix is TURN-over-TLS on port 443, which needs a domain name + a
  Let's Encrypt cert on the VPS — ask and I'll extend `turnserver.conf` for it.

## Not using Docker?

    sudo apt install coturn
    sudo cp turnserver.conf /etc/turnserver.conf
    sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
    sudo systemctl enable --now coturn
