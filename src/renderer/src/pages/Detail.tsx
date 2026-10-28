import { useMemo, useState } from 'react'
import { useArtwork } from '../artwork'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon, CheckIcon, ListIcon, PlayIcon, PlusIcon } from '../components/Icons'
import { artFor } from '../components/Poster'
import { useAddons } from '../stremio/addons'
import { fetchMeta } from '../stremio/client'
import type { MetaDetail, Video } from '../stremio/types'
import { useLibrary } from '../library'
import { useAsync } from '../useAsync'
import { episodeLabel, nextUp, usePlayback } from '../playback'
import { fraction, isWatched, useProgress } from '../progress'

function formatDate(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function Episodes({ meta, initialSeason }: { meta: MetaDetail; initialSeason?: number }) {
  const { play } = usePlayback()
  const progress = useProgress()
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
  const [season, setSeason] = useState(initialSeason !== undefined && seasons.includes(initialSeason) ? initialSeason : seasons[0])
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
          const entry = progress.get(ep.id)
          const watched = isWatched(entry)
          return (
            <li key={ep.id} className={`episode glass ${upcoming ? 'upcoming' : ''} ${watched ? 'watched' : ''}`}>
              <button
                className="episode-thumb"
                style={{ backgroundImage: artFor(ep.id) }}
                disabled={upcoming}
                aria-label={`Play episode ${ep.episode}`}
                onClick={() => play(meta, ep)}
              >
                {ep.thumbnail && <img src={ep.thumbnail} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} />}
                {!upcoming && <span className="continue-play"><PlayIcon width={14} height={14} /></span>}
                {watched && <span className="watched-badge"><CheckIcon width={12} height={12} /></span>}
                {entry && !watched && fraction(entry) > 0 && (
                  <span className="thumb-progress"><span style={{ width: `${fraction(entry) * 100}%` }} /></span>
                )}
              </button>
              <div className="episode-body">
                <div className="episode-head">
                  <span className="episode-num">{ep.episode ?? ''}</span>
                  <span className="episode-title">{ep.title ?? ep.name ?? `Episode ${ep.episode}`}</span>
                  <span className="episode-date">{upcoming ? `Airs ${formatDate(ep.released)}` : formatDate(ep.released)}</span>
                  {!upcoming && (
                    <button className="icon-btn" title="Choose stream" aria-label={`Choose a stream for episode ${ep.episode}`} onClick={() => play(meta, ep, { choose: true })}>
                      <ListIcon width={16} height={16} />
                    </button>
                  )}
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
  const progress = useProgress()
  const { play } = usePlayback()
  const state = useAsync(`meta|${type}|${id}|${addons.map((a) => a.transportUrl).join(',')}`, () => fetchMeta(addons, type, id), true)
  // Loaded alongside the details, so fanart.tv / TMDB art is usually ready when they are.
  const { art, ready } = useArtwork(type, id)
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const first = (...urls: (string | undefined)[]) => urls.find((u): u is string => !!u && !failed[u])
  const fail = (url: string) => setFailed((f) => ({ ...f, [url]: true }))

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

  const isSeries = meta.type === 'series'
  const next = isSeries ? nextUp(meta, progress.latestFor(meta.id)) : null
  const movieEntry = isSeries ? undefined : progress.get(meta.id)
  const resumeMovie = movieEntry && !isWatched(movieEntry) && movieEntry.position > 30
  const playLabel = isSeries
    ? next
      ? `${next.resume ? 'Resume' : 'Play'} ${episodeLabel(next.video)}`
      : 'Play'
    : resumeMovie
      ? 'Resume'
      : 'Play'
  const canPlay = !isSeries || next !== null
  const background = first(art?.background, meta.background, art?.banner)
  // Until the sharper logo has had a moment to arrive, the logo's space is held empty.
  const logo = ready ? first(art?.logo, meta.logo) : undefined

  return (
    <div className="page detail">
      <div
        className="detail-backdrop"
        aria-hidden
        style={{ backgroundImage: background ? `url("${background}"), ${artFor(meta.id)}` : artFor(meta.id) }}
      />
      {/* A hidden copy notices when the backdrop fails, so the next one in line is used. */}
      {background && <img hidden src={background} alt="" onError={() => fail(background)} />}
      <button className="btn btn-glass back" onClick={() => navigate(-1)}>
        <ArrowLeftIcon width={16} height={16} />
        Back
      </button>

      <section className="detail-hero">
        <div className="detail-poster" style={{ backgroundImage: artFor(meta.id) }}>
          {meta.poster && <img src={meta.poster} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />}
        </div>
        <div className="detail-body">
          {!ready ? (
            <div className="hero-logo-placeholder" aria-hidden />
          ) : logo ? (
            <img key={logo} className="hero-logo" src={logo} alt={meta.name} onError={() => fail(logo)} />
          ) : (
            <h1 className="hero-title">{meta.name}</h1>
          )}
          {info.length > 0 && <p className="hero-meta">{info.join(' · ')}</p>}
          {meta.genres && meta.genres.length > 0 && (
            <div className="chips">{meta.genres.map((g) => <span key={g} className="chip static">{g}</span>)}</div>
          )}
          {meta.description && <p className="detail-description">{meta.description}</p>}
          {meta.director && meta.director.length > 0 && <p className="credit"><span>Director</span>{meta.director.join(', ')}</p>}
          {meta.cast && meta.cast.length > 0 && <p className="credit"><span>Cast</span>{meta.cast.slice(0, 6).join(', ')}</p>}
          {movieEntry && fraction(movieEntry) > 0 && !isWatched(movieEntry) && (
            <div className="progress detail-progress"><div style={{ width: `${fraction(movieEntry) * 100}%` }} /></div>
          )}
          <div className="hero-actions">
            <button className="btn btn-primary" data-shortcut="play" disabled={!canPlay} onClick={() => play(meta, next?.video)}>
              <PlayIcon width={16} height={16} />
              {playLabel}
            </button>
            <button className="btn btn-glass" disabled={!canPlay} onClick={() => play(meta, next?.video, { choose: true })}>
              <ListIcon width={16} height={16} />
              Choose stream
            </button>
            <button className="btn btn-glass" onClick={() => library.toggle(meta)}>
              {saved ? <CheckIcon width={16} height={16} /> : <PlusIcon width={16} height={16} />}
              {saved ? 'On watchlist' : 'Add to watchlist'}
            </button>
          </div>
        </div>
      </section>

      {isSeries && <Episodes key={meta.id} meta={meta} initialSeason={next?.video.season} />}
    </div>
  )
}
