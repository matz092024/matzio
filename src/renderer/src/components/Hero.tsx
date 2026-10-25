import { useNavigate } from 'react-router-dom'
import type { MetaPreview } from '../stremio/types'
import { useLibrary } from '../library'
import { usePlayback } from '../playback'
import { CheckIcon, InfoIcon, PlayIcon, PlusIcon } from './Icons'
import { artFor, detailPath } from './Poster'

export default function Hero({ meta, eyebrow }: { meta: MetaPreview; eyebrow: string }) {
  const navigate = useNavigate()
  const library = useLibrary()
  const { play } = usePlayback()
  const saved = library.has(meta.id)
  const info = [meta.releaseInfo, meta.genres?.slice(0, 3).join(', '), meta.imdbRating && `IMDb ${meta.imdbRating}`]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="hero glass">
      <div
        className="hero-art"
        style={{ backgroundImage: meta.background ? `url("${meta.background}"), ${artFor(meta.id)}` : artFor(meta.id) }}
      />
      <div className="hero-body">
        <span className="eyebrow">{eyebrow}</span>
        {meta.logo ? (
          <img className="hero-logo" src={meta.logo} alt={meta.name} />
        ) : (
          <h1 className="hero-title">{meta.name}</h1>
        )}
        {info && <p className="hero-meta">{info}</p>}
        {meta.description && <p className="hero-synopsis">{meta.description}</p>}
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={() => play(meta)}>
            <PlayIcon width={16} height={16} />
            Play
          </button>
          <button className="btn btn-glass" onClick={() => navigate(detailPath(meta))}>
            <InfoIcon width={16} height={16} />
            Details
          </button>
          <button
            className="btn btn-icon"
            aria-label={saved ? 'Remove from library' : 'Add to library'}
            title={saved ? 'In your library' : 'Add to library'}
            onClick={() => library.toggle(meta)}
          >
            {saved ? <CheckIcon width={18} height={18} /> : <PlusIcon width={18} height={18} />}
          </button>
        </div>
      </div>
    </section>
  )
}
