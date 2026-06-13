// ────────────────────────────────────────────────────────────────
// Supabase JS client (OPTIONAL)
// ────────────────────────────────────────────────────────────────
// Kira works fine WITHOUT Supabase — it falls back to the raw PostgreSQL
// pool (see ./client.js and ../middleware/auth.js). Supabase is only used
// as a convenience REST layer when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// are configured (e.g. when you host your database on Supabase).
//
// When those env vars are missing we export `null` so callers can detect
// that Supabase is unavailable and use the PostgreSQL fallback instead.
// ────────────────────────────────────────────────────────────────

let supabase = null;

if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    console.log('✅ Supabase client initialised');
  } catch (err) {
    console.warn('⚠️  Supabase client init failed — using PostgreSQL fallback:', err.message);
    supabase = null;
  }
} else {
  console.info('ℹ️  Supabase not configured — using direct PostgreSQL (DATABASE_URL).');
}

module.exports = supabase;
