import { useEffect, useState } from 'react'
import { useSettings } from '../settings'

type Detected = { path: string | null; customOk: boolean | null }

/** Shows which mpv Matzio will use, and lets you point it at a specific mpv.exe. */
export default function PlayerSetting() {
  const { settings, update } = useSettings()
  const [detected, setDetected] = useState<Detected | undefined>(undefined)
  const [draft, setDraft] = useState(settings.mpvPath)
  const api = window.matzio
  const isWindows = api?.platform === 'win32'
  const exe = isWindows ? 'mpv.exe' : 'mpv'

  useEffect(() => {
    if (!api) return
    let active = true
    api.player.detect(settings.mpvPath || undefined).then((d) => active && setDetected(d))
    return () => {
      active = false
    }
  }, [api, settings.mpvPath])

  const save = (value: string) => {
    setDraft(value)
    update({ mpvPath: value.trim() })
  }

  const browse = async () => {
    const picked = await api?.player.browse()
    if (picked) save(picked)
  }

  const pathHelp = isWindows
    ? 'Pick the mpv.exe file inside the folder you unzipped from mpv.io (not a shortcut, the .zip/.7z file, or mpv.com).'
    : 'Pick the mpv program file.'

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
          ) : detected === undefined ? (
            <span>Looking for mpv…</span>
          ) : detected.customOk === false ? (
            <span className="warn">
              “{settings.mpvPath}” isn’t {exe}. {pathHelp}
              {detected.path && ` Until then Matzio uses ${detected.path}.`}
            </span>
          ) : detected.path ? (
            <span className="ok">Using {detected.path}</span>
          ) : (
            <span className="warn">
              mpv wasn’t found. Get it from <a href="https://mpv.io/installation/" target="_blank" rel="noreferrer">mpv.io</a>, then click Browse and
              select {exe}.
            </span>
          )}
        </div>
      </div>
      <form
        className="addon-install"
        onSubmit={(e) => {
          e.preventDefault()
          save(draft)
        }}
      >
        <input
          className="text-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Find automatically, or the path to ${exe}`}
          spellCheck={false}
          aria-label="mpv path"
        />
        {api && (
          <button type="button" className="btn btn-glass" onClick={browse}>Browse…</button>
        )}
        <button className="btn btn-glass" disabled={draft.trim() === settings.mpvPath}>Save</button>
        {settings.mpvPath && (
          <button type="button" className="btn btn-glass" onClick={() => save('')} title="Go back to finding mpv automatically">Reset</button>
        )}
      </form>
    </div>
  )
}
