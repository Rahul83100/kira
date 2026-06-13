#!/bin/bash
# Install dependencies for every Kira service (root + chat API + dashboard).
# Prefer `docker compose up` for a zero-setup run — this script is for the
# native (non-Docker) development workflow.
set -e

echo "📦 Installing dependencies for all Kira services..."

echo "→ Root (Ingestion API + worker)..."
npm install

echo "→ Chat API..."
cd sandra-chat-api && npm install && cd ..

echo "→ Dashboard..."
cd dashboard && npm install && cd ..

echo "✅ All dependencies installed!"
