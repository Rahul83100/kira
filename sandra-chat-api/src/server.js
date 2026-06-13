// Prevent unhandled promise rejections from crashing the server
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection (server stayed alive):', reason?.message || reason);
});

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { router: chatRouter } = require('./routes/chat');
const { getActiveManifest, reloadManifest, publishManifestToFirebase } = require('./services/promptManager');
const clientRouter = require('./routes/client');

const app = express();
const PORT = process.env.CHAT_PORT || (process.env.NODE_ENV === 'production' ? process.env.PORT : null) || 3001;

// ── Security headers ─────────────────────────────────────
app.use(helmet());

// CORS origin whitelist
// In production, ALLOWED_ORIGINS env var is required (comma-separated)
// In development, falls back to common localhost ports
const isProduction = process.env.NODE_ENV === 'production';
const defaultOrigins = isProduction
  ? []
  : [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:5500',
      'http://127.0.0.1:5500',
      'http://127.0.0.1:8080',
      'http://localhost:3500',
    ];
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : defaultOrigins;

if (isProduction && allowedOrigins.length === 0) {
  console.error('[STARTUP] ALLOWED_ORIGINS env var is required in production');
  process.exit(1);
}

// Request logger (development only — disabled in production for performance & privacy)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`📡 [DEBUG] ${req.method} ${req.url}`);
    console.log(`   - Origin: ${req.get('Origin') || 'No Origin'}`);
    next();
  });
}

app.use(cors({
  origin: function (origin, callback) {
    // 📡 [SECURITY] Allow null origins for local file testing (file://).
    if (origin === 'null' || !origin) return callback(null, true);

    // 1. Check direct matches
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // 2. Check wildcard patterns (e.g., *.yourdomain.com)
    const isWildcardMatch = allowedOrigins.some(target => {
      if (target.startsWith('*.')) {
        const domain = target.slice(2); // remove '*.'
        const originHost = new URL(origin).hostname;
        return originHost === domain || originHost.endsWith('.' + domain);
      }
      return false;
    });

    if (isWildcardMatch) {
      return callback(null, true);
    }

    callback(new Error('Blocked by Kira CORS Policy'));
  },
  credentials: true
}));
const rateLimit = require('express-rate-limit');

// ── Rate Limiting (CyberSecurity) ───────────────────────────
// Blocks spam clicking / bot attacks from draining our Gemini tokens
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 200, // Limit each IP to 200 requests per `window` (per minute)
  message: { error: 'Too many requests processed. Security limit reached. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.json({ limit: '6mb' }));
// Apply the global rate limiter
app.use(apiLimiter);

// Health check (deep — DB + Redis)
const healthRouter = require('./routes/health');
app.use('/health', healthRouter);

// Routes are registered at the bottom of the file


// Root Status
app.get('/', (req, res) => res.json({
  name: 'Kira Chat API',
  status: 'Ready',
  port: PORT,
  health: '/health'
}));

// ──────────────────────────────────────────────────────────────
// Admin Prompt Management Endpoints
// Protected by ADMIN_SECRET_KEY header
// ──────────────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.adminKey;
  if (key !== process.env.ADMIN_SECRET_KEY) {
    return res.status(403).json({ error: 'Forbidden — invalid admin key' });
  }
  next();
}

// GET /api/prompts/status — view current manifest state
app.get('/api/prompts/status', adminAuth, (req, res) => {
  res.json(getActiveManifest());
});

// POST /api/prompts/reload — force reload from Firebase (or local fallback)
app.post('/api/prompts/reload', adminAuth, async (req, res) => {
  try {
    const result = await reloadManifest();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Reload failed', details: err.message });
  }
});

// POST /api/prompts/publish — push local manifest to Firebase Remote Config
app.post('/api/prompts/publish', adminAuth, async (req, res) => {
  try {
    const success = await publishManifestToFirebase();
    res.json({ success, message: success ? 'Manifest published to Firebase' : 'Publish failed' });
  } catch (err) {
    res.status(500).json({ error: 'Publish failed', details: err.message });
  }
});

// Final Route Registration (Consolidated)
app.use('/api/chat', chatRouter);
app.use('/api/client', clientRouter);

// Start server
const server = app.listen(PORT, () => {
  console.log(`🤖 Kira Chat API running on http://localhost:${PORT}`);
});

// ── Global error handler (hide stack traces in production) ──
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    ...(isProduction ? {} : { details: err.message }),
  });
});

// ── Graceful shutdown ────────────────────────────────────
const shutdown = (signal) => {
  console.log(`${signal} received — shutting down gracefully`);
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
