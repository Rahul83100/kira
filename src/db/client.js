const { Pool } = require('pg');
require('dotenv').config();

// ── Supabase JS Admin Client (uses service_role key — bypasses RLS) ──────────
// This is the preferred method for server-side writes triggered by payment events.
let supabase = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && supabaseServiceKey) {
    supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });
    console.log('✅ Supabase JS admin client initialised');
  } else {
    console.warn('⚠️  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — Supabase JS client disabled');
  }
} catch (err) {
  console.warn('⚠️  Could not initialise Supabase JS client:', err.message);
}

// ── Raw PostgreSQL Pool (used in webhooks / legacy paths) ────────────────────
let pool = null;
try {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  pool.on('error', (err) => {
    console.warn('⚠️  Postgres pool error:', err.message);
  });
} catch (err) {
  console.warn('⚠️  Postgres pool init failed:', err.message);
}

module.exports = {
  supabase,
  query: async (text, params) => {
    if (!pool) return { rows: [] };
    try {
      return await pool.query(text, params);
    } catch (err) {
      console.warn('⚠️  Postgres query failed:', err.message);
      if (err.detail) console.warn('Detail:', err.detail);
      throw err; // Rethrow so the caller knows the operation failed
    }
  },
  pool,
  /**
   * strictQuery: Runs a raw SQL query via the pool. 
   * Unlike basic 'query', this will throw the error so the caller can handle it 
   * (e.g. for database rollback or returning specific 500 errors).
   */
  strictQuery: async (text, params) => {
    if (!pool) throw new Error('Database pool not initialised');
    return await pool.query(text, params);
  }
};
