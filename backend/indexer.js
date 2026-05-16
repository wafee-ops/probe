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
const EMBED_DIM = 384

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 1)
}

function recalculateIdf(index, totalDocs) {
  for (const [, postings] of index) {
    const idf = Math.log(totalDocs / postings.length)
    for (const posting of postings) {
      posting.score = posting.freq * idf
    }
  }
}

function normalizeVector(vec) {
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
  if (mag === 0) return vec
  return vec.map(v => v / mag)
}

function cosineSimilarity(a, b) {
  return a.reduce((sum, val, i) => sum + val * b[i], 0)
}

export function buildIndex(pages) {
  const index = new Map()
  const pageData = new Map()

  for (let i = 0; i < pages.length; i++) {
    const { url, title, text } = pages[i]
    pageData.set(i, { url, title, text: text.substring(0, MAX_TEXT_STORE) })

    const tokens = tokenize(text)
    const termFreq = new Map()

    for (const token of tokens) {
      if (STOP_WORDS.has(token)) continue
      termFreq.set(token, (termFreq.get(token) || 0) + 1)
    }

    for (const [term, freq] of termFreq) {
      if (!index.has(term)) {
        index.set(term, [])
      }
      index.get(term).push({ pageId: i, freq })
    }
  }

  recalculateIdf(index, pageData.size)

  console.log(`[indexer] Indexed ${pageData.size} pages, ${index.size} unique terms.`)
  return { index, pageData, embeddings: new Map() }
}

export function addToIndex(indexData, newPages) {
  const { index, pageData } = indexData
  let nextId = pageData.size

  for (const page of newPages) {
    const id = nextId++
    pageData.set(id, { url: page.url, title: page.title, text: page.text.substring(0, MAX_TEXT_STORE) })

    const tokens = tokenize(page.text)
    const termFreq = new Map()

    for (const token of tokens) {
      if (STOP_WORDS.has(token)) continue
      termFreq.set(token, (termFreq.get(token) || 0) + 1)
    }

    for (const [term, freq] of termFreq) {
      if (!index.has(term)) {
        index.set(term, [])
      }
      index.get(term).push({ pageId: id, freq })
    }
  }

  recalculateIdf(index, pageData.size)
}

export function setEmbeddings(indexData, pageIds, embeddings) {
  for (let i = 0; i < pageIds.length; i++) {
    indexData.embeddings.set(pageIds[i], normalizeVector(embeddings[i]))
  }
}

export function getMissingEmbeddingIds(indexData) {
  const missing = []
  for (const [id] of indexData.pageData) {
    if (!indexData.embeddings.has(id)) missing.push(id)
  }
  return missing
}

export function serializeIndex(indexData) {
  return {
    index: Object.fromEntries(indexData.index),
    pageData: Object.fromEntries(indexData.pageData),
    embeddings: Object.fromEntries(
      [...indexData.embeddings].map(([k, v]) => [k, Array.from(v)])
    ),
  }
}

export function deserializeIndex(raw) {
  const pageData = new Map()
  for (const [k, v] of Object.entries(raw.pageData)) {
    pageData.set(Number(k), {
      url: v.url,
      title: v.title,
      text: v.text || '',
    })
  }

  const embeddings = new Map()
  if (raw.embeddings) {
    for (const [k, v] of Object.entries(raw.embeddings)) {
      embeddings.set(Number(k), v)
    }
  }

  return {
    index: new Map(Object.entries(raw.index)),
    pageData,
    embeddings,
  }
}

export function search(indexData, query, queryEmbedding = null) {
  const { index, pageData, embeddings } = indexData
  const tokens = tokenize(query).filter(t => !STOP_WORDS.has(t))

  if (tokens.length === 0 && !queryEmbedding) return []

  const scores = new Map()

  for (const token of tokens) {
    const postings = index.get(token)
    if (!postings) continue

    for (const { pageId, score } of postings) {
      scores.set(pageId, (scores.get(pageId) || 0) + score)
    }
  }

  const urlMatched = new Set()
  const titleMatched = new Set()

  for (const [pageId, data] of pageData) {
    const urlLower = data.url.toLowerCase()
    const titleLower = (data.title || '').toLowerCase()

    for (const token of tokens) {
      if (urlLower.includes(token)) {
        urlMatched.add(pageId)
        scores.set(pageId, (scores.get(pageId) || 0) + 50)
      } else if (titleLower.includes(token)) {
        titleMatched.add(pageId)
        scores.set(pageId, (scores.get(pageId) || 0) + 10)
      }
    }
  }

  if (queryEmbedding && embeddings.size > 0) {
    const normQuery = normalizeVector(queryEmbedding)
    for (const [pageId, pageEmbedding] of embeddings) {
      const sim = cosineSimilarity(normQuery, pageEmbedding)
      scores.set(pageId, (scores.get(pageId) || 0) + sim * 100)
    }
  }

  const urlResults = []
  const otherResults = []

  for (const [pageId, score] of scores) {
    const page = pageData.get(pageId)
    const snippet = (page.text || '').substring(0, 200).replace(/\s+/g, ' ').trim()
    const entry = { url: page.url, title: page.title, description: snippet, score }
    if (urlMatched.has(pageId)) urlResults.push(entry)
    else otherResults.push(entry)
  }

  urlResults.sort((a, b) => b.score - a.score)
  otherResults.sort((a, b) => b.score - a.score)

  return [...urlResults, ...otherResults].slice(0, 10)
}
