#!/usr/bin/env bash
# Keep local, CI, workflow, dependency, and hook entry points coupled.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
gate="$repository_root/test.sh"
ci_gate="$repository_root/scripts/ci.sh"
workflow="$repository_root/.github/workflows/quality-checks.yml"
pre_commit="$repository_root/.pre-commit-config.yaml"

fail() {
  printf 'Quality tooling regression failed: %s\n' "$1" >&2
  exit 1
}

[[ -x "$gate" ]] || fail './test.sh must be executable.'
[[ -x "$ci_gate" ]] || fail 'scripts/ci.sh must be executable.'
[[ -x "$repository_root/scripts/dependency-audit.sh" ]] || fail 'dependency audit must be executable.'
bash -n "$gate"
bash -n "$ci_gate"
grep -Fqx '"$repository_root/test.sh"' "$ci_gate" || fail 'CI must invoke the authoritative local gate.'
grep -Fqx '    name: Deterministic full-project gate' "$workflow" || fail 'the stable quality job name changed.'
grep -Fqx '        run: ./scripts/ci.sh' "$workflow" || fail 'Quality Checks must invoke scripts/ci.sh.'
grep -Fqx '    name: Live production dependency audit' "$workflow" || fail 'the dependency audit job is missing.'
grep -Fqx '        run: ./scripts/dependency-audit.sh "$CHANGE_BASE_SHA"' "$workflow" || fail 'the workflow must use the maintained comparative dependency audit.'
grep -Fq 'npm run lint -- --max-warnings 0' "$gate" || fail 'frontend lint must reject warnings.'
grep -Fq 'uv run pytest' "$gate" || fail 'backend pytest is missing from the gate.'
grep -Fq 'uv run bandit' "$gate" || fail 'backend security analysis is missing from the gate.'
python3 "$repository_root/scripts/test-dependency-audit.py" >/dev/null || fail 'dependency audit policy regressions failed.'
if "$repository_root/scripts/run-actionlint.sh" \
  "$repository_root/tests/fixtures/github-workflows/invalid-expression.yml" \
  >/dev/null 2>&1; then
  fail 'actionlint accepted the invalid workflow regression fixture.'
fi
grep -Fq 'frontend-lint' "$pre_commit" || fail 'the fast frontend lint pre-commit hook is missing.'
grep -Fq 'frontend-typecheck' "$pre_commit" || fail 'the fast frontend typecheck pre-commit hook is missing.'
grep -Fqx '    rev: v0.16.1' "$pre_commit" || fail 'pre-commit Ruff must match the backend tool pin.'

printf 'Quality tooling regression passed.\n'
