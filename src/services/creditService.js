/**
 * ═══════════════════════════════════════════════════════════════
 * SupportGenie — Credit Service (Atomic Deduction Engine)
 * ═══════════════════════════════════════════════════════════════
 *
 * WHY ATOMIC DEDUCTION:
 * ─────────────────────
 * Credits are money. If two requests arrive simultaneously, a naive
 * "read balance → check → subtract → write" approach has a race
 * condition where both requests read balance=10, both think they
 * can afford 10 credits, and both deduct — leaving balance at -10.
 *
 * We solve this with a single SQL statement:
 *   UPDATE customers
 *   SET credit_balance = credit_balance - $amount
 *   WHERE id = $id AND credit_balance >= $amount
 *   RETURNING credit_balance
 *
 * PostgreSQL guarantees this is atomic at the row level. If the
 * balance is insufficient, the WHERE clause fails, 0 rows are
 * affected, and we know the deduction was denied.
 *
 * FAIL-CLOSED DESIGN:
 * ───────────────────
 * Unlike rate limiting (which fails open to avoid blocking users),
 * credits fail CLOSED. If the database is down, if the query fails,
 * if anything goes wrong — we deny the action. This prevents
 * customers from getting free usage during outages.
 *
 * CREDIT COST TABLE:
 * ──────────────────
 * | Action                  | Credits |
 * |─────────────────────────|─────────|
 * | chatbot_reply           | 1       |
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('../db/client');

// ── Credit cost constants ────────────────────────────────────
// Centralised here so routes don't hardcode magic numbers.
// If pricing changes, update only this object.
const CREDIT_COSTS = {
  chatbot_reply: 1,
};

/**
 * Atomically deduct credits from a customer's balance.
 *
 * HOW IT WORKS:
 *   1. Single UPDATE with WHERE credit_balance >= amount
 *   2. If balance sufficient → row updated, RETURNING gives new balance
 *   3. If balance insufficient → 0 rows affected → denied
 *   4. Log the deduction to credit_usage_log for audit trail
 *
 * @param {string} customerId   - UUID of the customer
 * @param {string} action       - Action name (e.g., 'telegram_scan')
 * @param {number} amount       - Credits to deduct (use CREDIT_COSTS)
 * @param {object} [metadata]   - Optional JSON metadata (scan_id, lead_id, etc.)
 * @returns {{ allowed: boolean, remaining: number, error?: string }}
 */
async function deductCredits(customerId, action, amount, metadata = {}) {
  try {
    // ── Step 1: Atomic deduction ────────────────────────────
    // This single query does check + deduct in one atomic operation.
    // PostgreSQL row-level locks prevent race conditions.
    const result = await db.query(
      `UPDATE customers
       SET credit_balance = credit_balance - $1
       WHERE id = $2 AND credit_balance >= $1
       RETURNING credit_balance`,
      [amount, customerId]
    );

    // No rows affected = insufficient balance
    if (result.rows.length === 0) {
      // Check if customer exists at all (for better error messages)
      const check = await db.query(
        'SELECT credit_balance FROM customers WHERE id = $1',
        [customerId]
      );

      if (check.rows.length === 0) {
        return { allowed: false, remaining: 0, error: 'Customer not found' };
      }

      const currentBalance = check.rows[0].credit_balance || 0;
      return {
        allowed: false,
        remaining: currentBalance,
        error: `Insufficient credits. Need ${amount}, have ${currentBalance}`,
      };
    }

    const newBalance = result.rows[0].credit_balance;

    // ── Step 2: Log the deduction (fire-and-forget) ─────────
    // We don't await this in a blocking way — if logging fails,
    // the deduction still happened (the important part).
    db.query(
      `INSERT INTO credit_usage_log (customer_id, action, credits_deducted, balance_after, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [customerId, action, amount, newBalance, JSON.stringify(metadata)]
    ).catch((err) => {
      console.error('[CreditService] ⚠️ Failed to log credit usage:', err.message);
    });

    return { allowed: true, remaining: newBalance };
  } catch (err) {
    // ── FAIL CLOSED ─────────────────────────────────────────
    // If anything goes wrong (DB down, query error), deny the action.
    // This is the opposite of rate limiting (which fails open).
    // Credits are money — we never give free usage on errors.
    console.error('[CreditService] ❌ Credit deduction failed:', err.message);
    return { allowed: false, remaining: 0, error: 'Credit check failed — try again later' };
  }
}

/**
 * Get current credit balance for a customer.
 *
 * @param {string} customerId
 * @returns {number} Current credit balance (0 if not found)
 */
async function getBalance(customerId) {
  try {
    const result = await db.query(
      'SELECT credit_balance FROM customers WHERE id = $1',
      [customerId]
    );
    return result.rows[0]?.credit_balance || 0;
  } catch (err) {
    console.error('[CreditService] ❌ Balance check failed:', err.message);
    return 0;
  }
}

/**
 * Get credit usage history for a customer.
 *
 * @param {string} customerId
 * @param {number} [limit=50]
 * @returns {Array} Usage log entries
 */
async function getUsageHistory(customerId, limit = 50) {
  try {
    const result = await db.query(
      `SELECT action, credits_deducted, balance_after, metadata, created_at
       FROM credit_usage_log
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [customerId, limit]
    );
    return result.rows;
  } catch (err) {
    console.error('[CreditService] ❌ Usage history failed:', err.message);
    return [];
  }
}

module.exports = {
  deductCredits,
  getBalance,
  getUsageHistory,
  CREDIT_COSTS,
};
