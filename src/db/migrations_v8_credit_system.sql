-- ============================================================
-- SupportGenie — Migration V8: Credit System
-- Sprint: April 19, 2026 — Sandra (Launch Readiness)
-- ============================================================
--
-- PURPOSE:
-- Creates the `query_usage` table for tracking monthly credit
-- consumption per customer (tenant), and adds credit/plan
-- tracking columns to the `customers` table.
--
-- WHY THESE TABLES:
-- The credit system gates how many AI queries each customer
-- can make per month based on their plan. Without this:
--   - Free trial users could exhaust unlimited Gemini tokens
--   - Billing would be impossible to enforce
--   - We would go bankrupt (P0 reason for this migration)
--
-- TABLES / CHANGES:
--   query_usage          — Monthly credit usage per customer
--   customers (ALTER)    — Adds credit_balance, plan, trial_ends_at,
--                          storage_chars_used
-- ============================================================

-- ── 1. query_usage table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS query_usage (
  id          SERIAL PRIMARY KEY,
  customer_id UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  month       VARCHAR(7)  NOT NULL,        -- e.g. "2026-04"
  count       INTEGER     DEFAULT 0,
  created_at  TIMESTAMP   DEFAULT NOW(),
  updated_at  TIMESTAMP   DEFAULT NOW(),
  UNIQUE(customer_id, month)
);

-- Auto-update updated_at on every write
CREATE OR REPLACE FUNCTION update_query_usage_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_query_usage_updated_at ON query_usage;
CREATE TRIGGER trg_query_usage_updated_at
  BEFORE UPDATE ON query_usage
  FOR EACH ROW EXECUTE FUNCTION update_query_usage_updated_at();

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_query_usage_customer ON query_usage(customer_id);
CREATE INDEX IF NOT EXISTS idx_query_usage_month    ON query_usage(month);

-- RLS — customers can only see their own usage rows
ALTER TABLE query_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers can view own usage" ON query_usage;
CREATE POLICY "Customers can view own usage"
  ON query_usage FOR SELECT USING (
    customer_id IN (
      SELECT id FROM customers WHERE auth_user_id = auth.uid()
    )
  );

-- ── 2. customers table — add credit & plan tracking columns ──
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_balance      INTEGER   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan                VARCHAR(20) DEFAULT 'free_trial',
  ADD COLUMN IF NOT EXISTS trial_ends_at       TIMESTAMP,
  ADD COLUMN IF NOT EXISTS storage_chars_used  BIGINT    DEFAULT 0;

-- Index for plan-based queries (e.g. find all growth plan customers)
CREATE INDEX IF NOT EXISTS idx_customers_plan ON customers(plan);

-- ── 3. Seed existing customers with a default plan if null ───
UPDATE customers
  SET plan = 'free_trial'
  WHERE plan IS NULL;

-- ============================================================
-- ROLLBACK (run manually if needed):
--   DROP TABLE IF EXISTS query_usage;
--   ALTER TABLE customers
--     DROP COLUMN IF EXISTS credit_balance,
--     DROP COLUMN IF EXISTS plan,
--     DROP COLUMN IF EXISTS trial_ends_at,
--     DROP COLUMN IF EXISTS storage_chars_used;
-- ============================================================
