const db = require('../db/client');

/**
 * Detailed API Logging Service
 * Records every LLM interaction for cost monitoring and debugging.
 */
async function logApiRequest({ customerId, sessionId, model, requestText, responseText, status = 'success', tokens = {} }) {
  try {
    const query = `
      INSERT INTO api_logs (
        customer_id, session_id, model, request_text, response_text, status, prompt_tokens, completion_tokens
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    
    const params = [
      customerId,
      sessionId,
      model,
      requestText,
      responseText,
      status,
      tokens.prompt || 0,
      tokens.completion || 0
    ];

    await db.query(query, params);
  } catch (err) {
    console.warn(`?? loggingService: Failed to save log (${err.message})`);
  }
}

module.exports = { logApiRequest };
