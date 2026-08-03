#!/usr/bin/env bash
# Keep the documented Flow 1 batching and handoff contract deterministic.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
flow="$repository_root/docs/ai-development-flow.md"
agent_guide="$repository_root/AGENTS.md"

fail() {
  printf 'Flow 1 policy regression failed: %s\n' "$1" >&2
  exit 1
}

require_text() {
  local file="$1"
  local expected="$2"

  grep -Fq -- "$expected" "$file" || fail "$file is missing: $expected"
}

require_text "$flow" 'Expected planning scale is approximately **3 large**, **5'
require_text "$flow" 'medium**, or **10 small** tickets'
require_text "$flow" 'These are planning expectations, not hard quotas or'
require_text "$flow" 'changed-line budgets.'
require_text "$flow" 'materially fewer tickets than the expected scale'
require_text "$flow" 'up to **2 ready pull requests** by default'
require_text "$flow" 'A third ready pull request is'
require_text "$flow" 'allowed only when all three batches are small, AI-only, mutually independent,'
require_text "$flow" 'Continue after publication only with independent batches recorded in the'
require_text "$flow" 'Newly selected `flow1` task work uses a dedicated linked worktree by default.'
require_text "$flow" '`flow1/<jira-keys>-<scope>`'
require_text "$flow" 'Working in the primary checkout requires a concrete exceptional'
require_text "$flow" 'Final handoff maps every selected ticket to its pull request'
require_text "$flow" 'Stop the remaining invocation immediately'

require_text "$agent_guide" 'largest safe coherent batch'
require_text "$agent_guide" 'Planning scale is approximately 3'
require_text "$agent_guide" 'large, 5 medium, or 10 small tickets'
require_text "$agent_guide" 'dedicated linked worktree by default'
require_text "$agent_guide" 'One preselected invocation may publish up to two'
require_text "$agent_guide" 'independent ready pull requests'

printf '%s\n' \
  'Flow 1 representative dry run:' \
  '  PR 1: example LGA-101..LGA-106 (shared workflow files, one gate and rollback boundary)' \
  '  PR 2: example LGA-107..LGA-109 (independent AI-only ingestion rollback boundary)' \
  '  Excluded: example LGA-110 (User QA requires a separate owner judgment)' \
  'Flow 1 policy regression checks passed.'
