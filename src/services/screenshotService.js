/**
 * SupportGenie — Screenshot Service
 *
 * Takes a browser screenshot of a given URL using Puppeteer.
 * Used in the onboarding wizard to show the customer's website
 * with the Kira widget overlaid (Noupe-style preview).
 */

const path = require('path');
const fs = require('fs');

// Lazy-load puppeteer — it's a heavy dep so we only require it when needed
let puppeteer;
function getPuppeteer() {
  if (!puppeteer) {
    try {
      puppeteer = require('puppeteer');
    } catch {
      try {
        puppeteer = require('puppeteer-core');
      } catch {
        throw new Error('Neither puppeteer nor puppeteer-core is installed');
      }
    }
  }
  return puppeteer;
}

const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'uploads', 'screenshots');

/**
 * Take a screenshot of a URL and save it to disk.
 *
 * @param {string} url - The URL to screenshot
 * @param {string} customerId - Used as the filename
 * @returns {Promise<{filePath: string, relativePath: string}>}
 */
async function takeScreenshot(url, customerId) {
  // Ensure directory exists
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const pup = getPuppeteer();
  let browser;

  try {
    browser = await pup.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();

    // Desktop viewport for a nice preview
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

    // Navigate with a generous timeout (some sites are slow)
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Wait longer for animations/splash screens to finish, lazy images to load
    await new Promise(r => setTimeout(r, 6000));

    const fileName = `${customerId}.png`;
    const filePath = path.join(SCREENSHOT_DIR, fileName);

    await page.screenshot({
      path: filePath,
      type: 'png',
      fullPage: false, // Just the viewport — looks cleaner
    });

    console.log(`[Screenshot] ✅ Captured ${url} → ${fileName}`);

    return {
      filePath,
      relativePath: `/uploads/screenshots/${fileName}`,
    };
  } catch (err) {
    console.error(`[Screenshot] ❌ Failed for ${url}:`, err.message);
    throw err;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = { takeScreenshot };
