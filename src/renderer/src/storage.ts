// Data is saved to disk through the main process (see src/main/store.ts) so it survives updates.
// Older builds kept it in localStorage; the first read of each key moves it over once.
// localStorage still gets a copy as a backup, and is the only store outside Electron. localStorage can be missing
// or throw (private mode, cleared data), so every access is guarded.

const store = window.matzio?.storage
const saved: Record<string, unknown> = store?.load() ?? {}

function readLocal(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

export function readJson<T>(key: string, fallback: T): T {
  if (!store) return (readLocal(key) as T | undefined) ?? fallback
  if (key in saved) return saved[key] as T
  const legacy = readLocal(key)
  if (legacy === undefined) return fallback
  writeJson(key, legacy)
  return legacy as T
}

export function writeJson(key: string, value: unknown) {
  if (store) {
    saved[key] = value
    store.write(key, value)
  }
  // Also kept in localStorage as a backup the file store can recover from if it ever fails.
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Not persisted; the value still lives in memory for this session.
  }
}
