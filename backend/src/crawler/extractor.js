const cheerio = require('cheerio');

// Tags whose entire subtree we remove before extracting text
const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  'nav', 'header', 'footer',
  '.nav', '.header', '.footer', '.navbar', '.sidebar',
  // WordPress / common CMS navigation
  '#masthead', '#site-header', '#site-footer', '#colophon',
  '.site-header', '.site-footer', '.site-navigation',
  '.main-navigation', '.primary-navigation', '.secondary-navigation',
  '.menu', '.menu-container', '#menu', '.nav-menu',
  '.wp-block-navigation', '.wp-block-navigation__container',
  '.navigation', '.nav-bar', '.top-bar', '.bottom-bar',
  // Sidebars & widgets
  '.sidebar', '#sidebar', 'aside', '.widget', '.widget-area',
  // Breadcrumbs, pagination, social share
  '.breadcrumb', '.breadcrumbs', '.pagination', '.page-numbers',
  '.social-share', '.share-buttons', '.post-navigation',
  // Cookie / GDPR / overlays
  '.cookie-banner', '.cookie-notice', '.gdpr', '.consent',
  '.popup', '.modal', '.overlay', '.banner',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '[role="complementary"]',
  '.advertisement', '.ad', '.ads', '#ad', '#ads',
  'form[action*="search"]',
];

// Preferred content containers (tried in order, most specific first)
const CONTENT_SELECTORS = [
  'main', 'article', '[role="main"]',
  // WordPress specific
  '.entry-content', '.post-content', '.page-content', '.wp-block-post-content',
  '#primary .hentry', '.hentry',
  // Generic CMS
  '.content', '#content', '.main-content', '#main-content',
  '.article-content', '.article-body', '.post-body',
  '.page-body', '#page-content',
  '.container main', '.container article',
  '.container', '#container', '#wrapper',
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
  const content = stripLeadingNavBoilerplate(normalizeWhitespace(rawText));
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

/**
 * Remove leading lines that look like nav menu items (very short, no punctuation).
 * Stops as soon as it hits a line that looks like real content.
 */
function stripLeadingNavBoilerplate(text) {
  const lines = text.split('\n');
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const words = line.split(/\s+/).filter(Boolean);
    // Nav lines: ≤5 words, no sentence-ending punctuation, no digits
    const looksLikeNav = words.length <= 5 && !/[.!?,:;]/.test(line) && !/\d/.test(line);
    if (!looksLikeNav) { start = i; break; }
    start = i + 1;
  }
  return lines.slice(start).join('\n').trim();
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
