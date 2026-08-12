#!/usr/bin/env bash
# Install and enable the system timer for daily League Analysis backups.
set -Eeuo pipefail

if [[ $# -ne 0 ]]; then
  printf 'Usage: install-pi-postgres-backup-timer.sh\n' >&2
  exit 2
fi

source_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deployment_root="${LGA_DEPLOY_ROOT:-$HOME/.local/share/league-analysis}"
unit_source="$source_directory/systemd"
unit_directory="/etc/systemd/system"
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

# A system unit runs from the system manager, so the timer needs neither an
# open login session nor an enabled linger. The service body still runs as the
# deploying account, which owns the deployment root and the Docker socket.
staged_service="$(mktemp)"
trap 'rm -f -- "$staged_service"' EXIT
sed \
  -e "s|__LGA_USER__|$(id -un)|g" \
  -e "s|__LGA_DEPLOY_ROOT__|$deployment_root|g" \
  -- "$unit_source/$service_name" > "$staged_service"

sudo -n install -m 644 -- "$staged_service" "$unit_directory/$service_name"
sudo -n install -m 644 -- "$unit_source/$timer_name" "$unit_directory/$timer_name"
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now "$timer_name"
sudo -n systemctl is-enabled --quiet "$timer_name"
sudo -n systemctl is-active --quiet "$timer_name"
printf 'Installed and enabled the League Analysis Prague-midnight PostgreSQL backup timer.\n'
