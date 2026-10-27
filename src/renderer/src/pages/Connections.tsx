import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ArtService, ConnectionsStatus, ServiceStatus } from '../../../preload'
import { ArrowLeftIcon } from '../components/Icons'
import { clearArtworkCache } from '../artwork'

const SERVICES: { id: ArtService; name: string; hint: ReactNode; placeholder: string }[] = [
  {
    id: 'tmdb',
    name: 'TMDB',
    placeholder: 'API key or read access token',
    hint: (
      <>
        Lets Matzio find the right fanart.tv art for series, and fills in logos and backdrops fanart.tv doesn’t have. Get a free key at{' '}
        <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">themoviedb.org/settings/api</a>. Either the API key or the read
        access token works.
      </>
    )
  },
  {
    id: 'fanart',
    name: 'fanart.tv',
    placeholder: 'Personal API key',
    hint: (
      <>
        Clear logos, banners and backgrounds for the title pages and the loading screen. Get a free personal key at{' '}
        <a href="https://fanart.tv/get-an-api-key/" target="_blank" rel="noreferrer">fanart.tv/get-an-api-key</a>.
      </>
    )
  }
]

function describe(s: ServiceStatus) {
  if (s.state === 'unset') return { text: 'Not connected.', ok: false }
  const key = `key ending ${s.hint}`
  if (s.state === 'ok') return { text: `Connected · ${key}`, ok: true }
  if (s.state === 'invalid') return { text: `The saved key (${s.hint}) stopped working. Paste a new one.`, ok: false }
  return { text: `Saved (${key}), but the service couldn’t be reached to check it.`, ok: false }
}

function ServiceCard({ service, status, onChange }: { service: (typeof SERVICES)[number]; status?: ServiceStatus; onChange: (s: ConnectionsStatus) => void }) {
  const api = window.matzio
  const [key, setKey] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!api) return
    setBusy(true)
    setError(null)
    const r = await api.connections.set(service.id, key)
    setBusy(false)
    onChange(r.status)
    if (r.ok) {
      clearArtworkCache()
      setKey('')
      setEditing(false)
    } else setError(r.error)
  }

  const remove = async () => {
    if (!api) return
    setError(null)
    onChange(await api.connections.remove(service.id))
    clearArtworkCache()
  }

  const askForKey = status && (!status.set || status.state === 'invalid' || editing)
  const info = status && describe(status)

  return (
    <section className="settings-group glass">
      <h2 className="settings-heading">{service.name}</h2>
      <div className="setting setting-stack">
        <div>
          <div className="setting-hint">{service.hint}</div>
          <div className="player-status">
            {!api ? <span>Available in the desktop app.</span> : !info ? <span>Checking…</span> : <span className={info.ok ? 'ok' : ''}>{info.text}</span>}
          </div>
        </div>
        {askForKey ? (
          <form className="trakt-keys" onSubmit={save}>
            <input
              className="text-input"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={service.placeholder}
              spellCheck={false}
              autoComplete="off"
              aria-label={`${service.name} API key`}
            />
            <div className="trakt-actions">
              <button className="btn btn-primary" disabled={!key.trim() || busy}>{busy ? 'Checking…' : 'Save key'}</button>
              {editing && <button type="button" className="btn btn-glass" onClick={() => { setEditing(false); setKey(''); setError(null) }}>Cancel</button>}
            </div>
          </form>
        ) : (
          status?.set && (
            <div className="trakt-actions">
              <button className="btn btn-glass" onClick={() => setEditing(true)}>Change key</button>
              <button className="btn btn-glass" onClick={remove}>Remove</button>
            </div>
          )
        )}
        {error && <p className="form-message error">{error}</p>}
      </div>
    </section>
  )
}

/** Settings → Connections: API keys for artwork services. Keys stay on this computer. */
export default function Connections() {
  const api = window.matzio
  const navigate = useNavigate()
  const [status, setStatus] = useState<ConnectionsStatus | undefined>(undefined)

  useEffect(() => {
    if (!api) return
    let active = true
    // Show what's saved right away, then check the keys still work.
    api.connections.status().then((s) => active && setStatus(s))
    api.connections.check().then((s) => active && setStatus(s))
    return () => {
      active = false
    }
  }, [api])

  return (
    <div className="page narrow">
      <button className="btn btn-glass back" onClick={() => navigate('/settings')}>
        <ArrowLeftIcon width={16} height={16} />
        Settings
      </button>
      <header className="page-header">
        <h1 className="page-title">Connections</h1>
        <p className="setting-hint">
          Keys for artwork services. They’re saved only on this computer, encrypted, in the same place as your Trakt sign-in, and they stay when Matzio
          updates.
        </p>
      </header>
      {SERVICES.map((s) => (
        <ServiceCard key={s.id} service={s} status={status?.[s.id]} onChange={setStatus} />
      ))}
    </div>
  )
}
