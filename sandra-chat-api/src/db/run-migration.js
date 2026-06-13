const db = require('./client');

async function runMigration() {
  console.log('Starting SANARA Database Migration...');

  try {
    // 1. Add columns to customers
    await db.query(`
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_balance INTEGER DEFAULT 0;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS plan VARCHAR(20) DEFAULT 'free_trial';
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS storage_chars_used BIGINT DEFAULT 0;
    `);
    console.log('✅ Customers table updated.');

    // 2. Recreate query_usage to have the required schema. 
    // We will preserve the existing data by creating a backup table, dropping, recreating, and restoring.
    
    // Create new table
    await db.query(`
      CREATE TABLE IF NOT EXISTS query_usage_new (
        id SERIAL PRIMARY KEY,
        customer_id UUID NOT NULL,
        month VARCHAR(7) NOT NULL,
        count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(customer_id, month)
      );
    `);

    // Insert old data
    await db.query(`
      INSERT INTO query_usage_new (customer_id, month, count)
      SELECT customer_id, month, count FROM query_usage
      ON CONFLICT (customer_id, month) DO NOTHING;
    `);

    // Drop old and rename
    await db.query(`DROP TABLE query_usage CASCADE;`);
    await db.query(`ALTER TABLE query_usage_new RENAME TO query_usage;`);
    console.log('✅ query_usage table updated.');

    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
}

runMigration();
