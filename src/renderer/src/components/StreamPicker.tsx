import { useEffect } from 'react'
import type { AddonStream } from '../stremio/client'
import { PlayIcon } from './Icons'

function sizeOf(bytes?: number) {
  if (!bytes) return ''
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

export default function StreamPicker({
  title,
  streams,
  hidden,
  onPick,
  onClose
}: {
  title: string
  streams: AddonStream[]
  hidden: number
  onPick: (s: AddonStream) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet glass" role="dialog" aria-label="Choose a stream" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <div>
            <div className="eyebrow">Choose a stream</div>
            <h2 className="sheet-title">{title}</h2>
          </div>
          <button className="btn btn-glass" onClick={onClose}>Close</button>
        </header>
        <ol className="stream-list">
          {streams.map((s, i) => {
            const lines = (s.title ?? s.description ?? '').split('\n').filter(Boolean)
            // Many addons already put the size in the title; only add ours when they don't.
            const size = /\d\s?(GB|MB)/i.test(lines.join(' ')) ? '' : sizeOf(s.behaviorHints?.videoSize)
            return (
              <li key={`${s.url}-${i}`}>
                <button className="stream" onClick={() => onPick(s)}>
                  <span className="stream-source">
                    <span className="stream-name">{s.name ?? s.addon}</span>
                    <span className="stream-addon">{s.addon}</span>
                  </span>
                  <span className="stream-detail">
                    {lines.map((l, j) => <span key={j}>{l}</span>)}
                    {size && <span className="stream-size">{size}</span>}
                  </span>
                  <span className="stream-play" aria-hidden><PlayIcon width={14} height={14} /></span>
                </button>
              </li>
            )
          })}
        </ol>
        {hidden > 0 && <p className="sheet-note">{hidden} torrent-only {hidden === 1 ? 'stream is' : 'streams are'} hidden. Matzio plays debrid links.</p>}
      </div>
    </div>
  )
}
