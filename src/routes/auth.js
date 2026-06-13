const express = require('express');
const router = express.Router();
const db = require('../db/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendSignupOtp } = require('../services/authEmailService');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-kira-secret-key';

// ── OTP Constants & Helpers ──────────────────────────────────────────
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_SENDS_PER_HOUR = 5;

function generateOtp() {
    // Cryptographically random 6-digit code
    return crypto.randomInt(100000, 1000000).toString();
}

function hashOtp(otp) {
    return crypto.createHash('sha256').update(otp).digest('hex');
}

function issueJwt(user) {
    return jwt.sign(
        { id: user.id, email: user.email, name: user.name },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
}

/**
 * Creates a new OTP for an email, applies basic anti-abuse limits,
 * invalidates older active OTPs (single in-flight at a time),
 * and emails the code via Resend.
 */
async function createAndSendOtp({ email, name, purpose, ip }) {
    // 1. Rate limit: max sends per hour per email
    const recentCount = await db.query(
        `SELECT COUNT(*)::int AS c FROM email_otps
           WHERE email = $1 AND purpose = $2 AND created_at > NOW() - INTERVAL '1 hour'`,
        [email, purpose]
    );
    if (recentCount.rows[0].c >= OTP_MAX_SENDS_PER_HOUR) {
        const err = new Error('Too many verification attempts. Please try again later.');
        err.status = 429;
        throw err;
    }

    // 2. Resend cooldown: must wait OTP_RESEND_COOLDOWN_SECONDS since the last send
    const lastSend = await db.query(
        `SELECT created_at FROM email_otps
           WHERE email = $1 AND purpose = $2
           ORDER BY created_at DESC LIMIT 1`,
        [email, purpose]
    );
    if (lastSend.rows.length > 0) {
        const ageMs = Date.now() - new Date(lastSend.rows[0].created_at).getTime();
        if (ageMs < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
            const waitS = Math.ceil((OTP_RESEND_COOLDOWN_SECONDS * 1000 - ageMs) / 1000);
            const err = new Error(`Please wait ${waitS}s before requesting another code.`);
            err.status = 429;
            throw err;
        }
    }

    // 3. Invalidate any existing unconsumed OTPs for this email+purpose
    await db.query(
        `UPDATE email_otps SET consumed_at = NOW()
           WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL`,
        [email, purpose]
    );

    // 4. Generate fresh OTP, store hashed
    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await db.query(
        `INSERT INTO email_otps (email, otp_hash, purpose, ip_address, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
        [email, otpHash, purpose, ip || null, expiresAt]
    );

    // 5. Deliver it.
    // Self-hosters without a RESEND_API_KEY: we skip email and print the code to
    // the server logs so signup still works out of the box (check `docker compose
    // logs app`). Configure RESEND_API_KEY to email codes to real users.
    if (!process.env.RESEND_API_KEY) {
        console.log('\n──────────────────────────────────────────────');
        console.log(`📧  Email not configured (no RESEND_API_KEY).`);
        console.log(`    Verification code for ${email}: ${otp}`);
        console.log(`    Enter this code in the dashboard to finish signing up.`);
        console.log('──────────────────────────────────────────────\n');
        return;
    }

    const sendResult = await sendSignupOtp({ email, name, otp });
    if (!sendResult.ok) {
        throw new Error(sendResult.error || 'Failed to send verification email');
    }
}

// ── Slug Generation Helper ───────────────────────────────────────────
/**
 * Generates a URL-safe slug from a company name.
 * e.g. "Acme Growth Labs" → "acme-growth-labs"
 * Deduplicates against existing slugs by appending -2, -3, etc.
 */
async function generateUniqueSlug(companyName) {
    let base = (companyName || 'business')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')   // strip non-alphanumeric
        .replace(/\s+/g, '-')            // spaces → hyphens
        .replace(/-+/g, '-')             // collapse multiple hyphens
        .replace(/^-|-$/g, '')           // trim leading/trailing hyphens
        .substring(0, 60);              // cap length

    if (!base) base = 'business';

    let slug = base;
    let suffix = 1;

    // Check for uniqueness
    while (true) {
        const check = await db.query('SELECT id FROM customers WHERE slug = $1', [slug]);
        if (check.rows.length === 0) break;
        suffix++;
        slug = `${base}-${suffix}`;
    }

    return slug;
}

// ════════════════════════════════════════════════════════════════════════
// POST /api/auth/signup
// Creates an UNVERIFIED user and sends an OTP to the provided email.
// The caller must call /api/auth/verify-otp with the code before logging in.
// No JWT is issued at this stage — same pattern as Stripe / Vercel / Clerk.
// ════════════════════════════════════════════════════════════════════════
router.post('/signup', async (req, res) => {
    try {
        const { name, email, password, companyName } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required.' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters.' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const ip = getClientIp(req);

        // Look up existing user
        const userCheck = await db.query(
            'SELECT id, email_verified FROM customers WHERE email = $1',
            [normalizedEmail]
        );

        if (userCheck.rows.length > 0) {
            const existing = userCheck.rows[0];
            // If the existing account is already verified, hard-block re-signup
            if (existing.email_verified) {
                return res.status(409).json({ error: 'Email already registered. Please log in.' });
            }
            // Unverified existing account → refresh credentials + resend OTP
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(password, salt);
            await db.query(
                `UPDATE customers SET name = $1, password_hash = $2, company_name = $3 WHERE id = $4`,
                [name, passwordHash, companyName || '', existing.id]
            );
            try {
                await createAndSendOtp({ email: normalizedEmail, name, purpose: 'signup', ip });
            } catch (err) {
                return res.status(err.status || 500).json({ error: err.message });
            }
            return res.status(200).json({
                message: 'Verification code sent. Check your email to finish signing up.',
                email_verification_required: true,
                email: normalizedEmail,
            });
        }

        // Brand-new user: create as UNVERIFIED, then send OTP
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const slug = await generateUniqueSlug(companyName);
        const customerId = crypto.randomUUID();
        const apiToken = 'sk_live_' + crypto.randomUUID();

        const sql = `
            INSERT INTO customers (
                id, name, email, company_name, password_hash,
                subscription_tier, plan, subscription_status, api_token, slug,
                email_verified
            )
            VALUES ($1, $2, $3, $4, $5, 'free', 'free', 'inactive', $6, $7, false)
            RETURNING id, name, email, company_name, slug
        `;
        await db.query(sql, [
            customerId, name, normalizedEmail, companyName || '',
            passwordHash, apiToken, slug
        ]);

        try {
            await createAndSendOtp({ email: normalizedEmail, name, purpose: 'signup', ip });
        } catch (err) {
            // Roll back the unverified user so they can retry later without "email exists" errors
            await db.query('DELETE FROM customers WHERE id = $1 AND email_verified = false', [customerId]);
            return res.status(err.status || 500).json({ error: err.message });
        }

        return res.status(201).json({
            message: 'Verification code sent. Check your email to finish signing up.',
            email_verification_required: true,
            email: normalizedEmail,
        });
    } catch (err) {
        console.error('[Signup] ❌ Error:', err.message);
        res.status(500).json({ error: 'Internal server error during signup' });
    }
});

// ════════════════════════════════════════════════════════════════════════
// POST /api/auth/verify-otp
// Verifies a signup OTP. On success, marks the customer as verified,
// consumes the OTP, and issues the JWT (the actual "login").
// ════════════════════════════════════════════════════════════════════════
router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ error: 'Email and verification code are required.' });
        }
        if (!/^\d{6}$/.test(String(otp))) {
            return res.status(400).json({ error: 'Verification code must be 6 digits.' });
        }

        const normalizedEmail = email.toLowerCase().trim();

        const otpRow = await db.query(
            `SELECT id, otp_hash, attempts, expires_at, consumed_at
               FROM email_otps
              WHERE email = $1 AND purpose = 'signup'
              ORDER BY created_at DESC LIMIT 1`,
            [normalizedEmail]
        );

        if (otpRow.rows.length === 0) {
            return res.status(400).json({ error: 'No verification code found. Please request a new one.' });
        }

        const record = otpRow.rows[0];

        if (record.consumed_at) {
            return res.status(400).json({ error: 'This code has already been used. Please request a new one.' });
        }
        if (new Date(record.expires_at) < new Date()) {
            return res.status(400).json({ error: 'This code has expired. Please request a new one.' });
        }
        if (record.attempts >= OTP_MAX_ATTEMPTS) {
            // Invalidate the OTP after too many attempts
            await db.query('UPDATE email_otps SET consumed_at = NOW() WHERE id = $1', [record.id]);
            return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new code.' });
        }

        const submittedHash = hashOtp(String(otp));
        if (submittedHash !== record.otp_hash) {
            await db.query('UPDATE email_otps SET attempts = attempts + 1 WHERE id = $1', [record.id]);
            const remaining = OTP_MAX_ATTEMPTS - (record.attempts + 1);
            return res.status(400).json({
                error: remaining > 0
                    ? `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
                    : 'Invalid code.',
            });
        }

        // ✅ OTP is valid — consume it and mark the user verified
        await db.query('UPDATE email_otps SET consumed_at = NOW() WHERE id = $1', [record.id]);
        const updated = await db.query(
            `UPDATE customers
                SET email_verified = true, email_verified_at = NOW()
              WHERE email = $1
              RETURNING id, name, email, company_name, api_token, slug, plan`,
            [normalizedEmail]
        );

        if (updated.rows.length === 0) {
            return res.status(404).json({ error: 'Account not found. Please sign up again.' });
        }

        const user = updated.rows[0];
        const token = issueJwt(user);

        return res.status(200).json({
            message: 'Email verified successfully',
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                companyName: user.company_name,
                slug: user.slug,
                apiToken: user.api_token,
            },
        });
    } catch (err) {
        console.error('[VerifyOTP] ❌ Error:', err.message);
        res.status(500).json({ error: 'Internal server error during verification' });
    }
});

// ════════════════════════════════════════════════════════════════════════
// POST /api/auth/resend-otp
// Sends a fresh OTP for a pending signup. Rate-limited.
// ════════════════════════════════════════════════════════════════════════
router.post('/resend-otp', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required.' });

        const normalizedEmail = email.toLowerCase().trim();
        const ip = getClientIp(req);

        const userRow = await db.query(
            'SELECT name, email_verified FROM customers WHERE email = $1',
            [normalizedEmail]
        );

        // Don't leak whether the email exists — but if it does, only resend for unverified accounts
        if (userRow.rows.length === 0 || userRow.rows[0].email_verified) {
            return res.status(200).json({ message: 'If an unverified account exists, a new code has been sent.' });
        }

        try {
            await createAndSendOtp({
                email: normalizedEmail,
                name: userRow.rows[0].name,
                purpose: 'signup',
                ip,
            });
        } catch (err) {
            return res.status(err.status || 500).json({ error: err.message });
        }

        return res.status(200).json({ message: 'A new verification code has been sent.' });
    } catch (err) {
        console.error('[ResendOTP] ❌ Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ════════════════════════════════════════════════════════════════════════
// POST /api/auth/login
// Authenticates returning users and returns a JWT
// ════════════════════════════════════════════════════════════════════════
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const ip = getClientIp(req);

        // Find user
        const result = await db.query(
            `SELECT id, name, email, company_name, password_hash, email_verified
               FROM customers WHERE email = $1`,
            [normalizedEmail]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        if (!user.password_hash) {
            return res.status(401).json({ error: 'Account requires password reset. Please contact support.' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // 🔒 Gate unverified accounts behind OTP — same pattern as Stripe/Vercel/Clerk
        if (!user.email_verified) {
            try {
                await createAndSendOtp({
                    email: normalizedEmail,
                    name: user.name,
                    purpose: 'signup',
                    ip,
                });
            } catch (err) {
                // If we hit the cooldown, that's fine — an OTP is already in flight
                if (err.status !== 429) {
                    return res.status(500).json({ error: err.message });
                }
            }
            return res.status(403).json({
                error: 'Please verify your email to continue.',
                email_verification_required: true,
                email: normalizedEmail,
            });
        }

        const token = issueJwt(user);

        res.status(200).json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                companyName: user.company_name
            }
        });
    } catch (err) {
        console.error('[Login] ❌ Error:', err.message);
        res.status(500).json({ error: 'Internal server error during login' });
    }
});

// ════════════════════════════════════════════════════════════════════════
// POST /api/auth/google-provision
// Auto-creates a customer record for Google OAuth users (from Firebase).
// Called by the dashboard when a Google user has no customer record.
// ════════════════════════════════════════════════════════════════════════
router.post('/google-provision', async (req, res) => {
    try {
        const { name, email, avatar } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required.' });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Check if user already exists
        const existing = await db.query(
            'SELECT id, api_token, slug, onboarding_completed, plan, company_name FROM customers WHERE email = $1',
            [normalizedEmail]
        );

        if (existing.rows.length > 0) {
            // Already exists — return the existing record
            const c = existing.rows[0];
            console.log(`[Auth] Existing Google user: ${normalizedEmail}, onboarding_completed=${c.onboarding_completed}`);
            return res.json({
                exists: true,
                customer: {
                    id: c.id,
                    api_token: c.api_token,
                    slug: c.slug,
                    onboarding_completed: c.onboarding_completed,
                    plan: c.plan,
                    company_name: c.company_name,
                }
            });
        }

        // Create new customer record for this Google user
        const slug = await generateUniqueSlug(name || 'user');
        const customerId = crypto.randomUUID();
        const apiToken = 'sk_live_' + crypto.randomUUID();

        const sql = `
            INSERT INTO customers (
                id, name, email, company_name,
                subscription_tier, plan, subscription_status,
                api_token, slug, onboarding_completed,
                email_verified, email_verified_at
            )
            VALUES ($1, $2, $3, $4, 'free', 'free', 'inactive', $5, $6, false, true, NOW())
            RETURNING id, api_token, slug, onboarding_completed, plan, company_name
        `;
        const result = await db.query(sql, [customerId, name || 'User', normalizedEmail, '', apiToken, slug]);
        const newCustomer = result.rows[0];

        console.log(`[Auth] ✅ Auto-provisioned Google user: ${normalizedEmail} → ${slug}`);

        res.status(201).json({
            exists: false,
            customer: {
                id: newCustomer.id,
                api_token: newCustomer.api_token,
                slug: newCustomer.slug,
                onboarding_completed: false,
                plan: 'free',
                company_name: newCustomer.company_name,
            }
        });
    } catch (err) {
        console.error('[Auth] ❌ Google provision error:', err.message);
        res.status(500).json({ error: 'Failed to provision Google user' });
    }
});

module.exports = router;
