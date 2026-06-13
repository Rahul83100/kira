const { Resend } = require('resend');

// Initialize Resend with the API key from environment
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Send an email alert when a high intent lead is captured.
 *
 * @param {Object} leadData - The extracted lead information
 * @param {Object} customerData - Information about the tenant/customer
 */
async function sendHighIntentAlert(leadData, customerData) {
  if (!resend) {
    console.log('⚠️ ResendService: RESEND_API_KEY missing. Skipping high-intent alert email.');
    console.log('⚠️ Mock Email Payload:', JSON.stringify({ leadData, customerData }, null, 2));
    return;
  }

  const { name, email, phone, courseInterest, serviceInterest } = leadData;
  const companyName = customerData?.company_name || 'Your Business';
  const notificationEmail = customerData?.email || 'admin@example.com';

  try {
    const { data, error } = await resend.emails.send({
      from: 'Sandra Chat <alerts@supportgenie.com>', // MUST be verified domain on Resend
      to: [notificationEmail],
      subject: `🚨 High Intent Lead Captured for ${companyName}!`,
      html: `
        <h2>New High Intent Lead</h2>
        <p>Your AI support assistant just captured a high-intent lead.</p>
        <ul>
          <li><strong>Name:</strong> ${name || 'Not provided'}</li>
          <li><strong>Phone:</strong> ${phone || 'Not provided'}</li>
          <li><strong>Email:</strong> ${email || 'Not provided'}</li>
          <li><strong>Business Interest:</strong> ${serviceInterest || courseInterest || 'Not specified'}</li>
        </ul>
        <p>Log in to your SupportGenie dashboard to view the full conversation history.</p>
      `
    });

    if (error) {
      console.error('❌ ResendService: Error sending email:', error);
      return;
    }

    console.log('✅ ResendService: High-intent alert email sent successfully.', data);
  } catch (err) {
    console.error('❌ ResendService: Exception thrown while sending email:', err.message);
  }
}

module.exports = { sendHighIntentAlert };
