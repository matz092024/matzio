import { useEffect, useState, type FormEvent } from 'react'
import type { TraktStatus } from '../../../preload'

type Login = { userCode: string; verificationUrl: string }

/** Connect a Trakt.tv account so finished movies and episodes show up in your Trakt history. */
export default function TraktSettings() {
  const api = window.matzio
  const [status, setStatus] = useState<TraktStatus | undefined>(undefined)
  const [login, setLogin] = useState<Login | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [editKeys, setEditKeys] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  useEffect(() => {
    if (!api) return
    let active = true
    api.trakt.status().then((s) => active && setStatus(s))
    const offStatus = api.trakt.onStatus(setStatus)
    const offLogin = api.trakt.onLoginResult((e) => {
      setLogin(null)
      setMessage(e.state === 'connected' ? { kind: 'ok', text: 'Connected. Movies and episodes you finish will be added to your Trakt history.' } : { kind: 'error', text: e.message })
    })
    return () => {
      active = false
      offStatus()
      offLogin()
      // Leaving Settings mid sign-in would otherwise keep polling with no code on screen.
      api.trakt.cancelLogin()
    }
  }, [api])

  const connect = async () => {
    if (!api) return
    setBusy(true)
    setMessage(null)
    const r = await api.trakt.login()
    setBusy(false)
    if (r.ok) setLogin({ userCode: r.userCode, verificationUrl: r.verificationUrl })
    else setMessage({ kind: 'error', text: r.error })
  }

  const cancel = () => {
    api?.trakt.cancelLogin()
    setLogin(null)
  }

  const disconnect = async () => {
    setMessage(null)
    setStatus(await api!.trakt.disconnect())
  }

  const saveKeys = async (e: FormEvent) => {
    e.preventDefault()
    setMessage(null)
    setStatus(await api!.trakt.setApp(clientId, clientSecret))
    setClientId('')
    setClientSecret('')
    setEditKeys(false)
  }

  const askForKeys = status && !status.builtIn && (!status.configured || editKeys)

  return (
    <section className="settings-group glass">
      <h2 className="settings-heading">Trakt</h2>
      <div className="setting setting-stack">
        <div>
          <div className="setting-label">Watch history</div>
          <div className="setting-hint">
            Link your <a href="https://trakt.tv" target="_blank" rel="noreferrer">Trakt.tv</a> account and every movie or episode you finish is marked as
            watched there. You approve Matzio on trakt.tv, so your password never goes into the app.
          </div>
          <div className="player-status">
            {!api ? (
              <span>Available in the desktop app.</span>
            ) : status === undefined ? (
              <span>Checking…</span>
            ) : status.username !== null ? (
              <span className="ok">
                Connected{status.username ? ` as ${status.username}` : ''}
                {status.pending > 0 && ` · ${status.pending} waiting to sync`}
              </span>
            ) : !status.configured ? (
              <span>Not set up yet.</span>
            ) : (
              <span>Not connected.</span>
            )}
          </div>
        </div>

        {askForKeys && (
          <form className="trakt-keys" onSubmit={saveKeys}>
            <p className="setting-hint">
              Matzio needs a Trakt API app of your own. Create one at{' '}
              <a href="https://trakt.tv/oauth/applications/new" target="_blank" rel="noreferrer">trakt.tv/oauth/applications</a> with the redirect URI{' '}
              <code>urn:ietf:wg:oauth:2.0:oob</code>, then paste its keys here. They stay on this computer.
            </p>
            <input className="text-input" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" spellCheck={false} aria-label="Trakt Client ID" />
            <input
              className="text-input"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Client Secret"
              spellCheck={false}
              aria-label="Trakt Client Secret"
            />
            <div className="trakt-actions">
              <button className="btn btn-primary" disabled={!clientId.trim() || !clientSecret.trim()}>Save keys</button>
              {editKeys && <button type="button" className="btn btn-glass" onClick={() => setEditKeys(false)}>Cancel</button>}
            </div>
          </form>
        )}

        {status?.configured && !editKeys && login && (
          <div className="trakt-code glass">
            <div className="setting-hint">
              Enter this code at <a href={login.verificationUrl} target="_blank" rel="noreferrer">{login.verificationUrl.replace(/^https?:\/\//, '')}</a>. It’s already
              copied, and the page should have opened in your browser.
            </div>
            <div className="trakt-user-code" aria-label="Trakt code">{login.userCode}</div>
            <div className="trakt-actions">
              <span className="setting-hint"><span className="spinner" aria-hidden /> Waiting for you to approve…</span>
              <button className="btn btn-glass" onClick={cancel}>Cancel</button>
            </div>
          </div>
        )}

        {status?.configured && !editKeys && !login && (
          <div className="trakt-actions">
            {status.username !== null ? (
              <button className="btn btn-glass" onClick={disconnect}>Disconnect</button>
            ) : (
              <button className="btn btn-primary" disabled={busy} onClick={connect}>{busy ? 'Contacting Trakt…' : 'Connect Trakt'}</button>
            )}
            {!status.builtIn && status.username === null && (
              <button className="btn btn-glass" onClick={() => setEditKeys(true)}>Change app keys</button>
            )}
          </div>
        )}
        {message && <p className={`form-message ${message.kind}`}>{message.text}</p>}
      </div>
    </section>
  )
}
