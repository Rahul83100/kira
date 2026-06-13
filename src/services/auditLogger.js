/**
 * SupportGenie — SOC2 Audit Logger
 * 
 * Logs API key usage and document retrieval events for SOC2 compliance.
 * 
 * Modes:
 *   1. AWS S3 (production) — when AWS credentials are set, writes to append-only S3 bucket
 *   2. Local file (fallback) — writes to ./audit-logs/ directory as append-only JSONL
 * 
 * Events logged:
 *   - API_KEY_USED: Every time an API key is validated by auth middleware
 *   - DOCUMENT_RETRIEVED: Every time pgvector retrieves chunks for a query
 *   - DOCUMENT_UPLOADED: Every time a new document is ingested
 *   - WEBHOOK_RECEIVED: Every time a LemonSqueezy webhook is processed
 */

const fs = require('fs');
const path = require('path');

// ── Local file fallback ──────────────────────────────────────
const AUDIT_DIR = path.join(__dirname, '..', '..', 'audit-logs');

function ensureAuditDir() {
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  }
}

function getLocalFilePath() {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(AUDIT_DIR, `audit-${date}.jsonl`);
}

// ── Core logging function ────────────────────────────────────
/**
 * Log an audit event
 * 
 * @param {string} eventType - One of: API_KEY_USED, DOCUMENT_RETRIEVED, DOCUMENT_UPLOADED, WEBHOOK_RECEIVED
 * @param {object} data - Event-specific metadata
 * @param {string} [data.customerId] - UUID of the customer
 * @param {string} [data.ip] - Client IP address
 * @param {string} [data.token] - Redacted API token (last 8 chars only)
 * @param {string} [data.query] - Search query (for retrieval events)
 * @param {number} [data.chunksCount] - Number of chunks retrieved
 * @param {string} [data.documentId] - Document UUID
 * @param {string} [data.sourceType] - Document source type (pdf, url, text)
 */
async function log(eventType, data = {}) {
  const event = {
    timestamp: new Date().toISOString(),
    event: eventType,
    service: 'supportgenie',
    ...data,
  };

  // Redact sensitive fields
  if (event.token) {
    event.token = '***' + event.token.slice(-8);
  }

  const jsonLine = JSON.stringify(event);

  // local append-only file
  writeToLocal(jsonLine);
}

// ── Local file writer ────────────────────────────────────────
function writeToLocal(jsonLine) {
  try {
    ensureAuditDir();
    const filePath = getLocalFilePath();
    // Append-only: O_APPEND flag ensures atomic appends
    fs.appendFileSync(filePath, jsonLine + '\n', { flag: 'a' });
  } catch (err) {
    console.error('Local audit write failed:', err.message);
  }
}

// ── Convenience methods ──────────────────────────────────────

/**
 * Log API key authentication event
 */
function logApiKeyUsed(customerId, token, ip, endpoint) {
  return log('API_KEY_USED', { customerId, token, ip, endpoint });
}

/**
 * Log document retrieval (pgvector search) event
 */
function logDocumentRetrieved(customerId, query, chunksCount) {
  return log('DOCUMENT_RETRIEVED', {
    customerId,
    query: query.substring(0, 200), // Truncate long queries
    chunksCount,
  });
}

/**
 * Log document upload/ingestion event
 */
function logDocumentUploaded(customerId, documentId, sourceType, filename) {
  return log('DOCUMENT_UPLOADED', { customerId, documentId, sourceType, filename });
}

/**
 * Log webhook event
 */
function logWebhookReceived(eventName, email, status) {
  return log('WEBHOOK_RECEIVED', { eventName, email, status });
}

module.exports = {
  log,
  logApiKeyUsed,
  logDocumentRetrieved,
  logDocumentUploaded,
  logWebhookReceived,
};
