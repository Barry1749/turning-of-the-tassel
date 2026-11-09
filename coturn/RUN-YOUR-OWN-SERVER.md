# Run your own relay server for the ceremony

*A guide for anyone who wants their ceremony's video to run on **their own** server — for example
because the relay built into the app is switched off.*

## What this is, in one minute

The ceremony's video travels **directly between the participants' browsers** (peer-to-peer — no
video service in the middle). But when someone's network is strict (mobile data, campus Wi-Fi, many
home providers), the two browsers can't reach each other directly, and their *encrypted* video has
to be **forwarded by a relay server** (called a TURN server). The relay can't watch the video — it
just forwards packets.

The app ships with a built-in relay, but that's one specific machine someone pays for and keeps
running. If it's off — participants suddenly can't see each other while everything else still
works — you can run **your own relay** and tell the app to use it. Total cost: one tiny cloud
server (free on AWS's first-year tier, or ~US$5/month anywhere else). Time: about 20 minutes.

## Step 1 — Get a small Linux server with a public IP

Any provider works. The smallest size they sell is enough (the relay needs almost no CPU/RAM —
only bandwidth).

- **AWS free tier** (free for 12 months): follow **[AWS-setup.md](AWS-setup.md)** sections A–C —
  it walks through launching an Ubuntu `t3.micro` and, importantly, opening the right ports.
- **Any other VPS** (Hetzner, DigitalOcean, Vultr, Linode…): create the smallest Ubuntu server,
  then open these ports in the provider's firewall:

  | Port | Protocol | What for |
  |------|----------|----------|
  | 3478 | UDP **and** TCP | relay control |
  | 49152–65535 | UDP | the relayed video itself ← **the one people forget** |

Note the server's **public IP address** — you'll use it twice below.

## Step 2 — Start the relay (one paste)

Connect to the server's terminal (AWS: *EC2 → Connect → EC2 Instance Connect*; elsewhere: SSH).

**First, invent your own password** — don't reuse anyone else's. Then paste this whole block,
replacing `CHOOSE_A_PASSWORD` (keep `tassel` as the username, or change it too):

```bash
curl -fsSL https://get.docker.com | sudo sh
mkdir -p ~/coturn && cd ~/coturn
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 120" 2>/dev/null)
PUB=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null)
[ -z "$PUB" ] && PUB=$(curl -s https://api.ipify.org)
PRIV=$(hostname -I | awk '{print $1}')
echo "Public IP: $PUB   Private IP: $PRIV"

cat > turnserver.conf <<EOF
listening-port=3478
min-port=49152
max-port=65535
external-ip=$PUB/$PRIV
lt-cred-mech
realm=tassel.local
user=tassel:CHOOSE_A_PASSWORD
no-cli
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
total-quota=100
stale-nonce=600
fingerprint
EOF

cat > docker-compose.yml <<'EOF'
services:
  coturn:
    image: coturn/coturn:latest
    container_name: tassel-coturn
    network_mode: host
    restart: unless-stopped
    volumes:
      - ./turnserver.conf:/etc/coturn/turnserver.conf:ro
    command: ["-c", "/etc/coturn/turnserver.conf"]
EOF

sudo docker compose up -d
sudo docker compose logs --tail=20
```

The last command should show coturn listening, with no errors. (`restart: unless-stopped` means it
also survives server reboots.)

## Step 3 — Verify it before trusting it

Open **`turn-test.html`** (in the project folder — the desktop app keeps a copy under
`resources\repo\`) in any browser. Paste this into the box, with **your** IP and password, and
click **Run the test**:

```
[{"urls":"stun:YOUR_IP:3478"},{"urls":"turn:YOUR_IP:3478","username":"tassel","credential":"YOUR_PASSWORD"},{"urls":"turn:YOUR_IP:3478?transport=tcp","username":"tassel","credential":"YOUR_PASSWORD"}]
```

You want the green **“TURN RELAY WORKS.”** Red usually means the UDP 49152–65535 firewall rule is
missing, or the password doesn't match.

## Step 4 — Tell the app to use it

The easy way — **no rebuild, mid-ceremony is fine**:

1. Host your ceremony as usual and open the **Master of Ceremony panel**.
2. Click the small **“Video relay · built-in”** line (under *Video quality*).
3. Enter your server's **public IP**, the **username** (`tassel`), and **your password** →
   **Use this relay**.

That's it. The setting is room-wide: **every participant switches automatically** — students,
professors, guests — and if video was stuck, it recovers by itself within a few seconds. The
panel shows *“Video relay · YOUR_IP”* while the override is active; *↺ Built-in* switches back.

The override lasts for the current ceremony (it resets when the host restarts the app). To make
your relay the **permanent default** instead, create (or edit) `.env` at the project root (the
desktop app's copy lives in `resources\repo\.env`; the file is gitignored) with one line,
`VITE_ICE_SERVERS=[...]`, holding your server list — same format as the test box above — then
restart the ceremony.

## Running costs & upkeep

- **Keep the server running** during ceremonies; between events you can stop it. ⚠ On AWS the
  public IP **changes on every stop/start** — and it's baked into coturn's own config too, so a
  changed IP breaks the relay even if the app is told about it. Either attach an **Elastic IP**
  (permanent address, ~$3.6/month) or install the **auto-refresh boot service** — both are in
  [AWS-setup.md](AWS-setup.md) section B. Most non-AWS VPSes have a static IP and don't need this.
- Bandwidth: a relayed participant uses roughly 1 GB/hour. AWS free tier includes 100 GB/month —
  dozens of ceremony-hours.
- Change the password anytime: edit `user=` in `~/coturn/turnserver.conf` on the server, then
  `sudo docker compose restart` — and enter the new password in the app.

## More detail

- [README.md](README.md) — the relay explained, generic-VPS setup, troubleshooting, no-Docker variant.
- [AWS-setup.md](AWS-setup.md) — the AWS console walkthrough (instance, Security Group, Elastic IP).
