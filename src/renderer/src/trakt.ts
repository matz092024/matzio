import { useEffect, useRef } from 'react'
import { isWatched, useProgress, type WatchEntry } from './progress'
import { useLibrary } from './library'
import { devlog } from './devlog'

/** How often to check Trakt for titles watched elsewhere. Unchanged history costs a single call. */
const PULL_EVERY = 15 * 60 * 1000

/** Trakt only tracks movies and shows, not channels or live TV. */
const traktItem = (e: WatchEntry) =>
  e.type === 'movie' || e.type === 'series' ? { type: e.type as 'movie' | 'series', id: e.metaId, season: e.season, episode: e.episode } : null

/**
 * Keeps Trakt and the app in step:
 * - finished movies and episodes are added to your Trakt history (the same 90% mark as Continue watching);
 * - while something plays, its position goes to Trakt's playback progress each time it's saved here
 *   (Settings → Save progress every), and once more when playback stops;
 * - your Trakt history and resume points are pulled in at start-up, on connecting, and every 15 minutes;
 * - the Watchlist matches your Trakt watchlist: adding or removing a title here does the same on Trakt
 *   (see library.tsx), and changes made on Trakt come in with each pull.
 */
export function useTraktSync() {
  const { entries, importEntries } = useProgress()
  const latest = useRef(entries)
  latest.current = entries
  const importRef = useRef(importEntries)
  importRef.current = importEntries
  const library = useLibrary()
  const libraryRef = useRef(library)
  libraryRef.current = library

  useEffect(() => {
    const api = window.matzio
    if (!api) return
    const offProgress = api.player.onProgress((p) => {
      const entry = latest.current[p.key]
      const item = entry && traktItem(entry)
      if (!item || p.duration <= 0 || isWatched(p)) return
      api.trakt.saveProgress({ ...item, progress: (p.position / p.duration) * 100 })
    })
    const offEnded = api.player.onEnded((p) => {
      const entry = latest.current[p.key]
      const item = entry && traktItem(entry)
      if (!item || p.duration <= 0) return
      if (isWatched(p)) api.trakt.markWatched({ ...item, watchedAt: new Date().toISOString() })
      else api.trakt.saveProgress({ ...item, progress: (p.position / p.duration) * 100 })
    })
    return () => {
      offProgress()
      offEnded()
    }
  }, [])

  useEffect(() => {
    const api = window.matzio
    if (!api) return
    let connected = false
    const pull = async (force: boolean): Promise<string | null> => {
      const r = await api.trakt.pull(force)
      if (!r.ok) devlog('warn', 'trakt', 'Couldn’t pull Trakt history', r.error)
      else if (r.entries) importRef.current(r.entries)
      const local = libraryRef.current.items.map((i) => ({ id: i.id, type: i.type }))
      const w = await api.trakt.pullWatchlist(local, force)
      if (!w.ok) devlog('warn', 'trakt', 'Couldn’t sync the watchlist', w.error)
      else if (w.changes) libraryRef.current.applyRemote(w.changes.add, w.changes.remove)
      return !r.ok ? r.error : !w.ok ? w.error : null
    }
    api.trakt.status().then((s) => {
      // A status update may have arrived first and started the pull already.
      if (connected || s.username === null) return
      connected = true
      pull(true)
    })
    const offStatus = api.trakt.onStatus((s) => {
      const now = s.username !== null
      // Just signed in: bring the account's history over straight away.
      if (now && !connected) pull(true)
      connected = now
    })
    const offPull = onPullRequest(() => pull(true))
    const timer = setInterval(() => connected && pull(false), PULL_EVERY)
    return () => {
      offStatus()
      offPull()
      clearInterval(timer)
    }
  }, [])
}

const pullListeners = new Set<() => Promise<string | null>>()
function onPullRequest(cb: () => Promise<string | null>) {
  pullListeners.add(cb)
  return () => {
    pullListeners.delete(cb)
  }
}

/** Settings' "Sync now": pulls your Trakt history into the app right away. Resolves to an error message, or null. */
export async function pullTraktNow(): Promise<string | null> {
  const errors = await Promise.all([...pullListeners].map((cb) => cb()))
  return errors.find((e) => e) ?? null
}
