import { useUpdates } from '../updates'

export default function UpdateSettings() {
  const api = window.matzio
  const { version, status } = useUpdates()

  const text = !api
    ? 'Available in the desktop app.'
    : !status
      ? 'Checking…'
      : status.state === 'unsupported'
        ? 'Running from source, so updates come from git instead.'
        : status.state === 'checking'
          ? 'Checking for updates…'
          : status.state === 'downloading'
            ? `Downloading ${status.version}… ${status.percent}%`
            : status.state === 'ready'
              ? `${status.version} is downloaded and installs when you restart.`
              : status.state === 'error'
                ? status.message
                : status.state === 'up-to-date'
                  ? 'You’re on the latest version.'
                  : 'Checks automatically.'

  const busy = status?.state === 'checking' || status?.state === 'downloading'

  return (
    <section className="settings-group glass">
      <h2 className="settings-heading">Updates</h2>
      <div className="setting">
        <div>
          <div className="setting-label">Matzio {version ?? ''}</div>
          <div className="setting-hint">New versions download in the background, and Matzio asks before restarting. If you say later, it updates the next time you close it.</div>
          <div className="player-status">
            <span className={status?.state === 'up-to-date' || status?.state === 'ready' ? 'ok' : ''}>{text}</span>
          </div>
        </div>
        {status?.state === 'ready' ? (
          <button className="btn btn-primary update-button" onClick={() => api?.updates.install()}>Restart now</button>
        ) : (
          status &&
          status.state !== 'unsupported' && (
            <button className="btn btn-glass update-button" disabled={busy} onClick={() => api?.updates.check()}>Check now</button>
          )
        )}
      </div>
    </section>
  )
}
