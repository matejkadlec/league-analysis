#!/usr/bin/env bash
# Keep the documented Flow 1 batching and handoff contract deterministic.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
flow="$repository_root/.claude/skills/flow1/SKILL.md"
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
require_text "$flow" 'At most **two** independently'
require_text "$flow" 'selected batches may be pending or unmerged at once, counting both `PENDING CR`'
require_text "$flow" 'and `PENDING USER QA`.'
require_text "$flow" 'one `flow1` invocation may publish up to two ready'
require_text "$flow" 'Continue after publication only with an independent batch recorded in the'
require_text "$flow" 'Newly selected `flow1` task work uses a dedicated linked worktree by default.'
require_text "$flow" '`flow1/<jira-keys>-<scope>`'
require_text "$flow" 'Working in the primary checkout requires a concrete exceptional'
require_text "$flow" '[ -e "<qa-worktree>/.env" ] || [ -L "<qa-worktree>/.env" ]'
require_text "$flow" 'Refusing to overwrite the existing QA .env file.'
require_text "$flow" 'cd <primary-worktree>` followed by'
require_text "$flow" 'Final handoff maps every selected ticket to its pull request'
require_text "$flow" 'Stop the remaining invocation immediately'
require_text "$flow" 'largest safe coherent batch'

# The root guide must gate every lifecycle entry point on the skills and keep
# the non-negotiable delivery boundaries always loaded.
require_text "$agent_guide" 'invoke the matching'
require_text "$agent_guide" 'repository skill (flow1, flow2, qa1, or qa2) and follow its stop boundary.'
require_text "$agent_guide" 'ready for review, never a draft'
require_text "$agent_guide" 'owner-managed immediately'
require_text "$agent_guide" 'Do not push task work directly to `master`'

# Every workflow skill must exist for both discovery roots.
for skill in flow1 flow2 qa1 qa2; do
  [[ -f "$repository_root/.claude/skills/$skill/SKILL.md" ]] \
    || fail ".claude/skills/$skill/SKILL.md is missing."
  [[ -L "$repository_root/.agents/skills/$skill" ]] \
    || fail ".agents/skills/$skill must be a symlink."
  [[ -f "$repository_root/.agents/skills/$skill/SKILL.md" ]] \
    || fail ".agents/skills/$skill symlink does not resolve to a SKILL.md."
done

printf '%s\n' \
  'Flow 1 representative dry run:' \
  '  PR 1: example LGA-101..LGA-106 (shared workflow files, one gate and rollback boundary)' \
  '  PR 2: example LGA-107..LGA-109 (independent AI-only ingestion rollback boundary)' \
  '  Excluded: example LGA-110 (User QA requires a separate owner judgment)' \
  'Flow 1 policy regression checks passed.'
