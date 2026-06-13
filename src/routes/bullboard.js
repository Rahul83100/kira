/**
 * BullBoard — Background Job Monitoring Dashboard
 *
 * ═══════════════════════════════════════════════════════════════
 * WHY BULL BOARD:
 * ─────────────
 * BullMQ jobs run silently in the background. When a PDF parse
 * fails or a crawl stalls, there's no visibility. BullBoard gives
 * a real-time web UI showing:
 *   • Active / Completed / Failed / Delayed / Waiting job counts
 *   • Individual job data, logs, progress, and stack traces
 *   • One-click retry of failed jobs
 *   • Ability to clean completed/failed queues
 *
 * SECURITY:
 * ─────────
 * The dashboard is protected via ADMIN_SECRET_KEY from .env.
 * Access: GET /admin/queues?key=<ADMIN_SECRET_KEY>
 * Without the key → 401 Unauthorized.
 *
 * ARCHITECTURE:
 * ─────────────
 *   Browser → GET /admin/queues?key=xxx
 *          → adminAuth middleware (checks key)
 *          → ExpressAdapter serves the Bull Board SPA
 *          → SPA makes API calls to /admin/queues/api/*
 *          → BullBoard reads job data from Redis via BullMQ
 * ═══════════════════════════════════════════════════════════════
 */

const { createBullBoard } = require('@bull-board/api');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');

/**
 * Create and configure the BullBoard Express adapter.
 *
 * WHY A FACTORY FUNCTION:
 * The embedding queue doesn't exist at import time — it's created
 * asynchronously in initQueue(). So we call this AFTER initQueue()
 * resolves, passing the live queue instance.
 *
 * @param {import('bullmq').Queue} embeddingQueue - The BullMQ queue to monitor
 * @returns {import('express').Router} Express router to mount at /admin/queues
 */
function createBullBoardRouter(embeddingQueue) {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [
      new BullMQAdapter(embeddingQueue, { readOnlyMode: false }),
    ],
    serverAdapter,
  });

  return serverAdapter.getRouter();
}

/**
 * Simple admin auth middleware for the BullBoard dashboard.
 *
 * WHY QUERY-PARAM AUTH (not Bearer token):
 * BullBoard serves a full SPA with embedded API calls. If we used
 * Bearer tokens, the browser would need custom fetch headers for
 * every internal request the SPA makes. Query-param auth lets the
 * browser simply navigate to /admin/queues?key=xxx and all
 * subsequent SPA requests inherit the session.
 *
 * For production, this should be replaced with session-based auth
 * or a reverse proxy with SSO.
 */
function adminQueueAuth(req, res, next) {
  // 1. Always allow static assets (CSS, JS, icons) — they don't contain sensitive data
  if (req.path.includes('/static') || req.path.includes('/favicon')) {
    return next();
  }

  const key = req.query.key || req.headers['x-admin-key'];
  const secret = process.env.ADMIN_SECRET_KEY;

  if (!secret) {
    return res.status(500).json({ error: 'ADMIN_SECRET_KEY not configured in .env' });
  }

  // 2. Initial page load MUST provide the key
  if (key === secret) {
    return next();
  }

  // 3. Unauthorized access
  res.status(401).send(`
    <div style="font-family: sans-serif; padding: 40px; text-align: center; color: #333;">
      <h1 style="color: #e53e3e;">🚫 Access Denied</h1>
      <p>Provide the admin key in the URL to view the queue dashboard:</p>
      <code>/admin/queues?key=YOUR_SECRET_KEY</code>
    </div>
  `);
}

module.exports = { createBullBoardRouter, adminQueueAuth };
