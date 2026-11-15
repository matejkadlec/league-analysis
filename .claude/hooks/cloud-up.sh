#!/usr/bin/env bash
# Claude Code SessionStart hook (async, startup and resume): in a cloud session,
# run the environment's `lga-cloud-up` helper in the background. It starts
# PostgreSQL 18, syncs the backend and frontend dependencies, installs a newer
# pinned Node or Playwright Chromium when needed, and creates the local `.env`.
# The helper belongs to the cloud environment, not to this repository, so the
# hook exits at once on a local machine or wherever the helper is missing.
# Output: logs/lga-cloud-up.log (gitignored); its last line is `exit <status>`.
set -uo pipefail

[[ "${CLAUDE_CODE_REMOTE:-}" == "true" ]] || exit 0
command -v lga-cloud-up >/dev/null 2>&1 || exit 0

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$root" || exit 0
mkdir -p logs
log="logs/lga-cloud-up.log"

{
  printf 'lga-cloud-up started %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  lga-cloud-up
  printf 'exit %s\n' "$?"
} >"$log" 2>&1
exit 0
