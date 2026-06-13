/**
 * SupportGenie — Production Logger (Winston + DailyRotateFile)
 * ═══════════════════════════════════════════════════════════════
 * WHY WINSTON:
 * ────────────
 * console.log() has critical limitations for production:
 *   • No log levels (can't filter errors from debug info)
 *   • No structured output (plain strings aren't queryable)
 *   • No persistence (logs vanish when terminal closes)
 *   • No rotation (unchecked, logs fill the disk)
 *
 * Winston solves all of these with:
 *   • Log levels: error, warn, info, http, debug
 *   • JSON format: structured, machine-parseable output
 *   • Transports: console + daily-rotated files
 *   • Metadata: request IDs, timestamps, service names
 *
 * WHY DAILY ROTATE FILE:
 * ──────────────────────
 * DailyRotateFile creates a new log file every 24 hours:
 *   logs/app-2026-04-06.log, logs/app-2026-04-07.log, ...
 *
 * Automatically deletes files older than 14 days and compresses
 * old logs to .gz to save disk space. This prevents unbounded
 * growth without manual intervention.
 *
 * LOG FORMAT:
 * ───────────
 * {
 *   "timestamp": "2026-04-06T12:30:00.000Z",
 *   "level": "info",
 *   "message": "POST /api/documents/upload-pdf",
 *   "requestId": "abc-123-def",
 *   "method": "POST",
 *   "url": "/api/documents/upload-pdf",
 *   "statusCode": 202,
 *   "responseTime": "142ms",
 *   "contentLength": "256",
 *   "ip": "127.0.0.1",
 *   "userAgent": "Mozilla/5.0..."
 * }
 * ═══════════════════════════════════════════════════════════════
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const crypto = require('crypto');

// ── Log directory ──────────────────────────────────────────
const LOG_DIR = path.join(__dirname, '..', '..', 'logs');

// ── Custom format: combine timestamp + JSON ────────────────
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// ── Console format: colorized + readable for dev ───────────
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, requestId, method, url, statusCode, responseTime, ...rest }) => {
    // Build a concise one-liner for console
    const id = requestId ? ` [${requestId.slice(0, 8)}]` : '';
    const req = method ? ` ${method} ${url}` : '';
    const status = statusCode ? ` → ${statusCode}` : '';
    const time = responseTime ? ` (${responseTime})` : '';
    return `${timestamp} ${level}:${id}${req}${status}${time} ${message}`;
  })
);

// ── Create the Winston logger ──────────────────────────────

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'http',
  format: logFormat,
  defaultMeta: { service: 'supportgenie-ingestion' },
  transports: [
    // ── Daily Rotate: ALL logs (info and above) ────────────
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',          // Rotate if file exceeds 20 MB
      maxFiles: '14d',         // Keep logs for 14 days
      zippedArchive: true,     // Compress old logs to .gz
      level: 'http',           // Capture http-level and above
    }),

    // ── Daily Rotate: ERROR logs only (separate file) ──────
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',         // Keep error logs for 30 days
      zippedArchive: true,
      level: 'error',
    }),

    // ── Console: readable output for development ───────────
    new winston.transports.Console({
      format: consoleFormat,
      level: process.env.LOG_LEVEL || 'http',
    }),
  ],

  // Don't crash the app on logging failures
  exitOnError: false,
});

// ── HTTP Request Logging Middleware ────────────────────────

/**
 * Express middleware that logs every HTTP request/response.
 *
 * HOW IT WORKS:
 * ─────────────
 * 1. On REQUEST: generates a unique requestId (UUID v4), attaches
 *    it to the request object, records the start time.
 *
 * 2. On RESPONSE FINISH: calculates execution time, extracts
 *    status code, content length, and logs a structured JSON entry.
 *
 * 3. Payload summaries: logs body size (not the full body — that
 *    would leak PII and bloat log files). For file uploads, logs
 *    the filename and size instead.
 *
 * WHY requestId:
 * Each request gets a unique ID so you can correlate log entries
 * across middleware, route handlers, and error handlers. This is
 * essential for debugging in a multi-service architecture — you
 * can grep a single request's journey across all services.
 *
 * WHY res.on('finish'):
 * Express doesn't have a built-in "after response" hook. The
 * 'finish' event on the response object fires after the last byte
 * is written to the OS socket buffer. This gives us the accurate
 * status code and response time.
 */
function requestLogger(req, res, next) {
  // Generate unique request ID
  const requestId = crypto.randomUUID();
  req.requestId = requestId;

  // Also set it as a response header (useful for client-side debugging)
  res.setHeader('X-Request-Id', requestId);

  const startTime = process.hrtime.bigint();

  // Build payload summary (never log full bodies — PII risk)
  let payloadSummary = {};
  if (req.file) {
    // Multer file upload
    payloadSummary = {
      type: 'file',
      filename: req.file.originalname,
      size: `${(req.file.size / 1024).toFixed(1)}KB`,
      mimetype: req.file.mimetype,
    };
  } else if (req.body && Object.keys(req.body).length > 0) {
    // JSON body — log keys and sizes, not values
    payloadSummary = {
      type: 'json',
      keys: Object.keys(req.body),
      bodySize: `${JSON.stringify(req.body).length}B`,
    };
  }

  // Log AFTER the response is sent
  res.on('finish', () => {
    const elapsed = Number(process.hrtime.bigint() - startTime) / 1e6; // ms
    const responseTime = `${elapsed.toFixed(1)}ms`;

    // Determine log level based on status code
    let level = 'http';
    if (res.statusCode >= 500) level = 'error';
    else if (res.statusCode >= 400) level = 'warn';

    const logEntry = {
      requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTime,
      contentLength: res.get('content-length') || '0',
      ip: req.ip || req.headers['x-forwarded-for'] || 'unknown',
      userAgent: req.get('user-agent') || 'unknown',
    };

    // Only add payload summary if non-empty
    if (Object.keys(payloadSummary).length > 0) {
      logEntry.payload = payloadSummary;
    }

    logger.log(level, `${req.method} ${req.originalUrl}`, logEntry);
  });

  next();
}

module.exports = { logger, requestLogger };
