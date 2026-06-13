// historyService.js
const Redis = require('ioredis');
const { callGemini } = require('./geminiService');

// ── Redis Connection ──────────────────────────────────────────
let redis = null;
try {
  if (process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => false
    });

    redis.on('error', (err) => {
      console.warn('⚠️ Redis history failed. Falling back to local.', err.message);
      redis.disconnect();
      redis = null;
    });
  }
} catch (err) {
  console.warn('⚠️ Redis init failed:', err.message);
  redis = null;
}

// Fallback for local testing/dev if Redis is down
const inMemoryHistory = new Map();
const summarizingSessions = new Set();

/**
 * Fetch history from Redis (List) or Memory (Fallback)
 */
async function getHistory(sessionId) {
  if (redis) {
    try {
      const data = await redis.lrange(`chat:history:${sessionId}`, 0, -1);
      return data.map(item => JSON.parse(item));
    } catch (err) {
      console.error('Redis getHistory failed:', err.message);
    }
  }
  return inMemoryHistory.get(sessionId) || [];
}

/**
 * Append message to history and manage window size
 */
async function appendToHistory(sessionId, role, content) {
  const message = { role, content, timestamp: Date.now() };

  if (redis) {
    try {
      const key = `chat:history:${sessionId}`;
      await redis.rpush(key, JSON.stringify(message));
      await redis.expire(key, 86400); // 24 Hour TTL
      
      const len = await redis.llen(key);
      if (len > 20 && !summarizingSessions.has(sessionId)) {
        summarizeHistory(sessionId).catch(console.error);
      }
      
      const updated = await redis.lrange(key, 0, -1);
      return updated.map(item => JSON.parse(item));
    } catch (err) {
      console.error('Redis appendToHistory failed:', err.message);
    }
  }

  // Fallback Logic
  const history = inMemoryHistory.get(sessionId) || [];
  history.push(message);
  inMemoryHistory.set(sessionId, history);

  if (history.length > 20 && !summarizingSessions.has(sessionId)) {
    summarizeHistory(sessionId).catch(console.error);
  }

  return history;
}

/**
 * Background async function to summarize earlier conversation messages.
 */
async function summarizeHistory(sessionId) {
  summarizingSessions.add(sessionId);
  try {
    const history = await getHistory(sessionId);
    if (history.length <= 20) return;

    // Isolate oldest 10 messages for summary
    const oldestTen = history.slice(0, 10);
    const conversationText = oldestTen.map(msg => `${msg.role}: ${msg.content}`).join('\n');

    const summaryPrompt = "You are a lead generation assistant for a business support chatbot. Summarize the following earlier part of this customer conversation briefly to maintain context.";
    const summaryResult = await callGemini(
      summaryPrompt,
      [],
      `Please summarize the key topics, visitor interests, and current stage of this customer conversation from this chat history:\n\n${conversationText}`
    );

    const summaryBlock = {
      role: 'user',
      content: `[CONTEXT: Earlier summary]\n${summaryResult}\n\n[Continuing...]`,
      timestamp: Date.now()
    };

    if (redis) {
      const key = `chat:history:${sessionId}`;
      // Remove first 10, then prepend the summary
      // Note: Redis LTRIM doesn't allow replacing elements easily, so we atomize the update
      const current = await redis.lrange(key, 10, -1);
      await redis.del(key);
      await redis.rpush(key, JSON.stringify(summaryBlock), ...current);
      await redis.expire(key, 86400);
    } else {
      const current = inMemoryHistory.get(sessionId);
      if (current && current.length >= 20) {
        current.splice(0, 10, summaryBlock);
        inMemoryHistory.set(sessionId, current);
      }
    }
  } catch (err) {
    console.error('Background summarization failed:', err);
  } finally {
    summarizingSessions.delete(sessionId);
  }
}

module.exports = { getHistory, appendToHistory };
