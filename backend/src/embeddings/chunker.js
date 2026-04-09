/**
 * Text chunker that splits content into overlapping segments.
 *
 * Strategy:
 *  - Split into sentences
 *  - Group sentences into chunks targeting ~400 words (~530 tokens)
 *  - Add ~60-word (~80-token) overlap between consecutive chunks
 */

const TARGET_CHUNK_WORDS = 400;
const OVERLAP_WORDS = 60;
const MIN_CHUNK_WORDS = 30;

/**
 * Split text into sentences using a simple regex heuristic.
 */
function splitIntoSentences(text) {
  // Split on sentence-ending punctuation followed by whitespace and a capital letter
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'\u2018\u201C])/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Count words in a string.
 */
function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Chunk text into overlapping segments.
 *
 * @param {string} text - Cleaned page content
 * @param {string} url - Source URL (stored in metadata)
 * @param {string} title - Page title (stored in metadata)
 * @returns {Array<{ text: string, wordCount: number, metadata: object }>}
 */
function chunkText(text, url, title) {
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) return [];

  const chunks = [];
  let currentSentences = [];
  let currentWords = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sentWords = wordCount(sentence);

    currentSentences.push(sentence);
    currentWords += sentWords;

    const isLast = i === sentences.length - 1;

    if (currentWords >= TARGET_CHUNK_WORDS || isLast) {
      const chunkText = currentSentences.join(' ');
      const chunkWords = wordCount(chunkText);

      if (chunkWords >= MIN_CHUNK_WORDS) {
        chunks.push({
          text: chunkText,
          wordCount: chunkWords,
          metadata: {
            url,
            title,
            chunkIndex: chunks.length,
          },
        });
      }

      // Overlap: keep the last N words worth of sentences for next chunk
      const overlapSentences = [];
      let overlapWords = 0;
      for (let j = currentSentences.length - 1; j >= 0; j--) {
        const w = wordCount(currentSentences[j]);
        if (overlapWords + w > OVERLAP_WORDS) break;
        overlapSentences.unshift(currentSentences[j]);
        overlapWords += w;
      }

      currentSentences = overlapSentences;
      currentWords = overlapWords;
    }
  }

  return chunks;
}

/**
 * Chunk multiple pages.
 * @param {Array<{ url, title, content }>} pages
 * @returns {Array<{ text, wordCount, metadata }>}
 */
function chunkPages(pages) {
  const allChunks = [];
  for (const page of pages) {
    const pageChunks = chunkText(page.content, page.url, page.title);
    allChunks.push(...pageChunks);
  }
  return allChunks;
}

module.exports = { chunkText, chunkPages };
