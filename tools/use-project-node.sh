#!/usr/bin/env bash
# Select the exact repository-pinned Node runtime when sourced.

project_node_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project_node_version="$(tr -d '[:space:]' < "$project_node_root/.nvmrc")"

project_node_current_version() {
  if ! command -v node >/dev/null 2>&1; then
    return
  fi
  node --version 2>/dev/null | sed 's/^v//'
}

if [[ "$(project_node_current_version)" == "$project_node_version" ]]; then
  return 0 2>/dev/null || exit 0
fi

# fnm first: it is what this project's developers actually run, and a machine
# with fnm has no nvm to fall back to, so checking nvm first only produced a
# misleading "install nvm" error on a box that already had the right Node.
if command -v fnm >/dev/null 2>&1; then
  fnm use --silent-if-unchanged "$project_node_version" >/dev/null 2>&1 ||
    fnm use "$project_node_version" >/dev/null 2>&1 || true
  if [[ "$(project_node_current_version)" == "$project_node_version" ]]; then
    return 0 2>/dev/null || exit 0
  fi
fi

# `fnm use` only works once `fnm env` has been evaluated in this shell, and on a
# trimmed PATH the `fnm` binary may not be visible at all. The installed
# versions directory is reachable in both cases, so probe it independently
# rather than nesting it under the `command -v fnm` check.
project_fnm_root="${FNM_DIR:-$HOME/.local/share/fnm}"
project_fnm_bin="$project_fnm_root/node-versions/v$project_node_version/installation/bin"
if [[ -x "$project_fnm_bin/node" ]]; then
  PATH="$project_fnm_bin:$PATH"
  export PATH
  if [[ "$(project_node_current_version)" == "$project_node_version" ]]; then
    return 0 2>/dev/null || exit 0
  fi
fi

if ! command -v nvm >/dev/null 2>&1; then
  project_nvm_directory="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$project_nvm_directory/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "$project_nvm_directory/nvm.sh"
  fi
fi

if command -v nvm >/dev/null 2>&1; then
  nvm use --silent "$project_node_version" >/dev/null
  if [[ "$(project_node_current_version)" == "$project_node_version" ]]; then
    return 0 2>/dev/null || exit 0
  fi
fi

printf 'ERROR: Node %s is required by .nvmrc but is not active.\n' \
  "$project_node_version" >&2
printf '  fnm: fnm install %s\n' "$project_node_version" >&2
printf '  nvm: nvm install %s\n' "$project_node_version" >&2
return 1 2>/dev/null || exit 1
