import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

const DB_PATH = './data/search.db'

let db = null

export async function initDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true })

  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  db.exec(`
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
  const insert = db.prepare('INSERT OR IGNORE INTO pages (url, title, text) VALUES (?, ?, ?)')
  const lookup = db.prepare('SELECT id FROM pages WHERE url = ?')
  const ids = []

  const txn = db.transaction(() => {
    for (const { url, title, text } of pages) {
      insert.run(url, title || '', text || '')
      const row = lookup.get(url)
      ids.push(row.id)
    }
  })
  txn()

  return ids
}

export async function insertPostings(pageId, termFreqs) {
  const stmt = db.prepare('INSERT OR REPLACE INTO postings (term, page_id, freq) VALUES (?, ?, ?)')

  const txn = db.transaction(() => {
    for (const [term, freq] of termFreqs) {
      stmt.run(term, pageId, freq)
    }
  })
  txn()
}

export async function insertEmbeddings(pageIds, embeddings) {
  const stmt = db.prepare('INSERT OR REPLACE INTO embeddings (page_id, vector) VALUES (?, ?)')

  const txn = db.transaction(() => {
    for (let i = 0; i < pageIds.length; i++) {
      stmt.run(pageIds[i], JSON.stringify(embeddings[i]))
    }
  })
  txn()
}

export async function getPageCount() {
  const row = db.prepare('SELECT COUNT(*) as count FROM pages').get()
  return row.count
}

export async function getPageData(pageId) {
  return db.prepare('SELECT id, url, title, text FROM pages WHERE id = ?').get(pageId)
}

export async function getPageDataBatch(pageIds) {
  if (pageIds.length === 0) return []
  const placeholders = pageIds.map(() => '?').join(',')
  return db.prepare(`SELECT id, url, title, text FROM pages WHERE id IN (${placeholders})`).all(...pageIds)
}

export async function getDocFreq(term) {
  const row = db.prepare('SELECT COUNT(DISTINCT page_id) as df FROM postings WHERE term = ?').get(term)
  return row.df
}

export async function batchSearchTerms(terms) {
  if (terms.length === 0) return []
  const placeholders = terms.map(() => '?').join(',')
  return db.prepare(`SELECT term, page_id, freq FROM postings WHERE term IN (${placeholders})`).all(...terms)
}

export async function getDocLengths(pageIds) {
  if (pageIds.length === 0) return new Map()
  const placeholders = pageIds.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT page_id, SUM(freq) as len FROM postings WHERE page_id IN (${placeholders}) GROUP BY page_id`
  ).all(...pageIds)
  const map = new Map()
  for (const row of rows) map.set(row.page_id, row.len)
  return map
}

export async function getAvgDocLength() {
  const row = db.prepare(
    'SELECT SUM(freq) * 1.0 / COUNT(DISTINCT page_id) as avg FROM postings'
  ).get()
  return row.avg || 0
}

export async function searchTerm(term) {
  return db.prepare('SELECT page_id, freq FROM postings WHERE term = ?').all(term)
}

export async function getMissingEmbeddingIds() {
  const rows = db.prepare(`
    SELECT p.id FROM pages p
    LEFT JOIN embeddings e ON p.id = e.page_id
    WHERE e.page_id IS NULL
  `).all()
  return rows.map(r => r.id)
}

export async function getEmbedding(pageId) {
  const row = db.prepare('SELECT vector FROM embeddings WHERE page_id = ?').get(pageId)
  return row ? JSON.parse(row.vector) : null
}

export async function getAllEmbeddings() {
  const rows = db.prepare('SELECT page_id, vector FROM embeddings').all()
  const map = new Map()
  for (const { page_id, vector } of rows) {
    map.set(page_id, JSON.parse(vector))
  }
  return map
}

export async function getAllUrls() {
  const rows = db.prepare('SELECT url FROM pages').all()
  return new Set(rows.map(r => r.url))
}

export async function getMaxPageId() {
  const row = db.prepare('SELECT MAX(id) as maxId FROM pages').get()
  return row.maxId || 0
}

export async function closeDb() {
  if (db) db.close()
}

export function getDbPath() {
  return DB_PATH
}
