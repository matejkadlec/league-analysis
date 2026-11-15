#!/usr/bin/env bash
# Every place that names a toolchain version must name the same one.
#
# Node, npm, Python, uv and PostgreSQL are each pinned in more than one file:
# for local development, for the gate container CI runs, and for the production
# images. Nothing ties those files together, so a bump applied to one of them
# leaves the gate testing a different runtime from the one production runs.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

failure_count=0

# expect <what> <expected> <file> <actual>
expect() {
  if [[ "$4" != "$2" ]]; then
    printf '%s: %s names %s, expected %s\n' "$1" "$3" "${4:-nothing}" "$2" >&2
    failure_count=$((failure_count + 1))
  fi
}

# first_match <file> <sed expression with one capture>: the first capture.
first_match() {
  sed -n "$2" "$1" | head -n 1
}

# every_match <what> <expected> <file> <sed expression>: all captures agree,
# and there is at least one.
every_match() {
  local found=0 value
  while IFS= read -r value; do
    found=1
    expect "$1" "$2" "$3" "$value"
  done < <(sed -n "$4" "$3")
  ((found == 1)) || expect "$1" "$2" "$3" ""
}

node_version="$(tr -d '[:space:]' <.nvmrc)"
package=frontend/package.json
expect Node "$node_version" "$package devEngines.runtime" \
  "$(sed -n '/"runtime"/,/}/s/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$package" | head -n 1)"
expect Node "$node_version" "$package engines.node" \
  "$(first_match "$package" 's/^[[:space:]]*"node":[[:space:]]*"\([^"]*\)".*/\1/p')"
every_match Node "$node_version" gate.Dockerfile 's/^FROM node:\([0-9.]*\)-.*/\1/p'
every_match Node "$node_version" frontend/Dockerfile 's/^FROM node:\([0-9.]*\)-.*/\1/p'

npm_version="$(first_match "$package" 's/^[[:space:]]*"packageManager":[[:space:]]*"npm@\([^"]*\)".*/\1/p')"
[[ -n "$npm_version" ]] || expect npm 'a "packageManager": "npm@<version>" pin' "$package" ""
expect npm "$npm_version" "$package devEngines.packageManager" \
  "$(sed -n '/"devEngines"/,/^  }/{/"packageManager"/,/}/s/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p}' "$package" | head -n 1)"
every_match npm "$npm_version" gate.Dockerfile 's/.*npm install --global npm@\([0-9.]*\).*/\1/p'
every_match npm "$npm_version" frontend/Dockerfile 's/.*npm install --global npm@\([0-9.]*\).*/\1/p'
every_match npm "$npm_version" README.md 's/.*npm install --global npm@\([0-9.]*\).*/\1/p'

python_version="$(tr -d '[:space:]' <.python-version)"
every_match Python "$python_version" backend/Dockerfile 's/^FROM python:\([0-9.]*\)-.*/\1/p'

uv_version="$(first_match gate.Dockerfile 's/^FROM ghcr\.io\/astral-sh\/uv:\([0-9.]*\).*/\1/p')"
every_match uv "$uv_version" backend/Dockerfile 's/^FROM ghcr\.io\/astral-sh\/uv:\([0-9.]*\).*/\1/p'

postgres_version="$(first_match compose.gate.yml 's/^[[:space:]]*image:[[:space:]]*postgres:\([0-9.]*\).*/\1/p')"
every_match PostgreSQL "$postgres_version" compose.production.yml 's/^[[:space:]]*image:[[:space:]]*postgres:\([0-9.]*\).*/\1/p'

if ((failure_count > 0)); then
  printf '%d toolchain pin(s) disagree. Bump every file together.\n' "$failure_count" >&2
  exit 1
fi
printf 'Toolchain pins agree: Node %s, npm %s, Python %s, uv %s, PostgreSQL %s.\n' \
  "$node_version" "$npm_version" "$python_version" "$uv_version" "$postgres_version"
