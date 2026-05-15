import { parse } from 'node-html-parser'

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

export async function crawl(seedUrls, maxPages = 100) {
  const visited = new Set()
  const queue = []
  const pages = []

  for (const url of seedUrls) {
    const normalized = normalizeUrl(url)
    if (normalized) queue.push(normalized)
  }

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift()

    if (visited.has(url)) continue
    visited.add(url)

    console.log(`[crawler] Fetching (${pages.length + 1}/${maxPages}): ${url}`)

    try {
      const html = await fetchPage(url)
      const title = extractTitle(html)
      const text = extractText(html)
      const links = getLinks(html, url)

      pages.push({ url, title, text })

      for (const link of links) {
        const normalized = normalizeUrl(link)
        if (normalized && !visited.has(normalized) && !queue.includes(normalized)) {
          queue.push(normalized)
        }
      }
    } catch (err) {
      console.log(`[crawler] Skipping ${url}: ${err.message}`)
    }
  }

  console.log(`[crawler] Done. Collected ${pages.length} pages.`)
  return pages
}
