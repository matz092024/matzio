import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon, CheckIcon, PlusIcon } from '../components/Icons'
import { artFor } from '../components/Poster'
import { useAddons } from '../stremio/addons'
import { fetchMeta } from '../stremio/client'
import type { MetaDetail, Video } from '../stremio/types'
import { useLibrary } from '../library'
import { useAsync } from '../useAsync'

function formatDate(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function Episodes({ meta }: { meta: MetaDetail }) {
  const bySeason = useMemo(() => {
    const map = new Map<number, Video[]>()
    for (const v of meta.videos ?? []) {
      const s = v.season ?? 0
      map.set(s, [...(map.get(s) ?? []), v])
    }
    for (const list of map.values()) list.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))
    return map
  }, [meta])

  // Specials (season 0) go last.
  const seasons = [...bySeason.keys()].sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b))
  const [season, setSeason] = useState(seasons[0])
  const episodes = bySeason.get(season) ?? []

  if (seasons.length === 0) return null

  return (
    <section className="episodes">
      <div className="season-picker">
        {seasons.map((s) => (
          <button key={s} className={`chip ${s === season ? 'active' : ''}`} onClick={() => setSeason(s)}>
            {s === 0 ? 'Specials' : `Season ${s}`}
          </button>
        ))}
      </div>
      <ol className="episode-list">
        {episodes.map((ep) => {
          const upcoming = ep.released ? new Date(ep.released).getTime() > Date.now() : false
          return (
            <li key={ep.id} className={`episode glass ${upcoming ? 'upcoming' : ''}`}>
              <div className="episode-thumb" style={{ backgroundImage: artFor(ep.id) }}>
                {ep.thumbnail && <img src={ep.thumbnail} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} />}
              </div>
              <div className="episode-body">
                <div className="episode-head">
                  <span className="episode-num">{ep.episode ?? ''}</span>
                  <span className="episode-title">{ep.title ?? ep.name ?? `Episode ${ep.episode}`}</span>
                  <span className="episode-date">{upcoming ? `Airs ${formatDate(ep.released)}` : formatDate(ep.released)}</span>
                </div>
                {(ep.overview ?? ep.description) && <p className="episode-overview">{ep.overview ?? ep.description}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export default function Detail() {
  const { type = '', id = '' } = useParams()
  const navigate = useNavigate()
  const { addons } = useAddons()
  const library = useLibrary()
  const state = useAsync(`meta|${type}|${id}|${addons.map((a) => a.transportUrl).join(',')}`, () => fetchMeta(addons, type, id))

  if (state.status === 'loading') {
    return <div className="page"><section className="detail-hero skeleton glass" /></div>
  }
  if (state.status === 'error') {
    return (
      <div className="page">
        <button className="btn btn-glass back" onClick={() => navigate(-1)}><ArrowLeftIcon width={16} height={16} />Back</button>
        <p className="empty">Couldn’t load this title. {state.error.message}</p>
      </div>
    )
  }

  const meta = state.value
  const saved = library.has(meta.id)
  const info = [meta.releaseInfo, meta.runtime, meta.imdbRating && `IMDb ${meta.imdbRating}`].filter(Boolean)

  return (
    <div className="page detail">
      <div
        className="detail-backdrop"
        aria-hidden
        style={{ backgroundImage: meta.background ? `url("${meta.background}")` : artFor(meta.id) }}
      />
      <button className="btn btn-glass back" onClick={() => navigate(-1)}>
        <ArrowLeftIcon width={16} height={16} />
        Back
      </button>

      <section className="detail-hero">
        <div className="detail-poster" style={{ backgroundImage: artFor(meta.id) }}>
          {meta.poster && <img src={meta.poster} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />}
        </div>
        <div className="detail-body">
          {meta.logo ? <img className="hero-logo" src={meta.logo} alt={meta.name} /> : <h1 className="hero-title">{meta.name}</h1>}
          {info.length > 0 && <p className="hero-meta">{info.join(' · ')}</p>}
          {meta.genres && meta.genres.length > 0 && (
            <div className="chips">{meta.genres.map((g) => <span key={g} className="chip static">{g}</span>)}</div>
          )}
          {meta.description && <p className="detail-description">{meta.description}</p>}
          {meta.director && meta.director.length > 0 && <p className="credit"><span>Director</span>{meta.director.join(', ')}</p>}
          {meta.cast && meta.cast.length > 0 && <p className="credit"><span>Cast</span>{meta.cast.slice(0, 6).join(', ')}</p>}
          <div className="hero-actions">
            <button className="btn btn-glass" onClick={() => library.toggle(meta)}>
              {saved ? <CheckIcon width={16} height={16} /> : <PlusIcon width={16} height={16} />}
              {saved ? 'In library' : 'Add to library'}
            </button>
          </div>
        </div>
      </section>

      {meta.type === 'series' && <Episodes key={meta.id} meta={meta} />}
    </div>
  )
}
