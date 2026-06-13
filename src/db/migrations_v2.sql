-- ============================================================
-- SupportGenie — Migration V2: Async Queue + New Source Types
-- Run: psql -d supportgenie -f src/db/migrations_v2.sql
-- ============================================================

-- 1. Allow new source types: 'youtube' and 'crawl'
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_source_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_source_type_check
  CHECK (source_type IN ('pdf', 'url', 'text', 'youtube', 'crawl'));

-- 2. Track BullMQ job ID for status polling
ALTER TABLE documents ADD COLUMN IF NOT EXISTS job_id TEXT;

-- 3. Store error details for failed jobs
ALTER TABLE documents ADD COLUMN IF NOT EXISTS error_message TEXT;

-- 4. Allow 'queued' and 'failed' as document statuses
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE documents ADD CONSTRAINT documents_status_check
  CHECK (status IN ('queued', 'processing', 'ready', 'error'));
