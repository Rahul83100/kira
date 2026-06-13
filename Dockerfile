# ══════════════════════════════════════════════════════════════════════════════
# Kira — All-in-one application image
# ══════════════════════════════════════════════════════════════════════════════
# Builds the React dashboard and bundles all three Node services (Ingestion API,
# Embedding Worker, Chat API) into a single image. docker-compose runs the image
# three times with different commands. The Ingestion API also serves the compiled
# dashboard + widget, so the whole product is reachable on one origin (:3000).
#
# Debian (bookworm-slim) is used instead of Alpine because the crawler relies on
# a system Chromium, which is far better supported on Debian.
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: install dependencies + build the dashboard ───────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Skip Puppeteer's bundled Chromium download — we use the system one at runtime.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Root service deps (Ingestion API + worker)
COPY package.json package-lock.json ./
RUN npm ci

# Chat API deps
COPY sandra-chat-api/package*.json ./sandra-chat-api/
RUN cd sandra-chat-api && npm install

# Dashboard deps
COPY dashboard/package*.json ./dashboard/
RUN cd dashboard && npm install

# Copy the rest of the source and build the dashboard SPA into dashboard/dist
COPY . .
RUN cd dashboard && npm run build

# ── Stage 2: lean runtime with a system Chromium for the crawler ──────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# System Chromium + the fonts/libs it needs to render pages headlessly
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      wget \
    && rm -rf /var/lib/apt/lists/*

# Bring over installed deps + built app from the build stage
COPY --from=build /app /app

EXPOSE 3000 3001

# Default command runs the Ingestion API (overridden per-service in compose).
CMD ["node", "src/index.js"]
