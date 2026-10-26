import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../preload'

/** The running version and where the background updater is at. */
export function useUpdates() {
  const api = window.matzio
  const [version, setVersion] = useState<string | null>(null)
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    if (!api) return
    let active = true
    api.updates.status().then((s) => {
      if (!active) return
      setVersion(s.version)
      setStatus(s.status)
    })
    const off = api.updates.onStatus(setStatus)
    return () => {
      active = false
      off()
    }
  }, [api])

  return { version, status }
}

/** Asks once a new version has downloaded. "Later" leaves it to install when Matzio next closes. */
export function UpdatePrompt() {
  const { status } = useUpdates()
  const [dismissed, setDismissed] = useState<string | null>(null)

  if (status?.state !== 'ready' || dismissed === status.version) return null

  return (
    <div className="update-prompt glass" role="status">
      <div>
        <div className="update-title">Matzio {status.version} is ready</div>
        <div className="setting-hint">Restart to switch over. It takes a few seconds.</div>
      </div>
      <div className="update-actions">
        <button className="btn btn-glass" onClick={() => setDismissed(status.version)}>Later</button>
        <button className="btn btn-primary" onClick={() => window.matzio?.updates.install()}>Restart</button>
      </div>
    </div>
  )
}
