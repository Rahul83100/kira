/**
 * ═══════════════════════════════════════════════════════════════
 * SupportGenie — Redis Token Bucket Rate Limiter
 * ═══════════════════════════════════════════════════════════════
 *
 * WHY TOKEN BUCKET (vs the old express-rate-limit)?
 *
 *   express-rate-limit uses a FIXED WINDOW in memory:
 *     - State is lost when the server restarts
 *     - If you have 2+ server instances, each has its own counter
 *       (so a user gets 2x the actual limit)
 *     - Fixed windows cause "thundering herd" at window boundaries
 *
 *   Token Bucket (this file) solves all three:
 *     - State is stored in REDIS, shared across all instances
 *     - Survives server restarts
 *     - Allows short bursts (up to bucket capacity) while enforcing
 *       a sustained rate — much friendlier for legitimate users
 *
 * HOW TOKEN BUCKET WORKS (ELI5):
 *
 *   Imagine a bucket that holds 100 coins. Every request costs 1 coin.
 *   The bucket auto-refills at 20 coins/minute. If a user sends
 *   requests slowly, the bucket stays full. If they burst 100 requests
 *   at once, the bucket drains — then they have to wait for refills.
 *   Once at 0 coins, every request is rejected (HTTP 429).
 *
 * REDIS KEY STRUCTURE:
 *   rl:{identifier}  →  Hash { tokens: Number, lastRefill: Timestamp }
 *
 * ATOMICITY:
 *   The check-and-decrement is done in a Lua script executed on the
 *   Redis server. Lua scripts are atomic in Redis — no race conditions
 *   even with thousands of concurrent requests.
 */

const Redis = require('ioredis');

// ── Lazy Redis connection ────────────────────────────────────
// We don't connect immediately — the first request triggers it.
// This prevents startup crashes if Redis is temporarily down.
let redis = null;

function getRedis() {
  if (redis) return redis;

  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[RateLimiter] ⚠️  REDIS_URL not set — rate limiting disabled');
    return null;
  }

  redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy(times) {
      if (times > 3) return null; // Give up after 3 retries
      return Math.min(times * 200, 1000);
    },
  });

  redis.on('error', (err) => {
    console.error('[RateLimiter] Redis error:', err.message);
  });

  redis.connect().catch(() => {
    console.warn('[RateLimiter] ⚠️  Redis connection failed — falling back to no-limit mode');
    redis = null;
  });

  return redis;
}

/**
 * Lua script for atomic token bucket operation.
 *
 * WHY LUA INSTEAD OF MULTI/EXEC?
 *   MULTI/EXEC in Redis is atomic but you can't use the result of one
 *   command inside another. With Lua, we can read the current bucket
 *   state, calculate refill, and decrement — all in one atomic step.
 *
 * ARGS:
 *   KEYS[1] = bucket key (e.g., "rl:192.168.1.1")
 *   ARGV[1] = bucket capacity (max tokens)
 *   ARGV[2] = refill rate (tokens per second)
 *   ARGV[3] = current timestamp (seconds)
 *   ARGV[4] = TTL for the key (seconds)
 *
 * RETURNS:
 *   {allowed: 0|1, remaining: N, retryAfter: seconds}
 */
const TOKEN_BUCKET_SCRIPT = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refillRate = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])
  local ttl = tonumber(ARGV[4])

  -- Get current bucket state
  local tokens = tonumber(redis.call('hget', key, 'tokens'))
  local lastRefill = tonumber(redis.call('hget', key, 'lastRefill'))

  -- First request: initialize the bucket at full capacity
  if tokens == nil then
    tokens = capacity
    lastRefill = now
  end

  -- Calculate how many tokens to add since last refill
  -- Example: 10 seconds elapsed × 3.33 tokens/sec = 33.3 new tokens
  local elapsed = math.max(0, now - lastRefill)
  local newTokens = elapsed * refillRate
  tokens = math.min(capacity, tokens + newTokens)
  lastRefill = now

  -- Try to consume 1 token
  local allowed = 0
  local retryAfter = 0

  if tokens >= 1 then
    tokens = tokens - 1
    allowed = 1
  else
    -- Calculate when the next token will be available
    retryAfter = math.ceil((1 - tokens) / refillRate)
  end

  -- Save updated state
  redis.call('hset', key, 'tokens', tokens, 'lastRefill', lastRefill)
  redis.call('expire', key, ttl)

  return {allowed, math.floor(tokens), retryAfter}
`;

/**
 * Create a Redis Token Bucket rate limiter middleware.
 *
 * @param {Object} options
 * @param {number} options.capacity    - Max tokens in the bucket (burst size). Default: 100
 * @param {number} options.refillRate  - Tokens added per second. Default: 3.33 (≈200/min)
 * @param {number} options.ttl         - Redis key TTL in seconds. Default: 600 (10 min)
 * @param {string} options.prefix      - Redis key prefix. Default: 'rl'
 * @param {Function} options.keyGenerator - Function(req) → string identifier. Default: IP address
 *
 * @example
 *   // Allow 100 burst, refill 20 per minute (0.33/sec)
 *   app.use('/api/', createRateLimiter({ capacity: 100, refillRate: 0.33 }));
 *
 *   // Stricter limit for chat endpoint
 *   app.use('/api/chat', createRateLimiter({ capacity: 30, refillRate: 0.5 }));
 */
function createRateLimiter(options = {}) {
  const {
    capacity = 100,
    refillRate = 3.33,       // ~200 per minute
    ttl = 600,               // 10 minute key expiry
    prefix = 'rl',
    keyGenerator = (req) => req.ip || req.connection?.remoteAddress || 'unknown',
  } = options;

  return async (req, res, next) => {
    const client = getRedis();

    // If Redis is down, allow the request (graceful degradation)
    // Better to let a few extra requests through than block everyone
    if (!client) return next();

    const identifier = keyGenerator(req);
    const key = `${prefix}:${identifier}`;
    const now = Math.floor(Date.now() / 1000);

    try {
      const result = await client.eval(
        TOKEN_BUCKET_SCRIPT,
        1,          // number of KEYS
        key,        // KEYS[1]
        capacity,   // ARGV[1]
        refillRate, // ARGV[2]
        now,        // ARGV[3]
        ttl         // ARGV[4]
      );

      const [allowed, remaining, retryAfter] = result;

      // Always set rate limit headers (helps clients self-throttle)
      res.set('X-RateLimit-Limit', String(capacity));
      res.set('X-RateLimit-Remaining', String(remaining));

      if (allowed) {
        return next();
      }

      // Bucket is empty — reject
      res.set('Retry-After', String(retryAfter));
      res.set('X-RateLimit-Reset', String(now + retryAfter));

      return res.status(429).json({
        error: 'Too many requests. Please slow down.',
        retryAfter,
        limit: capacity,
        remaining: 0,
      });
    } catch (err) {
      // Redis error — don't block the request
      console.error('[RateLimiter] Eval error:', err.message);
      return next();
    }
  };
}

module.exports = { createRateLimiter };
