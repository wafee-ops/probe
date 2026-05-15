import 'dotenv/config'
import express from 'express'
import Groq from 'groq-sdk'
import { uploadFiles, downloadFile, createRepo } from '@huggingface/hub'
import { crawl } from './crawler.js'
import { buildIndex, search, serializeIndex, deserializeIndex } from './indexer.js'

const groq = new Groq({ apiKey: process.env.VITE_GROQ_API_KEY })

const HF_REPO = { type: 'dataset', name: 'Wafee8/indexed_pages' }
const HF_TOKEN = process.env.VITE_HUGGINGFACE_API_KEY
const INDEX_PATH = 'index.json'

const SEED_URLS = [
  'https://en.wikipedia.org/wiki/Web_search_engine',
  'https://en.wikipedia.org/wiki/JavaScript',
  'https://en.wikipedia.org/wiki/Node.js',
  'https://en.wikipedia.org/wiki/React',
  'https://en.wikipedia.org/wiki/HTTP',
  'https://en.wikipedia.org/wiki/Search_engine_optimization',
  'https://en.wikipedia.org/wiki/Web_crawler',
  'https://en.wikipedia.org/wiki/Inverted_index',
  'https://en.wikipedia.org/wiki/Full-text_search',
  'https://en.wikipedia.org/wiki/Artificial_intelligence',
  'https://en.wikipedia.org/wiki/Machine_learning',
  'https://en.wikipedia.org/wiki/Python_(programming_language)',
  'https://en.wikipedia.org/wiki/Linux',
  'https://en.wikipedia.org/wiki/Internet',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
  'https://developer.mozilla.org/en-US/docs/Web/API',
  'https://developer.mozilla.org/en-US/docs/Learn',
  'https://developer.mozilla.org/en-US/docs/Web/HTML',
  'https://developer.mozilla.org/en-US/docs/Web/CSS',
  'https://developer.mozilla.org/en-US/docs/Web/HTTP',
  'https://nodejs.org/en/learn',
  'https://nodejs.org/en/docs',
  'https://expressjs.com/',
  'https://react.dev/learn',
  'https://react.dev/reference',
  'https://nextjs.org/docs',
  'https://vuejs.org/guide/introduction',
  'https://angular.dev/overview',
  'https://typescriptlang.org/docs/',
  'https://www.python.org/doc/',
  'https://docs.python.org/3/tutorial/',
  'https://flask.palletsprojects.com/',
  'https://fastapi.tiangolo.com/',
  'https://django.readthedocs.io/',
  'https://rust-lang.org/docs/',
  'https://doc.rust-lang.org/book/',
  'https://go.dev/doc/',
  'https://golang.org/doc/',
  'https://postgresql.org/docs/',
  'https://mongodb.com/docs/',
  'https://redis.io/docs/',
  'https://docker.com/docs/',
  'https://kubernetes.io/docs/',
  'https://aws.amazon.com/documentation/',
  'https://cloud.google.com/docs',
  'https://docs.github.com/',
  'https://git-scm.com/doc',
  'https://stackoverflow.com/questions',
  'https://stackoverflow.com/tags',
  'https://news.ycombinator.com/',
  'https://lobste.rs/',
  'https://www.w3schools.com/',
  'https://css-tricks.com/',
  'https://smashingmagazine.com/',
  'https://freecodecamp.org/news/',
  'https://dev.to/',
  'https://hackernoon.com/',
  'https://arxiv.org/',
  'https://www.scientificamerican.com/',
  'https://www.nature.com/',
  'https://www.bbc.com/news',
  'https://www.reuters.com/',
  'https://www.wired.com/',
  'https://techcrunch.com/',
  'https://www.theverge.com/',
  'https://arstechnica.com/',
]

const app = express()
const PORT = 3000

app.use(express.json())

let indexData = null

async function ensureRepoExists() {
  try {
    await createRepo({
      repo: HF_REPO,
      credentials: { accessToken: HF_TOKEN },
    })
  } catch {}
}

async function saveIndexToHub() {
  if (!indexData) return
  await ensureRepoExists()
  const json = JSON.stringify(serializeIndex(indexData))
  const blob = new Blob([json], { type: 'application/json' })
  await uploadFiles({
    repo: HF_REPO,
    credentials: { accessToken: HF_TOKEN },
    files: [{ path: INDEX_PATH, content: blob }],
  })
  console.log(`[server] Index saved to HuggingFace dataset (${HF_REPO.name})`)
}

async function loadIndexFromHub() {
  try {
    const response = await downloadFile({
      repo: HF_REPO,
      path: INDEX_PATH,
    })
    if (!response) return false
    const text = await response.text()
    const raw = JSON.parse(text)
    indexData = deserializeIndex(raw)
    console.log(`[server] Loaded index from HuggingFace (${indexData.index.size} terms).`)
    return true
  } catch (err) {
    console.log(`[server] Could not load index from HuggingFace: ${err.message}`)
    return false
  }
}

app.post('/api/crawl', async (req, res) => {
  const { urls, maxPages } = req.body

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Provide a non-empty "urls" array.' })
  }

  try {
    const pages = await crawl(urls, maxPages || 500)
    indexData = buildIndex(pages)
    await saveIndexToHub()
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

app.get('/api/overview', async (req, res) => {
  const q = req.query.q
  if (!q) return res.status(400).json({ error: 'Provide a "q" query parameter.' })
  if (!indexData) return res.status(400).json({ error: 'Index is empty. Crawl pages first.' })

  try {
    const results = search(indexData, q)
    const context = results
      .slice(0, 5)
      .map((r, i) => `[${i + 1}] ${r.title || 'Untitled'} — ${r.url}`)
      .join('\n')

    const completion = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful search assistant. Given a user query and a list of relevant web pages, write a concise AI overview that summarizes the key information the user is likely looking for. Use a neutral, informative tone. Keep it to 2-4 paragraphs. Do not mention the numbered sources explicitly in your answer.',
        },
        {
          role: 'user',
          content: `Query: "${q}"\n\nRelevant pages:\n${context}\n\nWrite a brief AI overview for this search query.`,
        },
      ],
      max_tokens: 512,
      temperature: 0.3,
    })

    res.json({ query: q, overview: completion.choices[0].message.content })
  } catch (err) {
    console.error('[overview error]', err.message)
    res.status(500).json({ error: 'Failed to generate AI overview.' })
  }
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', indexed: indexData !== null })
})

app.post('/api/reindex', async (req, res) => {
  const { maxPages } = req.body || {}
  try {
    res.json({ status: 'crawling' })
    const pages = await crawl(SEED_URLS, maxPages || 500)
    indexData = buildIndex(pages)
    await saveIndexToHub()
    console.log(`[server] Re-indexed ${pages.length} pages, ${indexData.index.size} terms.`)
  } catch (err) {
    console.error(`[server] Reindex failed: ${err.message}`)
  }
})

async function seedIfNeeded() {
  if (await loadIndexFromHub()) return

  console.log('[server] No index found on HuggingFace. Seeding with default pages...')
  try {
    const pages = await crawl(SEED_URLS, 500)
    indexData = buildIndex(pages)
    await saveIndexToHub()
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
