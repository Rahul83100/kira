/**
 * SupportGenie — Plan Service
 * Defines limits for different subscription tiers.
 */

const PLAN_LIMITS = {
  free: {
    max_file_mb: 5,
    max_sources: 3,
    storage_chars: 20000,
  },
  free_trial: {
    max_file_mb: 5,
    max_sources: 3,
    storage_chars: 50000,
  },
  base: {
    max_file_mb: 10,
    max_sources: 10,
    storage_chars: 100000,
  },
  pro: {
    max_file_mb: 15,
    max_sources: 20,
    storage_chars: 300000,
  },
  growth: {
    max_file_mb: 35,
    max_sources: 20,
    storage_chars: 500000,
  },
};


/**
 * Get limits for a specific plan tier.
 * @param {string} plan - Plan tier name (e.g., 'free', 'pro')
 * @returns {object} Limit definitions
 */
function getPlanLimits(plan) {
  let tier = plan ? plan.toLowerCase() : 'free';
  // Strip _annual suffix if present (e.g., 'pro_annual' -> 'pro')
  if (tier.endsWith('_annual')) {
    tier = tier.replace('_annual', '');
  }
  return PLAN_LIMITS[tier] || PLAN_LIMITS.free;
}

module.exports = {
  getPlanLimits,
  PLAN_LIMITS,
};
