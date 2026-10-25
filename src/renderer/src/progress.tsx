import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { readJson, writeJson } from './storage'
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
} | null>(null)

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entries>(() => readJson(STORAGE_KEY, {}))

  useEffect(() => writeJson(STORAGE_KEY, entries), [entries])

  useEffect(() => {
    const player = window.matzio?.player
    if (!player) return
    const record = (p: { key: string; position: number; duration: number }) =>
      setEntries((all) => {
        const e = all[p.key]
        // Ignore reports with no real position (e.g. mpv failed to open the stream).
        if (!e || p.duration <= 0) return all
        return { ...all, [p.key]: { ...e, position: p.position, duration: p.duration, updatedAt: Date.now() } }
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

  return <ProgressContext.Provider value={{ entries, get, latestFor, begin, forget }}>{children}</ProgressContext.Provider>
}

export function useProgress() {
  const ctx = useContext(ProgressContext)
  if (!ctx) throw new Error('useProgress must be used inside ProgressProvider')
  return ctx
}
