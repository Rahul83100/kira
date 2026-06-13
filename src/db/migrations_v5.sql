-- migrations_v5.sql
-- Ingestion API Storage Limits & Character Tracking
-- Sprint: April 19, 2026 — Prajeet (Ingestion API — Storage Limits)

-- ──────────────────────────────────────────────
-- 1. Storage tracking columns on customers table
-- ──────────────────────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS storage_chars_used BIGINT DEFAULT 0;

-- ──────────────────────────────────────────────
-- 2. Character count on documents table
-- ──────────────────────────────────────────────
ALTER TABLE documents ADD COLUMN IF NOT EXISTS char_count INT DEFAULT 0;

-- ──────────────────────────────────────────────
-- 3. Initialize counts for existing documents
-- ──────────────────────────────────────────────
-- NOTE: We initialize to 0. Existing documents won't have counts unless we
-- re-scan their chunks. For now, we only track from this point forward.

UPDATE customers SET storage_chars_used = 0 WHERE storage_chars_used IS NULL;
UPDATE documents SET char_count = 0 WHERE char_count IS NULL;
