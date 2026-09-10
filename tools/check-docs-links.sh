#!/usr/bin/env bash
# Mechanizes two docs/AGENTS.md rules that were previously prose only:
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

# Link targets are checked against the tracked tree, not the filesystem. An
# untracked file satisfies `test -e` locally and then does not exist for
# anybody who clones the repository, which is the failure this hook is for.
# Directories are recorded too, since a link may point at a folder.
declare -A tracked_paths=()
while IFS= read -r tracked_file; do
  tracked_paths["$tracked_file"]=1
  ancestor="$(dirname "$tracked_file")"
  while [ "$ancestor" != "." ] && [ "$ancestor" != "/" ]; do
    tracked_paths["$ancestor"]=1
    ancestor="$(dirname "$ancestor")"
  done
done < <(git ls-files)

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

    # An optional title — [text](path "Title") — is not part of the path.
    link_path="${link_target%%#*}"
    link_path="${link_path%%\"*}"
    link_path="${link_path%% *}"
    [ -n "$link_path" ] || continue

    # -m resolves ../ without requiring the target to exist.
    resolved="$(realpath -m --relative-to=. "$markdown_directory/$link_path")"
    if [ -z "${tracked_paths["$resolved"]+set}" ]; then
      report "broken link: $markdown_file -> $link_target"
    fi
  done < <(grep -o '](<\?[^)>]*>\?)' "$markdown_file" |
    sed 's/^](<\?//; s/>\?)$//')
done < <(git ls-files '*.md')

# --- 2. every docs/ topic file is indexed in docs/README.md -----------------
docs_index="docs/README.md"
if [ -f "$docs_index" ]; then
  # Every link target in the index, resolved the same way as above, so a
  # topic counts as indexed by its resolved path rather than by a basename
  # match. `[Foo](./foo.md)` and a nested `docs/a/setup.md` are then handled
  # correctly, and two topics sharing a basename need two entries.
  declare -A indexed_paths=()
  while IFS= read -r index_target; do
    [ -n "$index_target" ] || continue
    case "$index_target" in
      http://* | https://* | mailto:* | \#* | '<'*) continue ;;
    esac
    index_path="${index_target%%#*}"
    index_path="${index_path%%\"*}"
    index_path="${index_path%% *}"
    [ -n "$index_path" ] || continue
    indexed_paths["$(realpath -m --relative-to=. "docs/$index_path")"]=1
  done < <(grep -o '](<\?[^)>]*>\?)' "$docs_index" | sed 's/^](<\?//; s/>\?)$//')

  while IFS= read -r topic_file; do
    # README.md is the index itself; AGENTS.md contains agent
    # instructions, not topic documents.
    case "$(basename "$topic_file")" in
      README.md | AGENTS.md) continue ;;
    esac

    if [ -z "${indexed_paths["$topic_file"]+set}" ]; then
      report "docs/README.md does not index $topic_file"
    fi
  done < <(git ls-files 'docs/*.md')
fi

if [ "$failure_count" -gt 0 ]; then
  printf '\n%s documentation link problem(s) found.\n' "$failure_count" >&2
  exit 1
fi
