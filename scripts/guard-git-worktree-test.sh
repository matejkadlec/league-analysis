#!/usr/bin/env bash
# Run a test command without allowing it to silently change the invoking
# League Analysis worktree identity or trusted-hook configuration.
set -euo pipefail

usage() {
  printf 'Usage: %s [--repository <path>] -- <test command> [arguments...]\n' "$0" >&2
  exit 2
}

repository=""
if [[ "${1:-}" == "--repository" ]]; then
  [[ $# -ge 3 ]] || usage
  repository="$2"
  shift 2
fi

[[ "${1:-}" == "--" ]] || usage
shift
[[ $# -gt 0 ]] || usage

if [[ -z "$repository" ]]; then
  repository="$(git rev-parse --show-toplevel)"
fi
repository="$(cd "$repository" && pwd -P)"

# Do not let a caller's repository-local Git environment redirect checks to a
# different checkout.
while IFS= read -r git_local_env_var; do
  unset "$git_local_env_var"
done < <(git -C "$repository" rev-parse --local-env-vars)

temporary_directory="$(mktemp -d)"
snapshot_directory="$temporary_directory/config-before"
protected_config_keys=(
  "core.bare"
  "core.worktree"
  "core.gitdir"
  "core.hooksPath"
  "extensions.worktreeConfig"
  "league-analysis.trustedhookspath"
)

cleanup() {
  rm -rf -- "$temporary_directory"
}
trap cleanup EXIT

format_snapshot() {
  local snapshot="$1"
  local values=()
  local value

  mapfile -t values < "$snapshot"
  if [[ ${#values[@]} -eq 0 ]]; then
    printf '<unset>'
    return
  fi

  printf '%q' "${values[0]}"
  for value in "${values[@]:1}"; do
    printf ', %q' "$value"
  done
}

capture_config_value() {
  local scope="$1"
  local key="$2"
  local snapshot="$3"

  case "$scope" in
    local)
      git -C "$repository" config --local --get-all "$key" > "$snapshot" 2>/dev/null || true
      ;;
    worktree)
      git -C "$repository" config --worktree --get-all "$key" > "$snapshot" 2>/dev/null || true
      ;;
    *)
      printf 'ERROR: unsupported Git configuration scope: %s\n' "$scope" >&2
      exit 2
      ;;
  esac
}

worktree_config_enabled() {
  local enabled

  enabled="$(git -C "$repository" config --local --type=bool --get extensions.worktreeConfig 2>/dev/null || true)"
  [[ "$enabled" == "true" ]]
}

compare_snapshot() {
  local label="$1"
  local before_snapshot="$2"
  local after_snapshot="$3"

  if cmp -s -- "$before_snapshot" "$after_snapshot"; then
    return 0
  fi

  printf 'ERROR: Git worktree integrity guard: %s changed for %s.\n' "$label" "$repository" >&2
  printf '  before: %s\n' "$(format_snapshot "$before_snapshot")" >&2
  printf '  after:  %s\n' "$(format_snapshot "$after_snapshot")" >&2
  return 1
}

capture_git_directory_identity() {
  local git_directory_snapshot="$1"
  local common_directory_snapshot="$2"

  git -C "$repository" rev-parse --absolute-git-dir > "$git_directory_snapshot" 2>/dev/null || true
  git -C "$repository" rev-parse --path-format=absolute --git-common-dir > "$common_directory_snapshot" 2>/dev/null || true
}

assert_worktree_identity() {
  local stage="$1"
  local inside_worktree
  local core_bare
  local failed=0

  inside_worktree="$(git -C "$repository" rev-parse --is-inside-work-tree 2>/dev/null || true)"
  if [[ "$inside_worktree" != "true" ]]; then
    printf 'ERROR: Git worktree integrity guard (%s): %s is not inside a worktree.\n' "$stage" "$repository" >&2
    failed=1
  fi

  core_bare="$(git -C "$repository" config --get core.bare 2>/dev/null || true)"
  if [[ "${core_bare,,}" == "true" ]]; then
    printf 'ERROR: Git worktree integrity guard (%s): core.bare is true for %s.\n' "$stage" "$repository" >&2
    failed=1
  fi

  return "$failed"
}

capture_snapshot() {
  local key

  mkdir -p -- "$snapshot_directory"
  for key in "${protected_config_keys[@]}"; do
    capture_config_value local "$key" "$snapshot_directory/local-$key"
  done
  capture_git_directory_identity \
    "$snapshot_directory/git-directory" \
    "$snapshot_directory/common-git-directory"
  if worktree_config_enabled; then
    printf 'true\n' > "$snapshot_directory/worktree-scope-enabled"
    for key in "${protected_config_keys[@]}"; do
      capture_config_value worktree "$key" "$snapshot_directory/worktree-$key"
    done
  else
    printf 'false\n' > "$snapshot_directory/worktree-scope-enabled"
  fi
}

verify_snapshot() {
  local key
  local after_snapshot
  local worktree_scope_enabled_before
  local worktree_scope_enabled_after=false
  local git_directory_after="$temporary_directory/git-directory-after"
  local common_git_directory_after="$temporary_directory/common-git-directory-after"
  local failed=0

  for key in "${protected_config_keys[@]}"; do
    after_snapshot="$temporary_directory/local-$key-after"
    capture_config_value local "$key" "$after_snapshot"
    compare_snapshot "local $key" "$snapshot_directory/local-$key" "$after_snapshot" || failed=1
  done

  worktree_scope_enabled_before="$(<"$snapshot_directory/worktree-scope-enabled")"
  if worktree_config_enabled; then
    worktree_scope_enabled_after=true
  fi
  if [[ "$worktree_scope_enabled_before" == "true" && "$worktree_scope_enabled_after" == "true" ]]; then
    for key in "${protected_config_keys[@]}"; do
      after_snapshot="$temporary_directory/worktree-$key-after"
      capture_config_value worktree "$key" "$after_snapshot"
      compare_snapshot "worktree $key" "$snapshot_directory/worktree-$key" "$after_snapshot" || failed=1
    done
  fi

  capture_git_directory_identity "$git_directory_after" "$common_git_directory_after"
  compare_snapshot "git directory" "$snapshot_directory/git-directory" "$git_directory_after" || failed=1
  compare_snapshot "common Git directory" "$snapshot_directory/common-git-directory" "$common_git_directory_after" || failed=1

  return "$failed"
}

if ! assert_worktree_identity "before test command"; then
  exit 1
fi
capture_snapshot

child_pid=""
received_signal=""
child_process_group_terminated=true

terminate_child_process_group() {
  local attempt

  if [[ -z "$child_pid" ]]; then
    return 0
  fi

  if kill -0 -- "-$child_pid" 2>/dev/null; then
    kill -TERM -- "-$child_pid" 2>/dev/null || true
    sleep 0.05
    if kill -0 -- "-$child_pid" 2>/dev/null; then
      kill -KILL -- "-$child_pid" 2>/dev/null || true
    fi
  fi

  wait "$child_pid" 2>/dev/null || true
  for ((attempt = 0; attempt < 20; attempt += 1)); do
    if ! kill -0 -- "-$child_pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.05
  done

  printf 'ERROR: Git worktree integrity guard could not stop the guarded process group.\n' >&2
  return 1
}

handle_signal() {
  received_signal="$1"
  if ! terminate_child_process_group; then
    child_process_group_terminated=false
  fi
}

set +e
setsid -- "$@" &
child_pid=$!
trap 'handle_signal HUP' HUP
trap 'handle_signal INT' INT
trap 'handle_signal TERM' TERM
wait "$child_pid"
command_status=$?
set -e
trap - HUP INT TERM
child_pid=""

if [[ "$child_process_group_terminated" != true ]]; then
  exit 1
fi
if [[ -n "$received_signal" ]]; then
  case "$received_signal" in
    HUP) command_status=129 ;;
    INT) command_status=130 ;;
    TERM) command_status=143 ;;
  esac
fi

integrity_status=0
assert_worktree_identity "after test command" || integrity_status=1
verify_snapshot || integrity_status=1

if [[ "$integrity_status" -ne 0 ]]; then
  exit "$integrity_status"
fi

exit "$command_status"
