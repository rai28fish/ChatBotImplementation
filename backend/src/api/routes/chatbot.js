const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { crawl } = require('../../crawler/crawler');
const { chunkPages, chunkText } = require('../../embeddings/chunker');
const { embedTexts } = require('../../embeddings/embedder');
const vectorStore = require('../../embeddings/vectorStore');
const { tenantOps, pageOps } = require('../../db/database');
const logger = require('../../utils/logger');

const router = express.Router();

function contentHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Crawl a site, build embeddings, and store everything for a tenant.
 * This runs in the background after the API responds.
 */
async function indexSite(tenantId, baseUrl, crawlOptions) {
  try {
    tenantOps.updateStatus(tenantId, 'crawling');
    logger.info(`[${tenantId}] Starting crawl of ${baseUrl}`);

    // 1. Crawl
    const { pages, skipped } = await crawl(baseUrl, {
      maxPages: crawlOptions.maxPages,
      maxDepth: crawlOptions.maxDepth,
      onProgress: (n, total) => logger.debug(`[${tenantId}] Crawled ${n}/${total}`),
    });

    if (pages.length === 0) {
      tenantOps.updateStatus(tenantId, 'error', { error: 'No pages could be crawled from the provided URL' });
      return;
    }

    tenantOps.updateStatus(tenantId, 'embedding', { pagesIndexed: pages.length });
    logger.info(`[${tenantId}] Crawled ${pages.length} pages, ${skipped.length} skipped. Building embeddings...`);

    // 2. Chunk
    const chunks = chunkPages(pages);
    logger.info(`[${tenantId}] Created ${chunks.length} chunks from ${pages.length} pages`);

    // 3. Embed
    const texts = chunks.map((c) => c.text);
    const embeddings = await embedTexts(texts);

    // 4. Store vectors
    const vectors = chunks.map((chunk, i) => ({
      id: uuidv4(),
      text: chunk.text,
      embedding: embeddings[i],
      metadata: chunk.metadata,
    }));

    vectorStore.upsert(tenantId, vectors);

    // 5. Record crawled pages
    for (const page of pages) {
      pageOps.upsert({
        id: uuidv4(),
        tenantId,
        url: page.url,
        title: page.title,
        contentHash: contentHash(page.content),
      });
    }

    tenantOps.updateStatus(tenantId, 'ready', {
      pagesIndexed: pages.length,
      chunksIndexed: chunks.length,
    });

    logger.info(`[${tenantId}] Indexing complete — ${pages.length} pages, ${chunks.length} chunks`);
  } catch (err) {
    logger.error(`[${tenantId}] Indexing failed: ${err.message}`);
    tenantOps.updateStatus(tenantId, 'error', { error: err.message });
  }
}

// POST /create-chatbot
router.post('/create-chatbot', async (req, res) => {
  const { name, baseUrl, crawlOptions = {}, config: botConfig = {} } = req.body;

  if (!name || !baseUrl) {
    return res.status(400).json({ error: 'name and baseUrl are required' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    return res.status(400).json({ error: 'baseUrl must be a valid http/https URL' });
  }

  const tenantId = uuidv4();
  const tenant = tenantOps.create({
    id: tenantId,
    name,
    baseUrl: parsedUrl.toString(),
    config: {
      name,
      primaryColor: botConfig.primaryColor || '#0066cc',
      profileImage: botConfig.profileImage || '',
      welcomeMessage: botConfig.welcomeMessage || `Hi! I'm ${name}. How can I help you today?`,
      ...botConfig,
    },
    crawlOptions: {
      maxPages: Math.min(crawlOptions.maxPages || 100, 500),
      maxDepth: Math.min(crawlOptions.maxDepth || 2, 5),
    },
  });

  // Respond immediately — indexing runs in background
  res.status(202).json({
    chatbotId: tenantId,
    status: 'indexing',
    message: 'Chatbot created. Site crawling and indexing has started in the background.',
    statusUrl: `/chatbot/${tenantId}/status`,
  });

  // Non-blocking background indexing
  setImmediate(() => indexSite(tenantId, parsedUrl.toString(), tenant.crawlOptions));
});

// POST /refresh-chatbot
router.post('/refresh-chatbot', async (req, res) => {
  const { chatbotId } = req.body;
  if (!chatbotId) return res.status(400).json({ error: 'chatbotId is required' });

  const tenant = tenantOps.findById(chatbotId);
  if (!tenant) return res.status(404).json({ error: 'Chatbot not found' });
  if (tenant.status === 'crawling' || tenant.status === 'embedding') {
    return res.status(409).json({ error: 'Chatbot is already being indexed' });
  }

  res.json({ status: 'refreshing', message: 'Re-indexing started in the background.' });

  setImmediate(() => refreshSite(chatbotId, tenant));
});

async function refreshSite(tenantId, tenant) {
  try {
    tenantOps.updateStatus(tenantId, 'crawling');
    logger.info(`[${tenantId}] Starting refresh crawl`);

    const existingPages = pageOps.findByTenant(tenantId);
    const existingHashes = Object.fromEntries(existingPages.map((p) => [p.url, p.content_hash]));

    const { pages } = await crawl(tenant.base_url, {
      maxPages: tenant.crawlOptions.maxPages,
      maxDepth: tenant.crawlOptions.maxDepth,
    });

    const changedPages = pages.filter((p) => {
      const hash = contentHash(p.content);
      return existingHashes[p.url] !== hash;
    });

    logger.info(`[${tenantId}] Refresh: ${pages.length} pages found, ${changedPages.length} changed`);

    if (changedPages.length === 0) {
      tenantOps.updateStatus(tenantId, 'ready');
      return;
    }

    tenantOps.updateStatus(tenantId, 'embedding');

    // Remove old vectors for changed pages
    for (const page of changedPages) {
      vectorStore.deleteByUrl(tenantId, page.url);
    }

    // Re-embed changed pages
    const chunks = chunkPages(changedPages);
    const embeddings = await embedTexts(chunks.map((c) => c.text));

    const vectors = chunks.map((chunk, i) => ({
      id: uuidv4(),
      text: chunk.text,
      embedding: embeddings[i],
      metadata: chunk.metadata,
    }));

    vectorStore.upsert(tenantId, vectors);

    // Update page records
    for (const page of changedPages) {
      pageOps.upsert({
        id: uuidv4(),
        tenantId,
        url: page.url,
        title: page.title,
        contentHash: contentHash(page.content),
      });
    }

    const totalChunks = vectorStore.count(tenantId);
    tenantOps.updateStatus(tenantId, 'ready', {
      pagesIndexed: pages.length,
      chunksIndexed: totalChunks,
    });

    logger.info(`[${tenantId}] Refresh complete — ${changedPages.length} pages re-indexed`);
  } catch (err) {
    logger.error(`[${tenantId}] Refresh failed: ${err.message}`);
    tenantOps.updateStatus(tenantId, 'error', { error: err.message });
  }
}

// GET /chatbot/:id/status
router.get('/chatbot/:id/status', (req, res) => {
  const tenant = tenantOps.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Chatbot not found' });

  res.json({
    chatbotId: tenant.id,
    name: tenant.config.name || tenant.name,
    companyName: tenant.config.companyName || null,
    companySummary: tenant.config.companySummary || '',
    systemInstructions: tenant.config.systemInstructions || '',
    profileImage: tenant.config.profileImage || '',
    baseUrl: tenant.base_url,
    status: tenant.status,
    pagesIndexed: tenant.pages_indexed,
    chunksIndexed: tenant.chunks_indexed,
    errorMessage: tenant.error_message,
    createdAt: tenant.created_at,
    updatedAt: tenant.updated_at,
  });
});

// GET /chatbot/:id/config  (for widget initialization)
router.get('/chatbot/:id/config', (req, res) => {
  const tenant = tenantOps.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Chatbot not found' });
  if (tenant.status !== 'ready') {
    return res.status(503).json({ error: 'Chatbot is not ready yet', status: tenant.status });
  }

  res.json({
    chatbotId: tenant.id,
    name: tenant.config.name || tenant.name,
    primaryColor: tenant.config.primaryColor || '#0066cc',
    profileImage: tenant.config.profileImage || '',
    welcomeMessage: tenant.config.welcomeMessage || `Hi! How can I help you?`,
    teaserMessage: tenant.config.teaserMessage || '',
    placeholderText: tenant.config.placeholderText || '',
    starterPrompts: tenant.config.starterPrompts || [],
  });
});

// GET /chatbots  (list all)
router.get('/chatbots', (req, res) => {
  const tenants = tenantOps.findAll();
  res.json(tenants.map((t) => ({
    chatbotId: t.id,
    name: t.config.name || t.name,
    companyName: t.config.companyName || null,
    companySummary: t.config.companySummary || '',
    systemInstructions: t.config.systemInstructions || '',
    baseUrl: t.base_url,
    status: t.status,
    pagesIndexed: t.pages_indexed,
    chunksIndexed: t.chunks_indexed,
    profileImage: t.config.profileImage || '',
    createdAt: t.created_at,
  })));
});

// GET /chatbot/:id/chunks  (knowledge base viewer — no embeddings)
router.get('/chatbot/:id/chunks', (req, res) => {
  const tenant = tenantOps.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Chatbot not found' });

  const data = vectorStore.getAll(req.params.id);
  const chunks = data.map((v) => ({
    id: v.id,
    text: v.text,
    source: v.metadata?.source || 'crawled',
    url: v.metadata?.url || null,
    title: v.metadata?.title || null,
    chunkIndex: v.metadata?.chunkIndex ?? null,
  }));

  res.json({ chatbotId: req.params.id, name: tenant.config.name || tenant.name, total: chunks.length, chunks });
});

// POST /chatbot/:id/ingest-text
// Body: { text: string, title?: string }
router.post('/chatbot/:id/ingest-text', async (req, res) => {
  const tenant = tenantOps.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Chatbot not found' });

  const { text, title = 'Custom Content' } = req.body;
  if (!text || typeof text !== 'string' || text.trim().length < 10) {
    return res.status(400).json({ error: 'text must be a non-empty string' });
  }

  const source = `custom://${req.params.id}/${Date.now()}`;

  try {
    const chunks = chunkText(text.trim(), source, title);
    if (chunks.length === 0) {
      return res.status(400).json({ error: 'Text was too short to produce any chunks' });
    }

    const embeddings = await embedTexts(chunks.map((c) => c.text));
    const vectors = chunks.map((chunk, i) => ({
      id: uuidv4(),
      text: chunk.text,
      embedding: embeddings[i],
      metadata: { ...chunk.metadata, source: 'custom' },
    }));

    vectorStore.upsert(tenant.id, vectors);

    const total = vectorStore.count(tenant.id);
    tenantOps.updateStatus(tenant.id, tenant.status, { chunksIndexed: total });

    logger.info(`[${tenant.id}] Ingested ${chunks.length} custom chunks ("${title}")`);
    res.json({ chunksAdded: chunks.length, totalChunks: total });
  } catch (err) {
    logger.error(`[${tenant.id}] ingest-text failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /chatbot/:id/reset — force status to ready (for manually-ingested bots)
router.post('/chatbot/:id/reset', (req, res) => {
  const tenant = tenantOps.findById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Chatbot not found' });
  tenantOps.updateStatus(req.params.id, 'ready');
  res.json({ chatbotId: req.params.id, status: 'ready' });
});

module.exports = router;
