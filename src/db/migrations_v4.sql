-- migrations_v4.sql
-- HNSW Index for pgvector
-- Improves vector cosine distance lookup speed for large chunk datasets

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx 
ON chunks USING hnsw (embedding vector_cosine_ops);

-- ============================================================
-- SupportGenie — Migration V4: Billing Schema & Payment History
-- Sprint: April 8, 2026 — Dhanush (Founder)
-- Run: Execute this SQL in Supabase SQL Editor
-- ============================================================
--
-- PURPOSE:
-- Adds production billing columns required for Razorpay payment
-- gateway integration and SaaS subscription management.
--
-- CHANGES:
-- 1. Adds subscription_tier (canonical Kira tier)
-- 2. Adds queries_this_month (usage-based metering)
-- 3. Adds billing_cycle_end (subscription expiry tracking)
-- 4. Adds razorpay_customer_id (links to Razorpay for recurring)
-- 5. Creates payment_history table (full transaction audit trail)
-- ============================================================

-- ──────────────────────────────────────────────
-- 1. Billing columns on customers table
-- ──────────────────────────────────────────────

-- Canonical subscription tier: 'free', 'starter', 'growth', 'pro'
ALTER TABLE customers ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free';

-- Monthly query counter for usage-based billing & rate limiting
ALTER TABLE customers ADD COLUMN IF NOT EXISTS queries_this_month INT DEFAULT 0;

-- When the current billing cycle expires (set by webhook on payment success)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_cycle_end TIMESTAMP;

-- Razorpay customer ID for recurring billing & refund lookups
ALTER TABLE customers ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT;

-- Razorpay subscription ID (if using Razorpay Subscriptions API)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT;

-- ──────────────────────────────────────────────
-- 2. Payment History Table (Full Audit Trail)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  razorpay_payment_id TEXT NOT NULL,
  razorpay_order_id TEXT,
  razorpay_signature TEXT,
  amount_paise INT NOT NULL,            -- Amount in paise (e.g., 59900 = ₹599)
  currency TEXT DEFAULT 'INR',
  plan_name TEXT NOT NULL,              -- Plan purchased: starter/growth/pro
  payment_status TEXT DEFAULT 'captured', -- captured / authorized / failed / refunded
  payment_method TEXT,                  -- card / upi / netbanking / wallet
  receipt TEXT,                         -- Razorpay receipt ID
  email TEXT NOT NULL,
  name TEXT,
  company TEXT,
  metadata JSONB DEFAULT '{}',          -- Extra data from Razorpay payload
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for quick lookups by customer
CREATE INDEX IF NOT EXISTS idx_payment_history_customer ON payment_history(customer_id);

-- Index for quick lookups by email (before customer mapping)
CREATE INDEX IF NOT EXISTS idx_payment_history_email ON payment_history(email);

-- Index for Razorpay payment ID lookups (idempotency checks)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_history_rzp_id ON payment_history(razorpay_payment_id);

-- RLS for payment_history
ALTER TABLE payment_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own payment history" ON payment_history;
CREATE POLICY "Users can view own payment history"
  ON payment_history FOR SELECT USING (
    customer_id IN (
      SELECT id FROM customers WHERE auth_user_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────
-- 3. Helper: Monthly Usage Reset Function
-- ──────────────────────────────────────────────
-- Call this via a Supabase CRON or external scheduler on the 1st of each month
CREATE OR REPLACE FUNCTION reset_monthly_usage()
RETURNS void AS $$
BEGIN
  UPDATE customers SET queries_this_month = 0
  WHERE billing_cycle_end IS NULL OR billing_cycle_end > NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
