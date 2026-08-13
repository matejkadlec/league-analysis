#!/usr/bin/env bash
# Build and exercise a disposable stack without touching native local runtime data.
set -Eeuo pipefail

if [[ $# -gt 0 ]]; then
  if [[ "$1" == "--help" || "$1" == "-h" ]]; then
    printf '%s\n' \
      'Usage: ./deploy/container-qa.sh' \
      '' \
      'Optional port overrides:' \
      '  LGA_CONTAINER_QA_FRONTEND_PORT=18097' \
      '  LGA_CONTAINER_QA_BACKEND_PORT=18098'
    exit 0
  fi
  printf 'container-qa.sh accepts no positional arguments.\n' >&2
  exit 2
fi

for command_name in docker ss; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '%s is required for explicit container QA.\n' "$command_name" >&2
    exit 1
  fi
done
docker compose version >/dev/null

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
frontend_port="${LGA_CONTAINER_QA_FRONTEND_PORT:-18097}"
backend_port="${LGA_CONTAINER_QA_BACKEND_PORT:-18098}"
for port in "$frontend_port" "$backend_port"; do
  if [[ ! "$port" =~ ^[0-9]+$ ]] || ((port < 1024 || port > 65535)); then
    printf 'Container QA ports must be integers from 1024 through 65535.\n' >&2
    exit 2
  fi
  if ss -H -ltn "sport = :$port" | grep -q .; then
    printf 'Container QA port %s is already in use.\n' "$port" >&2
    exit 1
  fi
done
if [[ "$frontend_port" == "$backend_port" ]]; then
  printf 'Container QA frontend and backend ports must differ.\n' >&2
  exit 2
fi

qa_directory="$(mktemp -d "${TMPDIR:-/tmp}/league-analysis-container-qa.XXXXXX")"
qa_identity="lga-qa-$(id -u)-$$"
environment_file="$qa_directory/container-qa.env"
restore_archive="$qa_directory/postgres-restore-qa.dump"
restore_database="league_analysis_container_qa_restore"
umask 077
cat > "$environment_file" <<EOF
POSTGRES_DB=league_analysis_container_qa
POSTGRES_USER=league_analysis_container_qa
POSTGRES_PASSWORD=league-analysis-container-qa-password
JWT_SECRET_KEY=league-analysis-container-qa-jwt-secret
LGA_COMPOSE_PROJECT_NAME=$qa_identity
LGA_POSTGRES_CONTAINER_NAME=$qa_identity-postgres
LGA_BACKEND_CONTAINER_NAME=$qa_identity-backend
LGA_FRONTEND_CONTAINER_NAME=$qa_identity-frontend
LGA_APPLICATION_NETWORK_NAME=$qa_identity-application
LGA_DATABASE_NETWORK_NAME=$qa_identity-database
LGA_BIND_ADDRESS=127.0.0.1
LGA_FRONTEND_PORT=$frontend_port
LGA_BACKEND_PORT=$backend_port
CORS_ORIGINS=http://127.0.0.1:$frontend_port
NEXT_PUBLIC_API_URL=http://127.0.0.1:$backend_port
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:$frontend_port
NEXT_PUBLIC_ALLOW_INDEXING=false
LOG_LEVEL=INFO
EOF
chmod 600 "$environment_file"

compose() {
  env \
    COMPOSE_DISABLE_ENV_FILE=1 \
    LGA_IMAGE_TAG="$qa_identity" \
    docker compose \
      --project-name "$qa_identity" \
      --env-file "$environment_file" \
      --file "$repository_root/compose.production.yml" \
      "$@"
}

cleanup() {
  local status=$?
  set +e
  compose down --volumes --remove-orphans >/dev/null 2>&1
  docker image rm -- \
    "league-analysis-backend:$qa_identity" \
    "league-analysis-frontend:$qa_identity" \
    >/dev/null 2>&1
  if [[ "$qa_directory" == "${TMPDIR:-/tmp}/league-analysis-container-qa."* ]]; then
    rm -rf -- "$qa_directory"
  fi
  exit "$status"
}
trap cleanup EXIT

compose config --quiet

# On 2026-08-12 the deploy script exported a hard-coded PostgreSQL volume name.
# Compose interpolation prefers the process environment over --env-file, so the
# override won and production started on an empty volume. The volume carries no
# name now, which forces it to follow the project. Resolve the production file
# under a hostile environment variable and prove the name still derives.
production_volumes="$(
  env COMPOSE_DISABLE_ENV_FILE=1 \
    LGA_POSTGRES_VOLUME_NAME=an-environment-variable-must-not-win \
    docker compose \
      --project-name league-analysis \
      --env-file "$repository_root/deploy/production.env.example" \
      --file "$repository_root/compose.production.yml" \
      config
)"
if ! grep -Fq 'name: league-analysis_postgres_data' <<< "$production_volumes"; then
  printf 'The production PostgreSQL volume no longer derives from the project.\n' >&2
  exit 1
fi

compose build --pull
if ! compose up --detach --remove-orphans --wait --wait-timeout 300; then
  compose ps --all >&2 || true
  compose logs --no-color --tail 100 migrate backend frontend >&2 || true
  exit 1
fi

migrate_container="$(compose ps --all --quiet migrate)"
if [[ -z "$migrate_container" || \
  "$(docker inspect --format '{{.State.ExitCode}}' "$migrate_container")" != "0" ]]; then
  printf 'The isolated migration service did not complete successfully.\n' >&2
  exit 1
fi

postgres_container="$(compose ps --quiet postgres)"
postgres_ports="$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$postgres_container")"
if [[ "$postgres_ports" != "null" && "$postgres_ports" != "{}" ]]; then
  printf 'The isolated PostgreSQL service unexpectedly published a host port.\n' >&2
  exit 1
fi

compose exec -T backend python -c \
  "from urllib.request import urlopen; urlopen('http://127.0.0.1:8000/health/ready', timeout=3)" \
  >/dev/null
compose exec -T frontend node -e \
  "fetch('http://127.0.0.1:3000/').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))" \
  >/dev/null

docker exec --user postgres "$postgres_container" sh -ceu \
  'exec pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --compress=gzip:9 --no-password' \
  > "$restore_archive"
chmod 600 "$restore_archive"
docker exec --interactive --user postgres "$postgres_container" \
  pg_restore --list < "$restore_archive" >/dev/null
docker exec --user postgres "$postgres_container" sh -ceu \
  'exec createdb --username "$POSTGRES_USER" --owner "$POSTGRES_USER" --template template0 "$1"' \
  -- "$restore_database"
docker exec --interactive --user postgres "$postgres_container" sh -ceu \
  'exec pg_restore --username "$POSTGRES_USER" --dbname "$1" --no-owner --no-privileges --exit-on-error' \
  -- "$restore_database" < "$restore_archive"
source_snapshot="$(
  docker exec --interactive --user postgres "$postgres_container" sh -ceu \
    'exec psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align' \
    < "$repository_root/backup/postgres-snapshot.sql"
)"
restored_snapshot="$(
  docker exec --interactive --user postgres "$postgres_container" sh -ceu \
    'exec psql --username "$POSTGRES_USER" --dbname "$1" --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align' \
    -- "$restore_database" < "$repository_root/backup/postgres-snapshot.sql"
)"
if [[ "$restored_snapshot" != "$source_snapshot" ]]; then
  printf 'The disposable PostgreSQL restore snapshot does not match its source.\n' >&2
  exit 1
fi
docker exec --user postgres "$postgres_container" sh -ceu \
  'exec dropdb --username "$POSTGRES_USER" --force "$1"' \
  -- "$restore_database"
printf 'Disposable PostgreSQL 18 backup and restore rehearsal passed.\n'

printf 'Disposable container QA passed; the isolated stack will now be removed.\n'
