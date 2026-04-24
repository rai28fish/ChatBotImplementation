require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    chatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
  },

  db: {
    path: process.env.DB_PATH || './data/chatbot.db',
  },

  vectorStore: {
    path: process.env.VECTOR_STORE_PATH || './data/vectors',
  },

  crawler: {
    userAgent: process.env.CRAWLER_USER_AGENT || 'ChatbotCrawler/1.0',
    requestTimeout: parseInt(process.env.CRAWLER_REQUEST_TIMEOUT, 10) || 8000,
    delayMs: parseInt(process.env.CRAWLER_DELAY_MS, 10) || 500,
    maxRetries: parseInt(process.env.CRAWLER_MAX_RETRIES, 10) || 3,
    defaultMaxPages: 100,
    defaultMaxDepth: 2,
  },

  widget: {
    allowedOrigins: process.env.WIDGET_ALLOWED_ORIGINS || '*',
  },

  publicUrl: process.env.PUBLIC_URL || '',

  admin: {
    exemptIps: new Set([
      '127.0.0.1', '::1', '::ffff:127.0.0.1', // always exempt
      ...(process.env.ADMIN_IPS || '').split(',').map((s) => s.trim()).filter(Boolean),
    ]),
  },

  // URL patterns to skip during crawling
  skipPatterns: [
    /\/login/i, /\/logout/i, /\/signin/i, /\/signup/i, /\/register/i,
    /\/cart/i, /\/checkout/i, /\/order/i,
    /\/privacy/i, /\/terms/i, /\/cookie/i, /\/gdpr/i,
    /\/admin/i, /\/wp-admin/i, /\/dashboard/i,
    /\.(pdf|jpg|jpeg|png|gif|svg|ico|css|js|woff|woff2|ttf|eot|zip|tar|gz)$/i,
    /\?/, // URLs with query parameters
    /#/,  // Fragment-only URLs
  ],
};
