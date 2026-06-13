// src/db/migrations_v10_logo_upload.js
// Migration: Add logo file upload columns to customers table
// Stores logos as base64 in TEXT columns (max 5MB → ~6.7MB base64)
// Safe to run multiple times — all statements use IF NOT EXISTS

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const db = require('./client');

async function applyMigration() {
  console.log('🚀 Starting Logo Upload Migration (v10)...');
  try {
    const steps = [
      {
        label: 'standalone_logo_data column',
        sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS standalone_logo_data TEXT`,
      },
      {
        label: 'standalone_logo_mime column',
        sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS standalone_logo_mime TEXT`,
      },
      {
        label: 'widget_logo_data column',
        sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS widget_logo_data TEXT`,
      },
      {
        label: 'widget_logo_mime column',
        sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS widget_logo_mime TEXT`,
      },
    ];

    for (const step of steps) {
      await db.query(step.sql);
      console.log(`  ✅ ${step.label}`);
    }

    console.log('\n✅ Migration v10 (Logo Upload) completed successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await db.pool?.end?.();
    process.exit(0);
  }
}

applyMigration();
