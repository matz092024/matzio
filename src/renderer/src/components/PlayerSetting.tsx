import { useEffect, useState } from 'react'
import { useSettings } from '../settings'

/** Shows which mpv Matzio will use, and lets you point it at a specific mpv.exe. */
export default function PlayerSetting() {
  const { settings, update } = useSettings()
  const [found, setFound] = useState<string | null | undefined>(undefined)
  const [draft, setDraft] = useState(settings.mpvPath)
  const api = window.matzio

  useEffect(() => {
    if (!api) return
    let active = true
    api.player.detect(settings.mpvPath || undefined).then((p) => active && setFound(p))
    return () => {
      active = false
    }
  }, [api, settings.mpvPath])

  const customMissing = settings.mpvPath && found !== undefined && found !== settings.mpvPath

  return (
    <div className="setting setting-stack">
      <div>
        <div className="setting-label">Player</div>
        <div className="setting-hint">
          Matzio plays video in mpv, which handles the MKV, HEVC and surround audio files debrid services give you.
        </div>
        <div className="player-status">
          {!api ? (
            <span>Available in the desktop app.</span>
          ) : found === undefined ? (
            <span>Looking for mpv…</span>
          ) : found && !customMissing ? (
            <span className="ok">Using {found}</span>
          ) : found ? (
            <span className="warn">mpv wasn’t found at that path, so Matzio is using {found} instead.</span>
          ) : (
            <span className="warn">
              mpv wasn’t found. Get it from{' '}
              <a href="https://mpv.io/installation/" target="_blank" rel="noreferrer">mpv.io</a>, then paste the path to mpv.exe below.
            </span>
          )}
        </div>
      </div>
      <form
        className="addon-install"
        onSubmit={(e) => {
          e.preventDefault()
          update({ mpvPath: draft.trim() })
        }}
      >
        <input
          className="text-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Find automatically, or paste the path to mpv.exe"
          spellCheck={false}
          aria-label="mpv path"
        />
        <button className="btn btn-glass" disabled={draft.trim() === settings.mpvPath}>Save</button>
      </form>
    </div>
  )
}
