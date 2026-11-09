# Run your relay on AWS Free Tier (EC2 + coturn)

Free tier (12 months): a `t2.micro`/`t3.micro` for 750 hrs/month + 100 GB/month egress — plenty for
a TURN relay. You launch one tiny Ubuntu server, open the right ports, and run the coturn container.

## A. Launch the instance (AWS Console)
1. **EC2 → Launch instance.**
2. **Name:** `tassel-turn`.
3. **Region** (top-right): pick one near your participants — for Taiwan, **Tokyo (ap-northeast-1)** or **Singapore (ap-southeast-1)**.
4. **AMI:** Ubuntu Server — the newest **LTS** offered (24.04 or 26.04), **64-bit (x86)**. The OS
   *version* does **not** affect free-tier eligibility (that's the instance type, below); just avoid
   the paid **Ubuntu Pro** images, and keep the architecture **x86** to match the free instance type.
5. **Instance type:** `t2.micro` or `t3.micro` — the one showing *Free tier eligible*. This (plus a
   standard Ubuntu AMI) is what makes it free, not the OS version.
6. **Key pair:** create one and download the `.pem` (or skip it and use EC2 Instance Connect, step C).
7. **Network settings → Edit → Firewall (security group) → Create**, with these inbound rules:

   | Type | Protocol | Port range | Source |
   |------|----------|-----------|--------|
   | SSH | TCP | 22 | My IP |
   | Custom UDP | UDP | 3478 | Anywhere `0.0.0.0/0` |
   | Custom TCP | TCP | 3478 | Anywhere `0.0.0.0/0` |
   | Custom UDP | UDP | 49152–65535 | Anywhere `0.0.0.0/0` |
   | Custom UDP | UDP | 5349 | Anywhere `0.0.0.0/0` *(optional TLS)* |
   | Custom TCP | TCP | 5349 | Anywhere `0.0.0.0/0` *(optional TLS)* |

   ⚠️ The **49152–65535 UDP** range is the one everyone forgets — without it the relay can't carry media.
8. **Storage:** default (8 GB) is fine. **Launch instance.**

## B. (Recommended) Give it a fixed IP — Elastic IP

The auto-assigned public IP **changes on every stop/start**, and the IP lives in TWO places — the
app's relay config AND coturn's own `external-ip` line — so a changed IP silently breaks the relay.
An Elastic IP makes the address permanent so stop/start never breaks anything:

1. **EC2 → Network & Security → Elastic IPs → Allocate Elastic IP address** → keep the defaults
   (Amazon's pool, your region) → **Allocate**.
2. Select the new address → **Actions → Associate Elastic IP address** → Resource type **Instance**
   → pick your relay instance → **Associate**.
3. ⚠ Associating **replaces** the instance's current public IP immediately (the old auto-assigned
   one is gone for good — an open EC2-Instance-Connect tab may drop; just reconnect). So do a
   one-time fixup of both IP locations: run step D's config refresh (or the auto-refresh service
   below, which handles it in one line), and put the new IP in the app (step E.2).
4. Cost: a public IPv4 bills ~US$3.6/month (credits cover it). If you ever **terminate** the
   instance, also **Release** the Elastic IP — an allocated-but-unused one keeps billing.

### No Elastic IP? Install the auto-refresh service instead
Without a fixed IP, make the relay re-detect its address **on every boot** — otherwise coturn keeps
advertising the previous boot's IP and the relay breaks even if the app is told the new one. Paste
this once on the server:

```bash
sudo tee /usr/local/bin/coturn-refresh-ip.sh >/dev/null <<'EOF'
#!/bin/bash
# The public IP changes on every stop/start (no Elastic IP). Rewrite coturn's
# external-ip from EC2 metadata and restart the relay so it advertises the current one.
set -e
T=$(curl -s -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 120")
PUB=$(curl -s -H "X-aws-ec2-metadata-token: $T" http://169.254.169.254/latest/meta-data/public-ipv4)
PRIV=$(curl -s -H "X-aws-ec2-metadata-token: $T" http://169.254.169.254/latest/meta-data/local-ipv4)
[ -n "$PUB" ] || exit 0
sed -i "s|^external-ip=.*|external-ip=$PUB/$PRIV|" /home/ubuntu/coturn/turnserver.conf
cd /home/ubuntu/coturn && docker compose up -d --force-recreate
EOF
sudo chmod +x /usr/local/bin/coturn-refresh-ip.sh
sudo tee /etc/systemd/system/coturn-refresh-ip.service >/dev/null <<'EOF'
[Unit]
Description=Point coturn at this boot's public IP
After=docker.service network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/coturn-refresh-ip.sh
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable coturn-refresh-ip.service
sudo /usr/local/bin/coturn-refresh-ip.sh && grep external-ip /home/ubuntu/coturn/turnserver.conf
```

The relay then always advertises the right address — but the APP still needs the new IP after each
restart: the MC enters it in the panel's **Video relay** section (participants follow automatically).
With an Elastic IP none of that is ever needed. (The service is harmless to keep with an Elastic IP
too — the address simply never changes again.)

## C. Connect to the server
- **Easiest:** EC2 → select the instance → **Connect → EC2 Instance Connect → Connect** (browser terminal, no key needed).
- **Or SSH** from Windows PowerShell:
  ```powershell
  icacls "path\to\tassel-turn.pem" /inheritance:r /grant:r "$($env:USERNAME):(R)"
  ssh -i "path\to\tassel-turn.pem" ubuntu@YOUR_PUBLIC_IP
  ```

## D. Install Docker + run coturn — paste this whole block on the server
**First, invent your own password** and put it in place of `YOUR_TURN_SECRET` (the `user=` line)
before pasting — don't reuse anyone else's.
```bash
curl -fsSL https://get.docker.com | sudo sh
mkdir -p ~/coturn && cd ~/coturn

# Auto-detect this instance's public + private IP (works with or without an Elastic IP)
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 120")
PUB=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
PRIV=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/local-ipv4)
echo "Public=$PUB  Private=$PRIV"     # Public= must be non-empty; if it is, associate an Elastic IP

cat > turnserver.conf <<EOF
listening-port=3478
tls-listening-port=5349
min-port=49152
max-port=65535
external-ip=$PUB/$PRIV
lt-cred-mech
realm=tassel.local
user=tassel:YOUR_TURN_SECRET
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
sudo docker compose logs --tail=30        # expect listener lines, no errors
```
> If `get.docker.com` says your Ubuntu release isn't supported yet (can happen on a brand-new version
> like 26.04), install Docker from Ubuntu's own repo instead, then re-run the two `docker compose` lines:
> ```bash
> sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
> ```

## E. Verify, then point the app at it
1. In `turn-test.html` (repo root), paste — with **YOUR public IP** — and Run; you want green **TURN RELAY WORKS**:
   ```
   [
     {"urls":"stun:YOUR_PUBLIC_IP:3478"},
     {"urls":"turn:YOUR_PUBLIC_IP:3478","username":"tassel","credential":"YOUR_TURN_SECRET"},
     {"urls":"turn:YOUR_PUBLIC_IP:3478?transport=tcp","username":"tassel","credential":"YOUR_TURN_SECRET"}
   ]
   ```
2. Point the app at it — either enter the IP + username + password in the MC panel's **“Video
   relay”** section (no rebuild; the whole room switches automatically), or make it permanent by
   putting the same list in repo-root `.env.local` as `VITE_ICE_SERVERS=[...]` (one line) and
   rebuilding. See [RUN-YOUR-OWN-SERVER.md](RUN-YOUR-OWN-SERVER.md).

## Staying inside free tier
- **Egress:** 100 GB/month free for 12 months — fine for occasional ceremonies.
- **Public IPv4:** free tier includes 750 hrs/month for 12 months (covers one running instance); ~US$3.6/mo after.
- Between events you can **Stop** the instance to pause compute billing (you keep the disk). With an Elastic IP the address survives the stop/start.
