// src/db/migrations_v9_branding_apply.js
// Migration: Add branding & slug columns to customers table
// Safe to run multiple times — all statements use IF NOT EXISTS

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const db = require('./client');

async function applyMigration() {
  console.log('🚀 Starting Branding & Slug Migration (v9)...');
  try {
    // Run each ALTER separately to avoid syntax issues with multi-statement batches
    const steps = [
      { label: 'slug column',           sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE` },
      { label: 'agent_name column',     sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS agent_name TEXT` },
      { label: 'brand_color column',    sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS brand_color TEXT DEFAULT '#00ffd5'` },
      { label: 'accent_color column',   sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS accent_color TEXT DEFAULT '#00e5ff'` },
      { label: 'logo_url column',       sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS logo_url TEXT` },
      { label: 'welcome_message column',sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS welcome_message TEXT` },
      { label: 'slug index',            sql: `CREATE INDEX IF NOT EXISTS idx_customers_slug ON customers(slug)` },
    ];

    for (const step of steps) {
      await db.query(step.sql);
      console.log(`  ✅ ${step.label}`);
    }

    // Seed the test token row if it exists
    const seedResult = await db.query(`
      UPDATE customers 
      SET slug = 'kira',
          agent_name = 'KIRA',
          brand_color = '#00ffd5',
          welcome_message = 'Hi! I am KIRA, your AI support assistant. How can I help you today?'
      WHERE api_token = 'sk_test_echo_ultra' AND slug IS NULL
      RETURNING email
    `);

    if (seedResult.rows.length > 0) {
      console.log(`  ✅ Seeded 'kira' slug for: ${seedResult.rows[0].email}`);
    } else {
      console.log('  ℹ️  Test token (sk_test_echo_ultra) not found — skipped seed (this is fine).');
    }

    console.log('\n✅ Migration v9 completed successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await db.pool?.end?.();
    process.exit(0);
  }
}

applyMigration();
