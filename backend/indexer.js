import {
  initDb,
  insertPages,
  insertPostings,
  insertEmbeddings,
  getPageCount,
  getPageData,
  getPageDataBatch,
  batchSearchTerms,
  getDocLengths,
  getAvgDocLength,
  getMissingEmbeddingIds as dbGetMissingEmbeddingIds,
  getEmbedding,
  getAllEmbeddings,
  getMaxPageId,
  getDb,
} from './db.js'

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'was', 'are',
  'been', 'have', 'has', 'had', 'this', 'that', 'not', 'no', 'do',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall',
  'can', 'if', 'then', 'than', 'so', 'such', 'more', 'some', 'any',
  'all', 'each', 'every', 'both', 'few', 'many', 'much', 'own', 'other',
  'into', 'over', 'after', 'before', 'between', 'under', 'again',
  'further', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
  'what', 'which', 'who', 'whom', 'its', 'about', 'up', 'out', 'just',
])

const MAX_TEXT_STORE = 3000

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 1)
}

function normalizeVector(vec) {
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
  if (mag === 0) return vec
  return vec.map(v => v / mag)
}

function cosineSimilarity(a, b) {
  return a.reduce((sum, val, i) => sum + val * b[i], 0)
}

export async function buildIndex(pages) {
  const db = await initDb()
  const ids = await insertPages(pages)

  for (let i = 0; i < pages.length; i++) {
    const tokens = tokenize(pages[i].text)
    const termFreq = new Map()
    for (const token of tokens) {
      if (STOP_WORDS.has(token)) continue
      termFreq.set(token, (termFreq.get(token) || 0) + 1)
    }
    await insertPostings(ids[i], termFreq)
  }

  console.log(`[indexer] Indexed ${pages.length} pages.`)
  return { db }
}

export async function addToIndex(indexData, newPages) {
  const ids = await insertPages(newPages)

  for (let i = 0; i < newPages.length; i++) {
    const tokens = tokenize(newPages[i].text)
    const termFreq = new Map()
    for (const token of tokens) {
      if (STOP_WORDS.has(token)) continue
      termFreq.set(token, (termFreq.get(token) || 0) + 1)
    }
    await insertPostings(ids[i], termFreq)
  }
}

export async function setEmbeddings(indexData, pageIds, embeddings) {
  const normalized = embeddings.map(normalizeVector)
  await insertEmbeddings(pageIds, normalized)
}

export async function getMissingEmbeddingIds(indexData) {
  return dbGetMissingEmbeddingIds()
}

export async function search(indexData, query, queryEmbedding = null) {
  const tokens = tokenize(query).filter(t => !STOP_WORDS.has(t))
  if (tokens.length === 0 && !queryEmbedding) return []

  const totalPages = await getPageCount()
  if (totalPages === 0) return []

  const scores = new Map()
  const urlMatched = new Set()
  const K1 = 1.2
  const B = 0.75

  if (tokens.length > 0) {
    const allPostings = await batchSearchTerms(tokens)
    const avgDl = await getAvgDocLength()

    const byTerm = new Map()
    for (const p of allPostings) {
      if (!byTerm.has(p.term)) byTerm.set(p.term, [])
      byTerm.get(p.term).push(p)
    }

    const candidateIds = [...new Set(allPostings.map(p => p.page_id))]
    const docLengths = await getDocLengths(candidateIds)

    for (const [term, postings] of byTerm) {
      const df = postings.length
      const idf = Math.log((totalPages - df + 0.5) / (df + 0.5) + 1)

      for (const { page_id, freq } of postings) {
        const dl = docLengths.get(page_id) || 1
        const tfNorm = (freq * (K1 + 1)) / (freq + K1 * (1 - B + B * (dl / (avgDl || 1))))
        scores.set(page_id, (scores.get(page_id) || 0) + idf * tfNorm)
      }
    }

    if (candidateIds.length > 0) {
      const pages = await getPageDataBatch(candidateIds)
      for (const page of pages) {
        const urlLower = page.url.toLowerCase()
        const titleLower = (page.title || '').toLowerCase()
        let boost = 0

        for (const token of tokens) {
          if (urlLower.includes(token)) {
            boost += 30
            urlMatched.add(page.id)
          } else if (titleLower.includes(token)) {
            boost += 15
          }
        }

        if (boost > 0) {
          scores.set(page.id, (scores.get(page.id) || 0) + boost)
        }
      }
    }
  }

  if (queryEmbedding) {
    const normQuery = normalizeVector(queryEmbedding)
    const allEmbeddings = await getAllEmbeddings()
    const SIM_THRESHOLD = 0.25

    for (const [pageId, emb] of allEmbeddings) {
      const sim = cosineSimilarity(normQuery, emb)
      if (sim > SIM_THRESHOLD) {
        scores.set(pageId, (scores.get(pageId) || 0) + sim * 50)
      }
    }
  }

  const resultIds = [...scores.keys()]
  if (resultIds.length === 0) return []

  const pages = await getPageDataBatch(resultIds)
  const results = pages.map(page => ({
    url: page.url,
    title: page.title,
    score: scores.get(page.id) || 0,
    urlMatch: urlMatched.has(page.id),
  }))

  const urlResults = results.filter(r => r.urlMatch).sort((a, b) => b.score - a.score)
  const otherResults = results.filter(r => !r.urlMatch).sort((a, b) => b.score - a.score)

  return [...urlResults, ...otherResults].slice(0, 20)
}

export function serializeIndex(indexData) {
  return {}
}

export function deserializeIndex(raw) {
  return { db: getDb() }
}

export async function getIndexStats(indexData) {
  const db = getDb()
  if (!db) return { pages: 0, terms: 0, embeddings: 0 }

  const pageRow = db.prepare('SELECT COUNT(*) as c FROM pages').get()
  const termRow = db.prepare('SELECT COUNT(DISTINCT term) as c FROM postings').get()
  const embRow = db.prepare('SELECT COUNT(*) as c FROM embeddings').get()

  return {
    pages: pageRow.c,
    terms: termRow.c,
    embeddings: embRow.c,
  }
}
