const express = require('express');
const router = express.Router();
const db = require('../db/client');
const authenticate = require('../middleware/auth');
const { getPlanLimits } = require('../services/planService');
const { getDocumentCount, getStorageUsage } = require('../services/storageService');

router.use(authenticate);

// ═══════════════════════════════════════════════════════════════════
// GET /api/usage
// Returns the current logged-in customer's credit and storage usage
// ═══════════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const customerId = req.customer.id;
    const currentMonth = new Date().toISOString().slice(0, 7); // e.g., '2026-04'

    // Fetch customer and usage data
    // Source of Truth Hierarchy:
    // 1. query_usage table (official monthly counter)
    // 2. trial_messages_used (fallback for trial users)
    // 3. api_logs (verification of what actually happened)
    const result = await db.query(`
      SELECT 
        c.plan,
        c.subscription_tier,
        c.manual_credit_modifier,
        c.storage_chars_used,
        c.trial_messages_used,
        c.trial_messages_limit,
        c.trial_started_at,
        c.trial_duration_days,
        COALESCE(q.count, 0)::int AS queries_used,
        (SELECT COUNT(*)::int FROM api_logs WHERE customer_id = c.id AND created_at >= ($2 || '-01')::timestamp) as logs_this_month
      FROM customers c
      LEFT JOIN query_usage q ON c.id = q.customer_id AND q.month = $2
      WHERE c.id = $1
    `, [customerId, currentMonth]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const data = result.rows[0];
    const plan = (data.plan && data.plan !== 'free' ? data.plan : data.subscription_tier) || data.plan || 'free';
    const planLimits = getPlanLimits(plan);
    const sourceCount = await getDocumentCount(customerId);

    const CREDIT_LIMITS = {
      free: 100,
      free_trial: 100,
      base: 2000,
      pro: 5000,
      growth: 15000,
      base_annual: 24000,
      pro_annual: 60000,
      growth_annual: 180000
    };

    const baseLimit = CREDIT_LIMITS[plan] || CREDIT_LIMITS.free;
    const totalCreditLimit = baseLimit + (data.manual_credit_modifier || 0);

    // Sync Logic: Take the maximum value from all tracking sources to prevent "resets" or "skips"
    const isTrial = plan === 'free_trial' || plan === 'free';
    const queriesFromUsageTable = data.queries_used || 0;
    const queriesFromLogs = data.logs_this_month || 0;
    const trialUsed = data.trial_messages_used || 0;

    // Use the most aggressive counter to ensure limits are respected and user sees progress
    const creditsUsed = Math.max(queriesFromUsageTable, queriesFromLogs, isTrial ? trialUsed : 0);
    
    const activeLimit = isTrial ? (data.trial_messages_limit || 100) : totalCreditLimit;
    const creditsRemaining = Math.max(0, activeLimit - creditsUsed);

    // Calculate depletion date roughly
    let estimatedDepletionDate = null;
    if (creditsUsed > 0) {
      const today = new Date();
      const daysPassed = today.getDate();
      const dailyRate = creditsUsed / daysPassed;
      if (dailyRate > 0) {
        const daysLeft = creditsRemaining / dailyRate;
        const depDate = new Date(today);
        depDate.setDate(today.getDate() + daysLeft);
        // Only return if it falls within the current month
        if (depDate.getMonth() === today.getMonth()) {
          estimatedDepletionDate = depDate.toISOString().split('T')[0];
        }
      }
    }

    res.json({
      plan: plan,
      credits: {
        used: creditsUsed,
        limit: activeLimit,
        remaining: creditsRemaining
      },
      storage: {
        used_chars: data.storage_chars_used || 0,
        limit_chars: planLimits.storage_chars,
        sources: sourceCount,
        max_sources: planLimits.max_sources,
        max_file_mb: planLimits.max_file_mb
      },
      estimated_depletion_date: estimatedDepletionDate
    });

  } catch (err) {
    console.error('[Usage API] Error fetching usage:', err);
    res.status(500).json({ error: 'Failed to fetch usage data', details: err.message });
  }
});

module.exports = router;

// ═══════════════════════════════════════════════════════════════════
// GET /api/usage/analytics
// Returns query volume and FAQs for the Analytics dashboard
// ═══════════════════════════════════════════════════════════════════
router.get('/analytics', async (req, res) => {
  try {
    const customerId = req.customer.id;

    // 1. Total queries (last 30 days) and AI resolved
    const totalsResult = await db.query(`
      SELECT 
        COUNT(*)::int AS total_queries,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int AS ai_resolved
      FROM api_logs
      WHERE customer_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
    `, [customerId]);

    const { total_queries, ai_resolved } = totalsResult.rows[0];

    // 2. Daily query volume (last 30 days)
    const dailyResult = await db.query(`
      SELECT 
        DATE(created_at) AS date, 
        COUNT(*)::int AS queries,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int AS resolved
      FROM api_logs 
      WHERE customer_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at) 
      ORDER BY date
    `, [customerId]);

    // Fill in missing days
    const dailyData = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const dateObj = new Date(now);
      dateObj.setDate(now.getDate() - i);
      const dateStr = dateObj.toISOString().split('T')[0];
      const dayLabel = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      
      const found = dailyResult.rows.find(r => new Date(r.date).toISOString().split('T')[0] === dateStr);
      dailyData.push({
        date: dayLabel,
        queries: found ? found.queries : 0,
        resolved: found ? found.resolved : 0
      });
    }

    // 3. Top Customer Questions (FAQs)
    const faqResult = await db.query(`
      SELECT 
        request_text AS question, 
        COUNT(*)::int AS frequency,
        ROUND((SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::numeric / COUNT(*)) * 100)::int AS resolved
      FROM api_logs
      WHERE customer_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY request_text
      ORDER BY frequency DESC
      LIMIT 5
    `, [customerId]);

    const faqs = faqResult.rows.map(row => ({
      ...row,
      trend: "+0%" // Static for now unless we do complex window functions
    }));

    res.json({
      success: true,
      total_queries: total_queries || 0,
      ai_resolved: ai_resolved || 0,
      query_volume: dailyData,
      faqs: faqs
    });

  } catch (err) {
    console.error('[Usage API] Error fetching analytics:', err);
    res.status(500).json({ error: 'Failed to fetch analytics', details: err.message });
  }
});
