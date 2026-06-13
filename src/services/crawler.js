const { PlaywrightCrawler, RequestQueue } = require('crawlee');
const TurndownService = require('turndown');
const { URL } = require('url');

/**
 * Crawl a website using the Crawlee framework.
 *
 * - Uses Playwright to handle Client-Side Rendering (CSR)
 * - Converts HTML to Markdown using Turndown
 * - Managed concurrency and automatic link discovery
 * - Same-hostname restriction
 * - Returns all crawled pages as a single array for embedding processing
 *
 * @param {string} rootUrl     - Starting URL (e.g. 'https://docs.example.com')
 * @param {object} [options]
 * @param {number} [options.maxPages=100]  - Max pages to crawl
 * @param {number} [options.maxDepth=5]    - Max link depth from root
 * @returns {Promise<Array<{url: string, text: string}>>} Crawled pages in markdown
 */
async function crawlWebsite(rootUrl, { maxPages = 100, maxDepth = 5 } = {}) {
  const rootParsed = new URL(rootUrl);
  const rootHostname = rootParsed.hostname;

  const results = [];
  const failedPages = [];
  const requestQueue = await RequestQueue.open();
  await requestQueue.addRequest({ url: normalizeUrl(rootUrl), userData: { depth: 0 } });

  // Common file extensions to skip
  const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|tar|gz|mp4|mp3|css|js|woff2?|ttf|eot)$/i;

  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  });

  // Remove unwanted elements before turndown converts HTML
  // NOTE: We keep nav, footer, header for now because they often contain vital business info
  turndownService.remove(['script', 'style', 'iframe', 'noscript', 'svg']);

  const crawler = new PlaywrightCrawler({
    requestQueue,
    maxRequestsPerCrawl: maxPages,
    maxConcurrency: 5,
    
    // Increased timeouts for heavier business websites
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 120,

    maxRequestRetries: 3,
    
    // Performance: block unnecessary resources but allow stylesheets for better structure
    preNavigationHooks: [
      async ({ page, request }) => {
        await page.route('**/*', (route) => {
          const type = route.request().resourceType();
          if (['image', 'font', 'media'].includes(type)) {
            route.abort();
          } else {
            route.continue();
          }
        });
      },
    ],

    async requestHandler({ request, page, enqueueLinks, log }) {
      const { url, userData } = request;
      const depth = userData.depth || 0;

      log.info(`🕷  Crawling [depth=${depth}] ${url}`);

      // Extract HTML content after the page has fully settled
      try {
        await page.waitForLoadState('networkidle', { timeout: 30000 });
        // Extra beat for client-side rendering/animations
        await page.waitForTimeout(1500); 
      } catch (e) {
        log.warn(`🕒 Timeout waiting for networkidle on ${url}, proceeding with partial load.`);
      }

      const html = await page.content();

      // Convert the HTML to Markdown
      const markdown = turndownService.turndown(html);
      
      if (markdown && markdown.length > 50) {
        results.push({ url, text: markdown });
      }

      // Enqueue more links if we haven't reached max depth
      if (depth < maxDepth) {
        await enqueueLinks({
          selector: 'a[href]',
          globs: [`${rootParsed.origin}/**`],
          transformRequestFunction: (req) => {
            const normalized = normalizeUrl(req.url);
            if (SKIP_EXTENSIONS.test(normalized)) return false;
            req.url = normalized;
            req.userData = { depth: depth + 1 };
            return req;
          },
        });
      }
    },

    // ── Track failed pages instead of silently dropping them ───
    // WHY: Visibility. The caller (embeddingWorker) needs to know
    // which pages couldn't be crawled so it can log them and include
    // the info in the job result for debugging.
    failedRequestHandler({ request, log }) {
      const retries = request.retryCount || 0;
      log.error(`⚠  Page failed after ${retries} retries: ${request.url}`);
      failedPages.push({
        url: request.url,
        retries,
        error: request.errorMessages?.slice(-1)[0] || 'Unknown error',
      });
    },
  });

  try {
    await crawler.run();
  } finally {
    // Cleanup the queue
    await requestQueue.drop();
  }

  if (failedPages.length > 0) {
    console.warn(`🕷  Crawl: ${failedPages.length} page(s) failed after retries:`);
    failedPages.forEach(fp => console.warn(`     ⚠ ${fp.url} (${fp.retries} retries): ${fp.error}`));
  }

  console.log(`🕷  Crawl complete: ${results.length} pages from ${rootUrl} (${failedPages.length} failed)`);
  return { pages: results, failedPages };
}

/**
 * Normalize a URL for deduplication:
 * - Strip fragments (#...)
 * - Strip trailing slashes (except root path)
 */
function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return rawUrl;
  }
}

module.exports = { crawlWebsite };
