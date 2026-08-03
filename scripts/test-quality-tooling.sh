#!/usr/bin/env bash
# Keep local, CI, workflow, dependency, and hook entry points coupled.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
gate="$repository_root/test.sh"
ci_gate="$repository_root/scripts/ci.sh"
workflow="$repository_root/.github/workflows/quality-checks.yml"
pre_commit="$repository_root/.pre-commit-config.yaml"
frontend_package="$repository_root/frontend/package.json"
worktree_guard="$repository_root/scripts/guard-git-worktree-test.sh"
flow_policy_regression="$repository_root/scripts/test-flow1-policy.sh"
worktree_regression="$repository_root/scripts/test-worktree-tooling.sh"

fail() {
  printf 'Quality tooling regression failed: %s\n' "$1" >&2
  exit 1
}

[[ -x "$gate" ]] || fail './test.sh must be executable.'
[[ -x "$ci_gate" ]] || fail 'scripts/ci.sh must be executable.'
[[ -x "$repository_root/scripts/dependency-audit.sh" ]] || fail 'dependency audit must be executable.'
[[ -x "$worktree_guard" ]] || fail 'the worktree integrity guard must be executable.'
[[ -x "$flow_policy_regression" ]] || fail 'the Flow 1 policy regression must be executable.'
[[ -x "$worktree_regression" ]] || fail 'the worktree tooling regression must be executable.'
bash -n "$gate"
bash -n "$ci_gate"
bash -n "$worktree_guard"
bash -n "$flow_policy_regression"
bash -n "$worktree_regression"
grep -Fqx '"$repository_root/test.sh"' "$ci_gate" || fail 'CI must invoke the authoritative local gate.'
[[ "$(grep -Fxc '  exec "$worktree_guard" --repository "$repository_root" -- "$repository_root/test.sh" "$@"' "$gate")" -eq 1 ]] \
  || fail './test.sh must enter the worktree guard exactly once.'
grep -Fqx "run_step 'Flow 1 policy regression' \"\$repository_root/scripts/test-flow1-policy.sh\"" "$gate" \
  || fail 'the authoritative gate must run Flow 1 policy regressions.'
grep -Fqx "run_step 'Worktree tooling regression' \"\$repository_root/scripts/test-worktree-tooling.sh\"" "$gate" \
  || fail 'the authoritative gate must run worktree regressions.'
grep -Fqx '    name: Deterministic full-project gate' "$workflow" || fail 'the stable quality job name changed.'
grep -Fqx '        run: ./scripts/ci.sh' "$workflow" || fail 'Quality Checks must invoke scripts/ci.sh.'
grep -Fqx '    name: Live production dependency audit' "$workflow" || fail 'the dependency audit job is missing.'
grep -Fqx '        run: ./scripts/dependency-audit.sh "$CHANGE_BASE_SHA"' "$workflow" || fail 'the workflow must use the maintained comparative dependency audit.'
[[ "$(grep -Fxc '        run: npm install --global npm@12.0.2 --ignore-scripts' "$workflow")" -eq 2 ]] || fail 'both workflow jobs must install the pinned npm release.'
[[ "$(grep -Fxc '          version: "0.12.1"' "$workflow")" -eq 2 ]] || fail 'both workflow jobs must install the pinned uv release.'
grep -Fqx '        image: postgres:18.4' "$workflow" || fail 'the CI database image must use the reviewed PostgreSQL minor.'
grep -Fqx '    uv run python scripts/migrate.py upgrade head' "$ci_gate" || fail 'CI must use the locked Alembic migration command.'
grep -Fq '"packageManager": "npm@12.0.2"' "$frontend_package" || fail 'the frontend package-manager pin changed.'
grep -Fq 'npm run lint -- --max-warnings 0' "$gate" || fail 'frontend lint must reject warnings.'
grep -Fq 'uv run pytest' "$gate" || fail 'backend pytest is missing from the gate.'
grep -Fq 'uv run python scripts/validate_migrations.py' "$gate" || fail 'Alembic migration validation is missing from the gate.'
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
grep -Fq 'source "$SCRIPT_DIR/scripts/use-project-node.sh"' "$repository_root/run.sh" || fail 'run.sh must select the project Node runtime.'

printf 'Quality tooling regression passed.\n'
