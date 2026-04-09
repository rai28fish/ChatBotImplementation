/**
 * Pure JS file-based database — no native dependencies.
 * Stores all data as JSON in data/db.json.
 * Same public API as the original SQLite version.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

const DB_PATH = path.resolve(path.dirname(config.db.path), 'db.json');

// ─── In-memory store ─────────────────────────────────────────────────────────

let store = {
  tenants: {},       // id -> tenant object
  pages: {},         // "${tenantId}::${url}" -> page object
  sessions: {},      // id -> session object
  messages: {},      // sessionId -> message[]
};

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadStore() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    try {
      store = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
      // Ensure all collections exist (handles schema evolution)
      store.tenants  = store.tenants  || {};
      store.pages    = store.pages    || {};
      store.sessions = store.sessions || {};
      store.messages = store.messages || {};
      logger.info(`Database loaded from ${DB_PATH}`);
    } catch (err) {
      logger.error(`Failed to load DB, starting fresh: ${err.message}`);
    }
  } else {
    logger.info(`No database found — starting fresh at ${DB_PATH}`);
  }
}

function saveStore() {
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

// Load on startup
loadStore();

// ─── Tenant operations ────────────────────────────────────────────────────────

const tenantOps = {
  create(tenant) {
    const now = new Date().toISOString();
    const record = {
      id: tenant.id,
      name: tenant.name,
      base_url: tenant.baseUrl,
      config: tenant.config || {},
      crawl_options: tenant.crawlOptions || {},
      status: 'pending',
      pages_indexed: 0,
      chunks_indexed: 0,
      error_message: null,
      created_at: now,
      updated_at: now,
    };
    store.tenants[tenant.id] = record;
    saveStore();
    return this.findById(tenant.id);
  },

  findById(id) {
    const row = store.tenants[id];
    if (!row) return null;
    return parseTenant(row);
  },

  findAll() {
    return Object.values(store.tenants)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map(parseTenant);
  },

  updateStatus(id, status, extras = {}) {
    const t = store.tenants[id];
    if (!t) return;
    t.status = status;
    t.updated_at = new Date().toISOString();
    if (extras.error !== undefined)        t.error_message  = extras.error;
    if (extras.pagesIndexed !== undefined) t.pages_indexed  = extras.pagesIndexed;
    if (extras.chunksIndexed !== undefined) t.chunks_indexed = extras.chunksIndexed;
    saveStore();
  },

  updateConfig(id, newConfig) {
    const t = store.tenants[id];
    if (!t) return null;
    t.config = newConfig;
    t.updated_at = new Date().toISOString();
    saveStore();
    return this.findById(id);
  },
};

// ─── Page operations ──────────────────────────────────────────────────────────

const pageOps = {
  upsert(page) {
    const key = `${page.tenantId}::${page.url}`;
    store.pages[key] = {
      id: page.id,
      tenant_id: page.tenantId,
      url: page.url,
      title: page.title || '',
      content_hash: page.contentHash || '',
      crawled_at: new Date().toISOString(),
    };
    saveStore();
  },

  findByTenant(tenantId) {
    return Object.values(store.pages).filter((p) => p.tenant_id === tenantId);
  },

  findByUrl(tenantId, url) {
    return store.pages[`${tenantId}::${url}`] || null;
  },

  deleteByTenant(tenantId) {
    for (const key of Object.keys(store.pages)) {
      if (store.pages[key].tenant_id === tenantId) delete store.pages[key];
    }
    saveStore();
  },
};

// ─── Session operations ───────────────────────────────────────────────────────

const sessionOps = {
  create(session) {
    store.sessions[session.id] = {
      id: session.id,
      tenant_id: session.tenantId,
      created_at: new Date().toISOString(),
    };
    store.messages[session.id] = [];
    saveStore();
    return session;
  },

  findById(id) {
    return store.sessions[id] || null;
  },

  addMessage(message) {
    if (!store.messages[message.sessionId]) {
      store.messages[message.sessionId] = [];
    }
    store.messages[message.sessionId].push({
      id: message.id,
      session_id: message.sessionId,
      role: message.role,
      content: message.content,
      created_at: new Date().toISOString(),
    });
    saveStore();
  },

  getMessages(sessionId, limit = 10) {
    const msgs = store.messages[sessionId] || [];
    return msgs.slice(-limit);
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseTenant(row) {
  return {
    ...row,
    config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
    crawlOptions: typeof row.crawl_options === 'string' ? JSON.parse(row.crawl_options) : row.crawl_options,
  };
}

module.exports = { tenantOps, pageOps, sessionOps };
