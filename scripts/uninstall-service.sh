#!/usr/bin/env bash
# Remove the Host's systemd user service.
#
#   scripts/uninstall-service.sh
#
# It removes exactly what scripts/install-service.sh wrote, and nothing else.
# No Plugin directory and no Registry is touched.
set -euo pipefail

unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit="$unit_dir/firstmate.service"

systemctl --user disable --now firstmate.service 2>/dev/null || true

if [[ -f "$unit" ]]; then
  rm -f "$unit"
  printf 'firstmate: removed %s\n' "$unit"
else
  printf 'firstmate: not present: %s\n' "$unit"
fi

systemctl --user daemon-reload
printf 'firstmate: lingering is left as it is. Turn it off with: loginctl disable-linger %s\n' \
  "${USER:-$(id -un)}"
