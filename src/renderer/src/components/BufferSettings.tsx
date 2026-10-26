import { useSettings } from '../settings'

/** The slider snaps to these, in seconds. */
const STOPS = [10, 20, 30, 45, 60, 90, 120, 180, 300, 600]

export function duration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s ? `${m} min ${s} s` : `${m} min`
}

/** Mirrors bufferMiB in src/main/player.ts, so Settings can say how much memory a choice may use. */
function memoryFor(seconds: number) {
  const mib = Math.min(2048, Math.max(150, seconds * 6))
  return mib >= 1024 ? `${(mib / 1024).toFixed(1).replace(/\.0$/, '')} GB` : `${Math.round(mib)} MB`
}

function nearestStop(seconds: number) {
  return STOPS.reduce((best, s, i) => (Math.abs(s - seconds) < Math.abs(STOPS[best] - seconds) ? i : best), 0)
}

/** How far ahead mpv buffers, and the optional numbers panel over the player. */
export default function BufferSettings() {
  const { settings, update } = useSettings()
  const index = nearestStop(settings.bufferSeconds)

  return (
    <>
      <div className="setting setting-stack">
        <div className="buffer-head">
          <div>
            <div className="setting-label">Buffer ahead</div>
            <div className="setting-hint">
              The most video mpv downloads ahead of where you are. More rides out slow patches, but uses up to {memoryFor(settings.bufferSeconds)} of
              memory on high-bitrate files. Applies from the next video you start.
            </div>
          </div>
          <span className="buffer-value">{duration(STOPS[index])}</span>
        </div>
        <input
          className="pl-range buffer-range"
          type="range"
          min={0}
          max={STOPS.length - 1}
          step={1}
          value={index}
          aria-label="Buffer ahead"
          aria-valuetext={duration(STOPS[index])}
          onChange={(e) => update({ bufferSeconds: STOPS[Number(e.target.value)] })}
          style={{ ['--pl-progress' as string]: `${(index / (STOPS.length - 1)) * 100}%` }}
        />
        <div className="buffer-scale" aria-hidden>
          <span>{duration(STOPS[0])}</span>
          <span>{duration(STOPS[STOPS.length - 1])}</span>
        </div>
      </div>
      <div className="setting">
        <div>
          <div className="setting-label">Buffer info</div>
          <div className="setting-hint">
            Shows how much is buffered, download speed and dropped frames in a small panel over the built-in player. Press I while
            watching to hide or show it.
          </div>
        </div>
        <button
          role="switch"
          aria-checked={settings.bufferInfo}
          aria-label="Buffer info"
          className={`toggle ${settings.bufferInfo ? 'on' : ''}`}
          onClick={() => update({ bufferInfo: !settings.bufferInfo })}
        >
          <span />
        </button>
      </div>
    </>
  )
}
