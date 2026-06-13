/**
 * SupportGenie — Document Event Bus (Redis Pub/Sub)
 *
 * ═══════════════════════════════════════════════════════════════
 * WHY REDIS PUB/SUB:
 * ──────────────────
 * The Ingestion API (port 3000) and the Embedding Worker run as
 * SEPARATE Node.js processes (launched via start-all.ps1). In-memory
 * EventEmitter won't work across process boundaries because each
 * process has its own require() cache and memory space.
 *
 * Redis Pub/Sub solves this:
 *   Worker process  ──publish──→  Redis  ──subscribe──→  API process
 *                                                          ↓
 *                                                        SSE route
 *                                                          ↓
 *                                                       Dashboard
 *
 * Both processes already connect to the same Redis instance (via
 * REDIS_URL in .env), so this adds zero new infrastructure.
 *
 * CHANNEL:
 * ────────
 * 'document:status-changed'  →  JSON payload:
 *   { doc_id, customer_id, status, chunk_count, error_message }
 *
 * FALLBACK:
 * ─────────
 * If Redis is unavailable, emit/subscribe are silent no-ops.
 * The dashboard falls back to manual refresh (graceful degradation).
 * ═══════════════════════════════════════════════════════════════
 */

const IORedis = require('ioredis');
const { EventEmitter } = require('events');
require('dotenv').config();

const CHANNEL = 'document:status-changed';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const isExternalTLS = REDIS_URL && REDIS_URL.startsWith('rediss://');

// Local emitter for in-process listeners (SSE route subscribes here)
const localEmitter = new EventEmitter();
localEmitter.setMaxListeners(100);

// ── Redis connections ──────────────────────────────────────────
// Pub/Sub requires TWO separate connections:
// - Subscriber connection enters "subscriber mode" and can ONLY
//   run SUBSCRIBE/UNSUBSCRIBE commands
// - Publisher connection stays in normal mode for PUBLISH commands
let pubClient = null;
let subClient = null;
let redisReady = false;

function buildOpts() {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10_000,
    family: 0,
    ...(isExternalTLS ? { tls: {} } : {}),
    retryStrategy(times) {
      return Math.min(times * 2000, 30_000);
    },
  };
}

/**
 * Initialize the Pub/Sub connections.
 * Called once at startup by whichever process imports this module.
 */
function initPubSub() {
  try {
    pubClient = new IORedis(REDIS_URL, buildOpts());
    subClient = new IORedis(REDIS_URL, buildOpts());

    pubClient.on('error', () => {}); // Suppress
    subClient.on('error', () => {}); // Suppress

    subClient.on('connect', () => {
      redisReady = true;
    });

    // Subscribe to the channel
    subClient.subscribe(CHANNEL, (err) => {
      if (err) {
        console.warn('⚠ Document events: Redis subscribe failed:', err.message);
      }
    });

    // When a message arrives, forward it to local EventEmitter
    // so the SSE route (in THIS process) gets notified
    subClient.on('message', (channel, message) => {
      if (channel === CHANNEL) {
        try {
          const payload = JSON.parse(message);
          localEmitter.emit('document:status-changed', payload);
        } catch (e) {
          console.warn('⚠ Document events: Failed to parse message:', e.message);
        }
      }
    });
  } catch (err) {
    console.warn('⚠ Document events: Redis Pub/Sub init failed:', err.message);
  }
}

/**
 * Publish a document status change event.
 * Called by the embedding worker when a document finishes processing.
 */
function publishStatusChange(payload) {
  if (!pubClient || !redisReady) {
    // Fallback: emit locally (works if worker and API are same process)
    localEmitter.emit('document:status-changed', payload);
    return;
  }

  pubClient.publish(CHANNEL, JSON.stringify(payload)).catch((err) => {
    console.warn('⚠ Document events: Publish failed:', err.message);
    // Fallback to local emission
    localEmitter.emit('document:status-changed', payload);
  });
}

/**
 * Subscribe to status change events (local process only).
 * The SSE route calls this to get notified when the API process
 * receives a Pub/Sub message from the worker process.
 */
function onStatusChange(callback) {
  localEmitter.on('document:status-changed', callback);
  return () => localEmitter.removeListener('document:status-changed', callback);
}

/**
 * Cleanup connections on shutdown.
 */
function closePubSub() {
  if (pubClient) pubClient.disconnect();
  if (subClient) subClient.disconnect();
}

// Auto-init on require()
initPubSub();

module.exports = {
  publishStatusChange,
  onStatusChange,
  closePubSub,
  localEmitter, // Exposed for SSE route direct access
};
