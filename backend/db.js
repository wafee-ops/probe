import sqlite3 from 'sqlite3'
import { open } from 'sqlite'

const DB_PATH = './data/search.db'

let db = null

export async function initDb() {
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  })

  await db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      title TEXT,
      text TEXT
    );

    CREATE TABLE IF NOT EXISTS postings (
      term TEXT NOT NULL,
      page_id INTEGER NOT NULL,
      freq INTEGER NOT NULL,
      PRIMARY KEY (term, page_id)
    );

    CREATE INDEX IF NOT EXISTS idx_postings_term ON postings(term);
    CREATE INDEX IF NOT EXISTS idx_postings_page ON postings(page_id);

    CREATE TABLE IF NOT EXISTS embeddings (
      page_id INTEGER PRIMARY KEY,
      vector TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)

  return db
}

export function getDb() {
  return db
}

export async function insertPages(pages) {
  const stmt = await db.prepare('INSERT OR IGNORE INTO pages (url, title, text) VALUES (?, ?, ?)')
  const ids = []
  for (const { url, title, text } of pages) {
    await stmt.run(url, title || '', text || '')
    const row = await db.get('SELECT id FROM pages WHERE url = ?', url)
    ids.push(row.id)
  }
  await stmt.finalize()
  return ids
}

export async function insertPostings(pageId, termFreqs) {
  const stmt = await db.prepare('INSERT OR REPLACE INTO postings (term, page_id, freq) VALUES (?, ?, ?)')
  for (const [term, freq] of termFreqs) {
    await stmt.run(term, pageId, freq)
  }
  await stmt.finalize()
}

export async function insertEmbeddings(pageIds, embeddings) {
  const stmt = await db.prepare('INSERT OR REPLACE INTO embeddings (page_id, vector) VALUES (?, ?)')
  for (let i = 0; i < pageIds.length; i++) {
    await stmt.run(pageIds[i], JSON.stringify(embeddings[i]))
  }
  await stmt.finalize()
}

export async function getPageCount() {
  const row = await db.get('SELECT COUNT(*) as count FROM pages')
  return row.count
}

export async function getPageData(pageId) {
  return db.get('SELECT id, url, title, text FROM pages WHERE id = ?', pageId)
}

export async function getPageDataBatch(pageIds) {
  if (pageIds.length === 0) return []
  const placeholders = pageIds.map(() => '?').join(',')
  return db.all(`SELECT id, url, title, text FROM pages WHERE id IN (${placeholders})`, pageIds)
}

export async function getDocFreq(term) {
  const row = await db.get('SELECT COUNT(DISTINCT page_id) as df FROM postings WHERE term = ?', term)
  return row.df
}

export async function batchSearchTerms(terms) {
  if (terms.length === 0) return []
  const placeholders = terms.map(() => '?').join(',')
  return db.all(
    `SELECT term, page_id, freq FROM postings WHERE term IN (${placeholders})`,
    terms
  )
}

export async function getDocLengths(pageIds) {
  if (pageIds.length === 0) return new Map()
  const placeholders = pageIds.map(() => '?').join(',')
  const rows = await db.all(
    `SELECT page_id, SUM(freq) as len FROM postings WHERE page_id IN (${placeholders}) GROUP BY page_id`,
    pageIds
  )
  const map = new Map()
  for (const row of rows) map.set(row.page_id, row.len)
  return map
}

export async function getAvgDocLength() {
  const row = await db.get(
    'SELECT SUM(freq) * 1.0 / COUNT(DISTINCT page_id) as avg FROM postings'
  )
  return row.avg || 0
}

export async function searchTerm(term) {
  return db.all('SELECT page_id, freq FROM postings WHERE term = ?', term)
}

export async function getMissingEmbeddingIds() {
  const rows = await db.all(`
    SELECT p.id FROM pages p
    LEFT JOIN embeddings e ON p.id = e.page_id
    WHERE e.page_id IS NULL
  `)
  return rows.map(r => r.id)
}

export async function getEmbedding(pageId) {
  const row = await db.get('SELECT vector FROM embeddings WHERE page_id = ?', pageId)
  return row ? JSON.parse(row.vector) : null
}

export async function getAllEmbeddings() {
  const rows = await db.all('SELECT page_id, vector FROM embeddings')
  const map = new Map()
  for (const { page_id, vector } of rows) {
    map.set(page_id, JSON.parse(vector))
  }
  return map
}

export async function getAllUrls() {
  const rows = await db.all('SELECT url FROM pages')
  return new Set(rows.map(r => r.url))
}

export async function getMaxPageId() {
  const row = await db.get('SELECT MAX(id) as maxId FROM pages')
  return row.maxId || 0
}

export async function closeDb() {
  if (db) await db.close()
}

export function getDbPath() {
  return DB_PATH
}
