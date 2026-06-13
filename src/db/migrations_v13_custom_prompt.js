const { Pool } = require('pg');
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
    console.log('🔄 Executing Migration V13 (Conversational Lead Gen: custom_prompt column)...');

    await pool.query(`
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS custom_prompt TEXT;
    `);

    console.log('✅ Migration V13 applied successfully!');
    console.log('   ✔ customers.custom_prompt column added');
  } catch (err) {
    console.error('❌ Migration V13 failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
