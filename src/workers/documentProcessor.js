/**
 * SupportGenie — Document Processor (Worker Thread)
 *
 * ═══════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS:
 * ─────────────────────
 * Node.js is single-threaded. When the BullMQ worker picks up a job
 * and runs pdf-parse on a 10,000-page PDF, or RecursiveCharacterText-
 * Splitter on a massive text corpus, that CPU-bound work BLOCKS the
 * main event loop. This causes:
 *
 *   1. BullMQ heartbeats stop → job marked as "stalled"
 *   2. Other queued jobs can't start → pipeline backs up
 *   3. The process appears frozen
 *
 * SOLUTION: Run CPU-heavy operations in a separate worker_thread.
 * The main thread posts a message ("parse this PDF" or "chunk this
 * text"), this thread does the work, and posts back the result.
 * The main thread stays responsive for BullMQ housekeeping.
 *
 * WHY worker_threads OVER child_process:
 * ──────────────────────────────────────
 * - worker_threads are lighter: they share the same process memory
 *   space and can transfer data via structured clone (fast)
 * - child_process.fork() spawns an entire new V8 instance + Node.js
 *   runtime — much higher memory overhead per process
 * - For CPU-bound work within the same codebase, threads are ideal
 *
 * MESSAGE PROTOCOL:
 * ─────────────────
 * Main → Worker:
 *   { action: 'parse_pdf', payload: { buffer: ArrayBuffer } }
 *   { action: 'chunk_text', payload: { text: string, options?: {} } }
 *
 * Worker → Main:
 *   { success: true, result: <data> }
 *   { success: false, error: <string> }
 * ═══════════════════════════════════════════════════════════════
 */

const { parentPort } = require('worker_threads');
const pdfParse = require('pdf-parse');
const { chunkText } = require('../services/chunker');

// ── Listen for messages from the main thread ────────────────
parentPort.on('message', async (msg) => {
  const { action, payload } = msg;

  try {
    switch (action) {
      // ── PDF Parsing ─────────────────────────────────────────
      // WHY OFFLOAD THIS:
      // pdf-parse internally decodes compressed streams, renders
      // text layers, and concatenates pages — all CPU-intensive.
      // A 10,000-page PDF can take 30+ seconds of pure CPU work.
      case 'parse_pdf': {
        const buffer = Buffer.from(payload.buffer);
        const data = await pdfParse(buffer);
        parentPort.postMessage({ success: true, result: data.text });
        break;
      }

      // ── Text Chunking ──────────────────────────────────────
      // WHY OFFLOAD THIS:
      // The recursive character text splitter iterates through the
      // text trying multiple separators (\n\n, \n, ., space) at each
      // split point. For a 5MB text corpus, this involves millions
      // of string operations. Running it on the main thread would
      // block BullMQ for seconds.
      //
      // LANGCHAIN REPLACEMENT:
      // Previously used @langchain/textsplitters which pulled in a
      // massive dependency tree and caused crashes in worker_threads.
      // Now uses our custom zero-dependency chunker with the same
      // algorithm (recursive split with overlap).
      case 'chunk_text': {
        const { text, chunkSize = 500, chunkOverlap = 50 } = payload;

        const chunks = await chunkText(text, { chunkSize, chunkOverlap });
        parentPort.postMessage({ success: true, result: chunks });
        break;
      }

      default:
        parentPort.postMessage({
          success: false,
          error: `Unknown action: ${action}`,
        });
    }
  } catch (err) {
    parentPort.postMessage({
      success: false,
      error: err.message || 'Unknown error in document processor thread',
    });
  }
});
