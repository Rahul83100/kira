/**
 * Standardized Health Router — Ingestion API
 *
 * Deep-checks:
 *   • PostgreSQL — SELECT 1 on the connection pool
 *   • Redis      — PING on the shared IORedis client
 *
 * Response shape:
 * {
 *   status: 'healthy' | 'degraded' | 'unhealthy',
 *   service: 'supportgenie-ingestion',
 *   timestamp: ISO string,
 *   uptime: seconds,
 *   checks: {
 *     database: { status: 'up'|'down', latencyMs },
 *     redis:    { status: 'up'|'down', latencyMs }
 *   }
 * }
 */

const express = require('express');
const router = express.Router();

// ── Dependency check: Database ─────────────────────────────

async function checkDatabase() {
  const start = Date.now();
  try {
    const db = require('../db/client');
    await db.strictQuery('SELECT 1');
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - start, error: err.message };
  }
}

// ── Dependency check: Redis ────────────────────────────────

async function checkRedis() {
  const start = Date.now();
  try {
    const { getRedisClient, isRedisAvailable } = require('../queue/queue');

    // Quick short-circuit if we know Redis is down
    if (!isRedisAvailable()) {
      return { status: 'down', latencyMs: 0, error: 'Redis not connected' };
    }

    const client = getRedisClient();
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

  // Determine overall status
  const allUp = database.status === 'up' && redis.status === 'up';
  const allDown = database.status === 'down' && redis.status === 'down';

  let status;
  if (allUp) status = 'healthy';
  else if (allDown) status = 'unhealthy';
  else status = 'degraded';

  const httpCode = status === 'unhealthy' ? 503 : 200;

  res.status(httpCode).json({
    status,
    service: 'supportgenie-ingestion',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    checks,
  });
});

module.exports = router;
