#!/usr/bin/env bash
# Mechanizes two docs/CLAUDE.md rules that were previously prose only:
#   - relative links only, and every linked target must exist
#   - a new docs/ topic file must be added to docs/README.md in the same change
# Runs over the whole tracked corpus rather than the staged subset, because a
# rename can break a link in a file the commit never touches.
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
cd "$repository_root"

failure_count=0

report() {
  printf '%s\n' "$1" >&2
  failure_count=$((failure_count + 1))
}

# --- 1. every relative markdown link resolves -------------------------------
while IFS= read -r markdown_file; do
  markdown_directory="$(dirname "$markdown_file")"

  # Pull the target out of every ](...) link, one per line.
  while IFS= read -r link_target; do
    [ -n "$link_target" ] || continue

    # Skip external schemes, in-page anchors, and templated placeholders.
    case "$link_target" in
      http://* | https://* | mailto:* | \#* | '<'*) continue ;;
    esac

    # A trailing #anchor is not part of the path.
    link_path="${link_target%%#*}"
    [ -n "$link_path" ] || continue

    if [ ! -e "$markdown_directory/$link_path" ]; then
      report "broken link: $markdown_file -> $link_target"
    fi
  done < <(grep -o '](<\?[^)>]*>\?)' "$markdown_file" |
    sed 's/^](<\?//; s/>\?)$//')
done < <(git ls-files '*.md')

# --- 2. every docs/ topic file is indexed in docs/README.md -----------------
docs_index="docs/README.md"
if [ -f "$docs_index" ]; then
  while IFS= read -r topic_file; do
    topic_basename="$(basename "$topic_file")"
    # README.md is the index itself; CLAUDE.md/AGENTS.md are agent
    # instructions, not topic documents.
    case "$topic_basename" in
      README.md | CLAUDE.md | AGENTS.md) continue ;;
    esac

    if ! grep -q "($topic_basename\([)#]\)" "$docs_index"; then
      report "docs/README.md does not index $topic_file"
    fi
  done < <(git ls-files 'docs/*.md')
fi

if [ "$failure_count" -gt 0 ]; then
  printf '\n%s documentation link problem(s) found.\n' "$failure_count" >&2
  exit 1
fi
