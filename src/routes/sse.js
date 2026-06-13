/**
 * SupportGenie — Server-Sent Events (SSE) Route for Document Status
 *
 * ═══════════════════════════════════════════════════════════════
 * WHY SSE OVER WEBSOCKET:
 * ───────────────────────
 * 1. UNIDIRECTIONAL: We only push server → client. WebSocket's
 *    bidirectional channel is unnecessary overhead.
 * 2. NATIVE BROWSER API: EventSource handles reconnection
 *    automatically — no library needed on the client.
 * 3. HTTP-COMPATIBLE: Works through proxies, CDNs, and load
 *    balancers that sometimes block WebSocket upgrades.
 * 4. NO NEW DEPENDENCY: Express can serve SSE natively with
 *    the right headers — no socket.io or ws package needed.
 *
 * HOW IT WORKS:
 * ─────────────
 * 1. Client opens: fetch('/api/documents/events') with auth header
 * 2. Server holds the connection open (Content-Type: text/event-stream)
 * 3. Worker process publishes to Redis Pub/Sub
 * 4. This process receives the message via documentEvents subscriber
 * 5. SSE route writes the event to matching connected clients
 * 6. Client receives the event and updates the UI instantly
 *
 * CLIENT FORMAT:
 * ──────────────
 *   event: document:status-changed
 *   data: {"doc_id":"uuid","status":"ready","chunk_count":42}
 *
 * ═══════════════════════════════════════════════════════════════
 */

const { onStatusChange } = require('../services/documentEvents');

// Track connected SSE clients for cleanup
const connectedClients = new Map();

/**
 * SSE endpoint handler.
 * Mounted at: GET /api/documents/events
 */
function sseHandler(req, res) {
  // ── Set SSE headers ──────────────────────────────────────
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable Nginx buffering
  });

  // Send initial connection confirmation
  res.write(`event: connected\ndata: ${JSON.stringify({ message: 'SSE connected', timestamp: new Date().toISOString() })}\n\n`);

  // ── Heartbeat every 30s to keep connection alive ─────────
  // WHY: Proxies and load balancers close idle connections.
  // A periodic comment (":") is the SSE standard for keepalive.
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  // ── Listen for document status changes via Redis Pub/Sub ──
  const customerId = req.customer?.id;
  const clientId = `${customerId}-${Date.now()}`;

  const unsubscribe = onStatusChange((payload) => {
    // Only send events for this customer's documents
    if (payload.customer_id && payload.customer_id !== customerId) return;

    const eventData = JSON.stringify({
      doc_id: payload.doc_id,
      status: payload.status,
      chunk_count: payload.chunk_count || null,
      error_message: payload.error_message || null,
      timestamp: new Date().toISOString(),
    });

    res.write(`event: document:status-changed\ndata: ${eventData}\n\n`);
  });

  connectedClients.set(clientId, { customerId, unsubscribe });

  console.log(`📡 SSE client connected: ${clientId} (${connectedClients.size} total)`);

  // ── Cleanup on disconnect ────────────────────────────────
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    connectedClients.delete(clientId);
    console.log(`📡 SSE client disconnected: ${clientId} (${connectedClients.size} remaining)`);
  });
}

/**
 * Get count of connected SSE clients (for health endpoint)
 */
function getConnectedClientCount() {
  return connectedClients.size;
}

module.exports = { sseHandler, getConnectedClientCount };
