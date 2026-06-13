/**
 * Standardized Health Router — Chat API
 *
 * Deep-checks:
 *   • PostgreSQL — SELECT 1 on the Chat API's own pg pool
 *   • Redis      — PING on a shared IORedis client (Upstash from .env)
 *
 * Response shape matches the standardized format used across all services.
 */

const express = require('express');
const router = express.Router();

// ── Lazy-loaded singleton Redis client for health checks ───

let _redisClient = null;

function getRedisClient() {
  if (_redisClient) return _redisClient;

  const IORedis = require('ioredis');
  const REDIS_URL = process.env.REDIS_URL;

  if (!REDIS_URL) return null;

  const isTLS = REDIS_URL.startsWith('rediss://');

  _redisClient = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    connectTimeout: 5000,
    family: 0,
    lazyConnect: true,
    ...(isTLS ? { tls: {} } : {}),
    retryStrategy(times) {
      return Math.min(times * 2000, 30000);
    },
  });

  _redisClient.on('error', () => {
    // Suppress — health endpoint calls .ping() explicitly
  });

  _redisClient.connect().catch(() => {});

  return _redisClient;
}

// ── Dependency check: Database ─────────────────────────────

async function checkDatabase() {
  const start = Date.now();
  try {
    const db = require('../db/client');
    if (!db.pool) throw new Error('Pool not initialised');
    await db.pool.query('SELECT 1');
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - start, error: err.message };
  }
}

// ── Dependency check: Redis ────────────────────────────────

async function checkRedis() {
  const start = Date.now();
  try {
    const client = getRedisClient();
    if (!client) {
      return { status: 'down', latencyMs: 0, error: 'REDIS_URL not configured' };
    }
    await client.ping();
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - start, error: err.message };
  }
}

// ── Health endpoint ────────────────────────────────────────

router.get('/', async (_req, res) => {
  const [database, redis] = await Promise.all([
    checkDatabase(),
    checkRedis(),
  ]);

  const checks = { database, redis };

  const allUp = database.status === 'up' && redis.status === 'up';
  const allDown = database.status === 'down' && redis.status === 'down';

  let status;
  if (allUp) status = 'healthy';
  else if (allDown) status = 'unhealthy';
  else status = 'degraded';

  const httpCode = status === 'unhealthy' ? 503 : 200;

  res.status(httpCode).json({
    status,
    service: 'sandra-chat-api',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    checks,
  });
});

module.exports = router;
