/**
 * ═══════════════════════════════════════════════════════════════
 * SupportGenie — Custom Text Chunker (Zero-Dependency)
 * ═══════════════════════════════════════════════════════════════
 *
 * REPLACES: @langchain/textsplitters RecursiveCharacterTextSplitter
 *
 * WHY THIS WAS REWRITTEN:
 * ───────────────────────
 * The LangChain dependency tree pulls in @langchain/core (2MB+),
 * which has known crash issues with certain Node.js versions and
 * causes intermittent failures in worker_threads. This custom
 * implementation is:
 *   - Zero dependencies (pure JS, no npm packages)
 *   - Drop-in compatible (same API: chunkText(text, options))
 *   - Same algorithm (recursive character splitting with overlap)
 *   - Battle-tested separators: \n\n → \n → . → ' ' → ''
 *
 * ALGORITHM — Recursive Character Text Splitting:
 * ─────────────────────────────────────────────────
 * 1. Try to split text by the current separator (e.g., \n\n)
 * 2. Walk through the resulting segments, accumulating them into
 *    chunks that don't exceed chunkSize
 * 3. When a segment would overflow the current chunk:
 *    a. Save the current chunk (with overlap from previous)
 *    b. Start a new chunk
 * 4. If any single segment is still too large, recurse with the
 *    NEXT separator in the hierarchy (e.g., \n → . → ' ')
 * 5. Base case: if no separators left, hard-split by chunkSize
 *
 * OVERLAP:
 * ────────
 * Each chunk overlaps with the previous by `chunkOverlap` characters.
 * This ensures that context at chunk boundaries isn't lost during
 * RAG retrieval. For example, with overlap=50, if a sentence spans
 * a chunk boundary, it appears in both chunks.
 * ═══════════════════════════════════════════════════════════════
 */

// ── Default separators, ordered from largest to smallest ────
// This is the same hierarchy LangChain uses. We try \n\n first
// (paragraph boundaries), then \n (line breaks), then sentence
// endings (. followed by space), then word boundaries, then
// individual characters as a last resort.
const DEFAULT_SEPARATORS = ['\n\n', '\n', '. ', ' ', ''];

/**
 * Split text into overlapping chunks using recursive character splitting.
 *
 * @param {string} text                      - The full document text
 * @param {object} [options]
 * @param {number} [options.chunkSize=500]   - Target max chunk size in characters
 * @param {number} [options.chunkOverlap=50] - Overlap between consecutive chunks
 * @param {string[]} [options.separators]    - Custom separator hierarchy
 * @returns {Promise<string[]>}              - Array of chunk strings
 */
async function chunkText(text, { chunkSize = 500, chunkOverlap = 50, separators } = {}) {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const seps = separators || DEFAULT_SEPARATORS;
  const chunks = recursiveSplit(text, seps, chunkSize, chunkOverlap);

  // Final cleanup: trim whitespace, remove empty chunks
  return chunks
    .map(c => c.trim())
    .filter(c => c.length > 0);
}

/**
 * Core recursive splitting logic.
 *
 * @param {string} text           - Text to split
 * @param {string[]} separators   - Remaining separators to try
 * @param {number} chunkSize      - Max chunk size
 * @param {number} chunkOverlap   - Overlap between chunks
 * @returns {string[]}            - Array of chunks
 */
function recursiveSplit(text, separators, chunkSize, chunkOverlap) {
  // Base case: text fits in a single chunk
  if (text.length <= chunkSize) {
    return [text];
  }

  // ── Find the best separator ────────────────────────────────
  // "Best" = the first separator in the hierarchy that actually
  // appears in the text. This gives us the largest semantic units.
  let chosenSeparator = '';
  let remainingSeparators = [];

  for (let i = 0; i < separators.length; i++) {
    const sep = separators[i];
    if (sep === '' || text.includes(sep)) {
      chosenSeparator = sep;
      remainingSeparators = separators.slice(i + 1);
      break;
    }
  }

  // ── Split by the chosen separator ──────────────────────────
  let segments;
  if (chosenSeparator === '') {
    // Last resort: split into individual characters, then re-group
    segments = text.match(new RegExp(`.{1,${chunkSize}}`, 'gs')) || [text];
  } else {
    segments = text.split(chosenSeparator);
  }

  // ── Merge segments into chunks ─────────────────────────────
  // Walk through segments, accumulating into a buffer. When the
  // buffer would exceed chunkSize, flush it as a chunk and start
  // a new buffer (keeping overlap from the end of the previous).
  const chunks = [];
  let currentParts = [];

  for (const segment of segments) {
    // Calculate what the total length would be if we add this segment
    const projectedLength = getJoinedLength(currentParts, segment, chosenSeparator);

    // If adding this segment would overflow...
    if (projectedLength > chunkSize && currentParts.length > 0) {
      // Flush the current buffer as a chunk
      const chunkStr = joinParts(currentParts, chosenSeparator);
      chunks.push(chunkStr);

      // ── Build overlap ────────────────────────────────────
      // Keep trailing parts from the current buffer that fit
      // within chunkOverlap. This creates the overlap region.
      currentParts = getOverlapParts(currentParts, chosenSeparator, chunkOverlap);
    }

    // If a single segment is too large, recurse with finer separators
    if (segment.length > chunkSize) {
      // Flush any accumulated parts first
      if (currentParts.length > 0) {
        chunks.push(joinParts(currentParts, chosenSeparator));
        currentParts = [];
      }

      // Recursively split the oversized segment
      if (remainingSeparators.length > 0) {
        const subChunks = recursiveSplit(segment, remainingSeparators, chunkSize, chunkOverlap);
        chunks.push(...subChunks);
      } else {
        // Absolute last resort: hard-split by chunkSize
        for (let j = 0; j < segment.length; j += chunkSize - chunkOverlap) {
          chunks.push(segment.slice(j, j + chunkSize));
        }
      }
    } else {
      currentParts.push(segment);
    }
  }

  // Don't forget the last buffer
  if (currentParts.length > 0) {
    const remaining = joinParts(currentParts, chosenSeparator);
    if (remaining.trim().length > 0) {
      chunks.push(remaining);
    }
  }

  return chunks;
}

/**
 * Calculate what the joined length would be if we add a new segment.
 *
 * @param {string[]} parts       - Current accumulated parts
 * @param {string} newSegment    - Segment we're considering adding
 * @param {string} separator     - Separator used between parts
 * @returns {number}             - Projected total length
 */
function getJoinedLength(parts, newSegment, separator) {
  const allParts = [...parts, newSegment];
  return joinParts(allParts, separator).length;
}

/**
 * Join segment parts back together with the separator.
 *
 * @param {string[]} parts      - Array of text segments
 * @param {string} separator    - Separator to join with
 * @returns {string}            - Joined text
 */
function joinParts(parts, separator) {
  if (separator === '') {
    return parts.join('');
  }
  return parts.join(separator);
}

/**
 * Get trailing parts that fit within the overlap window.
 *
 * WHY FROM THE END:
 * The overlap should be the END of the previous chunk, so the
 * beginning of the next chunk has context from what came before.
 *
 * @param {string[]} parts       - Current accumulated parts
 * @param {string} separator     - Separator used
 * @param {number} overlapSize   - Max overlap in characters
 * @returns {string[]}           - Parts to carry over
 */
function getOverlapParts(parts, separator, overlapSize) {
  if (overlapSize <= 0) return [];

  const overlapParts = [];
  let overlapLength = 0;

  // Walk backwards through parts, adding until we exceed overlap
  for (let i = parts.length - 1; i >= 0; i--) {
    const partLen = parts[i].length + (separator !== '' ? separator.length : 0);
    if (overlapLength + partLen > overlapSize && overlapParts.length > 0) {
      break;
    }
    overlapParts.unshift(parts[i]);
    overlapLength += partLen;
  }

  return overlapParts;
}

module.exports = { chunkText };
