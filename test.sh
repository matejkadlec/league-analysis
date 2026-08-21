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
}

run_backend_sync() {
  cd "$repository_root/backend"
  uv sync --locked --all-groups
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
    uv run pytest --cov --cov-report=term
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
  uv run ruff check app tests scripts
}

run_backend_ruff_format() {
  cd "$repository_root/backend"
  uv run ruff format --check --exclude '*.md' app tests scripts
}

run_backend_pyright() {
  cd "$repository_root/backend"
  uv run pyright
}

run_backend_bandit() {
  cd "$repository_root/backend"
  uv run bandit --quiet --recursive app scripts \
    --severity-level medium \
    --confidence-level medium \
    --skip B104
}

run_backend_vulture() {
  cd "$repository_root/backend"
  uv run vulture
}

run_backend_deptry() {
  cd "$repository_root/backend"
  uv run deptry .
}

run_backend_xenon() {
  "$repository_root/scripts/run-xenon.sh"
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

run_frontend_deadcode() {
  cd "$repository_root/frontend"
  # See the `deadcode` script in frontend/package.json for the issue types --
  # `exports` is among them, so a barrel entry whose last importer goes away
  # fails here.
  npm run deadcode
}

run_frontend_tests() {
  cd "$repository_root/frontend"
  # --coverage is what arms the thresholds in vitest.config.mts. Without it
  # Vitest never computes coverage and never compares it to the floors, so the
  # configured minimums would sit in the repository doing nothing.
  npm test -- --coverage
}

run_frontend_build() {
  cd "$repository_root/frontend"
  # Most player routes prerender, and the root layout resolves the Data Dragon
  # version while they do, so an unpinned build calls Riot's CDN and bakes the
  # answer into the static payload. The end-to-end specs then read that baked
  # value and no runtime environment can change it. Keep this in step with the
  # DDRAGON_VERSION in frontend/playwright.config.ts, which covers the routes
  # that stay dynamic.
  DDRAGON_VERSION=16.15.1 npm run build
}

run_api_contract_alignment() {
  # The other half of backend/tests/test_model_schema_alignment.py. That one
  # guards column -> Pydantic inside pytest; these guard Pydantic -> zod and
  # Pydantic -> form, which need both runtimes and so cannot live in either
  # suite. Only runs on the full gate, because a frontend-only run has no
  # backend venv to ask.
  local openapi_document
  openapi_document="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -f '$openapi_document'" RETURN
  (cd "$repository_root/backend" && uv run --no-sync python scripts/dump_openapi.py) \
    > "$openapi_document"
  cd "$repository_root/frontend"
  # Every *-alignment test, not one named file: the ones that read
  # OPENAPI_JSON skip themselves when it is unset, so a file left out of this
  # line does not fail -- it silently stops comparing anything, which is how
  # tests/riot-id-alignment.test.ts spent its whole life never running. The
  # api-contract test asserts that every OPENAPI_JSON reader matches this
  # filter, so the convention this relies on cannot rot quietly.
  OPENAPI_JSON="$openapi_document" npm test -- --run alignment
}

run_frontend_e2e() {
  cd "$repository_root/frontend"
  # Every request is mocked in the specs, so this needs no database and no
  # backend — only the server playwright.config.ts starts itself. It has to
  # run after the production build, because what it starts is that build:
  # `npm run start:standalone` serves .next/standalone rather than compiling
  # on demand.
  # `--` is load-bearing: without it npm swallows the flag and the gate runs
  # unguarded. Playwright's `forbidOnly` defaults to false, and its `.only` is
  # global to the run -- one committed `test.only` runs that test, skips the
  # whole rest of the suite, and reports PASS.
  npm run test:e2e -- --forbid-only
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
# Secret scanning and the architecture rules used to run only from
# .githooks/pre-commit, which every developer has to opt into. These two steps
# are what makes them true of master rather than of one machine.
run_step 'Secret scan' "$repository_root/scripts/run-gitleaks.sh"
run_step 'Repository architecture rules' "$repository_root/scripts/run-local-precommit-hooks.sh"
run_step 'ShellCheck' "$repository_root/scripts/run-shellcheck.sh"
run_step 'GitHub workflow syntax' "$repository_root/scripts/run-actionlint.sh"
run_step 'PostgreSQL backup retention regression' "$repository_root/scripts/test-postgres-backup-retention.sh"

if [[ "$run_frontend" == true ]]; then
  # shellcheck disable=SC1091
  source "$repository_root/scripts/use-project-node.sh"
  run_step 'Frontend deterministic install' run_frontend_install
  run_step 'Frontend lint' run_frontend_lint
  run_step 'Frontend typecheck' run_frontend_typecheck
  run_step 'Frontend knip dead-code scan' run_frontend_deadcode
  run_step 'Frontend regression tests' run_frontend_tests
  run_step 'Frontend production build' run_frontend_build
  run_step 'Frontend end-to-end tests' run_frontend_e2e
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
  run_step 'Backend vulture dead-code scan' run_backend_vulture
  run_step 'Backend deptry dependency scan' run_backend_deptry
  run_step 'Backend xenon complexity' run_backend_xenon
fi

if [[ "$run_frontend" == true && "$run_backend" == true ]]; then
  run_step 'API contract alignment (OpenAPI vs zod)' run_api_contract_alignment
fi

printf '\nAll selected quality checks passed.\n'
