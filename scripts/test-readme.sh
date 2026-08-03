#!/usr/bin/env bash
# Keep README prerequisites and project-overview heading boundaries accurate.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readme="$repository_root/README.md"
project_overview="$repository_root/docs/project-overview.md"

fail() {
  printf 'README regression failed: %s\n' "$1" >&2
  exit 1
}

grep -Fq 'Python 3.14.6 and uv 0.12.1' "$readme" \
  || fail 'README must name the exact supported Python version.'
grep -Fq 'an already-provisioned PostgreSQL 18.4 database and role matching the' "$readme" \
  || fail 'README must require the configured database and role.'
grep -Fq 'migration command creates application schemas, not the database or role' "$readme" \
  || fail 'README must distinguish migration scope from database provisioning.'
grep -Fqx '## Git hooks and worktrees' "$project_overview" \
  || fail 'Git hooks must be a top-level project-overview section.'
if grep -Fqx '### Git hooks and worktrees' "$project_overview"; then
  fail 'Git hooks must not be nested under production deployment.'
fi

printf 'README regression passed.\n'
