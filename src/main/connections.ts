import { app, ipcMain, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { log } from './devlog'

/**
 * API keys for artwork services (TMDB and fanart.tv), pasted in Settings → Connections.
 * They live in connections.json beside trakt.json in the app data folder (%APPDATA%\Matzio), encrypted
 * with the OS keychain (DPAPI on Windows) when available. The installer never touches that folder,
 * so updates keep them. The keys stay here in the main process; the page only ever sees their last
 * four characters.
 */

export type Service = 'tmdb' | 'fanart'

const SERVICES: Service[] = ['tmdb', 'fanart']

export const API = {
  tmdb: process.env.TMDB_API_URL || 'https://api.themoviedb.org/3',
  fanart: process.env.FANART_API_URL || 'https://webservice.fanart.tv/v3'
}

export interface ServiceStatus {
  /** A key is saved. */
  set: boolean
  /** The key's last four characters, to tell keys apart. */
  hint: string
  /** ok: the service accepted the key. invalid: it refused it. unknown: it couldn't be reached to check. */
  state: 'unset' | 'ok' | 'invalid' | 'unknown'
  /** When the key was last checked (ISO). */
  checkedAt: string | null
}

export type ConnectionsStatus = Record<Service, ServiceStatus>

interface Stored {
  keys?: Partial<Record<Service, string>>
  checks?: Partial<Record<Service, { state: ServiceStatus['state']; at: string }>>
}

const file = () => join(app.getPath('userData'), 'connections.json')

function load(): Stored {
  try {
    if (!existsSync(file())) return {}
    const raw = readFileSync(file())
    const text = raw.subarray(0, 4).toString() === 'enc:' ? safeStorage.decryptString(raw.subarray(4)) : raw.toString('utf8')
    return JSON.parse(text)
  } catch (e) {
    log('error', 'connections', 'Couldn’t read saved API keys', e)
    return {}
  }
}

function save(data: Stored) {
  const text = JSON.stringify(data)
  try {
    const out = safeStorage.isEncryptionAvailable() ? Buffer.concat([Buffer.from('enc:'), safeStorage.encryptString(text)]) : Buffer.from(text)
    writeFileSync(file(), out)
  } catch (e) {
    log('error', 'connections', 'Couldn’t save API keys', e)
  }
}

let data: Stored | null = null
const stored = () => (data ??= load())

/** The saved key for a service, or '' when none is set. */
export function keyFor(service: Service): string {
  return stored().keys?.[service] ?? ''
}

/** TMDB takes either a v3 API key (as a query parameter) or a v4 read access token (as a bearer token). */
export function tmdbRequest(path: string, key = keyFor('tmdb')): { url: string; headers: Record<string, string> } {
  const url = new URL(API.tmdb + path)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`
  else url.searchParams.set('api_key', key)
  return { url: url.toString(), headers }
}

async function verify(service: Service, key: string): Promise<ServiceStatus['state']> {
  try {
    const req =
      service === 'tmdb'
        ? tmdbRequest('/configuration', key)
        : { url: `${API.fanart}/movies/tt0111161?api_key=${encodeURIComponent(key)}`, headers: { Accept: 'application/json' } }
    const res = await fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(10000) })
    // fanart.tv answers 404 for a title it has no art for, which still means the key worked.
    if (res.ok || (service === 'fanart' && res.status === 404)) return 'ok'
    if (res.status === 401 || res.status === 403) return 'invalid'
    log('warn', 'connections', `${service} answered ${res.status} while checking the key`)
    return 'unknown'
  } catch (e) {
    log('warn', 'connections', `Couldn’t reach ${service} to check the key`, e)
    return 'unknown'
  }
}

function status(): ConnectionsStatus {
  const d = stored()
  const out = {} as ConnectionsStatus
  for (const s of SERVICES) {
    const key = d.keys?.[s] ?? ''
    const check = d.checks?.[s]
    out[s] = { set: !!key, hint: key.slice(-4), state: key ? (check?.state ?? 'unknown') : 'unset', checkedAt: key ? (check?.at ?? null) : null }
  }
  return out
}

function update(patch: (d: Stored) => Stored) {
  data = patch(stored())
  save(data)
}

async function check(service: Service) {
  const key = keyFor(service)
  if (!key) return
  const state = await verify(service, key)
  // The key may have changed while the check was running.
  if (keyFor(service) !== key) return
  update((d) => ({ ...d, checks: { ...d.checks, [service]: { state, at: new Date().toISOString() } } }))
}

export function registerConnections() {
  ipcMain.handle('connections:status', () => status())

  /** Checks a key with the service, then saves it unless the service refused it. */
  ipcMain.handle('connections:set', async (_e, service: Service, key: string) => {
    if (!SERVICES.includes(service)) return { ok: false as const, error: 'Unknown service.', status: status() }
    key = key.trim()
    const state = await verify(service, key)
    if (state === 'invalid') return { ok: false as const, error: 'That key was refused. Check that it was copied in full.', status: status() }
    update((d) => ({ keys: { ...d.keys, [service]: key }, checks: { ...d.checks, [service]: { state, at: new Date().toISOString() } } }))
    return { ok: true as const, status: status() }
  })

  ipcMain.handle('connections:remove', (_e, service: Service) => {
    update((d) => {
      const keys = { ...d.keys }
      const checks = { ...d.checks }
      delete keys[service]
      delete checks[service]
      return { keys, checks }
    })
    return status()
  })

  /** Checks every saved key again, e.g. when the Connections page opens. */
  ipcMain.handle('connections:check', async () => {
    await Promise.all(SERVICES.map(check))
    return status()
  })
}
