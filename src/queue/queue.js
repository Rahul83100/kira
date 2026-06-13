const { Queue } = require('bullmq');
const IORedis = require('ioredis');
require('dotenv').config();

// ── Shared Redis connection config ─────────────────────────
// External Redis from .env; fallback to localhost only if .env is missing.
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const isExternalTLS = REDIS_URL && REDIS_URL.startsWith('rediss://');

let redisAvailable = false;
let embeddingQueue = null;
let _sharedRedisClient = null; // Singleton for health checks & cache

/**
 * Build common IORedis options for the external Upstash/Redis URL.
 */
function buildIORedisOpts(overrides = {}) {
  return {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    connectTimeout: 10_000,
    family: 4, // Force IPv4 to avoid Happy Eyeballs / AggregateError [ECONNREFUSED] on localhost
    lazyConnect: true,
    ...(isExternalTLS ? { tls: {} } : {}),
    retryStrategy(times) {
      return Math.min(times * 2000, 30_000);
    },
    ...overrides,
  };
}

/**
 * Create a **new** IORedis connection.
 * BullMQ requires separate connections for Queue and Worker.
 */
function createRedisConnection() {
  const conn = new IORedis(REDIS_URL, buildIORedisOpts());

  conn.on('connect', () => {
    if (!redisAvailable) {
      redisAvailable = true;
      console.log('📮 Redis connected successfully');
    }
  });

  conn.on('error', (err) => {
    // Silently suppress repeated connection-level errors.
    // console.warn('[Redis Link Error]:', err.message);
  });

  // Manually trigger connection since we use lazyConnect: true
  conn.connect().catch(() => {});

  return conn;
}

/**
 * Get (or lazily create) a shared IORedis client.
 */
function getRedisClient() {
  if (_sharedRedisClient) return _sharedRedisClient;

  _sharedRedisClient = new IORedis(REDIS_URL, buildIORedisOpts({
    enableReadyCheck: true,
    lazyConnect: true,
  }));

  _sharedRedisClient.on('connect', () => {
    redisAvailable = true;
  });

  _sharedRedisClient.on('error', () => {
    // Suppress
  });

  _sharedRedisClient.on('close', () => {
    redisAvailable = false;
  });

  _sharedRedisClient.connect().catch(() => {});

  return _sharedRedisClient;
}

/**
 * Initialise the BullMQ embedding queue.
 */
async function initQueue() {
  console.log('📡 Attempting to connect to Redis:', REDIS_URL.replace(/\/\/.*@/, '//<credentials>@'));

  const testConn = new IORedis(REDIS_URL, buildIORedisOpts({
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    connectTimeout: 15_000, // Allow more time for TLS handshake on free-tier
    retryStrategy(times) {
      if (times >= 4) return null; // Try up to 4 times during startup
      return 2000;
    },
  }));

  let lastError = null;
  testConn.on('error', (err) => { lastError = err; }); // Capture but don't reject — let retry work

  let connected = false;

  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      testConn.on('ready', () => { if (!settled) { settled = true; resolve(); } });
      // Only reject when all retries are exhausted (emits 'end'), not on individual errors
      testConn.on('end',   () => { if (!settled) { settled = true; reject(lastError || new Error('Connection closed before ready')); } });
      setTimeout(() => { if (!settled) { settled = true; reject(new Error('Connection timed out (30 s)')); } }, 30_000);
    });
    connected = true;
    console.log('✅ Redis connection verified');
  } catch (err) {
    console.warn(`\n⚠  Redis unavailable: ${err.message}`);
    console.warn('   Queue-dependent features (crawl, PDF upload) will return 503');
    console.warn('   Background reconnect will retry every 15 s\n');
  } finally {
    testConn.disconnect();
  }

  // Create the BullMQ queue regardless
  embeddingQueue = new Queue('embedding', {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 500 },
      removeOnFail:     { count: 200 },
    },
  });

  embeddingQueue.on('error', (err) => {
    // BullMQ emits errors here if the underlying Redis connection fails.
    // Suppress them from crashing the Node process.
  });

  redisAvailable = connected;
  console.log(`📮 BullMQ embedding queue initialised (redis ${connected ? 'UP' : 'DOWN — degraded mode'})`);

  getRedisClient();

  if (!connected) {
    _startReconnectLoop();
  }

  return embeddingQueue;
}

function _startReconnectLoop() {
  const interval = setInterval(async () => {
    if (redisAvailable) {
      clearInterval(interval);
      return;
    }

    try {
      const probe = new IORedis(REDIS_URL, buildIORedisOpts({
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        connectTimeout: 5000,
        retryStrategy() { return null; },
      }));

      await new Promise((resolve, reject) => {
        probe.on('ready', resolve);
        probe.on('error', reject);
        setTimeout(() => reject(new Error('timeout')), 5000);
      });

      probe.disconnect();
      redisAvailable = true;
      console.log('📮 Redis recovered — queue features restored');
      clearInterval(interval);
    } catch {
      // Still down
    }
  }, 15_000);

  if (interval.unref) interval.unref();
}

module.exports = {
  get embeddingQueue() { return embeddingQueue; },
  initQueue,
  createRedisConnection,
  getRedisClient,
  isRedisAvailable: () => redisAvailable,
  getRedisConnectionConfig: () => ({ url: REDIS_URL }),
  getRedisUrl: () => REDIS_URL,
};
