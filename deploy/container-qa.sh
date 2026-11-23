#!/usr/bin/env bash
# Builds the production images and exercises a disposable copy of the stack.
#
#   ./deploy/container-qa.sh
#
# It needs Docker Compose and nothing else: no port is published, every check
# runs inside the containers. The stack runs as the project
# `league-analysis-qa` with throwaway secrets and its own volume
# (deploy/compose.qa.yml), and is removed again at the end. The subnets are the
# production ones, so on a daemon that already runs production it stops at
# network creation instead of running beside it.
set -Eeuo pipefail

(($# == 0)) || {
  printf 'container-qa.sh takes no arguments.\n' >&2
  exit 2
}
command -v docker >/dev/null 2>&1 || {
  printf 'docker is required for container QA.\n' >&2
  exit 1
}
docker compose version >/dev/null

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly repository_root
readonly release="qa-$$"
qa_directory="$(mktemp -d "${TMPDIR:-/tmp}/league-analysis-container-qa.XXXXXX")"
readonly qa_directory

log() { printf '\n==> %s\n' "$*"; }
fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

umask 077
# Throwaway values for a database that exists for the length of this run.
printf 'POSTGRES_PASSWORD=league-analysis-container-qa-password\n' >"$qa_directory/postgres.env"
printf 'JWT_SECRET_KEY=league-analysis-container-qa-jwt-value-0123456789\n' >"$qa_directory/backend.env"

production() {
  RELEASE="$release" LGA_CONFIG_DIRECTORY="$qa_directory" docker compose \
    --project-directory "$repository_root" \
    --file "$repository_root/compose.production.yml" "$@"
}
qa() {
  production --file "$repository_root/deploy/compose.qa.yml" "$@"
}

cleanup() {
  local status=$?
  set +e
  qa down --volumes --remove-orphans >/dev/null 2>&1
  docker image rm "league-analysis-backend:$release" "league-analysis-frontend:$release" >/dev/null 2>&1
  rm -rf -- "$qa_directory"
  exit "$status"
}
# INT/TERM as well as EXIT: a cancelled CI run kills this script with a signal,
# and bash skips the EXIT trap for a signal it has not trapped.
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

log 'The production file names its volume itself, and nothing can rename it'
# On 2026-08-12 an exported variable overrode the volume name and production
# started on an empty database. The file interpolates no name now; resolve it
# under hostile variables and prove the volume is still the one, and external.
resolved="$(
  LGA_POSTGRES_VOLUME_NAME=must-not-win POSTGRES_VOLUME=must-not-win \
    production config --format json
)"
python3 -c '
import json, sys
configuration = json.load(sys.stdin)
volume = configuration["volumes"]["postgres_data"]
assert volume == {"name": "league-analysis-postgres-data", "external": True}, volume
assert configuration["name"] == "league-analysis", configuration["name"]
published = [service for service, body in configuration["services"].items() if body.get("ports")]
assert not published, f"services publish host ports: {published}"
' <<<"$resolved" || fail 'compose.production.yml no longer pins its volume, its project name or its closed ports'

log 'Building both images'
qa build

log 'Starting the stack and waiting for migration and health'
if ! qa up --detach --wait --wait-timeout 300; then
  qa ps --all >&2 || true
  qa logs --no-color --tail 80 migrate backend frontend >&2 || true
  fail 'the stack did not become healthy'
fi

in_frontend() {
  qa exec --no-TTY frontend node -e "$1"
}

# expect_status <path> <status>: through the interface, as a browser would.
expect_status() {
  in_frontend "fetch('http://127.0.0.1:3000$1', {redirect: 'manual'}).then((r) => { if (r.status !== $2) { console.error('$1 answered', r.status); process.exit(1); } }).catch((e) => { console.error(e); process.exit(1); })" ||
    fail "$1 did not answer $2"
  printf 'PASS: %s answers %s\n' "$1" "$2"
}

log 'Routing: the interface forwards the versioned API and nothing else'
expect_status /sign-in 200
expect_status /api/v1/auth/me 401
expect_status /api 404
expect_status /openapi.json 404
expect_status /redoc 307

log 'Registration is closed'
in_frontend "fetch('http://127.0.0.1:3000/api/v1/auth/register', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({email: 'qa@example.com', display_name: 'Container QA', password: 'Valid-Passw0rd!'})}).then((r) => { if (r.status !== 404) { console.error('register answered', r.status); process.exit(1); } })" ||
  fail 'POST /api/v1/auth/register did not answer 404'
users="$(qa exec --no-TTY --user postgres postgres sh -ceu 'exec psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT count(*) FROM auth.users"')"
[[ "$users" == "0" ]] || fail "the registration attempt left $users account(s)"
printf 'PASS: registration answers 404 and created no account\n'

log 'Security headers'
in_frontend "fetch('http://127.0.0.1:3000/sign-in').then((r) => { const expected = {'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin-when-cross-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()', 'strict-transport-security': 'max-age=31536000; includeSubDomains'}; for (const [name, value] of Object.entries(expected)) { if (r.headers.get(name) !== value) { console.error(name, 'is', r.headers.get(name)); process.exit(1); } } })" ||
  fail 'a security header is missing or different'
printf 'PASS: all five security headers are sent\n'

log 'Client address: the API sees the forwarded address, not the interface'
# 203.0.113.0/24 is reserved for documentation, so it can only have come from
# the header this request carries.
in_frontend "fetch('http://127.0.0.1:3000/api/v1/auth/me', {headers: {'x-forwarded-for': '198.51.100.7, 203.0.113.9'}}).then(() => process.exit(0))"
sleep 1
access_log="$(qa logs --no-color --tail 40 backend)"
grep -Fq '203.0.113.9' <<<"$access_log" || fail 'the API access log does not show the forwarded client address'
! grep -Fq '198.51.100.7:' <<<"$access_log" || fail 'the API trusted an address the client itself supplied'
printf 'PASS: the API logged the last forwarded address\n'

log 'Hardening: unprivileged, read-only, no capabilities'
for service in backend frontend; do
  container="$(qa ps --quiet "$service")"
  facts="$(docker inspect --format '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.PidsLimit}} {{.HostConfig.Memory}}' "$container")"
  [[ "$facts" == "league-analysis:league-analysis true [ALL] 256 "* && "$facts" != *" 0" ]] ||
    fail "$service is not hardened as documented: $facts"
  [[ "$(qa exec --no-TTY "$service" id -u)" == "10001" ]] || fail "$service does not run as UID 10001"
done
printf 'PASS: the API and the interface run as UID 10001 on a read-only root\n'

log 'The account command creates an administrator who can log in'
printf 'Valid-Passw0rd!\n' | qa exec --no-TTY backend python scripts/account.py \
  --email qa-admin@example.com --display-name 'Container QA' --admin --password-stdin
in_frontend "fetch('http://127.0.0.1:3000/api/v1/auth/login', {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({username: 'qa-admin@example.com', password: 'Valid-Passw0rd!'})}).then((r) => { const cookies = r.headers.getSetCookie().join(' '); if (r.status !== 200 || !/league_analysis_access_token=[^;]+;.*HttpOnly.*Secure/i.test(cookies)) { console.error('login answered', r.status); process.exit(1); } })" ||
  fail 'the created administrator could not log in with Secure, HttpOnly cookies'
printf 'PASS: login succeeds and sets Secure, HttpOnly cookies\n'

log 'A restart keeps exactly one API container'
qa up --detach --wait --wait-timeout 300 --force-recreate backend
[[ "$(docker ps --quiet --filter 'label=com.docker.compose.project=league-analysis-qa' --filter 'label=com.docker.compose.service=backend' | wc -l)" == "1" ]] ||
  fail 'more or fewer than one API container is running'
printf 'PASS: one API container after a recreate\n'

printf '\nContainer QA passed; the disposable stack will now be removed.\n'
