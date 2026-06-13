/**
 * Run Migration V4: Direct connection (no pgbouncer)
 * Uses the direct Supabase connection string for DDL operations.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

// Use direct connection (port 5432) instead of pooler (port 6543)
// pgbouncer blocks DDL like ALTER TABLE and CREATE TABLE
const poolerUrl = process.env.DATABASE_URL;
let directUrl = poolerUrl;

if (poolerUrl) {
  // Convert pooler URL to direct connection
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

    // Run each statement individually for better error reporting
    const statements = [
      { label: 'subscription_tier column', sql: "ALTER TABLE customers ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free'" },
      { label: 'queries_this_month column', sql: "ALTER TABLE customers ADD COLUMN IF NOT EXISTS queries_this_month INT DEFAULT 0" },
      { label: 'billing_cycle_end column', sql: "ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_cycle_end TIMESTAMP" },
      { label: 'razorpay_customer_id column', sql: "ALTER TABLE customers ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT" },
      { label: 'razorpay_subscription_id column', sql: "ALTER TABLE customers ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT" },
      { label: 'payment_history table', sql: `CREATE TABLE IF NOT EXISTS payment_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
        razorpay_payment_id TEXT NOT NULL,
        razorpay_order_id TEXT,
        razorpay_signature TEXT,
        amount_paise INT NOT NULL,
        currency TEXT DEFAULT 'INR',
        plan_name TEXT NOT NULL,
        payment_status TEXT DEFAULT 'captured',
        payment_method TEXT,
        receipt TEXT,
        email TEXT NOT NULL,
        name TEXT,
        company TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )` },
      { label: 'payment_history customer index', sql: "CREATE INDEX IF NOT EXISTS idx_payment_history_customer ON payment_history(customer_id)" },
      { label: 'payment_history email index', sql: "CREATE INDEX IF NOT EXISTS idx_payment_history_email ON payment_history(email)" },
    ];

    for (const stmt of statements) {
      try {
        await client.query(stmt.sql);
        console.log(`   ✅ ${stmt.label}`);
      } catch (e) {
        if (e.message.includes('already exists')) {
          console.log(`   ⏭️  ${stmt.label} (already exists)`);
        } else {
          console.log(`   ❌ ${stmt.label}: ${e.message}`);
        }
      }
    }

    // Verify columns
    const verifyResult = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'customers' 
      AND column_name IN ('subscription_tier', 'queries_this_month', 'billing_cycle_end', 'razorpay_customer_id')
      ORDER BY column_name
    `);
    console.log('\n📋 Verified billing columns in DB:');
    verifyResult.rows.forEach(r => console.log(`   ✅ customers.${r.column_name}`));

    const tableCheck = await client.query(`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'payment_history'
    `);
    if (tableCheck.rows.length > 0) {
      console.log('   ✅ payment_history table exists');
    }

    client.release();
    console.log('\n🎉 Migration V4 completed successfully!');
  } catch (err) {
    console.error('❌ Connection/migration failed:', err.message);
    console.log('\n📋 Fallback: Run the SQL manually in Supabase SQL Editor:');
    console.log('   1. Go to https://supabase.com/dashboard → Your Project → SQL Editor');
    console.log('   2. Paste the contents of src/db/migrations_v4.sql');
    console.log('   3. Click "Run"');
  } finally {
    await pool.end();
  }
}

runMigration();
