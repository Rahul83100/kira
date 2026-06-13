-- ════════════════════════════════════════════════════════════════════════════
-- Kira — Self-Hosted Database Schema (consolidated, vanilla PostgreSQL)
-- ════════════════════════════════════════════════════════════════════════════
--
-- This is the single source of truth for self-hosting Kira on a plain
-- PostgreSQL 16 instance with the pgvector extension (see docker-compose.yml).
--
-- It is a consolidation of all historical migrations into one idempotent file
-- and, unlike the Supabase variant, does NOT depend on the `auth.*` schema or
-- `auth.uid()` Row-Level-Security helpers — so it applies cleanly to any
-- standard Postgres. When self-hosting, the application connects via
-- DATABASE_URL as the table owner, so per-tenant RLS is unnecessary.
--
-- Docker runs this automatically on first boot (mounted into
-- /docker-entrypoint-initdb.d). To apply it manually:
--   psql "$DATABASE_URL" -f db/schema.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector: semantic search
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ── 1. Customers (one row per tenant / business using Kira) ──────────────────
CREATE TABLE IF NOT EXISTS customers (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id            UUID,
  email                   TEXT UNIQUE NOT NULL,
  api_token               TEXT UNIQUE NOT NULL DEFAULT 'sk_live_' || gen_random_uuid()::text,
  name                    TEXT,
  company_name            TEXT,

  -- Plan / billing (billing enforcement is a no-op without payment keys)
  plan                    VARCHAR(20) DEFAULT 'free_trial',
  subscription_tier       TEXT DEFAULT 'free',
  subscription_status     TEXT DEFAULT 'active',
  status                  TEXT DEFAULT 'active',
  credit_balance          INTEGER DEFAULT 100000,
  queries_this_month      INTEGER DEFAULT 0,
  storage_chars_used      BIGINT DEFAULT 0,
  trial_ends_at           TIMESTAMP,
  trial_started_at        TIMESTAMP,
  trial_messages_used     INTEGER DEFAULT 0,
  trial_messages_limit    INTEGER DEFAULT 100,
  trial_duration_days     INTEGER DEFAULT 7,
  billing_cycle_end       TIMESTAMP,

  -- Payment provider references (optional — only used if you wire up billing)
  razorpay_customer_id    TEXT,
  razorpay_subscription_id TEXT,
  ls_subscription_id      TEXT,
  ls_customer_id          TEXT,

  -- Public chat page / widget branding
  slug                    TEXT UNIQUE,
  kb_id                   UUID DEFAULT gen_random_uuid(),
  branding_logo           TEXT,
  branding_color          TEXT DEFAULT '#4A90E2',
  brand_color             TEXT DEFAULT '#00ffd5',
  accent_color            TEXT DEFAULT '#00e5ff',
  logo_url                TEXT,
  standalone_logo_data    TEXT,
  standalone_logo_mime    TEXT,
  widget_logo_data        TEXT,
  widget_logo_mime        TEXT,
  widget_name             TEXT DEFAULT 'Kira',
  widget_welcome          TEXT DEFAULT 'Hi! How can I help you today?',
  welcome_message         TEXT,
  agent_name              TEXT,
  standalone_agent_name   TEXT,
  agent_tone              TEXT DEFAULT 'friendly',
  agent_instructions      TEXT,
  custom_prompt           TEXT,
  website_screenshot_url  TEXT,

  -- Business contact details surfaced in chat
  business_phone          TEXT,
  business_email          TEXT,

  -- Access control for the widget / chat API
  allowed_domains         TEXT[],

  -- Auth / onboarding
  email_verified          BOOLEAN DEFAULT false,
  email_verified_at       TIMESTAMP,
  onboarding_completed    BOOLEAN DEFAULT false,
  onboarding_step         INTEGER DEFAULT 0,
  onboarding_goal         TEXT,

  password_hash           TEXT,

  created_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_plan ON customers(plan);
CREATE INDEX IF NOT EXISTS idx_customers_slug ON customers(slug);

-- ── 2. Documents (knowledge-base sources: pdf / url / text / youtube / crawl) ─
CREATE TABLE IF NOT EXISTS documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID REFERENCES customers(id) ON DELETE CASCADE,
  filename      TEXT,
  source_url    TEXT,
  source_type   TEXT CHECK (source_type IN ('pdf', 'url', 'text', 'youtube', 'crawl')),
  status        TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'ready', 'error')),
  job_id        TEXT,
  error_message TEXT,
  chunk_count   INT DEFAULT 0,
  char_count    INT DEFAULT 0,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- ── 3. Chunks (text + 768-dim Gemini embeddings via text-embedding-004) ──────
CREATE TABLE IF NOT EXISTS chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  embedding   VECTOR(768),
  chunk_index INT,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

-- Vector similarity search helper used by the chat API
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(768),
  match_customer_id uuid,
  match_count int DEFAULT 5
)
RETURNS TABLE(content text, chunk_index int, distance float)
LANGUAGE sql STABLE AS $$
  SELECT content, chunk_index, (embedding <=> query_embedding) AS distance
  FROM chunks
  WHERE customer_id = match_customer_id
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ── 4. Query usage (monthly credit metering per tenant) ──────────────────────
CREATE TABLE IF NOT EXISTS query_usage (
  id          SERIAL PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  month       VARCHAR(7) NOT NULL,           -- e.g. "2026-04"
  count       INTEGER DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(customer_id, month)
);

CREATE INDEX IF NOT EXISTS idx_query_usage_customer ON query_usage(customer_id);
CREATE INDEX IF NOT EXISTS idx_query_usage_month    ON query_usage(month);

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

-- ── 5. Leads (captured by the widget / chat agent) ───────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id             UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  email                   TEXT,
  phone                   TEXT,
  course_interest         TEXT,
  source                  TEXT DEFAULT 'widget',
  medium                  TEXT,
  campaign_id             TEXT,
  outbound_lead_id        INTEGER,
  conversation_session_id TEXT,
  status                  TEXT DEFAULT 'new',
  created_at              TIMESTAMP DEFAULT NOW(),
  updated_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_customer ON leads(customer_id);
CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(status);

-- ── 6. Email OTPs (signup verification, optional — needs RESEND_API_KEY) ─────
CREATE TABLE IF NOT EXISTS email_otps (
  id          SERIAL PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  otp_hash    VARCHAR(255) NOT NULL,
  purpose     VARCHAR(32)  NOT NULL DEFAULT 'signup',
  attempts    INTEGER      NOT NULL DEFAULT 0,
  ip_address  VARCHAR(64),
  expires_at  TIMESTAMP    NOT NULL,
  consumed_at TIMESTAMP,
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_otps_lookup  ON email_otps(email, purpose);
CREATE INDEX IF NOT EXISTS idx_email_otps_expires ON email_otps(expires_at);

-- ── 7. Payment history (optional — only populated if you wire up payments) ───
CREATE TABLE IF NOT EXISTS payment_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID REFERENCES customers(id) ON DELETE CASCADE,
  razorpay_payment_id TEXT,
  razorpay_order_id   TEXT,
  razorpay_signature  TEXT,
  amount_paise        INT,
  currency            TEXT DEFAULT 'INR',
  plan_name           TEXT,
  payment_status      TEXT DEFAULT 'captured',
  payment_method      TEXT,
  receipt             TEXT,
  email               TEXT,
  name                TEXT,
  company             TEXT,
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_history_customer ON payment_history(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_history_email    ON payment_history(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_history_rzp_id
  ON payment_history(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
