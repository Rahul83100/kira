/**
 * YouTube transcript extractor.
 * 
 * Note: youtube-transcript is an ESM-only package.
 * We use dynamic import() to load it from our CommonJS codebase.
 */

let _YoutubeTranscript = null;

/**
 * Lazily load the ESM youtube-transcript module.
 * We import the .esm.js file directly because the package's CJS entry
 * is broken on Node v24 (uses `exports` in an ESM-flagged package).
 */
async function getYoutubeTranscript() {
  if (!_YoutubeTranscript) {
    const mod = await import('youtube-transcript/dist/youtube-transcript.esm.js');
    _YoutubeTranscript = mod.YoutubeTranscript;
  }
  return _YoutubeTranscript;
}

/**
 * Extract the full transcript text from a YouTube video URL.
 *
 * @param {string} url - A YouTube video URL (e.g. https://www.youtube.com/watch?v=abc123)
 * @returns {Promise<{ videoId: string, text: string }>}
 * @throws {Error} If the URL is invalid or no transcript is available
 */
async function extractYouTubeTranscript(url) {
  const videoId = parseVideoId(url);
  if (!videoId) {
    throw new Error(`Invalid YouTube URL: ${url}`);
  }

  console.log(`🎬 Fetching transcript for video: ${videoId}`);

  const YT = await getYoutubeTranscript();
  const segments = await YT.fetchTranscript(videoId);

  if (!segments || segments.length === 0) {
    throw new Error(`No transcript available for video: ${videoId}`);
  }

  // Concatenate all transcript segments into a single text block
  const text = segments
    .map((seg) => seg.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  console.log(`🎬 Transcript fetched: ${segments.length} segments, ${text.length} chars`);

  return { videoId, text };
}

/**
 * Parse a YouTube video ID from various URL formats:
 *   - https://www.youtube.com/watch?v=VIDEO_ID
 *   - https://youtu.be/VIDEO_ID
 *   - https://www.youtube.com/embed/VIDEO_ID
 *   - https://www.youtube.com/v/VIDEO_ID
 *
 * @param {string} url
 * @returns {string|null}
 */
function parseVideoId(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);

    // youtube.com/watch?v=...
    if (parsed.hostname.includes('youtube.com') && parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v');
    }

    // youtu.be/VIDEO_ID
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1);
    }

    // youtube.com/embed/VIDEO_ID or youtube.com/v/VIDEO_ID
    const embedMatch = parsed.pathname.match(/\/(embed|v)\/([^/?]+)/);
    if (embedMatch) {
      return embedMatch[2];
    }
  } catch {
    // Not a valid URL
  }

  return null;
}

module.exports = { extractYouTubeTranscript, parseVideoId };
