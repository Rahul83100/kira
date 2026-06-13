/**
 * SupportGenie — Onboarding API Routes
 *
 * Multi-step onboarding wizard for new signups.
 * Step 1: Goal selection
 * Step 2: Website training (URL crawl + screenshot)
 * Step 3: Agent configuration (name, tone, instructions)
 * Step 4: Preview (screenshot served)
 * Step 5: Complete → start free trial
 */

const express = require('express');
const router = express.Router();
const db = require('../db/client');
const authenticate = require('../middleware/auth');
const { extractFromURL } = require('../services/extractor');
const { chunkText } = require('../services/chunker');
const { generateEmbedding } = require('../services/embedder');
const { takeScreenshot } = require('../services/screenshotService');

// All onboarding routes require auth
router.use(authenticate);

// ── Concurrency limit for parallel embedding ──
const CONCURRENCY_LIMIT = 50;
async function pMap(items, fn, concurrency) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

async function embedAndStoreChunks(chunks, documentId, customerId) {
  await pMap(chunks, async (chunk, index) => {
    const embedding = await generateEmbedding(chunk);
    const vectorString = '[' + embedding.join(',') + ']';
    await db.query(
      `INSERT INTO chunks (document_id, customer_id, content, embedding, chunk_index)
       VALUES ($1, $2, $3, $4::vector, $5)`,
      [documentId, customerId, chunk, vectorString, index]
    );
  }, CONCURRENCY_LIMIT);
}

// ════════════════════════════════════════════════════════════════
// GET /api/onboarding/status
// Returns the user's current onboarding state
// ════════════════════════════════════════════════════════════════
router.get('/status', async (req, res) => {
  try {
    const customerId = req.customer.id;

    const result = await db.query(`
      SELECT
        onboarding_completed,
        onboarding_step,
        onboarding_goal,
        agent_tone,
        agent_instructions,
        widget_name,
        website_screenshot_url,
        company_name,
        slug,
        api_token,
        branding_color,
        trial_started_at,
        trial_messages_used,
        trial_messages_limit,
        trial_duration_days
      FROM customers WHERE id = $1
    `, [customerId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const c = result.rows[0];
    res.json({
      onboarding_completed: c.onboarding_completed,
      step: c.onboarding_step || 0,
      goal: c.onboarding_goal,
      agent_tone: c.agent_tone || 'friendly',
      agent_instructions: c.agent_instructions,
      agent_name: c.widget_name || 'Kira',
      screenshot_url: c.website_screenshot_url,
      company_name: c.company_name,
      slug: c.slug,
      api_token: c.api_token,
      branding_color: c.branding_color || '#00ffd5',
      trial: {
        started_at: c.trial_started_at,
        messages_used: c.trial_messages_used || 0,
        messages_limit: c.trial_messages_limit || 100,
        duration_days: c.trial_duration_days || 7,
      },
    });
  } catch (err) {
    console.error('[Onboarding] Status error:', err.message);
    res.status(500).json({ error: 'Failed to fetch onboarding status' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/onboarding/goal
// Save the selected goal (step 1)
// ════════════════════════════════════════════════════════════════
router.post('/goal', async (req, res) => {
  try {
    const { goal } = req.body;
    const customerId = req.customer.id;

    const validGoals = ['support', 'leads', 'both'];
    if (!validGoals.includes(goal)) {
      return res.status(400).json({ error: `Invalid goal. Must be one of: ${validGoals.join(', ')}` });
    }

    await db.query(
      `UPDATE customers SET onboarding_goal = $1, onboarding_step = GREATEST(onboarding_step, 1) WHERE id = $2`,
      [goal, customerId]
    );

    res.json({ success: true, goal, step: 1 });
  } catch (err) {
    console.error('[Onboarding] Goal error:', err.message);
    res.status(500).json({ error: 'Failed to save goal' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/onboarding/train-website
// Crawl a URL, extract text, chunk, embed, and take screenshot (step 2)
// This is synchronous (single-page) — no Redis required
// ════════════════════════════════════════════════════════════════
router.post('/train-website', async (req, res) => {
  try {
    let { url } = req.body;
    const customerId = req.customer.id;

    if (!url) {
      return res.status(400).json({ error: 'Missing required field: url' });
    }

    // Normalize URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    // Validate URL
    try { new URL(url); } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    console.log(`[Onboarding] 🌐 Training from website: ${url} for customer ${customerId}`);

    // Run website scraping and screenshot in parallel for speed
    const [rawText, screenshotResult] = await Promise.allSettled([
      extractFromURL(url),
      takeScreenshot(url, customerId).catch(err => {
        console.warn('[Onboarding] Screenshot failed (non-fatal):', err.message);
        return null;
      }),
    ]);

    // Handle scraping result
    const text = rawText.status === 'fulfilled' ? rawText.value : null;
    const screenshot = screenshotResult.status === 'fulfilled' ? screenshotResult.value : null;

    if (!text || text.trim().length === 0) {
      // Save screenshot even if scraping fails
      if (screenshot?.relativePath) {
        await db.query(
          `UPDATE customers SET website_screenshot_url = $1, onboarding_step = GREATEST(onboarding_step, 2) WHERE id = $2`,
          [screenshot.relativePath, customerId]
        );
      }
      return res.status(400).json({
        error: 'Could not extract text from this URL. The site may be behind a login or have limited content.',
        screenshot_url: screenshot?.relativePath || null,
      });
    }

    // Create document record
    const docResult = await db.query(
      `INSERT INTO documents (customer_id, source_url, filename, source_type, status, char_count)
       VALUES ($1, $2, $3, 'url', 'processing', $4)
       RETURNING id`,
      [customerId, url, `Onboarding: ${new URL(url).hostname}`, text.length]
    );
    const documentId = docResult.rows[0].id;

    // Chunk and embed
    const chunks = await chunkText(text);
    await embedAndStoreChunks(chunks, documentId, customerId);

    // Update document status
    await db.query(
      `UPDATE documents SET status = 'ready', chunk_count = $1 WHERE id = $2`,
      [chunks.length, documentId]
    );

    // Update customer with screenshot + step progress
    const screenshotUrl = screenshot?.relativePath || null;
    await db.query(
      `UPDATE customers SET
        website_screenshot_url = COALESCE($1, website_screenshot_url),
        onboarding_step = GREATEST(onboarding_step, 2)
       WHERE id = $2`,
      [screenshotUrl, customerId]
    );

    console.log(`[Onboarding] ✅ Website trained: ${chunks.length} chunks, screenshot: ${screenshotUrl ? 'yes' : 'no'}`);

    res.json({
      success: true,
      step: 2,
      document_id: documentId,
      chunks_created: chunks.length,
      char_count: text.length,
      screenshot_url: screenshotUrl,
    });
  } catch (err) {
    console.error('[Onboarding] Train error:', err.message);
    res.status(500).json({ error: 'Failed to train from website', details: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/onboarding/train-status
// Check if any documents exist for this customer
// ════════════════════════════════════════════════════════════════
router.get('/train-status', async (req, res) => {
  try {
    const customerId = req.customer.id;

    const result = await db.query(
      `SELECT id, filename, source_url, status, chunk_count, created_at
       FROM documents WHERE customer_id = $1
       ORDER BY created_at DESC LIMIT 5`,
      [customerId]
    );

    res.json({
      has_documents: result.rows.length > 0,
      documents: result.rows,
    });
  } catch (err) {
    console.error('[Onboarding] Train status error:', err.message);
    res.status(500).json({ error: 'Failed to check training status' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/onboarding/configure-agent
// Save agent name, tone, and instructions (step 3)
// ════════════════════════════════════════════════════════════════
router.post('/configure-agent', async (req, res) => {
  try {
    const { agent_name, tone, instructions } = req.body;
    const customerId = req.customer.id;

    const validTones = ['professional', 'concise', 'polite', 'friendly', 'casual'];
    if (tone && !validTones.includes(tone)) {
      return res.status(400).json({ error: `Invalid tone. Must be one of: ${validTones.join(', ')}` });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (agent_name) {
      updates.push(`widget_name = $${idx++}`);
      values.push(agent_name.trim());
    }
    if (tone) {
      updates.push(`agent_tone = $${idx++}`);
      values.push(tone);
    }
    if (instructions !== undefined) {
      updates.push(`agent_instructions = $${idx++}`);
      values.push(instructions.trim());
    }

    // Always advance the step
    updates.push(`onboarding_step = GREATEST(onboarding_step, 3)`);

    values.push(customerId);
    await db.query(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    res.json({ success: true, step: 3 });
  } catch (err) {
    console.error('[Onboarding] Configure agent error:', err.message);
    res.status(500).json({ error: 'Failed to save agent config' });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/onboarding/screenshot
// Returns the stored screenshot URL
// ════════════════════════════════════════════════════════════════
router.get('/screenshot', async (req, res) => {
  try {
    const customerId = req.customer.id;

    const result = await db.query(
      `SELECT website_screenshot_url FROM customers WHERE id = $1`,
      [customerId]
    );

    if (result.rows.length === 0 || !result.rows[0].website_screenshot_url) {
      return res.status(404).json({ error: 'No screenshot available' });
    }

    res.json({
      success: true,
      screenshot_url: result.rows[0].website_screenshot_url,
    });
  } catch (err) {
    console.error('[Onboarding] Screenshot error:', err.message);
    res.status(500).json({ error: 'Failed to fetch screenshot' });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/onboarding/complete
// Marks onboarding as done and starts the free trial
// ════════════════════════════════════════════════════════════════
router.post('/complete', async (req, res) => {
  try {
    const customerId = req.customer.id;

    await db.query(`
      UPDATE customers SET
        onboarding_completed = true,
        onboarding_step = 5,
        trial_started_at = COALESCE(trial_started_at, NOW()),
        plan = CASE WHEN plan = 'free' OR plan IS NULL THEN 'free_trial' ELSE plan END,
        subscription_status = CASE WHEN subscription_status = 'inactive' THEN 'trial' ELSE subscription_status END
      WHERE id = $1
    `, [customerId]);

    console.log(`[Onboarding] ✅ Completed for customer ${customerId} — free trial started`);

    res.json({
      success: true,
      message: 'Onboarding complete! Your 7-day free trial has started.',
      step: 5,
    });
  } catch (err) {
    console.error('[Onboarding] Complete error:', err.message);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

module.exports = router;
