import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

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
    } catch {
      // A damaged file is skipped; the app falls back to its defaults for that key.
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

export function registerStore() {
  // Sync so the renderer has its data before the first render.
  ipcMain.on('store:load', (e) => {
    e.returnValue = loadAll()
  })
  ipcMain.on('store:write', (_e, key: string, value: unknown) => {
    try {
      write(key, value)
    } catch (err) {
      console.error(`Could not save ${key}:`, err)
    }
  })
}
