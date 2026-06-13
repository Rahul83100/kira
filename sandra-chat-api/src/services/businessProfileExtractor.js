const db = require('../db/client');
const Redis = require('ioredis');
const { GoogleGenerativeAI } = require('@google/generative-ai');

let redis = null;
try {
  if (process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => false
    });
    redis.on('error', () => { redis = null; });
  }
} catch (err) {
  redis = null;
}

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

async function extractBusinessProfile(customerId) {
  // 1. Check Redis Cache First
  const cacheKey = `profile:${customerId}`;
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      console.warn('Redis Cache Error during profile extraction:', err.message);
    }
  }

  // 2. Fetch chunks from Supabase / DB
  let chunks = [];
  try {
    const result = await db.query(
      `SELECT content FROM chunks WHERE customer_id = $1 LIMIT 50`,
      [customerId]
    );
    chunks = result.rows.map(r => r.content);
  } catch (err) {
    console.error('Failed to fetch chunks from DB:', err.message);
    throw new Error('Database error fetching chunks');
  }

  if (chunks.length === 0) {
    return null; // Cannot extract without data
  }

  const documentContext = chunks.join('\n---\n');

  // 3. Extract via Gemini
  if (!genAI) {
    throw new Error('Gemini API Key missing');
  }

  const systemInstruction = `You are a business identity extraction AI.
Read the provided documents from the educational institute and extract key data.
Return a valid JSON object with EXACTLY the following format:
{
  "subjects_taught": ["Subject 1", "Subject 2"],
  "city": "City Name (or null if not found)",
  "target_age_group": "Age group or grades (or null if not found)",
  "selling_points": ["Point 1", "Point 2", "Point 3"]
}
Do not include markdown blocks like \`\`\`json. Return raw JSON.`;

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      systemInstruction
    });

    const response = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: documentContext }] }]
    });

    const responseText = response.response.text().replace(/^```json/g, '').replace(/```$/g, '').trim();
    const profile = JSON.parse(responseText);

    // 4. Cache to Redis for 24 hours
    if (redis) {
      try {
        await redis.setex(cacheKey, 86400, JSON.stringify(profile)); // 24 hours
      } catch (err) {
        console.warn('Redis save error:', err.message);
      }
    }

    return profile;
  } catch (err) {
    console.error('Failed to extract business profile with Gemini:', err.message);
    throw new Error('LLM JSON Extraction failed');
  }
}

module.exports = { extractBusinessProfile };
