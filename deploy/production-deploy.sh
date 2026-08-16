#!/usr/bin/env bash
# Deploy one exact repository revision with the repository-owned Compose file.
set -Eeuo pipefail

usage() {
  printf '%s\n' \
    'Usage: production-deploy.sh --source /absolute/checkout --commit FULL_SHA' \
    '' \
    'The private runtime environment must exist at:' \
    '  $LGA_DEPLOY_ROOT/production.env' \
    'or, by default:' \
    '  $HOME/.local/share/league-analysis/production.env'
}

source_directory=""
commit=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      source_directory="${2:-}"
      shift 2
      ;;
    --commit)
      commit="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$source_directory" != /* || ! -d "$source_directory" ]]; then
  printf 'The source checkout must be an existing absolute directory.\n' >&2
  exit 2
fi
if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'A full lowercase Git commit is required.\n' >&2
  exit 2
fi

for command_name in curl docker flock git tar; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf '%s is required for production deployment.\n' "$command_name" >&2
    exit 1
  fi
done
docker compose version >/dev/null

source_directory="$(realpath -- "$source_directory")"
source_head="$(git -C "$source_directory" rev-parse HEAD)"
if [[ "$source_head" != "$commit" ]]; then
  printf 'The source checkout does not match the requested deployment commit.\n' >&2
  exit 1
fi
deployment_root="${LGA_DEPLOY_ROOT:-$HOME/.local/share/league-analysis}"
if [[ "$deployment_root" != /* || "$deployment_root" == "/" || "$deployment_root" == "$HOME" ]]; then
  printf 'LGA_DEPLOY_ROOT must be a dedicated absolute subdirectory.\n' >&2
  exit 1
fi
environment_file="$deployment_root/production.env"
if [[ -L "$environment_file" ]]; then
  printf 'The private production environment must not be a symlink: %s\n' \
    "$environment_file" >&2
  exit 1
fi
if [[ ! -e "$environment_file" ]]; then
  printf 'The private production environment is missing: %s\n' \
    "$environment_file" >&2
  printf 'Provision it locally from deploy/production.env.example without exposing its values.\n' >&2
  exit 1
fi
if [[ ! -f "$environment_file" ]]; then
  printf 'The private production environment must be a regular file: %s\n' \
    "$environment_file" >&2
  exit 1
fi
if [[ "$(stat -c '%a' "$environment_file")" != "600" ]]; then
  printf 'The private production environment must have mode 0600.\n' >&2
  exit 1
fi

releases_directory="$deployment_root/releases"
state_directory="$deployment_root/state"
install -d -m 700 "$deployment_root" "$releases_directory" "$state_directory"
exec 9>"$deployment_root/.deploy.lock"
if ! flock -n 9; then
  printf 'Another League Analysis deployment is already running.\n' >&2
  exit 1
fi

release_directory="$releases_directory/$commit"
stage_directory=""
cleanup() {
  if [[ -n "$stage_directory" && -d "$stage_directory" && \
    "$stage_directory" == "$releases_directory/.incoming-$commit."* ]]; then
    rm -rf -- "$stage_directory"
  fi
}
trap cleanup EXIT

if [[ ! -d "$release_directory" ]]; then
  stage_directory="$(mktemp -d "$releases_directory/.incoming-$commit.XXXXXX")"
  git -C "$source_directory" archive --format=tar "$commit" \
    | tar --extract --file=- --directory "$stage_directory" \
      --no-same-owner --no-same-permissions
  mv -- "$stage_directory" "$release_directory"
  stage_directory=""
fi
if [[ ! -f "$release_directory/compose.production.yml" || \
  ! -x "$release_directory/deploy/production-deploy.sh" ]]; then
  printf 'The staged revision does not contain the deployment contract.\n' >&2
  exit 1
fi

compose() {
  env \
    COMPOSE_DISABLE_ENV_FILE=1 \
    LGA_IMAGE_TAG="$commit" \
    LGA_COMPOSE_PROJECT_NAME=league-analysis \
    LGA_POSTGRES_CONTAINER_NAME=league-analysis-postgres \
    LGA_BACKEND_CONTAINER_NAME=league-analysis-backend \
    LGA_FRONTEND_CONTAINER_NAME=league-analysis-frontend \
    LGA_APPLICATION_NETWORK_NAME=league-analysis-application \
    LGA_DATABASE_NETWORK_NAME=league-analysis-database \
    LGA_FRONTEND_PORT=8097 \
    LGA_BACKEND_PORT=8098 \
    docker compose \
      --env-file "$environment_file" \
      --file "$release_directory/compose.production.yml" \
      "$@"
}

compose config --quiet
compose build --pull

existing_postgres_container="$(compose ps --all --quiet postgres)"
if [[ -n "$existing_postgres_container" ]]; then
  "$release_directory/backup/pi-postgres-operations.sh" \
    pre-deploy-backup \
    --confirm-target league_analysis \
    --commit "$commit"
else
  existing_postgres_volume="$(
    docker volume ls \
      --filter label=com.docker.compose.project=league-analysis \
      --filter label=com.docker.compose.volume=postgres_data \
      --format '{{.Name}}'
  )"
  if [[ -n "$existing_postgres_volume" ]]; then
    printf 'A League Analysis PostgreSQL volume exists without the exact container; refusing to skip the pre-deployment backup.\n' >&2
    exit 1
  fi
  printf 'No existing League Analysis PostgreSQL container; pre-deployment backup is not applicable.\n'
fi

# Never poll or drain application jobs here. Container shutdown is bounded;
# interrupted job records are reconciled by the backend's startup recovery.
if ! compose up --detach --remove-orphans --wait --wait-timeout 300; then
  printf 'Deployment failed while starting or health-checking the stack.\n' >&2
  compose ps --all >&2 || true
  compose logs --no-color --tail 100 migrate backend frontend >&2 || true
  exit 1
fi

postgres_container="$(compose ps --quiet postgres)"
if [[ -z "$postgres_container" ]]; then
  printf 'The PostgreSQL container is not running.\n' >&2
  exit 1
fi
postgres_ports="$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$postgres_container")"
if [[ "$postgres_ports" != "null" && "$postgres_ports" != "{}" ]]; then
  printf 'PostgreSQL must not publish a host port.\n' >&2
  exit 1
fi

# Container health checks answer from inside the container, so they say nothing
# about the ports this host published. Probe those ports directly, and only
# those: the public hostnames are served by a Cloudflare Worker, so a request
# there would report on Cloudflare rather than on this deployment. The release
# is blessed below only once both services have answered.
verify_published_service() {
  local name="$1" service="$2" container_port="$3" request_path="$4"
  local endpoint address port url attempt=1
  if ! endpoint="$(compose port "$service" "$container_port")" || [[ -z "$endpoint" ]]; then
    printf 'The %s service published no host port for %s.\n' "$service" "$container_port" >&2
    return 1
  fi
  if [[ ! "$endpoint" =~ ^([^[:space:]]+):([0-9]+)$ ]]; then
    printf 'The %s service published an unreadable endpoint: %s\n' "$service" "$endpoint" >&2
    return 1
  fi
  address="${BASH_REMATCH[1]}"
  port="${BASH_REMATCH[2]}"
  # A wildcard bind is not an address a client can ask for; a bind to one
  # address is, and is used as published.
  case "$address" in
    0.0.0.0) address='127.0.0.1' ;;
    '[::]') address='[::1]' ;;
  esac
  url="http://$address:$port$request_path"
  # Deliberately without --location: a redirect here would most likely point at
  # the public site, and following it would test Cloudflare instead of this
  # host. The answer has to come from the port this deployment published.
  while true; do
    if curl --fail --silent --show-error --max-time 10 --output /dev/null "$url"; then
      printf 'Post-deployment check passed: %s (%s).\n' "$name" "$url"
      return 0
    fi
    if [[ "$attempt" -ge 5 ]]; then
      printf 'Post-deployment check failed: %s (%s).\n' "$name" "$url" >&2
      return 1
    fi
    attempt=$((attempt + 1))
    sleep 3
  done
}

if ! verify_published_service 'backend readiness' backend 8000 /health/ready || \
  ! verify_published_service 'frontend root' frontend 3000 /; then
  compose ps --all >&2 || true
  compose logs --no-color --tail 100 backend frontend >&2 || true
  exit 1
fi

next_link="$deployment_root/.current-$commit-$$"
ln -s "releases/$commit" "$next_link"
mv -Tf -- "$next_link" "$deployment_root/current"
printf '%s\n' "$commit" > "$state_directory/deployed-commit"
chmod 600 "$state_directory/deployed-commit"

"$release_directory/backup/install-pi-postgres-backup-timer.sh"

printf 'League Analysis deployment completed at %s.\n' "$commit"
