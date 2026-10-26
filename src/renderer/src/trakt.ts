import { useEffect, useRef } from 'react'
import { isWatched, useProgress } from './progress'

/** Adds a movie or episode to your Trakt history when you finish it (the same 90% mark as Continue watching). */
export function useTraktSync() {
  const { entries } = useProgress()
  const latest = useRef(entries)
  latest.current = entries

  useEffect(() => {
    const api = window.matzio
    if (!api) return
    return api.player.onEnded((p) => {
      const entry = latest.current[p.key]
      // Trakt only tracks movies and shows, not channels or live TV.
      if (!entry || !isWatched(p) || (entry.type !== 'movie' && entry.type !== 'series')) return
      api.trakt.markWatched({
        type: entry.type as 'movie' | 'series',
        id: entry.metaId,
        season: entry.season,
        episode: entry.episode,
        watchedAt: new Date().toISOString()
      })
    })
  }, [])
}
