#!/usr/bin/env bash
# Deterministic safety-contract checks for database migration/operations tools.
# shellcheck disable=SC2016  # Assertions intentionally match literal shell source.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pi_operations="$repository_root/deploy/pi-postgres-operations.sh"
pi_installer="$repository_root/deploy/install-pi-postgres-operations.sh"
backup_timer_installer="$repository_root/deploy/install-pi-postgres-backup-timer.sh"
backup_retention="$repository_root/deploy/prune-postgres-daily-backups.sh"
backup_retention_regression="$repository_root/scripts/test-postgres-backup-retention.sh"
backup_service="$repository_root/deploy/systemd/league-analysis-postgres-backup.service"
backup_timer="$repository_root/deploy/systemd/league-analysis-postgres-backup.timer"
mirror_installer="$repository_root/deploy/install-local-postgres-mirror.sh"
mirror_script="$repository_root/backend/scripts/mirror_pi_postgres_to_local.py"
mirror_service="$repository_root/deploy/systemd/league-analysis-local-postgres-mirror.service"
mirror_timer="$repository_root/deploy/systemd/league-analysis-local-postgres-mirror.timer"
snapshot_sql="$repository_root/deploy/postgres-snapshot.sql"
admin_reconciler="$repository_root/backend/scripts/reconcile_admin_account.py"
initial_migration="$repository_root/backend/scripts/migrate_local_postgres_to_pi.py"

fail() {
  printf 'PostgreSQL operations regression failed: %s\n' "$1" >&2
  exit 1
}

for required_file in \
  "$pi_operations" \
  "$pi_installer" \
  "$backup_timer_installer" \
  "$backup_retention" \
  "$backup_retention_regression" \
  "$backup_service" \
  "$backup_timer" \
  "$mirror_installer" \
  "$mirror_script" \
  "$mirror_service" \
  "$mirror_timer" \
  "$snapshot_sql" \
  "$admin_reconciler" \
  "$initial_migration"; do
  [[ -f "$required_file" ]] || fail "missing ${required_file#"$repository_root/"}"
done
bash -n "$pi_operations"
bash -n "$pi_installer"
bash -n "$backup_timer_installer"
bash -n "$backup_retention"
bash -n "$backup_retention_regression"
bash -n "$mirror_installer"

grep -Fq 'name=^/${container}$' "$pi_operations" \
  || fail 'Pi operations must resolve exact container names.'
grep -Fq 'com.docker.compose.project' "$pi_operations" \
  || fail 'Pi operations must verify the Compose project label.'
grep -Fq 'com.docker.compose.service' "$pi_operations" \
  || fail 'Pi operations must verify the Compose service label.'
grep -Fq "PostgreSQL unexpectedly publishes a host port" "$pi_operations" \
  || fail 'Pi operations must fail if PostgreSQL has a host binding.'
grep -Fq -- '--no-owner --no-privileges --exit-on-error' "$pi_operations" \
  || fail 'staged restores must fail clearly and avoid source-role ownership.'
grep -Fq 'pre-lga79' "$pi_operations" \
  || fail 'initial replacement must create a named safety backup.'
grep -Fq 'awaiting_validation' "$pi_operations" \
  || fail 'replacement must retain rollback state through external validation.'
grep -Fq 'awaiting_snapshot' "$pi_operations" \
  || fail 'replacement must compare snapshots before application writers restart.'
grep -Fq 'activate-replacement' "$pi_operations" \
  || fail 'the guarded application activation path is missing.'
grep -Fq 'rollback-replacement' "$pi_operations" \
  || fail 'the explicit rollback path is missing.'
grep -Fq 'finalize-replacement' "$pi_operations" \
  || fail 'the explicit finalize path is missing.'
grep -Fq 'pi-authoritative.state' "$pi_operations" \
  || fail 'the durable Pi authority gate is missing.'
grep -Fq 'adopt-relocated-authority --confirm-target DATABASE' "$pi_operations" \
  || fail 'the explicit relocated-authority adoption path is missing.'
adoption_function="$(sed -n '/^adopt_relocated_authority()/,/^}/p' "$pi_operations")"
for required_adoption_gate in \
  'confirmed_authority' \
  'validate_database "$target"' \
  'wait_healthy "$backend_container"' \
  'wait_healthy "$frontend_container"' \
  'both validated full administrators are required' \
  'create_backup "$target" pre-authority-adoption' \
  'write_authority_marker "$safety_sha256"'; do
  grep -Fq "$required_adoption_gate" <<< "$adoption_function" \
    || fail "relocated authority adoption is missing: $required_adoption_gate"
done
grep -Fq 'initial local-to-Pi replacement is disabled' "$pi_operations" \
  || fail 'confirmed Pi authority must disable repeated initial replacement.'
grep -Fq 'daily backups require confirmed Pi database authority' "$pi_operations" \
  || fail 'daily backups must require confirmed Pi authority.'
grep -Fq 'archive="$(create_backup "$target" daily)"' "$pi_operations" \
  || fail 'the daily path must finish a validated archive before retention.'
retention_line="$(grep -n -F '"$retention_tool" "$backup_root"' "$pi_operations" | cut -d: -f1)"
backup_line="$(grep -n -F 'archive="$(create_backup "$target" daily)"' "$pi_operations" | cut -d: -f1)"
((retention_line > backup_line)) \
  || fail 'daily retention must run only after a successful backup.'
grep -Fq 'OnCalendar=*-*-* 00:00:00 Europe/Prague' "$backup_timer" \
  || fail 'the daily timer must explicitly use Prague midnight.'
grep -Fq 'Persistent=true' "$backup_timer" \
  || fail 'the daily timer must catch up after Pi downtime.'
grep -Fq 'UMask=0077' "$backup_service" \
  || fail 'the backup service must default to private files.'
grep -Fq 'daily-backup --confirm-target league_analysis' "$backup_service" \
  || fail 'the backup service must confirm the exact League Analysis database.'
grep -Fq 'restore-test accepts only an exact daily-backup filename' "$pi_operations" \
  || fail 'restore tests must reject archives outside the daily backup contract.'
grep -Fq 'mirror exports require confirmed Pi database authority' "$pi_operations" \
  || fail 'mirror exports must require confirmed Pi authority.'
grep -Fq 'mirror-dump)' "$pi_operations" \
  || fail 'the Pi read-only mirror export is missing.'
mirror_case="$(sed -n '/^  mirror-dump)/,/^    ;;/p' "$pi_operations")"
grep -Fq 'dump_mirror_database "$target"' <<< "$mirror_case" \
  || fail 'the Pi mirror command must use only a native database dump.'
if grep -Eq 'restore|replace|activate|finalize|rollback|create_database|drop_database' <<< "$mirror_case"; then
  fail 'the Pi mirror export contains a database write operation.'
fi
grep -Fq 'mirror-dump --confirm-target' "$mirror_script" \
  || fail 'the local mirror must use the read-only Pi export.'
grep -Fq 'snapshot --confirm-target' "$mirror_script" \
  || fail 'the local mirror must compare the read-only Pi snapshot first.'
grep -Fq -- '--compress=zstd:3' "$pi_operations" \
  || fail 'frequent mirror exports must use the reviewed fast compression level.'
grep -Fq -- '--compress=gzip:9' "$pi_operations" \
  || fail 'daily and safety backups must retain strong gzip compression.'
if grep -Eq 'replace-from-stdin|activate-replacement|finalize-replacement|rollback-replacement|safety-backup|daily-backup' "$mirror_script"; then
  fail 'the local mirror must not contain any remote Pi write command.'
fi
grep -Fq 'download_remote_archive(host, database, archive)' "$mirror_script" \
  || fail 'the complete remote archive must precede local activation.'
grep -Fq 'activate_archive(config, paths, archive, digest)' "$mirror_script" \
  || fail 'the downloaded archive must use the guarded local activation path.'
grep -Fq 'fcntl.LOCK_EX | fcntl.LOCK_NB' "$mirror_script" \
  || fail 'the local mirror must refuse overlapping executions.'
grep -Fq 'OnCalendar=*-*-* *:0/5:00 Europe/Prague' "$mirror_timer" \
  || fail 'the local mirror timer must use the documented Prague cadence.'
grep -Fq 'Persistent=true' "$mirror_timer" \
  || fail 'the local mirror timer must catch up after local downtime.'
grep -Fq -- '--config %h/projects/league-analysis/.env --apply' "$mirror_service" \
  || fail 'the automatic mirror must use the canonical private local configuration.'
if grep -Eq 'docker ps[^\n]*\|[^\n]*grep|docker ps[^\n]*grep' "$pi_operations"; then
  fail 'Pi operations must not identify PostgreSQL through docker ps and grep.'
fi

"$backup_retention_regression" >/dev/null \
  || fail 'daily backup retention regression failed.'

grep -Fq 'AuthService.get_password_hash(password)' "$admin_reconciler" \
  || fail 'admin reconciliation must use the application password hasher.'
grep -Fq 'authenticate_user(normalized_email, password)' "$admin_reconciler" \
  || fail 'admin reconciliation must exercise normal authentication.'
if grep -Eq 'add_argument\([^\n]*--password([^a-z-]|$)' "$admin_reconciler"; then
  fail 'the admin password must never be accepted as a command-line value.'
fi
grep -Fq 'child_environment["PGPASSWORD"]' "$initial_migration" \
  || fail 'local libpq authentication must stay in the child environment.'
grep -Fq 'remote_snapshot != source_snapshot' "$initial_migration" \
  || fail 'initial migration must compare the restored Pi snapshot.'
grep -Fq 'rollback_remote(host, remote_database, digest)' "$initial_migration" \
  || fail 'a snapshot mismatch must trigger rollback.'
if grep -Eiq 'password_hash|key_value' "$snapshot_sql"; then
  fail 'database snapshots must not expose password hashes or Riot keys.'
fi

printf 'PostgreSQL migration and operations contract regression passed.\n'
