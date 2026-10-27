import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { MetaPreview } from './stremio/types'
import { readJson, writeJson } from './storage'

// Still called "library" on disk so saved lists carry over; the app shows it as the Watchlist.
const STORAGE_KEY = 'matzio.library'

export type Saved = Pick<MetaPreview, 'id' | 'type' | 'name' | 'poster' | 'releaseInfo' | 'genres'> & { addedAt: number }

const LibraryContext = createContext<{
  items: Saved[]
  has: (id: string) => boolean
  toggle: (meta: MetaPreview) => void
  /** Applies changes pulled from Trakt without sending them back. */
  applyRemote: (add: Saved[], remove: string[]) => void
} | null>(null)

/** Trakt only has movies and shows, so other titles stay on this computer. */
const onTrakt = (type: string): type is 'movie' | 'series' => type === 'movie' || type === 'series'

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Saved[]>(() => readJson(STORAGE_KEY, []))

  useEffect(() => writeJson(STORAGE_KEY, items), [items])

  const has = (id: string) => items.some((i) => i.id === id)

  const toggle = (meta: MetaPreview) => {
    const add = !has(meta.id)
    if (onTrakt(meta.type)) window.matzio?.trakt.updateWatchlist({ type: meta.type, id: meta.id, add })
    setItems((list) =>
      add
        ? [
            { id: meta.id, type: meta.type, name: meta.name, poster: meta.poster, releaseInfo: meta.releaseInfo, genres: meta.genres, addedAt: Date.now() },
            ...list.filter((i) => i.id !== meta.id)
          ]
        : list.filter((i) => i.id !== meta.id)
    )
  }

  const applyRemote = (add: Saved[], remove: string[]) => {
    if (add.length === 0 && remove.length === 0) return
    const gone = new Set(remove)
    setItems((list) => {
      const kept = list.filter((i) => !gone.has(i.id))
      const fresh = add.filter((a) => !kept.some((i) => i.id === a.id))
      // Newest first, the same order titles saved here get.
      return [...kept, ...fresh].sort((a, b) => b.addedAt - a.addedAt)
    })
  }

  return <LibraryContext.Provider value={{ items, has, toggle, applyRemote }}>{children}</LibraryContext.Provider>
}

export function useLibrary() {
  const ctx = useContext(LibraryContext)
  if (!ctx) throw new Error('useLibrary must be used inside LibraryProvider')
  return ctx
}
