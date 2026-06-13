/**
 * End-User Rate Limiter (Redis-backed)
 * SEPARATE from rateLimiter.js (which tracks customer-level monthly credits)
 * This tracks END-USER level abuse prevention.
 *
 * Tier 1 — Burst:  5 messages per 60 seconds per sessionId
 * Tier 2 — Daily:  Plan-based per-session daily limit (resets at midnight UTC)
 *
 * Redis Keys:
 *   burst:{sessionId}                           TTL 60s
 *   daily:{customerToken}:{sessionId}:{date}    TTL 86400s
 *   daily:{customerToken}:{ip}:{date}           TTL 86400s (IP backup)
 */

// Reuse the singleton Redis client from cacheService — no extra connections
let redis = null;
try {
  ({ redis } = require('./cacheService'));
} catch (e) {
  console.warn('⚠️ endUserRateLimiter: Redis unavailable, rate limiting disabled.');
}

const DAILY_LIMITS = {
  free_trial: 10,
  base: 15,
  growth: 25,
  pro: 50
};

const BURST_LIMIT = 30;
const BURST_TTL  = 60;      // seconds
const DAILY_TTL  = 86400;   // seconds

/**
 * Tier 1: Burst check — 5 messages per 60 seconds per IP
 * @param {string} ipAddress - End-user IP address
 * @returns {{ allowed: boolean, retryAfterMs: number }}
 */
async function checkBurstLimit(ipAddress) {
  if (!redis) return { allowed: true, retryAfterMs: 0 };

  const key = `burst:${ipAddress}`;
  try {
    const [[err, count]] = await redis.multi()
      .incr(key)
      .expire(key, BURST_TTL)
      .exec();

    if (err) throw err;

    if (count <= BURST_LIMIT) {
      return { allowed: true, retryAfterMs: 0 };
    }

    // Get remaining TTL so the client knows when to retry
    const ttl = await redis.ttl(key);
    const retryAfterMs = ttl > 0 ? ttl * 1000 : BURST_TTL * 1000;
    return { allowed: false, retryAfterMs };

  } catch (err) {
    console.warn(`⚠️ Burst check Redis error: ${err.message}`);
    return { allowed: true, retryAfterMs: 0 }; // Fail open — don't block users if Redis is down
  }
}

/**
 * Tier 2: Daily limit — plan-based per IP
 * @param {string} customerToken   - Customer's API token (unique per tenant)
 * @param {string} sessionId       - (Ignored) End-user session ID
 * @param {string} ipAddress       - End-user IP address
 * @param {number} planDailyLimit  - The numeric daily limit for this plan
 * @returns {{ allowed: boolean, used: number, limit: number, resets_at: string }}
 */
async function checkDailyLimit(customerToken, sessionId, ipAddress, planDailyLimit) {
  if (!redis) return { allowed: true, used: 0, limit: planDailyLimit, resets_at: new Date().toISOString() };

  const today     = new Date().toISOString().slice(0, 10); // "2026-04-19"
  const dailyKey  = `daily:${customerToken}:${ipAddress}:${today}`;

  const resets_at = new Date();
  resets_at.setUTCHours(24, 0, 0, 0); // Next midnight UTC

  try {
    const [[err, used]] = await redis.multi()
      .incr(dailyKey)
      .expire(dailyKey, DAILY_TTL)
      .exec();

    if (err) throw err;

    const exceeded = used > planDailyLimit;

    return {
      allowed: !exceeded,
      used,
      limit: planDailyLimit,
      resets_at: resets_at.toISOString()
    };
  } catch (err) {
    console.warn(`⚠️ Daily limit Redis error: ${err.message}`);
    return { allowed: true, used: 0, limit: planDailyLimit, resets_at: new Date().toISOString() }; // Fail open — don't block users if Redis is down
  }
}

module.exports = { checkBurstLimit, checkDailyLimit, DAILY_LIMITS };
