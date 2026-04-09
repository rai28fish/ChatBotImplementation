/**
 * Check chatbot indexing status:
 *   node scripts/check-status.js YOUR_CHATBOT_ID
 */

const http = require('http');

const chatbotId = process.argv[2];
if (!chatbotId) {
  console.error('Usage: node scripts/check-status.js YOUR_CHATBOT_ID');
  process.exit(1);
}

const req = http.get(`http://localhost:3000/chatbot/${chatbotId}/status`, (res) => {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => {
    const result = JSON.parse(body);
    console.log('\nChatbot Status');
    console.log('─'.repeat(40));
    console.log('ID:             ', result.chatbotId);
    console.log('Name:           ', result.name);
    console.log('Status:         ', result.status);
    console.log('Pages indexed:  ', result.pagesIndexed);
    console.log('Chunks indexed: ', result.chunksIndexed);
    if (result.errorMessage) console.log('Error:          ', result.errorMessage);
    if (result.status === 'ready') {
      console.log('\n✅ Ready! You can now embed the widget.');
    } else if (result.status === 'error') {
      console.log('\n❌ Indexing failed. See error above.');
    } else {
      console.log('\n⏳ Still indexing... run this again in 30 seconds.');
    }
  });
});

req.on('error', (err) => console.error('Request failed:', err.message));
