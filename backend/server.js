import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { crawl } from './crawler.js'
import { buildIndex, search, serializeIndex, deserializeIndex } from './indexer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const INDEX_FILE = path.join(DATA_DIR, 'index.json')

const SEED_URLS = [
  'https://en.wikipedia.org/wiki/Web_search_engine',
  'https://en.wikipedia.org/wiki/JavaScript',
  'https://en.wikipedia.org/wiki/Node.js',
  'https://en.wikipedia.org/wiki/React',
  'https://en.wikipedia.org/wiki/HTTP',
  'https://en.wikipedia.org/wiki/Search_engine_optimization',
  'https://en.wikipedia.org/wiki/Web_crawler',
  'https://en.wikipedia.org/wiki/Inverted_index',
  'https://en.wikipedia.org/wiki/TF%E2%80%93IDF',
  'https://en.wikipedia.org/wiki/Full-text_search',
]

const app = express()
const PORT = 3000

app.use(express.json())

let indexData = null

function saveIndexToDisk() {
  if (!indexData) return
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(INDEX_FILE, JSON.stringify(serializeIndex(indexData)))
  console.log(`[server] Index saved to ${INDEX_FILE}`)
}

function loadIndexFromDisk() {
  if (!fs.existsSync(INDEX_FILE)) return false
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'))
    indexData = deserializeIndex(raw)
    console.log(`[server] Loaded index from disk (${indexData.index.size} terms).`)
    return true
  } catch (err) {
    console.log(`[server] Failed to load index: ${err.message}`)
    return false
  }
}

app.post('/api/crawl', async (req, res) => {
  const { urls, maxPages } = req.body

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Provide a non-empty "urls" array.' })
  }

  try {
    const pages = await crawl(urls, maxPages || 100)
    indexData = buildIndex(pages)
    saveIndexToDisk()
    res.json({ pagesCollected: pages.length, termsIndexed: indexData.index.size })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/search', (req, res) => {
  const q = req.query.q

  if (!q) {
    return res.status(400).json({ error: 'Provide a "q" query parameter.' })
  }

  if (!indexData) {
    return res.status(400).json({ error: 'Index is empty. Crawl pages first with POST /api/crawl.' })
  }

  const results = search(indexData, q)
  res.json({ query: q, count: results.length, results })
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', indexed: indexData !== null })
})

async function seedIfNeeded() {
  if (loadIndexFromDisk()) return

  console.log('[server] No index found. Seeding with default pages...')
  try {
    const pages = await crawl(SEED_URLS, 50)
    indexData = buildIndex(pages)
    saveIndexToDisk()
  } catch (err) {
    console.log(`[server] Seed crawl failed: ${err.message}`)
  }
}

app.listen(PORT, async () => {
  console.log(`[server] Probe search engine running on http://localhost:${PORT}`)
  console.log(`[server] POST /api/crawl  — start crawling with { "urls": [...] }`)
  console.log(`[server] GET  /api/search?q=... — search the index`)
  await seedIfNeeded()
})
