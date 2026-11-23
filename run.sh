#!/bin/bash
# Unified development script - runs both backend and frontend
set -e

# Get absolute path to script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load environment variables from the worktree's .env file.
#
# A linked worktree receives its own protected local configuration. A WSL
# session can retain application variables from a previous project or
# worktree, so this launcher clears every backend configuration name before
# loading the local file. This also lets the backend's documented defaults take
# effect for values absent from .env. Set LGA_RUN_USE_PROCESS_ENV=1 only for an
# intentional one-off process override.
# Supports quoted values and preserves special characters.
use_process_environment="${LGA_RUN_USE_PROCESS_ENV:-0}"
backend_configuration_variables=(
    POSTGRES_DB
    POSTGRES_USER
    POSTGRES_PASSWORD
    POSTGRES_HOST
    POSTGRES_PORT
    DEBUG
    LOG_LEVEL
    CORS_ORIGINS
    ENVIRONMENT
    JWT_SECRET_KEY
    JWT_ALGORITHM
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES
    JWT_REFRESH_TOKEN_EXPIRE_DAYS
    AUTH_LOCKOUT_MAX_ATTEMPTS
    AUTH_LOCKOUT_MINUTES
    AUTH_CAPTCHA_AFTER_FAILURES
    TURNSTILE_SECRET_KEY
    TURNSTILE_SITEVERIFY_URL
    SMTP_HOST
    SMTP_PORT
    SMTP_USERNAME
    SMTP_PASSWORD
    SMTP_FROM_EMAIL
    SMTP_USE_TLS
    SMTP_USE_SSL
)

if [ "$use_process_environment" != "1" ]; then
    for configuration_variable in "${backend_configuration_variables[@]}"; do
        unset "$configuration_variable"
    done
fi

if [ -f "$SCRIPT_DIR/.env" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
        # Trim leading whitespace
        line="${line#"${line%%[![:space:]]*}"}"

        # Skip blank lines and comments
        if [ -z "$line" ] || [[ "$line" == \#* ]]; then
            continue
        fi

        key="${line%%=*}"
        value="${line#*=}"

        # Trim key trailing whitespace and value leading whitespace
        key="${key%"${key##*[![:space:]]}"}"
        value="${value#"${value%%[![:space:]]*}"}"

        # Strip optional surrounding quotes
        if [[ "$value" == \"*\" && "$value" == *\" ]]; then
            value="${value:1:${#value}-2}"
        elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
            value="${value:1:${#value}-2}"
        fi

        if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
            if [ "$use_process_environment" = "1" ] && [ -n "${!key+x}" ]; then
                continue
            fi
            export "$key=$value"
        fi
    done < "$SCRIPT_DIR/.env"
fi

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_help() {
    echo -e "${BLUE}=============================================${NC}"
    echo -e "${BLUE}📊 League Analysis - Development Environment${NC}"
    echo -e "${BLUE}=============================================${NC}"
    echo ""
    echo -e "${GREEN}Usage:${NC}"
    echo -e "  ${YELLOW}./run.sh${NC}                    Start with default ports"
    echo -e "  ${YELLOW}./run.sh 3001${NC}               Start frontend on port 3001"
    echo -e "  ${YELLOW}./run.sh 3001 8001${NC}          Start frontend on 3001 and backend on 8001"
    echo -e "  ${YELLOW}./run.sh --help${NC}             Show this help"
    echo ""
    echo -e "${GREEN}Arguments:${NC}"
    echo -e "  ${BLUE}frontend-port${NC}  Optional. Defaults to ${GREEN}3000${NC}."
    echo -e "  ${BLUE}backend-port${NC}   Optional. Defaults to ${GREEN}8000${NC}."
    echo ""
    echo -e "${GREEN}Examples:${NC}"
    echo -e "  ${YELLOW}./run.sh${NC}"
    echo -e "  ${YELLOW}./run.sh 3001 8001${NC}"
}

validate_port() {
    local name="$1"
    local port="$2"

    if ! [[ "$port" =~ ^[0-9]+$ ]] || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
        echo -e "${RED}ERROR: $name port must be a number between 1 and 65535. Got: $port${NC}"
        echo ""
        print_help
        exit 1
    fi
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    print_help
    exit 0
fi

if [ "$#" -gt 2 ]; then
    echo -e "${RED}ERROR: Too many arguments.${NC}"
    echo ""
    print_help
    exit 1
fi

FRONTEND_PORT="${1:-3000}"
BACKEND_PORT="${2:-8000}"

validate_port "Frontend" "$FRONTEND_PORT"
validate_port "Backend" "$BACKEND_PORT"

# Uvicorn stops waiting for open requests after this many seconds. Riot runs
# no longer ride on a request, so this bounds a stuck client, not a job.
BACKEND_GRACEFUL_TIMEOUT=10
# What a stopping backend gets before it is force-stopped: the graceful
# timeout, the job runtime's own bounded wait, and a margin.
BACKEND_STOP_TIMEOUT="${LGA_RUN_BACKEND_STOP_TIMEOUT:-20}"
if ! [[ "$BACKEND_STOP_TIMEOUT" =~ ^[0-9]+$ ]]; then
    echo -e "${RED}ERROR: LGA_RUN_BACKEND_STOP_TIMEOUT must be a whole number of seconds. Got: $BACKEND_STOP_TIMEOUT${NC}" >&2
    exit 1
fi
# Every process of a backend inherits two markers from its launcher: the uv
# wrapper, uvicorn's reloader and its worker. One names the checkout and port,
# for a start that replaces any earlier backend; one names this launcher.
BACKEND_MARKER="LGA_RUN_BACKEND=$SCRIPT_DIR:$BACKEND_PORT"
OWN_BACKEND_MARKER="LGA_RUN_BACKEND_LAUNCHER=$SCRIPT_DIR:$BACKEND_PORT:$$"

backend_process_pids() {
    local marker="$1"

    # A worker that closed its listener is invisible to a port lookup, so a
    # backend is found by the marker in its environment instead.
    grep -lzxF -- "$marker" /proc/[0-9]*/environ 2>/dev/null \
        | sed -E 's#^/proc/([0-9]+)/environ$#\1#' || true
}

signal_backend_processes() {
    local signal="$1"
    local pids="$2"
    local pid

    while IFS= read -r pid; do
        if [[ "$pid" =~ ^[0-9]+$ ]]; then
            kill "-$signal" "$pid" 2>/dev/null || true
        fi
    done <<< "$pids"
}

stop_backend_processes() {
    local marker="$1"
    local pids
    local remaining_pids
    local attempts=$((BACKEND_STOP_TIMEOUT * 5))

    pids="$(backend_process_pids "$marker")"
    if [ -z "$pids" ]; then
        return 0
    fi

    echo -e "${YELLOW}Stopping backend process(es): ${pids//$'\n'/ }${NC}"
    signal_backend_processes TERM "$pids"
    for ((attempt = 0; attempt < attempts; attempt++)); do
        sleep 0.2
        remaining_pids="$(backend_process_pids "$marker")"
        if [ -z "$remaining_pids" ]; then
            echo -e "${GREEN}✓ Backend stopped${NC}"
            return 0
        fi
    done

    echo -e "${YELLOW}Force-stopping backend process(es) still alive after ${BACKEND_STOP_TIMEOUT}s: ${remaining_pids//$'\n'/ }${NC}"
    signal_backend_processes KILL "$remaining_pids"
    for ((attempt = 0; attempt < 25; attempt++)); do
        sleep 0.2
        remaining_pids="$(backend_process_pids "$marker")"
        if [ -z "$remaining_pids" ]; then
            echo -e "${GREEN}✓ Backend stopped${NC}"
            return 0
        fi
    done

    echo -e "${RED}ERROR: Backend process(es) could not be stopped: ${remaining_pids//$'\n'/ }${NC}" >&2
    return 1
}

listener_pids_for_port() {
    local port="$1"

    # Some WSL lsof builds do not report listeners owned by a Next.js child
    # process even though the port is occupied. Combine its output with ss,
    # which is restricted to LISTEN sockets, before either service starts.
    {
        lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
        ss -H -ltnp "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 || true
    } | awk '{ for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/ && !seen[$i]++) print $i }'
}

stop_listeners_on_port() {
    local port="$1"
    local pids
    local pid
    local remaining_pids

    pids="$(listener_pids_for_port "$port")"
    if [ -z "$pids" ]; then
        return
    fi

    echo -e "${YELLOW}Stopping process(es) listening on port $port: ${pids//$'\n'/ }${NC}"
    while IFS= read -r pid; do
        if [ -z "$pid" ]; then
            continue
        fi
        if ! [[ "$pid" =~ ^[0-9]+$ ]]; then
            echo -e "${RED}ERROR: Listener lookup returned an invalid PID for port $port: $pid${NC}" >&2
            return 1
        fi
        if ! kill -TERM "$pid" 2>/dev/null; then
            echo -e "${RED}ERROR: Could not stop PID $pid on port $port.${NC}" >&2
            return 1
        fi
    done <<< "$pids"

    for _ in {1..25}; do
        sleep 0.2
        remaining_pids="$(listener_pids_for_port "$port")"
        if [ -z "$remaining_pids" ]; then
            echo -e "${GREEN}✓ Port $port is available${NC}"
            return
        fi
    done

    echo -e "${YELLOW}Force-stopping remaining process(es) on port $port: ${remaining_pids//$'\n'/ }${NC}"
    while IFS= read -r pid; do
        if [ -z "$pid" ]; then
            continue
        fi
        if ! [[ "$pid" =~ ^[0-9]+$ ]]; then
            echo -e "${RED}ERROR: Listener lookup returned an invalid PID for port $port: $pid${NC}" >&2
            return 1
        fi
        if ! kill -KILL "$pid" 2>/dev/null; then
            echo -e "${RED}ERROR: Could not force-stop PID $pid on port $port.${NC}" >&2
            return 1
        fi
    done <<< "$remaining_pids"

    sleep 0.2
    remaining_pids="$(listener_pids_for_port "$port")"
    if [ -n "$remaining_pids" ]; then
        echo -e "${RED}ERROR: Port $port is still in use by: ${remaining_pids//$'\n'/ }${NC}" >&2
        return 1
    fi

    echo -e "${GREEN}✓ Port $port is available${NC}"
}

# shellcheck source=tools/preflight.sh
source "$SCRIPT_DIR/tools/preflight.sh"

BACKEND_PID=""
FRONTEND_PID=""
CURRENT_STEP="checking prerequisites"
SERVICES_STOPPED=false

# Stops what this launcher started, once, whichever way it ends.
cleanup() {
    if [ "$SERVICES_STOPPED" = true ]; then
        return
    fi
    SERVICES_STOPPED=true
    if [ -z "$BACKEND_PID" ] && [ -z "$FRONTEND_PID" ]; then
        return
    fi

    echo ""
    echo -e "${YELLOW}============================================${NC}"
    echo -e "${YELLOW}⚠️  Shutting down services...${NC}"
    echo -e "${YELLOW}============================================${NC}"

    if [ -n "$BACKEND_PID" ]; then
        echo -e "${BLUE}Stopping backend (PID: $BACKEND_PID)...${NC}"
        # Only this launcher's own: a later `./run.sh` may already have
        # replaced it, and that backend is not this one's to stop.
        stop_backend_processes "$OWN_BACKEND_MARKER" || true
    fi

    if [ -n "$FRONTEND_PID" ]; then
        echo -e "${BLUE}Stopping frontend (PID: $FRONTEND_PID)...${NC}"
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi

    echo -e "${GREEN}✓ All services stopped${NC}"
}

# When errexit ends the launcher, the failing command is named, so no failure
# is silent. A failing subshell reports through the command that ran it.
report_failure() {
    local status="$1"
    local line="$2"
    local command="$3"

    if [ "$BASHPID" != "$$" ]; then
        return
    fi
    echo -e "${RED}ERROR: run.sh failed while $CURRENT_STEP, at line $line (exit $status): $command${NC}" >&2
    echo -e "${YELLOW}Logs: logs/backend.log and logs/frontend.log${NC}" >&2
}

finish() {
    local status=$?

    trap - ERR
    cleanup
    exit "$status"
}

set -E
trap 'report_failure "$?" "$LINENO" "$BASH_COMMAND"' ERR
trap finish EXIT
# Ctrl+C (SIGINT) and SIGTERM are the normal way to stop; EXIT cleans up.
trap 'exit 0' SIGINT SIGTERM

echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}📊 League Analysis - Development Environment${NC}"
echo -e "${BLUE}=============================================${NC}"
echo ""
echo -e "${GREEN}Frontend port:${NC} $FRONTEND_PORT"
echo -e "${GREEN}Backend port:${NC}  $BACKEND_PORT"
echo ""

# Everything is checked before anything is stopped or started, so a wrong
# prerequisite ends the run with its fix and leaves no process behind.
echo -e "${YELLOW}Checking prerequisites...${NC}"
preflight_commands lsof ss curl psql uv || exit 1
preflight_postgres_settings || exit 1
preflight_postgres "$POSTGRES_HOST" "$POSTGRES_PORT" "$POSTGRES_USER" "$POSTGRES_PASSWORD" "$POSTGRES_DB" || exit 1
preflight_node || exit 1
preflight_backend_environment || exit 1
echo -e "${GREEN}✓ Prerequisites OK (Node $project_node_version, PostgreSQL $POSTGRES_HOST:$POSTGRES_PORT)${NC}"
echo ""

CURRENT_STEP="stopping the previous run"
# The previous backend first, as a whole process tree: two backends on one
# database are two job runners sharing one Riot key.
stop_backend_processes "$BACKEND_MARKER"
stop_listeners_on_port "$FRONTEND_PORT"
if [ "$BACKEND_PORT" != "$FRONTEND_PORT" ]; then
    stop_listeners_on_port "$BACKEND_PORT"
fi

LOCAL_CORS_ORIGINS="http://localhost:$FRONTEND_PORT,http://127.0.0.1:$FRONTEND_PORT"
if [ -n "${CORS_ORIGINS:-}" ]; then
    RUN_CORS_ORIGINS="$CORS_ORIGINS,$LOCAL_CORS_ORIGINS"
else
    RUN_CORS_ORIGINS="$LOCAL_CORS_ORIGINS"
fi

mkdir -p "$SCRIPT_DIR/logs"

CURRENT_STEP="applying database migrations"
# Apply reviewed schema revisions before any application writer can start.
echo -e "${YELLOW}Applying database migrations...${NC}"
cd "$SCRIPT_DIR/backend"
if ! uv run python scripts/migrate.py upgrade head; then
    echo -e "${RED}ERROR: Database migration failed; backend startup was cancelled.${NC}"
    echo -e "${YELLOW}For a populated database without an Alembic marker, follow docs/database.md before retrying.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Database migrations applied${NC}"
echo ""

# Start backend
CURRENT_STEP="starting the backend"
echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}⚙️  Starting Backend (FastAPI)${NC}"
echo -e "${BLUE}=============================================${NC}"
LGA_RUN_BACKEND="$SCRIPT_DIR:$BACKEND_PORT" LGA_RUN_BACKEND_LAUNCHER="$SCRIPT_DIR:$BACKEND_PORT:$$" CORS_ORIGINS="$RUN_CORS_ORIGINS" uv run uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload --timeout-graceful-shutdown "$BACKEND_GRACEFUL_TIMEOUT" > "$SCRIPT_DIR/logs/backend.log" 2>&1 &
BACKEND_PID=$!
echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"
echo -e "${GREEN}  App: http://localhost:$BACKEND_PORT${NC}"
echo -e "${GREEN}  API Docs: http://localhost:$BACKEND_PORT/api${NC}"
echo -e "${GREEN}  Logs: logs/backend.log${NC}"
echo ""

# Wait for backend to be ready
CURRENT_STEP="waiting for the backend"
echo -e "${YELLOW}Waiting for backend to be ready...${NC}"
for i in {1..30}; do
    if curl -s "http://localhost:$BACKEND_PORT/api" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Backend is ready!${NC}"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo -e "${RED}ERROR: Backend failed to start. Check logs/backend.log${NC}"
        exit 1
    fi
    sleep 1
done
echo ""

# Check if frontend dependencies are installed
CURRENT_STEP="installing frontend dependencies"
cd "$SCRIPT_DIR/frontend"
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing frontend dependencies...${NC}"
    npm install
    echo -e "${GREEN}✓ Dependencies installed${NC}"
    echo ""
fi

# Start frontend
CURRENT_STEP="starting the frontend"
echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}⚙️  Starting Frontend (Next.js)${NC}"
echo -e "${BLUE}=============================================${NC}"
NEXT_PUBLIC_API_URL="http://localhost:$BACKEND_PORT" npm run dev -- --port "$FRONTEND_PORT" > "$SCRIPT_DIR/logs/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"

# Check if frontend is still running after a few seconds
sleep 3
if ! ps -p "$FRONTEND_PID" > /dev/null; then
    echo -e "${RED}ERROR: Frontend failed to start (process exited). Check logs/frontend.log${NC}"
    echo -e "${YELLOW}Last 10 lines of frontend log:${NC}"
    tail -n 10 "$SCRIPT_DIR/logs/frontend.log"
    exit 1
fi

echo -e "${GREEN}  App: http://localhost:$FRONTEND_PORT${NC}"
echo -e "${GREEN}  Logs: logs/frontend.log${NC}"
echo ""

echo -e "${GREEN}=============================================${NC}"
echo -e "${GREEN}🚀 Development environment is running!${NC}"
echo -e "${GREEN}=============================================${NC}"
echo ""
echo -e "${BLUE}Services:${NC}"
echo -e "  ${GREEN}Frontend:${NC} http://localhost:$FRONTEND_PORT"
echo -e "  ${GREEN}Backend:${NC}  http://localhost:$BACKEND_PORT"
echo -e "  ${GREEN}API Docs:${NC} http://localhost:$BACKEND_PORT/api"
echo -e "  ${GREEN}Database:${NC} PostgreSQL on $POSTGRES_HOST:$POSTGRES_PORT"
echo ""
echo -e "${BLUE}Logs:${NC}"
echo -e "  ${GREEN}Backend:${NC}  tail -f logs/backend.log"
echo -e "  ${GREEN}Frontend:${NC} tail -f logs/frontend.log"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Monitor both processes - if one dies, shut down the other
CURRENT_STEP="running"
while true; do
    # Check if backend is still running
    if ! ps -p $BACKEND_PID > /dev/null 2>&1; then
        echo ""
        echo -e "${RED}=============================================${NC}"
        echo -e "${RED}❌ Backend process died unexpectedly!${NC}"
        echo -e "${RED}=============================================${NC}"
        echo -e "${YELLOW}Last 20 lines of backend log:${NC}"
        tail -n 20 "$SCRIPT_DIR/logs/backend.log"
        echo ""
        echo -e "${YELLOW}Shutting down frontend...${NC}"
        exit 1
    fi

    # Check if frontend is still running
    if ! ps -p $FRONTEND_PID > /dev/null 2>&1; then
        echo ""
        echo -e "${RED}=============================================${NC}"
        echo -e "${RED}❌ Frontend process died unexpectedly!${NC}"
        echo -e "${RED}=============================================${NC}"
        echo -e "${YELLOW}Last 20 lines of frontend log:${NC}"
        tail -n 20 "$SCRIPT_DIR/logs/frontend.log"
        echo ""
        echo -e "${YELLOW}Shutting down backend...${NC}"
        exit 1
    fi

    sleep 5
done
