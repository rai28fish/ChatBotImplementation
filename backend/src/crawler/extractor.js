const cheerio = require('cheerio');

// Tags whose entire subtree we remove before extracting text
const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  'nav', 'header', 'footer',
  '.nav', '.header', '.footer', '.navbar', '.sidebar',
  '.cookie-banner', '.cookie-notice', '.gdpr',
  '.popup', '.modal', '.overlay',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '.advertisement', '.ad', '#ad',
  'form[action*="search"]',
];

// Preferred content containers (tried in order)
const CONTENT_SELECTORS = [
  'main', 'article', '[role="main"]',
  '.content', '#content', '.main-content', '#main-content',
  '.post-content', '.entry-content', '.page-content',
  '.container', '#container',
];

const MIN_CONTENT_WORDS = 30;

/**
 * Extract clean text content and metadata from raw HTML.
 * @param {string} html - Raw HTML string
 * @param {string} url - Page URL (for context)
 * @returns {{ title: string, content: string, wordCount: number, isUseful: boolean }}
 */
function extractContent(html, url) {
  const $ = cheerio.load(html);

  // Extract title before removing nodes
  const title = $('title').text().trim()
    || $('h1').first().text().trim()
    || new URL(url).pathname;

  // Remove all noise elements
  $(NOISE_SELECTORS.join(', ')).remove();

  // Find the best content container
  let contentEl = null;
  for (const selector of CONTENT_SELECTORS) {
    const el = $(selector).first();
    if (el.length && el.text().trim().split(/\s+/).length >= MIN_CONTENT_WORDS) {
      contentEl = el;
      break;
    }
  }

  // Fall back to body
  if (!contentEl) {
    contentEl = $('body');
  }

  // Extract and normalize text
  const rawText = contentEl.text();
  const content = normalizeWhitespace(rawText);
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const isUseful = wordCount >= MIN_CONTENT_WORDS;

  return { title, content, wordCount, isUseful };
}

/**
 * Extract all href links from an HTML page.
 * @param {string} html
 * @param {string} baseUrl - Used to resolve relative URLs
 * @returns {string[]} Array of absolute URLs
 */
function extractLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = new Set();
  const base = new URL(baseUrl);

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl);
      // Only include http/https links on the same hostname
      if (
        (resolved.protocol === 'http:' || resolved.protocol === 'https:') &&
        resolved.hostname === base.hostname
      ) {
        links.add(normalizeUrl(resolved));
      }
    } catch {
      // Ignore malformed URLs
    }
  });

  return Array.from(links);
}

/**
 * Normalize a URL: remove fragment, trailing slash (except root), sort params.
 * We also strip all query params per spec.
 */
function normalizeUrl(urlObj) {
  const u = new URL(urlObj.toString());
  u.hash = '';
  u.search = '';
  // Remove trailing slash except for root
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.toString();
}

function normalizeWhitespace(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')         // collapse multiple spaces
    .replace(/\n{3,}/g, '\n\n')        // collapse 3+ newlines to 2
    .trim();
}

module.exports = { extractContent, extractLinks, normalizeUrl };
