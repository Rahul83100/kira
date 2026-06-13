// src/db/migrations_v10_outbound_apply.js
const db = require('./client');

async function applyMigration() {
  console.log('🚀 Starting Outbound DB Migration...');
  try {
    const query = `
      -- 1. Create outbound_competitors table
      CREATE TABLE IF NOT EXISTS outbound_competitors (
        id SERIAL PRIMARY KEY,
        customer_id VARCHAR(100) NOT NULL,
        competitor_name TEXT,
        reviewer_name TEXT,
        review_text TEXT,
        rating NUMERIC,
        complaint_type TEXT,
        match_score NUMERIC,
        outreach_angle TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_outbound_competitors_customer_id ON outbound_competitors(customer_id);

      -- 2. Add attribution columns to leads table to bind UTM tags
      ALTER TABLE leads 
      ADD COLUMN IF NOT EXISTS source TEXT,
      ADD COLUMN IF NOT EXISTS medium TEXT,
      ADD COLUMN IF NOT EXISTS campaign_id TEXT,
      ADD COLUMN IF NOT EXISTS outbound_lead_id INTEGER;
    `;
    await db.query(query);
    console.log('✅ Database updated successfully: outbound_competitors table created and leads table altered.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    process.exit();
  }
}

applyMigration();
