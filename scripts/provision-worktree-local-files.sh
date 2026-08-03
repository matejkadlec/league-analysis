#!/usr/bin/env bash
# Copy explicitly approved ignored local files from the primary worktree.
# Checkout must remain usable when secure provisioning is unavailable.
set -u

worktree_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
common_git_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || exit 0
worktree_git_dir="$(git rev-parse --path-format=absolute --git-dir 2>/dev/null)" || exit 0
trusted_exclude_file="$common_git_dir/info/exclude"
provisioned_state_dir="$worktree_git_dir/league-analysis-provisioned-local-files"
primary_root=""

while IFS= read -r worktree_line; do
  case "$worktree_line" in
    "worktree "*)
      primary_root="${worktree_line#worktree }"
      break
      ;;
  esac
done < <(git -C "$worktree_root" worktree list --porcelain 2>/dev/null)

if [[ -z "$primary_root" || "$worktree_root" == "$primary_root" ]]; then
  exit 0
fi

# Extend this allowlist only after reviewing the exact root file. Never add a
# directory or deployment credential bundle.
local_worktree_files=(
  ".env"
)
trusted_ignore_patterns=(
  ".env"
  ".worktree-local-file.*"
)
temporary_file=""

cleanup_temporary_file() {
  if [[ -n "$temporary_file" ]]; then
    rm -f -- "$temporary_file"
  fi
}

trap cleanup_temporary_file EXIT
trap 'exit 0' HUP INT TERM

if [[ -L "$provisioned_state_dir" || ( -e "$provisioned_state_dir" && ! -d "$provisioned_state_dir" ) ]]; then
  exit 0
fi
if ! (umask 077; mkdir -p -- "$provisioned_state_dir"); then
  exit 0
fi
chmod 700 -- "$provisioned_state_dir" 2>/dev/null || exit 0

is_trusted_ignored() {
  local target_path="$1"
  local trusted_pattern="$2"

  [[ -f "$trusted_exclude_file" && ! -L "$trusted_exclude_file" ]] || return 1
  grep -Fqx -- "$trusted_pattern" "$trusted_exclude_file" || return 1
  git -C "$worktree_root" check-ignore --quiet --no-index -- "$target_path"
}

clear_provisioned_marker() {
  local marker_path="$1"

  rm -f -- "$marker_path/identity"
  rmdir -- "$marker_path" 2>/dev/null || true
}

for local_file in "${local_worktree_files[@]}"; do
  source_file="$primary_root/$local_file"
  target_file="$worktree_root/$local_file"
  provisioned_marker="$provisioned_state_dir/${local_file//\//_}"
  provisioned_identity="$provisioned_marker/identity"

  # Only private provenance permits automatic removal. Revalidate a copied
  # file after every later checkout and remove it if branch rules expose it.
  if [[ -d "$provisioned_marker" && ! -L "$provisioned_marker" ]]; then
    if [[ -f "$provisioned_identity" \
      && ! -L "$provisioned_identity" \
      && -f "$target_file" \
      && ! -L "$target_file" \
      && "$(<"$provisioned_identity")" == "$(stat -c '%d:%i' "$target_file")" ]]; then
      if is_trusted_ignored "$local_file" "${trusted_ignore_patterns[0]}"; then
        continue
      fi
      if rm -f -- "$target_file"; then
        clear_provisioned_marker "$provisioned_marker"
      fi
      continue
    fi
    clear_provisioned_marker "$provisioned_marker"
  elif [[ -e "$provisioned_marker" || -L "$provisioned_marker" ]]; then
    continue
  fi

  # Preserve every existing target, including broken symlinks. A source must
  # be a regular non-symlink root file.
  if [[ ! -f "$source_file" || -L "$source_file" || -e "$target_file" || -L "$target_file" ]]; then
    continue
  fi

  # Both the final path and secret-bearing temporary pattern must be ignored
  # by the trusted shared exclude file, not merely by branch-controlled rules.
  if ! is_trusted_ignored "$local_file" "${trusted_ignore_patterns[0]}" \
    || ! is_trusted_ignored ".worktree-local-file.trusted-ignore-check" "${trusted_ignore_patterns[1]}"; then
    continue
  fi

  target_directory="$(dirname "$target_file")"
  temporary_file="$(umask 077; mktemp "$target_directory/.worktree-local-file.XXXXXX")" || continue

  if ! install -m 600 -- "$source_file" "$temporary_file"; then
    cleanup_temporary_file
    temporary_file=""
    continue
  fi

  # Publish provenance first. The next checkout safely clears an incomplete
  # marker or revalidates a completed copy.
  if ! (umask 077; mkdir -- "$provisioned_marker"); then
    cleanup_temporary_file
    temporary_file=""
    continue
  fi
  if ! (umask 077; printf '%s\n' "$(stat -c '%d:%i' "$temporary_file")" > "$provisioned_identity") \
    || ! chmod 600 -- "$provisioned_identity"; then
    clear_provisioned_marker "$provisioned_marker"
    cleanup_temporary_file
    temporary_file=""
    continue
  fi

  # link(2) is atomic and fails when a concurrent process created the target.
  if ! ln -- "$temporary_file" "$target_file"; then
    clear_provisioned_marker "$provisioned_marker"
    cleanup_temporary_file
    temporary_file=""
    continue
  fi

  cleanup_temporary_file
  temporary_file=""
done
