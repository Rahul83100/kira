-- ============================================================
-- SupportGenie — Database Migration
-- Run: psql -d supportgenie -f src/db/migrations.sql
-- ============================================================

-- Enable pgvector extension (requires superuser or pre-installed)
CREATE EXTENSION IF NOT EXISTS vector;

-- ──────────────────────────────────────────────
-- Customers table
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  api_token TEXT UNIQUE NOT NULL DEFAULT 'sk_live_' || gen_random_uuid()::text,
  company_name TEXT,
  plan TEXT DEFAULT 'free',
  subscription_status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- Documents table (metadata only)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  filename TEXT,
  source_url TEXT,
  source_type TEXT CHECK (source_type IN ('pdf', 'url', 'text')),
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'error')),
  chunk_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- Chunks table (text + vector embedding)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding VECTOR(768), -- Switched to Gemini 768-dim
  chunk_index INT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast cosine‑similarity search
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

-- ──────────────────────────────────────────────
-- Seed a test customer for local development
-- ──────────────────────────────────────────────
INSERT INTO customers (email, company_name, api_token)
VALUES ('test@cyclecorp.in', 'Cycle Corp', 'sk_live_test_token_123')
ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────
-- Query usage table (for Sandra's rate limiter)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS query_usage (
  customer_id UUID REFERENCES customers(id),
  month TEXT NOT NULL,
  count INT DEFAULT 0,
  PRIMARY KEY (customer_id, month)
);

-- ──────────────────────────────────────────────
-- Leads table (captured from Kira Widget)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL,
  course_interest TEXT,
  source TEXT DEFAULT 'widget',
  medium TEXT,
  campaign_id TEXT,
  outbound_lead_id INTEGER,
  conversation_session_id TEXT,
  status TEXT DEFAULT 'new',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_customer ON leads(customer_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
