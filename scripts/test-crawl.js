/**
 * Test script: demonstrates the full pipeline on https://cybatarriovic.com/
 *
 * Run from backend directory:
 *   node ../scripts/test-crawl.js
 *
 * Or from root:
 *   node scripts/test-crawl.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });

const { crawl } = require('../backend/src/crawler/crawler');
const { extractContent } = require('../backend/src/crawler/extractor');
const { chunkPages } = require('../backend/src/embeddings/chunker');
const { embedTexts, embedQuery } = require('../backend/src/embeddings/embedder');
const vectorStore = require('../backend/src/embeddings/vectorStore');
const { v4: uuidv4 } = require('uuid');

const TEST_URL = 'https://cybatarriovic.com/';
const TEST_TENANT_ID = 'test-cybatarriovic';

// Override vector store path for test
vectorStore.baseDir = require('path').join(__dirname, '../data/test-vectors');

async function runTest() {
  console.log('═'.repeat(60));
  console.log('ChatBot Pipeline Test — cybatarriovic.com');
  console.log('═'.repeat(60));

  // ─── Step 1: Crawl ─────────────────────────────────────────────────────────

  console.log('\n📡 STEP 1: Crawling website...\n');
  const { pages, skipped } = await crawl(TEST_URL, {
    maxPages: 20,  // Keep small for testing
    maxDepth: 2,
  });

  console.log(`✓ Crawled ${pages.length} pages, ${skipped.length} skipped\n`);
  console.log('Pages found:');
  pages.forEach((p, i) => {
    console.log(`  ${i + 1}. [${p.wordCount} words] ${p.url}`);
    console.log(`     Title: ${p.title}`);
  });

  if (skipped.length > 0) {
    console.log('\nSkipped URLs:');
    skipped.slice(0, 10).forEach((s) => {
      console.log(`  • ${s.reason.padEnd(15)} ${s.url}`);
    });
    if (skipped.length > 10) console.log(`  ... and ${skipped.length - 10} more`);
  }

  if (pages.length === 0) {
    console.error('\n✗ No pages crawled. Check network access.');
    return;
  }

  // ─── Step 2: Show Sample Extracted Content ────────────────────────────────

  console.log('\n' + '─'.repeat(60));
  console.log('📄 STEP 2: Sample extracted content\n');

  const samplePage = pages[0];
  console.log(`URL: ${samplePage.url}`);
  console.log(`Title: ${samplePage.title}`);
  console.log(`Word count: ${samplePage.wordCount}`);
  console.log('\nFirst 500 characters of content:');
  console.log('  ' + samplePage.content.slice(0, 500).replace(/\n/g, '\n  ') + '...');

  // ─── Step 3: Chunking ─────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(60));
  console.log('✂️  STEP 3: Chunking content\n');

  const chunks = chunkPages(pages);
  console.log(`✓ Created ${chunks.length} chunks from ${pages.length} pages`);
  console.log('\nSample chunk:');
  const sampleChunk = chunks[0];
  console.log(`  Words: ${sampleChunk.wordCount}`);
  console.log(`  URL: ${sampleChunk.metadata.url}`);
  console.log(`  Text preview: "${sampleChunk.text.slice(0, 200)}..."`);

  // ─── Step 4: Embeddings ───────────────────────────────────────────────────

  if (!process.env.OPENAI_API_KEY) {
    console.log('\n' + '─'.repeat(60));
    console.log('⚠️  STEP 4: Skipping embeddings (OPENAI_API_KEY not set)');
    console.log('\nTo run the full test with embeddings, set OPENAI_API_KEY in backend/.env');
    printSummary(pages, chunks, null);
    return;
  }

  console.log('\n' + '─'.repeat(60));
  console.log('🧮 STEP 4: Generating embeddings...\n');

  const texts = chunks.map((c) => c.text);
  console.log(`Sending ${texts.length} chunks to OpenAI embeddings API...`);

  const embeddings = await embedTexts(texts);
  console.log(`✓ Generated ${embeddings.length} embeddings (dim: ${embeddings[0].length})`);

  // ─── Step 5: Store in vector DB ───────────────────────────────────────────

  console.log('\n' + '─'.repeat(60));
  console.log('💾 STEP 5: Storing in vector database\n');

  const vectors = chunks.map((chunk, i) => ({
    id: uuidv4(),
    text: chunk.text,
    embedding: embeddings[i],
    metadata: chunk.metadata,
  }));

  vectorStore.upsert(TEST_TENANT_ID, vectors);
  console.log(`✓ Stored ${vectors.length} vectors for tenant "${TEST_TENANT_ID}"`);

  // ─── Step 6: RAG Query Test ───────────────────────────────────────────────

  console.log('\n' + '─'.repeat(60));
  console.log('🔍 STEP 6: Testing RAG retrieval\n');

  const testQueries = [
    'What services do you offer?',
    'How can I contact you?',
    'What is this company about?',
  ];

  for (const query of testQueries) {
    console.log(`Query: "${query}"`);
    const queryEmb = await embedQuery(query);
    const results = vectorStore.search(TEST_TENANT_ID, queryEmb, 3);

    console.log(`Top 3 results:`);
    results.forEach((r, i) => {
      console.log(`  ${i + 1}. Score: ${r.score.toFixed(3)} | ${r.metadata.url}`);
      console.log(`     "${r.text.slice(0, 120)}..."`);
    });
    console.log();
  }

  printSummary(pages, chunks, embeddings);
}

function printSummary(pages, chunks, embeddings) {
  console.log('═'.repeat(60));
  console.log('PIPELINE SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Pages crawled:     ${pages.length}`);
  console.log(`Total words:       ${pages.reduce((s, p) => s + p.wordCount, 0).toLocaleString()}`);
  console.log(`Chunks created:    ${chunks.length}`);
  if (embeddings) {
    console.log(`Embeddings stored: ${embeddings.length}`);
    console.log(`Embedding dim:     ${embeddings[0].length}`);
  }
  console.log('\n✅ Test complete!');
  if (!process.env.OPENAI_API_KEY) {
    console.log('\nNext steps:');
    console.log('  1. Add OPENAI_API_KEY to backend/.env');
    console.log('  2. Run: cd backend && npm install && npm start');
    console.log('  3. POST to http://localhost:3000/create-chatbot with the URL above');
  }
}

runTest().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
