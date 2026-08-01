#!/usr/bin/env bash
# Portable CI entry point shared with local development.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly repository_root

"$repository_root/test.sh"

if [[ -f "$repository_root/backend/alembic.ini" ]]; then
  if [[ "${LGA_VALIDATE_MIGRATIONS:-}" != "1" ]]; then
    printf 'Alembic exists, but LGA_VALIDATE_MIGRATIONS=1 is required for database validation.\n' >&2
    exit 1
  fi
  (
    cd "$repository_root/backend"
    uv run alembic upgrade head
  )
else
  printf 'Alembic migration validation skipped: LGA-12 has not added backend/alembic.ini yet.\n'
fi

printf 'Deterministic CI gate passed.\n'
