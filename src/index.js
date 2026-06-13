const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { createRateLimiter } = require('./middleware/redisRateLimiter');
const app = express();

// ── Security headers ─────────────────────────────────────
app.use(helmet());

// ── Production Logging (must be first middleware) ────────────
// Winston captures every request with: requestId, execution time,
// payload summary, status code. Logs rotate daily, kept for 14 days.
const { requestLogger } = require('./middleware/logger');
app.use(requestLogger);

// safety net for unhandled rejections/exceptions (e.g. from third-party libraries like ioredis)
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
});

// ── CORS — Production-aware origin whitelist ─────────────────
// Reads from ALLOWED_ORIGINS env var (comma-separated) in production.
// Falls back to local dev origins so the stack works out of the box.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:8080',
      'http://127.0.0.1:8080',
      'http://127.0.0.1:5500',
    ];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));


const documentRoutes = require('./routes/documents');
const paymentRoutes = require('./routes/payments');
const webhookRoutes = require('./routes/webhooks');
const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/client');
const usageRoutes = require('./routes/usage');
const onboardingRoutes = require('./routes/onboarding');
const authenticate = require('./middleware/auth');

// ── Body parsers with Webhook Raw Stream Interception ──────────
// Specifically intercept Razorpay Webhooks so we can verify the cryptographic hash exactly as sent
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    if (req.originalUrl.includes('/webhook')) {
      req.rawBody = buf.toString('utf8');
    }
  }
}));
app.use(express.urlencoded({ extended: true }));

// ── Redis Token Bucket Rate Limiter (CyberSecurity) ──────────
// WHY TOKEN BUCKET instead of express-rate-limit:
//   1. State stored in Redis → shared across all server instances
//   2. Survives server restarts (no counter reset)
//   3. Allows short bursts while enforcing sustained rate
//
// General API limit: 100 burst, ~200 requests/min sustained
const apiLimiter = createRateLimiter({
  capacity: 100,
  refillRate: 3.33,  // ~200 per minute
  prefix: 'rl:api',
});
app.use('/api/', apiLimiter);


// ── Health check (deep — DB + Redis) ─────────────────────────
const healthRouter = require('./routes/health');
app.use('/health', healthRouter);

// ── Serve the built dashboard SPA + embeddable widget (Docker / production) ──
// In single-container / self-hosted mode the ingestion API also serves the
// compiled dashboard (dashboard/dist) and the widget.js bundle, so the whole
// product runs behind ONE origin. In local dev the dashboard runs on Vite
// (:5173) instead and this block is skipped because dist/ doesn't exist yet.
const dashboardDist = path.join(__dirname, '..', 'dashboard', 'dist');
const dashboardPublic = path.join(__dirname, '..', 'dashboard', 'public');
const serveDashboard = fs.existsSync(path.join(dashboardDist, 'index.html'));

if (serveDashboard) {
  app.use(express.static(dashboardDist));
} else if (fs.existsSync(path.join(dashboardPublic, 'widget.js'))) {
  // Even without a built dashboard, expose the widget bundle for embedding.
  app.use(express.static(dashboardPublic));
}

// Root Status
app.get('/', (req, res) => {
  if (serveDashboard) return res.sendFile(path.join(dashboardDist, 'index.html'));
  res.json({
    name: 'Kira Ingestion API',
    status: 'Ready',
    port: process.env.PORT || 3000,
    health: '/health'
  });
});

// ── Mount routes ─────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/client', clientRoutes);
app.use('/api/usage', authenticate, usageRoutes);
app.use('/api/onboarding', onboardingRoutes);

// ── Static file serving for screenshots ──────────────────────
app.use('/uploads/screenshots', express.static(path.join(__dirname, '..', 'uploads', 'screenshots')));

// ── Dashboard SPA fallback — send index.html for non-API GET routes ──────────
if (serveDashboard) {
  app.get(/^\/(?!api\/|health|uploads\/|widget\.js).*/, (req, res) => {
    res.sendFile(path.join(dashboardDist, 'index.html'));
  });
}

// ── Global error handler ─────────────────────────────────────
const { logger } = require('./middleware/logger');
const isProduction = process.env.NODE_ENV === 'production';
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    requestId: _req.requestId,
  });
  res.status(500).json({
    error: 'Internal server error',
    ...(isProduction ? {} : { details: err.message }),
  });
});

// ── Start server ─────────────────────────────────────────────
const { initQueue } = require('./queue/queue');

(async () => {
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 Kira Ingestion API running on http://localhost:${PORT}`);
    logger.info(`   Health check:    http://localhost:${PORT}/health`);
    logger.info(`   Documents:       http://localhost:${PORT}/api/documents`);
    logger.info(`   Queue Dashboard: http://localhost:${PORT}/admin/queues?key=<ADMIN_SECRET_KEY>`);
    logger.info(`   Logs directory:  ./logs/`);
  });

  // Initialise BullMQ queue (graceful degradation if Redis is down)
  const embeddingQueue = await initQueue();

  // ── BullBoard — Job Monitoring Dashboard ─────────────────
  // Mount AFTER initQueue so the queue instance exists.
  // Protected by ADMIN_SECRET_KEY: /admin/queues?key=<secret>
  if (embeddingQueue) {
    const { createBullBoardRouter, adminQueueAuth } = require('./routes/bullboard');
    app.use('/admin/queues', adminQueueAuth, createBullBoardRouter(embeddingQueue));
    logger.info('📊 BullBoard dashboard mounted at /admin/queues');
  }

  // ── Graceful shutdown ──────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})();

module.exports = app;
