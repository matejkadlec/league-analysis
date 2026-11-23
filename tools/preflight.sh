#!/usr/bin/env bash
# Prerequisite checks that run.sh and test.sh source and run before they start
# anything. Every check prints what is wrong and how to fix it, then returns
# nonzero: both callers run under `set -e`, which must never end them silently.

preflight_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

preflight_error() {
  printf 'ERROR: %s\n' "$1" >&2
  shift
  local line
  for line in "$@"; do
    printf '  %s\n' "$line" >&2
  done
  return 1
}

# The PostgreSQL major version the gate runs, from its `postgres:<version>`
# image; tools/check-toolchain-pins.sh keeps production on the same one.
preflight_postgres_major() {
  sed -n 's/^[[:space:]]*image:[[:space:]]*postgres:\([0-9][0-9]*\).*/\1/p' \
    "$preflight_root/compose.gate.yml" 2>/dev/null | head -n 1
}

preflight_install_hint() {
  case "$1" in
    lsof) printf 'Install the lsof package.' ;;
    ss) printf 'Install the iproute2 package.' ;;
    curl) printf 'Install the curl package.' ;;
    psql | pg_dump | pg_restore)
      printf 'Install the PostgreSQL %s client (postgresql-client-%s).' \
        "$(preflight_postgres_major)" "$(preflight_postgres_major)"
      ;;
    uv) printf 'Install uv: https://docs.astral.sh/uv/getting-started/installation/' ;;
    *) printf 'Install %s.' "$1" ;;
  esac
}

# Reports every missing command at once, not only the first.
preflight_commands() {
  local name status=0
  for name in "$@"; do
    if ! command -v "$name" >/dev/null 2>&1; then
      preflight_error "$name is required but was not found on PATH." \
        "$(preflight_install_hint "$name")" || status=1
    fi
  done
  return "$status"
}

# The selector prints the required and active versions and the install command.
preflight_node() {
  # shellcheck source=tools/use-project-node.sh
  source "$preflight_root/tools/use-project-node.sh"
}

# `uv run` installs the pinned Python and syncs backend/.venv when it can, and
# prints why when it cannot; this only makes that happen before anything starts.
preflight_backend_environment() {
  local python_version
  python_version="$(tr -d '[:space:]' < "$preflight_root/.python-version")"
  if (cd "$preflight_root/backend" && uv run python -c 'import sys'); then
    return 0
  fi
  preflight_error \
    "uv could not prepare the backend environment (Python $python_version from .python-version)." \
    "uv's own message is above. Install the pinned Python: uv python install $python_version" \
    "Then rebuild the environment: (cd backend && uv sync --all-groups)"
}

preflight_postgres_settings() {
  local name
  local missing=()
  for name in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD POSTGRES_HOST POSTGRES_PORT; do
    if [[ -z "${!name:-}" ]]; then
      missing+=("$name")
    fi
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    return 0
  fi
  preflight_error "${missing[*]} not set." \
    "Set them in .env (copy .env.example; README.md, step 2, creates the database)."
}

# Connects as the scripts will and compares the server's major version with the
# gate's. Arguments: host, port, user, password, database.
preflight_postgres() {
  local host="$1" port="$2" user="$3" password="$4" database="$5"
  local expected output server_major

  expected="$(preflight_postgres_major)"
  if ! output="$(
    PGPASSWORD="$password" PGCONNECT_TIMEOUT=5 psql -X --no-password \
      -h "$host" -p "$port" -U "$user" -d "$database" \
      -tAc 'SHOW server_version_num' 2>&1
  )"; then
    preflight_error "Cannot connect to PostgreSQL at $host:$port as $user (database $database)." \
      "psql: $(printf '%s' "$output" | tr '\n' ' ')" \
      "Start the server (WSL: sudo service postgresql start) and check the POSTGRES_* settings."
    return 1
  fi

  output="$(printf '%s' "$output" | tr -d '[:space:]')"
  if ! [[ "$output" =~ ^[0-9]+$ ]]; then
    preflight_error "PostgreSQL at $host:$port answered an unexpected server version: $output"
    return 1
  fi
  server_major=$((output / 10000))
  if [[ -n "$expected" && "$server_major" != "$expected" ]]; then
    preflight_error "PostgreSQL $expected is required, but the server at $host:$port runs PostgreSQL $server_major." \
      "Install PostgreSQL $expected (README.md lists the setup) and point POSTGRES_HOST/POSTGRES_PORT at it."
    return 1
  fi
}
