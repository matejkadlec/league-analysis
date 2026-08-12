#!/usr/bin/env bash
# Exact-container PostgreSQL operations for the League Analysis Raspberry Pi.
set -Eeuo pipefail

postgres_container="${LGA_POSTGRES_CONTAINER_NAME:-league-analysis-postgres}"
backend_container="${LGA_BACKEND_CONTAINER_NAME:-league-analysis-backend}"
frontend_container="${LGA_FRONTEND_CONTAINER_NAME:-league-analysis-frontend}"
compose_project="${LGA_COMPOSE_PROJECT_NAME:-league-analysis}"
deployment_root="${LGA_DEPLOY_ROOT:-$HOME/.local/share/league-analysis}"
backup_root="${LGA_POSTGRES_BACKUP_ROOT:-$deployment_root/backups/postgres}"
operation_lock="$deployment_root/.postgres-operations.lock"
# This script always runs from a deployed release tree, reached through the
# $deployment_root/current symlink, so its peers resolve directly.
script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
snapshot_sql="$script_directory/postgres-snapshot.sql"
expected_head_file="$script_directory/../backend/alembic/expected-head.txt"
retention_tool="$script_directory/prune-postgres-daily-backups.sh"
deployed_commit_file="$deployment_root/state/deployed-commit"
expected_alembic_head=""

# Set while a generated staging database exists, so a failure drops it.
staging_database=""

usage() {
  printf '%s\n' \
    'Usage: pi-postgres-operations.sh COMMAND [OPTIONS]' \
    '' \
    'Commands:' \
    '  identity' \
    '  snapshot --confirm-target DATABASE' \
    '  dump --confirm-target DATABASE' \
    '  safety-backup --label LABEL --confirm-target DATABASE' \
    '  daily-backup --confirm-target DATABASE' \
    '  pre-deploy-backup --confirm-target DATABASE --commit FULL_SHA' \
    '  restore-test --confirm-target DATABASE --archive ARCHIVE' \
    '  mirror-dump --confirm-target DATABASE'
}

die() {
  printf 'League Analysis PostgreSQL operation refused: %s\n' "$1" >&2
  exit 1
}

require_database_name() {
  [[ "$1" =~ ^[a-z][a-z0-9_]{0,62}$ ]] \
    || die 'database names must use lowercase letters, digits, and underscores'
}

require_commit() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || die 'a full lowercase Git commit is required'
}

require_label() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] \
    || die 'backup labels must use lowercase letters, digits, and hyphens'
}

require_host_paths() {
  if [[ "$deployment_root" != /* || "$deployment_root" == "/" || \
    "$deployment_root" == "$HOME" ]]; then
    die 'LGA_DEPLOY_ROOT must be a dedicated absolute subdirectory'
  fi
  if [[ "$backup_root" != /* || "$backup_root" == "/" || \
    "$backup_root" == "$HOME" ]]; then
    die 'LGA_POSTGRES_BACKUP_ROOT must be a dedicated absolute subdirectory'
  fi
  for directory in "$deployment_root" "$backup_root"; do
    [[ ! -L "$directory" ]] || die "managed directory must not be a symlink: $directory"
    install -d -m 700 -- "$directory"
    chmod 700 -- "$directory"
  done
  [[ -f "$snapshot_sql" && ! -L "$snapshot_sql" ]] \
    || die 'the installed snapshot SQL file is missing or is a symlink'
  [[ -f "$expected_head_file" && ! -L "$expected_head_file" ]] \
    || die 'the installed expected Alembic head is missing or is a symlink'
  expected_alembic_head="$(<"$expected_head_file")"
  [[ "$expected_alembic_head" =~ ^[0-9]{8}_[0-9]{4}$ ]] \
    || die 'the installed expected Alembic head has an invalid shape'
}

container_label() {
  local container="$1"
  local label="$2"
  docker inspect --format "{{index .Config.Labels \"$label\"}}" "$container"
}

validate_one_container() {
  local container="$1"
  local service="$2"
  local must_be_running="$3"
  local matches
  matches="$(docker ps --all --filter "name=^/${container}$" --format '{{.Names}}')"
  [[ "$matches" == "$container" ]] || die "exact container does not exist: $container"
  if [[ "$must_be_running" == "true" ]]; then
    [[ "$(docker inspect --format '{{.State.Running}}' "$container")" == "true" ]] \
      || die "exact container is not running: $container"
  fi
  [[ "$(container_label "$container" com.docker.compose.project)" == "$compose_project" ]] \
    || die "$container does not belong to Compose project $compose_project"
  [[ "$(container_label "$container" com.docker.compose.service)" == "$service" ]] \
    || die "$container does not have Compose service label $service"
}

validate_runtime_identity() {
  validate_one_container "$postgres_container" postgres true
  validate_one_container "$backend_container" backend false
  validate_one_container "$frontend_container" frontend false
  local port_bindings
  port_bindings="$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$postgres_container")"
  if [[ "$port_bindings" != "null" && "$port_bindings" != "{}" ]]; then
    die 'League Analysis PostgreSQL unexpectedly publishes a host port'
  fi
}

configured_database() {
  docker exec --user postgres "$postgres_container" sh -ceu \
    'printf "%s" "$POSTGRES_DB"'
}

container_psql() {
  local database="$1"
  local sql="$2"
  docker exec --user postgres "$postgres_container" sh -ceu \
    'exec psql --username "$POSTGRES_USER" --dbname "$1" --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align --command "$2"' \
    -- "$database" "$sql"
}

confirm_target() {
  local target="$1"
  require_database_name "$target"
  [[ "$(configured_database)" == "$target" ]] \
    || die 'confirmed database does not match the PostgreSQL container configuration'
  [[ "$(container_psql "$target" 'SELECT current_database();')" == "$target" ]] \
    || die 'active PostgreSQL database does not match the confirmed target'
}

database_exists() {
  local database="$1"
  [[ "$(container_psql postgres "SELECT count(*) FROM pg_database WHERE datname = '$database';")" == "1" ]]
}

create_database() {
  local database="$1"
  docker exec --user postgres "$postgres_container" sh -ceu \
    'exec createdb --username "$POSTGRES_USER" --owner "$POSTGRES_USER" --template template0 "$1"' \
    -- "$database"
}

drop_database() {
  local database="$1"
  docker exec --user postgres "$postgres_container" sh -ceu \
    'exec dropdb --username "$POSTGRES_USER" --force --if-exists "$1"' \
    -- "$database"
}

dump_database() {
  local database="$1"
  docker exec --user postgres "$postgres_container" sh -ceu \
    'exec pg_dump --username "$POSTGRES_USER" --dbname "$1" --format=custom --compress=gzip:9 --no-password' \
    -- "$database"
}

dump_mirror_database() {
  local database="$1"
  docker exec --user postgres "$postgres_container" sh -ceu \
    'exec pg_dump --username "$POSTGRES_USER" --dbname "$1" --format=custom --compress=zstd:3 --no-password' \
    -- "$database"
}

list_archive() {
  local archive="$1"
  docker exec --interactive --user postgres "$postgres_container" \
    pg_restore --list < "$archive" >/dev/null
}

restore_archive() {
  local database="$1"
  local archive="$2"
  docker exec --interactive --user postgres "$postgres_container" sh -ceu \
    'exec pg_restore --username "$POSTGRES_USER" --dbname "$1" --no-owner --no-privileges --exit-on-error' \
    -- "$database" < "$archive"
}

database_alembic_head() {
  container_psql "$1" 'SELECT version_num FROM public.alembic_version;'
}

validate_database_baseline() {
  local database="$1"
  local unvalidated
  [[ "$(database_alembic_head "$database")" =~ ^[0-9]{8}_[0-9]{4}$ ]] \
    || die "database $database has an invalid Alembic ledger"
  unvalidated="$(container_psql "$database" \
    "SELECT count(*) FROM pg_constraint WHERE connamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('auth','core','jobs','public')) AND NOT convalidated;")"
  [[ "$unvalidated" == "0" ]] \
    || die "database $database contains unvalidated constraints"
  [[ "$(container_psql "$database" "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('auth','core','jobs') AND table_type = 'BASE TABLE';")" -gt 0 ]] \
    || die "database $database contains no application tables"
}

validate_database() {
  local database="$1"
  local alembic_head
  validate_database_baseline "$database"
  alembic_head="$(database_alembic_head "$database")"
  [[ "$alembic_head" == "$expected_alembic_head" ]] \
    || die "database $database has unexpected Alembic head $alembic_head"
}

create_backup() {
  local database="$1"
  local label="$2"
  local suffix="${3:-}"
  local timestamp
  local completed
  local temporary
  require_label "$label"
  [[ -z "$suffix" || "$suffix" =~ ^-[0-9a-f]{12}$ ]] \
    || die 'backup suffix must be empty or one hyphen plus 12 lowercase hex characters'
  timestamp="$(TZ=Europe/Prague date '+%Y%m%dT%H%M%S%z')"
  completed="$backup_root/league-analysis-postgres-${label}-${timestamp}${suffix}.dump"
  [[ ! -e "$completed" && ! -L "$completed" ]] || die 'backup destination already exists'
  temporary="$(mktemp "$backup_root/.league-analysis-postgres-${label}-${timestamp}${suffix}.dump.in-progress.XXXXXX")"
  chmod 600 -- "$temporary"
  if ! dump_database "$database" > "$temporary"; then
    rm -f -- "$temporary"
    die 'pg_dump failed; the incomplete backup was removed'
  fi
  sync -f "$temporary"
  list_archive "$temporary" || {
    rm -f -- "$temporary"
    die 'pg_restore could not read the backup archive'
  }
  chmod 600 -- "$temporary"
  mv -- "$temporary" "$completed"
  printf '%s\n' "$completed"
}

daily_backup() {
  local target="$1"
  local archive
  local archive_sha256
  local archive_size
  confirm_target "$target"
  [[ -x "$retention_tool" && ! -L "$retention_tool" ]] \
    || die 'the installed daily-backup retention tool is missing or is a symlink'

  archive="$(create_backup "$target" daily)"
  archive_sha256="$(sha256sum "$archive" | awk '{print $1}')"
  archive_size="$(stat -c '%s' "$archive")"
  "$retention_tool" "$backup_root"
  printf 'Daily PostgreSQL backup completed: %s\n' "$archive"
  printf 'Archive SHA-256: %s\n' "$archive_sha256"
  printf 'Archive bytes: %s\n' "$archive_size"
}

pre_deploy_backup() {
  local target="$1"
  local target_commit="$2"
  local current_commit
  local archive
  local archive_sha256
  local archive_size
  local current_head
  confirm_target "$target"
  require_commit "$target_commit"
  # Deployment bookkeeping is reported, never required: a safety backup must
  # stay possible precisely when deployment state has drifted.
  current_commit='unrecorded'
  if [[ -f "$deployed_commit_file" && ! -L "$deployed_commit_file" ]]; then
    current_commit="$(<"$deployed_commit_file")"
  fi
  validate_database_baseline "$target"
  current_head="$(database_alembic_head "$target")"
  [[ -x "$retention_tool" && ! -L "$retention_tool" ]] \
    || die 'the installed backup retention tool is missing or is a symlink'

  archive="$(create_backup "$target" pre-deploy "-${target_commit:0:12}")"
  archive_sha256="$(sha256sum "$archive" | awk '{print $1}')"
  archive_size="$(stat -c '%s' "$archive")"
  "$retention_tool" "$backup_root"
  printf 'Pre-deployment PostgreSQL backup completed: %s\n' "$archive"
  printf 'Archive SHA-256: %s\n' "$archive_sha256"
  printf 'Archive bytes: %s\n' "$archive_size"
  printf 'Database Alembic head: %s\n' "$current_head"
  printf 'Current deployed commit: %s\n' "$current_commit"
  printf 'Target deployment commit: %s\n' "$target_commit"
}

validate_managed_archive_path() {
  local requested="$1"
  local resolved
  local basename
  [[ -n "$requested" ]] || die 'a managed backup archive path is required'
  [[ -f "$requested" && ! -L "$requested" ]] \
    || die 'the backup archive must be a regular non-symlink file'
  resolved="$(realpath -e -- "$requested")"
  [[ "$(dirname "$resolved")" == "$backup_root" ]] \
    || die 'the backup archive must be directly inside the managed backup root'
  basename="$(basename "$resolved")"
  [[ "$basename" =~ ^league-analysis-postgres-(daily|pre-restore)-[0-9]{8}T[0-9]{6}[+-][0-9]{4}\.dump$ || \
    "$basename" =~ ^league-analysis-postgres-pre-deploy-[0-9]{8}T[0-9]{6}[+-][0-9]{4}-[0-9a-f]{12}\.dump$ ]] \
    || die 'the backup archive name is outside the managed restore contract'
  [[ "$(stat -c '%a' "$resolved")" == "600" ]] \
    || die 'the backup archive must have mode 0600'
  [[ "$(stat -c '%u' "$resolved")" == "$(id -u)" ]] \
    || die 'the backup archive must be owned by the current Pi user'
  printf '%s' "$resolved"
}

restore_test() {
  local target="$1"
  local requested_archive="$2"
  local archive
  local timestamp
  local restored_snapshot
  local restored_snapshot_sha256
  local admin_count
  confirm_target "$target"
  archive="$(validate_managed_archive_path "$requested_archive")"
  list_archive "$archive" || die 'the selected daily backup is not a readable PostgreSQL archive'

  timestamp="$(TZ=Europe/Prague date '+%Y%m%dt%H%M%S')"
  staging_database="${target}_restore_test_${timestamp}"
  require_database_name "$staging_database"
  database_exists "$staging_database" && die 'generated restore-test database already exists'
  create_database "$staging_database"
  restore_archive "$staging_database" "$archive"
  validate_database "$staging_database"
  admin_count="$(container_psql "$staging_database" \
    "SELECT count(*) FROM auth.users WHERE lower(email) IN ('mat.kadlec@email.cz','marek.hovadik@seznam.cz') AND is_active AND is_admin AND email_verified;")"
  [[ "$admin_count" == "2" ]] || die 'the restored backup does not contain both validated administrators'
  restored_snapshot="$(snapshot_database "$staging_database")"
  restored_snapshot_sha256="$(printf '%s\n' "$restored_snapshot" | sha256sum | awk '{print $1}')"
  drop_database "$staging_database"
  staging_database=""
  printf 'Restore test completed in an isolated temporary database and removed it.\n'
  printf 'Archive SHA-256: %s\n' "$(sha256sum "$archive" | awk '{print $1}')"
  printf 'Restored snapshot SHA-256: %s\n' "$restored_snapshot_sha256"
}

snapshot_database() {
  local database="$1"
  docker exec --interactive --user postgres "$postgres_container" sh -ceu \
    'exec psql --username "$POSTGRES_USER" --dbname "$1" --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align' \
    -- "$database" < "$snapshot_sql"
}

drop_staging_database_on_failure() {
  local status=$?
  trap - EXIT ERR INT TERM HUP
  if ((status != 0)) && [[ -n "$staging_database" ]]; then
    drop_database "$staging_database" || true
  fi
  exit "$status"
}

parse_target_option() {
  [[ "${1:-}" == "--confirm-target" && -n "${2:-}" && $# -eq 2 ]] || {
    usage >&2
    exit 2
  }
  printf '%s' "$2"
}

# Reject an unusable invocation before touching Docker or the host, so a typo
# reports the usage text instead of a container error.
command_name="${1:-}"
# The usage text is the single source of truth for the command list.
if ! usage | sed -n 's/^  \([a-z-][a-z-]*\).*/\1/p' \
  | grep -qxF -- "$command_name"; then
  usage >&2
  exit 2
fi
shift

for required_command in awk basename date dirname docker find flock id install mktemp realpath sha256sum stat sync wc; do
  command -v "$required_command" >/dev/null 2>&1 \
    || die "$required_command is required on the Raspberry Pi"
done
require_host_paths
validate_runtime_identity
exec 9>"$operation_lock"
chmod 600 -- "$operation_lock"
flock -n 9 || die 'another League Analysis PostgreSQL operation is running'
trap drop_staging_database_on_failure EXIT ERR INT TERM HUP

case "$command_name" in
  identity)
    [[ $# -eq 0 ]] || die 'identity accepts no options'
    target="$(configured_database)"
    confirm_target "$target"
    postgres_version="$(container_psql "$target" "SELECT current_setting('server_version');")"
    alembic_head="$(container_psql "$target" 'SELECT version_num FROM public.alembic_version;')"
    printf 'container=%s compose_project=%s compose_service=postgres database=%s postgres=%s alembic=%s host_ports=none\n' \
      "$postgres_container" "$compose_project" "$target" "$postgres_version" "$alembic_head"
    ;;
  snapshot)
    target="$(parse_target_option "$@")"
    confirm_target "$target"
    snapshot_database "$target"
    ;;
  dump)
    target="$(parse_target_option "$@")"
    confirm_target "$target"
    dump_database "$target"
    ;;
  safety-backup)
    [[ "${1:-}" == "--label" && -n "${2:-}" && \
      "${3:-}" == "--confirm-target" && -n "${4:-}" && $# -eq 4 ]] || {
      usage >&2
      exit 2
    }
    label="$2"
    target="$4"
    confirm_target "$target"
    create_backup "$target" "$label"
    ;;
  daily-backup)
    target="$(parse_target_option "$@")"
    daily_backup "$target"
    ;;
  pre-deploy-backup)
    [[ "${1:-}" == "--confirm-target" && -n "${2:-}" && \
      "${3:-}" == "--commit" && -n "${4:-}" && $# -eq 4 ]] || {
      usage >&2
      exit 2
    }
    pre_deploy_backup "$2" "$4"
    ;;
  restore-test)
    [[ "${1:-}" == "--confirm-target" && -n "${2:-}" && \
      "${3:-}" == "--archive" && -n "${4:-}" && $# -eq 4 ]] || {
      usage >&2
      exit 2
    }
    restore_test "$2" "$4"
    ;;
  mirror-dump)
    target="$(parse_target_option "$@")"
    confirm_target "$target"
    dump_mirror_database "$target"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

staging_database=""
trap - EXIT ERR INT TERM HUP
