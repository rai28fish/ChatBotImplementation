const axios = require('axios');
const { extractContent, extractLinks, normalizeUrl } = require('./extractor');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Parse robots.txt content and return a checker function.
 */
function parseRobotsTxt(content) {
  const disallow = [];
  const allow = [];
  const lines = content.split('\n');
  let applicable = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === 'user-agent') {
      applicable = value === '*' || value.toLowerCase().includes('chatbot');
    } else if (applicable) {
      if (field === 'disallow' && value) disallow.push(value);
      else if (field === 'allow' && value) allow.push(value);
    }
  }

  return function isAllowed(url) {
    try {
      const pathname = new URL(url).pathname;
      // Allow rules take precedence over disallow
      for (const a of allow) {
        if (pathname.startsWith(a)) return true;
      }
      for (const d of disallow) {
        if (pathname.startsWith(d)) return false;
      }
      return true;
    } catch {
      return false;
    }
  };
}

/**
 * Check if a URL should be skipped based on configured patterns.
 */
function shouldSkipUrl(url) {
  return config.skipPatterns.some((pattern) => pattern.test(url));
}

/**
 * Fetch a URL with retry logic.
 */
async function fetchWithRetry(url, retries = config.crawler.maxRetries) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: config.crawler.requestTimeout,
        headers: {
          'User-Agent': config.crawler.userAgent,
          Accept: 'text/html,application/xhtml+xml',
        },
        maxRedirects: 5,
        validateStatus: (s) => s < 400,
      });
      return response;
    } catch (err) {
      const isLast = attempt === retries;
      if (isLast) throw err;
      const delay = attempt * 1000;
      logger.debug(`Retry ${attempt}/${retries} for ${url} after ${delay}ms: ${err.message}`);
      await sleep(delay);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Crawl a website using BFS.
 *
 * @param {string} baseUrl - Starting URL
 * @param {object} options
 * @param {number} options.maxPages
 * @param {number} options.maxDepth
 * @param {function} [options.onProgress] - Called with (crawled, total) progress
 * @returns {Promise<CrawlResult[]>}
 */
async function crawl(baseUrl, options = {}) {
  const maxPages = options.maxPages || config.crawler.defaultMaxPages;
  const maxDepth = options.maxDepth || config.crawler.defaultMaxDepth;
  const onProgress = options.onProgress || (() => {});

  const normalizedBase = normalizeUrl(new URL(baseUrl));
  const baseHostname = new URL(baseUrl).hostname;

  // Fetch and parse robots.txt
  let robotsChecker = () => true;
  try {
    const robotsUrl = `${new URL(baseUrl).origin}/robots.txt`;
    const robotsRes = await axios.get(robotsUrl, {
      timeout: 5000,
      headers: { 'User-Agent': config.crawler.userAgent },
      validateStatus: (s) => s < 500,
    });
    if (robotsRes.status === 200) {
      robotsChecker = parseRobotsTxt(robotsRes.data);
      logger.debug('robots.txt loaded and parsed');
    }
  } catch {
    logger.debug('No robots.txt found or failed to fetch — crawling freely');
  }

  const visited = new Set();
  const results = [];
  const skipped = [];
  // Queue entries: { url, depth }
  const queue = [{ url: normalizedBase, depth: 0 }];
  visited.add(normalizedBase);

  while (queue.length > 0 && results.length < maxPages) {
    const { url, depth } = queue.shift();

    // --- Pre-fetch checks ---
    if (shouldSkipUrl(url)) {
      skipped.push({ url, reason: 'skip-pattern' });
      continue;
    }
    if (!robotsChecker(url)) {
      skipped.push({ url, reason: 'robots.txt' });
      logger.debug(`robots.txt disallows: ${url}`);
      continue;
    }

    // Enforce same-domain
    try {
      if (new URL(url).hostname !== baseHostname) continue;
    } catch {
      continue;
    }

    logger.debug(`Crawling [${results.length + 1}/${maxPages}] depth=${depth}: ${url}`);

    try {
      const response = await fetchWithRetry(url);
      const contentType = response.headers['content-type'] || '';
      if (!contentType.includes('text/html')) {
        skipped.push({ url, reason: 'non-html' });
        continue;
      }

      const html = response.data;
      const { title, content, wordCount, isUseful } = extractContent(html, url);

      if (!isUseful) {
        skipped.push({ url, reason: 'thin-content', wordCount });
        logger.debug(`Skipping thin content (${wordCount} words): ${url}`);
      } else {
        results.push({ url, title, content, wordCount });
        onProgress(results.length, maxPages);
      }

      // Enqueue new links if we haven't hit depth limit
      if (depth < maxDepth) {
        const links = extractLinks(html, url);
        for (const link of links) {
          if (!visited.has(link) && visited.size < maxPages * 3) {
            visited.add(link);
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }
    } catch (err) {
      skipped.push({ url, reason: 'fetch-error', error: err.message });
      logger.warn(`Failed to crawl ${url}: ${err.message}`);
    }

    // Polite delay between requests
    if (queue.length > 0) {
      await sleep(config.crawler.delayMs);
    }
  }

  logger.info(`Crawl complete: ${results.length} pages fetched, ${skipped.length} skipped`);
  return { pages: results, skipped };
}

module.exports = { crawl };
