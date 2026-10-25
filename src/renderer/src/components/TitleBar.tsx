import { useEffect, useState } from 'react'

export default function TitleBar() {
  const api = window.matzio
  const [maximized, setMaximized] = useState(false)

  useEffect(() => api?.window.onMaximizedChange(setMaximized), [api])

  return (
    <header className="titlebar">
      <div className="titlebar-brand">matzio</div>
      {api && (
        <div className="window-controls">
          <button aria-label="Minimize" onClick={api.window.minimize}>
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" /></svg>
          </button>
          <button aria-label={maximized ? 'Restore' : 'Maximize'} onClick={api.window.toggleMaximize}>
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"><path d="M2.5 2.5V.5h7v7h-2" /><rect x=".5" y="2.5" width="7" height="7" /></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"><rect x=".5" y=".5" width="9" height="9" /></svg>
            )}
          </button>
          <button aria-label="Close" className="close" onClick={api.window.close}>
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="m0 0 10 10M10 0 0 10" stroke="currentColor" /></svg>
          </button>
        </div>
      )}
    </header>
  )
}
