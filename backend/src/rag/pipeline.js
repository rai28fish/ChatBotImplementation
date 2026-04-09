const OpenAI = require('openai');
const { embedQuery } = require('../embeddings/embedder');
const vectorStore = require('../embeddings/vectorStore');
const config = require('../config');
const logger = require('../utils/logger');

let openaiClient;
function getClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return openaiClient;
}

const TOP_K = 5;
const MAX_CONTEXT_CHARS = 3000;

/**
 * Build the system prompt for a tenant's chatbot.
 */
function buildSystemPrompt(tenantConfig, contextChunks) {
  const botName = tenantConfig.name || 'Assistant';
  const company = tenantConfig.companyName || tenantConfig.name || 'the company';

  const context = contextChunks
    .map((c, i) => `[Source ${i + 1}] ${c.text.slice(0, MAX_CONTEXT_CHARS / TOP_K)}`)
    .join('\n\n');

  return `You are ${botName}, a friendly and concise AI assistant for ${company}.

RESPONSE RULES — follow these strictly:
- Keep responses short and scannable. Avoid long paragraphs.
- Use bullet points (•) or numbered lists whenever listing more than two things.
- Each bullet should be one short sentence — no sub-paragraphs inside bullets.
- End responses with a brief engaging follow-up question to keep the conversation going (e.g. "Would you like more details on any of these?").
- If the answer isn't in the context, say so briefly and suggest contacting the company directly.
- Never dump all information at once — give a concise overview, then invite the user to ask for more.
- Tone: warm, professional, and to the point.

CONTEXT FROM WEBSITE:
${context}

---
Today's date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
`;
}

/**
 * Run the full RAG pipeline and stream the response.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {object} params.tenantConfig - Tenant's config object
 * @param {string} params.message - User's message
 * @param {Array<{role, content}>} params.history - Recent chat history
 * @param {function} params.onChunk - Called with each streamed text chunk
 * @param {function} params.onDone - Called when streaming is complete
 * @param {function} params.onError - Called on error
 */
async function chat({ tenantId, tenantConfig, message, history = [], onChunk, onDone, onError }) {
  try {
    // 1. Embed the query
    logger.debug(`RAG query for tenant ${tenantId}: "${message.slice(0, 80)}"`);
    const queryEmbedding = await embedQuery(message);

    // 2. Retrieve relevant chunks
    const relevantChunks = vectorStore.search(tenantId, queryEmbedding, TOP_K);
    logger.debug(`Retrieved ${relevantChunks.length} chunks (best score: ${relevantChunks[0]?.score?.toFixed(3)})`);

    if (relevantChunks.length === 0) {
      logger.warn(`No vectors found for tenant ${tenantId} — chatbot may not be indexed yet`);
    }

    // 3. Build messages array
    const systemPrompt = buildSystemPrompt(tenantConfig, relevantChunks);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-6), // Keep last 6 messages for context
      { role: 'user', content: message },
    ];

    // 4. Stream response from LLM
    const client = getClient();
    const stream = await client.chat.completions.create({
      model: config.openai.chatModel,
      messages,
      stream: true,
      max_tokens: 600,
      temperature: 0.7,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) onChunk(content);
    }

    onDone({ sources: relevantChunks.map((c) => ({ url: c.metadata?.url, title: c.metadata?.title, score: c.score })) });
  } catch (err) {
    logger.error(`RAG pipeline error: ${err.message}`);
    onError(err);
  }
}

module.exports = { chat };
