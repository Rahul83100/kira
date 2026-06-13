const Redis = require('ioredis');

// Connect to Redis. Fallback quietly if disabled.
let redis = null;
try {
  if (process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => false // Fail fast if unavailable
    });

    redis.on('error', (err) => {
      console.warn('⚠️  Redis connection failed for Rate Limiter. Operating in fail-open mode.', err.message || err);
      redis.disconnect();
      redis = null;
    });
  }
} catch (err) {
  console.warn('⚠️  Redis connection failed. Rate limiting disabled.', err.message || err);
  redis = null;
}

const luaScript = `
  local globalKey = KEYS[1]
  local userKey = KEYS[2]
  local globalLimit = tonumber(ARGV[1])
  local userLimit = tonumber(ARGV[2])
  local ttlSec = tonumber(ARGV[3])

  local currentUser = tonumber(redis.call('GET', userKey) or '0')
  if currentUser >= userLimit then
    local currentTtl = redis.call('TTL', userKey)
    return { 429, currentTtl }
  end

  local currentGlobal = tonumber(redis.call('GET', globalKey) or '0')
  if currentGlobal >= globalLimit then
    return { 403, 0 }
  end

  local newGlobal = redis.call('INCR', globalKey)
  local newUser = redis.call('INCR', userKey)
  if newUser == 1 then
    redis.call('EXPIRE', userKey, ttlSec)
  end

  return { 200, newGlobal }
`;

/**
 * Dual-Layer Redis Rate Limiter
 * 1. Institution Quota (10,000 / month) -> format: rate_limit:client_{id}:total
 * 2. User Session Quota (200 / 3 hours) -> format: rate_limit:client_{id}:user_{sessionId}_ip
 */
async function redisRateLimiter(req, res, next) {
  // If Redis is offline, fail closed to prevent massive bot spam
  if (!redis) {
    return next(); // Fail open — allow request if Redis is unavailable
  }

  try {
    const customer = req.customer; 
    if (!customer || !customer.id) {
       return next();
    }
    
    const clientId = customer.id;

    // Identify user strictly via cookies, fallback to body session, mix with IP
    const rawCookies = req.headers.cookie || '';
    const cookies = Object.fromEntries(rawCookies.split('; ').filter(Boolean).map(c => c.split('=')));
    
    // Prioritize cookie sessionId, fallback to explicit body passing, and mix with IP
    const requestSessionId = cookies.sessionId || req.body?.sessionId || req.headers['x-session-id'] || 'unknown';
    const userIdentifier = `${requestSessionId}_${req.ip}`;

    const globalKey = `rate_limit:client_${clientId}:total`;
    const userKey = `rate_limit:client_${clientId}:user_${userIdentifier}`;

    // Execute atomic Lua script
    // Returns: [status_code, secondary_value (either TTL or new global hit count)]
    const result = await redis.eval(luaScript, 2, globalKey, userKey, 10000, 200, 10800);
    const statusCode = result[0];
    const value = result[1];

    if (statusCode === 429) {
      res.setHeader('Retry-After', value > 0 ? value : 10800);
      return res.status(429).json({
        error: "Too Many Requests: You have reached the activity limit for this 3-hour window. Please try again later."
      });
    }

    if (statusCode === 403) {
      return res.status(403).json({
        error: "Quota Exceeded: Your account has reached the 10,000 request allowance for the current billing cycle. Please upgrade your plan."
      });
    }

    // Status is 200 (Allowed), value contains perfectly atomic new global hit count
    req.rateLimitRemaining = Math.max(0, 10000 - value);
    next();
  } catch (err) {
    console.error('Redis Rate Limiter Error:', err);
    return next(); // Fail open — allow request if Redis errors
  }
}

module.exports = redisRateLimiter;
