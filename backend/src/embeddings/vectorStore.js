const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * File-based vector store with in-memory caching.
 * Stores per-tenant vectors as JSON files on disk.
 * Suitable for up to ~50k chunks per tenant.
 */
class VectorStore {
  constructor(baseDir) {
    this.baseDir = baseDir || config.vectorStore.path;
    this.cache = {}; // tenantId -> { vectors: VectorEntry[] }
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  _tenantPath(tenantId) {
    return path.join(path.resolve(this.baseDir), tenantId, 'index.json');
  }

  _load(tenantId) {
    if (this.cache[tenantId]) return this.cache[tenantId];

    const filePath = this._tenantPath(tenantId);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        this.cache[tenantId] = data;
        return data;
      } catch (err) {
        logger.error(`Failed to load vector store for tenant ${tenantId}: ${err.message}`);
      }
    }

    this.cache[tenantId] = { vectors: [] };
    return this.cache[tenantId];
  }

  _save(tenantId) {
    const filePath = this._tenantPath(tenantId);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(this.cache[tenantId]), 'utf-8');
  }

  // ─── Math ─────────────────────────────────────────────────────────────────

  _cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Add or update vectors for a tenant.
   * @param {string} tenantId
   * @param {Array<{ id, text, embedding, metadata }>} vectors
   */
  upsert(tenantId, vectors) {
    const store = this._load(tenantId);

    for (const vec of vectors) {
      const idx = store.vectors.findIndex((v) => v.id === vec.id);
      if (idx >= 0) {
        store.vectors[idx] = vec;
      } else {
        store.vectors.push(vec);
      }
    }

    this._save(tenantId);
    logger.debug(`Upserted ${vectors.length} vectors for tenant ${tenantId} (total: ${store.vectors.length})`);
  }

  /**
   * Remove all vectors associated with a specific URL.
   * Used during page re-indexing.
   */
  deleteByUrl(tenantId, url) {
    const store = this._load(tenantId);
    const before = store.vectors.length;
    store.vectors = store.vectors.filter((v) => v.metadata?.url !== url);
    this._save(tenantId);
    logger.debug(`Deleted ${before - store.vectors.length} vectors for URL: ${url}`);
  }

  /**
   * Find top-K most similar vectors to a query embedding.
   * @param {string} tenantId
   * @param {number[]} queryEmbedding
   * @param {number} topK
   * @returns {Array<{ id, text, metadata, score }>}
   */
  search(tenantId, queryEmbedding, topK = 5) {
    const store = this._load(tenantId);
    if (store.vectors.length === 0) return [];

    return store.vectors
      .map((v) => ({ id: v.id, text: v.text, metadata: v.metadata, score: this._cosine(queryEmbedding, v.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Keyword search — returns chunks whose text contains ALL query terms.
   * Terms shorter than 3 chars are ignored. Case-insensitive.
   */
  keywordSearch(tenantId, query, topK = 5) {
    const store = this._load(tenantId);
    if (store.vectors.length === 0) return [];

    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
    if (terms.length === 0) return [];

    return store.vectors
      .map((v) => {
        const lower = v.text.toLowerCase();
        const matchCount = terms.filter(t => lower.includes(t)).length;
        return { id: v.id, text: v.text, metadata: v.metadata, score: matchCount / terms.length };
      })
      .filter(v => v.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Get all unique URLs stored for a tenant.
   */
  getIndexedUrls(tenantId) {
    const store = this._load(tenantId);
    return [...new Set(store.vectors.map((v) => v.metadata?.url).filter(Boolean))];
  }

  /**
   * Count total vectors for a tenant.
   */
  count(tenantId) {
    return this._load(tenantId).vectors.length;
  }

  /**
   * Return all vectors for a tenant (with embeddings).
   */
  getAll(tenantId) {
    return this._load(tenantId).vectors;
  }

  /**
   * Delete all vectors for a tenant.
   */
  clear(tenantId) {
    this.cache[tenantId] = { vectors: [] };
    this._save(tenantId);
  }

  /**
   * Evict a tenant from the in-memory cache (free RAM).
   */
  evict(tenantId) {
    delete this.cache[tenantId];
  }
}

// Export a singleton instance
module.exports = new VectorStore();
