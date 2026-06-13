const db = require('./client');

async function applyMigration() {
  console.log('?? Starting Rahul\'s Security & Monitoring Migration...');
  try {
    const query = `
      -- 1. Detailed AI Logging Table
      CREATE TABLE IF NOT EXISTS api_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL REFERENCES customers(id),
        session_id TEXT NOT NULL,
        model TEXT NOT NULL,
        request_text TEXT,
        response_text TEXT,
        status TEXT DEFAULT 'success',
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- 2. Audit Trail for Rate Limiting
      ALTER TABLE query_usage 
      ADD COLUMN IF NOT EXISTS last_request_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

      CREATE INDEX IF NOT EXISTS idx_api_logs_customer ON api_logs(customer_id);
      CREATE INDEX IF NOT EXISTS idx_api_logs_session ON api_logs(session_id);
    `;
    await db.query(query);
    console.log('? Database updated successfully: Added api_logs table and monitoring indices.');
  } catch (err) {
    console.error('? Migration failed:', err.message);
  } finally {
    process.exit();
  }
}

applyMigration();
