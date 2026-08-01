#!/usr/bin/env bash
# Network-free regression coverage for ShellCheck runner and installer policy.
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
runner="$script_directory/run-shellcheck.sh"
installer="$script_directory/install-shellcheck.sh"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/league-analysis-shellcheck-test.XXXXXX")"

cleanup() {
  rm -rf -- "$test_directory"
}
trap cleanup EXIT

[[ -x "$runner" ]] || {
  printf 'ShellCheck regression failed: runner is not executable.\n' >&2
  exit 1
}
grep -Fq "git -C \"\$repository_root\" ls-files --cached --others --exclude-standard -z -- '*.sh' '.githooks/*'" "$runner"
grep -Fq "platform='linux.x86_64'" "$installer"
grep -Fq "platform='linux.aarch64'" "$installer"

mismatched_binary="$test_directory/shellcheck"
printf '%s\n' '#!/usr/bin/env bash' 'printf "version: 0.9.0\n"' > "$mismatched_binary"
chmod 700 "$mismatched_binary"
if SHELLCHECK_BINARY="$mismatched_binary" "$runner" >/dev/null 2>&1; then
  printf 'ShellCheck regression failed: an unpinned binary passed.\n' >&2
  exit 1
fi

printf 'ShellCheck tooling regression passed.\n'
