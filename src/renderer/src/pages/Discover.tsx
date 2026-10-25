import { useState } from 'react'
import Poster from '../components/Poster'
import { SearchIcon } from '../components/Icons'
import { titles } from '../placeholder'

const kinds = ['All', 'Series', 'Movies'] as const

export default function Discover() {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<(typeof kinds)[number]>('All')

  const shown = titles.filter((t) => {
    if (kind === 'Series' && t.kind !== 'series') return false
    if (kind === 'Movies' && t.kind !== 'movie') return false
    return t.name.toLowerCase().includes(query.toLowerCase())
  })

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Discover</h1>
        <div className="toolbar">
          <label className="search glass">
            <SearchIcon width={16} height={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles" />
          </label>
          <div className="segmented glass">
            {kinds.map((k) => (
              <button key={k} className={k === kind ? 'active' : ''} onClick={() => setKind(k)}>{k}</button>
            ))}
          </div>
        </div>
      </header>
      <div className="grid">
        {shown.map((t) => <Poster key={t.id} title={t} />)}
      </div>
      {shown.length === 0 && <p className="empty">Nothing matches “{query}”.</p>}
    </div>
  )
}
