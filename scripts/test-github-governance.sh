#!/usr/bin/env bash
# Keep the tracked master-branch ruleset and audit entry point deterministic.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
verifier="$repository_root/scripts/verify-github-ruleset.py"
configuration="$repository_root/.github/master-branch-ruleset.json"
governance_document="$repository_root/docs/github-governance.md"
root_guide="$repository_root/AGENTS.md"
verifier_regression="$repository_root/scripts/test-verify-github-ruleset.py"

fail() {
  printf 'GitHub governance regression failed: %s\n' "$1" >&2
  exit 1
}

[[ -f "$configuration" ]] || fail 'master ruleset desired-state JSON is missing.'
[[ -f "$verifier" ]] || fail 'live ruleset verifier is missing.'
[[ -f "$governance_document" ]] || fail 'GitHub governance documentation is missing.'
[[ -f "$root_guide" ]] || fail 'the root agent guide is missing.'
[[ -f "$verifier_regression" ]] || fail 'ruleset verifier regression coverage is missing.'

python3 "$verifier" --config-only >/dev/null || fail 'master ruleset desired-state JSON is invalid.'
python3 "$verifier_regression" >/dev/null || fail 'ruleset verifier regression coverage failed.'
grep -Fq 'Deterministic full-project gate' "$governance_document" || fail 'stable deterministic check is undocumented.'
grep -Fq 'Live production dependency audit' "$governance_document" || fail 'stable dependency audit check is undocumented.'
grep -Fq 'GitHub Actions integration' "$governance_document" || fail 'required check integration is undocumented.'
grep -Fq 'python3 scripts/verify-github-ruleset.py' "$governance_document" || fail 'live ruleset audit command is undocumented.'
grep -Fq 'GitHub branch governance' "$root_guide" || fail 'root guide must map branch governance.'

printf 'GitHub governance regression passed.\n'
