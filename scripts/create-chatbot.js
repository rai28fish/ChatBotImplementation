/**
 * Run this to create the cybatarriovic.com chatbot:
 *   node scripts/create-chatbot.js
 */

const http = require('http');

const data = JSON.stringify({
  name: 'CybaTarriovic Bot',
  baseUrl: 'https://cybatarriovic.com/',
  crawlOptions: { maxPages: 30, maxDepth: 2 },
  config: { primaryColor: '#1a73e8', welcomeMessage: 'Hi! Ask me anything about our services.' },
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/create-chatbot',
  method: 'POST',
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
    if (result.chatbotId) {
      console.log('\n✅ Chatbot created successfully!');
      console.log('─'.repeat(40));
      console.log('Chatbot ID:', result.chatbotId);
      console.log('Status:    ', result.status);
      console.log('\nSave this ID — you need it for the widget embed script.');
      console.log('\nCheck indexing progress:');
      console.log(`  node scripts/check-status.js ${result.chatbotId}`);
    } else {
      console.error('\n❌ Error:', result.error || JSON.stringify(result));
    }
  });
});

req.on('error', (err) => {
  console.error('Request failed:', err.message);
  console.error('Is the server running? Run: npm start (in the backend folder)');
});

req.write(data);
req.end();
