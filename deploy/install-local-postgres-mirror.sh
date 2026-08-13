#!/usr/bin/env bash
# Install the worktree-independent local mirror snapshot and recurring timer.
set -Eeuo pipefail

if [[ $# -ne 0 ]]; then
  printf 'Usage: install-local-postgres-mirror.sh\n' >&2
  exit 2
fi

source_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$source_directory/.." && pwd)"
operation_root="${LGA_OPERATION_ROOT:-$HOME/.local/share/league-analysis}"
operations_directory="$operation_root/operations"
unit_source="$source_directory/systemd"
unit_directory="$HOME/.config/systemd/user"
config_file="$HOME/projects/league-analysis/.env"
mirror_source="$repository_root/backend/scripts/mirror_pi_postgres_to_local.py"
migration_contract_source="$repository_root/backend/scripts/migration_contract.py"
expected_head_source="$repository_root/backend/alembic/expected-head.txt"
snapshot_source="$source_directory/postgres-snapshot.sql"
service_name="league-analysis-local-postgres-mirror.service"
timer_name="league-analysis-local-postgres-mirror.timer"
lock_path="$operation_root/.local-postgres-mirror-install.lock"

if [[ "$operation_root" != /* || "$operation_root" == "/" || \
  "$operation_root" == "$HOME" ]]; then
  printf 'LGA_OPERATION_ROOT must be a dedicated absolute subdirectory.\n' >&2
  exit 1
fi
for source_file in \
  "$mirror_source" \
  "$migration_contract_source" \
  "$expected_head_source" \
  "$snapshot_source" \
  "$unit_source/$service_name" \
  "$unit_source/$timer_name"; do
  if [[ ! -f "$source_file" || -L "$source_file" ]]; then
    printf 'Required mirror source is missing or is a symlink: %s\n' "$source_file" >&2
    exit 1
  fi
done
if [[ ! -f "$config_file" || -L "$config_file" || \
  "$(stat -c '%a' "$config_file")" != "600" || \
  "$(stat -c '%u' "$config_file")" != "$(id -u)" ]]; then
  printf 'Local mirror configuration must be a current-user mode-0600 regular file.\n' >&2
  exit 1
fi

install -d -m 700 -- "$operation_root" "$operations_directory" "$unit_directory"
exec 9>"$lock_path"
chmod 600 -- "$lock_path"
if ! flock -n 9; then
  printf 'Another League Analysis local mirror install is running.\n' >&2
  exit 1
fi

install -m 700 -- "$mirror_source" "$operations_directory/local-postgres-mirror"
install -m 600 -- "$migration_contract_source" \
  "$operations_directory/migration_contract.py"
install -m 600 -- "$expected_head_source" \
  "$operations_directory/expected-alembic-head.txt"
install -m 600 -- "$snapshot_source" "$operations_directory/postgres-snapshot.sql"
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m py_compile \
  "$operations_directory/local-postgres-mirror" \
  "$operations_directory/migration_contract.py"
"$operations_directory/local-postgres-mirror" \
  --database league_analysis_local_dev \
  --remote pi5ram16 \
  --remote-database league_analysis \
  --config "$config_file"

install -m 600 -- "$unit_source/$service_name" "$unit_directory/$service_name"
install -m 600 -- "$unit_source/$timer_name" "$unit_directory/$timer_name"
# `systemctl --user` needs the user manager's bus address, which service and
# CI contexts do not export. The manager itself may still be running (login
# elsewhere, or linger), so supply the well-known runtime path instead of
# failing like the backup-timer installer once did.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
systemctl --user daemon-reload
systemctl --user enable --now "$timer_name"
systemctl --user is-enabled --quiet "$timer_name"
systemctl --user is-active --quiet "$timer_name"
printf 'Installed and enabled the daily League Analysis Pi-to-local mirror timer.\n'
