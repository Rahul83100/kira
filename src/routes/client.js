/**
 * SupportGenie — Public Client Branding Routes
 *
 * Serves public-facing branding configuration for the chatbot widget
 * and standalone chat page. NO authentication required.
 *
 * WHY NO AUTH:
 * ────────────
 * This endpoint is hit by:
 *   1. The Kira widget JavaScript embedded on customer websites
 *   2. The standalone chat page (PUBLIC_BASE_URL/chat/:slug)
 *   3. QR codes that link to the chat page
 *
 * Browser chat contexts need the public customer API token to call the chat
 * endpoint, the same way the generated embed script includes it. This route
 * still excludes private account, billing, and owner data.
 *
 * DB COLUMNS USED (from migration v5):
 * ─────────────────────────────────────
 *   customers.slug           — unique public identifier (e.g., "cyclecorp")
 *   customers.branding_logo  — URL to the customer's logo image
 *   customers.branding_color — hex color code for the chat theme
 *   customers.kb_id          — knowledge base UUID for RAG queries
 *   customers.company_name   — displayed in the chat header
 */

const express = require('express');
const router = express.Router();
const db = require('../db/client');
const QRCode = require('qrcode');
const authenticate = require('../middleware/auth');

async function getCustomerColumns() {
  const result = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'customers'`
  );
  return new Set(result.rows.map((row) => row.column_name));
}

function selectColumn(columns, column, alias, fallback = 'NULL') {
  return columns.has(column) ? `${column} AS ${alias}` : `${fallback} AS ${alias}`;
}

function isCustomerSlug(req, slug) {
  return req.customer?.slug && req.customer.slug.toLowerCase() === slug.toLowerCase().trim();
}

function getPublicApiBase(req) {
  if (process.env.PUBLIC_API_URL) return process.env.PUBLIC_API_URL;
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

// ═══════════════════════════════════════════════════════════════════
// GET /api/client/:slug
// Returns public branding config for a customer.
//
// Example: GET /api/client/cyclecorp
// Response: {
//   slug: "cyclecorp",
//   company_name: "Cycle Corp",
//   branding_logo: "https://picsum.photos/100",
//   branding_color: "#4A90E2",
//   kb_id: "uuid-here",
//   plan: "pro"
// }
//
// Used by the widget to:
//   1. Set the chat header title (company_name)
//   2. Apply the brand color to the chat theme (branding_color)
//   3. Display the customer's logo (branding_logo)
//   4. Route AI queries to the right knowledge base (kb_id)
// ═══════════════════════════════════════════════════════════════════
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug || slug.length < 2) {
      return res.status(400).json({ error: 'Invalid slug' });
    }

    const columns = await getCustomerColumns();
    const result = await db.query(`
      SELECT
        slug,
        ${selectColumn(columns, 'name', 'name')},
        ${selectColumn(columns, 'company_name', 'company_name', "'Support Assistant'")},
        ${selectColumn(columns, 'branding_logo', 'branding_logo')},
        ${selectColumn(columns, 'logo_url', 'logo_url')},
        ${selectColumn(columns, 'branding_color', 'branding_color', "'#667eea'")},
        ${selectColumn(columns, 'brand_color', 'brand_color', "'#667eea'")},
        ${selectColumn(columns, 'widget_name', 'widget_name', "'KIRA'")},
        ${selectColumn(columns, 'agent_name', 'agent_name', "'KIRA'")},
        ${selectColumn(columns, 'standalone_agent_name', 'standalone_agent_name')},
        ${selectColumn(columns, 'widget_welcome', 'widget_welcome', "'Hi! How can I help you today?'")},
        ${selectColumn(columns, 'welcome_message', 'welcome_message', "'Hi! How can I help you today?'")},
        ${selectColumn(columns, 'custom_prompt', 'custom_prompt')},
        ${selectColumn(columns, 'kb_id', 'kb_id')},
        ${selectColumn(columns, 'plan', 'plan', "'free'")},
        ${selectColumn(columns, 'subscription_status', 'subscription_status')},
        ${selectColumn(columns, 'standalone_theme', 'standalone_theme', "'dark'")},
        ${selectColumn(columns, 'standalone_bg_color', 'standalone_bg_color', "'#060d1a'")},
        ${selectColumn(columns, 'standalone_chatbox_color', 'standalone_chatbox_color', "'#ffffff'")},
        ${selectColumn(columns, 'business_phone', 'business_phone')},
        ${selectColumn(columns, 'business_email', 'business_email')},
        ${selectColumn(columns, 'api_token', 'api_token')},
        ${selectColumn(columns, 'widget_logo_data', 'widget_logo_data')},
        ${selectColumn(columns, 'standalone_logo_data', 'standalone_logo_data')}
      FROM customers
      WHERE slug = $1
    `, [slug.toLowerCase().trim()]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const client = result.rows[0];
    const apiBase = getPublicApiBase(req);
    const normalizedSlug = client.slug;
    const legacyLogo = client.branding_logo || client.logo_url || null;
    const widgetLogo = client.widget_logo_data
      ? `${apiBase}/api/client/${normalizedSlug}/logo/widget`
      : legacyLogo;
    const standaloneLogo = client.standalone_logo_data
      ? `${apiBase}/api/client/${normalizedSlug}/logo/standalone`
      : widgetLogo;
    const agentName = client.widget_name || client.agent_name || client.company_name || 'KIRA';
    const welcome = client.widget_welcome || client.welcome_message || 'Hi! How can I help you today?';
    const color = client.branding_color || client.brand_color || '#667eea';

    // Only return safe, public-facing fields
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      client: {
        slug: normalizedSlug,
        name: client.name || null,
        company_name: client.company_name || 'Support Assistant',
        branding_logo: widgetLogo,
        branding_color: color,
        widget_name: agentName,
        widget_welcome: welcome,
        customPrompt: client.custom_prompt || null,
        kb_id: client.kb_id || null,
        plan: client.plan || 'free',
        is_active: client.subscription_status === 'paid' || client.subscription_status === 'active',
      },
      // Flattened for dashboard compatibility
      customPrompt: client.custom_prompt || null,
      customerName: client.name || null,
      agentName,
      standaloneAgentName: client.standalone_agent_name || agentName,
      welcome,
      color,
      logo: widgetLogo,
      standaloneLogo,
      widgetLogo,
      hasStandaloneLogo: Boolean(client.standalone_logo_data || client.widget_logo_data),
      hasWidgetLogo: Boolean(client.widget_logo_data),
      standaloneTheme: client.standalone_theme || 'dark',
      standaloneBgColor: client.standalone_bg_color || '#060d1a',
      standaloneChatboxColor: client.standalone_chatbox_color || '#ffffff',
      businessPhone: client.business_phone || null,
      businessEmail: client.business_email || null,
      token: client.api_token || null,
      chatApiUrl: process.env.PUBLIC_CHAT_API_URL || 'https://kira-chat-api.onrender.com',
    });
  } catch (err) {
    console.error('[Client] ❌ Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch client config' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/client/:slug/widget
// Updates the widget configuration (name + welcome message + prompt) for
// a customer. Called by the dashboard when the user edits the
// Widget Setup form.
//
// Body: { widget_name: "Zara", widget_welcome: "Hi!", custom_prompt: "..." }
// Auth: Requires the customer's API token in the Authorization header.
// ═══════════════════════════════════════════════════════════════════
router.put('/:slug/widget', authenticate, async (req, res) => {
  try {
    const { slug } = req.params;
    const {
      widget_name,
      standalone_agent_name,
      widget_welcome,
      custom_prompt,
      custom_prompt: customPrompt,
      color,
      standalone_theme,
      standalone_bg_color,
      standalone_chatbox_color,
      business_phone,
      business_email,
    } = req.body;
    const finalPrompt = custom_prompt ?? customPrompt;

    if (!slug || slug.length < 2) {
      return res.status(400).json({ error: 'Invalid slug' });
    }
    if (!isCustomerSlug(req, slug)) {
      return res.status(403).json({ error: 'You can only update your own widget configuration.' });
    }

    // Build SET clause dynamically — only update provided fields
    const columns = await getCustomerColumns();
    const updates = [];
    const values = [];
    let paramIdx = 1;
    const addUpdate = (column, value) => {
      if (!columns.has(column)) return;
      updates.push(`${column} = $${paramIdx++}`);
      values.push(value);
    };

    if (widget_name !== undefined) {
      addUpdate('widget_name', widget_name.trim());
      addUpdate('agent_name', widget_name.trim());
    }
    if (standalone_agent_name !== undefined) {
      addUpdate('standalone_agent_name', standalone_agent_name.trim());
    } else if (widget_name !== undefined) {
      addUpdate('standalone_agent_name', widget_name.trim());
    }
    if (widget_welcome !== undefined) {
      addUpdate('widget_welcome', widget_welcome.trim());
      addUpdate('welcome_message', widget_welcome.trim());
    }
    if (finalPrompt !== undefined) {
      addUpdate('custom_prompt', finalPrompt.trim());
    }
    if (color !== undefined) {
      addUpdate('branding_color', color);
      addUpdate('brand_color', color);
    }
    if (standalone_theme !== undefined) {
      addUpdate('standalone_theme', standalone_theme);
    }
    if (standalone_bg_color !== undefined) {
      addUpdate('standalone_bg_color', standalone_bg_color);
    }
    if (standalone_chatbox_color !== undefined) {
      addUpdate('standalone_chatbox_color', standalone_chatbox_color);
    }
    if (business_phone !== undefined) {
      addUpdate('business_phone', business_phone || null);
    }
    if (business_email !== undefined) {
      addUpdate('business_email', business_email || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(slug.toLowerCase().trim());
    const result = await db.query(
      `UPDATE customers SET ${updates.join(', ')} WHERE slug = $${paramIdx} RETURNING slug`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    console.log(`[Client] ✅ Widget config updated for ${slug}`);
    res.json({ success: true, ...result.rows[0] });
  } catch (err) {
    console.error('[Client] ❌ Widget update error:', err.message);
    res.status(500).json({ error: 'Failed to update widget config' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/client/:slug/profile
// Updates the customer's profile (their real name, not the widget name).
// Called from the dashboard Settings page.
//
// Body: { name: "Rahul R" }
// Auth: Requires the customer's API token in the Authorization header.
// ═══════════════════════════════════════════════════════════════════
router.put('/:slug/profile', async (req, res) => {
  try {
    const { slug } = req.params;
    const { name } = req.body;

    if (!slug || slug.length < 2) {
      return res.status(400).json({ error: 'Invalid slug' });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await db.query(
      `UPDATE customers SET name = $1 WHERE slug = $2 RETURNING name, slug`,
      [name.trim(), slug.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    console.log(`[Client] ✅ Profile name updated for ${slug}: "${name.trim()}"`);
    res.json({ success: true, name: result.rows[0].name });
  } catch (err) {
    console.error('[Client] ❌ Profile update error:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/client/:slug/qr
// Generates and returns a QR code PNG image for the customer's
// standalone chat page.
//
// HOW IT WORKS:
// ─────────────
// 1. Look up the customer by slug to verify they exist
// 2. Build the chat URL: ${PUBLIC_BASE_URL}/chat/:slug
// 3. Use the `qrcode` npm package to render a PNG buffer in-memory
//    (no temp files, no external API calls)
// 4. Send the PNG back with proper Content-Type headers
//
// QUERY PARAMS (optional):
//   ?size=300     — width/height in pixels (default: 300, max: 1000)
//   ?download=1   — sets Content-Disposition to force download
//   ?color=6366f1 — foreground color hex (default: 000000)
//
// WHY SERVER-SIDE instead of the external qrserver.com API:
//   - No third-party tracking of your customers' URLs
//   - Works offline / in air-gapped deployments
//   - Can add logo overlays or branding later
//   - One less external dependency to break
// ═══════════════════════════════════════════════════════════════════
router.get('/:slug/qr', async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug || slug.length < 2) {
      return res.status(400).json({ error: 'Invalid slug' });
    }

    // Verify the customer exists
    const result = await db.query(
      `SELECT slug, company_name, branding_color FROM customers WHERE slug = $1`,
      [slug.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const customer = result.rows[0];

    // Parse optional query params
    const size = Math.min(Math.max(parseInt(req.query.size) || 300, 50), 1000);
    const forceDownload = req.query.download === '1' || req.query.download === 'true';
    // Color: from query param, or customer's brand color, or black
    const colorHex = (req.query.color || customer.branding_color || '#000000').replace('#', '');
    const darkColor = `#${colorHex}`;

    // Build the standalone chat URL that the QR code will encode, including
    // attribution tags so QR scans can be separated from normal widget traffic.
    const publicBaseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:5173';
    const chatUrl = new URL(`${publicBaseUrl}/chat/${customer.slug}`);
    chatUrl.searchParams.set('utm_source', req.query.utm_source || 'qr_code');
    chatUrl.searchParams.set('utm_medium', req.query.utm_medium || 'offline');
    chatUrl.searchParams.set('utm_campaign', req.query.utm_campaign || `qr_${customer.slug}`);

    // Generate QR code as PNG buffer
    // qrcode.toBuffer() renders the QR matrix directly into a PNG
    // without writing to disk — fast and memory-efficient.
    const qrBuffer = await QRCode.toBuffer(chatUrl.toString(), {
      type: 'png',
      width: size,
      margin: 2,
      color: {
        dark: darkColor,
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M', // ~15% error correction — enough for scanning
    });

    // Set response headers
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24h

    if (forceDownload) {
      res.setHeader('Content-Disposition', `attachment; filename="kira-qr-${customer.slug}.png"`);
    }

    console.log(`[Client] ✅ QR generated for ${customer.slug} (${size}px, color: ${darkColor})`);
    res.send(qrBuffer);
  } catch (err) {
    console.error('[Client] ❌ QR generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/client/:slug/api-token
// Returns the customer's API token for authenticated chat requests.
// This is a PROTECTED endpoint — requires the customer's email
// as a basic verification layer.
// ═══════════════════════════════════════════════════════════════════
router.get('/:slug/api-token', async (req, res) => {
  try {
    const { slug } = req.params;
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Missing email query parameter' });
    }

    const result = await db.query(
      `SELECT api_token FROM customers WHERE slug = $1 AND LOWER(email) = $2`,
      [slug.toLowerCase().trim(), email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found or email mismatch' });
    }

    res.json({
      success: true,
      api_token: result.rows[0].api_token,
    });
  } catch (err) {
    console.error('[Client] ❌ API token error:', err.message);
    res.status(500).json({ error: 'Failed to fetch API token' });
  }
});

const multer = require('multer');

// Multer config for logo uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: PNG, JPEG, WebP, SVG`));
  },
});

function handleLogoUpload(req, res, next) {
  upload.single('logo')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum allowed size is 5MB.' });
    }
    return res.status(400).json({ error: err.message });
  });
}

router.post('/:slug/logo/:type', authenticate, handleLogoUpload, async (req, res) => {
  try {
    const { slug, type } = req.params;
    if (!['standalone', 'widget'].includes(type)) {
      return res.status(400).json({ error: 'Invalid logo type. Must be "standalone" or "widget".' });
    }
    if (!isCustomerSlug(req, slug)) {
      return res.status(403).json({ error: 'You can only upload logos for your own widget.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Send a file in the "logo" field.' });
    }

    const columns = await getCustomerColumns();
    const dataCol = type === 'standalone' ? 'standalone_logo_data' : 'widget_logo_data';
    const mimeCol = type === 'standalone' ? 'standalone_logo_mime' : 'widget_logo_mime';
    if (!columns.has(dataCol) || !columns.has(mimeCol)) {
      return res.status(500).json({ error: 'Logo upload columns are missing. Run migration v10.' });
    }

    const clearStandalone = type === 'widget' && columns.has('standalone_logo_data') && columns.has('standalone_logo_mime')
      ? ', standalone_logo_data = NULL, standalone_logo_mime = NULL'
      : '';

    const logoPath = `/api/client/${slug.toLowerCase().trim()}/logo/${type}`;
    const legacyUpdates = [];
    const values = [req.file.buffer.toString('base64'), req.file.mimetype];
    let nextParam = 3;

    if (type === 'widget') {
      if (columns.has('branding_logo')) {
        legacyUpdates.push(`branding_logo = $${nextParam++}`);
        values.push(logoPath);
      }
      if (columns.has('logo_url')) {
        legacyUpdates.push(`logo_url = $${nextParam++}`);
        values.push(logoPath);
      }
    }

    values.push(slug.toLowerCase().trim());
    const result = await db.query(
      `UPDATE customers SET ${dataCol} = $1, ${mimeCol} = $2${clearStandalone}${legacyUpdates.length ? `, ${legacyUpdates.join(', ')}` : ''} WHERE slug = $${nextParam} RETURNING slug`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const apiBase = getPublicApiBase(req);
    res.json({
      success: true,
      type,
      logo_url: `${apiBase}/api/client/${result.rows[0].slug}/logo/${type}`,
      size: req.file.size,
      mime: req.file.mimetype,
    });
  } catch (err) {
    console.error('[Client] ❌ Logo upload error:', err.message);
    res.status(500).json({ error: 'Failed to upload logo' });
  }
});

router.get('/:slug/logo/:type', async (req, res) => {
  try {
    const { slug, type } = req.params;
    if (!['standalone', 'widget'].includes(type)) {
      return res.status(400).json({ error: 'Invalid logo type. Must be "standalone" or "widget".' });
    }

    const columns = await getCustomerColumns();
    const primaryDataCol = type === 'standalone' ? 'standalone_logo_data' : 'widget_logo_data';
    const primaryMimeCol = type === 'standalone' ? 'standalone_logo_mime' : 'widget_logo_mime';
    if (!columns.has(primaryDataCol) || !columns.has(primaryMimeCol)) {
      return res.status(404).json({ error: 'No logo uploaded for this client.' });
    }

    let result = await db.query(
      `SELECT ${primaryDataCol} AS data, ${primaryMimeCol} AS mime FROM customers WHERE slug = $1`,
      [slug.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    let { data, mime } = result.rows[0];
    if (!data && type === 'standalone' && columns.has('widget_logo_data') && columns.has('widget_logo_mime')) {
      result = await db.query(
        `SELECT widget_logo_data AS data, widget_logo_mime AS mime FROM customers WHERE slug = $1`,
        [slug.toLowerCase().trim()]
      );
      data = result.rows[0]?.data;
      mime = result.rows[0]?.mime;
    }

    if (!data) {
      return res.status(404).json({ error: 'No logo uploaded for this client.' });
    }

    const imageBuffer = Buffer.from(data, 'base64');
    res.setHeader('Content-Type', mime || 'application/octet-stream');
    res.setHeader('Content-Length', imageBuffer.length);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(imageBuffer);
  } catch (err) {
    console.error('[Client] ❌ Logo serve error:', err.message);
    res.status(500).json({ error: 'Failed to serve logo' });
  }
});

router.delete('/:slug/logo/:type', authenticate, async (req, res) => {
  try {
    const { slug, type } = req.params;
    if (!['standalone', 'widget'].includes(type)) {
      return res.status(400).json({ error: 'Invalid logo type. Must be "standalone" or "widget".' });
    }
    if (!isCustomerSlug(req, slug)) {
      return res.status(403).json({ error: 'You can only delete logos for your own widget.' });
    }

    const columns = await getCustomerColumns();
    const dataCol = type === 'standalone' ? 'standalone_logo_data' : 'widget_logo_data';
    const mimeCol = type === 'standalone' ? 'standalone_logo_mime' : 'widget_logo_mime';
    if (!columns.has(dataCol) || !columns.has(mimeCol)) {
      return res.json({ success: true, type, message: `${type} logo removed.` });
    }

    const result = await db.query(
      `UPDATE customers SET ${dataCol} = NULL, ${mimeCol} = NULL WHERE slug = $1 RETURNING slug`,
      [slug.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json({ success: true, type, message: `${type} logo removed.` });
  } catch (err) {
    console.error('[Client] ❌ Logo delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete logo' });
  }
});

module.exports = router;
