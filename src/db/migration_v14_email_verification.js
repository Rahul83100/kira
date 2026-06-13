/**
 * SupportGenie — Migration V14: Email Verification (OTP)
 *
 * Adds OTP storage table and email_verified columns on customers.
 *
 * Run: node src/db/migration_v14_email_verification.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const db = require('./client');

async function migrate() {
  console.log('🚀 Running Migration V14 — Email Verification (OTP)...\n');

  const queries = [
    // 1. Add email_verified flag to customers
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP`,

    // 2. Existing customers are grandfathered as verified (otherwise they'd be locked out)
    `UPDATE customers SET email_verified = true, email_verified_at = NOW()
       WHERE email_verified IS NULL OR email_verified = false`,

    // 3. OTP storage table
    //    - otp_hash: SHA-256 hashed code, never store plaintext
    //    - purpose: 'signup' (extensible to 'forgot-password' later)
    //    - attempts: brute-force counter
    //    - expires_at: short TTL (10 min)
    //    - consumed_at: single-use enforcement
    `CREATE TABLE IF NOT EXISTS email_otps (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      otp_hash VARCHAR(255) NOT NULL,
      purpose VARCHAR(32) NOT NULL DEFAULT 'signup',
      attempts INTEGER NOT NULL DEFAULT 0,
      ip_address VARCHAR(64),
      expires_at TIMESTAMP NOT NULL,
      consumed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,

    `CREATE INDEX IF NOT EXISTS idx_email_otps_lookup
       ON email_otps(email, purpose, consumed_at)`,

    `CREATE INDEX IF NOT EXISTS idx_email_otps_expires
       ON email_otps(expires_at)`,
  ];

  for (const sql of queries) {
    try {
      await db.query(sql);
      const shortSql = sql.replace(/\s+/g, ' ').trim().substring(0, 90);
      console.log(`  ✅ ${shortSql}...`);
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log(`  ⏭️  Already exists — skipping`);
      } else {
        console.error(`  ❌ Failed: ${err.message}`);
      }
    }
  }

  console.log('\n✅ Migration V14 complete.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
