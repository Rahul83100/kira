/**
 * SupportGenie — Migration V11: Onboarding Wizard
 *
 * Adds columns for the multi-step onboarding flow.
 * Existing users are backfilled as onboarding_completed = true.
 *
 * Run: node src/db/migration_v11_onboarding.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const db = require('./client');

async function migrate() {
  console.log('🚀 Running Migration V11 — Onboarding Wizard columns...\n');

  const queries = [
    // Onboarding state tracking
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 0`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS onboarding_goal TEXT`,

    // Agent configuration (from onboarding step 3)
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS agent_tone TEXT DEFAULT 'friendly'`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS agent_instructions TEXT`,

    // Website screenshot for live preview (onboarding step 4)
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS website_screenshot_url TEXT`,

    // Free trial enforcement
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMP`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS trial_messages_used INTEGER DEFAULT 0`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS trial_messages_limit INTEGER DEFAULT 100`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS trial_duration_days INTEGER DEFAULT 7`,

    // Backfill: ALL existing customers should skip onboarding
    `UPDATE customers SET onboarding_completed = true WHERE onboarding_completed = false OR onboarding_completed IS NULL`,
  ];

  for (const sql of queries) {
    try {
      await db.query(sql);
      // Show a summary of what was run
      const shortSql = sql.replace(/\s+/g, ' ').trim().substring(0, 80);
      console.log(`  ✅ ${shortSql}...`);
    } catch (err) {
      // "column already exists" is fine — skip silently
      if (err.message.includes('already exists')) {
        const col = sql.match(/ADD COLUMN IF NOT EXISTS (\w+)/)?.[1] || 'unknown';
        console.log(`  ⏭️  Column "${col}" already exists — skipping`);
      } else {
        console.error(`  ❌ Failed: ${err.message}`);
      }
    }
  }

  console.log('\n✅ Migration V11 complete.');
  process.exit(0);
}

migrate();
