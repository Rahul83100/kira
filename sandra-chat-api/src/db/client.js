require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
const { Pool } = require('pg');

let pool = null;

console.log('Attempting to initialize Postgres pool...');

try {
  const dbUrl = process.env.DATABASE_URL || '';
  const isCloud = dbUrl.includes('supabase.co') || dbUrl.includes('supabase.com') || dbUrl.includes('neon.tech') || dbUrl.includes('render.com');

  pool = new Pool({
    connectionString: dbUrl,
    ssl: isCloud ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15000, // 15 seconds to allow pooler handshake
    query_timeout: 10000            // 10 seconds for query execution
  });

  pool.on('error', (err) => {
    console.warn('⚠️  Postgres connection error:', err.message);
  });
} catch (err) {
  console.warn('⚠️  Postgres initialization failed:', err.message);
}

// Circuit Breaker State
let isDatabaseDown = false;
let lastFailureTime = 0;
const BREAKER_COOLDOWN_MS = 60 * 1000; // 60 seconds

module.exports = {
  query: async (text, params) => {
    if (!pool) throw new Error('Database pool not initialised');

    // Check Circuit Breaker
    if (isDatabaseDown && (Date.now() - lastFailureTime < BREAKER_COOLDOWN_MS)) {
      throw new Error('Database unreachable (Circuit Breaker Active)');
    }

    try {
      const result = await pool.query(text, params);
      // Reset breaker on success
      isDatabaseDown = false;
      return result;
    } catch (err) {
      console.warn('⚠️  Postgres query failed:', err.message);
      
      // Trip Breaker on connection-related failures
      if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED') || err.code === 'ETIMEDOUT') {
        isDatabaseDown = true;
        lastFailureTime = Date.now();
        console.warn('🛑 Circuit Breaker Tripped: Database marked as DOWN for 60s');
      }

      if (err.detail) console.warn('Detail:', err.detail);
      throw err;
    }
  },
  isDatabaseDown: () => isDatabaseDown && (Date.now() - lastFailureTime < BREAKER_COOLDOWN_MS),
  pool,
};
