import 'dotenv/config'
import express from 'express'
import { InferenceClient } from '@huggingface/inference'
import { uploadFiles, downloadFile, createRepo } from '@huggingface/hub'
import Groq from 'groq-sdk'
import { createCrawler } from './crawler.js'
import {
  buildIndex,
  addToIndex,
  search,
  setEmbeddings,
  getMissingEmbeddingIds,
  serializeIndex,
  deserializeIndex,
} from './indexer.js'

const HF_TOKEN = process.env.VITE_HUGGINGFACE_API_KEY
const GROQ_KEY = process.env.VITE_GROQ_API_KEY
const HF_REPO = 'Wafee8/indexed_pages'
const EMBED_MODEL = 'sentence-transformers/all-MiniLM-L6-v2'
const EMBED_BATCH_SIZE = 32
const SAVE_INTERVAL = 50
const CRAWL_DELAY_MS = 1000
const QUERY_CRAWL_CHANCE = 0.35
const PAGES_PER_SHARD = 100000

const hf = new InferenceClient(HF_TOKEN)
const groq = GROQ_KEY ? new Groq({ apiKey: GROQ_KEY }) : null

const SEED_URLS = [
  // ─── Search & Reference ───
  'https://www.britannica.com/',
  'https://www.wolfram.com/',
  'https://www.desmos.com/',
  'https://www.wordreference.com/',
  'https://www.dictionary.com/',
  'https://www.thesaurus.com/',
  'https://www.deepl.com/',
  'https://www.timeanddate.com/',

  // ─── AI & Machine Learning ───
  'https://openai.com/',
  'https://ai.google/',
  'https://www.anthropic.com/',
  'https://huggingface.co/',
  'https://pytorch.org/',
  'https://www.tensorflow.org/',
  'https://keras.io/',
  'https://stability.ai/',
  'https://www.perplexity.ai/',

  // ─── Development ───
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
  'https://www.w3schools.com/',
  'https://css-tricks.com/',
  'https://smashingmagazine.com/',
  'https://freecodecamp.org/news/',
  'https://dev.to/',
  'https://hackernoon.com/',
  'https://tailwindcss.com/docs',
  'https://svelte.dev/docs',
  'https://webpack.js.org/concepts/',
  'https://vitejs.dev/guide/',
  'https://jestjs.io/docs/getting-started',
  'https://playwright.dev/docs/intro',
  'https://strapi.io/docs',
  'https://www.prisma.io/docs',
  'https://supabase.com/docs',
  'https://firebase.google.com/docs',
  'https://vercel.com/docs',
  'https://netlify.com/docs/',
  'https://cloudflare.com/docs/',
  'https://docs.npmjs.com/',
  'https://pnpm.io/installation',

  // ─── Gaming ───
  'https://store.steampowered.com/',
  'https://www.epicgames.com/',
  'https://www.xbox.com/',
  'https://www.playstation.com/',
  'https://www.nintendo.com/',
  'https://www.ign.com/',
  'https://www.gamespot.com/',
  'https://www.pcgamer.com/',
  'https://www.polygon.com/',
  'https://www.destructoid.com/',
  'https://www.rockpapershotgun.com/',
  'https://kotaku.com/',
  'https://www.eurogamer.net/',
  'https://www.gameinformer.com/',
  'https://www.gamedeveloper.com/',
  'https://itch.io/',
  'https://www.gog.com/',
  'https://www.humblebundle.com/',
  'https://www.twitch.tv/directory',
  'https://www.speedrun.com/',
  'https://howlongtobeat.com/',
  'https://www.metacritic.com/',
  'https://www.giantbomb.com/',
  'https://gaming.stackexchange.com/',
  'https://rpg.stackexchange.com/',
  'https://www.unity.com/learn',
  'https://docs.unrealengine.com/',
  'https://godotengine.org/documentation',
  'https://www.gamedev.net/',
  'https://www.indiedb.com/',
  'https://www.moddb.com/',

  // ─── Social Media & Forums ───
  'https://www.reddit.com/',
  'https://www.reddit.com/r/popular/',
  'https://www.reddit.com/r/technology/',
  'https://www.reddit.com/r/gaming/',
  'https://www.reddit.com/r/science/',
  'https://www.reddit.com/r/worldnews/',
  'https://www.reddit.com/r/programming/',
  'https://www.reddit.com/r/music/',
  'https://www.reddit.com/r/movies/',
  'https://old.reddit.com/',
  'https://news.ycombinator.com/',
  'https://lobste.rs/',
  'https://www.quora.com/',
  'https://stackexchange.com/',
  'https://superuser.com/',
  'https://askubuntu.com/',
  'https://serverfault.com/',
  'https://math.stackexchange.com/',
  'https://physics.stackexchange.com/',
  'https://english.stackexchange.com/',
  'https://mastodon.social/',
  'https://www.tumblr.com/explore',

  // ─── News & Media ───
  'https://www.bbc.com/news',
  'https://www.reuters.com/',
  'https://www.apnews.com/',
  'https://www.theguardian.com/',
  'https://www.nytimes.com/',
  'https://www.washingtonpost.com/',
  'https://www.cnn.com/',
  'https://www.aljazeera.com/',
  'https://news.google.com/',
  'https://www.wired.com/',
  'https://techcrunch.com/',
  'https://www.theverge.com/',
  'https://arstechnica.com/',
  'https://www.engadget.com/',
  'https://www.bloomberg.com/',
  'https://www.ft.com/',
  'https://www.economist.com/',
  'https://www.wsj.com/',
  'https://www.forbes.com/',
  'https://www.businessinsider.com/',
  'https://www.cnbc.com/',
  'https://www.yahoo.com/',
  'https://www.npr.org/',
  'https://www.dw.com/',

  // ─── Streaming & Entertainment ───
  'https://www.youtube.com/',
  'https://www.netflix.com/',
  'https://www.twitch.tv/',
  'https://www.spotify.com/',
  'https://soundcloud.com/',
  'https://bandcamp.com/',
  'https://www.imdb.com/',
  'https://www.rottentomatoes.com/',
  'https://letterboxd.com/',
  'https://www.crunchyroll.com/',
  'https://www.vimeo.com/',
  'https://www.goodreads.com/',

  // ─── Shopping & E-Commerce ───
  'https://www.amazon.com/',
  'https://www.ebay.com/',
  'https://www.walmart.com/',
  'https://www.etsy.com/',
  'https://www.aliexpress.com/',
  'https://www.bestbuy.com/',
  'https://www.target.com/',
  'https://www.newegg.com/',

  // ─── Education & Learning ───
  'https://www.khanacademy.org/',
  'https://www.coursera.org/',
  'https://www.udemy.com/',
  'https://www.edx.org/',
  'https://ocw.mit.edu/',
  'https://www.codecademy.com/',
  'https://www.duolingo.com/',
  'https://brilliant.org/',
  'https://www.quizlet.com/',
  'https://scholar.google.com/',
  'https://www.jstor.org/',

  // ─── Science & Research ───
  'https://arxiv.org/',
  'https://www.scientificamerican.com/',
  'https://www.nature.com/',
  'https://www.sciencedaily.com/',
  'https://www.nasa.gov/',
  'https://www.spacex.com/',
  'https://www.nationalgeographic.com/',
  'https://www.space.com/',
  'https://pubmed.ncbi.nlm.nih.gov/',

  // ─── Health & Fitness ───
  'https://www.webmd.com/',
  'https://www.mayoclinic.org/',
  'https://www.healthline.com/',
  'https://www.who.int/',
  'https://www.cdc.gov/',
  'https://www.nhs.uk/',

  // ─── Finance & Crypto ───
  'https://www.coindesk.com/',
  'https://cointelegraph.com/',
  'https://www.investopedia.com/',
  'https://www.coingecko.com/',
  'https://www.coinmarketcap.com/',
  'https://finance.yahoo.com/',
  'https://www.tradingview.com/',

  // ─── Travel & Maps ───
  'https://www.tripadvisor.com/',
  'https://www.booking.com/',
  'https://www.airbnb.com/',
  'https://www.lonelyplanet.com/',

  // ─── Food & Recipes ───
  'https://www.allrecipes.com/',
  'https://www.bonappetit.com/',
  'https://www.foodnetwork.com/',
  'https://www.seriouseats.com/',

  // ─── Sports ───
  'https://www.espn.com/',
  'https://www.skysports.com/',
  'https://www.nba.com/',
  'https://www.nfl.com/',
  'https://www.formula1.com/',
  'https://www.ufc.com/',

  // ─── Productivity & Tools ───
  'https://www.figma.com/',
  'https://www.canva.com/',
  'https://www.slack.com/',
  'https://www.notion.so/',

  // ─── Design & Creative ───
  'https://dribbble.com/',
  'https://www.behance.net/',
  'https://unsplash.com/',
  'https://www.pexels.com/',
  'https://www.producthunt.com/',

  // ─── Privacy & Security ───
  'https://www.eff.org/',
  'https://owasp.org/',
  'https://www.virustotal.com/',
  'https://letsencrypt.org/',
]

const SEARCH_SITES = [
  { base: 'https://www.reddit.com', pattern: '/search/?q={q}' },
  { base: 'https://stackoverflow.com', pattern: '/search?q={q}' },
  { base: 'https://dev.to', pattern: '/search?q={q}' },
  { base: 'https://news.ycombinator.com', pattern: '/item?fnid={q}' },
  { base: 'https://www.youtube.com', pattern: '/results?search_query={q}' },
  { base: 'https://www.imdb.com', pattern: '/find/?q={q}' },
  { base: 'https://www.quora.com', pattern: '/search?q={q}' },
  { base: 'https://www.britannica.com', pattern: '/search?query={q}' },
]

const ARTICLE_SITES = [
  { base: 'https://www.britannica.com', path: '/topic/{slug}' },
  { base: 'https://developer.mozilla.org', path: '/en-US/search?q={q}' },
]

const app = express()
const PORT = 3000

app.use(express.json())

let indexData = null
let crawler = null
let pagesSinceLastSave = 0
let crawledByBg = 0
let searchHistory = new Map()
let knownUrls = new Set()
let dirtyShards = new Set()
let uploadedShards = new Set()

const seedSet = new Set(SEED_URLS.map(u => u.replace(/\/+$/, '')))

function generateQueryUrls(query) {
  const urls = []
  const encoded = encodeURIComponent(query)
  const slug = query.toLowerCase().replace(/\s+/g, '_')
  const title = query.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('_')
  const dashSlug = query.toLowerCase().replace(/\s+/g, '-')

  for (const site of SEARCH_SITES) {
    urls.push(`${site.base}${site.pattern.replace('{q}', encoded)}`)
  }

  for (const site of ARTICLE_SITES) {
    urls.push(`${site.base}${site.path.replace('{title}', title).replace('{slug}', dashSlug)}`)
  }

  urls.push(`https://developer.mozilla.org/en-US/search?q=${encoded}`)
  urls.push(`https://www.goodreads.com/search?q=${encoded}`)
  urls.push(`https://scholar.google.com/scholar?q=${encoded}`)
  urls.push(`https://www.crunchyroll.com/search?q=${encoded}`)
  urls.push(`https://www.investopedia.com/search?q=${encoded}`)
  urls.push(`https://www.healthline.com/search?q=${encoded}`)
  urls.push(`https://www.allrecipes.com/search?q=${encoded}`)

  return urls
}

function recordSearch(query) {
  const q = query.trim().toLowerCase()
  if (!q) return
  searchHistory.set(q, (searchHistory.get(q) || 0) + 1)
}

function getTopSearchTerms(limit = 20) {
  return [...searchHistory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => term)
}

async function ensureRepoExists() {
  try {
    await uploadFiles({
      repo: { type: 'dataset', name: HF_REPO },
      files: [],
      credentials: { accessToken: HF_TOKEN },
    })
  } catch (err) {
    if (err.message?.includes('not found') || err.message?.includes('404')) {
      console.log('[server] Creating HuggingFace dataset repo...')
      await createRepo({
        repo: { type: 'dataset', name: HF_REPO },
        credentials: { accessToken: HF_TOKEN },
      })
    }
  }
}

function getShardId(pageId) {
  return Math.floor(pageId / PAGES_PER_SHARD) + 1
}

function getActiveShardIds() {
  const ids = new Set()
  if (!indexData) return ids
  for (const [pageId] of indexData.pageData) {
    ids.add(getShardId(pageId))
  }
  return ids
}

function buildShardPayload(shardId) {
  const { index, pageData, embeddings } = indexData
  const minId = (shardId - 1) * PAGES_PER_SHARD
  const maxId = minId + PAGES_PER_SHARD

  const shardPages = new Map()
  for (const [id, data] of pageData) {
    if (id >= minId && id < maxId) shardPages.set(id, data)
  }

  const shardIndex = new Map()
  for (const [term, postings] of index) {
    const matching = postings.filter(p => {
      const sid = getShardId(p.pageId)
      return sid === shardId
    })
    if (matching.length > 0) shardIndex.set(term, matching)
  }

  const shardEmbeddings = new Map()
  for (const [id, emb] of embeddings) {
    if (id >= minId && id < maxId) shardEmbeddings.set(id, emb)
  }

  return {
    pageData: Object.fromEntries(shardPages),
    index: Object.fromEntries(
      [...shardIndex].map(([term, postings]) => [term, postings])
    ),
    embeddings: Object.fromEntries(
      [...shardEmbeddings].map(([k, v]) => [k, Array.from(v)])
    ),
  }
}

async function saveIndexToHub(forceAll = false) {
  if (!indexData) return
  try {
    const shardIds = getActiveShardIds()
    const toSave = forceAll ? [...shardIds] : [...shardIds].filter(id => !uploadedShards.has(id))
    if (!forceAll) {
      for (const id of dirtyShards) {
        if (shardIds.has(id) && !toSave.includes(id)) toSave.push(id)
      }
    }
    if (toSave.length === 0) return

    const files = []
    for (const sid of toSave) {
      const payload = JSON.stringify(buildShardPayload(sid))
      files.push({ path: `index_${sid}.json`, content: new Blob([payload]) })
      console.log(`[server] Shard ${sid}: ${(Buffer.byteLength(payload) / 1024 / 1024).toFixed(1)} MB, pages: ${JSON.parse(payload).pageData ? Object.keys(JSON.parse(payload).pageData).length : '?'}`)
    }

    files.push({
      path: 'meta.json',
      content: new Blob([JSON.stringify({
        totalShards: Math.max(...shardIds),
        pagesPerShard: PAGES_PER_SHARD,
        totalPages: indexData.pageData.size,
      })]),
    })

    await uploadFiles({
      repo: { type: 'dataset', name: HF_REPO },
      files,
      credentials: { accessToken: HF_TOKEN },
    })

    for (const sid of toSave) {
      uploadedShards.add(sid)
      dirtyShards.delete(sid)
    }
    console.log(`[server] Saved ${toSave.length} shard(s) to HuggingFace (${indexData.pageData.size} pages total).`)
  } catch (err) {
    console.log(`[server] HF save failed: ${err.message}`)
  }
}

function mergeShardIntoIndex(raw) {
  const shardPageData = new Map()
  for (const [k, v] of Object.entries(raw.pageData || {})) {
    shardPageData.set(Number(k), { url: v.url, title: v.title, text: v.text || '' })
  }
  const shardEmbeddings = new Map()
  for (const [k, v] of Object.entries(raw.embeddings || {})) {
    shardEmbeddings.set(Number(k), v)
  }

  if (!indexData) {
    const shardIndex = new Map()
    for (const [term, postings] of Object.entries(raw.index || {})) {
      shardIndex.set(term, postings)
    }
    indexData = { index: shardIndex, pageData: shardPageData, embeddings: shardEmbeddings }
    return
  }

  for (const [id, data] of shardPageData) {
    indexData.pageData.set(id, data)
  }
  for (const [id, emb] of shardEmbeddings) {
    indexData.embeddings.set(id, emb)
  }
  for (const [term, postings] of Object.entries(raw.index || {})) {
    if (!indexData.index.has(term)) {
      indexData.index.set(term, postings)
    } else {
      const existing = indexData.index.get(term)
      const existingIds = new Set(existing.map(p => p.pageId))
      for (const p of postings) {
        if (!existingIds.has(p.pageId)) existing.push(p)
      }
    }
  }
}

async function loadIndexFromHub() {
  try {
    let metaBlob
    try {
      metaBlob = await downloadFile({
        repo: { type: 'dataset', name: HF_REPO },
        path: 'meta.json',
        credentials: { accessToken: HF_TOKEN },
      })
    } catch {}

    if (metaBlob) {
      const metaText = await metaBlob.text()
      const meta = JSON.parse(metaText)
      console.log(`[server] Found ${meta.totalShards} shard(s) on HuggingFace.`)

      for (let sid = 1; sid <= meta.totalShards; sid++) {
        try {
          const blob = await downloadFile({
            repo: { type: 'dataset', name: HF_REPO },
            path: `index_${sid}.json`,
            credentials: { accessToken: HF_TOKEN },
          })
          if (!blob) continue
          const text = await blob.text()
          const raw = JSON.parse(text)
          mergeShardIntoIndex(raw)
          uploadedShards.add(sid)
          console.log(`[server] Loaded shard ${sid}/${meta.totalShards} (${Object.keys(raw.pageData || {}).length} pages).`)
        } catch (err) {
          console.log(`[server] Shard ${sid} load failed: ${err.message}`)
        }
      }

      if (indexData) {
        console.log(
          `[server] Total: ${indexData.pageData.size} pages, ${indexData.index.size} terms, ${indexData.embeddings.size} embeddings.`
        )
        return true
      }
      return false
    }

    try {
      const blob = await downloadFile({
        repo: { type: 'dataset', name: HF_REPO },
        path: 'index.json',
        credentials: { accessToken: HF_TOKEN },
      })
      if (!blob) return false
      const text = await blob.text()
      const raw = JSON.parse(text)
      indexData = deserializeIndex(raw)
      console.log(
        `[server] Loaded legacy index from HuggingFace (${indexData.pageData.size} pages, ${indexData.index.size} terms, ${indexData.embeddings.size} embeddings).`
      )
      return true
    } catch {
      return false
    }
  } catch (err) {
    console.log(`[server] HF load failed: ${err.message}`)
    return false
  }
}

async function embedTexts(texts) {
  const out = []
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE)
    const embeds = await hf.featureExtraction({
      model: EMBED_MODEL,
      inputs: batch,
    })
    out.push(...embeds)
  }
  return out
}

async function embedQuery(query) {
  try {
    const [embedding] = await hf.featureExtraction({
      model: EMBED_MODEL,
      inputs: [query],
    })
    return embedding
  } catch {
    return null
  }
}

async function processEmbedQueue() {
  if (!indexData) return
  const missing = getMissingEmbeddingIds(indexData)
  if (missing.length === 0) return

  const batch = missing.slice(0, EMBED_BATCH_SIZE)
  const texts = batch.map(id => {
    const p = indexData.pageData.get(id)
    return `${p.title} ${p.text}`.substring(0, 500)
  })

  try {
    console.log(`[embed] Computing embeddings for ${batch.length} pages...`)
    const embeddings = await embedTexts(texts)
    setEmbeddings(indexData, batch, embeddings)
    console.log(`[embed] Done. Total embedded: ${indexData.embeddings.size}/${indexData.pageData.size}`)

    if (missing.length > EMBED_BATCH_SIZE) {
      setTimeout(() => processEmbedQueue(), 2000)
    }
  } catch (err) {
    console.log(`[embed] Error: ${err.message}`)
  }
}

async function backgroundCrawlLoop() {
  if (!crawler) return

  while (true) {
    const useQueryCrawl = crawler.prioritySize > 0 && Math.random() < QUERY_CRAWL_CHANCE
    const page = await crawler.fetchNext(useQueryCrawl)
    if (!page) {
      const topTerms = getTopSearchTerms(5)
      for (const term of topTerms) {
        crawler.addUrls(generateQueryUrls(term), true)
      }
      await new Promise(r => setTimeout(r, CRAWL_DELAY_MS))
      continue
    }

    if (!knownUrls.has(page.url)) {
      knownUrls.add(page.url)
      addToIndex(indexData, [page])
      pagesSinceLastSave++
      crawledByBg++
      dirtyShards.add(getShardId(indexData.pageData.size - 1))

      if (pagesSinceLastSave >= SAVE_INTERVAL) {
        pagesSinceLastSave = 0
        await saveIndexToHub()
        await processEmbedQueue()
      }
    }

    if (crawledByBg % 100 === 0) {
      console.log(
        `[crawler] ${crawledByBg} bg pages | queue: ${crawler.queueSize} | priority: ${crawler.prioritySize} | indexed: ${indexData.pageData.size} pages, ${indexData.embeddings.size} embeddings`
      )
    }

    await new Promise(r => setTimeout(r, CRAWL_DELAY_MS))
  }
}

async function seedIfNeeded() {
  if (await loadIndexFromHub()) {
    for (const [, data] of indexData.pageData) {
      knownUrls.add(data.url)
    }
    return
  }

  console.log('[server] No index found. Seeding with default pages...')
  const { crawl } = await import('./crawler.js')
  const pages = await crawl(SEED_URLS, 50)
  indexData = buildIndex(pages)
  for (const p of pages) knownUrls.add(p.url)
  await ensureRepoExists()
  await saveIndexToHub(true)
}

// ─── API Endpoints ───

app.get('/api/search', async (req, res) => {
  const q = req.query.q
  if (!q) return res.status(400).json({ error: 'Provide a "q" query parameter.' })
  if (!indexData) return res.status(400).json({ error: 'Index is empty. Wait for crawling to complete.' })

  recordSearch(q)

  const queryUrls = generateQueryUrls(q)
  if (crawler) {
    crawler.addUrls(queryUrls, true)
  }

  let queryEmbedding = null
  try {
    queryEmbedding = await embedQuery(q)
  } catch {}

  const results = search(indexData, q, queryEmbedding)
  res.json({ query: q, count: results.length, results })
})

app.get('/api/overview', async (req, res) => {
  const q = req.query.q
  if (!q) return res.status(400).json({ error: 'Provide a "q" query parameter.' })
  if (!groq) return res.status(500).json({ error: 'Groq API key not configured.' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const stream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful search assistant. Provide concise, accurate overviews based on the user query. Keep it under 200 words.',
        },
        { role: 'user', content: q },
      ],
      stream: true,
      max_tokens: 300,
    })

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content
      if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`)
    }
    res.write('data: [DONE]\n\n')
  } catch (err) {
    console.log(`[overview error] ${err.message}`)
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
  }
  res.end()
})

app.post('/api/crawl', async (req, res) => {
  const { urls } = req.body
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Provide a non-empty "urls" array.' })
  }

  if (crawler) {
    crawler.addUrls(urls)
    res.json({ message: `Added ${urls.length} URLs to crawl queue.`, queueSize: crawler.queueSize })
  } else {
    res.status(400).json({ error: 'Crawler not initialized yet.' })
  }
})

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    indexed: indexData !== null,
    totalPages: indexData?.pageData.size || 0,
    totalTerms: indexData?.index.size || 0,
    embeddings: indexData?.embeddings.size || 0,
    crawledByBg,
    queueSize: crawler?.queueSize || 0,
    priorityQueue: crawler?.prioritySize || 0,
    visited: crawler?.visitedSize || 0,
    isCrawling: !!crawler,
    topSearches: getTopSearchTerms(5),
    totalSearches: searchHistory.size,
    shards: {
      active: getActiveShardIds().size,
      dirty: dirtyShards.size,
      uploaded: uploadedShards.size,
      pagesPerShard: PAGES_PER_SHARD,
    },
  })
})

app.post('/api/reindex', async (req, res) => {
  if (!indexData) return res.status(400).json({ error: 'No index loaded.' })
  await saveIndexToHub(true)
  await processEmbedQueue()
  res.json({ message: 'Reindex triggered.', totalPages: indexData.pageData.size })
})

// ─── Startup ───

app.listen(PORT, async () => {
  console.log(`[server] Probe search engine running on http://localhost:${PORT}`)
  console.log(`[server] POST /api/crawl  — add URLs to crawl queue`)
  console.log(`[server] GET  /api/search?q=... — search the index`)

  await seedIfNeeded()

  crawler = createCrawler(SEED_URLS)

  for (const url of knownUrls) {
    const isSeed = seedSet.has(url.replace(/\/+$/, ''))
    if (!isSeed) {
      crawler.visited.add(url)
    }
  }

  console.log(`[crawler] Marked ${knownUrls.size - SEED_URLS.length} already-indexed URLs as visited (seed URLs left for rediscovery).`)
  console.log(`[crawler] Background crawling started.`)

  backgroundCrawlLoop()
})
