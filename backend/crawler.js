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
      const source = (preferPriority && priorityQueue.size > 0) ? priorityQueue : queue
      const fallback = (queue.size > 0) ? queue : (priorityQueue.size > 0) ? priorityQueue : lowQueue
      const chosen = source.size > 0 ? source : fallback

      while (chosen.size > 0) {
        const url = chosen.values().next().value
        chosen.delete(url)

        if (visited.has(url)) continue
        visited.add(url)

        try {
          const html = await fetchPage(url)
          const title = extractTitle(html)
          const text = extractText(html)
          const links = getLinks(html, url)

          for (const link of links) {
            const normalized = normalizeUrl(link)
            if (normalized && !visited.has(normalized)) {
              if (isDeprioritized(normalized)) lowQueue.add(normalized)
              else queue.add(normalized)
            }
          }

          return { url, title, text }
        } catch (err) {
          console.log(`[crawler] Skipping ${url}: ${err.message}`)
        }
      }
      return null
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
    console.log(`[crawler] Fetching (${pages.length + 1}/${maxPages}): ${crawler.queue.values().next().value}`)
    const page = await crawler.fetchNext()
    if (!page) break
    pages.push(page)
  }

  console.log(`[crawler] Done. Collected ${pages.length} pages.`)
  return pages
}
