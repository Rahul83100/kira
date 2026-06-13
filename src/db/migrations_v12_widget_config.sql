-- ============================================================
-- SupportGenie — Migration V12: Widget Configuration Columns
-- Sprint: April 27, 2026 — Widget Setup ↔ Standalone Chat Sync
-- ============================================================
--
-- PURPOSE:
-- Adds widget_name and widget_welcome columns to the customers
-- table so the dashboard can persist agent name and welcome
-- message, and the standalone chat page can read them from
-- the /api/client/:slug endpoint.
--
-- CHANGES:
-- 1. Adds widget_name    (chatbot display name, e.g. "Zara")
-- 2. Adds widget_welcome (first message shown to users)
-- ============================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS widget_name TEXT DEFAULT 'KIRA';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS widget_welcome TEXT DEFAULT 'Hi! How can I help you today?';
