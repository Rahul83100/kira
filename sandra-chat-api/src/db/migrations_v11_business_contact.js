// src/db/migrations_v11_business_contact.js
// Adds business_phone and business_email columns to the customers table.
// These allow widget owners to provide their own contact details for the chatbot
// to reference in escalation messages, instead of using platform defaults.
const db = require('./client');

async function applyMigration() {
  console.log('🚀 Starting Business Contact Migration (v11)...');
  try {
    await db.query(`
      ALTER TABLE customers
        ADD COLUMN IF NOT EXISTS business_phone TEXT,
        ADD COLUMN IF NOT EXISTS business_email TEXT;
    `);
    console.log('✅ Added business_phone and business_email columns to customers table.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    process.exit();
  }
}

applyMigration();
