#!/usr/bin/env bash
# Claude Code PostToolUse hook: after an edit to a Python file under backend/,
# run `ruff check` on that one file (well under a second). Exit code 2 sends the
# findings back to Claude so it fixes them at once. The gate still runs the
# complete Ruff, Pyright and test suite; this is only the fast first signal.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
file_path="$(python3 -c 'import json, sys; print(json.load(sys.stdin).get("tool_input", {}).get("file_path", ""))' 2>/dev/null || true)"

case "$file_path" in
  "$root"/backend/.venv/*) exit 0 ;;
  "$root"/backend/*.py) ;;
  *) exit 0 ;;
esac
[[ -f "$file_path" ]] || exit 0
[[ -d "$root/backend/.venv" ]] || exit 0
command -v uv >/dev/null 2>&1 || exit 0

cd "$root/backend" || exit 0
if ! output="$(uv run --frozen --no-sync --quiet ruff check --quiet "$file_path" 2>&1)"; then
  {
    printf 'ruff check failed after editing %s:\n' "${file_path#"$root"/}"
    printf '%s\n' "$output"
  } >&2
  exit 2
fi
exit 0
