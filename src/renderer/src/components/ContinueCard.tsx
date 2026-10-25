import type { Title } from '../placeholder'
import { artFor } from './Poster'
import { PlayIcon } from './Icons'

export default function ContinueCard({ title }: { title: Title }) {
  return (
    <button className="continue-card">
      <div className="continue-art" style={{ backgroundImage: artFor(title.tone + 13) }}>
        <span className="continue-play"><PlayIcon width={16} height={16} /></span>
      </div>
      <div className="continue-meta">
        <span className="poster-name">{title.name}</span>
        <span className="poster-sub">{title.episode}</span>
      </div>
      <div className="progress"><div style={{ width: `${(title.progress ?? 0) * 100}%` }} /></div>
    </button>
  )
}
