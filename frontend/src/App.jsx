import { useState } from 'react'
import './App.css'

function App() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSearch() {
    const trimmed = query.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)
    setResults(null)

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong.')
        return
      }

      setResults(data.results)
    } catch {
      setError('Failed to reach the server.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  return (
    <div className="app">
      <h1 className="title">Probe</h1>
      <div className="search-container">
        <div className="search-wrapper">
          <input
            type="text"
            className="search-input"
            placeholder="Search anything..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button className="search-btn" onClick={handleSearch}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        </div>
      </div>

      {loading && <p className="status">Searching...</p>}
      {error && <p className="status error">{error}</p>}

      {results && results.length === 0 && (
        <p className="status">No results found for "{query}".</p>
      )}

      {results && results.length > 0 && (
        <ul className="results">
          {results.map((r, i) => (
            <li key={i} className="result-item">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="result-title">
                {r.title || r.url}
              </a>
              <span className="result-url">{r.url}</span>
              <span className="result-score">relevance: {r.score.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default App
