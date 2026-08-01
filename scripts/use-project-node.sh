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

if ! command -v nvm >/dev/null 2>&1; then
  project_nvm_directory="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$project_nvm_directory/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "$project_nvm_directory/nvm.sh"
  fi
fi

if ! command -v nvm >/dev/null 2>&1; then
  printf 'ERROR: Node %s is required by .nvmrc. Install it or use: nvm install %s\n' \
    "$project_node_version" "$project_node_version" >&2
  return 1 2>/dev/null || exit 1
fi

nvm use --silent "$project_node_version" >/dev/null
if [[ "$(project_node_current_version)" != "$project_node_version" ]]; then
  printf 'ERROR: NVM did not activate Node %s.\n' "$project_node_version" >&2
  return 1 2>/dev/null || exit 1
fi
