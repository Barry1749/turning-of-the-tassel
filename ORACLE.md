# Self-hosting LiveKit on Oracle Cloud (Always Free)

Goal: run your **own** LiveKit SFU so a 15–20-camera ceremony is **$0 and uncapped**. The
app doesn't change — you just point `VITE_LIVEKIT_URL` + the keys at your server instead of
LiveKit Cloud.

This is the most involved step (~30–45 min). Paste me any error and I'll help.

## What you need
- An **Oracle Cloud** account — free, but needs a credit card for identity verification
  (**not charged** for Always Free resources).
- A **free domain** — LiveKit needs TLS for `wss://`, which needs a domain (a raw IP can't
  get a certificate). **DuckDNS** gives one instantly for free.

## 1. Create the Always Free VM
1. cloud.oracle.com → sign up. Pick a **home region near your users** (e.g. Tokyo / Osaka /
   Singapore for Asia) — you can't change it later.
2. Compute → Instances → **Create instance**:
   - Image: **Ubuntu 22.04**
   - Shape: **VM.Standard.A1.Flex** (Ampere ARM, *Always Free*) — set **2 OCPU / 12 GB**
     (up to 4 / 24 is free; 2/12 is plenty for an SFU)
   - Add your SSH public key
   - Create, and note the **Public IP**
   > The A1 Always-Free shape includes **10 TB/month** egress — you will never hit it.

## 2. Point a domain at the VM
- duckdns.org → sign in → create a subdomain (e.g. `yourtassel.duckdns.org`) → set its IP
  to your VM's **Public IP**. (Any domain works; DuckDNS is just free and instant.)

## 3. Open the ports — in BOTH places (this is the usual snag)
Oracle blocks ports in two layers:

**a) Cloud firewall** (VCN → Security List → add Ingress rules, or use an NSG):

| Protocol | Port(s) | For |
|---|---|---|
| TCP | 443 | WSS signaling + TURN/TLS |
| TCP | 80 | Let's Encrypt certificate |
| TCP | 7881 | ICE/TCP fallback |
| UDP | 50000–60000 | WebRTC media |
| UDP | 3478 | TURN/UDP |

**b) The VM's own firewall** (Oracle's Ubuntu images also block at the OS). SSH in and:
```bash
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 7881 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 3478 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 50000:60000 -j ACCEPT
sudo netfilter-persistent save     # persist across reboots
```

## 4. Install LiveKit (Docker + automatic TLS)
SSH into the VM, then:
```bash
# Docker
curl -fsSL https://get.docker.com | sudo sh

# LiveKit's config generator — asks for your domain, sets up Caddy + Let's Encrypt TLS,
# and prints your API key + secret
docker run --rm -it -v $PWD:/output livekit/generate
```
Answer the prompts (primary domain = `yourtassel.duckdns.org`; accept the TURN defaults).
It writes `docker-compose.yaml` + configs and prints an **API Key** and **API Secret** —
copy both. Then start it:
```bash
docker compose up -d
```
Caddy fetches a TLS cert automatically (~1 min). Your server is now at
`wss://yourtassel.duckdns.org`.

## 5. Point the app at your server
In your project's **`.env.local`**:
```
VITE_LIVEKIT_URL=wss://yourtassel.duckdns.org
LIVEKIT_API_KEY=<key from step 4>
LIVEKIT_API_SECRET=<secret from step 4>
```
Restart `npm run dev:all` (or redeploy). Same app — now on your free, uncapped server.

## 6. Verify
- Pill shows `LiveKit …` → `LiveKit 1`.
- Test two devices, then a full dry run with everyone before the event.

## Gotchas
- **Black tiles / connects but no video** → almost always the **UDP 50000–60000** range not
  open in *both* the Oracle Security List **and** the VM `iptables`.
- Keep the VM up during the event; Always-Free instances can be reclaimed after long idle —
  spin it up ahead of time.
- `livekit/generate` also embeds a **TURN** server, which covers students on strict networks.
- Debugging: `docker compose logs -f` on the VM. Send me the output and I'll help.
