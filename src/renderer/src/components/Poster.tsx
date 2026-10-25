import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { MetaPreview } from '../stremio/types'

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Monochrome stand-in art for titles with no image (or one that fails to load). */
export function artFor(seed: string) {
  const tone = hash(seed) % 100
  const a = 18 + (tone % 20)
  const b = 6 + (tone % 9)
  const angle = (tone * 7) % 360
  return `linear-gradient(${angle}deg, hsl(0 0% ${a}%), hsl(0 0% ${b}%))`
}

export function detailPath(meta: Pick<MetaPreview, 'type' | 'id'>) {
  return `/detail/${encodeURIComponent(meta.type)}/${encodeURIComponent(meta.id)}`
}

type PosterMeta = Pick<MetaPreview, 'id' | 'type' | 'name' | 'poster' | 'posterShape' | 'releaseInfo' | 'genres'>

export default function Poster({ meta }: { meta: PosterMeta }) {
  const [failed, setFailed] = useState(false)
  const showImage = meta.poster && !failed
  const sub = [meta.releaseInfo, meta.genres?.[0]].filter(Boolean).join(' · ')

  return (
    <Link to={detailPath(meta)} className={`poster shape-${meta.posterShape ?? 'poster'}`}>
      <div className="poster-art" style={{ backgroundImage: artFor(meta.id) }}>
        {showImage ? (
          <img src={meta.poster} alt="" loading="lazy" onError={() => setFailed(true)} />
        ) : (
          <span className="poster-art-name">{meta.name}</span>
        )}
      </div>
      <div className="poster-meta">
        <span className="poster-name">{meta.name}</span>
        {sub && <span className="poster-sub">{sub}</span>}
      </div>
    </Link>
  )
}

export function PosterSkeleton() {
  return (
    <div className="poster">
      <div className="poster-art skeleton" />
      <div className="poster-meta">
        <span className="skeleton-line" />
      </div>
    </div>
  )
}
