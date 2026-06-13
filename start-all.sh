#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Kira — Start all services for NATIVE (non-Docker) local development
# Run from the project root:  bash start-all.sh   (or: npm run start:all)
#
# Prereqs: PostgreSQL (with pgvector) + Redis reachable via the URLs in your .env.
# The quickest way to get those is:  docker compose up -d postgres redis
#
# For a zero-setup experience, prefer:  docker compose up
# ═══════════════════════════════════════════════════════════════════════════════

set -e

echo "🚀 Starting Kira — All Services"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

# Pre-cleanup: free the ports we use (only if lsof is available)
if command -v lsof >/dev/null 2>&1; then
  echo -e "${CYAN}🧹 Cleaning up old processes...${NC}"
  for port in 3000 3001 5173; do
    pid=$(lsof -t -i:$port) || true
    if [ -n "$pid" ]; then
      echo "   Stopping process on port $port (PID: $pid)..."
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
fi

# 1. Ingestion API (port 3000)
echo -e "${GREEN}[1/4]${NC} Starting Ingestion API on port 3000..."
node src/index.js &
INGESTION_PID=$!

# 2. Embedding Worker (BullMQ background processor)
echo -e "${GREEN}[2/4]${NC} Starting Embedding Worker..."
node src/workers/embeddingWorker.js &
WORKER_PID=$!

# 3. Chat API (port 3001)
echo -e "${GREEN}[3/4]${NC} Starting Chat API on port 3001..."
( cd sandra-chat-api && node src/server.js ) &
CHAT_PID=$!

# 4. Customer Dashboard (Vite, port 5173)
echo -e "${GREEN}[4/4]${NC} Starting Dashboard on port 5173..."
( cd dashboard && npx vite --port 5173 ) &
DASHBOARD_PID=$!

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${CYAN}📡 Service Map:${NC}"
echo "   Ingestion API:      http://localhost:3000"
echo "   Embedding Worker:   (background — BullMQ processor)"
echo "   Chat API:           http://localhost:3001"
echo "   Dashboard:          http://localhost:5173"
echo "   Widget bundle:      http://localhost:5173/widget.js"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Ctrl+C to stop all services."

cleanup() {
  echo ""
  echo "🛑 Stopping all services..."
  kill $INGESTION_PID $WORKER_PID $CHAT_PID $DASHBOARD_PID 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

wait
