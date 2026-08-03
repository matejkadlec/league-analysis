#!/usr/bin/env bash
# Install trusted hook snapshots outside worktree-controlled source files.
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd -P)"
root_dir="$(git -C "$script_dir/.." rev-parse --show-toplevel)"
common_git_dir="$(git -C "$root_dir" rev-parse --path-format=absolute --git-common-dir)"

trusted_hook_root="$common_git_dir/league-analysis-trusted-hooks"
trusted_hook_dir="$trusted_hook_root/current"
trusted_exclude_file="$common_git_dir/info/exclude"
trusted_hooks_config_key="league-analysis.trustedhookspath"
trusted_ignore_patterns=(
  ".env"
  ".worktree-local-file.*"
)
installer_temporary_file=""
installer_staging_dir=""
installer_activation_dir=""

cleanup_installer_paths() {
  if [[ -n "$installer_temporary_file" ]]; then
    rm -f -- "$installer_temporary_file"
  fi
  if [[ -n "$installer_activation_dir" ]]; then
    rm -f -- "$installer_activation_dir/current"
    rmdir -- "$installer_activation_dir" 2>/dev/null || true
  fi
  if [[ -n "$installer_staging_dir" ]]; then
    rm -f -- \
      "$installer_staging_dir/pre-commit" \
      "$installer_staging_dir/post-checkout" \
      "$installer_staging_dir/provision-worktree-local-files.sh"
    rmdir -- "$installer_staging_dir" 2>/dev/null || true
  fi
}

trap cleanup_installer_paths EXIT
trap 'exit 1' HUP INT TERM

if [[ -L "$trusted_hook_root" || ( -e "$trusted_hook_root" && ! -d "$trusted_hook_root" ) ]]; then
  printf 'ERROR: trusted Git hook root is not a directory: %s\n' "$trusted_hook_root" >&2
  exit 1
fi

mkdir -p -- "$trusted_hook_root"
chmod 700 -- "$trusted_hook_root"
if [[ -e "$trusted_hook_dir" && ! -L "$trusted_hook_dir" ]]; then
  printf 'ERROR: active trusted Git hook path is not a symlink: %s\n' "$trusted_hook_dir" >&2
  exit 1
fi

lock_file="$common_git_dir/league-analysis-trusted-hooks.lock"
if [[ -L "$lock_file" || ( -e "$lock_file" && ! -f "$lock_file" ) ]]; then
  printf 'ERROR: trusted Git hook lock path is not a regular file: %s\n' "$lock_file" >&2
  exit 1
fi
if ! command -v flock >/dev/null 2>&1; then
  printf 'ERROR: flock is required to install trusted Git hook snapshots safely.\n' >&2
  exit 1
fi
umask 077
exec {lock_fd}>"$lock_file"
flock -x "$lock_fd"

hook_source_files=(
  "$root_dir/.githooks/pre-commit"
  "$root_dir/.githooks/post-checkout"
  "$root_dir/scripts/provision-worktree-local-files.sh"
)
hook_destination_names=(
  "pre-commit"
  "post-checkout"
  "provision-worktree-local-files.sh"
)
generation_dir=""

stage_complete_generation() {
  local generation_hash_input=""
  local generation_id
  local source_file
  local destination_name
  local index

  for source_file in "${hook_source_files[@]}"; do
    if [[ ! -f "$source_file" || -L "$source_file" || ! -x "$source_file" ]]; then
      printf 'ERROR: trusted hook source must be an executable regular file: %s\n' "$source_file" >&2
      return 1
    fi
    generation_hash_input+="$(git hash-object -- "$source_file")"$'\n'
  done

  generation_id="$(printf '%s' "$generation_hash_input" | git hash-object --stdin)"
  generation_dir="$trusted_hook_root/generation-$generation_id"

  if [[ -L "$generation_dir" || ( -e "$generation_dir" && ! -d "$generation_dir" ) ]]; then
    printf 'ERROR: trusted Git hook generation path is not a directory: %s\n' "$generation_dir" >&2
    return 1
  fi

  if [[ -d "$generation_dir" ]]; then
    for index in "${!hook_source_files[@]}"; do
      source_file="${hook_source_files[$index]}"
      destination_name="${hook_destination_names[$index]}"
      if [[ ! -f "$generation_dir/$destination_name" \
        || -L "$generation_dir/$destination_name" \
        || ! -x "$generation_dir/$destination_name" \
        || "$(stat -c '%a' "$generation_dir/$destination_name")" != "700" ]]; then
        printf 'ERROR: existing trusted Git hook generation failed validation: %s\n' "$generation_dir" >&2
        return 1
      fi
      if ! cmp -s -- "$source_file" "$generation_dir/$destination_name"; then
        printf 'ERROR: existing trusted Git hook generation failed validation: %s\n' "$generation_dir" >&2
        return 1
      fi
    done
    return 0
  fi

  installer_staging_dir="$(mktemp -d "$trusted_hook_root/.generation-$generation_id.XXXXXX")"
  chmod 700 -- "$installer_staging_dir"
  for index in "${!hook_source_files[@]}"; do
    source_file="${hook_source_files[$index]}"
    destination_name="${hook_destination_names[$index]}"
    install -m 700 -- "$source_file" "$installer_staging_dir/$destination_name"
  done
  mv -T -- "$installer_staging_dir" "$generation_dir"
  installer_staging_dir=""
}

activate_generation() {
  local generation_name
  local current_generation

  generation_name="$(basename -- "$generation_dir")"
  current_generation="$(readlink -- "$trusted_hook_dir" 2>/dev/null || true)"
  if [[ "$current_generation" == "$generation_name" ]]; then
    return 0
  fi

  installer_activation_dir="$(mktemp -d "$trusted_hook_root/.activation.XXXXXX")"
  ln -s -- "$generation_name" "$installer_activation_dir/current"
  mv -Tf -- "$installer_activation_dir/current" "$trusted_hook_dir"
  rmdir -- "$installer_activation_dir"
  installer_activation_dir=""
}

ensure_trusted_ignores() {
  local trusted_info_dir="$common_git_dir/info"
  local pattern
  local needs_update=0

  if [[ -L "$trusted_info_dir" || ( -e "$trusted_info_dir" && ! -d "$trusted_info_dir" ) ]]; then
    printf 'ERROR: trusted Git exclude directory is not a directory: %s\n' "$trusted_info_dir" >&2
    return 1
  fi
  mkdir -p -- "$trusted_info_dir"
  chmod 700 -- "$trusted_info_dir"

  if [[ -L "$trusted_exclude_file" || ( -e "$trusted_exclude_file" && ! -f "$trusted_exclude_file" ) ]]; then
    printf 'ERROR: trusted Git exclude path is not a regular file: %s\n' "$trusted_exclude_file" >&2
    return 1
  fi

  for pattern in "${trusted_ignore_patterns[@]}"; do
    if [[ ! -f "$trusted_exclude_file" ]] || ! grep -Fqx -- "$pattern" "$trusted_exclude_file"; then
      needs_update=1
      break
    fi
  done
  if [[ "$needs_update" -eq 0 ]]; then
    chmod 600 -- "$trusted_exclude_file"
    return 0
  fi

  installer_temporary_file="$(mktemp "$trusted_info_dir/.league-analysis-exclude.XXXXXX")"
  if [[ -f "$trusted_exclude_file" ]]; then
    cat -- "$trusted_exclude_file" > "$installer_temporary_file"
    printf '\n' >> "$installer_temporary_file"
  fi
  for pattern in "${trusted_ignore_patterns[@]}"; do
    if ! grep -Fqx -- "$pattern" "$installer_temporary_file"; then
      printf '%s\n' "$pattern" >> "$installer_temporary_file"
    fi
  done
  chmod 600 -- "$installer_temporary_file"
  mv -f -- "$installer_temporary_file" "$trusted_exclude_file"
  installer_temporary_file=""
}

local_hooks_path="$(git -C "$root_dir" config --local --get core.hooksPath || true)"
effective_hooks_path="$(git -C "$root_dir" config --get core.hooksPath || true)"
owned_hooks_path="$(git -C "$root_dir" config --local --get "$trusted_hooks_config_key" || true)"

case "$local_hooks_path" in
  .githooks|./.githooks|"$root_dir/.githooks") install_action="migrate-legacy" ;;
  "")
    if [[ -z "$effective_hooks_path" ]]; then
      install_action="install"
    else
      printf 'Preserved existing custom core.hooksPath: %s\n' "$effective_hooks_path"
      exit 0
    fi
    ;;
  "$trusted_hook_dir") install_action="update" ;;
  "$trusted_hook_root") install_action="migrate-generation-layout" ;;
  "$owned_hooks_path") install_action="migrate-relocated" ;;
  *)
    printf 'Preserved existing custom core.hooksPath: %s\n' "$local_hooks_path"
    exit 0
    ;;
esac

stage_complete_generation
ensure_trusted_ignores
activate_generation
git -C "$root_dir" config --local core.hooksPath "$trusted_hook_dir"
git -C "$root_dir" config --local "$trusted_hooks_config_key" "$trusted_hook_dir"

case "$install_action" in
  migrate-legacy) printf 'Migrated repository Git hooks to trusted snapshots.\n' ;;
  migrate-relocated) printf 'Migrated relocated trusted Git hooks to the current repository path.\n' ;;
  migrate-generation-layout) printf 'Migrated trusted repository Git hooks to atomic generations.\n' ;;
  install) printf 'Installed trusted repository Git hooks.\n' ;;
  update) printf 'Updated trusted repository Git hooks.\n' ;;
esac
