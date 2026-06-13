-- ════════════════════════════════════════════════════════════════════════════
-- Kira — Demo Seed (optional, for instant local testing)
-- ════════════════════════════════════════════════════════════════════════════
-- Creates one ready-to-use demo tenant so you can embed the widget and chat
-- immediately after `docker compose up`, without signing up or wiring email.
--
-- The demo API token is: sk_demo_local_token
-- Embed snippet:
--   <script src="http://localhost:3000/widget.js" data-token="sk_demo_local_token"></script>
--
-- Docker runs this automatically on first boot. To run it manually:
--   psql "$DATABASE_URL" -f db/seed.sql
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO customers (
  email, api_token, name, company_name,
  plan, subscription_status, status, credit_balance,
  slug, widget_name, widget_welcome, agent_name, agent_tone,
  email_verified, onboarding_completed, trial_ends_at
)
VALUES (
  'demo@kira.local', 'sk_demo_local_token', 'Demo User', 'Demo Company',
  'free_trial', 'active', 'active', 100000,
  'demo', 'Kira', 'Hi! I''m Kira. Ask me anything about this demo.', 'Kira', 'friendly',
  true, true, NOW() + INTERVAL '365 days'
)
ON CONFLICT (email) DO NOTHING;
