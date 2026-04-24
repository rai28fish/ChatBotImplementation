const express = require('express');
const { tenantOps } = require('../../db/database');

const router = express.Router();

const ALLOWED_CONFIG_KEYS = [
  'name', 'primaryColor', 'profileImage', 'welcomeMessage', 'welcomeMessages', 'teaserMessage',
  'companyName', 'companySummary', 'systemInstructions', 'placeholderText', 'position', 'starterPrompts', 'lightTheme',
];

/**
 * PUT /update-config
 * Body: { chatbotId, config: { name?, primaryColor?, profileImage?, welcomeMessage?, ... } }
 */
router.put('/update-config', (req, res) => {
  const { chatbotId, config: incoming } = req.body;

  if (!chatbotId) return res.status(400).json({ error: 'chatbotId is required' });
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: 'config must be an object' });
  }

  const tenant = tenantOps.findById(chatbotId);
  if (!tenant) return res.status(404).json({ error: 'Chatbot not found' });

  // Merge only allowed keys from incoming config
  const safeConfig = {};
  for (const key of ALLOWED_CONFIG_KEYS) {
    if (key in incoming) safeConfig[key] = incoming[key];
  }

  const updated = tenantOps.updateConfig(chatbotId, { ...tenant.config, ...safeConfig });

  res.json({
    chatbotId,
    config: updated.config,
    message: 'Configuration updated successfully',
  });
});

module.exports = router;
