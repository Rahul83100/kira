const express = require('express');
const router = express.Router();
const db = require('../db/client');
const multer = require('multer');

// ── Multer Config ────────────────────────────────────────────────
// memoryStorage: file stays in RAM buffer, never touches disk.
// We convert to base64 and store in the DB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB hard limit
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: PNG, JPEG, WebP, SVG`));
    }
  },
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/client/config/by-token/:token
// Returns public branding config for a customer based on token.
// Used by the live widget to stay dynamically in sync without code updates.
// MUST be defined BEFORE /:slug to avoid wildcard matching.
// ═══════════════════════════════════════════════════════════════════
router.get('/config/by-token/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const query = `
      SELECT 
        id, 
        company_name, 
        agent_name, 
        brand_color as color, 
        accent_color as "accentColor", 
        logo_url as logo, 
        welcome_message as welcome, 
        slug,
        standalone_agent_name,
        standalone_theme,
        standalone_bg_color,
        standalone_chatbox_color,
        custom_prompt,
        business_phone,
        business_email,
        standalone_logo_data IS NOT NULL AS has_standalone_logo,
        widget_logo_data IS NOT NULL AS has_widget_logo
      FROM customers 
      WHERE api_token = $1 
      LIMIT 1
    `;
    
    const result = await db.query(query, [token]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const client = result.rows[0];
    const apiBase = process.env.PUBLIC_API_URL || `http://localhost:${process.env.CHAT_PORT || (process.env.NODE_ENV === 'production' ? process.env.PORT : null) || 3001}`;
    const slug = client.slug;

    // Determine logo URLs — uploaded file takes priority over URL
    const standaloneLogo = client.has_standalone_logo
      ? `${apiBase}/api/client/${slug}/logo/standalone`
      : (client.logo || null);

    const widgetLogo = client.has_widget_logo
      ? `${apiBase}/api/client/${slug}/logo/widget`
      : (client.logo || null);
    
    res.json({
      agentName: client.agent_name || client.company_name || 'KIRA',
      color: client.color || '#00ffd5',
      accentColor: client.accentColor || '#00e5ff',
      logo: widgetLogo,
      welcome: client.welcome || `Hi! I'm ${client.agent_name || 'KIRA'}. How can I help you today?`,
      theme: client.standalone_theme || 'dark',
      customPrompt: client.custom_prompt,
      businessPhone: client.business_phone || null,
      businessEmail: client.business_email || null,
    });
  } catch (err) {
    console.error('❌ Error fetching client branding by token:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/client/:slug
// Returns public branding config for a customer.
// Now includes standalone/widget logo URLs when uploaded files exist.
// ═══════════════════════════════════════════════════════════════════
router.get('/:slug', async (req, res) => {
  const { slug } = req.params;

  try {
    const query = `
      SELECT 
        id, 
        company_name, 
        agent_name, 
        brand_color as color, 
        accent_color as "accentColor", 
        logo_url as logo, 
        welcome_message as welcome, 
        api_token as token,
        standalone_agent_name,
        standalone_theme,
        standalone_bg_color,
        standalone_chatbox_color,
        custom_prompt,
        business_phone,
        business_email,
        standalone_logo_data IS NOT NULL AS has_standalone_logo,
        widget_logo_data IS NOT NULL AS has_widget_logo
      FROM customers 
      WHERE slug = $1 
      LIMIT 1
    `;
    
    const result = await db.query(query, [slug]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const client = result.rows[0];
    const apiBase = process.env.PUBLIC_API_URL || `http://localhost:${process.env.CHAT_PORT || (process.env.NODE_ENV === 'production' ? process.env.PORT : null) || 3001}`;

    // Unified logo: widget logo is the company logo used everywhere.
    // Standalone falls back to widget logo if no separate one uploaded.
    const widgetLogo = client.has_widget_logo
      ? `${apiBase}/api/client/${slug}/logo/widget`
      : (client.logo || null);

    const standaloneLogo = client.has_standalone_logo
      ? `${apiBase}/api/client/${slug}/logo/standalone`
      : widgetLogo;
    
    // Add default values for missing fields
    res.json({
      agentName: client.agent_name || client.company_name || 'KIRA',
      standaloneAgentName: client.standalone_agent_name || client.agent_name || client.company_name || 'KIRA',
      color: client.color || '#00ffd5',
      accentColor: client.accentColor || '#00e5ff',
      logo: widgetLogo,
      standaloneLogo: standaloneLogo,
      widgetLogo: widgetLogo,
      welcome: client.welcome || `Hi! I'm ${client.agent_name || 'KIRA'}. How can I help you today?`,
      token: client.token,
      apiUrl: apiBase,
      standaloneTheme: client.standalone_theme || 'dark',
      standaloneBgColor: client.standalone_bg_color || '#060d1a',
      standaloneChatboxColor: client.standalone_chatbox_color || '#ffffff',
      hasStandaloneLogo: client.has_standalone_logo || client.has_widget_logo || false,
      hasWidgetLogo: client.has_widget_logo || false,
      customPrompt: client.custom_prompt,
      businessPhone: client.business_phone || null,
      businessEmail: client.business_email || null,
    });
  } catch (err) {
    console.error('❌ Error fetching client branding:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// (by-token route moved to top of file to avoid /:slug wildcard conflict)

// ═══════════════════════════════════════════════════════════════════
// PUT /api/client/:slug/widget
// Update widget branding (text fields only — logos use separate endpoints)
// ═══════════════════════════════════════════════════════════════════
router.put('/:slug/widget', express.json(), async (req, res) => {
  const { slug } = req.params;
  const { widget_name, standalone_agent_name, widget_welcome, color, standalone_theme, standalone_bg_color, standalone_chatbox_color, logo_url, custom_prompt, business_phone, business_email } = req.body;

  try {
    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (widget_name !== undefined) {
      updates.push(`agent_name = $${paramIdx++}`);
      values.push(widget_name);
    }
    if (standalone_agent_name !== undefined) {
      updates.push(`standalone_agent_name = $${paramIdx++}`);
      values.push(standalone_agent_name);
    }
    if (widget_welcome !== undefined) {
      updates.push(`welcome_message = $${paramIdx++}`);
      values.push(widget_welcome);
    }
    if (color !== undefined) {
      updates.push(`brand_color = $${paramIdx++}`);
      values.push(color);
    }
    if (standalone_theme !== undefined) {
      updates.push(`standalone_theme = $${paramIdx++}`);
      values.push(standalone_theme);
    }
    if (standalone_bg_color !== undefined) {
      updates.push(`standalone_bg_color = $${paramIdx++}`);
      values.push(standalone_bg_color);
    }

    if (standalone_chatbox_color !== undefined) {
      updates.push(`standalone_chatbox_color = $${paramIdx++}`);
      values.push(standalone_chatbox_color);
    }

    if (logo_url !== undefined) {
      updates.push(`logo_url = $${paramIdx++}`);
      values.push(logo_url);
    }
    if (custom_prompt !== undefined) {
      updates.push(`custom_prompt = $${paramIdx++}`);
      values.push(custom_prompt);
    }
    if (business_phone !== undefined) {
      updates.push(`business_phone = $${paramIdx++}`);
      values.push(business_phone || null);
    }
    if (business_email !== undefined) {
      updates.push(`business_email = $${paramIdx++}`);
      values.push(business_email || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(slug);
    const query = `
      UPDATE customers 
      SET ${updates.join(', ')} 
      WHERE slug = $${paramIdx} 
      RETURNING agent_name, standalone_agent_name, welcome_message, brand_color, standalone_theme, standalone_bg_color, standalone_chatbox_color, logo_url, custom_prompt, business_phone, business_email
    `;

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json({ success: true, client: result.rows[0] });
  } catch (err) {
    console.error('❌ Error updating client widget info:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/client/:slug/logo/:type
// Upload a logo file for the standalone page or widget.
//
// :type = 'standalone' or 'widget'
// Body: multipart/form-data with field name 'logo'
// Max size: 5MB
// Allowed types: PNG, JPEG, WebP, SVG
//
// The file buffer is converted to base64 and stored in the database.
// ═══════════════════════════════════════════════════════════════════
router.post('/:slug/logo/:type', (req, res, next) => {
  // Wrap multer in a custom handler to catch file-size errors
  const singleUpload = upload.single('logo');
  singleUpload(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'File too large. Maximum allowed size is 5MB.',
          maxSize: '5MB',
        });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  const { slug, type } = req.params;

  if (!['standalone', 'widget'].includes(type)) {
    return res.status(400).json({ error: 'Invalid logo type. Must be "standalone" or "widget".' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Send a file in the "logo" field.' });
  }

  try {
    const base64Data = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;
    const dataCol = type === 'standalone' ? 'standalone_logo_data' : 'widget_logo_data';
    const mimeCol = type === 'standalone' ? 'standalone_logo_mime' : 'widget_logo_mime';

    const result = await db.query(
      `UPDATE customers SET ${dataCol} = $1, ${mimeCol} = $2${type === 'widget' ? ', standalone_logo_data = NULL, standalone_logo_mime = NULL' : ''} WHERE slug = $3 RETURNING slug`,
      [base64Data, mimeType, slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const apiBase = process.env.PUBLIC_API_URL || `http://localhost:${process.env.CHAT_PORT || (process.env.NODE_ENV === 'production' ? process.env.PORT : null) || 3001}`;
    const logoUrl = `${apiBase}/api/client/${slug}/logo/${type}`;

    console.log(`[Client] ✅ ${type} logo uploaded for ${slug} (${mimeType}, ${(req.file.size / 1024).toFixed(1)}KB)`);

    res.json({
      success: true,
      type,
      logo_url: logoUrl,
      size: req.file.size,
      mime: mimeType,
    });
  } catch (err) {
    console.error(`[Client] ❌ Logo upload error (${type}):`, err.message);
    res.status(500).json({ error: 'Failed to upload logo' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/client/:slug/logo/:type
// Serve the uploaded logo as a raw image.
// Standalone falls back to widget logo if no separate one uploaded (unified logo).
// Uses pool directly with longer timeout since logo blobs can be large.
// ═══════════════════════════════════════════════════════════════════
router.get('/:slug/logo/:type', async (req, res) => {
  const { slug, type } = req.params;

  if (!['standalone', 'widget'].includes(type)) {
    return res.status(400).json({ error: 'Invalid logo type. Must be "standalone" or "widget".' });
  }

  try {
    // Use pool directly with a longer timeout for large blob queries
    const pool = db.pool;
    if (!pool) throw new Error('Database pool not initialised');

    const primaryCol = type === 'standalone' ? 'standalone_logo_data' : 'widget_logo_data';
    const primaryMime = type === 'standalone' ? 'standalone_logo_mime' : 'widget_logo_mime';

    let result = await pool.query({
      text: `SELECT ${primaryCol} AS data, ${primaryMime} AS mime FROM customers WHERE slug = $1`,
      values: [slug],
      query_timeout: 30000, // 30s for large blobs
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    let { data, mime } = result.rows[0];

    // Standalone fallback: if no standalone logo, try widget logo
    if (!data && type === 'standalone') {
      result = await pool.query({
        text: `SELECT widget_logo_data AS data, widget_logo_mime AS mime FROM customers WHERE slug = $1`,
        values: [slug],
        query_timeout: 30000,
      });
      if (result.rows.length > 0) {
        data = result.rows[0].data;
        mime = result.rows[0].mime;
      }
    }

    if (!data) {
      return res.status(404).json({ error: `No logo uploaded for this client.` });
    }

    const imageBuffer = Buffer.from(data, 'base64');

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', imageBuffer.length);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); // Always serve fresh logo
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(imageBuffer);
  } catch (err) {
    console.error(`[Client] ❌ Logo serve error (${type}):`, err.message);
    res.status(500).json({ error: 'Failed to serve logo' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /api/client/:slug/logo/:type
// Remove an uploaded logo (sets columns to NULL).
// ═══════════════════════════════════════════════════════════════════
router.delete('/:slug/logo/:type', async (req, res) => {
  const { slug, type } = req.params;

  if (!['standalone', 'widget'].includes(type)) {
    return res.status(400).json({ error: 'Invalid logo type. Must be "standalone" or "widget".' });
  }

  try {
    const dataCol = type === 'standalone' ? 'standalone_logo_data' : 'widget_logo_data';
    const mimeCol = type === 'standalone' ? 'standalone_logo_mime' : 'widget_logo_mime';

    const result = await db.query(
      `UPDATE customers SET ${dataCol} = NULL, ${mimeCol} = NULL WHERE slug = $1 RETURNING slug`,
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    console.log(`[Client] ✅ ${type} logo removed for ${slug}`);
    res.json({ success: true, type, message: `${type} logo removed.` });
  } catch (err) {
    console.error(`[Client] ❌ Logo delete error (${type}):`, err.message);
    res.status(500).json({ error: 'Failed to delete logo' });
  }
});

module.exports = router;
