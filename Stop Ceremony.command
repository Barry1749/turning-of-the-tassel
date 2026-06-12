#!/usr/bin/env bash
# macOS launcher — double-click in Finder to stop and remove the ceremony (Docker or native).
cd "$(dirname "$0")" || exit 1
bash scripts/ceremony.sh stop
echo
read -r -p "Press Return to close this window..."
