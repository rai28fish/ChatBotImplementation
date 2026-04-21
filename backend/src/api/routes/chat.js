const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { chat } = require('../../rag/pipeline');
const { tenantOps, sessionOps } = require('../../db/database');
const config = require('../../config');
const logger = require('../../utils/logger');

const router = express.Router();

const MAX_DAILY_MESSAGES = 20;

/**
 * POST /chat
 *
 * Body: { chatbotId, message, sessionId? }
 * Response: Server-Sent Events stream
 */
router.post('/chat', async (req, res) => {
  const { chatbotId, message, sessionId: incomingSessionId } = req.body;

  // Validation
  if (!chatbotId) return res.status(400).json({ error: 'chatbotId is required' });
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message must be a non-empty string' });
  }
  if (message.length > 2000) {
    return res.status(400).json({ error: 'message exceeds 2000 character limit' });
  }

  const tenant = tenantOps.findById(chatbotId);
  if (!tenant) return res.status(404).json({ error: 'Chatbot not found' });
  if (tenant.status !== 'ready') {
    return res.status(503).json({
      error: `Chatbot is not ready. Current status: ${tenant.status}`,
      status: tenant.status,
    });
  }

  // Get client IP
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
  const isAdmin = config.admin.exemptIps.has(clientIp);

  // Resolve or create session
  let sessionId = incomingSessionId;
  let history = [];

  if (sessionId) {
    const session = sessionOps.findById(sessionId);
    if (session && session.tenant_id === chatbotId) {
      history = sessionOps.getMessages(sessionId).map((m) => ({
        role: m.role,
        content: m.content,
      }));
    } else {
      sessionId = null;
    }
  }

  if (!sessionId) {
    sessionId = uuidv4();
    sessionOps.create({ id: sessionId, tenantId: chatbotId, ip: clientIp });
  }

  // Check daily message limit across all sessions (skipped for admin IPs)
  if (!isAdmin) {
    const dailyMsgCount = sessionOps.countTodayUserMessagesByIp(chatbotId, clientIp);
    if (dailyMsgCount >= MAX_DAILY_MESSAGES) {
      return res.status(429).json({
        error: 'daily_limit',
        message: "You've reached your daily limit of 20 messages. Please try again tomorrow.",
      });
    }
  }

  // Save user message
  sessionOps.addMessage({ id: uuidv4(), sessionId, role: 'user', content: message.trim() });

  // Set up SSE response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Session-Id', sessionId);
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('session', { sessionId });

  let fullResponse = '';

  await chat({
    tenantId: chatbotId,
    tenantConfig: tenant.config,
    message: message.trim(),
    history,
    onChunk: (chunk) => {
      fullResponse += chunk;
      sendEvent('chunk', { content: chunk });
    },
    onDone: (meta) => {
      // Save assistant message to DB
      sessionOps.addMessage({
        id: uuidv4(),
        sessionId,
        role: 'assistant',
        content: fullResponse,
      });
      sendEvent('done', { sources: meta.sources });
      res.end();
    },
    onError: (err) => {
      logger.error(`Chat error for tenant ${chatbotId}: ${err.message}`);
      sendEvent('error', { message: 'Sorry, I encountered an error. Please try again.' });
      res.end();
    },
  });
});

module.exports = router;
