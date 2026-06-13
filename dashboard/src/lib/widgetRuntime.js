const WIDGET_HEALTH_CACHE_TTL_MS = 15000;
const WIDGET_HEALTH_TIMEOUT_MS = 2500;

let cachedWidgetHealth = null;
let cachedAt = 0;

export function getDefaultWidgetServerUrl() {
  return import.meta.env.VITE_WIDGET_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3500' : window.location.origin);
}

export async function isWidgetServerReachable(widgetServerUrl, { force = false } = {}) {
  const now = Date.now();
  if (!force && cachedWidgetHealth !== null && (now - cachedAt) < WIDGET_HEALTH_CACHE_TTL_MS) {
    return cachedWidgetHealth;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WIDGET_HEALTH_TIMEOUT_MS);

  try {
    await fetch(`${widgetServerUrl}/widget.js?t=${now}`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    cachedWidgetHealth = true;
  } catch {
    cachedWidgetHealth = false;
  } finally {
    clearTimeout(timeout);
    cachedAt = Date.now();
  }

  return cachedWidgetHealth;
}
