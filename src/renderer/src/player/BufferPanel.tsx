import { useEffect, useState } from 'react'
import type { PlayerStats } from '../../../preload'
import { duration } from '../components/BufferSettings'

const POLL_MS = 1000

function bytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  return `${Math.round(n / 1024)} KB`
}

function speed(bytesPerSecond: number) {
  const mbit = (bytesPerSecond * 8) / 1e6
  return mbit >= 10 ? `${Math.round(mbit)} Mbit/s` : `${mbit.toFixed(1)} Mbit/s`
}

const fillLabel = { filling: 'Filling', full: 'Limit reached', complete: 'Rest of the file is in' } as const

/** A small, quiet readout of mpv's buffer, asked for once a second while it's on screen. */
export default function BufferPanel() {
  const [stats, setStats] = useState<PlayerStats | null>(null)

  useEffect(() => {
    const player = window.matzio?.player
    if (!player) return
    let active = true
    const poll = () => player.stats().then((s) => active && setStats(s)).catch(() => undefined)
    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  const s = stats
  const fraction = s?.ahead != null && s.limitSeconds ? Math.min(1, s.ahead / s.limitSeconds) : null
  const dropped = s && (s.droppedDecoder !== null || s.droppedOutput !== null) ? (s.droppedDecoder ?? 0) + (s.droppedOutput ?? 0) : null

  const rows: [string, string][] = [
    ['Buffered', s?.ahead != null ? `${duration(s.ahead)} ahead` : '–'],
    ['Limit', s?.limitSeconds != null ? duration(s.limitSeconds) : '–'],
    ['In memory', s?.aheadBytes != null ? `${bytes(s.aheadBytes)}${s.limitBytes ? ` of ${bytes(s.limitBytes)}` : ''}` : '–'],
    ['Speed', s?.speed != null ? speed(s.speed) : '–'],
    ['Status', s?.resumePercent != null ? `Waiting, ${Math.round(s.resumePercent)}%` : s?.fill ? fillLabel[s.fill] : '–'],
    [
      'Dropped frames',
      dropped === null ? '–' : s?.droppedDecoder != null && s.droppedOutput != null && dropped > 0
        ? `${dropped} (${s.droppedDecoder} decoder, ${s.droppedOutput} output)`
        : String(dropped)
    ]
  ]

  return (
    <div className="pl-stats glass" aria-label="Buffer info">
      <div className="pl-stats-bar" aria-hidden>
        <div style={{ width: `${(fraction ?? 0) * 100}%` }} />
      </div>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
