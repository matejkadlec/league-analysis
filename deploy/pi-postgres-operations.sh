#!/usr/bin/env bash
# Exact-container PostgreSQL operations for the League Analysis Raspberry Pi.
set -Eeuo pipefail

postgres_container="${LGA_POSTGRES_CONTAINER_NAME:-league-analysis-postgres}"
backend_container="${LGA_BACKEND_CONTAINER_NAME:-league-analysis-backend}"
frontend_container="${LGA_FRONTEND_CONTAINER_NAME:-league-analysis-frontend}"
compose_project="${LGA_COMPOSE_PROJECT_NAME:-league-analysis}"
expected_alembic_head="20260809_0006"
deployment_root="${LGA_DEPLOY_ROOT:-$HOME/.local/share/league-analysis}"
backup_root="${LGA_POSTGRES_BACKUP_ROOT:-$deployment_root/backups/postgres}"
state_directory="$deployment_root/state/postgres-operations"
replacement_state="$state_directory/replacement.state"
authority_marker="$state_directory/pi-authoritative.state"
operation_lock="$deployment_root/.postgres-operations.lock"
script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
snapshot_sql="$script_directory/postgres-snapshot.sql"
retention_tool="$script_directory/prune-postgres-daily-backups"

incoming_archive=""
replacement_started=0
replacement_healthy=0
replacement_target=""
replacement_stage=""
replacement_rollback=""

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
    '  restore-test --confirm-target DATABASE --archive ARCHIVE' \
    '  mirror-dump --confirm-target DATABASE' \
    '  replace-from-stdin --confirm-target DATABASE --expected-sha256 SHA256' \
    '  activate-replacement --confirm-target DATABASE --expected-sha256 SHA256' \
    '  confirm-authority --confirm-target DATABASE --expected-sha256 SHA256' \
    '  finalize-replacement --confirm-target DATABASE --expected-sha256 SHA256' \
    '  rollback-replacement --confirm-target DATABASE --expected-sha256 SHA256'
}

die() {
  printf 'League Analysis PostgreSQL operation refused: %s\n' "$1" >&2
  exit 1
}

require_database_name() {
  [[ "$1" =~ ^[a-z][a-z0-9_]{0,62}$ ]] \
    || die 'database names must use lowercase letters, digits, and underscores'
}

require_sha256() {
  [[ "$1" =~ ^[0-9a-f]{64}$ ]] || die 'a lowercase SHA-256 digest is required'
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
  for directory in "$deployment_root" "$backup_root" "$state_directory"; do
    [[ ! -L "$directory" ]] || die "managed directory must not be a symlink: $directory"
    install -d -m 700 -- "$directory"
    chmod 700 -- "$directory"
  done
  [[ -f "$snapshot_sql" && ! -L "$snapshot_sql" ]] \
    || die 'the installed snapshot SQL file is missing or is a symlink'
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

validate_database() {
  local database="$1"
  local alembic_head
  local unvalidated
  alembic_head="$(container_psql "$database" 'SELECT version_num FROM public.alembic_version;')"
  [[ "$alembic_head" == "$expected_alembic_head" ]] \
    || die "database $database has unexpected Alembic head $alembic_head"
  unvalidated="$(container_psql "$database" \
    "SELECT count(*) FROM pg_constraint WHERE connamespace IN (SELECT oid FROM pg_namespace WHERE nspname IN ('auth','core','jobs','public')) AND NOT convalidated;")"
  [[ "$unvalidated" == "0" ]] \
    || die "database $database contains unvalidated constraints"
  [[ "$(container_psql "$database" "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('auth','core','jobs') AND table_type = 'BASE TABLE';")" -gt 0 ]] \
    || die "database $database contains no application tables"
}

create_backup() {
  local database="$1"
  local label="$2"
  local timestamp
  local completed
  local temporary
  require_label "$label"
  timestamp="$(TZ=Europe/Prague date '+%Y%m%dT%H%M%S%z')"
  completed="$backup_root/league-analysis-postgres-${label}-${timestamp}.dump"
  [[ ! -e "$completed" && ! -L "$completed" ]] || die 'backup destination already exists'
  temporary="$(mktemp "$backup_root/.league-analysis-postgres-${label}-${timestamp}.dump.in-progress.XXXXXX")"
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
  confirmed_authority || die 'daily backups require confirmed Pi database authority'
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

validate_daily_archive_path() {
  local requested="$1"
  local resolved
  local basename
  [[ -n "$requested" ]] || die 'a daily backup archive path is required'
  [[ -f "$requested" && ! -L "$requested" ]] \
    || die 'the restore-test archive must be a regular non-symlink file'
  resolved="$(realpath -e -- "$requested")"
  [[ "$(dirname "$resolved")" == "$backup_root" ]] \
    || die 'the restore-test archive must be directly inside the managed backup root'
  basename="$(basename "$resolved")"
  [[ "$basename" =~ ^league-analysis-postgres-daily-[0-9]{8}T[0-9]{6}[+-][0-9]{4}\.dump$ ]] \
    || die 'restore-test accepts only an exact daily-backup filename'
  [[ "$(stat -c '%a' "$resolved")" == "600" ]] \
    || die 'the restore-test archive must have mode 0600'
  [[ "$(stat -c '%u' "$resolved")" == "$(id -u)" ]] \
    || die 'the restore-test archive must be owned by the current Pi user'
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
  confirmed_authority || die 'restore tests require confirmed Pi database authority'
  archive="$(validate_daily_archive_path "$requested_archive")"
  list_archive "$archive" || die 'the selected daily backup is not a readable PostgreSQL archive'

  timestamp="$(TZ=Europe/Prague date '+%Y%m%dt%H%M%S')"
  replacement_stage="${target}_restore_test_${timestamp}"
  require_database_name "$replacement_stage"
  database_exists "$replacement_stage" && die 'generated restore-test database already exists'
  create_database "$replacement_stage"
  restore_archive "$replacement_stage" "$archive"
  validate_database "$replacement_stage"
  admin_count="$(container_psql "$replacement_stage" \
    "SELECT count(*) FROM auth.users WHERE lower(email) IN ('mat.kadlec@email.cz','marek.hovadik@seznam.cz') AND is_active AND is_admin AND email_verified;")"
  [[ "$admin_count" == "2" ]] || die 'the restored backup does not contain both validated administrators'
  restored_snapshot="$(snapshot_database "$replacement_stage")"
  restored_snapshot_sha256="$(printf '%s\n' "$restored_snapshot" | sha256sum | awk '{print $1}')"
  drop_database "$replacement_stage"
  replacement_stage=""
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

wait_healthy() {
  local container="$1"
  local attempts=0
  local status
  while ((attempts < 150)); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    if [[ "$status" == "unhealthy" || "$status" == "exited" || "$status" == "dead" ]]; then
      return 1
    fi
    sleep 2
    attempts=$((attempts + 1))
  done
  return 1
}

stop_application() {
  docker stop --time 20 "$frontend_container" "$backend_container" >/dev/null
}

start_application() {
  docker start "$backend_container" >/dev/null
  wait_healthy "$backend_container" || return 1
  docker start "$frontend_container" >/dev/null
  wait_healthy "$frontend_container"
}

terminate_database_connections() {
  local database="$1"
  container_psql postgres \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$database' AND pid <> pg_backend_pid();" \
    >/dev/null
}

rename_database() {
  local old_name="$1"
  local new_name="$2"
  container_psql postgres "ALTER DATABASE \"$old_name\" RENAME TO \"$new_name\";" >/dev/null
}

set_connections_allowed() {
  local database="$1"
  local allowed="$2"
  container_psql postgres "ALTER DATABASE \"$database\" WITH ALLOW_CONNECTIONS $allowed;" >/dev/null
}

write_replacement_state() {
  local phase="$1"
  local target="$2"
  local stage="$3"
  local rollback="$4"
  local digest="$5"
  local safety_backup="$6"
  local temporary
  temporary="$(mktemp "$state_directory/.replacement-state.XXXXXX")"
  chmod 600 -- "$temporary"
  {
    printf 'phase=%s\n' "$phase"
    printf 'target=%s\n' "$target"
    printf 'stage=%s\n' "$stage"
    printf 'rollback=%s\n' "$rollback"
    printf 'sha256=%s\n' "$digest"
    printf 'safety_backup=%s\n' "$safety_backup"
  } > "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$replacement_state"
  chmod 600 -- "$replacement_state"
}

write_authority_marker() {
  local digest="$1"
  local temporary
  require_sha256 "$digest"
  temporary="$(mktemp "$state_directory/.pi-authoritative.XXXXXX")"
  chmod 600 -- "$temporary"
  {
    printf 'authority=pi\n'
    printf 'source_sha256=%s\n' "$digest"
    printf 'confirmed_at=%s\n' "$(TZ=Europe/Prague date --iso-8601=seconds)"
  } > "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$authority_marker"
  chmod 600 -- "$authority_marker"
}

confirmed_authority() {
  [[ -f "$authority_marker" && ! -L "$authority_marker" ]] || return 1
  [[ "$(stat -c '%a' "$authority_marker")" == "600" ]] || return 1
  [[ "$(state_value_from_file authority "$authority_marker")" == "pi" ]]
}

state_value_from_file() {
  local key="$1"
  local file="$2"
  awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; found=1} END {if (!found) exit 1}' "$file"
}

state_value() {
  local key="$1"
  state_value_from_file "$key" "$replacement_state"
}

load_replacement_state() {
  [[ -f "$replacement_state" && ! -L "$replacement_state" ]] \
    || die 'no regular pending replacement state exists'
  state_phase="$(state_value phase)"
  state_target="$(state_value target)"
  state_stage="$(state_value stage)"
  state_rollback="$(state_value rollback)"
  state_sha256="$(state_value sha256)"
  state_safety_backup="$(state_value safety_backup)"
  require_database_name "$state_target"
  require_database_name "$state_stage"
  require_database_name "$state_rollback"
  require_sha256 "$state_sha256"
  [[ "$state_safety_backup" == "$backup_root/"* ]] \
    || die 'replacement state references a backup outside the managed root'
}

recover_interrupted_replacement() {
  local status=$?
  trap - EXIT ERR INT TERM HUP
  set +e
  if [[ -n "$incoming_archive" && "$incoming_archive" == "$state_directory/.incoming-"* ]]; then
    rm -f -- "$incoming_archive"
  fi
  if ((status != 0 && replacement_started == 1 && replacement_healthy == 0)); then
    printf 'Replacement failed; attempting automatic restoration of the pre-migration database.\n' >&2
    docker stop --time 20 "$frontend_container" "$backend_container" >/dev/null 2>&1
    if database_exists "$replacement_rollback"; then
      if database_exists "$replacement_target"; then
        failed_database="${replacement_target}_failed_$(date '+%Y%m%d%H%M%S')"
        set_connections_allowed "$replacement_target" false
        terminate_database_connections "$replacement_target"
        rename_database "$replacement_target" "$failed_database"
      else
        failed_database=""
      fi
      set_connections_allowed "$replacement_rollback" true
      rename_database "$replacement_rollback" "$replacement_target"
      if start_application; then
        [[ -z "$failed_database" ]] || drop_database "$failed_database"
        rm -f -- "$replacement_state"
        printf 'Automatic database rollback completed.\n' >&2
      else
        printf 'Automatic rollback could not restore application health; preserve the safety backup and inspect immediately.\n' >&2
      fi
    elif database_exists "$replacement_stage"; then
      drop_database "$replacement_stage"
      rm -f -- "$replacement_state"
    fi
  elif ((status != 0)) && [[ -n "$replacement_stage" ]] \
    && database_exists "$replacement_stage"; then
    drop_database "$replacement_stage"
  fi
  exit "$status"
}

replace_from_stdin() {
  local target="$1"
  local expected_sha="$2"
  local timestamp
  local actual_sha
  local safety_backup
  confirm_target "$target"
  require_sha256 "$expected_sha"
  [[ ! -e "$replacement_state" && ! -L "$replacement_state" ]] \
    || die 'a previous database replacement still awaits finalize or rollback'
  confirmed_authority \
    && die 'the Pi database is already authoritative; initial local-to-Pi replacement is disabled'

  incoming_archive="$(mktemp "$state_directory/.incoming-lga79.XXXXXX.dump")"
  chmod 600 -- "$incoming_archive"
  cat > "$incoming_archive"
  sync -f "$incoming_archive"
  [[ -s "$incoming_archive" ]] || die 'received database archive is empty'
  actual_sha="$(sha256sum "$incoming_archive" | awk '{print $1}')"
  [[ "$actual_sha" == "$expected_sha" ]] || die 'received archive SHA-256 does not match the source'
  list_archive "$incoming_archive" || die 'received archive is not readable by PostgreSQL 18 pg_restore'

  safety_backup="$(create_backup "$target" pre-lga79)"
  timestamp="$(TZ=Europe/Prague date '+%Y%m%dt%H%M%S')"
  replacement_target="$target"
  replacement_stage="${target}_lga79_stage_${timestamp}"
  replacement_rollback="${target}_lga79_rollback_${timestamp}"
  require_database_name "$replacement_stage"
  require_database_name "$replacement_rollback"
  database_exists "$replacement_stage" && die 'generated staging database already exists'
  database_exists "$replacement_rollback" && die 'generated rollback database already exists'

  create_database "$replacement_stage"
  restore_archive "$replacement_stage" "$incoming_archive"
  validate_database "$replacement_stage"
  write_replacement_state prepared "$target" "$replacement_stage" \
    "$replacement_rollback" "$expected_sha" "$safety_backup"

  replacement_started=1
  stop_application
  set_connections_allowed "$target" false
  terminate_database_connections "$target"
  rename_database "$target" "$replacement_rollback"
  rename_database "$replacement_stage" "$target"
  write_replacement_state swapped "$target" "$replacement_stage" \
    "$replacement_rollback" "$expected_sha" "$safety_backup"
  validate_database "$target"
  write_replacement_state awaiting_snapshot "$target" "$replacement_stage" \
    "$replacement_rollback" "$expected_sha" "$safety_backup"
  replacement_healthy=1
  rm -f -- "$incoming_archive"
  incoming_archive=""
  printf 'Staged replacement succeeded with application writers stopped.\n'
  printf 'Compare the source and Pi snapshots, then activate or roll back.\n'
  printf 'Source archive SHA-256: %s\n' "$expected_sha"
  printf 'Pre-migration safety backup: %s\n' "$safety_backup"
}

activate_replacement() {
  local target="$1"
  local expected_sha="$2"
  confirm_target "$target"
  require_sha256 "$expected_sha"
  load_replacement_state
  [[ "$state_phase" == "awaiting_snapshot" ]] \
    || die 'replacement state is not awaiting snapshot validation'
  [[ "$state_target" == "$target" && "$state_sha256" == "$expected_sha" ]] \
    || die 'activation confirmation does not match the pending replacement'
  database_exists "$state_rollback" || die 'pending rollback database is missing'

  replacement_target="$state_target"
  replacement_stage="$state_stage"
  replacement_rollback="$state_rollback"
  replacement_started=1
  replacement_healthy=0
  if ! start_application; then
    die 'migrated application containers did not become healthy'
  fi
  validate_database "$target"
  write_replacement_state awaiting_validation "$target" "$state_stage" \
    "$state_rollback" "$expected_sha" "$state_safety_backup"
  replacement_healthy=1
  printf 'Migrated application containers are healthy; replacement awaits final validation.\n'
}

confirm_authority() {
  local target="$1"
  local expected_sha="$2"
  local admin_count
  local safety_count
  confirm_target "$target"
  require_sha256 "$expected_sha"
  [[ ! -e "$replacement_state" && ! -L "$replacement_state" ]] \
    || die 'database replacement still has unresolved rollback state'
  validate_database "$target"
  wait_healthy "$backend_container" || die 'backend is not healthy'
  wait_healthy "$frontend_container" || die 'frontend is not healthy'
  admin_count="$(container_psql "$target" \
    "SELECT count(*) FROM auth.users WHERE lower(email) IN ('mat.kadlec@email.cz','marek.hovadik@seznam.cz') AND is_active AND is_admin AND email_verified;")"
  [[ "$admin_count" == "2" ]] || die 'both validated full administrators are required'
  safety_count="$(find "$backup_root" -maxdepth 1 -type f -name 'league-analysis-postgres-pre-lga79-*.dump' -perm 0600 -printf '.' | wc -c)"
  [[ "$safety_count" -ge 1 ]] || die 'a private pre-LGA-79 safety backup is required'
  write_authority_marker "$expected_sha"
  printf 'Pi PostgreSQL authority recorded after migration validation.\n'
}

finalize_replacement() {
  local target="$1"
  local expected_sha="$2"
  confirm_target "$target"
  require_sha256 "$expected_sha"
  load_replacement_state
  [[ "$state_phase" == "awaiting_validation" ]] \
    || die 'replacement state is not ready for finalization'
  [[ "$state_target" == "$target" && "$state_sha256" == "$expected_sha" ]] \
    || die 'finalize confirmation does not match the pending replacement'
  database_exists "$state_rollback" || die 'pending rollback database is missing'
  drop_database "$state_rollback"
  rm -f -- "$replacement_state"
  write_authority_marker "$expected_sha"
  printf 'Database replacement finalized; the safety backup remains retained.\n'
}

rollback_replacement() {
  local target="$1"
  local expected_sha="$2"
  local failed_database
  confirm_target "$target"
  require_sha256 "$expected_sha"
  load_replacement_state
  [[ "$state_phase" == "awaiting_snapshot" || "$state_phase" == "awaiting_validation" ]] \
    || die 'replacement state is not ready for operator rollback'
  [[ "$state_target" == "$target" && "$state_sha256" == "$expected_sha" ]] \
    || die 'rollback confirmation does not match the pending replacement'
  database_exists "$state_rollback" || die 'pending rollback database is missing'

  failed_database="${target}_rejected_$(TZ=Europe/Prague date '+%Y%m%dt%H%M%S')"
  require_database_name "$failed_database"
  stop_application
  set_connections_allowed "$target" false
  terminate_database_connections "$target"
  rename_database "$target" "$failed_database"
  set_connections_allowed "$state_rollback" true
  rename_database "$state_rollback" "$target"
  if ! start_application; then
    die 'operator rollback restored the database name but application health failed'
  fi
  drop_database "$failed_database"
  rm -f -- "$replacement_state"
  printf 'Operator rollback restored the pre-migration database.\n'
}

parse_target_option() {
  [[ "${1:-}" == "--confirm-target" && -n "${2:-}" && $# -eq 2 ]] || {
    usage >&2
    exit 2
  }
  printf '%s' "$2"
}

for required_command in awk basename date dirname docker find flock id install mktemp realpath sha256sum stat sync wc; do
  command -v "$required_command" >/dev/null 2>&1 \
    || die "$required_command is required on the Raspberry Pi"
done
require_host_paths
validate_runtime_identity
exec 9>"$operation_lock"
chmod 600 -- "$operation_lock"
flock -n 9 || die 'another League Analysis PostgreSQL operation is running'
trap recover_interrupted_replacement EXIT ERR INT TERM HUP

command_name="${1:-}"
[[ -n "$command_name" ]] || {
  usage >&2
  exit 2
}
shift

case "$command_name" in
  identity)
    [[ $# -eq 0 ]] || die 'identity accepts no options'
    target="$(configured_database)"
    confirm_target "$target"
    postgres_version="$(container_psql "$target" "SELECT current_setting('server_version');")"
    alembic_head="$(container_psql "$target" 'SELECT version_num FROM public.alembic_version;')"
    authority="unconfirmed"
    confirmed_authority && authority="pi"
    printf 'container=%s compose_project=%s compose_service=postgres database=%s postgres=%s alembic=%s host_ports=none authority=%s\n' \
      "$postgres_container" "$compose_project" "$target" "$postgres_version" "$alembic_head" "$authority"
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
    confirmed_authority || die 'mirror exports require confirmed Pi database authority'
    dump_mirror_database "$target"
    ;;
  replace-from-stdin)
    [[ "${1:-}" == "--confirm-target" && -n "${2:-}" && \
      "${3:-}" == "--expected-sha256" && -n "${4:-}" && $# -eq 4 ]] || {
      usage >&2
      exit 2
    }
    replace_from_stdin "$2" "$4"
    ;;
  activate-replacement)
    [[ "${1:-}" == "--confirm-target" && -n "${2:-}" && \
      "${3:-}" == "--expected-sha256" && -n "${4:-}" && $# -eq 4 ]] || {
      usage >&2
      exit 2
    }
    activate_replacement "$2" "$4"
    ;;
  confirm-authority)
    [[ "${1:-}" == "--confirm-target" && -n "${2:-}" && \
      "${3:-}" == "--expected-sha256" && -n "${4:-}" && $# -eq 4 ]] || {
      usage >&2
      exit 2
    }
    confirm_authority "$2" "$4"
    ;;
  finalize-replacement)
    [[ "${1:-}" == "--confirm-target" && -n "${2:-}" && \
      "${3:-}" == "--expected-sha256" && -n "${4:-}" && $# -eq 4 ]] || {
      usage >&2
      exit 2
    }
    finalize_replacement "$2" "$4"
    ;;
  rollback-replacement)
    [[ "${1:-}" == "--confirm-target" && -n "${2:-}" && \
      "${3:-}" == "--expected-sha256" && -n "${4:-}" && $# -eq 4 ]] || {
      usage >&2
      exit 2
    }
    rollback_replacement "$2" "$4"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

replacement_healthy=1
trap - EXIT ERR INT TERM HUP
