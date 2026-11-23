#!/usr/bin/env bash
# Select the exact repository-pinned Node runtime and npm when sourced.
#
# Node comes from .nvmrc. npm comes from `packageManager` in
# frontend/package.json, which `devEngines` enforces: no Node 26 release
# bundles npm 12, so the pinned npm is installed into the selected Node here
# rather than left for `npm ci` to reject with EBADDEVENGINES.
#
# Every failure path prints what went wrong before returning nonzero. Callers
# run under `set -e`, where a silent nonzero return would end them without a
# word.

project_node_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project_node_version="$(tr -d '[:space:]' < "$project_node_root/.nvmrc")"
project_npm_version="$(
  sed -n 's/^[[:space:]]*"packageManager":[[:space:]]*"npm@\([0-9][0-9.]*\)".*/\1/p' \
    "$project_node_root/frontend/package.json"
)"

project_node_current_version() {
  if ! command -v node >/dev/null 2>&1; then
    return 0
  fi
  node --version 2>/dev/null | sed 's/^v//'
}

project_node_is_selected() {
  [[ "$(project_node_current_version)" == "$project_node_version" ]]
}

project_node_select() {
  if project_node_is_selected; then
    return 0
  fi

  # fnm first: it is what this project's developers actually run, and a machine
  # with fnm has no nvm to fall back to, so checking nvm first only produced a
  # misleading "install nvm" error on a box that already had the right Node.
  if command -v fnm >/dev/null 2>&1; then
    fnm use --silent-if-unchanged "$project_node_version" >/dev/null 2>&1 ||
      fnm use "$project_node_version" >/dev/null 2>&1 || true
    if project_node_is_selected; then
      return 0
    fi
  fi

  # `fnm use` only works once `fnm env` has been evaluated in this shell, and
  # on a trimmed PATH the `fnm` binary may not be visible at all. The installed
  # versions directory is reachable in both cases, so probe it independently
  # rather than nesting it under the `command -v fnm` check.
  local fnm_root="${FNM_DIR:-$HOME/.local/share/fnm}"
  local fnm_bin="$fnm_root/node-versions/v$project_node_version/installation/bin"
  if [[ -x "$fnm_bin/node" ]]; then
    PATH="$fnm_bin:$PATH"
    export PATH
    if project_node_is_selected; then
      return 0
    fi
  fi

  if ! command -v nvm >/dev/null 2>&1; then
    local nvm_directory="${NVM_DIR:-$HOME/.nvm}"
    if [[ -s "$nvm_directory/nvm.sh" ]]; then
      # shellcheck disable=SC1090,SC1091
      source "$nvm_directory/nvm.sh" || true
    fi
  fi

  if command -v nvm >/dev/null 2>&1; then
    nvm use --silent "$project_node_version" >/dev/null || true
    if project_node_is_selected; then
      return 0
    fi
  fi

  printf 'ERROR: Node %s is required by .nvmrc but is not active (found: %s).\n' \
    "$project_node_version" "$(project_node_current_version || true)" >&2
  printf '  fnm: fnm install %s\n' "$project_node_version" >&2
  printf '  nvm: nvm install %s\n' "$project_node_version" >&2
  return 1
}

project_npm_current_version() {
  if ! command -v npm >/dev/null 2>&1; then
    return 0
  fi
  # From /, so no project's package.json or .npmrc takes part in the answer.
  (cd / && npm --version 2>/dev/null) || true
}

project_npm_select() {
  if [[ -z "$project_npm_version" ]]; then
    printf 'ERROR: frontend/package.json has no "packageManager": "npm@<version>" pin.\n' >&2
    return 1
  fi

  local current_version
  current_version="$(project_npm_current_version)"
  if [[ "$current_version" == "$project_npm_version" ]]; then
    return 0
  fi

  local npm_prefix
  npm_prefix="$(dirname "$(dirname "$(command -v node)")")"
  printf 'Node %s is active with npm %s, but frontend/package.json pins npm %s.\n' \
    "$project_node_version" "${current_version:-none}" "$project_npm_version" >&2
  printf 'Installing npm@%s into %s (devEngines rejects any other npm) ...\n' \
    "$project_npm_version" "$npm_prefix" >&2

  # From /, for the same reason as above: the frontend's own devEngines must
  # not be consulted by the npm that is about to be replaced.
  if ! (cd / && npm install --global "npm@$project_npm_version" --ignore-scripts >&2); then
    printf 'ERROR: installing npm@%s into %s failed; see the npm output above.\n' \
      "$project_npm_version" "$npm_prefix" >&2
    printf '  Retry by hand: npm install --global npm@%s --ignore-scripts\n' \
      "$project_npm_version" >&2
    return 1
  fi
  hash -r 2>/dev/null || true

  current_version="$(project_npm_current_version)"
  if [[ "$current_version" != "$project_npm_version" ]]; then
    printf 'ERROR: npm@%s was installed but `npm --version` still reports %s.\n' \
      "$project_npm_version" "${current_version:-nothing}" >&2
    printf '  Another npm precedes %s/bin on PATH: %s\n' \
      "$npm_prefix" "$(command -v npm || true)" >&2
    return 1
  fi
  printf 'npm %s is now active.\n' "$project_npm_version" >&2
}

if ! project_node_select; then
  return 1 2>/dev/null || exit 1
fi
if ! project_npm_select; then
  return 1 2>/dev/null || exit 1
fi
