-- ============================================================
-- SupportGenie — Migration V3: Google GenAI Embedding Dimension
-- Run: psql -d supportgenie -f src/db/migrations_v3.sql
-- ============================================================
--
-- WHY THIS MIGRATION:
-- We switched from OpenAI text-embedding-3-small (1536 dims) to
-- Google text-embedding-004 (768 dims). The pgvector column must
-- match the actual vector size, otherwise INSERT will fail with:
--   "expected 1536 dimensions, not 768"
--
-- WHAT IT DOES:
-- 1. Drops the old IVFFlat index (it's dimension-specific)
-- 2. Deletes ALL existing chunks (old 1536-dim vectors are
--    incompatible with new 768-dim ones — they can't be mixed
--    or compared meaningfully)
-- 3. Alters the column from vector(1536) to vector(768)
-- 4. Rebuilds the similarity search index
--
-- WARNING: This deletes all existing chunk data. You will need
-- to re-ingest all documents after running this migration.
-- ============================================================

-- 1. Drop the old dimension-specific index
DROP INDEX IF EXISTS chunks_embedding_idx;

-- 2. Remove incompatible old embeddings
DELETE FROM chunks;

-- 3. Change the vector column dimension
ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(768);

-- 4. Rebuild the cosine similarity index for the new dimension
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================================
-- SupportGenie — Migration V3b: LemonSqueezy Subscription Columns
-- Run: psql -d supportgenie -f src/db/migrations_v3.sql
-- ============================================================

-- 1. Add subscription status tracking
ALTER TABLE customers ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'free';

-- 2. LemonSqueezy integration columns
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ls_subscription_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ls_customer_id TEXT;

-- 3. Update allowed_domains to have a default
-- (No change needed if column already exists)
