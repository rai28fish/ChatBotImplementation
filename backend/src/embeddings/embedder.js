const OpenAI = require('openai');
const config = require('../config');
const logger = require('../utils/logger');

let openaiClient;

function getClient() {
  if (!openaiClient) {
    if (!config.openai.apiKey) {
      throw new Error('OPENAI_API_KEY is not set in environment variables');
    }
    openaiClient = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return openaiClient;
}

const BATCH_SIZE = 100;

/**
 * Generate embeddings for an array of text strings.
 * Processes in batches to respect API limits.
 *
 * @param {string[]} texts
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
async function embedTexts(texts) {
  if (texts.length === 0) return [];

  const client = getClient();
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    logger.debug(`Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(texts.length / BATCH_SIZE)} (${batch.length} items)`);

    try {
      const response = await client.embeddings.create({
        model: config.openai.embeddingModel,
        input: batch,
      });

      const batchEmbeddings = response.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);

      allEmbeddings.push(...batchEmbeddings);
    } catch (err) {
      logger.error(`Embedding batch failed: ${err.message}`);
      throw err;
    }
  }

  return allEmbeddings;
}

/**
 * Generate a single embedding for a query string.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedQuery(text) {
  const [embedding] = await embedTexts([text]);
  return embedding;
}

module.exports = { embedTexts, embedQuery };
