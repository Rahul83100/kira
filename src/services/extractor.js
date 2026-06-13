const pdfParse = require('pdf-parse');
const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Extract readable text from a PDF file buffer.
 * @param {Buffer} buffer - The PDF file buffer
 * @returns {Promise<string>} Extracted plain text
 */
async function extractFromPDF(buffer) {
  const data = await pdfParse(buffer);
  return data.text;
}

/**
 * Fallback: use Puppeteer (headless Chrome) to extract text from JS-rendered pages.
 * Also used as primary for the onboarding screenshot, so puppeteer is already available.
 */
let puppeteer;
function getPuppeteer() {
  if (!puppeteer) {
    try {
      puppeteer = require('puppeteer');
    } catch {
      try {
        puppeteer = require('puppeteer-core');
      } catch {
        return null;
      }
    }
  }
  return puppeteer;
}

async function extractWithPuppeteer(url) {
  const pup = getPuppeteer();
  if (!pup) return null;

  let browser;
  try {
    browser = await pup.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait for JS to finish rendering
    await new Promise(r => setTimeout(r, 3000));

    // Extract visible text from the rendered page
    const text = await page.evaluate(() => {
      // Remove non-content elements before extracting text
      const clone = document.body.cloneNode(true);
      const removals = clone.querySelectorAll('script, style, nav, footer, header, aside, iframe, noscript, svg, [role="navigation"], .cookie-banner, .popup');
      removals.forEach(el => el.remove());
      return clone.innerText || clone.textContent || '';
    });

    return text.replace(/\s+/g, ' ').trim();
  } catch (err) {
    console.warn('[Extractor] Puppeteer fallback failed:', err.message);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Fetch a URL and extract readable text content (strip HTML, scripts, styles, nav, etc.).
 * Tries axios + cheerio first (fast, lightweight), falls back to Puppeteer for JS-rendered sites.
 * @param {string} url - The URL to scrape
 * @returns {Promise<string>} Extracted plain text
 */
async function extractFromURL(url) {
  // Try with a browser-like UA first (many sites block bot UAs)
  const userAgents = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'SupportGenie-Bot/1.0',
  ];

  let lastError;
  for (const ua of userAgents) {
    try {
      const { data } = await axios.get(url, {
        timeout: 20000,
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        maxRedirects: 5,
      });

      if (!data || typeof data !== 'string') continue;

      const $ = cheerio.load(data);

      // Remove non-content elements
      $('script, style, nav, footer, header, aside, iframe, noscript, svg, [role="navigation"], .cookie-banner, .popup').remove();

      // Get body text and normalise whitespace
      let text = $('body').text().replace(/\s+/g, ' ').trim();

      // If body text is too short, try to extract from meta tags as a fallback
      if (text.length < 50) {
        const title = $('title').text().trim();
        const metaDesc = $('meta[name="description"]').attr('content') || '';
        const ogDesc = $('meta[property="og:description"]').attr('content') || '';
        const h1 = $('h1').first().text().trim();
        const fallback = [title, h1, metaDesc, ogDesc].filter(Boolean).join('. ');
        if (fallback.length > text.length) text = fallback;
      }

      if (text.length > 10) return text;
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  // ── Puppeteer fallback for JS-rendered sites ──
  // If axios returned too little text or failed, the site likely requires JS.
  // Use headless Chrome to render the page and extract text.
  console.log(`[Extractor] ⚠️ Axios returned little/no text for ${url}, trying Puppeteer fallback...`);
  const puppeteerText = await extractWithPuppeteer(url);
  if (puppeteerText && puppeteerText.length > 10) {
    console.log(`[Extractor] ✅ Puppeteer fallback succeeded: ${puppeteerText.length} chars`);
    return puppeteerText;
  }

  if (lastError) throw lastError;
  return puppeteerText || '';
}

/**
 * Passthrough for raw text — just trims whitespace.
 * @param {string} text - Raw text input
 * @returns {Promise<string>}
 */
async function extractFromText(text) {
  return text.trim();
}

module.exports = { extractFromPDF, extractFromURL, extractFromText };
