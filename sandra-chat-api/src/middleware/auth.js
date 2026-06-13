const db = require('../db/client');
const supabase = require('../db/supabaseClient');


async function auth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token;

    // Extract token from Bearer header if it exists
    const headerToken = (authHeader && authHeader.startsWith('Bearer '))
      ? authHeader.split(' ')[1]
      : null;

    // Use either the header token OR the query token (?token=...)
    const token = headerToken || queryToken;

    console.log('📡 [DEBUG] Auth check:', {
      hasHeader: !!authHeader,
      queryToken: queryToken,
      finalToken: token,
      allQueryParams: req.query
    });

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: Missing or malformed token' });
    }

    // Lookup the customer from the DB by token.
    let customerData = null;

    // Prefer Supabase REST when configured; otherwise skip straight to PG.
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('customers')
          .select('id, company_name, plan, allowed_domains, status, custom_prompt, business_phone, business_email')
          .eq('api_token', token)
          .limit(1);

        if (!error && data && data.length > 0) {
          customerData = data[0];
        }
      } catch (supabaseErr) {
        console.warn('⚠️  Supabase lookup failed, falling back to raw PG:', supabaseErr.message);
      }
    }

    // Fallback: raw PostgreSQL pool (handles cases where Supabase REST is down)
    if (!customerData) {
      try {
        const result = await db.query(
          'SELECT id, company_name, plan, allowed_domains, status, custom_prompt, business_phone, business_email FROM customers WHERE api_token = $1',
          [token]
        );
        if (result.rows.length > 0) {
          customerData = result.rows[0];
        }
      } catch (pgErr) {
        console.warn('⚠️  Raw PG lookup also failed:', pgErr.message);
      }
    }

    if (!customerData) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // 🚨 KILLSWITCH: Reject suspended accounts instantly
    if (customerData.status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended. Please contact support.' });
    }

    req.customer = customerData;

    // ── Domain Whitelisting (CORS Hardening) ──
    const allowedDomainsRaw = customerData.allowed_domains;
    if (allowedDomainsRaw && allowedDomainsRaw.length > 0) {
      const allowedDomains = Array.isArray(allowedDomainsRaw)
        ? allowedDomainsRaw
        : allowedDomainsRaw.split(',').map(d => d.trim().toLowerCase());

      const requestOrigin = (req.headers.origin || req.headers.referer || '').toLowerCase();
      let isAllowed = false;

      if (requestOrigin) {
        try {
          const originUrl = requestOrigin.startsWith('http') ? new URL(requestOrigin) : new URL('https://' + requestOrigin);
          const domain = originUrl.hostname;

          if (domain === 'localhost' || domain === '127.0.0.1') {
            isAllowed = true;
          } else {
            isAllowed = allowedDomains.some(allowedDomain =>
              domain === allowedDomain || domain.endsWith('.' + allowedDomain)
            );
          }
        } catch (e) {
          console.warn('⚠️ Invalid Origin/Referer format:', requestOrigin);
        }
      }

      if (!isAllowed) {
        console.warn(`🛑 Origin Rejected: ${requestOrigin || 'None'} for customer ${customerData.id}`);
        return res.status(403).json({ error: 'Origin not allowed for this customer (CORS Hardening)' });
      }
    }

    next();
  } catch (err) {
    console.error('Auth error:', err.message);
    if (err.code === 'ECONNREFUSED' || err.code === '42P01') {
      return res.status(503).json({ error: 'Service Unavailable: Database Connection Failed' });
    }
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

module.exports = auth;