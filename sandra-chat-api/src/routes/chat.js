const express = require('express');
const router = express.Router();
const { buildSystemPrompt, detectEscalation, ensureManifest } = require('../services/geminiService');
const { getPromptVersion } = require('../services/promptManager');
const { callLLM } = require('../services/llmService');
const { getCache, setCache } = require('../services/cacheService');
const { getHistory, appendToHistory } = require('../services/historyService');
const { logApiRequest } = require('../services/loggingService');
const { checkBurstLimit, checkDailyLimit } = require('../services/endUserRateLimiter');
const { detectLanguage } = require('../services/languageDetector');
const { analyzeSentiment } = require('../services/sentimentService');
const { extractLeadFromConversation, containsContactInfo } = require('../services/leadExtractor');
const { sendHighIntentAlert } = require('../services/resendService');
const auth = require('../middleware/auth');
const redisRateLimiter = require('../middleware/redisRateLimiter');
const { deductCredits, getBalance } = require('../../../src/services/creditService');

const db = require('../db/client');


// Import Prajeet's real retrieval function (connected after merge)
const { retrieveRelevantChunks } = require('../../../src/services/retrieval');

// ──────────────────────────────────────────────────────────────
// Utility: Scrub PII (Credit Cards and SSNs)
// ──────────────────────────────────────────────────────────────
function scrubPII(text) {
  if (!text || typeof text !== 'string') return text;

  // 1. Mask Emails
  let scrubbed = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED EMAIL]');

  // 2. Mask Phone Numbers (supports various formats: +1-234-567-8901, (234) 567-8901, 2345678901)
  scrubbed = scrubbed.replace(/\b(?:\+?\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}\b/g, '[REDACTED PHONE]');

  // 3. Mask SSN (formats: AAA-GG-SSSS or AAA GG SSSS)
  scrubbed = scrubbed.replace(/\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g, '[REDACTED SSN]');

  // 4. Mask Credit Cards (13-16 digits often grouped by spaces or dashes)
  scrubbed = scrubbed.replace(/\b(?:\d[ -]*?){13,16}\b/g, function (match) {
    const digitsOnly = match.replace(/[^0-9]/g, '');
    if (digitsOnly.length >= 13 && digitsOnly.length <= 16) {
      return '[REDACTED CREDIT CARD]';
    }
    return match;
  });

  return scrubbed;
}

function parseOptionalInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

// ── Helper: Save extracted lead using resilient PostgreSQL upsert ──────────
async function saveLead(leadRow) {
  try {
    // Prefer robust SQL path over Supabase schema cache so optional columns
    // (campaign_id/outbound_lead_id) don't break lead capture.
    const upsertQuery = `
      INSERT INTO leads (
        customer_id,
        name,
        email,
        phone,
        course_interest,
        conversation_session_id,
        source,
        medium,
        campaign_id,
        outbound_lead_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (conversation_session_id)
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, leads.name),
        email = COALESCE(EXCLUDED.email, leads.email),
        phone = COALESCE(EXCLUDED.phone, leads.phone),
        course_interest = COALESCE(EXCLUDED.course_interest, leads.course_interest),
        source = COALESCE(EXCLUDED.source, leads.source),
        medium = COALESCE(EXCLUDED.medium, leads.medium),
        campaign_id = COALESCE(EXCLUDED.campaign_id, leads.campaign_id),
        outbound_lead_id = COALESCE(EXCLUDED.outbound_lead_id, leads.outbound_lead_id),
        updated_at = NOW()
      RETURNING id
    `;

    const upsertValues = [
      leadRow.customer_id,
      leadRow.name || null,
      leadRow.email || null,
      leadRow.phone || null,
      leadRow.course_interest || null,
      leadRow.conversation_session_id || null,
      leadRow.source || null,
      leadRow.medium || null,
      leadRow.campaign_id || null,
      leadRow.outbound_lead_id || null,
    ];

    const result = await db.query(upsertQuery, upsertValues);
    return result.rows?.[0] || null;
  } catch (err) {
    const missingColumn =
      err.message.includes('column "campaign_id"') ||
      err.message.includes('column "outbound_lead_id"') ||
      err.message.includes('column "medium"');

    if (missingColumn) {
      try {
        const fallbackQuery = `
          INSERT INTO leads (
            customer_id,
            name,
            email,
            phone,
            course_interest,
            conversation_session_id,
            source
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (conversation_session_id)
          DO UPDATE SET
            name = COALESCE(EXCLUDED.name, leads.name),
            email = COALESCE(EXCLUDED.email, leads.email),
            phone = COALESCE(EXCLUDED.phone, leads.phone),
            course_interest = COALESCE(EXCLUDED.course_interest, leads.course_interest),
            source = COALESCE(EXCLUDED.source, leads.source),
            updated_at = NOW()
          RETURNING id
        `;
        const fallbackValues = [
          leadRow.customer_id,
          leadRow.name || null,
          leadRow.email || null,
          leadRow.phone || null,
          leadRow.course_interest || null,
          leadRow.conversation_session_id || null,
          leadRow.source || null,
        ];
        const fallbackResult = await db.query(fallbackQuery, fallbackValues);
        return fallbackResult.rows?.[0] || null;
      } catch (fallbackErr) {
        console.error('⚠️ Lead save fallback failed:', fallbackErr.message);
        return null;
      }
    }

    console.error('⚠️ Lead save error:', err.message);
    return null;
  }
}

// ── Main Chat Handler ──────────────────────────────────────────

/**
 * Main Chat Handler (Unified logic with Streaming Support)
 */
async function handleChat(req, res) {
  try {
    let {
      message,
      sessionId,
      source,
      medium,
      campaign_id,
      campaignId,
      lead_id,
      outbound_lead_id,
      utm_source,
      utm_medium,
      utm_campaign,
      contextChunks,
      stream = false
    } = req.body;
    const rawUserMessage = message;
    const { customer } = req; // set by auth middleware
    source = source || utm_source || null;
    medium = medium || utm_medium || null;
    campaign_id = campaign_id || campaignId || utm_campaign || null;

    if (outbound_lead_id) {
      source = 'kira_outbound';
      lead_id = outbound_lead_id;
    }


    // Ensure prompt manifest is loaded
    await ensureManifest();

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ error: 'A valid message is required' });
    }

    const messageForLLM = scrubPII(rawUserMessage);

    // ── Task 5: 500 character input limit ─────────────────────
    if (rawUserMessage.length > 500) {
      return res.status(400).json({
        error: 'Message too long. Please keep your question under 500 characters.'
      });
    }

    if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 100) {
      return res.status(400).json({ error: 'A valid sessionId is required (max 100 characters)' });
    }

    // ── Task 4 Tier 3: Customer monthly / trial credit check ──────────
    // Trial plans (free, free_trial) use the trial_messages_used counter
    // Paid plans (base, pro, growth) use the deductCredits atomic system
    const isTrialPlan = customer.plan === 'free_trial' || customer.plan === 'free' || !customer.plan;
    
    if (isTrialPlan) {
      // ── Trial Limit Check ──
      const trialQuery = await db.query(
        `SELECT trial_messages_used, trial_messages_limit FROM customers WHERE id = $1`,
        [customer.id]
      );
      const tData = trialQuery.rows[0] || {};
      const limit = tData.trial_messages_limit || 100;
      const used = tData.trial_messages_used || 0;
      
      if (used >= limit) {
        console.warn(`🛑 Trial Credits Exhausted for customer ${customer.id}`);
        return res.status(200).json({
          reply: "I'd love to help, but your free trial has reached its limit! Please upgrade your plan to continue chatting.",
          credits_exhausted: true
        });
      }
      
      // Increment trial usage (Lifetime)
      await db.query(
        `UPDATE customers SET trial_messages_used = COALESCE(trial_messages_used, 0) + 1 WHERE id = $1`,
        [customer.id]
      );
    } else {
      // ── Paid Plan Credit Check ──
      const { allowed: monthlyAllowed, remaining } = await deductCredits(customer.id, 'chatbot_reply', 1);
      if (!monthlyAllowed) {
        console.warn(`🛑 Credits Exhausted for customer ${customer.id}. Remaining: ${remaining}`);
        return res.status(200).json({
          reply: `I'd love to help, but our support system is currently unavailable. Please contact us directly at ${customer.business_phone || customer.business_email || 'our support team'}. We'll be back soon!`,
          credits_exhausted: true
        });
      }
    }

    // ── Track monthly query count (Source of truth for Sidebar/Analytics) ──
    const currentMonth = new Date().toISOString().slice(0, 7);

    // CRITICAL: We AWAIT this now to ensure it's saved before the response or any refresh
    try {
      await db.query(
        `INSERT INTO query_usage (customer_id, month, count)
         VALUES ($1, $2, 1)
         ON CONFLICT (customer_id, month) DO UPDATE SET count = query_usage.count + 1`,
        [customer.id, currentMonth]
      );
    } catch (err) {
      console.warn('[Chat] ❌ query_usage upsert failed:', err.message);
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

    // ── Task 4 Tier 1: Burst limit — 5 messages per 60s per IP ──
    const { allowed: burstAllowed, retryAfterMs } = await checkBurstLimit(ip);
    if (!burstAllowed) {
      console.warn(`🛑 Burst Limit hit for IP ${ip}`);
      return res.status(429).json({ error: "Too many messages. Please slow down and try again shortly." });
    }

    // ── Task 4 Tier 2: Daily limit — plan-based per IP ───────────
    const customerToken = req.headers.authorization?.split(' ')[1] || req.query.token || 'unknown';
    const PLAN_DAILY_LIMITS = { free_trial: 10, base: 15, growth: 25, pro: 50 };
    const planDailyLimit = PLAN_DAILY_LIMITS[customer.plan || 'free_trial'] || 10;
    const { allowed: dailyAllowed, used: dailyUsed, limit: dailyLimit } = await checkDailyLimit(customerToken, sessionId, ip, planDailyLimit);
    if (!dailyAllowed) {
      console.warn(`🛑 Daily limit hit for session ${sessionId} / IP ${ip} on plan ${customer.plan}`);
      return res.status(200).json({
        reply: "You've reached your daily chat limit. For further assistance, please share your name and phone number, and our team will contact you directly! 📞",
        daily_limit_reached: true
      });
    }

    /* Cache check disabled for testing new prompt logic
    if (!stream) {
      const cached = await getCache(customer.id, rawUserMessage);
      if (cached) return res.json({ ...cached, cached: true });
    }
    */

    // 3. Search Query / History Logic
    const history = await getHistory(sessionId);
    let searchQuery = messageForLLM;
    const VAGUE_FOLLOW_UPS = /^(yes|yeah|yep|yea|sure|ok|okay|go on|go ahead|tell me more|more|continue|please|details|explain|elaborate|why|how|what|no|nope)\.?!?$/i;
    if (messageForLLM.split(/\s+/).length <= 4 && VAGUE_FOLLOW_UPS.test(messageForLLM.trim())) {
      const lastSubstantive = [...history].reverse().find(h => h.role === 'user' && h.content.trim().split(/\s+/).length > 1);
      if (lastSubstantive) searchQuery = lastSubstantive.content;
    }

    // 4. Context & Enrichment
    const [chunks, lang] = await Promise.all([
      retrieveRelevantChunks(customer.id, searchQuery, 5),
      Promise.resolve(detectLanguage(messageForLLM))
    ]);
    const { toneInstruction } = analyzeSentiment(messageForLLM);

    const systemPrompt = buildSystemPrompt(sessionId, customer.company_name, chunks, lang.instruction, toneInstruction, customer.custom_prompt, customer.business_phone, customer.business_email);
    const promptVersion = getPromptVersion(sessionId);

    // 5. LLM Call Logic (Streaming vs Non-Streaming)
    if (stream) {
      // ── SERVER-SENT EVENTS (SSE) STREAM ──────────────────
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Transfer-Encoding': 'chunked'
      });

      let fullReply = '';
      const { callLLMStream } = require('../services/llmService');

      try {
        for await (const chunk of callLLMStream(systemPrompt, history, messageForLLM)) {
          fullReply += chunk;
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }

        const escalate = detectEscalation(fullReply, sessionId);
        res.write(`data: ${JSON.stringify({
          done: true,
          escalate,
          sessionId,
          language: lang.code,
          promptVersion
        })}\n\n`);
        res.end();

        // DEFERRED BACKGROUND TASKS (After stream finishes)
        (async () => {
          await appendToHistory(sessionId, 'user', rawUserMessage);
          await appendToHistory(sessionId, 'assistant', fullReply);

          if (containsContactInfo(rawUserMessage) || containsContactInfo(fullReply)) {
            const extracted = await extractLeadFromConversation([...history, { role: 'user', content: rawUserMessage }, { role: 'assistant', content: fullReply }]);
            if (extracted) {
              await saveLead({
                customer_id: customer.id,
                name: extracted.name,
                email: extracted.email,
                phone: extracted.phone,
                course_interest: extracted.serviceInterest || extracted.courseInterest,
                conversation_session_id: sessionId,
                source: source || null,
                medium: medium || null,
                campaign_id: campaign_id || null,
                outbound_lead_id: parseOptionalInt(lead_id)
              });
            }
          }

          await logApiRequest({
            customerId: customer.id,
            sessionId,
            model: 'gemini-1.5-flash-latest',
            requestText: messageForLLM,
            responseText: fullReply,
            status: 'success'
          });
        })().catch(err => console.error('Deferred chat tasks failed:', err));

      } catch (err) {
        console.error('Streaming error:', err);
        res.write(`data: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`);
        res.end();
      }
      return;
    }

    // NON-STREAMING (Standard JSON)
    const reply = await callLLM(systemPrompt, history, messageForLLM);
    const escalate = detectEscalation(reply, sessionId);

    await appendToHistory(sessionId, 'user', rawUserMessage);
    await appendToHistory(sessionId, 'assistant', reply);

    // Lead Extraction
    let leadCaptured = false;
    if (containsContactInfo(rawUserMessage) || containsContactInfo(reply)) {
      const extracted = await extractLeadFromConversation([...history, { role: 'user', content: rawUserMessage }, { role: 'assistant', content: reply }]);
      if (extracted) {
        await saveLead({
          customer_id: customer.id,
          name: extracted.name,
          email: extracted.email,
          phone: extracted.phone,
          course_interest: extracted.serviceInterest || extracted.courseInterest,
          conversation_session_id: sessionId,
          source: source || null,
          medium: medium || null,
          campaign_id: campaign_id || null,
          outbound_lead_id: parseOptionalInt(lead_id)
        });
        leadCaptured = true;
      }
    }

    const response = {
      success: true,
      reply,
      data: { reply, escalate, sessionId, language: lang.code, promptVersion, leadCaptured }
    };

    await setCache(customer.id, rawUserMessage, response);

    // DEFERRED BACKGROUND LOGGING
    (async () => {
      await logApiRequest({
        customerId: customer.id,
        sessionId,
        model: 'gemini-1.5-flash-latest',
        requestText: messageForLLM,
        responseText: reply,
        status: 'success'
      });
    })().catch(err => console.error('Logging failed:', err));

    return res.json(response);

  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}


// Routes
router.post('/', auth, redisRateLimiter, handleChat);
router.post('/message', auth, redisRateLimiter, handleChat); // Alias for compatibility
router.post('/simple', auth, redisRateLimiter, handleChat);  // Added to fix the 404 errors from the widget

/**
 * Lead capture (Manual/Explicit)
 */
router.post('/lead', auth, async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      courseInterest,
      sessionId,
      source,
      medium,
      campaign_id,
      campaignId,
      outbound_lead_id,
      utm_source,
      utm_medium,
      utm_campaign
    } = req.body;
    const { customer } = req;
    const leadSource = outbound_lead_id ? 'kira_outbound' : (source || utm_source || 'widget');
    const leadMedium = medium || utm_medium || null;
    const leadCampaignId = campaign_id || campaignId || utm_campaign || null;

    if (!name || !phone) {
      return res.status(400).json({ error: 'A valid name and phone number are required' });
    }

    const query = `
      INSERT INTO leads (
        customer_id,
        name,
        email,
        phone,
        course_interest,
        conversation_session_id,
        source,
        medium,
        campaign_id,
        outbound_lead_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `;

    const params = [
      customer.id,
      name,
      email,
      phone,
      courseInterest,
      sessionId,
      leadSource,
      leadMedium,
      leadCampaignId,
      parseOptionalInt(outbound_lead_id)
    ];
    const result = await db.query(query, params);

    return res.json({
      success: true,
      message: 'Lead captured successfully',
      lead_id: result.rows[0].id
    });
  } catch (err) {
    console.error('Lead capture error:', err.message);
    return res.status(500).json({ error: 'Failed to capture lead. Please try again.' });
  }
});

/**
 * Task 6: GET /api/usage — Returns credit balance for authenticated customer
 */
router.get('/usage', auth, async (req, res) => {
  try {
    const { customer } = req;
    const remaining = await getBalance(customer.id);
    const stats = { remaining };

    // Estimate depletion date using linear projection
    const today = new Date();
    const dayOfMonth = today.getDate();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const dailyRate = (stats.used && dayOfMonth > 0) ? stats.used / dayOfMonth : 0;
    let estimated_depletion_date = null;
    if (dailyRate > 0 && stats.remaining > 0) {
      const daysLeft = Math.ceil(stats.remaining / dailyRate);
      const depletionDate = new Date(today);
      depletionDate.setDate(today.getDate() + daysLeft);
      estimated_depletion_date = depletionDate.toISOString().slice(0, 10);
    }

    // Storage stats (character-based — sourced from document_chunks table if available)
    let storageStats = { used_chars: 0, limit_chars: 3000000, sources: 0, max_sources: 15 };
    try {
      const storageResult = await db.query(
        `SELECT COALESCE(SUM(LENGTH(content)), 0) as used_chars, COUNT(DISTINCT source_url) as sources
         FROM chunks WHERE customer_id = $1`,
        [customer.id]
      );
      if (storageResult.rows[0]) {
        storageStats.used_chars = parseInt(storageResult.rows[0].used_chars || 0, 10);
        storageStats.sources = parseInt(storageResult.rows[0].sources || 0, 10);
      }
    } catch (e) {
      // Storage stats are non-critical — silently skip if table doesn't exist yet
    }

    return res.json({
      plan: customer.plan,
      credits: stats,
      storage: storageStats,
      estimated_depletion_date
    });
  } catch (err) {
    console.error('Usage stats error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch usage stats.' });
  }
});

module.exports = { router, handleChat };
