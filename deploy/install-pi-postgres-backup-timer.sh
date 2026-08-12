#!/usr/bin/env bash
# Install and enable the Pi user timer for daily PostgreSQL backups.
set -Eeuo pipefail

if [[ $# -ne 0 ]]; then
  printf 'Usage: install-pi-postgres-backup-timer.sh\n' >&2
  exit 2
fi

source_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deployment_root="${LGA_DEPLOY_ROOT:-$HOME/.local/share/league-analysis}"
unit_source="$source_directory/systemd"
unit_directory="$HOME/.config/systemd/user"
service_name="league-analysis-postgres-backup.service"
timer_name="league-analysis-postgres-backup.timer"

if [[ "$deployment_root" != /* || "$deployment_root" == "/" || \
  "$deployment_root" == "$HOME" ]]; then
  printf 'LGA_DEPLOY_ROOT must be a dedicated absolute subdirectory.\n' >&2
  exit 1
fi
for source_file in "$unit_source/$service_name" "$unit_source/$timer_name"; do
  if [[ ! -f "$source_file" || -L "$source_file" ]]; then
    printf 'Required systemd unit is missing or is a symlink: %s\n' "$source_file" >&2
    exit 1
  fi
done

"$source_directory/install-pi-postgres-operations.sh"
install -d -m 700 -- "$unit_directory"
install -m 600 -- "$unit_source/$service_name" "$unit_directory/$service_name"
install -m 600 -- "$unit_source/$timer_name" "$unit_directory/$timer_name"
# The GitHub runner service has no login-session environment; point
# systemctl --user at the lingering user manager explicitly.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
systemctl --user daemon-reload
systemctl --user enable --now "$timer_name"
systemctl --user is-enabled --quiet "$timer_name"
systemctl --user is-active --quiet "$timer_name"
printf 'Installed and enabled the League Analysis Prague-midnight PostgreSQL backup timer.\n'
