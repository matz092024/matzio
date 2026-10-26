import { readJson, writeJson } from './storage'

// The last answer of each catalog, saved to disk next to addons and library, so Home can draw
// straight away on the next launch while fresh results load in the background.

const STORAGE_KEY = 'matzio.catalogcache'
const MAX_ENTRIES = 40
const MAX_AGE = 14 * 24 * 60 * 60 * 1000

interface Entry {
  savedAt: number
  value: unknown
}

const entries: Record<string, Entry> = readJson(STORAGE_KEY, {})
let saveTimer: ReturnType<typeof setTimeout> | undefined

export function cachedCatalog<T>(key: string): T | undefined {
  const entry = entries[key]
  if (!entry || Date.now() - entry.savedAt > MAX_AGE) return undefined
  return entry.value as T
}

export function rememberCatalog(key: string, value: unknown) {
  entries[key] = { savedAt: Date.now(), value }
  // Keep only the most recently loaded catalogs so the file stays small.
  const keys = Object.keys(entries).sort((a, b) => entries[b].savedAt - entries[a].savedAt)
  for (const old of keys.slice(MAX_ENTRIES)) delete entries[old]
  // Home loads many rows at once; batch them into one write.
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => writeJson(STORAGE_KEY, entries), 1000)
}
