import { useEffect, useState } from 'react'
import { useSettings } from '../settings'

type Info = { enabled: boolean; folder: string; size: number }

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Dev mode: a log of errors and playback details that can be sent along with a bug report. */
export default function DevSettings() {
  const { settings, update } = useSettings()
  const api = window.matzio
  const [info, setInfo] = useState<Info | null>(null)
  const [note, setNote] = useState('')

  const refresh = () => {
    api?.devlog.info().then(setInfo).catch(() => {})
  }

  useEffect(() => {
    // Give the main process a moment to pick up the switch before asking for the file size.
    const t = setTimeout(refresh, 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.devMode])

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(''), 4000)
    return () => clearTimeout(t)
  }, [note])

  const copy = async () => {
    const r = await api?.devlog.copy()
    if (!r) return
    setNote(r.ok ? `Copied ${size(r.bytes)}. Paste it into a message to send it.` : r.error)
  }

  const open = async () => {
    const r = await api?.devlog.openFolder()
    if (r && !r.ok) setNote(r.error)
  }

  const clear = async () => {
    await api?.devlog.clear()
    setNote('Log cleared.')
    refresh()
  }

  return (
    <section className="settings-group glass">
      <h2 className="settings-heading">Troubleshooting</h2>
      <div className="setting">
        <div>
          <div className="setting-label">Dev mode</div>
          <div className="setting-hint">
            Keeps a log of errors, how each video started and what mpv said, update checks and start-up times, so you can send it when
            something goes wrong. Tokens, addon keys and your Windows user name are removed before anything is saved.
          </div>
        </div>
        <button
          role="switch"
          aria-checked={settings.devMode}
          className={`toggle ${settings.devMode ? 'on' : ''}`}
          onClick={() => update({ devMode: !settings.devMode })}
        >
          <span />
        </button>
      </div>
      {api && (settings.devMode || (info && info.size > 0)) && (
        <div className="setting">
          <div>
            <div className="setting-label">Log file</div>
            <div className="player-status">
              <code>{info ? `${info.folder}${api.platform === 'win32' ? '\\' : '/'}matzio-dev.log` : '…'}</code>
              {info && <span> · {size(info.size)}</span>}
            </div>
            {note && <div className="player-status"><span className="ok">{note}</span></div>}
          </div>
          <div className="dev-actions">
            <button className="btn btn-glass update-button" onClick={copy}>Copy log</button>
            <button className="btn btn-glass update-button" onClick={open}>Open folder</button>
            <button className="btn btn-glass update-button" onClick={clear}>Clear</button>
          </div>
        </div>
      )}
    </section>
  )
}
