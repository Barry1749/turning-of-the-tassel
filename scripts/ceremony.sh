#!/usr/bin/env bash
# CLI runner for the "Turning of the Tassel" ceremony — the Linux/macOS counterpart of
# scripts/ceremony.ps1. Runs the app one of two ways:
#   docker  (default) — the containerized stack from docker-compose.yml (api + web + cloudflared).
#   native  (--native) — directly on Node via `npm run prod` / `prod:share` (no Docker).
# With --auto-install it installs whichever runtime is missing (Docker / Node / cloudflared),
# starts it, and waits — so the whole thing is one command.
#
# Usage:
#   ./scripts/ceremony.sh start                       # Docker, public MC link
#   ./scripts/ceremony.sh start --native              # no Docker, runs on Node
#   ./scripts/ceremony.sh start --local               # local-only (http://localhost:4173)
#   ./scripts/ceremony.sh start --auto-install         # install the runtime first if missing
#   ./scripts/ceremony.sh link|open|status|logs|stop
#
# Run with `bash scripts/ceremony.sh ...` if it isn't marked executable.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root — compose file / package.json live here
cd "$ROOT"

TIMEOUT="${TIMEOUT:-180}"
OS="$(uname -s)"
SUDO=""                     # set to "sudo" on Linux when the current user can't reach the engine yet
COMPOSE_BASE=""             # "docker compose" (v2) or "docker-compose" (legacy)
PID_FILE="$ROOT/.ceremony-native.pid"    # tracks the native (npm) process
NATIVE_LOG="$ROOT/.ceremony-native.log"  # native stdout (tunnel link is printed here)
HOST_TOKEN_FILE="$ROOT/.host-token.local"

fail() { echo "ERROR: $*" >&2; exit 1; }

# ============================ Docker runtime ============================

compose() { $SUDO $COMPOSE_BASE "$@"; }
docker_engine_ok() { $SUDO docker info >/dev/null 2>&1; }

# Multi-ceremony slots: a free host web port (4172+N) marks a free slot, so several ceremonies can
# run on one PC, each its own compose project (tassel-N) + web port. (/dev/tcp is a bash builtin.)
port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
get_free_slot() { local n; for n in $(seq 1 20); do port_free $((4172 + n)) && { echo "$n"; return; }; done; echo 0; }

need_compose() {
  if $SUDO docker compose version >/dev/null 2>&1; then COMPOSE_BASE="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then COMPOSE_BASE="docker-compose"
  else fail "Docker Compose not found. Install Docker Engine + the Compose plugin (https://docs.docker.com/engine/install/)."; fi
}

install_docker_linux() {
  echo "Installing Docker Engine (uses sudo; downloads a few hundred MB)..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sudo sh || fail "Docker install script failed."
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin || fail "apt install of Docker failed."
  else
    fail "Couldn't auto-install Docker on this distro. See https://docs.docker.com/engine/install/"
  fi
  sudo usermod -aG docker "$USER" >/dev/null 2>&1 || true
  sudo systemctl enable --now docker >/dev/null 2>&1 || true
}

install_docker_mac() {
  echo "Installing Docker Desktop..."
  if command -v brew >/dev/null 2>&1; then
    brew install --cask docker || fail "brew install of Docker Desktop failed."
  else
    fail "Homebrew isn't installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ (or install Homebrew first)."
  fi
}

ensure_docker() {  # $1 = auto (1 = allowed to install)
  local auto="${1:-0}"
  command -v docker >/dev/null 2>&1 && docker_engine_ok && return 0   # already up
  if ! command -v docker >/dev/null 2>&1; then
    [ "$auto" -eq 1 ] || fail "Docker isn't installed. Re-run with --auto-install, install it (https://docs.docker.com/get-docker/), or use --native to run without Docker."
    case "$OS" in
      Linux)  install_docker_linux ;;
      Darwin) install_docker_mac ;;
      *) fail "Auto-install isn't supported on '$OS'. Install Docker manually." ;;
    esac
  fi
  if ! docker info >/dev/null 2>&1; then          # engine down — try to start it
    case "$OS" in
      Darwin) open -a Docker >/dev/null 2>&1 || true ;;
      Linux)  sudo systemctl start docker >/dev/null 2>&1 || true ;;
    esac
  fi
  if [ "$OS" = "Linux" ] && ! docker info >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
    SUDO="sudo"
    echo "Note: using sudo for Docker this session. Log out and back in to drop it (you're now in the 'docker' group)."
  fi
  echo "Waiting for the Docker engine to come up (first start can take a minute)..."
  local deadline; deadline=$(( $(date +%s) + TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    docker_engine_ok && return 0
    sleep 3
  done
  case "$OS" in
    Darwin) fail "Docker isn't responding. Open Docker Desktop once, let it finish starting, then re-run." ;;
    *)      fail "Docker isn't responding. It may need a restart, or 'sudo systemctl start docker'." ;;
  esac
}

public_link() {  # docker tunnel link
  local logs l
  logs="$(compose logs tunnel 2>&1)" || return 0
  l="$(printf '%s\n' "$logs" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com[^ |]*' | grep -m1 '?t=')" || true
  [ -z "$l" ] && l="$(printf '%s\n' "$logs" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com[^ |]*' | head -n1)" || true
  printf '%s' "$l"
}

local_link() {  # docker local link from the api's host token
  local tok
  tok="$(compose logs api 2>&1 | grep -oE '\?t=[A-Za-z0-9_-]{16,}' | head -n1 | sed 's/^?t=//')" || true
  [ -n "$tok" ] && printf 'http://localhost:%s/?t=%s' "${WEB_PORT:-4173}" "$tok"
}

# ============================ Native (Node) runtime ============================

install_node() {
  case "$OS" in
    Darwin)
      command -v brew >/dev/null 2>&1 || fail "Homebrew isn't installed. Install Node.js 18+ from https://nodejs.org/ (or install Homebrew first)."
      brew install node || fail "brew install of Node failed." ;;
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs || fail "Node install failed."
      elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y nodejs || fail "Node install failed."
      else fail "Couldn't auto-install Node. Install Node.js 18+ from https://nodejs.org/"; fi ;;
    *) fail "Auto-install of Node isn't supported on '$OS'. Install Node.js 18+ from https://nodejs.org/" ;;
  esac
}

ensure_node() {  # $1 = auto
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && return 0
  [ "${1:-0}" -eq 1 ] || fail "Node.js isn't installed. Re-run with --auto-install, or get it from https://nodejs.org/"
  install_node
  command -v node >/dev/null 2>&1 || fail "Node installed but not on PATH yet. Open a new shell and try again."
}

install_cloudflared() {
  case "$OS" in
    Darwin)
      command -v brew >/dev/null 2>&1 || fail "Homebrew isn't installed. Install cloudflared, or use --local."
      brew install cloudflared || fail "brew install of cloudflared failed." ;;
    Linux)
      local arch; arch="$(uname -m)"; case "$arch" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; esac
      sudo curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$arch" -o /usr/local/bin/cloudflared \
        && sudo chmod +x /usr/local/bin/cloudflared || fail "cloudflared install failed." ;;
    *) fail "Auto-install of cloudflared isn't supported on '$OS'. Use --local, or install it manually." ;;
  esac
}

ensure_cloudflared() {  # $1 = auto
  command -v cloudflared >/dev/null 2>&1 && return 0
  [ "${1:-0}" -eq 1 ] || fail "cloudflared isn't installed (needed for the public link). Re-run with --auto-install, or use --local."
  install_cloudflared
  command -v cloudflared >/dev/null 2>&1 || fail "Couldn't install cloudflared. Use --local, or install it manually."
}

start_native() {  # uses $LOCAL, $AUTO
  ensure_node "$AUTO"
  [ "$LOCAL" -eq 1 ] || ensure_cloudflared "$AUTO"
  if [ ! -d node_modules ]; then
    echo "Installing app dependencies (npm install — first time only)..."
    npm install || fail "npm install failed."
  fi
  rm -f "$HOST_TOKEN_FILE"
  : > "$NATIVE_LOG"
  local script; if [ "$LOCAL" -eq 1 ]; then script="prod"; else script="prod:share"; fi
  echo "Starting the app on Node (npm run $script)..."
  nohup npm run "$script" >"$NATIVE_LOG" 2>&1 &
  echo $! > "$PID_FILE"
}

native_link() {  # $1 = local | public
  if [ "$1" = "local" ]; then
    [ -f "$HOST_TOKEN_FILE" ] || return 0
    local tok; tok="$(tr -d '[:space:]' < "$HOST_TOKEN_FILE")"
    [ -n "$tok" ] && printf 'http://localhost:4173/?t=%s' "$tok"
    return 0
  fi
  [ -f "$NATIVE_LOG" ] || return 0
  local l
  l="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com[^ |]*' "$NATIVE_LOG" | grep -m1 '?t=')" || true
  [ -z "$l" ] && l="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com[^ |]*' "$NATIVE_LOG" | head -n1)" || true
  printf '%s' "$l"
}

native_running() { [ -f "$PID_FILE" ]; }

kill_tree() { local p="$1" c; for c in $(pgrep -P "$p" 2>/dev/null); do kill_tree "$c"; done; kill "$p" 2>/dev/null || true; }

stop_native() {
  [ -f "$PID_FILE" ] || return 1
  local p; p="$(cat "$PID_FILE" 2>/dev/null)"
  [ -n "$p" ] && kill_tree "$p"
  rm -f "$PID_FILE" "$NATIVE_LOG"
}

# ============================ Shared helpers ============================

resolve_start_link() {
  if [ "$RUNTIME" = "native" ]; then
    [ "$LOCAL" -eq 1 ] && native_link local || native_link public
  else
    [ "$LOCAL" -eq 1 ] && local_link || public_link
  fi
}

resolve_any_link() {  # auto-detect for link/open/status
  if native_running; then
    local l; l="$(native_link public)"; [ -n "$l" ] && { printf '%s' "$l"; return; }
    native_link local; return
  fi
  local l; l="$(public_link)"; [ -n "$l" ] && { printf '%s' "$l"; return; }
  local_link
}

wait_link() {
  local deadline l
  deadline=$(( $(date +%s) + TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    l="$(resolve_start_link)"
    [ -n "$l" ] && { printf '%s' "$l"; return 0; }
    sleep 2
  done
  return 1
}

print_link_banner() {
  cat <<EOF

============================================================
 HOST (Master of Ceremony) console -- open this yourself:

   $1

 Don't share the bare URL. Invite people with the per-person
 links from the MC panel.
============================================================
EOF
}

ACTION="${1:-start}"
shift 2>/dev/null || true
LOCAL=0; AUTO=0; RUNTIME="docker"; SLOT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --local)        LOCAL=1 ;;
    --auto-install) AUTO=1 ;;
    --native)       RUNTIME="native" ;;
    --docker)       RUNTIME="docker" ;;
    --slot)         SLOT="${2:-0}"; shift ;;   # which ceremony slot to stop (0 = all)
  esac
  shift
done

case "$ACTION" in
  start)
    if [ "$RUNTIME" = "native" ]; then
      start_native
      echo "Started. Waiting for the MC link..."
    else
      ensure_docker "$AUTO"
      need_compose
      slot="$(get_free_slot)"
      [ "$slot" -eq 0 ] && fail "No free ceremony slot — web ports 4173-4192 are all in use."
      export COMPOSE_PROJECT_NAME="tassel-$slot"   # compose targets this project (its own stack)
      export WEB_PORT=$((4172 + slot))             # docker-compose maps this host port -> container 4173
      echo "Ceremony slot $slot — project $COMPOSE_PROJECT_NAME, web port $WEB_PORT."
      echo "Building images and starting containers (first run pulls base images + builds — can take a few minutes)..."
      if [ "$LOCAL" -eq 1 ]; then
        compose up -d --build api web || fail "docker compose failed to start. Run 'docker compose -p $COMPOSE_PROJECT_NAME logs' for details."
      else
        compose up -d --build || fail "docker compose failed to start. Run 'docker compose -p $COMPOSE_PROJECT_NAME logs' for details."
      fi
      echo "SLOT=$slot"   # machine-readable: the desktop app passes this back as `stop --slot N`
      echo "Containers up. Resolving the MC link..."
    fi
    link="$(wait_link)" || { echo "Started, but couldn't read the MC link yet. Try './scripts/ceremony.sh link' shortly, or check the logs."; exit 2; }
    print_link_banner "$link"
    ;;
  stop)
    native_running && stop_native
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
      if [ "$SLOT" -gt 0 ]; then
        # Stop just THIS ceremony's slot, leaving any other ceremony running.
        export COMPOSE_PROJECT_NAME="tassel-$SLOT"
        echo "Stopping ceremony slot $SLOT (project $COMPOSE_PROJECT_NAME)..."
        if docker compose version >/dev/null 2>&1; then docker compose down --remove-orphans
        elif command -v docker-compose >/dev/null 2>&1; then docker-compose down --remove-orphans; fi
        left="$(docker ps -aq --filter ancestor=tassel-app --filter label=com.docker.compose.project="tassel-$SLOT" 2>/dev/null)"
      else
        # No slot given: clear EVERY ceremony on this PC.
        echo "Stopping all ceremonies on this PC..."
        if docker compose version >/dev/null 2>&1; then docker compose down --remove-orphans
        elif command -v docker-compose >/dev/null 2>&1; then docker-compose down --remove-orphans; fi
        # Fallback: force-remove anything still based on the tassel-app image (matched by IMAGE, not
        # by project) — catches every tassel-N stack, even one under a different project name.
        left="$(docker ps -aq --filter ancestor=tassel-app 2>/dev/null)"
      fi
      if [ -n "$left" ]; then
        echo "Force-removing leftover ceremony container(s)..."
        docker rm -f $left >/dev/null 2>&1 || true
      fi
    else
      echo "Docker engine isn't running — no containers to stop."
    fi
    echo "Stopped."
    ;;
  link)
    native_running || need_compose
    link="$(resolve_any_link)"
    [ -n "$link" ] && echo "$link" || fail "No link found. Is it running? Try 'start'."
    ;;
  open)
    native_running || need_compose
    link="$(resolve_any_link)"
    [ -z "$link" ] && fail "No link found. Is it running? Try 'start'."
    if command -v xdg-open >/dev/null 2>&1; then xdg-open "$link" >/dev/null 2>&1 &
    elif command -v open >/dev/null 2>&1; then open "$link"
    else echo "No browser opener here (headless) — open this link yourself:"; fi
    echo "$link"
    ;;
  status)
    if native_running; then echo "Native (Node) ceremony running. Link: $(resolve_any_link)"
    else need_compose; compose ps; fi
    ;;
  logs)
    if native_running; then tail -n 50 -f "$NATIVE_LOG"
    else need_compose; compose logs -f; fi
    ;;
  *) echo "Usage: $0 {start [--native] [--local] [--auto-install]|stop|link|open|status|logs}" >&2; exit 1 ;;
esac
