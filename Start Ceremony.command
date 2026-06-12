#!/usr/bin/env bash
# macOS launcher — double-click in Finder. Presents a quick menu (Docker vs Native, public vs local),
# then starts the ceremony via scripts/ceremony.sh and prints the Master-of-Ceremony link.
#
# First-time use: macOS may block a downloaded script. If double-click is refused, right-click the
# file -> Open (once), or run:  chmod +x "Start Ceremony.command"
cd "$(dirname "$0")" || exit 1

echo "================  Turning of the Tassel  ================"
echo
echo "How do you want to run it?"
echo "   1) Docker  - isolated; installs Docker if needed    (public link)"
echo "   2) Docker  - local only (this Mac)"
echo "   3) Native  - uses Node directly; lighter            (public link)"
echo "   4) Native  - local only (this Mac)"
echo
read -r -p "Choice [1]: " choice
choice="${choice:-1}"

args=(start --auto-install)
case "$choice" in
  1) ;;
  2) args+=(--local) ;;
  3) args+=(--native) ;;
  4) args+=(--native --local) ;;
  *) echo "Unknown choice - defaulting to 1 (Docker, public link)." ;;
esac

echo
bash scripts/ceremony.sh "${args[@]}"
echo
echo "Closing this window leaves the ceremony running. Use 'Stop Ceremony.command' to shut it down."
read -r -p "Press Return to close this window..."
