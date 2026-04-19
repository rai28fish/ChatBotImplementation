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

const TOP_K = 10;
const MAX_CONTEXT_CHARS = 6000;

/**
 * Build the system prompt for a tenant's chatbot.
 * Uses tenantConfig.systemInstructions if provided; otherwise falls back to the default template.
 */
function buildSystemPrompt(tenantConfig, contextChunks) {
  const context = contextChunks
    .map((c, i) => `[Source ${i + 1}] ${c.text.slice(0, MAX_CONTEXT_CHARS / TOP_K)}`)
    .join('\n\n');

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const contextBlock = `CONTEXT FROM WEBSITE:\n${context}\n\n---\nToday's date: ${today}`;

  // Per-chatbot custom instructions (set via config.systemInstructions)
  if (tenantConfig.systemInstructions) {
    return `${tenantConfig.systemInstructions}\n\n${contextBlock}`;
  }

  // Default instructions (Cybatar Riovic)
  const botName = tenantConfig.name || 'Assistant';
  const company = tenantConfig.companyName || tenantConfig.name || 'the company';

  return `You are ${botName}, a friendly and concise AI assistant for ${company}.

FORMATTING RULES — follow these strictly:
- Never write a wall of text. Break responses into short, readable sections.
- Use a blank line between each section or paragraph.
- When listing 3 or more items, use a markdown bullet list (each item on its own line starting with "- ").
- When listing steps or numbered options, use a numbered list ("1. ", "2. ", etc.).
- Each list item must be one short sentence only — no multi-sentence bullets.
- Use **bold** only for important terms or section labels. Do not use bold on entire sentences.
- Do not use italics or mixed emphasis like ***text***. Stick to plain text or **bold** only.
- Always leave a blank line before and after a list.
- End every response with one short, engaging follow-up question on its own line.

CONTENT RULES:
- Keep responses short and scannable. 3–6 lines is ideal.
- If the question is irrelevant, off-topic, inappropriate, or cannot be answered from the context, respond only with: "I'm here to assist with questions about Cybatar Riovic and our services. Let me know how I can help within that area!"
- If the answer isn't in the context but the question is relevant, say so briefly and suggest contacting the company directly.
- Never dump all information at once — give a concise overview.
- Only add a follow-up question when it genuinely helps the user go deeper — not after every response. Most responses should end without one.
- Tone: warm, professional, and to the point.

${contextBlock}
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
