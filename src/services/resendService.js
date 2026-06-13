/**
 * SupportGenie — Resend Email Service (Ingestion API)
 *
 * Sends high-intent lead alert emails via Resend.com when a new lead
 * is captured through the chatbot widget, QR code, or Telegram channel.
 *
 * HOW IT WORKS:
 * ─────────────
 * 1. When a lead is captured (webhooks.js or leads.js), this function is called.
 * 2. It checks if RESEND_API_KEY is configured.
 *    - If YES → sends an HTML email to the customer's registered email.
 *    - If NO  → logs a mock payload to console (graceful degradation).
 * 3. The email includes lead details: name, phone, email, and business interest.
 *
 * WHY GRACEFUL DEGRADATION:
 * ─────────────────────────
 * During development, most devs won't have a Resend API key. If we threw
 * an error here, every webhook and lead creation would fail. Instead, we
 * log the payload so devs can see what WOULD be sent.
 */

const { Resend } = require('resend');

// Lazy-init: only create the client if the API key exists
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

/**
 * Send a high-intent lead alert email.
 *
 * This is the primary export — called by:
 *   - src/routes/webhooks.js  (on Razorpay payment.captured → new customer)
 *   - src/routes/leads.js     (on POST /api/leads → manual lead creation)
 *
 * @param {Object} leadData - Lead information
 * @param {string} leadData.name - Lead's name
 * @param {string} leadData.email - Lead's email
 * @param {string} leadData.phone - Lead's phone number
 * @param {string} leadData.course_interest - Legacy interest field (service interest)
 * @param {string} leadData.service_interest - Optional normalized interest field
 * @param {string} leadData.company - Company name (optional)
 * @param {string} leadData.plan - Subscription plan (optional)
 */
async function sendHighIntentLeadAlert(leadData) {
  if (!resend) {
    console.log('⚠️ ResendService: RESEND_API_KEY not set. Skipping email alert.');
    console.log('⚠️ Mock Email Payload:', JSON.stringify(leadData, null, 2));
    return;
  }

  const {
    name,
    email,
    phone,
    course_interest,
    service_interest,
    company,
    plan,
  } = leadData || {};

  // Determine the recipient — use the lead's associated customer email,
  // or fall back to a default admin address
  const recipientEmail = leadData.customerEmail || leadData.email || process.env.ALERT_EMAIL_TO || 'admin@example.com';

  try {
    const { data, error } = await resend.emails.send({
      from: process.env.ALERT_EMAIL_FROM || 'Kira Alerts <onboarding@resend.dev>',
      to: [recipientEmail],
      subject: `🚨 New High-Intent Lead: ${name || 'Unknown'}`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 24px; border-radius: 12px 12px 0 0;">
            <h2 style="color: white; margin: 0;">🔥 New High-Intent Lead Captured</h2>
            <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0;">Your AI assistant just identified a potential customer.</p>
          </div>
          <div style="background: #f8f9fa; padding: 24px; border: 1px solid #e9ecef; border-top: none; border-radius: 0 0 12px 12px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px 0; color: #6c757d; width: 140px;">Name</td><td style="padding: 8px 0; font-weight: 600;">${name || 'Not provided'}</td></tr>
              <tr><td style="padding: 8px 0; color: #6c757d;">Phone</td><td style="padding: 8px 0; font-weight: 600;">${phone || 'Not provided'}</td></tr>
              <tr><td style="padding: 8px 0; color: #6c757d;">Email</td><td style="padding: 8px 0; font-weight: 600;">${email || 'Not provided'}</td></tr>
              <tr><td style="padding: 8px 0; color: #6c757d;">Interest</td><td style="padding: 8px 0; font-weight: 600;">${service_interest || course_interest || 'General inquiry'}</td></tr>
              ${company ? `<tr><td style="padding: 8px 0; color: #6c757d;">Company</td><td style="padding: 8px 0; font-weight: 600;">${company}</td></tr>` : ''}
              ${plan ? `<tr><td style="padding: 8px 0; color: #6c757d;">Plan</td><td style="padding: 8px 0; font-weight: 600;">${plan}</td></tr>` : ''}
            </table>
            <hr style="border: none; border-top: 1px solid #dee2e6; margin: 16px 0;">
            <p style="color: #6c757d; font-size: 13px; margin: 0;">
              Log in to your <a href="${process.env.PUBLIC_BASE_URL || 'http://localhost:5173'}" style="color: #667eea;">Kira Dashboard</a> to view the full conversation history.
            </p>
          </div>
        </div>
      `,
    });

    if (error) {
      console.error('❌ ResendService: Email send error:', error);
      return;
    }

    console.log('✅ ResendService: Lead alert sent successfully. ID:', data?.id);
  } catch (err) {
    console.error('❌ ResendService: Exception:', err.message);
  }
}

module.exports = { sendHighIntentLeadAlert };
