// src/db/migrations_v9_branding_apply.js
const db = require('./client');

async function applyMigration() {
  console.log('🚀 Starting Branding & Slug Migration...');
  try {
    const query = `
      -- 1. Add branding columns to customers table
      ALTER TABLE customers 
      ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE,
      ADD COLUMN IF NOT EXISTS agent_name TEXT,
      ADD COLUMN IF NOT EXISTS brand_color TEXT DEFAULT '#00ffd5',
      ADD COLUMN IF NOT EXISTS accent_color TEXT DEFAULT '#00e5ff',
      ADD COLUMN IF NOT EXISTS logo_url TEXT,
      ADD COLUMN IF NOT EXISTS welcome_message TEXT;

      -- 2. Create index on slug for fast lookup
      CREATE INDEX IF NOT EXISTS idx_customers_slug ON customers(slug);

      -- 3. Seed a default "kira" slug for testing (optional)
      UPDATE customers 
      SET slug = 'kira', 
          agent_name = 'KIRA', 
          brand_color = '#00ffd5', 
          welcome_message = 'Hi! I am KIRA, your AI support assistant. How can I help you today?'
      WHERE api_token = 'sk_test_echo_ultra'
         OR api_token = 'sk_live_35ad18a1-87a9-44ea-ac87-cd0df92bc348'; -- Using an actual token from this environment
    `;
    await db.query(query);
    console.log('✅ Database updated successfully: Added branding columns and slug index.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    process.exit();
  }
}

applyMigration();
