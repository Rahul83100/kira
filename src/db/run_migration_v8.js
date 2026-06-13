const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

async function runMigration() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const isCloud = dbUrl.includes('supabase') || dbUrl.includes('neon') || dbUrl.includes('render');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: isCloud ? { rejectUnauthorized: false } : false
  });

  try {
    const sqlPath = path.join(__dirname, 'migrations_v8_credit_system.sql');
    const sqlScript = fs.readFileSync(sqlPath, 'utf8');

    console.log('🔄 Executing Migration V8 (Credit System: query_usage table + customers plan columns)...');

    await pool.query(sqlScript);

    console.log('✅ Migration V8 applied successfully!');
    console.log('   ✔ query_usage table created');
    console.log('   ✔ customers.credit_balance column added');
    console.log('   ✔ customers.plan column added');
    console.log('   ✔ customers.trial_ends_at column added');
    console.log('   ✔ customers.storage_chars_used column added');
  } catch (err) {
    console.error('❌ Migration V8 failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
