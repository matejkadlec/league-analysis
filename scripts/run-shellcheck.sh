#!/usr/bin/env bash
# Run the pinned ShellCheck over tracked repository shell sources.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly repository_root shellcheck_version='0.11.0'
shellcheck_binary="${SHELLCHECK_BINARY:-shellcheck}"

if ! command -v "$shellcheck_binary" >/dev/null 2>&1; then
  printf 'ERROR: ShellCheck is required; run ./scripts/install-shellcheck.sh.\n' >&2
  exit 1
fi
version_output="$("$shellcheck_binary" --version)"
grep -Fqx "version: $shellcheck_version" <<< "$version_output" || {
  printf 'ERROR: ShellCheck %s is required.\n' "$shellcheck_version" >&2
  exit 1
}

mapfile -d '' -t shell_sources < <(
  git -C "$repository_root" ls-files --cached --others --exclude-standard -z -- '*.sh' '.githooks/*'
)
[[ ${#shell_sources[@]} -gt 0 ]] || {
  printf 'ERROR: no tracked shell sources were found.\n' >&2
  exit 1
}

cd "$repository_root"
"$shellcheck_binary" --severity=warning "${shell_sources[@]}"
