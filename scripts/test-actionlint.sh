#!/usr/bin/env bash
# Network-free regression coverage for the pinned actionlint runner.
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_directory/.." && pwd)"
runner="$script_directory/run-actionlint.sh"
invalid_fixture="$repository_root/tests/fixtures/github-workflows/invalid-expression.yml"

[[ -x "$runner" ]] || {
  printf 'actionlint regression failed: runner is not executable.\n' >&2
  exit 1
}
[[ -f "$invalid_fixture" ]] || {
  printf 'actionlint regression failed: the invalid workflow fixture is missing.\n' >&2
  exit 1
}

if "$runner" "$invalid_fixture" >/dev/null 2>&1; then
  printf 'actionlint regression failed: the invalid workflow fixture was accepted.\n' >&2
  exit 1
fi

printf 'actionlint tooling regression passed.\n'
