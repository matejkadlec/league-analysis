#!/usr/bin/env bash
# Deterministic regression coverage for the repository-owned deployment contract.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$repository_root/compose.production.yml"
backend_dockerfile="$repository_root/backend/Dockerfile"
frontend_dockerfile="$repository_root/frontend/Dockerfile"
deploy_script="$repository_root/deploy/production-deploy.sh"
container_qa="$repository_root/deploy/container-qa.sh"
deploy_workflow="$repository_root/.github/workflows/deploy.yml"
quality_workflow="$repository_root/.github/workflows/quality-checks.yml"

fail() {
  printf 'Deployment regression failed: %s\n' "$1" >&2
  exit 1
}

for required_file in \
  "$compose_file" \
  "$backend_dockerfile" \
  "$frontend_dockerfile" \
  "$repository_root/backend/.dockerignore" \
  "$repository_root/frontend/.dockerignore" \
  "$repository_root/deploy/production.env.example" \
  "$deploy_workflow"; do
  [[ -f "$required_file" ]] || fail "missing ${required_file#"$repository_root/"}"
done
[[ -x "$deploy_script" ]] || fail 'production-deploy.sh must be executable.'
[[ -x "$container_qa" ]] || fail 'container-qa.sh must be executable.'
bash -n "$deploy_script"
bash -n "$container_qa"

if grep -Eiq '(^|[^[:alnum:]_])(docker|podman)([^[:alnum:]_]|$)' "$repository_root/run.sh"; then
  fail 'run.sh must remain completely non-Docker.'
fi

grep -Fq 'uv sync --frozen --no-dev' "$backend_dockerfile" \
  || fail 'the backend image must install from uv.lock.'
grep -Fq 'USER league-analysis:league-analysis' "$backend_dockerfile" \
  || fail 'the backend runtime must be non-root.'
grep -Fq '"uvicorn", "app.main:app"' "$backend_dockerfile" \
  || fail 'the backend image must use production Uvicorn.'
grep -Fq 'npm ci' "$frontend_dockerfile" \
  || fail 'the frontend image must install from package-lock.json.'
grep -Fq 'npm run build' "$frontend_dockerfile" \
  || fail 'the frontend image must run a production build.'
grep -Fq 'CMD ["node", "server.js"]' "$frontend_dockerfile" \
  || fail 'the frontend image must run the standalone production server.'
grep -Fq 'USER league-analysis:league-analysis' "$frontend_dockerfile" \
  || fail 'the frontend runtime must be non-root.'
if grep -Eq 'COPY .*\.env|ADD .*\.env' "$backend_dockerfile" "$frontend_dockerfile"; then
  fail 'container images must not copy environment files.'
fi

postgres_block="$(sed -n '/^  postgres:/,/^  migrate:/p' "$compose_file")"
backend_block="$(sed -n '/^  backend:/,/^  frontend:/p' "$compose_file")"
frontend_block="$(sed -n '/^  frontend:/,/^networks:/p' "$compose_file")"
grep -Fq 'container_name: ${LGA_POSTGRES_CONTAINER_NAME:-league-analysis-postgres}' <<< "$postgres_block" \
  || fail 'the production PostgreSQL identity changed.'
if grep -Fq '    ports:' <<< "$postgres_block"; then
  fail 'PostgreSQL must remain internal-only.'
fi
grep -Fq 'condition: service_completed_successfully' <<< "$backend_block" \
  || fail 'backend startup must wait for the migration service.'
grep -Fq '/health/ready' <<< "$backend_block" \
  || fail 'backend health must use database readiness.'
grep -Fq 'condition: service_healthy' <<< "$frontend_block" \
  || fail 'frontend startup must wait for backend health.'
grep -Fq '${LGA_BACKEND_PORT:-8098}:8000' <<< "$backend_block" \
  || fail 'the backend production port changed.'
grep -Fq '${LGA_FRONTEND_PORT:-8097}:3000' <<< "$frontend_block" \
  || fail 'the frontend production port changed.'
grep -Fq 'internal: true' "$compose_file" \
  || fail 'the database network must be private.'
grep -Fq 'driver: local' "$compose_file" \
  || fail 'container logs must be bounded through the local driver.'

grep -Fq 'flock -n 9' "$deploy_script" \
  || fail 'deployments must hold a non-blocking host lock.'
grep -q 'LGA_POSTGRES_VOLUME_NAME' "$deploy_script" \
  && fail 'the deployment must not override the derived PostgreSQL volume name.'
grep -q 'name: .*postgres-data' "$compose_file" \
  && fail 'the PostgreSQL volume must stay unnamed so Compose derives it from the project.'
for production_identity in \
  'LGA_COMPOSE_PROJECT_NAME=league-analysis' \
  'LGA_POSTGRES_CONTAINER_NAME=league-analysis-postgres' \
  'LGA_BACKEND_CONTAINER_NAME=league-analysis-backend' \
  'LGA_FRONTEND_CONTAINER_NAME=league-analysis-frontend' \
  'LGA_FRONTEND_PORT=8097' \
  'LGA_BACKEND_PORT=8098'; do
  grep -Fq "$production_identity" "$deploy_script" \
    || fail "the production deployment is missing exact identity: $production_identity"
done
grep -Fq 'compose up --detach --remove-orphans --wait --wait-timeout 300' "$deploy_script" \
  || fail 'deployment must wait only for bounded container readiness.'
pre_deploy_backup_line="$(grep -n -F 'pre-deploy-backup' "$deploy_script" | cut -d: -f1)"
compose_up_line="$(grep -n -F 'compose up --detach --remove-orphans --wait --wait-timeout 300' "$deploy_script" | cut -d: -f1)"
((pre_deploy_backup_line < compose_up_line)) \
  || fail 'the pre-deployment PostgreSQL backup must finish before migration/startup.'
grep -Fq 'install-pi-postgres-backup-timer.sh' "$deploy_script" \
  || fail 'a successful deployment must refresh the reviewed operations and backup timer.'
backup_timer_installer="$repository_root/deploy/install-pi-postgres-backup-timer.sh"
grep -Fq 'sudo -n systemctl enable --now' "$backup_timer_installer" \
  || fail 'the backup timer must be installed as a system unit.'
grep -q '^systemctl --user\|[^-]systemctl --user enable' "$backup_timer_installer" \
  && fail 'the backup timer must not be enabled through the user systemd manager, which has no session bus under CI.'
grep -Fq 'label=com.docker.compose.volume=postgres_data' "$deploy_script" \
  || fail 'a missing PostgreSQL container must not hide an existing production volume.'
grep -Fq 'refusing to skip the pre-deployment backup' "$deploy_script" \
  || fail 'an orphaned production volume must fail the deployment safely.'
grep -Fq '"league-analysis-backend:$qa_identity"' "$container_qa" \
  || fail 'container QA must remove its uniquely tagged backend image.'
grep -Fq '"league-analysis-frontend:$qa_identity"' "$container_qa" \
  || fail 'container QA must remove its uniquely tagged frontend image.'
grep -Fq 'Disposable PostgreSQL 18 backup and restore rehearsal passed.' "$container_qa" \
  || fail 'container QA must rehearse a full disposable PostgreSQL restore.'
grep -Fq 'pg_restore --username "$POSTGRES_USER" --dbname "$1" --no-owner --no-privileges --exit-on-error' "$container_qa" \
  || fail 'container QA must fail closed while restoring the disposable archive.'
if grep -Eiq '/api/[^[:space:]]*jobs|running-status|job_executions' "$deploy_script"; then
  fail 'deployment must not inspect or drain application jobs.'
fi
grep -Fq '_scheduler.shutdown(wait=False)' "$repository_root/backend/app/features/jobs/scheduler.py" \
  || fail 'backend shutdown must not drain long-running scheduler executions.'

grep -Fqx 'name: Deploy to Raspberry Pi' "$deploy_workflow" \
  || fail 'the deployment workflow display name changed.'
grep -Fqx '    name: Deploy master to pi5ram16' "$deploy_workflow" \
  || fail 'the deployment workflow must target pi5ram16.'
grep -Fq 'runs-on: [self-hosted, pi5ram16]' "$deploy_workflow" \
  || fail 'the deployment workflow must select the pi5ram16 runner.'
grep -Fq 'cancel-in-progress: false' "$deploy_workflow" \
  || fail 'deployments must serialize instead of cancelling an active mutation.'
grep -Fq 'The private production environment is missing: %s' "$deploy_script" \
  || fail 'a missing private environment must report its exact host path.'
grep -Fqx '        run: ./deploy/container-qa.sh' "$quality_workflow" \
  || fail 'the required quality job must build and health-check the containers.'

grep -Fq 'deployment.md' "$repository_root/docs/README.md" \
  || fail 'the documentation index must link the deployment guide.'

printf 'Deployment and container contract regression passed.\n'
