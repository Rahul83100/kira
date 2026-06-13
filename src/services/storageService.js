/**
 * SupportGenie — Storage Service
 * Handles customer storage tracking and limits.
 */

const db = require('../db/client');

/**
 * Get the total number of documents owned by a customer.
 * @param {string} customerId - Customer UUID
 * @returns {Promise<number>} Document count
 */
async function getDocumentCount(customerId) {
  const result = await db.query(
    'SELECT COUNT(*) FROM documents WHERE customer_id = $1',
    [customerId]
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Update the storage usage counter for a customer.
 * @param {string} customerId - Customer UUID
 * @param {number} charCountDelta - Number of characters to add (positive) or subtract (negative)
 * @returns {Promise<number>} Updated character count
 */
async function updateStorageUsage(customerId, charCountDelta) {
  const result = await db.query(
    `UPDATE customers 
     SET storage_chars_used = GREATEST(0, COALESCE(storage_chars_used, 0) + $1) 
     WHERE id = $2 
     RETURNING storage_chars_used`,
    [charCountDelta, customerId]
  );
  
  if (result.rows.length === 0) {
    throw new Error(`Customer ${customerId} not found`);
  }
  
  return parseInt(result.rows[0].storage_chars_used, 10);
}

/**
 * Get current storage usage for a customer.
 * @param {string} customerId - Customer UUID
 * @returns {Promise<number>} Character count used
 */
async function getStorageUsage(customerId) {
  const result = await db.query(
    'SELECT storage_chars_used FROM customers WHERE id = $1',
    [customerId]
  );
  
  if (result.rows.length === 0) {
    return 0;
  }
  
  return parseInt(result.rows[0].storage_chars_used || 0, 10);
}

/**
 * Check if adding characters would exceed a customer's storage limit.
 * @param {string} customerId - Customer UUID
 * @param {number} addedChars - Characters to add
 * @param {object} limits - Plan limits
 * @returns {Promise<{allowed: boolean, currentUsage: number}>}
 */
async function checkStorageLimit(customerId, addedChars, limits) {
  const currentUsage = await getStorageUsage(customerId);
  const allowed = (currentUsage + addedChars) <= limits.storage_chars;
  return { allowed, currentUsage };
}

module.exports = {
  getDocumentCount,
  updateStorageUsage,
  getStorageUsage,
  checkStorageLimit,
};
