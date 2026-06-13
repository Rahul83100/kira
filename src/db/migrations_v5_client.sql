-- ============================================================
-- SupportGenie — Migration V5: Client Branding & Webhook Specs
-- Sprint: April 12, 2026 — Sandra (Multichannel)
-- ============================================================
--
-- PURPOSE:
-- Adds columns needed to support the standalone chat page and
-- client data endpoint (/api/client/:slug).
--
-- CHANGES:
-- 1. Adds slug (unique identifier for public URLs)
-- 2. Adds branding_logo (URL to client logo)
-- 3. Adds branding_color (Hex color code)
-- 4. Adds kb_id (Public facing Knowledge Base Identifier)
-- ============================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS branding_logo TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS branding_color TEXT DEFAULT '#ffffff';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS kb_id UUID DEFAULT gen_random_uuid();

-- Seed the initial test user with a slug
UPDATE customers 
SET slug = 'cyclecorp', 
    branding_color = '#4A90E2', 
    branding_logo = 'https://picsum.photos/100',
    kb_id = id
WHERE email = 'test@cyclecorp.in' AND slug IS NULL;
