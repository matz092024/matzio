import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Poster, { PosterSkeleton } from '../components/Poster'
import { SearchIcon } from '../components/Icons'
import { useAddons } from '../stremio/addons'
import { catalogExtras, fetchCatalog } from '../stremio/client'
import type { InstalledAddon, ManifestCatalog, MetaPreview } from '../stremio/types'

const typeLabels: Record<string, string> = { movie: 'Movies', series: 'Series', channel: 'Channels', tv: 'TV' }

interface Source {
  addon: InstalledAddon
  catalog: ManifestCatalog
  key: string
}

function dedupe(metas: MetaPreview[]) {
  const seen = new Set<string>()
  return metas.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
}

export default function Discover() {
  const { addons } = useAddons()
  const location = useLocation()
  const searchRef = useRef<HTMLInputElement>(null)

  // Opened with the search shortcut: put the cursor in the search box.
  useEffect(() => {
    if ((location.state as { focusSearch?: boolean } | null)?.focusSearch) searchRef.current?.focus()
  }, [location])

  const sources: Source[] = useMemo(
    () =>
      addons.flatMap((addon) =>
        addon.manifest.catalogs.map((catalog) => ({ addon, catalog, key: `${addon.transportUrl}|${catalog.type}|${catalog.id}` }))
      ),
    [addons]
  )
  const types = [...new Set(sources.map((s) => s.catalog.type))]

  const [type, setType] = useState<string>('')
  const [sourceKey, setSourceKey] = useState('')
  const [genre, setGenre] = useState('')
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')

  const activeType = types.includes(type) ? type : types[0] ?? ''

  // Browsable catalogs need nothing but an optional genre; search-only catalogs are used for search.
  const browsable = sources.filter(
    (s) => s.catalog.type === activeType && [...catalogExtras(s.catalog).required].every((r) => r === 'genre')
  )
  const searchable = sources.filter((s) => s.catalog.type === activeType && catalogExtras(s.catalog).names.has('search'))
  const source = browsable.find((s) => s.key === sourceKey) ?? browsable[0]
  const { genres, required } = source ? catalogExtras(source.catalog) : { genres: [] as string[], required: new Set<string>() }
  const activeGenre = genres.includes(genre) ? genre : required.has('genre') ? genres[0] ?? '' : ''

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 350)
    return () => clearTimeout(t)
  }, [input])

  const [items, setItems] = useState<MetaPreview[]>([])
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading')
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const requestKey = query
    ? `search|${activeType}|${query}|${searchable.map((s) => s.key).join(',')}`
    : `browse|${source?.key}|${activeGenre}`

  useEffect(() => {
    let active = true
    setStatus('loading')
    setItems([])
    setHasMore(false)

    const run = async () => {
      if (query) {
        const results = await Promise.allSettled(searchable.map((s) => fetchCatalog(s.addon, s.catalog, { search: query })))
        return { metas: dedupe(results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))), more: false }
      }
      if (!source) return { metas: [], more: false }
      const metas = await fetchCatalog(source.addon, source.catalog, { genre: activeGenre || undefined })
      return { metas, more: catalogExtras(source.catalog).names.has('skip') && metas.length > 0 }
    }

    run()
      .then(({ metas, more }) => {
        if (!active) return
        setItems(metas)
        setHasMore(more)
        setStatus('done')
      })
      .catch(() => active && setStatus('error'))
    return () => {
      active = false
    }
    // requestKey captures every input to the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  const loadMore = async () => {
    if (!source) return
    setLoadingMore(true)
    try {
      const more = await fetchCatalog(source.addon, source.catalog, { genre: activeGenre || undefined, skip: items.length })
      const merged = dedupe([...items, ...more])
      setHasMore(merged.length > items.length)
      setItems(merged)
    } catch {
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Discover</h1>
        <label className="search glass">
          <SearchIcon width={16} height={16} />
          <input ref={searchRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Search ${(typeLabels[activeType] ?? activeType).toLowerCase()}`} />
        </label>
      </header>

      <div className="toolbar">
        <div className="segmented glass">
          {types.map((t) => (
            <button key={t} className={t === activeType ? 'active' : ''} onClick={() => setType(t)}>
              {typeLabels[t] ?? t}
            </button>
          ))}
        </div>
        {!query && browsable.length > 1 && (
          <select className="select glass" value={source?.key} onChange={(e) => setSourceKey(e.target.value)}>
            {browsable.map((s) => (
              <option key={s.key} value={s.key}>
                {s.catalog.name ?? s.catalog.id}
                {addons.length > 1 ? ` (${s.addon.manifest.name})` : ''}
              </option>
            ))}
          </select>
        )}
        {!query && genres.length > 0 && (
          <select className="select glass" value={activeGenre} onChange={(e) => setGenre(e.target.value)}>
            {!required.has('genre') && <option value="">All genres</option>}
            {genres.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        )}
      </div>

      <div className="grid">
        {status === 'loading'
          ? Array.from({ length: 18 }, (_, i) => <PosterSkeleton key={i} />)
          : items.map((m) => <Poster key={`${m.type}:${m.id}`} meta={m} />)}
      </div>

      {status === 'done' && items.length === 0 && (
        <p className="empty">{query ? `Nothing matches “${query}”.` : 'This catalog is empty.'}</p>
      )}
      {status === 'error' && <p className="empty">Couldn’t load this catalog. Check your connection or the addon.</p>}
      {status === 'done' && hasMore && (
        <button className="btn btn-glass load-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
