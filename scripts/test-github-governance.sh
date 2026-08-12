#!/usr/bin/env bash
# Keep the tracked master-branch ruleset and audit entry point deterministic.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
verifier="$repository_root/scripts/verify-github-ruleset.py"
configuration="$repository_root/.github/master-branch-ruleset.json"
verifier_regression="$repository_root/scripts/test-verify-github-ruleset.py"

fail() {
  printf 'GitHub governance regression failed: %s\n' "$1" >&2
  exit 1
}

[[ -f "$configuration" ]] || fail 'master ruleset desired-state JSON is missing.'
[[ -f "$verifier" ]] || fail 'live ruleset verifier is missing.'
[[ -f "$verifier_regression" ]] || fail 'ruleset verifier regression coverage is missing.'

python3 "$verifier" --config-only >/dev/null || fail 'master ruleset desired-state JSON is invalid.'
python3 "$verifier_regression" >/dev/null || fail 'ruleset verifier regression coverage failed.'

printf 'GitHub governance regression passed.\n'
