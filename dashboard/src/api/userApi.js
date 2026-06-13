import adminApi from './adminApi';

/**
 * Fetch a customer's profile (including api_token) by email.
 * Uses the admin API's customer listing endpoint.
 */
export async function fetchCustomerByEmail(email) {
  try {
    const res = await adminApi.get('/admin/customers?limit=1000');
    // Admin API returns paginated { data: [...], total, page, ... }
    const customers = Array.isArray(res.data) ? res.data : res.data.data;
    // Find the customer whose email matches the Firebase user's email
    const match = customers.find(
      (c) => c.email && c.email.toLowerCase() === email.toLowerCase()
    );
    return match || null;
  } catch (err) {
    console.error('Failed to fetch customer profile:', err);
    return null;
  }
}

/**
 * Fetch a customer's profile by ID.
 */
export async function fetchCustomerById(id) {
  try {
    const res = await adminApi.get(`/admin/customers/${id}`);
    return res.data;
  } catch (err) {
    console.error('Failed to fetch customer by ID:', err);
    return null;
  }
}
