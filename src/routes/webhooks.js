const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db/client');
const { logWebhookReceived } = require('../services/auditLogger');
const { sendHighIntentLeadAlert } = require('../services/resendService');
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

/**
 * Kira Plan Mapping: Normalise aliases and variants to canonical Kira tiers
 */
const KIRA_PLAN_MAP = {
  base:       'base',
  pro:        'pro',
  growth:     'growth',
};

/**
 * Determine subscription plan from variant ID / name
 */
function getPlanFromVariant(variantId, variantName) {
  const strId = String(variantId || '');
  const name = (variantName || '').toLowerCase();

  // Match by env var variant ID (most reliable for LS)
  if (process.env.LS_VARIANT_STARTER && strId === process.env.LS_VARIANT_STARTER) return 'base';
  if (process.env.LS_VARIANT_PRO     && strId === process.env.LS_VARIANT_PRO)     return 'pro';
  if (process.env.LS_VARIANT_GROWTH  && strId === process.env.LS_VARIANT_GROWTH)  return 'growth';

  // Fallback: match by variant/product name
  if (name.includes('starter'))    return 'base';
  if (name.includes('base'))       return 'base';
  if (name.includes('pro'))        return 'pro';
  if (name.includes('growth'))     return 'growth';

  return null;
}

/**
 * Verify signatures for various platforms
 */
function verifySignature(rawBody, signature, secret) {
  if (!secret) return true; // dev mode
  const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return hmac === signature;
}

/**
 * Update customer subscription status in PostgreSQL (pg)
 */
async function updateCustomerSubscription(email, status, extraData = {}) {
  const plan = KIRA_PLAN_MAP[status] || status;
  const result = await db.query(
    `UPDATE customers
     SET subscription_status = $1,
         plan = $2,
         ls_subscription_id = COALESCE($3, ls_subscription_id),
         ls_customer_id = COALESCE($4, ls_customer_id)
     WHERE email = $5
     RETURNING id, email, subscription_status`,
    ['paid', plan, extraData.lsSubscriptionId || null, extraData.lsCustomerId || null, email.toLowerCase().trim()]
  );

  if (result.rows.length === 0) {
    // If doesn't exist, create it (fallback for external checkouts)
    const newId = crypto.randomUUID();
    await db.query(
      "INSERT INTO customers (id, email, plan, subscription_status) VALUES ($1, $2, $3, $4)",
      [newId, email.toLowerCase().trim(), plan, 'paid']
    );
    console.log(`✅ NEW customer created for ${email} (Plan: ${plan})`);
  }
}

// ─── POST /api/webhooks/lemonsqueezy ─────────────────────────
router.post('/lemonsqueezy', async (req, res) => {
  try {
    const signature = req.headers['x-signature'];
    const rawBody = req.rawBody;
    if (!verifySignature(rawBody, signature, process.env.LEMONSQUEEZY_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = JSON.parse(rawBody);
    const eventName = payload?.meta?.event_name;
    const attrs = payload?.data?.attributes;
    const email = attrs?.user_email || payload?.meta?.custom_data?.email;
    const variantId = attrs?.variant_id;
    const variantName = attrs?.variant_name || attrs?.product_name || '';

    if (eventName && eventName.startsWith('subscription_')) {
      const plan = getPlanFromVariant(variantId, variantName);
      if (plan) {
        await updateCustomerSubscription(email, plan, {
          lsSubscriptionId: payload?.data?.id,
          lsCustomerId: attrs?.customer_id
        });
        logWebhookReceived(eventName, email, plan).catch(() => {});
      }
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('LemonSqueezy error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// ─── POST /api/webhooks/razorpay ─────────────────────────────
router.post('/razorpay', async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.rawBody;

    if (!verifySignature(rawBody, signature, secret)) {
      console.warn('❌ Invalid Razorpay signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = JSON.parse(rawBody);
    if (payload.event === 'payment.captured' || payload.event === 'payment.authorized') {
      const payment = payload.payload.payment.entity;
      const email = (payment.email || payment.notes?.email || 'guest').toLowerCase().trim();
      const rawPlan = (payment.notes?.plan || 'pro').toLowerCase();
      const plan = KIRA_PLAN_MAP[rawPlan] || rawPlan;
      const name = payment.notes?.name || '';
      const company = payment.notes?.company || '';
      
      try {
        // Check if customer exists to determine if we should publish a "new lead" event
        const existCheck = await db.query("SELECT id FROM customers WHERE LOWER(email) = $1", [email]);
        const isNewCustomer = existCheck.rows.length === 0;

        const apiToken = 'sk_live_' + crypto.randomUUID();
        const customerId = isNewCustomer ? crypto.randomUUID() : existCheck.rows[0].id;

        // Upsert into Supabase/PostgreSQL
        const sql = `
          INSERT INTO customers (id, email, name, company_name, plan, subscription_status, api_token)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (email) DO UPDATE
          SET subscription_status = 'paid',
              plan = EXCLUDED.plan,
              name = COALESCE(NULLIF(EXCLUDED.name, ''), customers.name),
              company_name = COALESCE(NULLIF(EXCLUDED.company_name, ''), customers.company_name)
          RETURNING id
        `;
        const result = await db.query(sql, [customerId, email, name, company, plan, 'paid', apiToken]);
        const actualId = result.rows[0].id;

        if (isNewCustomer) {
          const newLeadData = {
            id: actualId,
            name: name || company || 'New Customer',
            email: email,
            status: 'NEW',
            plan: plan
          };
          redis.publish('new_leads', JSON.stringify(newLeadData));
          
          // Send high-intent alert via Resend
          await sendHighIntentLeadAlert(newLeadData);
          
          console.log(`✅ NEW Subscription Created via PG → ${email} (${name}): ${plan} [PAID]`);
        } else {
          console.log(`✅ Existing Subscription Updated via PG → ${email}: ${plan} [PAID]`);
        }

        console.log(`[Kira Webhook] 📦 Event: ${payload.event} | ${email} → ${plan}`);
        console.log(`✅ Kira Webhook successful for ${email}`);
        
        logWebhookReceived('razorpay_payment_success', email, plan).catch(() => {});
      } catch (dbErr) {
        console.error('❌ Database operation failed inside Razorpay Webhook:', dbErr);
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Razorpay webhook error:', err);
    res.status(500).json({ error: 'Processing failed' });
  }
});

module.exports = router;
