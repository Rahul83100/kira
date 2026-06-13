/**
 * SupportGenie — Embedding Service (Google GenAI + Semantic Cache)
 *
 * ═══════════════════════════════════════════════════════════════
 * WHY THIS DESIGN:
 * ─────────────────
 * 1. Google GenAI's `text-embedding-004` is used because:
 *    - `gemini-embedding-001` produces high-quality embeddings (up to 3072-dim,
 *      truncated to 768 via outputDimensionality for DB compatibility)
 *    - Free tier is generous (1500 req/min), far more than OpenAI
 *    - The task specification explicitly requires Google GenAI
 *
 * 2. SHA-256 semantic caching via Redis because:
 *    - Embedding API calls are EXPENSIVE (latency + tokens)
 *    - Many chunks are IDENTICAL across re-crawls (websites don't
 *      change every paragraph daily)
 *    - SHA-256 is deterministic: same text → same hash → cache hit
 *    - SHA-256 is collision-resistant: different texts won't clash
 *    - Redis is already required by BullMQ — zero new infrastructure
 *    - A 7-day TTL auto-cleans orphaned entries without complex
 *      reference counting across documents
 *
 * 3. Why NOT use an in-memory Map?
 *    - Maps die on process restart
 *    - Maps aren't shared across worker instances
 *    - Redis survives restarts and is shared by all processes
 *
 * CACHE KEY FORMAT:  emb:cache:<sha256_hex>
 * CACHE VALUE:       JSON-stringified float array
 * CACHE TTL:         7 days (604800 seconds)
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const crypto = require('crypto');

// ── Embedding dimensions (gemini-embedding-001, truncated to 768 for DB compat) ──
const EMBEDDING_DIM = 768;

// ── Cache TTL: 7 days in seconds ────────────────────────────
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 604800

// ── Redis client (lazy-loaded, shared across calls) ─────────
let _redis = null;
let isGeminiServiceDisabled = false;

/**
 * Check if the Gemini API is known to be disabled (e.g. 403 returned)
 */
function isGeminiDisabled() {
  return isGeminiServiceDisabled;
}

/**
 * Get or create the shared Redis client for caching.
 *
 * WHY LAZY LOADING:
 * The embedder is imported by many modules (worker, routes, retrieval).
 * We don't want to create a Redis connection at import time because
 * the queue module might not have initialized yet (it might start an
 * embedded Redis). Lazy init ensures we connect only on first use.
 */
/**
 * Get or create the shared Redis client for caching.
 *
 * WHY CENTRALIZED CONFIG:
 * We use getRedisConnectionConfig() from the queue module to ensure that
 * the embedder (cache) and the queue always use the same Redis instance.
 */
function getRedisClient() {
  if (_redis) return _redis;

  try {
    const IORedis = require('ioredis');
    const { getRedisConnectionConfig } = require('../queue/queue');
    const config = getRedisConnectionConfig();

    // Forced External Only mode — always connect via URL
    _redis = new IORedis(config.url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
      // For Upstash/External Redis, handle rediss:// (TLS) automatically via URL
      tls: config.url.startsWith('rediss://') ? {} : undefined,
    });

    _redis.on('error', (err) => {
      // Suppress noisy connection errors — cache is best-effort
      // console.warn('Cache Redis Error:', err.message);
    });

    _redis.connect().catch(() => { });

    return _redis;
  } catch (err) {
    // If Redis is unavailable, caching is disabled gracefully
    return null;
  }
}


// ── Retry configuration ────────────────────────────────────────
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1s → 2s → 4s exponential backoff

/**
 * Determine whether an error is transient and worth retrying.
 * Retries on: network errors, timeouts, rate-limits (429), server errors (5xx).
 */
function isRetryableError(err) {
  // If we are over quota or spending cap, retrying will NOT help and only adds latency.
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('spending cap') || msg.includes('quota')) {
    return false;
  }

  // Network / timeout errors
  if (err.code && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(err.code)) {
    return true;
  }
  // HTTP status-based errors (OpenAI SDK wraps these with a `status` property)
  const status = err.status || err.statusCode || (err.response && err.response.status);
  if (status === 429 || (status >= 500 && status < 600)) {
    return true;
  }
  // Timeout string in message
  if (err.message && /timeout|timed?\s*out/i.test(err.message)) {
    return true;
  }
  return false;
}

/**
 * Sleep helper for exponential backoff.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Hash text to a deterministic SHA-256 hex string.
 *
 * WHY SHA-256:
 * - Deterministic: same input always produces the same hash
 * - Collision-resistant: 2^256 possible outputs means virtually
 *   zero chance of two different texts producing the same hash
 * - Fast: ~400MB/s on modern CPUs — negligible vs API latency
 * - Standard: built into Node.js crypto module, no dependencies
 *
 * We do NOT use MD5 because it's cryptographically broken (collisions
 * have been found), even though for caching the risk is low.
 */
function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Try to retrieve a cached embedding from Redis.
 * Returns null on miss or if Redis is unavailable.
 */
async function getCachedEmbedding(hash) {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const cached = await redis.get(`emb:cache:v2:${hash}`);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {
    // Cache miss or Redis error — fall through to API call
  }
  return null;
}

/**
 * Store an embedding in the Redis cache with 7-day TTL.
 *
 * WHY JSON.stringify:
 * Redis stores strings. We could use a binary format (Buffer.from
 * Float64Array) which would be ~40% smaller, but JSON is:
 * - Human-debuggable (you can `redis-cli GET` and read it)
 * - Simpler code (no custom serialization)
 * - Fast enough (JSON.parse of a 768-element array is ~0.1ms)
 *
 * At scale, if memory becomes a concern, switch to MessagePack.
 */
async function setCachedEmbedding(hash, embedding) {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.set(
      `emb:cache:v2:${hash}`,
      JSON.stringify(embedding),
      'EX',
      CACHE_TTL_SECONDS
    );
  } catch {
    // Best-effort caching — don't fail the request if cache write fails
  }
}

/**
 * Generate a 768-dimensional embedding vector for the given text.
 *
 * FLOW:
 *   1. Hash the text with SHA-256
 *   2. Check Redis cache — if hit, return immediately (FREE!)
 *   3. If miss, call Google GenAI embedding API
 *   4. Store result in Redis cache for future lookups
 *   5. If Google GenAI fails, fall back to mock embeddings
 *
 * @param {string} text - The text to embed
 * @returns {Promise<number[]>} 768-dimensional float array
 */
async function generateEmbedding(text) {
  const hash = hashText(text);

  // ── Step 1: Check cache ──────────────────────────────────
  const cached = await getCachedEmbedding(hash);
  if (cached) {
    return cached; // Cache HIT — no API call needed!
  }

  // ── Step 2: Call Google GenAI ─────────────────────────────
  if (process.env.GEMINI_API_KEY && !isGeminiServiceDisabled) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { GoogleGenAI } = require('@google/genai');
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        const result = await ai.models.embedContent({
          model: 'gemini-embedding-001',
          contents: text,
          config: { outputDimensionality: EMBEDDING_DIM },
        });
        const embedding = result.embeddings[0].values;

        // ── Step 3: Cache the result ───────────────────────────
        await setCachedEmbedding(hash, embedding);

        return embedding;
      } catch (err) {
        lastError = err;

        const status = err.status || err.statusCode || (err.response && err.response.status);
        if (status === 403) {
          console.error('🛑 Gemini API is DISABLED (403). Switching to fallback mode permanently.');
          isGeminiServiceDisabled = true;
          throw new Error('API_KEY_DISABLED'); // Throw immediately to trigger keyword fallback
        }

        if (isRetryableError(err) && attempt < MAX_RETRIES) {
          const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(
            `⚠  Google GenAI embedding attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}. ` +
            `Retrying in ${delayMs}ms...`
          );
          await sleep(delayMs);
        } else if (!isRetryableError(err)) {
          // Non-retryable error — fall back to mock immediately
          console.error('Google GenAI embedding error (non-retryable), falling back to mock:', err.message);
          break;
        }
      }
    }

    // All retries exhausted or non-retryable error
    console.warn('⚠  Google GenAI embedding failed, using mock embeddings');
  }

  // ── Step 4: Mock embeddings for local dev ─────────────────
  console.warn('⚠  Using mock embeddings — set GEMINI_API_KEY for real vectors');
  const mock = mockEmbedding(text);

  // Cache even mock embeddings — they're deterministic, and caching
  // prevents the warning from spamming logs on re-runs
  await setCachedEmbedding(hash, mock);

  return mock;
}

/**
 * Invalidate all cached embeddings for chunks belonging to a document.
 *
 * WHY THIS EXISTS:
 * When a user deletes a document, we want to be a good citizen and
 * clean up the cache entries for that document's chunks. However,
 * since embeddings are keyed by TEXT HASH (not document ID), we need
 * to hash each chunk's text and delete the corresponding cache key.
 *
 * This is called from the DELETE /api/documents/:id route.
 *
 * NOTE: If another document has the exact same chunk text, the cache
 * entry will be deleted but will be re-created on the next access.
 * This is acceptable — it causes at most one extra API call.
 *
 * @param {string[]} chunkTexts - Array of chunk content strings
 */
async function invalidateEmbeddingCache(chunkTexts) {
  const redis = getRedisClient();
  if (!redis || !chunkTexts || chunkTexts.length === 0) return;

  try {
    const pipeline = redis.pipeline();
    for (const text of chunkTexts) {
      const hash = hashText(text);
      pipeline.del(`emb:cache:${hash}`);
    }
    await pipeline.exec();
  } catch {
    // Best-effort — deletion failure doesn't affect correctness
    // The TTL will clean up eventually anyway
  }
}

/**
 * Deterministic mock embedding based on text hash.
 * NOT suitable for production — only for local testing without API keys.
 *
 * WHY MULBERRY32 PRNG:
 * We need deterministic pseudo-random numbers seeded by the text.
 * Mulberry32 is simple, fast, and produces good distribution.
 * The seed is derived from a simple hash of the text characters.
 */
function mockEmbedding(text) {
  let seed = 0;
  for (let i = 0; i < text.length; i++) {
    seed = ((seed << 5) - seed + text.charCodeAt(i)) | 0;
  }

  const vec = new Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    vec[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1;
  }
  return vec;
}

module.exports = {
  generateEmbedding,
  invalidateEmbeddingCache,
  isGeminiDisabled,
  EMBEDDING_DIM,
  // Exposed for testing
  hashText,
};
