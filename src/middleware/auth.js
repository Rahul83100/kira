const db = require('../db/client');
const { logApiKeyUsed } = require('../services/auditLogger');

/**
 * Auth middleware — validates Bearer token from the Authorization header.
 * On success, attaches `req.customer` with the full customer row.
 * On failure, returns 401 Unauthorized.
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Bearer <token>' });
    }

    const token = authHeader.split(' ')[1];


    const result = await db.query(
      'SELECT * FROM customers WHERE api_token = $1',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API token' });
    }

    req.customer = result.rows[0];

    // 🚨 KILLSWITCH: Block ingestion/uploads for suspended accounts
    if (req.customer.status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended. API access has been revoked.' });
    }

    // SOC2 audit: log API key usage
    logApiKeyUsed(
      req.customer.id,
      token,
      req.ip || req.headers['x-forwarded-for'] || 'unknown',
      `${req.method} ${req.originalUrl}`
    ).catch(() => { }); // fire-and-forget, never block the request

    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
}

module.exports = authenticate;