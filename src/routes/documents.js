const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const router = express.Router();

const db = require('../db/client');
const authenticate = require('../middleware/auth');
const { promptInjectionGuard } = require('../middleware/promptInjectionGuard');
const { extractFromPDF, extractFromURL, extractFromText } = require('../services/extractor');
const { chunkText } = require('../services/chunker');
const { generateEmbedding, invalidateEmbeddingCache } = require('../services/embedder');
const { getPlanLimits } = require('../services/planService');
const { getDocumentCount, updateStorageUsage, getStorageUsage } = require('../services/storageService');

// ── Concurrency limit for parallel embedding (same as worker) ──
const CONCURRENCY_LIMIT = 50;

/**
 * Process items with limited concurrency.
 * WHY: Firing all API calls at once would exhaust rate limits and
 * overwhelm the DB connection pool. This processes at most 50 items
 * simultaneously — a balance between speed and resource safety.
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
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

/**
 * Embed and store chunks in parallel batches.
 * WHY A SHARED HELPER: Both sync routes and the worker need the same
 * logic. Duplicating it would lead to drift. All routes call this.
 */
async function embedAndStoreChunks(chunks, documentId, customerId) {
  await pMap(chunks, async (chunk, index) => {
    const embedding = await generateEmbedding(chunk);
    const vectorString = '[' + embedding.join(',') + ']';
    await db.query(
      `INSERT INTO chunks (document_id, customer_id, content, embedding, chunk_index)
       VALUES ($1, $2, $3, $4::vector, $5)`,
      [documentId, customerId, chunk, vectorString, index]
    );
  }, CONCURRENCY_LIMIT);
}
// youtube.js uses dynamic import() internally — loaded lazily to avoid ESM issues
const { extractYouTubeTranscript } = require('../services/youtube');
const queueModule = require('../queue/queue');

// ── Multer config — store uploads in memory ─────────────────
// SECURITY: Triple validation — extension + MIME type + magic bytes
// The fileFilter checks extension and MIME; magic bytes are verified
// in the route handler after Multer has accepted the file.
const ALLOWED_FILE_TYPES = {
  '.pdf': ['application/pdf'],
  '.txt': ['text/plain', 'application/octet-stream'], // some systems send octet-stream for .txt
};
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB — strict cap to prevent memory explosion

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedMimes = ALLOWED_FILE_TYPES[ext];

    if (!allowedMimes) {
      return cb(new Error(
        `Unsupported file type: "${ext}". Only .pdf and .txt files are allowed.`
      ), false);
    }

    if (!allowedMimes.includes(file.mimetype)) {
      return cb(new Error(
        `MIME type mismatch: file "${file.originalname}" has extension "${ext}" but MIME type "${file.mimetype}". This may indicate a renamed file.`
      ), false);
    }

    cb(null, true);
  },
});

// ── Multer config — store Audio in memory ─────────────────────
const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB max (Whisper limit)
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio and video files are allowed'), false);
    }
  },
});

// All routes require authentication.
// NOTE: Previously GET requests without an Authorization header were allowed
// with a hardcoded test customer ID — that caused chunks to be stored under
// one ID and retrieved under another. Now ALL methods require a valid token
// so the customer_id always comes from the DB (single source of truth).
router.use(authenticate);

// ── Anti-Prompt-Injection Guard ──────────────────────────────
// Scans text fields in POST bodies for injection patterns BEFORE
// they get chunked and stored in pgvector. Suspicious content is
// wrapped in [USER_CONTENT_START]...[USER_CONTENT_END] markers so
// the Chat API's system prompt can ignore injected instructions.
router.use(promptInjectionGuard);

// ── Multer error-handling middleware ─────────────────────────
// Catches file-size limit errors and returns a clear 413 response
// instead of letting them fall through to the generic 500 handler.
function handleMulterError(err, _req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `File too large. Maximum allowed size is ${MAX_FILE_SIZE / (1024 * 1024)} MB.`,
        max_size_bytes: MAX_FILE_SIZE,
      });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    // Non-Multer errors (e.g. fileFilter rejection)
    return res.status(400).json({ error: err.message });
  }
  next();
}

// ──────────────────────────────────────────────────────────────
// POST /api/documents/upload-pdf
// Accept a PDF file, save to disk, enqueue for async processing
// Returns 202 Accepted immediately
// ──────────────────────────────────────────────────────────────
router.post('/upload-pdf', upload.single('file'), handleMulterError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file provided. Upload a file with field name "file".' });
    }

    const customerId = req.customer.id;
    const plan = req.customer.subscription_tier || req.customer.plan || 'free';
    const limits = getPlanLimits(plan);

    // ── Check 1: File size limit ──────────────────────────
    if (req.file.size > limits.max_file_mb * 1024 * 1024) {
      return res.status(413).json({
        error: `File too large. Maximum ${limits.max_file_mb}MB on your ${plan} plan.`,
      });
    }

    // ── Check 2: Source count limit ────────────────────────
    const currentSources = await getDocumentCount(customerId);
    if (currentSources >= limits.max_sources) {
      return res.status(403).json({
        error: `Maximum ${limits.max_sources} sources allowed on your ${plan} plan. Delete a document or upgrade.`,
      });
    }

    // ── Magic byte validation ─────────────────────────────────
    // PDF files MUST start with %PDF (hex: 25 50 44 46)
    // This catches renamed malicious files that passed MIME/extension checks
    const magicBytes = req.file.buffer.slice(0, 4).toString('ascii');
    if (magicBytes !== '%PDF') {
      return res.status(400).json({
        error: 'File content does not match PDF format. The file may be corrupted or is not a real PDF.',
      });
    }

    if (!queueModule.embeddingQueue || !queueModule.isRedisAvailable()) {
      return res.status(503).json({ error: 'Queue service unavailable — Redis is not connected. Please start Redis and try again.' });
    }

    const filename = req.file.originalname;

    // 1. Save PDF to uploads/ directory
    const fileId = randomUUID();
    const uploadDir = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, `${fileId}.pdf`);
    fs.writeFileSync(filePath, req.file.buffer);

    // 2. Create document record with 'queued' status
    const docResult = await db.query(
      `INSERT INTO documents (customer_id, filename, source_type, status)
       VALUES ($1, $2, 'pdf', 'queued')
       RETURNING id`,
      [customerId, filename]
    );
    const documentId = docResult.rows[0].id;

    // 3. Enqueue embedding job to BullMQ
    const job = await queueModule.embeddingQueue.add('embed-pdf', {
      type: 'pdf',
      doc_id: documentId,
      customer_id: customerId,
      filePath,
      filename,
    });

    // 4. Store job_id in document record
    await db.query(
      `UPDATE documents SET job_id = $1 WHERE id = $2`,
      [job.id, documentId]
    );

    // 5. Return 202 Accepted immediately
    res.status(202).json({
      message: 'PDF upload accepted — processing in background',
      document_id: documentId,
      job_id: job.id,
      status: 'queued',
      poll_url: `/api/documents/status/${documentId}`,
    });
  } catch (err) {
    console.error('upload-pdf error:', err);
    res.status(500).json({ error: 'Failed to queue PDF', details: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/documents/upload-file
// Unified upload endpoint: accepts both .pdf and .txt files
// PDF → async (queued), TXT → sync (small enough)
// ──────────────────────────────────────────────────────────────
router.post('/upload-file', upload.single('file'), handleMulterError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided. Upload a .pdf or .txt file with field name "file".' });
    }

    const customerId = req.customer.id;
    const plan = req.customer.subscription_tier || req.customer.plan || 'free';
    const limits = getPlanLimits(plan);

    // ── Check 1: File size limit ──────────────────────────
    if (req.file.size > limits.max_file_mb * 1024 * 1024) {
      return res.status(413).json({
        error: `File too large. Maximum ${limits.max_file_mb}MB on your ${plan} plan.`,
      });
    }

    // ── Check 2: Source count limit ────────────────────────
    const currentSources = await getDocumentCount(customerId);
    if (currentSources >= limits.max_sources) {
      return res.status(403).json({
        error: `Maximum ${limits.max_sources} sources allowed on your ${plan} plan. Delete a document or upgrade.`,
      });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const filename = req.file.originalname;

    if (ext === '.pdf') {
      // ── Magic byte validation for PDFs ────────────────────
      const magicBytes = req.file.buffer.slice(0, 4).toString('ascii');
      if (magicBytes !== '%PDF') {
        return res.status(400).json({
          error: 'File content does not match PDF format. The file may be corrupted or is not a real PDF.',
        });
      }

      if (!queueModule.embeddingQueue || !queueModule.isRedisAvailable()) {
        return res.status(503).json({ error: 'Queue service unavailable — Redis is not connected.' });
      }

      // Save to disk + enqueue (same as /upload-pdf)
      const fileId = randomUUID();
      const uploadDir = path.join(__dirname, '..', '..', 'uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filePath = path.join(uploadDir, `${fileId}.pdf`);
      fs.writeFileSync(filePath, req.file.buffer);

      const docResult = await db.query(
        `INSERT INTO documents (customer_id, filename, source_type, status)
         VALUES ($1, $2, 'pdf', 'queued') RETURNING id`,
        [customerId, filename]
      );
      const documentId = docResult.rows[0].id;

      const job = await queueModule.embeddingQueue.add('embed-pdf', {
        type: 'pdf', doc_id: documentId, customer_id: customerId, filePath, filename,
      });
      await db.query(`UPDATE documents SET job_id = $1 WHERE id = $2`, [job.id, documentId]);

      return res.status(202).json({
        message: 'PDF upload accepted — processing in background',
        document_id: documentId, job_id: job.id, status: 'queued',
        poll_url: `/api/documents/status/${documentId}`,
      });

    } else if (ext === '.txt') {
      // ── Binary content validation for TXT ─────────────────
      // Check for null bytes — real text files should never have them.
      // This catches binary files renamed to .txt.
      const textContent = req.file.buffer.toString('utf8');
      if (textContent.includes('\0')) {
        return res.status(400).json({
          error: 'File appears to be binary, not text. Only plain text .txt files are allowed.',
        });
      }

      if (textContent.trim().length === 0) {
        return res.status(400).json({ error: 'Text file is empty.' });
      }

      // TXT files are small — process synchronously
      const charCount = textContent.length;
      const docResult = await db.query(
        `INSERT INTO documents (customer_id, filename, source_type, status, char_count)
         VALUES ($1, $2, 'text', 'processing', $3) RETURNING id`,
        [customerId, filename, charCount]
      );
      const documentId = docResult.rows[0].id;

      // Update storage usage counter
      await updateStorageUsage(customerId, charCount);

      const chunks = await chunkText(textContent);
      await embedAndStoreChunks(chunks, documentId, customerId);

      await db.query(
        `UPDATE documents SET status = 'ready', chunk_count = $1 WHERE id = $2`,
        [chunks.length, documentId]
      );

      return res.status(201).json({
        message: 'Text file processed successfully',
        document_id: documentId,
        chunks_created: chunks.length,
        char_count: charCount
      });

    } else {
      // Should never reach here due to fileFilter, but just in case
      return res.status(400).json({ error: `Unsupported file type: ${ext}` });
    }
  } catch (err) {
    console.error('upload-file error:', err);
    res.status(500).json({ error: 'Failed to process file', details: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/documents/upload-audio
// Accept an audio file, save to disk, enqueue for async processing
// Returns 202 Accepted immediately
// ──────────────────────────────────────────────────────────────
router.post('/upload-audio', uploadAudio.single('file'), handleMulterError, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No Audio file provided. Upload a file with field name "file".' });
    }

    const customerId = req.customer.id;
    const plan = req.customer.subscription_tier || req.customer.plan || 'free';
    const limits = getPlanLimits(plan);

    // ── Check 1: File size limit ──────────────────────────
    if (req.file.size > limits.max_file_mb * 1024 * 1024) {
      return res.status(413).json({
        error: `File too large. Maximum ${limits.max_file_mb}MB on your ${plan} plan.`,
      });
    }

    // ── Check 2: Source count limit ────────────────────────
    const currentSources = await getDocumentCount(customerId);
    if (currentSources >= limits.max_sources) {
      return res.status(403).json({
        error: `Maximum ${limits.max_sources} sources allowed on your ${plan} plan. Delete a document or upgrade.`,
      });
    }

    if (!queueModule.embeddingQueue || !queueModule.isRedisAvailable()) {
      return res.status(503).json({ error: 'Queue service unavailable — Redis is not connected. Please start Redis and try again.' });
    }

    const filename = req.file.originalname;

    // 1. Save audio to uploads/ directory
    const fileId = randomUUID();
    const uploadDir = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    
    // We keep original extension because Whisper uses it to determine file type
    const ext = path.extname(filename) || '.mp3';
    const filePath = path.join(uploadDir, `${fileId}${ext}`);
    fs.writeFileSync(filePath, req.file.buffer);

    // 2. Create document record with 'queued' status
    const docResult = await db.query(
      `INSERT INTO documents (customer_id, filename, source_type, status)
       VALUES ($1, $2, 'audio', 'queued')
       RETURNING id`,
      [customerId, filename]
    );
    const documentId = docResult.rows[0].id;

    // 3. Enqueue embedding job to BullMQ
    const job = await queueModule.embeddingQueue.add('embed-audio', {
      type: 'audio',
      doc_id: documentId,
      customer_id: customerId,
      filePath,
      filename,
    });

    // 4. Store job_id in document record
    await db.query(
      `UPDATE documents SET job_id = $1 WHERE id = $2`,
      [job.id, documentId]
    );

    // 5. Return 202 Accepted immediately
    res.status(202).json({
      message: 'Audio upload accepted — processing in background',
      document_id: documentId,
      job_id: job.id,
      status: 'queued',
      poll_url: `/api/documents/status/${documentId}`,
    });
  } catch (err) {
    console.error('upload-audio error:', err);
    res.status(500).json({ error: 'Failed to queue Audio', details: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/documents/add-url
// Scrape a single URL, extract text, chunk, embed, store
// (Kept synchronous — single page is fast enough)
// ──────────────────────────────────────────────────────────────
router.post('/add-url', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'Missing required field: url' });
    }

    // ── URL format validation ──────────────────────────────────
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (_e) {
      return res.status(400).json({
        error: 'Invalid URL format. Please provide a valid URL (e.g. https://example.com).',
      });
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({
        error: `Unsupported URL protocol: "${parsedUrl.protocol}". Only http and https URLs are allowed.`,
      });
    }

    // Auto-detect YouTube URLs and redirect to transcript extraction
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');

    const customerId = req.customer.id;
    const plan = req.customer.subscription_tier || req.customer.plan || 'free';
    const limits = getPlanLimits(plan);

    // ── Check 1: Source count limit ────────────────────────
    const currentSources = await getDocumentCount(customerId);
    if (currentSources >= limits.max_sources) {
      return res.status(403).json({
        error: `Maximum ${limits.max_sources} sources allowed on your ${plan} plan. Delete a document or upgrade.`,
      });
    }

    let rawText;
    let sourceType = 'url';
    let videoId = null;

    if (isYouTube) {
      // Use transcript extractor instead of HTML scraping
      console.log('🎬 YouTube URL detected in /add-url — using transcript extractor');
      const result = await extractYouTubeTranscript(url);
      rawText = result.text;
      videoId = result.videoId;
      sourceType = 'youtube';
    } else {
      // Normal URL scraping
      rawText = await extractFromURL(url);
    }

    if (!rawText || rawText.trim().length === 0) {
      return res.status(400).json({
        error: isYouTube
          ? 'Could not extract transcript from YouTube video.'
          : 'Could not extract any text from the URL.'
      });
    }

    // ── Check 2: Character storage limit ────────────────────
    const charCount = rawText.length;
    const currentUsage = await getStorageUsage(customerId);
    if (currentUsage + charCount > limits.storage_chars) {
      return res.status(403).json({
        error: `Storage limit reached. You've used ${currentUsage.toLocaleString()} of ${limits.storage_chars.toLocaleString()} characters. Upgrade your plan for more storage.`,
      });
    }

    // 2. Create document record
    const docResult = await db.query(
      `INSERT INTO documents (customer_id, source_url, filename, source_type, status, char_count)
       VALUES ($1, $2, $3, $4, 'processing', $5)
       RETURNING id`,
      [customerId, url, videoId ? `YouTube: ${videoId}` : null, sourceType, charCount]
    );

    // Update storage usage counter
    await updateStorageUsage(customerId, charCount);
    const documentId = docResult.rows[0].id;

    // 3. Chunk the text
    const chunks = await chunkText(rawText);

    // 4. Embed and store chunks in parallel (50 concurrent)
    await embedAndStoreChunks(chunks, documentId, customerId);

    // 5. Update document status
    await db.query(
      `UPDATE documents SET status = 'ready', chunk_count = $1 WHERE id = $2`,
      [chunks.length, documentId]
    );

    res.status(201).json({
      message: isYouTube ? 'YouTube transcript processed successfully' : 'URL processed successfully',
      document_id: documentId,
      video_id: videoId,
      source_url: url,
      chunks_created: chunks.length,
    });
  } catch (err) {
    console.error('add-url error:', err);
    res.status(500).json({ error: 'Failed to process URL', details: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/documents/crawl-website
// Start a Puppeteer crawl of the entire site, processed async
// Returns 202 Accepted immediately
// ──────────────────────────────────────────────────────────────
router.post('/crawl-website', async (req, res) => {
  try {
    const { url, max_pages, max_depth } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'Missing required field: url' });
    }

    // Basic URL validation
    try { new URL(url); } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    if (!queueModule.embeddingQueue || !queueModule.isRedisAvailable()) {
      return res.status(503).json({ error: 'Queue service unavailable — Redis is not connected. Please start Redis and try again.' });
    }

    const customerId = req.customer.id;
    const plan = req.customer.subscription_tier || req.customer.plan || 'free';
    const limits = getPlanLimits(plan);

    // ── Check 1: Source count limit ────────────────────────
    const currentSources = await getDocumentCount(customerId);
    if (currentSources >= limits.max_sources) {
      return res.status(403).json({
        error: `Maximum ${limits.max_sources} sources allowed on your ${plan} plan. Delete a document or upgrade.`,
      });
    }

    // 1. Create document record with 'queued' status
    const docResult = await db.query(
      `INSERT INTO documents (customer_id, source_url, source_type, status)
       VALUES ($1, $2, 'crawl', 'queued')
       RETURNING id`,
      [customerId, url]
    );
    const documentId = docResult.rows[0].id;

    // 2. Enqueue crawl job
    const job = await queueModule.embeddingQueue.add('crawl-website', {
      type: 'crawl',
      doc_id: documentId,
      customer_id: customerId,
      rootUrl: url,
      maxPages: max_pages || parseInt(process.env.MAX_CRAWL_PAGES) || 100,
      maxDepth: max_depth || parseInt(process.env.MAX_CRAWL_DEPTH) || 5,
    });

    // 3. Store job_id
    await db.query(
      `UPDATE documents SET job_id = $1 WHERE id = $2`,
      [job.id, documentId]
    );

    res.status(202).json({
      message: 'Website crawl accepted — processing in background',
      document_id: documentId,
      job_id: job.id,
      status: 'queued',
      root_url: url,
      poll_url: `/api/documents/status/${documentId}`,
    });
  } catch (err) {
    console.error('crawl-website error:', err);
    res.status(500).json({ error: 'Failed to queue crawl', details: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/documents/add-youtube
// Fetch YouTube transcript, chunk, embed, store
// Synchronous — transcripts are small enough
// ──────────────────────────────────────────────────────────────
router.post('/add-youtube', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'Missing required field: url' });
    }

    // Validate it looks like a YouTube URL
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      return res.status(400).json({ error: 'Invalid YouTube URL. Provide a youtube.com or youtu.be link.' });
    }

    const customerId = req.customer.id;
    const plan = req.customer.subscription_tier || req.customer.plan || 'free';
    const limits = getPlanLimits(plan);

    // ── Check 1: Source count limit ────────────────────────
    const currentSources = await getDocumentCount(customerId);
    if (currentSources >= limits.max_sources) {
      return res.status(403).json({
        error: `Maximum ${limits.max_sources} sources allowed on your ${plan} plan. Delete a document or upgrade.`,
      });
    }

    // 1. Fetch transcript
    let videoId, text;
    try {
      ({ videoId, text } = await extractYouTubeTranscript(url));
    } catch (ytErr) {
      return res.status(400).json({ error: 'Failed to fetch YouTube transcript', details: ytErr.message });
    }

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Could not extract transcript from the YouTube video.' });
    }

    // ── Check 2: Character storage limit ────────────────────
    const charCount = text.length;
    const currentUsage = await getStorageUsage(customerId);
    if (currentUsage + charCount > limits.storage_chars) {
      return res.status(403).json({
        error: `Storage limit reached. You've used ${currentUsage.toLocaleString()} of ${limits.storage_chars.toLocaleString()} characters. Upgrade your plan for more storage.`,
      });
    }

    // 2. Create document record
    const docResult = await db.query(
      `INSERT INTO documents (customer_id, source_url, filename, source_type, status, char_count)
       VALUES ($1, $2, $3, 'youtube', 'processing', $4)
       RETURNING id`,
      [customerId, url, `YouTube: ${videoId}`, charCount]
    );

    // Update storage usage counter
    await updateStorageUsage(customerId, charCount);
    const documentId = docResult.rows[0].id;

    // 3. Chunk the transcript
    const chunks = await chunkText(text);

    // 4. Embed and store each chunk
    await embedAndStoreChunks(chunks, documentId, customerId);

    // 5. Update document status
    await db.query(
      `UPDATE documents SET status = 'ready', chunk_count = $1 WHERE id = $2`,
      [chunks.length, documentId]
    );

    res.status(201).json({
      message: 'YouTube video processed successfully',
      document_id: documentId,
      video_id: videoId,
      source_url: url,
      chunks_created: chunks.length,
    });
  } catch (err) {
    console.error('add-youtube error:', err);
    res.status(500).json({ error: 'Failed to process YouTube video', details: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/documents/add-text
// Accept raw text, chunk, embed, store
// ──────────────────────────────────────────────────────────────
router.post('/add-text', async (req, res) => {
  try {
    const { text, title } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Missing required field: text' });
    }

    const customerId = req.customer.id;
    const plan = req.customer.subscription_tier || req.customer.plan || 'free';
    const limits = getPlanLimits(plan);

    // ── Check 1: Source count limit ────────────────────────
    const currentSources = await getDocumentCount(customerId);
    if (currentSources >= limits.max_sources) {
      return res.status(403).json({
        error: `Maximum ${limits.max_sources} sources allowed on your ${plan} plan. Delete a document or upgrade.`,
      });
    }

    // 1. Clean the text
    const rawText = await extractFromText(text);

    if (rawText.length === 0) {
      return res.status(400).json({ error: 'Provided text is empty after trimming.' });
    }

    // ── Check 2: Character storage limit ────────────────────
    const charCount = rawText.length;
    const currentUsage = await getStorageUsage(customerId);
    if (currentUsage + charCount > limits.storage_chars) {
      return res.status(403).json({
        error: `Storage limit reached. You've used ${currentUsage.toLocaleString()} of ${limits.storage_chars.toLocaleString()} characters. Upgrade your plan for more storage.`,
      });
    }

    // 2. Create document record
    const docResult = await db.query(
      `INSERT INTO documents (customer_id, filename, source_type, status, char_count)
       VALUES ($1, $2, 'text', 'processing', $3)
       RETURNING id`,
      [customerId, title || 'Untitled', charCount]
    );

    // Update storage usage counter
    await updateStorageUsage(customerId, charCount);
    const documentId = docResult.rows[0].id;

    // 3. Chunk the text
    const chunks = await chunkText(rawText);

    // 4. Embed and store each chunk
    await embedAndStoreChunks(chunks, documentId, customerId);

    // 5. Update document status
    await db.query(
      `UPDATE documents SET status = 'ready', chunk_count = $1 WHERE id = $2`,
      [chunks.length, documentId]
    );

    res.status(201).json({
      message: 'Text processed successfully',
      document_id: documentId,
      title: title || 'Untitled',
      chunks_created: chunks.length,
    });
  } catch (err) {
    console.error('add-text error:', err);
    res.status(500).json({ error: 'Failed to process text', details: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /api/documents/status/:id
// Poll document processing status (for async jobs)
// ──────────────────────────────────────────────────────────────
router.get('/status/:id', async (req, res) => {
  try {
    const customerId = req.customer.id;
    const documentId = req.params.id;

    const result = await db.query(
      `SELECT id, filename, source_url, source_type, status, job_id,
              chunk_count, error_message, created_at
       FROM documents
       WHERE id = $1 AND customer_id = $2`,
      [documentId, customerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = result.rows[0];

    res.json({
      document_id: doc.id,
      filename: doc.filename,
      source_url: doc.source_url,
      source_type: doc.source_type,
      status: doc.status,
      job_id: doc.job_id,
      chunk_count: doc.chunk_count,
      error_message: doc.error_message,
      created_at: doc.created_at,
    });
  } catch (err) {
    console.error('status error:', err);
    res.status(500).json({ error: 'Failed to get document status', details: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// GET /api/documents
// List all documents for the authenticated customer
// ──────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const customerId = req.customer.id;

    const result = await db.query(
      `SELECT id, filename, source_url, source_type, status, chunk_count,
              job_id, error_message, created_at
       FROM documents
       WHERE customer_id = $1
       ORDER BY created_at DESC`,
      [customerId]
    );

    res.json({
      count: result.rows.length,
      documents: result.rows,
    });
  } catch (err) {
    console.error('list-documents error:', err);
    res.status(500).json({ error: 'Failed to list documents', details: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// DELETE /api/documents/:id
// Delete a document and all its chunks (cascade)
// ──────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const customerId = req.customer.id;
    const documentId = req.params.id;

    // Verify the document belongs to this customer and get its char_count
    const docCheck = await db.query(
      'SELECT id, char_count FROM documents WHERE id = $1 AND customer_id = $2',
      [documentId, customerId]
    );

    if (docCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found or does not belong to you' });
    }

    const charCount = docCheck.rows[0].char_count || 0;

    // ── Cache invalidation ──────────────────────────────────
    // WHY: When a user deletes a document, we should clean up the
    // Redis embedding cache entries for its chunks. We fetch the
    // chunk texts BEFORE deletion (CASCADE will remove them from
    // Postgres). Then we hash each text and delete the Redis key.
    //
    // NOTE: If another document shares identical chunk text, its
    // cache entry gets deleted too. This is acceptable — the next
    // access will simply re-generate and re-cache the embedding
    // (one extra API call, not a correctness issue).
    const chunkResult = await db.query(
      'SELECT content FROM chunks WHERE document_id = $1',
      [documentId]
    );
    const chunkTexts = chunkResult.rows.map(r => r.content);

    // Chunks are removed via ON DELETE CASCADE
    await db.query('DELETE FROM documents WHERE id = $1', [documentId]);

    // Update customer's storage usage counter (subtract characters)
    if (charCount > 0) {
      await updateStorageUsage(customerId, -charCount);
    }

    // Invalidate cache AFTER successful DB delete (best-effort)
    await invalidateEmbeddingCache(chunkTexts);

    res.json({ message: 'Document and all its chunks deleted', document_id: documentId });
  } catch (err) {
    console.error('delete-document error:', err);
    res.status(500).json({ error: 'Failed to delete document', details: err.message });
  }
});

// ── SSE endpoint for real-time document status updates ────────
const { sseHandler } = require('./sse');
router.get('/events', sseHandler);

module.exports = router;
