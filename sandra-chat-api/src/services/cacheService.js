// cacheService.js
const Redis = require('ioredis');
const crypto = require('crypto');

let redis = null;

try {
  if (process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => false
    });

    redis.on('error', (err) => {
      console.warn('⚠️  Redis connection failed. Caching disabled.', err.message || err);
      redis.disconnect();
      redis = null;
    });
  }
} catch (err) {
  console.warn('⚠️  Redis connection failed. Caching disabled.', err.message || err);
  redis = null;
}

function getCacheKey(customerId, message) {
  const hash = crypto.createHash('md5').update(message.toLowerCase().trim()).digest('hex');
  return `cache:v3:${customerId}:${hash}`;
}

async function getCache(customerId, message) {
  if (!redis) return null;
  try {
    const val = await redis.get(getCacheKey(customerId, message));
    return val ? JSON.parse(val) : null;
  } catch (err) {
    console.warn('Redis cache read error:', err.message || err);
    return null;
  }
}

async function setCache(customerId, message, response) {
  if (!redis) return;
  try {
    await redis.setex(getCacheKey(customerId, message), 3600, JSON.stringify(response));
  } catch (err) {
    console.warn('Redis cache save error:', err.message || err);
  }
}

module.exports = { getCache, setCache };
