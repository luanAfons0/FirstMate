#!/usr/bin/env bash
# Install the Host as a systemd user service inside WSL Debian.
#
#   scripts/install-service.sh
#
# It writes one file, ~/.config/systemd/user/firstmate.service, and enables
# lingering so that the Host runs without an interactive login. It touches
# nothing else. scripts/uninstall-service.sh removes exactly what it wrote.
set -euo pipefail

repository="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit="$unit_dir/firstmate.service"

user="${USER:-$(id -un)}"

node="$(command -v node || true)"
if [[ -z "$node" ]]; then
  printf 'firstmate: node is not on the PATH. The Host is TypeScript on Node 24.\n' >&2
  exit 1
fi
# An older Node starts, then fails on the first .ts import, inside a service
# that restarts it until systemd gives up. Refusing here says why.
if ! "$node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  printf 'firstmate: %s is Node %s. The Host needs Node 24 or later.\n' \
    "$node" "$("$node" --version)" >&2
  exit 1
fi

# The paths go into a sed replacement, where \, | and & mean something.
escape() { printf '%s' "$1" | sed -e 's/[\\|&]/\\&/g'; }

mkdir -p "$unit_dir"
sed -e "s|@NODE@|$(escape "$node")|g" -e "s|@REPOSITORY@|$(escape "$repository")|g" \
  "$repository/systemd/firstmate.service" > "$unit"

systemctl --user daemon-reload
systemctl --user enable --now firstmate.service

# WSL2 stops a distribution when its last process exits, and a user service
# needs the user's own systemd running. Lingering starts it at boot instead of
# at login (ADR-0007).
if ! loginctl enable-linger "$user" 2>/dev/null; then
  printf 'firstmate: could not enable lingering. Run: sudo loginctl enable-linger %s\n' "$user" >&2
fi

printf 'firstmate: installed %s\n' "$unit"
printf 'firstmate: read it with  journalctl --user -u firstmate -f\n'
printf 'firstmate: the address is in ~/.firstmate/runtime.json\n'
