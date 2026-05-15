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

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 1)
}

export function buildIndex(pages) {
  const index = new Map()
  const pageData = new Map()

  for (let i = 0; i < pages.length; i++) {
    const { url, title, text } = pages[i]
    pageData.set(i, { url, title })

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

  const totalDocs = pages.length

  for (const [term, postings] of index) {
    const idf = Math.log(totalDocs / postings.length)
    for (const posting of postings) {
      posting.score = posting.freq * idf
    }
  }

  console.log(`[indexer] Indexed ${totalDocs} pages, ${index.size} unique terms.`)
  return { index, pageData }
}

export function serializeIndex(indexData) {
  return {
    index: Object.fromEntries(indexData.index),
    pageData: Object.fromEntries(indexData.pageData),
  }
}

export function deserializeIndex(raw) {
  return {
    index: new Map(Object.entries(raw.index)),
    pageData: new Map(Object.entries(raw.pageData).map(([k, v]) => [Number(k), v])),
  }
}

export function search(indexData, query, limit = 10) {
  const { index, pageData } = indexData
  const tokens = tokenize(query).filter(t => !STOP_WORDS.has(t))

  if (tokens.length === 0) return []

  const scores = new Map()

  for (const token of tokens) {
    const postings = index.get(token)
    if (!postings) continue

    for (const { pageId, score } of postings) {
      scores.set(pageId, (scores.get(pageId) || 0) + score)
    }
  }

  const results = [...scores.entries()]
    .map(([pageId, score]) => {
      const page = pageData.get(pageId)
      return { url: page.url, title: page.title, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return results
}
