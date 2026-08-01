#!/usr/bin/env bash
# Regression coverage for exact Node runtime selection.
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_directory/.." && pwd)"
helper="$script_directory/use-project-node.sh"
expected_version="$(tr -d '[:space:]' < "$repository_root/.nvmrc")"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/league-analysis-node.XXXXXX")"

cleanup() {
  rm -rf -- "$test_directory"
}
trap cleanup EXIT

mkdir -p "$test_directory/bin"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [[ "${1:-}" == "--version" ]]; then printf "v%s\n" "$FAKE_NODE_VERSION"; fi' \
  > "$test_directory/bin/node"
chmod 700 "$test_directory/bin/node"

run_helper() {
  local version="$1"
  env PATH="$test_directory/bin:/usr/bin:/bin" \
    NVM_DIR="$test_directory/no-nvm" \
    FAKE_NODE_VERSION="$version" \
    bash -c 'source "$1"' bash "$helper"
}

run_helper "$expected_version"
if run_helper "0.0.1" >/dev/null 2>&1; then
  printf 'Node helper regression failed: an unpinned runtime passed.\n' >&2
  exit 1
fi

printf 'Node runtime helper regression passed.\n'
