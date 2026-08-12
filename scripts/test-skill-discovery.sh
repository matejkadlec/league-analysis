#!/usr/bin/env bash
# Keep every workflow skill resolvable from both agent discovery roots.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

fail() {
  printf 'Skill discovery regression failed: %s\n' "$1" >&2
  exit 1
}

for skill in flow1 flow2 qa1 qa2; do
  [[ -f "$repository_root/.claude/skills/$skill/SKILL.md" ]] \
    || fail ".claude/skills/$skill/SKILL.md is missing."
  [[ -L "$repository_root/.agents/skills/$skill" ]] \
    || fail ".agents/skills/$skill must be a symlink."
  [[ -f "$repository_root/.agents/skills/$skill/SKILL.md" ]] \
    || fail ".agents/skills/$skill symlink does not resolve to a SKILL.md."
done

printf 'Skill discovery regression passed.\n'
