require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const config = require('./config');
const logger = require('./utils/logger');
const chatRoutes = require('./api/routes/chat');
const chatbotRoutes = require('./api/routes/chatbot');
const configRoutes = require('./api/routes/config');

const app = express();
app.set('trust proxy', 1);

// ─── Security & Middleware ────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
}));

app.use(cors({
  origin: config.widget.allowedOrigins === '*' ? '*' : config.widget.allowedOrigins.split(','),
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(morgan('dev', {
  stream: { write: (msg) => logger.http(msg.trim()) },
}));

app.use(express.json({ limit: '1mb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many chat messages, please wait a moment.' },
});

app.use('/api', apiLimiter);
app.use('/chat', chatLimiter);

// ─── Static Widget Serving ────────────────────────────────────────────────────

app.use('/widget', express.static(path.join(__dirname, '../../widget'), {
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
  },
}));

app.use('/dashboard', express.static(path.join(__dirname, '../../dashboard'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache');
  },
}));

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/', chatRoutes);
app.use('/', chatbotRoutes);
app.use('/', configRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public URL (used by dashboard to generate correct embed snippets)
app.get('/public-url', (req, res) => {
  const url = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  res.json({ url });
});

// ─── Error Handler ────────────────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(config.port, () => {
  logger.info(`
╔══════════════════════════════════════════╗
║   ChatBot Platform Server                ║
║   Running on http://localhost:${config.port}       ║
╚══════════════════════════════════════════╝
  `);
  logger.info(`Dashboard:        http://localhost:${config.port}/dashboard`);
  logger.info(`Widget served at: http://localhost:${config.port}/widget/chatbot-widget.js`);
});

module.exports = app;
