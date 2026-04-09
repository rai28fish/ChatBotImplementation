# AI Chatbot Widget Platform

A production-ready multi-tenant AI chatbot platform. Companies embed a single `<script>` tag on their website, and their visitors get an AI assistant trained on that company's content — automatically crawled and indexed.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Customer Website                      │
│  <script src="...widget.js" data-chatbot-id="...">      │
└─────────────────────┬───────────────────────────────────┘
                      │  Fetch config + POST /chat (SSE)
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  Express Backend                         │
│                                                          │
│  POST /create-chatbot   → Crawl → Chunk → Embed → Store │
│  POST /refresh-chatbot  → Re-crawl → Diff → Re-embed    │
│  POST /chat             → RAG Pipeline → SSE Stream     │
│  PUT  /update-config    → Update tenant settings        │
│  GET  /chatbot/:id/status                               │
└──────────┬──────────────────────────┬───────────────────┘
           │                          │
    ┌──────▼──────┐          ┌────────▼────────┐
    │  SQLite DB  │          │  Local Vector   │
    │  (tenants,  │          │  Store (.json)  │
    │   pages,    │          │  cosine search  │
    │   sessions) │          └─────────────────┘
    └─────────────┘
                      OpenAI API
                      ├── text-embedding-3-small (embeddings)
                      └── gpt-4o-mini (chat completions)
```

---

## Folder Structure

```
ChatBotImplementation/
├── backend/
│   ├── src/
│   │   ├── api/routes/
│   │   │   ├── chat.js          # POST /chat — SSE streaming
│   │   │   ├── chatbot.js       # create/refresh/status routes
│   │   │   └── config.js        # PUT /update-config
│   │   ├── config/
│   │   │   └── index.js         # All env-based config
│   │   ├── crawler/
│   │   │   ├── crawler.js       # BFS crawler with robots.txt
│   │   │   └── extractor.js     # HTML → clean text + links
│   │   ├── db/
│   │   │   └── database.js      # SQLite schema + operations
│   │   ├── embeddings/
│   │   │   ├── chunker.js       # Text → overlapping chunks
│   │   │   ├── embedder.js      # OpenAI embeddings (batched)
│   │   │   └── vectorStore.js   # File-based cosine search
│   │   ├── rag/
│   │   │   └── pipeline.js      # Query → retrieve → stream
│   │   ├── utils/
│   │   │   └── logger.js        # Winston logger
│   │   └── server.js            # Express app entry point
│   ├── .env.example
│   └── package.json
├── widget/
│   ├── chatbot-widget.js        # Self-contained vanilla JS widget
│   └── embed-example.html       # Example integration page
├── scripts/
│   └── test-crawl.js            # End-to-end pipeline demo
└── data/                        # Auto-created at runtime
    ├── chatbot.db               # SQLite database
    └── vectors/                 # Per-tenant vector stores
        └── {chatbotId}/
            └── index.json
```

---

## Setup Instructions

### 1. Prerequisites

- **Node.js 18+** — check with `node --version`
- **OpenAI API Key** — from platform.openai.com

### 2. Install Dependencies

```bash
cd backend
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `backend/.env`:

```env
OPENAI_API_KEY=sk-your-key-here     # REQUIRED
PORT=3000                            # optional, default 3000
```

### 4. Start the Server

```bash
npm start          # production
npm run dev        # development (auto-reload)
```

---

## Quick Start: Create Your First Chatbot

### Step 1 — Create a chatbot

```bash
curl -X POST http://localhost:3000/create-chatbot \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CybaTarriovic Bot",
    "baseUrl": "https://cybatarriovic.com/",
    "crawlOptions": { "maxPages": 50, "maxDepth": 2 },
    "config": {
      "primaryColor": "#1a73e8",
      "welcomeMessage": "Hi! Ask me anything about our services."
    }
  }'
```

Response:
```json
{
  "chatbotId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "indexing"
}
```

### Step 2 — Poll until ready

```bash
curl http://localhost:3000/chatbot/YOUR_CHATBOT_ID/status
```

Wait for `"status": "ready"`. Statuses: `pending → crawling → embedding → ready`

### Step 3 — Embed the widget

```html
<script
  src="http://localhost:3000/widget/chatbot-widget.js"
  data-chatbot-id="YOUR_CHATBOT_ID"
  async
></script>
```

Paste before `</body>`. The floating chat button appears bottom-right.

---

## API Reference

### `POST /create-chatbot`
| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name |
| `baseUrl` | Yes | Site to crawl |
| `crawlOptions.maxPages` | No | Default 100 |
| `crawlOptions.maxDepth` | No | Default 2 |
| `config.primaryColor` | No | Widget hex color |
| `config.profileImage` | No | Avatar image URL |
| `config.welcomeMessage` | No | First bot message |

### `POST /refresh-chatbot`
```json
{ "chatbotId": "..." }
```
Re-crawls, diffs content hashes, only re-embeds changed pages.

### `POST /chat`
```json
{ "chatbotId": "...", "message": "...", "sessionId": "optional" }
```
Response: SSE stream with `chunk`, `done`, and `error` events.

### `PUT /update-config`
```json
{ "chatbotId": "...", "config": { "primaryColor": "#ff6600", "name": "..." } }
```

### `GET /chatbot/:id/status`
Returns `{ status, pagesIndexed, chunksIndexed }`.

### `GET /chatbots`
Lists all tenants.

---

## Test the Pipeline (cybatarriovic.com demo)

```bash
cd backend && npm install
node ../scripts/test-crawl.js
```

Without an API key: shows crawled pages, extracted content, and chunks.  
With an API key: also generates embeddings and tests semantic search queries.

---

## Crawler Design

Uses **BFS** from `baseUrl` with:
- robots.txt respected (cached once per crawl)
- URL normalization: strips query params and fragments
- Skip patterns: login, cart, checkout, admin, privacy, media files
- Same-domain only
- 500ms polite delay between requests
- 3 retries with exponential backoff
- Pages with fewer than 30 words discarded

---

## RAG Pipeline

```
User message → Embed → Cosine search (top 5) → Build system prompt → GPT-4o-mini stream → SSE → Widget
```

---

## API Keys Required

| Service | Purpose | Cost estimate (50-page site) |
|---------|---------|------------------------------|
| OpenAI  | Embeddings + Chat | ~$0.001 to index, ~$0.002/chat |

Get your key at: platform.openai.com/api-keys

---

## Production Notes

- Serve behind nginx with HTTPS (required for embedding on https sites)
- Set `WIDGET_ALLOWED_ORIGINS=https://yoursite.com` in `.env`
- SQLite handles up to ~10k tenants comfortably
- Local vector store handles up to ~50k chunks per tenant; swap for Pinecone at scale
