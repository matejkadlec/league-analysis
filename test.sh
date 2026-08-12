#!/usr/bin/env bash
# Authoritative deterministic quality gate for League Analysis.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly repository_root

run_frontend=true
run_backend=true
next_env_file="$repository_root/frontend/next-env.d.ts"
next_env_backup=""
next_env_existed=false

usage() {
  printf '%s\n' \
    'Usage: ./test.sh [-f|--frontend|-b|--backend|-r|--repo]' \
    '  ./test.sh             Run the complete frontend and backend gate' \
    '  ./test.sh -f          Run repository and frontend checks' \
    '  ./test.sh -b          Run repository and backend checks' \
    '  ./test.sh -r          Run repository checks only (documentation-only changes)'
}

if [[ $# -gt 1 ]]; then
  usage >&2
  exit 2
fi

if [[ $# -eq 1 ]]; then
  case "$1" in
    -f|--frontend)
      run_backend=false
      ;;
    -b|--backend)
      run_frontend=false
      ;;
    -r|--repo)
      run_frontend=false
      run_backend=false
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
fi

cleanup_generated_files() {
  if [[ -z "$next_env_backup" ]]; then
    return
  fi

  if [[ "$next_env_existed" == true ]]; then
    cp "$next_env_backup" "$next_env_file"
  else
    rm -f -- "$next_env_file"
  fi
  rm -f -- "$next_env_backup"
}

if [[ "$run_frontend" == true ]]; then
  next_env_backup="$(mktemp "${TMPDIR:-/tmp}/league-analysis-next-env.XXXXXX")"
  if [[ -f "$next_env_file" ]]; then
    next_env_existed=true
    cp "$next_env_file" "$next_env_backup"
  fi
  trap cleanup_generated_files EXIT
fi

run_step() {
  local name="$1"
  shift
  printf '\n==> %s\n' "$name"
  if "$@"; then
    printf 'PASS: %s\n' "$name"
    return
  fi
  printf 'FAIL: %s\n' "$name" >&2
  exit 1
}

run_repository_hygiene() {
  git -C "$repository_root" diff --check
  python3 "$repository_root/scripts/check-repository-files.py"
}

run_backend_sync() {
  cd "$repository_root/backend"
  uv sync --frozen --all-groups
}

run_pre_commit_config_validation() {
  cd "$repository_root/backend"
  uv run pre-commit validate-config ../.pre-commit-config.yaml
}

run_backend_tests() {
  cd "$repository_root/backend"
  POSTGRES_DB=league_analysis_test \
    POSTGRES_USER=league_analysis_test \
    POSTGRES_PASSWORD=league-analysis-test-password \
    POSTGRES_HOST=127.0.0.1 \
    POSTGRES_PORT=5432 \
    DEBUG=false \
    JWT_SECRET_KEY=league-analysis-test-jwt-secret-32-characters \
    ENVIRONMENT=test \
    uv run pytest
}

run_backend_migration_validation() {
  cd "$repository_root/backend"
  DEBUG=false \
    ENVIRONMENT=test \
    JWT_SECRET_KEY=league-analysis-test-jwt-secret-32-characters \
    uv run python scripts/validate_migrations.py
}

run_backend_ruff_lint() {
  cd "$repository_root/backend"
  uv run ruff check app tests scripts ../scripts/*.py
}

run_backend_ruff_format() {
  cd "$repository_root/backend"
  uv run ruff format --check --exclude '*.md' app tests scripts ../scripts/*.py
}

run_backend_pyright() {
  cd "$repository_root/backend"
  uv run pyright
}

run_backend_bandit() {
  cd "$repository_root/backend"
  uv run bandit --quiet --recursive app \
    --severity-level medium \
    --confidence-level medium \
    --skip B104
}

run_frontend_install() {
  cd "$repository_root/frontend"
  npm ci
}

run_frontend_lint() {
  cd "$repository_root/frontend"
  npm run lint -- --max-warnings 0
}

run_frontend_typecheck() {
  cd "$repository_root/frontend"
  npm run typecheck
}

run_frontend_tests() {
  cd "$repository_root/frontend"
  npm test
}

run_frontend_build() {
  cd "$repository_root/frontend"
  npm run build
}

cd "$repository_root"
printf 'League Analysis quality gate\n'
if [[ "$run_frontend" == true && "$run_backend" == true ]]; then
  printf 'Scope: repository + frontend + backend\n'
elif [[ "$run_frontend" == true ]]; then
  printf 'Scope: repository + frontend\n'
elif [[ "$run_backend" == true ]]; then
  printf 'Scope: repository + backend\n'
else
  printf 'Scope: repository\n'
fi

run_step 'Repository hygiene' run_repository_hygiene
run_step 'ShellCheck' "$repository_root/scripts/run-shellcheck.sh"
run_step 'ShellCheck tooling regression' "$repository_root/scripts/test-shellcheck.sh"
run_step 'run.sh startup-order regression' "$repository_root/scripts/test-run.sh"
run_step 'Deployment and container contract regression' "$repository_root/scripts/test-deployment.sh"
run_step 'PostgreSQL operations regression' "$repository_root/scripts/test-postgres-operations.sh"
run_step 'GitHub workflow syntax' "$repository_root/scripts/run-actionlint.sh"
run_step 'actionlint tooling regression' "$repository_root/scripts/test-actionlint.sh"
run_step 'GitHub workflow security policy' python3 "$repository_root/scripts/verify-github-workflows.py"
run_step 'Dependabot configuration' python3 "$repository_root/scripts/check-dependabot-config.py"
run_step 'GitHub governance configuration' "$repository_root/scripts/test-github-governance.sh"
run_step 'Dependency audit policy regression' python3 "$repository_root/scripts/test-dependency-audit.py"
run_step 'Skill discovery regression' "$repository_root/scripts/test-skill-discovery.sh"

if [[ "$run_frontend" == true ]]; then
  # shellcheck disable=SC1091
  source "$repository_root/scripts/use-project-node.sh"
  run_step 'Node runtime helper regression' "$repository_root/scripts/test-use-project-node.sh"
  run_step 'Frontend deterministic install' run_frontend_install
  run_step 'Frontend lint' run_frontend_lint
  run_step 'Frontend typecheck' run_frontend_typecheck
  run_step 'Frontend regression tests' run_frontend_tests
  run_step 'Frontend production build' run_frontend_build
fi

if [[ "$run_backend" == true ]]; then
  command -v uv >/dev/null 2>&1 || {
    printf 'ERROR: uv is required for backend checks.\n' >&2
    exit 1
  }
  run_step 'Backend deterministic sync' run_backend_sync
  run_step 'Pre-commit configuration' run_pre_commit_config_validation
  run_step 'Backend tests' run_backend_tests
  run_step 'Alembic migration validation' run_backend_migration_validation
  run_step 'Backend Ruff lint' run_backend_ruff_lint
  run_step 'Backend Ruff format' run_backend_ruff_format
  run_step 'Backend Pyright' run_backend_pyright
  run_step 'Backend Bandit medium-confidence scan' run_backend_bandit
fi

printf '\nAll selected quality checks passed.\n'
