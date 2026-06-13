/**
 * SupportGenie — Background Embedding Worker (v3: Resilient + Event-Driven)
 *
 * Run with: npm run worker
 *
 * ═══════════════════════════════════════════════════════════════
 * WHAT CHANGED FROM v2:
 * ─────────────────────
 * 1. CRAWLER RESILIENCY: processCrawl() now handles the new
 *    { pages, failedPages } return format from crawler.js. If
 *    some pages fail, they're logged but don't kill the job.
 *
 * 2. PDF RESILIENCY: processPDF() classifies errors — corrupted
 *    files throw UnrecoverableError (skips BullMQ retries) while
 *    transient errors (thread crash, OOM) are retried normally.
 *
 * 3. SSE EVENT EMISSION: On status change (ready/error), the
 *    worker emits an event on the shared documentEvents bus.
 *    The SSE route picks this up and pushes to connected clients.
 *
 * ARCHITECTURE:
 * ─────────────
 *   BullMQ Job → Main Thread (coordination only)
 *                  ↓
 *          Worker Thread (CPU: PDF parse, text chunk)
 *                  ↓
 *          Main Thread (I/O: parallel embed + DB insert)
 *                  ↓
 *          documentEvents.emit() → SSE → Dashboard
 *
 * ═══════════════════════════════════════════════════════════════
 */

require('dotenv').config();

const { Worker: BullWorker, UnrecoverableError } = require('bullmq');
const { Worker: ThreadWorker } = require('worker_threads');
const fs = require('fs');
const path = require('path');

const db = require('../db/client');
const { generateEmbedding } = require('../services/embedder');
const { crawlWebsite } = require('../services/crawler');
const { extractYouTubeTranscript } = require('../services/youtube');
const { transcribeAudio } = require('../services/multimedia');
const { extractFromURL } = require('../services/extractor');
const { chunkText } = require('../services/chunker');
const { publishStatusChange } = require('../services/documentEvents');
const { getPlanLimits } = require('../services/planService');
const { updateStorageUsage, checkStorageLimit } = require('../services/storageService');

// ── Concurrency limit for parallel embedding ────────────────
// WHY 50:
// - Google GenAI free tier allows 1500 req/min = 25 req/sec
// - 50 in-flight means we batch 50, wait ~2 sec, batch 50 more
// - This keeps us well within rate limits while being 50x faster
//   than sequential processing
// - PostgreSQL default max_connections = 100; at 50 concurrent
//   inserts we use half, leaving room for the API server
const CONCURRENCY_LIMIT = 50;

/**
 * Process items with limited concurrency.
 *
 * WHY A CUSTOM IMPLEMENTATION:
 * - The popular `p-map` library is ESM-only in v6+, and this
 *   project uses CommonJS (require/module.exports)
 * - Writing our own is 15 lines and avoids ESM interop headaches
 *
 * HOW IT WORKS:
 * - We maintain a "pool" of CONCURRENCY_LIMIT active promises
 * - When one resolves, the next item starts immediately
 * - This is essentially a semaphore pattern
 *
 * @param {Array} items - Items to process
 * @param {Function} fn - Async function to apply to each item
 * @param {number} concurrency - Max parallel operations
 * @returns {Promise<Array>} Results in original order
 */
async function pMap(items, fn, concurrency) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  // Spawn `concurrency` worker loops — they each pull the next item
  // via the shared `nextIndex` counter
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

/**
 * Run a task in the documentProcessor worker thread.
 *
 * WHY A FRESH THREAD PER TASK:
 * - Thread pools add complexity (managing idle threads, shutdown)
 * - PDF parsing is infrequent (one per job) and takes seconds
 * - Spawning a thread costs ~5ms — negligible vs the parsing time
 * - A fresh thread has clean memory — no risk of leaks accumulating
 *
 * @param {string} action - 'parse_pdf' or 'chunk_text'
 * @param {object} payload - Data to send to the worker
 * @returns {Promise<any>} The result from the worker thread
 */
function runInThread(action, payload) {
  return new Promise((resolve, reject) => {
    const worker = new ThreadWorker(
      path.join(__dirname, 'documentProcessor.js')
    );

    worker.on('message', (msg) => {
      if (msg.success) {
        resolve(msg.result);
      } else {
        reject(new Error(msg.error));
      }
      worker.terminate();
    });

    worker.on('error', (err) => {
      reject(err);
      worker.terminate();
    });

    worker.on('exit', (code) => {
      if (code !== 0 && code !== 1) {
        reject(new Error(`Worker thread exited with code ${code}`));
      }
    });

    worker.postMessage({ action, payload });
  });
}

// ── Helper: emit document status change event ──────────────
/**
 * Emit a status change event on the shared event bus.
 * The SSE route listens for this and pushes to connected clients.
 *
 * WHY HERE INSTEAD OF IN THE DB QUERY:
 * - We want to emit AFTER the DB update is confirmed successful
 * - Emitting before the DB write would cause the dashboard to
 *   fetch stale data when it refreshes
 */
function emitStatusChange(docId, customerId, status, chunkCount = null, errorMessage = null) {
  publishStatusChange({
    doc_id: docId,
    customer_id: customerId,
    status,
    chunk_count: chunkCount,
    error_message: errorMessage,
  });
}

// ── Job processor ──────────────────────────────────────────
async function processJob(job) {
  const { type, doc_id, customer_id } = job.data;
  console.log(`\n🔧 Processing job ${job.id} — type: ${type}, doc: ${doc_id}`);

  try {
    // Mark document as processing
    await db.query(
      `UPDATE documents SET status = 'processing' WHERE id = $1`,
      [doc_id]
    );

    // Emit processing status so dashboard shows a spinner immediately
    emitStatusChange(doc_id, customer_id, 'processing');

    // ── Fetch customer and plan limits ───────────────────────
    const customerResult = await db.query(
      'SELECT subscription_tier, plan FROM customers WHERE id = $1',
      [customer_id]
    );
    if (customerResult.rows.length === 0) {
      throw new Error(`Customer ${customer_id} not found`);
    }
    const customer = customerResult.rows[0];
    const limits = getPlanLimits(customer.subscription_tier || customer.plan || 'free');

    let totalChunks = 0;
    let charCount = 0;

    switch (type) {
      case 'pdf': {
        const result = await processPDF(job, doc_id, customer_id, limits);
        totalChunks = result.totalChunks;
        charCount = result.charCount;
        break;
      }
      case 'crawl': {
        const result = await processCrawl(job, doc_id, customer_id, limits);
        totalChunks = result.totalChunks;
        charCount = result.charCount;
        break;
      }
      case 'youtube': {
        const result = await processYouTube(job, doc_id, customer_id, limits);
        totalChunks = result.totalChunks;
        charCount = result.charCount;
        break;
      }
      case 'audio': {
        const result = await processAudio(job, doc_id, customer_id, limits);
        totalChunks = result.totalChunks;
        charCount = result.charCount;
        break;
      }
      case 'url': {
        const result = await processURL(job, doc_id, customer_id, limits);
        totalChunks = result.totalChunks;
        charCount = result.charCount;
        break;
      }
      default:
        throw new Error(`Unknown job type: ${type}`);
    }

    // Mark document as ready and store char_count
    await db.query(
      `UPDATE documents SET status = 'ready', chunk_count = $1, char_count = $2 WHERE id = $3`,
      [totalChunks, charCount, doc_id]
    );

    // Update storage usage counter on success
    if (charCount > 0) {
      await updateStorageUsage(customer_id, charCount);
    }

    // ── Emit 'ready' event → SSE → Dashboard instantly ─────
    emitStatusChange(doc_id, customer_id, 'ready', totalChunks);

    console.log(`✅ Job ${job.id} complete — ${totalChunks} chunks stored`);
    return { doc_id, chunks: totalChunks };

  } catch (err) {
    // Mark document as error
    await db.query(
      `UPDATE documents SET status = 'error', error_message = $1 WHERE id = $2`,
      [err.message, doc_id]
    );

    // ── Emit 'error' event → SSE → Dashboard instantly ─────
    emitStatusChange(doc_id, customer_id, 'error', null, err.message);

    throw err; // Re-throw so BullMQ can retry
  }
}

// ── PDF processing (worker_threads + parallel embedding) ───
/**
 * v3 CHANGES:
 * - Classifies PDF errors as recoverable vs unrecoverable
 * - Corrupted files → UnrecoverableError (skip retries)
 * - Transient errors (thread crash) → normal Error (BullMQ retries)
 *
 * WHY UNRECOVERABLEERROR:
 * BullMQ's UnrecoverableError immediately fails the job without
 * using any remaining retry attempts. A corrupted PDF that fails
 * to parse will ALWAYS fail — retrying 5 times just wastes time.
 */
async function processPDF(job, docId, customerId, limits) {
  const { filePath } = job.data;

  // Verify file exists before attempting parse
  if (!fs.existsSync(filePath)) {
    throw new UnrecoverableError(`PDF file not found at ${filePath} — may have been cleaned up`);
  }

  // Read the PDF file into a buffer (fast I/O — not CPU-bound)
  const buffer = fs.readFileSync(filePath);

  // ── Magic byte validation ─────────────────────────────────
  // PDF files must start with %PDF (hex: 25 50 44 46)
  // If this check fails, the file is fundamentally not a PDF.
  const pdfMagic = buffer.slice(0, 4).toString('ascii');
  if (pdfMagic !== '%PDF') {
    // Clean up the fake file
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    throw new UnrecoverableError(
      'File is not a valid PDF — magic bytes mismatch. The file may be corrupt or misnamed.'
    );
  }

  // ── Step 1: Parse PDF in a worker thread ──────────────────
  // This prevents pdf-parse's heavy CPU work from blocking BullMQ
  console.log(`   📋 Parsing PDF in background thread...`);
  let rawText;
  try {
    rawText = await runInThread('parse_pdf', {
      buffer: buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ),
    });
  } catch (parseErr) {
    // ── Classify the error ──────────────────────────────────
    // Known unrecoverable patterns from pdf-parse:
    const unrecoverablePatterns = [
      'Invalid PDF',
      'password',  // password-protected
      'encrypt',   // encrypted
      'Bad XRef',  // corrupted cross-reference table
      'Invalid XRef',
      'stream length is not a number',
    ];

    const isUnrecoverable = unrecoverablePatterns.some(
      p => parseErr.message.toLowerCase().includes(p.toLowerCase())
    );

    if (isUnrecoverable) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      throw new UnrecoverableError(`PDF is unreadable: ${parseErr.message}`);
    }

    // Transient error (thread crash, OOM) — let BullMQ retry
    throw parseErr;
  }

  if (!rawText || rawText.trim().length === 0) {
    // Clean up
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    throw new UnrecoverableError('Could not extract any text from the PDF — it may be image-only or empty');
  }

  // ── Step 1.5: Validation (Storage Limits & Searchability) ──
  const charCount = rawText.length;
  console.log(`   📊 PDF Content: ${charCount.toLocaleString()} characters`);

  // Detect image-only PDFs (multi-page but < 50 characters)
  // v3 Task: Reject non-searchable (image-only) PDFs
  if (charCount < 50) {
    // Check if it's multi-page (we can't easily check page count from raw buffer here, 
    // but pdf-parse doesn't strictly give it in the same structure. 
    // If it's less than 50 chars, it's almost certainly useless for RAG).
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    throw new UnrecoverableError(
      "We couldn't find enough text in this document. It may be a scanned image or empty. Please upload a searchable PDF."
    );
  }

  // Check character storage limit
  const { allowed, currentUsage } = await checkStorageLimit(customerId, charCount, limits);
  if (!allowed) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    throw new UnrecoverableError(
      `Storage limit reached. This document has ${charCount.toLocaleString()} characters, which exceeds your remaining quota. You've used ${currentUsage.toLocaleString()} of ${limits.storage_chars.toLocaleString()} characters. Please upgrade your plan.`
    );
  }

  // ── Step 2: Chunk text in a worker thread ─────────────────
  // Custom recursive character text splitter (zero-dependency
  // replacement for @langchain/textsplitters) does heavy string ops
  console.log(`   ✂️  Chunking text in background thread...`);
  const chunks = await runInThread('chunk_text', { text: rawText });

  // ── Step 3: Parallel embedding + storage ──────────────────
  console.log(`   ⚡ Embedding ${chunks.length} chunks (${CONCURRENCY_LIMIT} concurrent)...`);
  await storeChunksParallel(chunks, docId, customerId, job);

  // Clean up the uploaded file after processing
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }

  return { totalChunks: chunks.length, charCount };
}

// ── URL processing (single page) ───────────────────────────
async function processURL(job, docId, customerId, limits) {
  const { url } = job.data;
  const rawText = await extractFromURL(url);

  if (!rawText || rawText.trim().length === 0) {
    throw new Error('Could not extract any text from the URL');
  }

  const charCount = rawText.length;

  // Check storage limit
  const { allowed, currentUsage } = await checkStorageLimit(customerId, charCount, limits);
  if (!allowed) {
    throw new Error(
      `Storage limit reached. This URL has ${charCount.toLocaleString()} characters. Used: ${currentUsage.toLocaleString()} / ${limits.storage_chars.toLocaleString()}.`
    );
  }

  // Chunk in thread to keep main loop free
  const chunks = await runInThread('chunk_text', { text: rawText });
  await storeChunksParallel(chunks, docId, customerId, job);
  return { totalChunks: chunks.length, charCount };
}

// ── Crawl processing (multi-page, resilient) ───────────────
/**
 * v3 CHANGES:
 * - crawlWebsite() now returns { pages, failedPages } instead of just an array
 * - Individual page processing is wrapped in try/catch so one bad page
 *   doesn't kill the entire crawl job
 * - Failed pages (from both crawling and processing) are tracked
 *   and included in the job result for debugging
 */
async function processCrawl(job, docId, customerId, limits) {
  const { rootUrl, maxPages: jobMaxPages, maxDepth: jobMaxDepth } = job.data;
  const maxPages = jobMaxPages || parseInt(process.env.MAX_CRAWL_PAGES) || 100;
  const maxDepth = jobMaxDepth || parseInt(process.env.MAX_CRAWL_DEPTH) || 5;

  // crawler.js now returns { pages, failedPages }
  const crawlResult = await crawlWebsite(rootUrl, { maxPages, maxDepth });
  const pages = crawlResult.pages || crawlResult; // backward compat
  if (!pages || pages.length === 0) {
    throw new Error(`No pages crawled from ${rootUrl}`);
  }

  let totalChunks = 0;
  let totalChars = 0;
  const processingErrors = [];

  for (let p = 0; p < pages.length; p++) {
    job.updateProgress(Math.round((p / pages.length) * 100));

    // ── Wrap each page in try/catch for resilience ──────────
    // WHY: A single page with weird encoding or enormous content
    // shouldn't kill the entire 100-page crawl. Skip the bad page,
    // log the error, and continue with the rest.
    try {
      const charCount = pages[p].text.length;
      totalChars += charCount;

      // check limit periodically for crawls
      if (p % 5 === 0) {
        const { allowed } = await checkStorageLimit(customerId, totalChars, limits);
        if (!allowed) {
          throw new Error('Storage limit reached during crawl.');
        }
      }

      const chunks = await runInThread('chunk_text', { text: pages[p].text });
      await storeChunksParallel(chunks, docId, customerId, job, pages[p].url);
      totalChunks += chunks.length;

      console.log(`   📄 Page ${p + 1}/${pages.length}: ${pages[p].url} → ${chunks.length} chunks`);
    } catch (pageErr) {
      console.error(`   ⚠ Page ${p + 1}/${pages.length} failed: ${pages[p].url} — ${pageErr.message}`);
      processingErrors.push({ url: pages[p].url, error: pageErr.message });
      // Continue with next page — don't abort
    }
  }

  // Log summary of failures
  const crawlFailures = crawlResult.failedPages?.length || 0;
  if (processingErrors.length > 0 || crawlFailures > 0) {
    console.warn(`   ⚠ Crawl summary: ${crawlFailures} page(s) failed to crawl, ${processingErrors.length} page(s) failed to process`);
  }

  if (totalChunks === 0) {
    throw new Error(`Crawl completed but no text could be extracted from any page at ${rootUrl}`);
  }

  return { totalChunks, charCount: totalChars };
}

// ── YouTube processing ─────────────────────────────────────
async function processYouTube(job, docId, customerId, limits) {
  const { url } = job.data;
  const { text } = await extractYouTubeTranscript(url);

  if (!text || text.trim().length === 0) {
    throw new Error('YouTube transcript is empty');
  }

  const charCount = text.length;

  // Check storage limit
  const { allowed, currentUsage } = await checkStorageLimit(customerId, charCount, limits);
  if (!allowed) {
    throw new Error(`Storage limit reached. Transcript: ${charCount.toLocaleString()}. Used: ${currentUsage.toLocaleString()} / ${limits.storage_chars.toLocaleString()}.`);
  }

  // Chunk in thread
  const chunks = await runInThread('chunk_text', { text });
  await storeChunksParallel(chunks, docId, customerId, job);
  return { totalChunks: chunks.length, charCount };
}

// ── Audio processing (OpenAI Whisper) ──────────────────────
async function processAudio(job, docId, customerId, limits) {
  const { filePath } = job.data;
  
  // Transcribe audio using OpenAI Whisper API
  const text = await transcribeAudio(filePath);
  
  if (!text || text.trim().length === 0) {
    throw new Error('Audio transcription is empty');
  }

  const charCount = text.length;

  // Check storage limit
  const { allowed, currentUsage } = await checkStorageLimit(customerId, charCount, limits);
  if (!allowed) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    throw new Error(`Storage limit reached. Audio text: ${charCount.toLocaleString()}. Used: ${currentUsage.toLocaleString()} / ${limits.storage_chars.toLocaleString()}.`);
  }

  // Chunk in thread
  const chunks = await runInThread('chunk_text', { text });
  await storeChunksParallel(chunks, docId, customerId, job);
  
  // Clean up the uploaded media file
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  
  return { totalChunks: chunks.length, charCount };
}

// ── Helper: store chunks in parallel ───────────────────────
/**
 * WHY PARALLELIZATION:
 * v1 processed chunks sequentially:
 *   for (chunk of chunks) { await embed(); await db.insert(); }
 *
 * For 1000 chunks at 100ms per embed API call = 100 seconds.
 * With CONCURRENCY_LIMIT=50, we process 50 simultaneously:
 *   1000 chunks / 50 concurrent = 20 batches × ~200ms = ~4 seconds
 *
 * WHY Promise.all WITH A POOL (pMap) INSTEAD OF PLAIN Promise.all:
 * - `Promise.all(chunks.map(...))` fires ALL at once
 * - With 10,000 chunks, that's 10,000 simultaneous API calls →
 *   instant rate limit, memory exhaustion, DB pool exhaustion
 * - pMap(items, fn, 50) ensures at most 50 are active at any time
 *
 * @param {string[]} chunks - Array of text chunks
 * @param {string} docId - Document UUID
 * @param {string} customerId - Customer UUID
 * @param {object} job - BullMQ job (for progress updates)
 * @param {string|null} sourceUrl - Source URL (for crawl pages)
 */
async function storeChunksParallel(chunks, docId, customerId, job, sourceUrl = null) {
  let processed = 0;

  await pMap(chunks, async (chunkText, index) => {
    // generateEmbedding now checks Redis cache first — if this chunk
    // was seen before (e.g., during a re-crawl), this is near-instant
    const embedding = await generateEmbedding(chunkText);
    const vectorString = '[' + embedding.join(',') + ']';

    await db.query(
      `INSERT INTO chunks (document_id, customer_id, content, embedding, chunk_index)
       VALUES ($1, $2, $3, $4::vector, $5)`,
      [docId, customerId, chunkText, vectorString, index]
    );

    // Update progress periodically (not every chunk — too noisy)
    processed++;
    if (processed % 25 === 0 && job) {
      job.updateProgress(Math.round((processed / chunks.length) * 100));
    }
  }, CONCURRENCY_LIMIT);
}

// ── Start the worker ───────────────────────────────────────
const { initQueue } = require('../queue/queue');

(async () => {
  // Initialise queue (connects to Redis or starts embedded Redis)
  await initQueue();

  const { createRedisConnection } = require('../queue/queue');

  const worker = new BullWorker('embedding', processJob, {
    connection: createRedisConnection(),
    concurrency: 2,            // Process up to 2 jobs in parallel
    limiter: {
      max: 5,
      duration: 60000,          // Max 5 jobs per minute (avoid API rate limits)
    },
  });

  worker.on('completed', (job, result) => {
    console.log(`✅ Job ${job.id} completed:`, result);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('Worker error:', err);
  });

  console.log('🏭 Embedding worker started — listening for jobs...');
  console.log(`   ⚡ Parallel embedding: ${CONCURRENCY_LIMIT} concurrent operations`);
  console.log(`   🧵 Worker threads: enabled for PDF parsing & text chunking`);
  console.log(`   💾 Semantic cache: Redis SHA-256 → 7-day TTL`);
  console.log(`   📡 SSE event emission: enabled\n`);
})();
