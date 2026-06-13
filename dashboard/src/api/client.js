import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL ||
  (window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin);

const api = axios.create({
  baseURL: BASE_URL,
});

// Dynamic auth interceptor — reads token on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('sg_api_token') || import.meta.env.VITE_API_TOKEN;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
