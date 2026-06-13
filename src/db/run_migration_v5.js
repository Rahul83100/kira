/**
 * Run Migration V5: Ingestion API Storage Limits
 * Direct connection (no pgbouncer)
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

const poolerUrl = process.env.DATABASE_URL;
let directUrl = poolerUrl;

if (poolerUrl && poolerUrl.includes('pooler.supabase.com:6543')) {
  directUrl = poolerUrl
    .replace('pooler.supabase.com:6543', 'pooler.supabase.com:5432')
    .replace('?pgbouncer=true', '');
  console.log('🔗 Using DIRECT connection (port 5432, no pgbouncer)');
}

async function runMigration() {
  if (!directUrl) {
    console.error('❌ DATABASE_URL missing from .env');
    process.exit(1);
  }

  const pool = new Pool({ 
    connectionString: directUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });

  try {
    const client = await pool.connect();
    console.log('✅ Connected to Supabase (direct)');

    const statements = [
      { label: 'storage_chars_used column', sql: "ALTER TABLE customers ADD COLUMN IF NOT EXISTS storage_chars_used BIGINT DEFAULT 0" },
      { label: 'char_count column', sql: "ALTER TABLE documents ADD COLUMN IF NOT EXISTS char_count INT DEFAULT 0" },
      { label: 'initialize customer usage', sql: "UPDATE customers SET storage_chars_used = 0 WHERE storage_chars_used IS NULL" },
      { label: 'initialize document counts', sql: "UPDATE documents SET char_count = 0 WHERE char_count IS NULL" },
    ];

    for (const stmt of statements) {
      try {
        await client.query(stmt.sql);
        console.log(`   ✅ ${stmt.label}`);
      } catch (e) {
        console.log(`   ❌ ${stmt.label}: ${e.message}`);
      }
    }

    client.release();
    console.log('\n🎉 Migration V5 completed successfully!');
  } catch (err) {
    console.error('❌ Connection/migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

runMigration();
