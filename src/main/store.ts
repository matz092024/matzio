import { app, ipcMain } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { log } from './devlog'

// Addons, settings, library and progress live as JSON files in the per-user app data folder
// (%APPDATA%\Matzio\data on Windows). The installer never touches that folder, so updates keep them.

const KEY = /^matzio\.[a-z]+$/

const dataDir = () => join(app.getPath('userData'), 'data')
const fileFor = (key: string) => join(dataDir(), `${key}.json`)

function loadAll(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const dir = dataDir()
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const key = name.replace(/\.json$/, '')
    if (name === key || !KEY.test(key)) continue
    try {
      out[key] = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    } catch (e) {
      // A damaged file is skipped; the app falls back to its defaults for that key.
      log('error', 'store', `Couldn’t read ${name}, using defaults`, e)
    }
  }
  return out
}

function write(key: string, value: unknown) {
  if (!KEY.test(key)) return
  mkdirSync(dataDir(), { recursive: true })
  const file = fileFor(key)
  const tmp = `${file}.tmp`
  const json = JSON.stringify(value)
  // Write to a temp file first so a crash mid-write never leaves a half-written file behind.
  writeFileSync(tmp, json)
  try {
    renameSync(tmp, file)
  } catch {
    // Windows can refuse the rename while another process holds the file; write directly instead.
    writeFileSync(file, json)
  }
}

// Catalog and title responses are kept on disk too, so Home can show the last results right away
// while fresh ones load. Entries unused for a month are cleared at start-up.
const cacheDir = () => join(app.getPath('userData'), 'catalog-cache')
const cacheFile = (key: string) => join(cacheDir(), `${createHash('sha1').update(key).digest('hex')}.json`)
const CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000

function pruneCache() {
  const dir = cacheDir()
  if (!existsSync(dir)) return
  const cutoff = Date.now() - CACHE_MAX_AGE
  for (const name of readdirSync(dir)) {
    try {
      const file = join(dir, name)
      if (statSync(file).mtimeMs < cutoff) unlinkSync(file)
    } catch {
      // Ignore files that vanish or are locked; they'll be tried next start.
    }
  }
}

export function registerStore() {
  try {
    pruneCache()
  } catch {
    // The cache is optional.
  }
  ipcMain.handle('cache:get', async (_e, key: string) => {
    try {
      return JSON.parse(await readFile(cacheFile(key), 'utf8'))
    } catch {
      return null
    }
  })
  ipcMain.on('cache:set', (_e, key: string, value: unknown) => {
    mkdirSync(cacheDir(), { recursive: true })
    writeFile(cacheFile(key), JSON.stringify(value)).catch(() => {})
  })

  // Sync so the renderer has its data before the first render.
  ipcMain.on('store:load', (e) => {
    const t = Date.now()
    e.returnValue = loadAll()
    log('info', 'startup', `Saved data loaded in ${Date.now() - t} ms`)
  })
  ipcMain.on('store:write', (_e, key: string, value: unknown) => {
    try {
      write(key, value)
    } catch (err) {
      console.error(`Could not save ${key}:`, err)
      log('error', 'store', `Couldn’t save ${key}`, err)
    }
  })
}
