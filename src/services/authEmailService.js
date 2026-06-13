/**
 * SupportGenie — Auth Email Service (Resend)
 *
 * Sends transactional auth emails (signup OTP, etc.) via Resend.
 * Set AUTH_EMAIL_FROM to a sender on your own verified domain in production.
 * The default uses Resend's onboarding sandbox sender, which works without
 * domain verification (it only delivers to your own Resend account email).
 */

const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.AUTH_EMAIL_FROM || 'Kira <onboarding@resend.dev>';
const APP_NAME = 'Kira';

function buildOtpHtml({ name, otp }) {
  const safeName = (name || 'there').toString().replace(/[<>"']/g, '');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Verify your email</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#0f172a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:480px;background:#1e293b;border-radius:16px;border:1px solid rgba(0,255,213,0.15);overflow:hidden;">
          <tr>
            <td style="padding:36px 36px 24px;text-align:center;">
              <div style="font-size:24px;font-weight:800;color:#00ffd5;letter-spacing:1px;">${APP_NAME}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 36px 8px;">
              <h1 style="margin:0 0 12px;font-size:22px;color:#fff;font-weight:700;">Verify your email</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;line-height:1.6;">
                Hi ${safeName}, thanks for signing up. Enter this code to finish creating your account:
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 36px 24px;">
              <div style="background:rgba(0,255,213,0.08);border:1px solid rgba(0,255,213,0.2);border-radius:12px;padding:24px;text-align:center;">
                <div style="font-family:'Courier New',monospace;font-size:36px;font-weight:800;color:#00ffd5;letter-spacing:10px;">${otp}</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 36px 36px;">
              <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;">
                This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 36px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
              <p style="margin:0;font-size:12px;color:#475569;">
                &copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildOtpText({ name, otp }) {
  return `Hi ${name || 'there'},

Your ${APP_NAME} verification code is: ${otp}

This code expires in 10 minutes.

If you didn't request this, you can safely ignore this email.

— ${APP_NAME}`;
}

/**
 * Send a signup verification OTP.
 * Returns { ok: true } on success, { ok: false, error } otherwise.
 */
async function sendSignupOtp({ email, name, otp }) {
  if (!resend) {
    console.warn('[AuthEmail] RESEND_API_KEY missing — printing OTP to logs (DEV ONLY)');
    console.warn(`[AuthEmail] OTP for ${email}: ${otp}`);
    return { ok: true, dev: true };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `Your ${APP_NAME} verification code: ${otp}`,
      html: buildOtpHtml({ name, otp }),
      text: buildOtpText({ name, otp }),
    });

    if (error) {
      console.error('[AuthEmail] Resend error:', error);
      return { ok: false, error: error.message || 'Email send failed' };
    }

    console.log(`[AuthEmail] ✅ OTP sent to ${email} (id: ${data?.id})`);
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error('[AuthEmail] Send failed:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  sendSignupOtp,
};
