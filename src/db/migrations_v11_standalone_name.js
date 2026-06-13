// src/db/migrations_v11_standalone_name.js
// Migration: Add standalone_agent_name column to customers table
// Safe to run multiple times — uses IF NOT EXISTS

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const db = require('./client');

async function applyMigration() {
  console.log('🚀 Starting Standalone Name Migration (v11)...');
  try {
    const sql = `ALTER TABLE customers ADD COLUMN IF NOT EXISTS standalone_agent_name TEXT`;
    await db.query(sql);
    console.log('  ✅ standalone_agent_name column added');
    console.log('\n✅ Migration v11 completed successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await db.pool?.end?.();
    process.exit(0);
  }
}

applyMigration();
