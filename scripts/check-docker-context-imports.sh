#!/usr/bin/env bash
# Mechanizes the trap recorded in .claude/pitfalls.md: a file that stays in the
# frontend image's build context must not import a path .dockerignore removes.
# `next build` type-checks whatever it copies, so such an import fails only the
# image build -- ~16 CI minutes away, and never locally, because ./test.sh
# builds in the full repository where every import resolves.
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
cd "$repository_root"

frontend_directory="frontend"
dockerignore_file="$frontend_directory/.dockerignore"

if [ ! -f "$dockerignore_file" ]; then
  printf '%s is missing; the build context cannot be determined.\n' \
    "$dockerignore_file" >&2
  exit 1
fi

failure_count=0

report() {
  printf '%s\n' "$1" >&2
  failure_count=$((failure_count + 1))
}

# Only path-shaped entries matter. A glob like `*.log` or `.env.*` can never be
# an import target, so leaving it out costs nothing and keeps the matcher
# exact rather than approximating docker's pattern syntax.
ignored_paths=()
while IFS= read -r raw_entry; do
  entry="${raw_entry%%#*}"
  entry="$(printf '%s' "$entry" | tr -d '[:space:]')"
  case "$entry" in
    ''|*'*'*|'!'*) continue ;;
  esac
  ignored_paths+=("${entry%/}")
done < "$dockerignore_file"

if [ "${#ignored_paths[@]}" -eq 0 ]; then
  printf 'No path entries found in %s.\n' "$dockerignore_file" >&2
  exit 1
fi

# `.next/` is ignored because it is stale build output, but `next build`
# regenerates it inside the image before type-checking -- so Next's own
# generated `next-env.d.ts` importing `./.next/types/routes.d.ts` resolves
# there. Absent from the context and present at type-check time is exactly
# this directory, and nothing else in .dockerignore is produced by the build.
BUILD_GENERATED_PREFIX=".next"

# True when a path relative to frontend/ is removed from the build context,
# either by name or by sitting under an ignored directory. Import specifiers
# carry no extension, so an ignored file is matched with and without one.
is_ignored() {
  local candidate="$1" ignored extension
  case "$candidate" in
    "$BUILD_GENERATED_PREFIX"|"$BUILD_GENERATED_PREFIX"/*) return 1 ;;
  esac
  for ignored in "${ignored_paths[@]}"; do
    if [ "$candidate" = "$ignored" ]; then
      return 0
    fi
    case "$candidate" in
      "$ignored"/*) return 0 ;;
    esac
    for extension in ts tsx mts js mjs cjs json; do
      if [ "$candidate.$extension" = "$ignored" ]; then
        return 0
      fi
    done
  done
  return 1
}

# Lexical, not filesystem: the point is what the path denotes inside a context
# the referenced directory may be absent from.
normalize_path() {
  local input="$1" segment result=""
  local IFS='/'
  for segment in $input; do
    case "$segment" in
      ''|'.') continue ;;
      '..')
        # `${result%/*}` leaves a single segment untouched, so the no-slash
        # case has to empty the result explicitly rather than strip.
        case "$result" in
          */*) result="${result%/*}" ;;
          *) result="" ;;
        esac
        ;;
      *) result="${result:+$result/}$segment" ;;
    esac
  done
  printf '%s' "$result"
}

while IFS= read -r source_file; do
  relative_path="${source_file#"$frontend_directory"/}"
  if is_ignored "$relative_path"; then
    continue
  fi
  source_directory="$(dirname "$relative_path")"

  # `from "…"`, `import("…")` and `require("…")` alike: the specifier is the
  # first quoted string on a line that imports or re-exports.
  while IFS= read -r specifier; do
    case "$specifier" in
      '@/'*) target="$(normalize_path "${specifier#@/}")" ;;
      './'*|'../'*)
        if [ "$source_directory" = "." ]; then
          target="$(normalize_path "$specifier")"
        else
          target="$(normalize_path "$source_directory/$specifier")"
        fi
        ;;
      *) continue ;;
    esac

    if is_ignored "$target"; then
      report "$source_file imports '$specifier', which .dockerignore removes from the frontend image's build context. Keep each harness entrypoint ignored alongside the directory it drives, or stop importing it from a file the image keeps."
    fi
  done < <(grep -oE "(from|import|require)[[:space:]]*\(?[[:space:]]*['\"][^'\"]+['\"]" "$source_file" 2>/dev/null \
    | grep -oE "['\"][^'\"]+['\"]" \
    | tr -d "'\"" || true)
done < <(git ls-files "$frontend_directory" \
  | grep -E '\.(ts|tsx|mts|js|jsx|mjs|cjs)$' || true)

if [ "$failure_count" -gt 0 ]; then
  printf '%d import(s) reach outside the frontend image build context.\n' \
    "$failure_count" >&2
  exit 1
fi

printf 'Frontend build context imports resolve inside the context.\n'
