import { parse } from 'node-html-parser'

const DEPRIORITIZED_HOSTNAMES = [
  'en.wikipedia.org',
  'wikipedia.org',
  'simple.wikipedia.org',
  'wikimedia.org',
  'wikidata.org',
  'mediawiki.org',
  'meta.wikimedia.org',
]

function isDeprioritized(url) {
  try {
    const hostname = new URL(url).hostname
    return DEPRIORITIZED_HOSTNAMES.some(b => hostname === b || hostname.endsWith('.' + b))
  } catch {
    return false
  }
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    if (parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1)
    }
    return parsed.toString()
  } catch {
    return null
  }
}

function getLinks(html, baseUrl) {
  const root = parse(html)
  const links = []
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href')
    if (!href) continue
    try {
      const absolute = new URL(href, baseUrl).toString()
      links.push(absolute)
    } catch {
      continue
    }
  }
  return links
}

function extractText(html) {
  const root = parse(html)

  for (const el of root.querySelectorAll('script, style, noscript')) {
    el.remove()
  }

  return root.textContent.replace(/\s+/g, ' ').trim()
}

function extractTitle(html) {
  const root = parse(html)
  const titleEl = root.querySelector('title')
  return titleEl ? titleEl.textContent.trim() : ''
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ProbeSearchBot/1.0' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('text/html')) throw new Error('Not HTML')
  return res.text()
}

export function createCrawler(seedUrls) {
  const visited = new Set()
  const queue = new Set()
  const priorityQueue = new Set()
  const lowQueue = new Set()

  for (const url of seedUrls) {
    const normalized = normalizeUrl(url)
    if (normalized) {
      if (isDeprioritized(normalized)) lowQueue.add(normalized)
      else queue.add(normalized)
    }
  }

  function pickUrl(preferPriority = false) {
    const sources = []
    if (preferPriority && priorityQueue.size > 0) sources.push(priorityQueue)
    if (queue.size > 0) sources.push(queue)
    if (priorityQueue.size > 0) sources.push(priorityQueue)
    if (lowQueue.size > 0) sources.push(lowQueue)

    for (const source of sources) {
      while (source.size > 0) {
        const url = source.values().next().value
        source.delete(url)
        if (!visited.has(url)) {
          visited.add(url)
          return url
        }
      }
    }
    return null
  }

  function addFoundLinks(links, pageUrl) {
    for (const link of links) {
      const normalized = normalizeUrl(link)
      if (normalized && !visited.has(normalized)) {
        if (isDeprioritized(normalized)) lowQueue.add(normalized)
        else queue.add(normalized)
      }
    }
  }

  return {
    visited,
    queue,
    priorityQueue,
    lowQueue,

    addUrls(urls, priority = false) {
      for (const url of urls) {
        const normalized = normalizeUrl(url)
        if (!normalized || visited.has(normalized)) continue
        if (priority) {
          priorityQueue.add(normalized)
        } else if (isDeprioritized(normalized)) {
          lowQueue.add(normalized)
        } else {
          queue.add(normalized)
        }
      }
    },

    async fetchNext(preferPriority = false) {
      const url = pickUrl(preferPriority)
      if (!url) return null

      try {
        const html = await fetchPage(url)
        const title = extractTitle(html)
        const text = extractText(html)
        const links = getLinks(html, url)
        addFoundLinks(links, url)
        return { url, title, text }
      } catch (err) {
        console.log(`[crawler] Skipping ${url}: ${err.message}`)
        return null
      }
    },

    async fetchBatch(count = 5, preferPriority = false) {
      const urls = []
      for (let i = 0; i < count; i++) {
        const url = pickUrl(preferPriority)
        if (url) urls.push(url)
      }

      if (urls.length === 0) return []

      const settled = await Promise.allSettled(
        urls.map(async url => {
          const html = await fetchPage(url)
          return { url, html }
        })
      )

      const pages = []
      for (let i = 0; i < settled.length; i++) {
        const result = settled[i]
        if (result.status !== 'fulfilled') {
          console.log(`[crawler] Skipping ${urls[i]}: ${result.reason?.message || 'error'}`)
          continue
        }
        const { url, html } = result.value
        const title = extractTitle(html)
        const text = extractText(html)
        const links = getLinks(html, url)
        addFoundLinks(links, url)
        pages.push({ url, title, text })
      }

      return pages
    },

    get queueSize() {
      return queue.size + lowQueue.size
    },

    get visitedSize() {
      return visited.size
    },

    get prioritySize() {
      return priorityQueue.size
    },
  }
}

export async function crawl(seedUrls, maxPages = 100) {
  const crawler = createCrawler(seedUrls)
  const pages = []

  while (pages.length < maxPages) {
    const batchSize = Math.min(5, maxPages - pages.length)
    const batch = await crawler.fetchBatch(batchSize)
    if (batch.length === 0) break
    pages.push(...batch)
    console.log(`[crawler] Fetched ${pages.length}/${maxPages} pages...`)
  }

  console.log(`[crawler] Done. Collected ${pages.length} pages.`)
  return pages
}
