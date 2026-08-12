#!/usr/bin/env bash
# Exercise retention against successful, partial, and unrelated artifacts.
set -Eeuo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
retention_tool="$repository_root/deploy/prune-postgres-daily-backups.sh"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/league-analysis-backup-retention.XXXXXX")"

cleanup() {
  [[ "$test_directory" == "${TMPDIR:-/tmp}/league-analysis-backup-retention."* ]] \
    && rm -rf -- "$test_directory"
}
trap cleanup EXIT

fail() {
  printf 'PostgreSQL backup retention regression failed: %s\n' "$1" >&2
  exit 1
}

for day in 01 02 03 04 05 06 07 08 09; do
  install -m 600 /dev/null \
    "$test_directory/league-analysis-postgres-daily-202608${day}T000000+0200.dump"
done
for day in 01 02 03 04 05 06 07 08 09; do
  install -m 600 /dev/null \
    "$test_directory/league-analysis-postgres-pre-deploy-202608${day}T120000+0200-abcdef012345.dump"
done
install -m 600 /dev/null \
  "$test_directory/.league-analysis-postgres-daily-20260810T000000+0200.dump.in-progress.failed"
install -m 600 /dev/null \
  "$test_directory/.league-analysis-postgres-pre-deploy-20260810T120000+0200-abcdef012345.dump.in-progress.failed"
install -m 600 /dev/null \
  "$test_directory/league-analysis-postgres-pre-lga79-20260801T000000+0200.dump"
install -m 600 /dev/null "$test_directory/unrelated.dump"

"$retention_tool" "$test_directory" >/dev/null

daily_count="$(find "$test_directory" -maxdepth 1 -type f \
  -name 'league-analysis-postgres-daily-*.dump' | wc -l)"
[[ "$daily_count" == "7" ]] || fail 'retention must keep exactly seven successful daily archives.'
pre_deploy_count="$(find "$test_directory" -maxdepth 1 -type f \
  -name 'league-analysis-postgres-pre-deploy-*.dump' | wc -l)"
[[ "$pre_deploy_count" == "7" ]] \
  || fail 'retention must keep exactly seven successful pre-deployment archives.'
for day in 03 04 05 06 07 08 09; do
  [[ -f "$test_directory/league-analysis-postgres-daily-202608${day}T000000+0200.dump" ]] \
    || fail "expected retained archive for day $day"
done
for day in 03 04 05 06 07 08 09; do
  [[ -f "$test_directory/league-analysis-postgres-pre-deploy-202608${day}T120000+0200-abcdef012345.dump" ]] \
    || fail "expected retained pre-deployment archive for day $day"
done
[[ -f "$test_directory/.league-analysis-postgres-daily-20260810T000000+0200.dump.in-progress.failed" ]] \
  || fail 'a failed partial artifact must not count or be removed by retention.'
[[ -f "$test_directory/.league-analysis-postgres-pre-deploy-20260810T120000+0200-abcdef012345.dump.in-progress.failed" ]] \
  || fail 'a failed pre-deployment partial must not count or be removed.'
[[ -f "$test_directory/league-analysis-postgres-pre-lga79-20260801T000000+0200.dump" ]] \
  || fail 'the initial-migration safety backup must not be expired.'
[[ -f "$test_directory/unrelated.dump" ]] || fail 'unrelated files must not be removed.'

printf 'PostgreSQL backup retention regression passed.\n'
