import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { readJson, writeJson } from './storage'
import { useSettings } from './settings'
import type { TraktImportedEntry } from '../../preload'
import type { ContentType } from './stremio/types'

/** Where you are in one movie or episode. */
export interface WatchEntry {
  videoId: string
  metaId: string
  type: ContentType
  name: string
  poster?: string
  background?: string
  season?: number
  episode?: number
  episodeTitle?: string
  position: number
  duration: number
  updatedAt: number
  /** Came from Trakt as a percentage, so position and duration are guesses until the video is played here. */
  estimated?: boolean
}

const STORAGE_KEY = 'matzio.progress'

export const isWatched = (e?: Pick<WatchEntry, 'position' | 'duration'>) => !!e && e.duration > 0 && e.position / e.duration >= 0.9
export const fraction = (e?: Pick<WatchEntry, 'position' | 'duration'>) => (e && e.duration > 0 ? Math.min(1, e.position / e.duration) : 0)

type Entries = Record<string, WatchEntry>

const ProgressContext = createContext<{
  entries: Entries
  get: (videoId: string) => WatchEntry | undefined
  /** The most recently played entry for a title. */
  latestFor: (metaId: string) => WatchEntry | undefined
  /** Registers what is about to play, so progress from the player can be filed under it. */
  begin: (entry: Omit<WatchEntry, 'position' | 'duration' | 'updatedAt'>) => void
  /** Forgets progress for every video of a title (used by Continue watching's remove button). */
  forget: (metaId: string) => void
  /** Merges history and resume points from Trakt; whichever side is newer wins for each video. */
  importEntries: (list: TraktImportedEntry[]) => void
} | null>(null)

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entries>(() => readJson(STORAGE_KEY, {}))
  const { settings } = useSettings()

  useEffect(() => window.matzio?.player.setProgressInterval(settings.progressInterval), [settings.progressInterval])

  useEffect(() => writeJson(STORAGE_KEY, entries), [entries])

  useEffect(() => {
    const player = window.matzio?.player
    if (!player) return
    const record = (p: { key: string; position: number; duration: number }) =>
      setEntries((all) => {
        const e = all[p.key]
        // Ignore reports with no real position (e.g. mpv failed to open the stream).
        if (!e || p.duration <= 0) return all
        return { ...all, [p.key]: { ...e, position: p.position, duration: p.duration, updatedAt: Date.now(), estimated: undefined } }
      })
    const offProgress = player.onProgress(record)
    const offEnded = player.onEnded(record)
    return () => {
      offProgress()
      offEnded()
    }
  }, [])

  const get = (videoId: string) => entries[videoId]

  const latestFor = (metaId: string) =>
    Object.values(entries)
      .filter((e) => e.metaId === metaId && e.duration > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]

  const begin: (e: Omit<WatchEntry, 'position' | 'duration' | 'updatedAt'>) => void = (e) =>
    setEntries((all) => {
      const prev = all[e.videoId]
      return { ...all, [e.videoId]: { ...e, position: prev?.position ?? 0, duration: prev?.duration ?? 0, updatedAt: prev?.updatedAt ?? Date.now() } }
    })

  const forget = (metaId: string) =>
    setEntries((all) => Object.fromEntries(Object.entries(all).filter(([, e]) => e.metaId !== metaId)))

  const importEntries = (list: TraktImportedEntry[]) =>
    setEntries((all) => {
      const next = { ...all }
      for (const t of list) {
        const local = all[t.videoId]
        if (local && local.updatedAt >= t.updatedAt) continue
        // Trakt only knows a percentage; the length this computer measured beats Trakt's runtime.
        const known = !!local && local.duration > 0 && !local.estimated
        const duration = known ? local.duration : t.runtime || (t.fraction >= 1 ? 1 : t.type === 'movie' ? 6000 : 2700)
        next[t.videoId] = {
          videoId: t.videoId,
          metaId: t.metaId,
          type: t.type,
          name: local?.name || t.name,
          poster: local?.poster ?? t.poster,
          background: local?.background ?? t.background,
          season: t.season,
          episode: t.episode,
          episodeTitle: local?.episodeTitle ?? t.episodeTitle,
          position: t.fraction * duration,
          duration,
          updatedAt: t.updatedAt,
          estimated: !known && t.fraction < 1 ? true : undefined
        }
      }
      return next
    })

  return <ProgressContext.Provider value={{ entries, get, latestFor, begin, forget, importEntries }}>{children}</ProgressContext.Provider>
}

export function useProgress() {
  const ctx = useContext(ProgressContext)
  if (!ctx) throw new Error('useProgress must be used inside ProgressProvider')
  return ctx
}
