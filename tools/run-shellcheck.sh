#!/usr/bin/env bash
# Run the pinned ShellCheck over tracked repository shell sources.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly repository_root shellcheck_version='0.11.0'
shellcheck_binary="${SHELLCHECK_BINARY:-}"

if [[ -z "$shellcheck_binary" ]]; then
  shellcheck_binary="$(command -v shellcheck || true)"
fi
if [[ -z "$shellcheck_binary" ]]; then
  cache_directory="${XDG_CACHE_HOME:-$HOME/.cache}/league-analysis/shellcheck-${shellcheck_version}"
  shellcheck_binary="$cache_directory/shellcheck"
  "$repository_root/tools/install-shellcheck.sh" "$cache_directory" >/dev/null
fi

[[ -x "$shellcheck_binary" ]] || {
  printf 'ERROR: ShellCheck is not executable: %s\n' "$shellcheck_binary" >&2
  exit 1
}
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
