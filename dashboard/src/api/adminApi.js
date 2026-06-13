import axios from 'axios';

/**
 * Axios client for Deepanshu's Admin API (port 4001).
 * Used for analytics/usage data and customer management.
 */
const ADMIN_BASE_URL = import.meta.env.VITE_ADMIN_API_URL ||
  (window.location.hostname === 'localhost' ? 'http://localhost:4001' : window.location.origin);

const adminApi = axios.create({
  baseURL: ADMIN_BASE_URL,
  headers: {
    'x-admin-key': import.meta.env.VITE_ADMIN_SECRET_KEY || 'admin_secret_deepanshu_2026',
  },
});

export default adminApi;
