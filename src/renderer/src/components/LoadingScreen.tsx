import { useEffect, useState } from 'react'
import type { MetaPreview } from '../stremio/types'

export interface LoadingArt {
  background?: string
  logo?: string
}

/** An image that stays invisible until it has loaded, then fades in over its outline. Key it by src. */
function FadeImage({ src, className, alt = '', onReady }: { src: string; className: string; alt?: string; onReady: (ok: boolean) => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  if (state === 'failed') return null
  return (
    <img
      className={`${className} ${state === 'ready' ? 'ready' : ''}`}
      src={src}
      alt={alt}
      onLoad={() => {
        setState('ready')
        onReady(true)
      }}
      onError={() => {
        setState('failed')
        onReady(false)
      }}
    />
  )
}

/**
 * Shown while streams are found and the player opens: the title's backdrop and logo, drawn first
 * as a dim outline that fills in as each image arrives, so the wait looks like the title, not a spinner.
 */
export default function LoadingScreen({
  meta,
  episode,
  art,
  text,
  onCancel
}: {
  meta: Pick<MetaPreview, 'id' | 'name' | 'background' | 'logo'>
  /** e.g. "S1 · E2 · Pilot" */
  episode?: string
  art?: LoadingArt
  text: string
  onCancel: () => void
}) {
  const background = art?.background ?? meta.background
  const logo = art?.logo ?? meta.logo
  // Which image urls have finished loading (true) or failed (false).
  const [loaded, setLoaded] = useState<Record<string, boolean>>({})
  const mark = (src: string) => (ok: boolean) => setLoaded((l) => ({ ...l, [src]: ok }))
  const backdropReady = !!background && loaded[background] === true
  const logoReady = !!logo && loaded[logo] === true
  // With no logo (or one that won't load) the name is shown instead.
  const noLogo = !logo || loaded[logo] === false

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="loading-screen" role="status" aria-live="polite" aria-label={`Loading ${meta.name}`}>
      <div className={`loading-backdrop ${backdropReady ? 'filled' : ''}`}>
        {background && <FadeImage key={background} className="loading-backdrop-img" src={background} onReady={mark(background)} />}
      </div>
      <div className="loading-body">
        <div className={`loading-logo ${logoReady ? 'filled' : ''} ${noLogo ? 'none' : ''}`}>
          {logo && !noLogo && <FadeImage key={logo} className="loading-logo-img" src={logo} alt={meta.name} onReady={mark(logo)} />}
          {noLogo && <h1 className="loading-name">{meta.name}</h1>}
        </div>
        {episode && <p className="loading-episode">{episode}</p>}
        <div className="loading-status">
          <span className="spinner" aria-hidden />
          <span>{text}</span>
        </div>
        <button className="btn btn-glass loading-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
