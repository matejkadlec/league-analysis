#!/usr/bin/env bash
# Decide whether a change set touches only documentation files.
#
# Usage: detect-docs-only-change.sh <base-sha>
#
# Prints `docs_only=true` when every file changed between the base commit and
# HEAD is documentation (anything under docs/ or any Markdown file, including
# the CLAUDE.md symlinks). Any unknown base, empty diff, or non-documentation
# path prints `docs_only=false` so callers fall back to the full gate. When
# GITHUB_OUTPUT is set the same line is appended there for workflow steps.
set -euo pipefail

base_sha="${1:?usage: detect-docs-only-change.sh <base-sha>}"

emit() {
  printf 'docs_only=%s\n' "$1"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf 'docs_only=%s\n' "$1" >> "$GITHUB_OUTPUT"
  fi
  exit 0
}

if ! git cat-file -e "$base_sha^{commit}" 2>/dev/null; then
  emit false
fi

changed_files="$(git diff --name-only "$base_sha" HEAD)"
if [[ -z "$changed_files" ]]; then
  emit false
fi

while IFS= read -r changed_file; do
  case "$changed_file" in
    docs/*|*.md) ;;
    *) emit false ;;
  esac
done <<< "$changed_files"

emit true
