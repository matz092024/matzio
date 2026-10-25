import { useState, type FormEvent } from 'react'
import { CINEMETA_URL, useAddons } from '../stremio/addons'
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, TrashIcon } from './Icons'

export default function AddonsSettings() {
  const { addons, install, remove, move } = useAddons()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)

  const hasCinemeta = addons.some((a) => a.manifest.id === 'com.linvo.cinemeta')

  const run = async (target: string) => {
    setBusy(true)
    setMessage(null)
    try {
      const addon = await install(target)
      setMessage({ kind: 'ok', text: `Installed ${addon.manifest.name}.` })
      setUrl('')
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not install that addon.' })
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (url.trim()) run(url)
  }

  return (
    <section className="settings-group glass">
      <h2 className="settings-heading">Addons</h2>
      <p className="setting-hint">
        Paste a Stremio addon link (manifest URL or stremio:// link). Order matters: higher addons are asked first, and Play will use the top stream.
      </p>

      <form className="addon-install" onSubmit={submit}>
        <input
          className="text-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/manifest.json"
          spellCheck={false}
          aria-label="Addon URL"
        />
        <button className="btn btn-primary" disabled={busy || !url.trim()}>
          <PlusIcon width={16} height={16} />
          {busy ? 'Installing…' : 'Install'}
        </button>
      </form>
      {message && <p className={`form-message ${message.kind}`}>{message.text}</p>}

      <ul className="addon-list">
        {addons.map((addon, i) => {
          const m = addon.manifest
          const base = addon.transportUrl.replace(/\/manifest\.json$/, '')
          return (
            <li key={addon.transportUrl} className="addon">
              <div className="addon-logo">
                {m.logo ? <img src={m.logo} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} /> : m.name.slice(0, 1)}
              </div>
              <div className="addon-info">
                <div className="addon-name">
                  {m.name} <span className="addon-version">v{m.version}</span>
                </div>
                {m.description && <div className="addon-desc">{m.description}</div>}
                <div className="addon-tags">
                  {m.types.map((t) => <span key={t} className="chip static small">{t}</span>)}
                  {m.behaviorHints?.configurable && (
                    <a className="addon-link" href={`${base}/configure`} target="_blank" rel="noreferrer">Configure</a>
                  )}
                </div>
              </div>
              <div className="addon-actions">
                <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(addon.transportUrl, -1)}>
                  <ChevronUpIcon width={16} height={16} />
                </button>
                <button className="icon-btn" aria-label="Move down" disabled={i === addons.length - 1} onClick={() => move(addon.transportUrl, 1)}>
                  <ChevronDownIcon width={16} height={16} />
                </button>
                <button className="icon-btn" aria-label={`Remove ${m.name}`} onClick={() => remove(addon.transportUrl)}>
                  <TrashIcon width={16} height={16} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {!hasCinemeta && (
        <button className="btn btn-glass restore-default" disabled={busy} onClick={() => run(CINEMETA_URL)}>
          <PlusIcon width={16} height={16} />
          Add Cinemeta (default movie and series catalogs)
        </button>
      )}
    </section>
  )
}
