const db = require('../db/client');
const { generateEmbedding, isGeminiDisabled } = require('./embedder');
const { logDocumentRetrieved } = require('./auditLogger');

/**
 * Retrieve the most relevant text chunks for a given query from a customer's
 * knowledge base. Runs both vector search and keyword search in parallel,
 * then merges results — vector first, keyword appended — to ensure the LLM
 * always gets the best available context, even when embeddings are low-quality.
 */
async function retrieveRelevantChunks(customerId, query, topK = 5) {
  const vectorChunks = [];
  const keywordChunks = [];

  // ── 1. Vector Search ──────────────────────────────────────────
  if (process.env.GEMINI_API_KEY && !isGeminiDisabled()) {
    try {
      const queryEmbedding = await generateEmbedding(query);
      const vectorString = '[' + queryEmbedding.join(',') + ']';

      const result = await db.query(
        `SELECT content FROM chunks
         WHERE customer_id = $1
         ORDER BY embedding <=> $2::vector
         LIMIT $3`,
        [customerId, vectorString, topK]
      );

      if (result.rows && result.rows.length > 0) {
        vectorChunks.push(...result.rows.map((r) => r.content));
        console.log(`🔍 [RETRIEVAL] Vector search found ${result.rows.length} chunks for customer ${customerId}.`);
        result.rows.forEach((r, i) => {
          const preview = r.content.replace(/\s+/g, ' ').trim().substring(0, 120);
          console.log(`   VEC #${i + 1}: ${preview}...`);
        });
      } else {
        console.log(`🔍 [RETRIEVAL] Vector search found 0 chunks for customer ${customerId}.`);
      }
    } catch (err) {
      console.error('Vector search failed:', err.message);
      if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED') || err.message.includes('timeout')) {
        return [];
      }
    }
  } else {
    console.log('📡 [RETRIEVAL] Gemini unavailable — skipping vector search.');
  }

  // ── 2. Keyword Search (always runs alongside vector) ──────────
  try {
    const STOP_WORDS = new Set([
      'what', 'when', 'where', 'which', 'who', 'whom', 'why', 'how',
      'this', 'that', 'these', 'those', 'the', 'and', 'for', 'are',
      'with', 'from', 'your', 'have', 'been', 'does', 'about', 'into',
      'than', 'then', 'just', 'like', 'over', 'also', 'very', 'much',
      'some', 'each', 'every', 'their', 'there', 'would', 'could', 'should',
      'is', 'was', 'has', 'had', 'its', 'not', 'but', 'can', 'did', 'get',
      'put', 'say', 'see', 'use', 'may', 'now', 'any', 'all', 'our'
    ]);

    // Clean query: strip punctuation, collapse whitespace, split
    const rawTerms = query
      .replace(/[!?.,;:'"()\[\]{}]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(w => w.length > 0);

    // Filter: only meaningful words, skip stop words, min 3 chars
    const searchTerms = rawTerms.filter(w => w.length >= 3 && !STOP_WORDS.has(w.toLowerCase()));

    if (searchTerms.length > 0) {
      // Build CASE expression to score each chunk by match count
      const scoreExpr = searchTerms
        .map((_, i) => `CASE WHEN content ILIKE $${i + 2} THEN 1 ELSE 0 END`)
        .join(' + ');

      const ilikeClauses = searchTerms.map((_, i) => `content ILIKE $${i + 2}`).join(' OR ');
      const params = [customerId, ...searchTerms.map(t => `%${t}%`)];

      const result = await db.query(
        `SELECT content, (${scoreExpr}) AS match_score
         FROM chunks
         WHERE customer_id = $1 AND (${ilikeClauses})
         ORDER BY match_score DESC
         LIMIT $${params.length + 1}`,
        [...params, topK * 2]  // fetch more candidates, merge will trim to topK
      );

      if (result.rows && result.rows.length > 0) {
        keywordChunks.push(...result.rows.map((r) => r.content));
        console.log(`🔍 [RETRIEVAL] Keyword search found ${result.rows.length} chunks for customer ${customerId}. Query terms: [${searchTerms.join(', ')}]`);
        // Debug: log snippet of each matched chunk
        result.rows.forEach((r, i) => {
          const preview = r.content.replace(/\s+/g, ' ').trim().substring(0, 120);
          console.log(`   KW #${i + 1} (score=${r.match_score}): ${preview}...`);
        });
      } else {
        console.log(`🔍 [RETRIEVAL] Keyword search found 0 chunks for customer ${customerId}. Query terms: [${searchTerms.join(', ')}]`);
      }
    }
  } catch (err) {
    console.error('Keyword search failed:', err.message);
  }

  // ── 3. Merge & Deduplicate ────────────────────────────────────
  const seen = new Set();
  const merged = [];

  for (const chunk of [...vectorChunks, ...keywordChunks]) {
    const key = chunk.trim().substring(0, 120);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(chunk);
    }
  }

  console.log(`🔍 [RETRIEVAL] Merged total: ${merged.length} chunks (${vectorChunks.length} vector + ${keywordChunks.length} keyword).`);

  return merged.slice(0, topK);
}

module.exports = { retrieveRelevantChunks };
