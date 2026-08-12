#!/usr/bin/env bash
# Install a reviewed snapshot of the Pi database tooling outside release trees.
set -Eeuo pipefail

if [[ $# -ne 0 ]]; then
  printf 'Usage: install-pi-postgres-operations.sh\n' >&2
  exit 2
fi

source_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$source_directory/.." && pwd)"
deployment_root="${LGA_DEPLOY_ROOT:-$HOME/.local/share/league-analysis}"
operations_directory="$deployment_root/operations"
lock_path="$deployment_root/.postgres-operations-install.lock"

if [[ "$deployment_root" != /* || "$deployment_root" == "/" || \
  "$deployment_root" == "$HOME" ]]; then
  printf 'LGA_DEPLOY_ROOT must be a dedicated absolute subdirectory.\n' >&2
  exit 1
fi
for source_file in \
  "$source_directory/pi-postgres-operations.sh" \
  "$source_directory/prune-postgres-daily-backups.sh" \
  "$source_directory/postgres-snapshot.sql" \
  "$repository_root/backend/alembic/expected-head.txt"; do
  if [[ ! -f "$source_file" || -L "$source_file" ]]; then
    printf 'Required source is missing or is a symlink: %s\n' "$source_file" >&2
    exit 1
  fi
done

install -d -m 700 -- "$deployment_root" "$operations_directory"
exec 9>"$lock_path"
chmod 600 -- "$lock_path"
if ! flock -n 9; then
  printf 'Another League Analysis PostgreSQL tooling install is running.\n' >&2
  exit 1
fi

temporary_directory="$(mktemp -d "$operations_directory/.install.XXXXXX")"
cleanup() {
  if [[ -n "$temporary_directory" && -d "$temporary_directory" && \
    "$temporary_directory" == "$operations_directory/.install."* ]]; then
    rm -rf -- "$temporary_directory"
  fi
}
trap cleanup EXIT

install -m 700 -- "$source_directory/pi-postgres-operations.sh" \
  "$temporary_directory/pi-postgres-operations"
install -m 700 -- "$source_directory/prune-postgres-daily-backups.sh" \
  "$temporary_directory/prune-postgres-daily-backups"
install -m 600 -- "$source_directory/postgres-snapshot.sql" \
  "$temporary_directory/postgres-snapshot.sql"
install -m 600 -- "$repository_root/backend/alembic/expected-head.txt" \
  "$temporary_directory/expected-alembic-head.txt"
bash -n "$temporary_directory/pi-postgres-operations"
bash -n "$temporary_directory/prune-postgres-daily-backups"

install -m 700 -- "$temporary_directory/pi-postgres-operations" \
  "$operations_directory/pi-postgres-operations"
install -m 700 -- "$temporary_directory/prune-postgres-daily-backups" \
  "$operations_directory/prune-postgres-daily-backups"
install -m 600 -- "$temporary_directory/postgres-snapshot.sql" \
  "$operations_directory/postgres-snapshot.sql"
install -m 600 -- "$temporary_directory/expected-alembic-head.txt" \
  "$operations_directory/expected-alembic-head.txt"

"$operations_directory/pi-postgres-operations" identity
printf 'Installed League Analysis Pi PostgreSQL operations tooling.\n'
