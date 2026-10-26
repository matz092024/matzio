import Row from './Row'
import { artFor } from './Poster'
import { PlayIcon } from './Icons'
import { fraction, isWatched, useProgress, type WatchEntry } from '../progress'
import { usePlayback } from '../playback'

function timeLeft(e: WatchEntry) {
  const mins = Math.max(1, Math.round((e.duration - e.position) / 60))
  // Resume points from Trakt are a percentage of a runtime Trakt only roughly knows.
  const about = e.estimated ? 'about ' : ''
  return mins >= 60 ? `${about}${Math.floor(mins / 60)} h ${mins % 60} min left` : `${about}${mins} min left`
}

/** Titles you're partway through, most recent first. */
export default function ContinueRow() {
  const { entries, forget } = useProgress()
  const { play } = usePlayback()

  const latest = new Map<string, WatchEntry>()
  for (const e of Object.values(entries)) {
    if (e.duration <= 0) continue
    const prev = latest.get(e.metaId)
    if (!prev || e.updatedAt > prev.updatedAt) latest.set(e.metaId, e)
  }
  const items = [...latest.values()]
    .filter((e) => !isWatched(e) && e.position > 30)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 12)

  if (items.length === 0) return null

  return (
    <Row title="Continue watching">
      {items.map((e) => {
        const meta = { id: e.metaId, type: e.type, name: e.name, poster: e.poster, background: e.background }
        const video = e.season !== undefined ? { id: e.videoId, season: e.season, episode: e.episode, title: e.episodeTitle } : undefined
        const art = e.background ?? e.poster
        return (
          <div key={e.metaId} className="continue-card">
            <button className="continue-art" style={{ backgroundImage: art ? `url("${art}"), ${artFor(e.metaId)}` : artFor(e.metaId) }} onClick={() => play(meta, video)} aria-label={`Resume ${e.name}`}>
              <span className="continue-play"><PlayIcon width={16} height={16} /></span>
            </button>
            <button className="continue-remove" aria-label={`Remove ${e.name} from Continue watching`} title="Remove" onClick={() => forget(e.metaId)}>×</button>
            <div className="continue-meta">
              <span className="poster-name">{e.name}</span>
              <span className="poster-sub">
                {video ? `S${e.season} · E${e.episode}${e.episodeTitle ? ` · ${e.episodeTitle}` : ''}` : 'Movie'} · {timeLeft(e)}
              </span>
            </div>
            <div className="progress"><div style={{ width: `${fraction(e) * 100}%` }} /></div>
          </div>
        )
      })}
    </Row>
  )
}
