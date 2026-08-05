#!/bin/bash
# Unified development script - runs both backend and frontend
set -e

# Get absolute path to script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load environment variables from .env file
# Supports quoted values and preserves special characters.
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

        # Explicit process environment values take precedence over .env.
        if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && [ -z "${!key+x}" ]; then
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

listener_pids_for_port() {
    local port="$1"

    # Some WSL lsof builds do not report listeners owned by a Next.js child
    # process even though the port is occupied. Combine its output with fuser
    # so the selected port is reliably clear before either service starts.
    {
        lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
        fuser -n tcp "$port" 2>/dev/null || true
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
            echo -e "${RED}ERROR: lsof returned an invalid PID for port $port: $pid${NC}" >&2
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
            echo -e "${RED}ERROR: lsof returned an invalid PID for port $port: $pid${NC}" >&2
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

if ! command -v lsof >/dev/null 2>&1; then
    echo -e "${RED}ERROR: lsof is required to stop processes on the selected ports.${NC}" >&2
    echo -e "${YELLOW}Install lsof, then run this command again.${NC}" >&2
    exit 1
fi

if ! command -v fuser >/dev/null 2>&1; then
    echo -e "${RED}ERROR: fuser is required to stop processes on the selected ports.${NC}" >&2
    echo -e "${YELLOW}Install the procps package, then run this command again.${NC}" >&2
    exit 1
fi

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

# Function to cleanup background processes on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}============================================${NC}"
    echo -e "${YELLOW}⚠️  Shutting down services...${NC}"
    echo -e "${YELLOW}============================================${NC}"

    if [ ! -z "$BACKEND_PID" ]; then
        echo -e "${BLUE}Stopping backend (PID: $BACKEND_PID)...${NC}"
        kill $BACKEND_PID 2>/dev/null || true
    fi

    if [ ! -z "$FRONTEND_PID" ]; then
        echo -e "${BLUE}Stopping frontend (PID: $FRONTEND_PID)...${NC}"
        kill $FRONTEND_PID 2>/dev/null || true
    fi

    echo -e "${GREEN}✓ All services stopped${NC}"
    exit 0
}

# Trap SIGINT (Ctrl+C) and SIGTERM
trap cleanup SIGINT SIGTERM

echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}📊 League Analysis - Development Environment${NC}"
echo -e "${BLUE}=============================================${NC}"
echo ""
echo -e "${GREEN}Frontend port:${NC} $FRONTEND_PORT"
echo -e "${GREEN}Backend port:${NC}  $BACKEND_PORT"
echo ""

# Check PostgreSQL connection
echo -e "${YELLOW}Checking PostgreSQL connection...${NC}"
if ! PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\q' 2>/dev/null; then
    echo -e "${RED}ERROR: Cannot connect to PostgreSQL at $POSTGRES_HOST:$POSTGRES_PORT${NC}"
    echo -e "${RED}Make sure PostgreSQL is running on WSL${NC}"
    exit 1
fi
echo -e "${GREEN}✓ PostgreSQL connection OK${NC}"
echo ""

# Start backend
echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}⚙️  Starting Backend (FastAPI)${NC}"
echo -e "${BLUE}=============================================${NC}"
cd "$SCRIPT_DIR/backend"
CORS_ORIGINS="$RUN_CORS_ORIGINS" uv run uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload > "$SCRIPT_DIR/logs/backend.log" 2>&1 &
BACKEND_PID=$!
echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"
echo -e "${GREEN}  App: http://localhost:$BACKEND_PORT${NC}"
echo -e "${GREEN}  API Docs: http://localhost:$BACKEND_PORT/api${NC}"
echo -e "${GREEN}  Logs: logs/backend.log${NC}"
echo ""

# Wait for backend to be ready
echo -e "${YELLOW}Waiting for backend to be ready...${NC}"
for i in {1..30}; do
    if curl -s "http://localhost:$BACKEND_PORT/api" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Backend is ready!${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}ERROR: Backend failed to start. Check logs/backend.log${NC}"
        cleanup
    fi
    sleep 1
done
echo ""

# Check if frontend dependencies are installed
cd "$SCRIPT_DIR/frontend"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/scripts/use-project-node.sh"
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing frontend dependencies...${NC}"
    npm install
    echo -e "${GREEN}✓ Dependencies installed${NC}"
    echo ""
fi

# Start frontend
echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}⚙️  Starting Frontend (Next.js)${NC}"
echo -e "${BLUE}=============================================${NC}"
NEXT_PUBLIC_API_URL="http://localhost:$BACKEND_PORT" npm run dev -- --port "$FRONTEND_PORT" > "$SCRIPT_DIR/logs/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"

# Check if frontend is still running after a few seconds
sleep 3
if ! ps -p $FRONTEND_PID > /dev/null; then
    echo -e "${RED}ERROR: Frontend failed to start (process exited). Check logs/frontend.log${NC}"
    echo -e "${YELLOW}Last 10 lines of frontend log:${NC}"
    tail -n 10 "$SCRIPT_DIR/logs/frontend.log"
    cleanup
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
        cleanup
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
        cleanup
    fi

    sleep 5
done
