import { useEffect, useState } from 'react'
import type { Artwork } from '../../preload'

// Art from fanart.tv / TMDB (see src/main/artwork.ts), kept for the session.
const cache = new Map<string, Artwork | null>()
const inFlight = new Map<string, Promise<Artwork | null>>()

/** Called when keys change in Settings → Connections. */
export function clearArtworkCache() {
  cache.clear()
}

function fetchArtwork(type: string, id: string): Promise<Artwork | null> {
  const key = `${type}:${id}`
  if (cache.has(key)) return Promise.resolve(cache.get(key)!)
  const api = window.matzio
  if (!api) return Promise.resolve(null)
  let job = inFlight.get(key)
  if (!job) {
    job = api.artwork
      .get(type, id)
      .catch(() => null)
      .then((art) => {
        cache.set(key, art)
        return art
      })
      .finally(() => inFlight.delete(key))
    inFlight.set(key, job)
  }
  return job
}

/** How long the addon's logo waits for a sharper one, so a logo doesn't swap a moment after it shows. */
const HOLD_MS = 1500

/**
 * fanart.tv / TMDB art for a title. `ready` turns true once it has arrived, or after a short wait,
 * after which the addon's own art is shown instead.
 */
export function useArtwork(type: string, id: string): { art: Artwork | null; ready: boolean } {
  const key = `${type}:${id}`
  const [state, setState] = useState(() => (cache.has(key) ? { key, art: cache.get(key)!, ready: true } : { key, art: null, ready: false }))

  useEffect(() => {
    if (cache.has(key)) {
      setState({ key, art: cache.get(key)!, ready: true })
      return
    }
    setState({ key, art: null, ready: false })
    let active = true
    const hold = setTimeout(() => active && setState((s) => (s.key === key ? { ...s, ready: true } : s)), HOLD_MS)
    fetchArtwork(type, id).then((art) => active && setState({ key, art, ready: true }))
    return () => {
      active = false
      clearTimeout(hold)
    }
  }, [key])

  return state.key === key ? { art: state.art, ready: state.ready } : { art: null, ready: false }
}
