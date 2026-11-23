#!/usr/bin/env bash
# Claude Code PostToolUse hook: after an edit to a Python file under backend/,
# run `ruff check` on that one file (well under a second). Exit code 2 sends the
# findings back to Claude so it fixes them at once. The gate still runs the
# complete Ruff, Pyright and test suite; this is only the fast first signal.
#
# The checkout is the one that holds the edited file, not only the project
# directory, so an edit in a flow1/flow2 batch worktree
# (../league-analysis-worktrees/<dir>) is checked against that worktree's
# configuration. A new worktree without its own backend/.venv borrows the
# project directory's Ruff.
set -uo pipefail

file_path="$(python3 -c 'import json, sys; print(json.load(sys.stdin).get("tool_input", {}).get("file_path", ""))' 2>/dev/null || true)"

[[ "$file_path" == *.py && -f "$file_path" ]] || exit 0
root="$(git -C "$(dirname "$file_path")" rev-parse --show-toplevel 2>/dev/null)" || exit 0

case "$file_path" in
  "$root"/backend/.venv/*) exit 0 ;;
  "$root"/backend/*.py) ;;
  *) exit 0 ;;
esac

ruff="$root/backend/.venv/bin/ruff"
if [[ ! -x "$ruff" && -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  ruff="$CLAUDE_PROJECT_DIR/backend/.venv/bin/ruff"
fi
[[ -x "$ruff" ]] || exit 0

cd "$root/backend" || exit 0
if ! output="$("$ruff" check --quiet "$file_path" 2>&1)"; then
  {
    printf 'ruff check failed after editing %s:\n' "${file_path#"$root"/}"
    printf '%s\n' "$output"
  } >&2
  exit 2
fi
exit 0
