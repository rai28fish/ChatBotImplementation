/**
 * Update chatbot config:
 *   node scripts/update-config.js YOUR_CHATBOT_ID
 */

const http = require('http');

const chatbotId = process.argv[2];
if (!chatbotId) {
  console.error('Usage: node scripts/update-config.js YOUR_CHATBOT_ID');
  process.exit(1);
}

const data = JSON.stringify({
  chatbotId,
  config: {
    name: 'CybatarBot',
    welcomeMessage: 'Hi! How can I help you?',
    teaserMessage: 'Hey! How can I help you?',
    profileImage: 'https://cybatarriovic.com/wp-content/uploads/2025/08/cropped-favicon-2.png',
  },
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/update-config',
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  },
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    const result = JSON.parse(body);
    if (result.config) {
      console.log('\n✅ Config updated!');
      console.log('Name:', result.config.name);
      console.log('Welcome message:', result.config.welcomeMessage);
    } else {
      console.error('Error:', result.error);
    }
  });
});

req.on('error', (err) => console.error('Request failed:', err.message));
req.write(data);
req.end();
