#!/bin/bash
# Unified development script - runs both backend and frontend
set -e

# Get absolute path to script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load environment variables from .env file
if [ -f "$SCRIPT_DIR/.env" ]; then
    export $(grep -v '^#' "$SCRIPT_DIR/.env" | grep -v '^$' | xargs)
fi

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > "$SCRIPT_DIR/logs/backend.log" 2>&1 &
BACKEND_PID=$!
echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"
echo -e "${GREEN}  App: http://localhost:8000${NC}"
echo -e "${GREEN}  API Docs: http://localhost:8000/api${NC}"
echo -e "${GREEN}  Logs: logs/backend.log${NC}"
echo ""

# Wait for backend to be ready
echo -e "${YELLOW}Waiting for backend to be ready...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:8000/api > /dev/null 2>&1; then
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
npm run dev > "$SCRIPT_DIR/logs/frontend.log" 2>&1 &
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

echo -e "${GREEN}  App: http://localhost:3000${NC}"
echo -e "${GREEN}  Logs: logs/frontend.log${NC}"
echo ""

echo -e "${GREEN}=============================================${NC}"
echo -e "${GREEN}🚀 Development environment is running!${NC}"
echo -e "${GREEN}=============================================${NC}"
echo ""
echo -e "${BLUE}Services:${NC}"
echo -e "  ${GREEN}Frontend:${NC} http://localhost:3000"
echo -e "  ${GREEN}Backend:${NC}  http://localhost:8000"
echo -e "  ${GREEN}API Docs:${NC} http://localhost:8000/api"
echo -e "  ${GREEN}Database:${NC} PostgreSQL on localhost:5432"
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
