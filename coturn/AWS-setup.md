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

## B. (Recommended) Give it a fixed IP
The auto-assigned public IP changes if you stop/start the instance — annoying, since the app bakes the
IP in. For a permanent address: **EC2 → Elastic IPs → Allocate**, then **Actions → Associate** → your
instance. (Free tier covers one *in-use* public IPv4 for 12 months. Don't leave an Elastic IP allocated
but *un*-associated — an idle one is billed.)

## C. Connect to the server
- **Easiest:** EC2 → select the instance → **Connect → EC2 Instance Connect → Connect** (browser terminal, no key needed).
- **Or SSH** from Windows PowerShell:
  ```powershell
  icacls "path\to\tassel-turn.pem" /inheritance:r /grant:r "$($env:USERNAME):(R)"
  ssh -i "path\to\tassel-turn.pem" ubuntu@YOUR_PUBLIC_IP
  ```

## D. Install Docker + run coturn — paste this whole block on the server
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
