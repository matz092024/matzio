import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { MetaPreview } from './stremio/types'
import { readJson, writeJson } from './storage'

const STORAGE_KEY = 'matzio.library'

type Saved = Pick<MetaPreview, 'id' | 'type' | 'name' | 'poster' | 'releaseInfo' | 'genres'> & { addedAt: number }

const LibraryContext = createContext<{
  items: Saved[]
  has: (id: string) => boolean
  toggle: (meta: MetaPreview) => void
} | null>(null)

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Saved[]>(() => readJson(STORAGE_KEY, []))

  useEffect(() => writeJson(STORAGE_KEY, items), [items])

  const has = (id: string) => items.some((i) => i.id === id)

  const toggle = (meta: MetaPreview) =>
    setItems((list) =>
      list.some((i) => i.id === meta.id)
        ? list.filter((i) => i.id !== meta.id)
        : [
            { id: meta.id, type: meta.type, name: meta.name, poster: meta.poster, releaseInfo: meta.releaseInfo, genres: meta.genres, addedAt: Date.now() },
            ...list
          ]
    )

  return <LibraryContext.Provider value={{ items, has, toggle }}>{children}</LibraryContext.Provider>
}

export function useLibrary() {
  const ctx = useContext(LibraryContext)
  if (!ctx) throw new Error('useLibrary must be used inside LibraryProvider')
  return ctx
}
