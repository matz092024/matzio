import { app, clipboard, ipcMain, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// Dev mode keeps a plain-text log of what went wrong and how playback started, so it can be
// sent along with a bug report. It lives in %APPDATA%\Matzio\logs. Secrets are stripped before
// anything is written, and the file is capped: past MAX_BYTES it moves to matzio-dev.old.log
// and a fresh file starts, so at most two files of that size exist.

export type LogLevel = 'info' | 'warn' | 'error'

const MAX_BYTES = 1024 * 1024
// When the process started, so start-up steps count from launch rather than from this module loading.
const startedAt = Date.now() - Math.round(process.uptime() * 1000)

let enabled = false

export const logDir = () => join(app.getPath('userData'), 'logs')
const logFile = () => join(logDir(), 'matzio-dev.log')
const oldFile = () => join(logDir(), 'matzio-dev.old.log')

// Path segments worth keeping in a URL: short, plain words and ids like "stream", "movie" or "tt0111161:1:2.json".
// Anything long, encoded or key-shaped is replaced, since addon and debrid links carry API keys in their paths.
const SAFE_SEGMENT = /^[\w.:-]{1,40}$/
const KEY_LIKE = /[A-Za-z0-9]{20,}/
// Shorter tokens such as debrid download ids: one unbroken run of letters and digits mixed.
const ID_LIKE = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_-]{10,}$/

function safeSegment(s: string) {
  // IMDb ids and the paging/genre parts of catalog links are useful and never secret.
  if (/^tt\d+$/.test(s) || /^(skip=\d+|genre=[\w ]{1,30})(\.json)?$/.test(s)) return true
  return SAFE_SEGMENT.test(s) && !KEY_LIKE.test(s) && !ID_LIKE.test(s)
}
const SECRET_FIELDS = /\b(access_token|refresh_token|client_secret|code_verifier|device_code|token|apikey|api_key|password|authorization)\b("?\s*[:=]\s*"?)([^"\s,&}]+)/gi

function redactUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return '[url]'
  }
  const path = url.pathname
    .split('/')
    .map((s) => {
      if (!s) return s
      let decoded = s
      try {
        decoded = decodeURIComponent(s)
      } catch {
        // Keep the raw segment for the checks below.
      }
      return safeSegment(decoded) ? decoded : '[…]'
    })
    .join('/')
  const query = [...url.searchParams.keys()].map((k) => `${k}=[…]`).join('&')
  return `${url.protocol}//${url.host}${path}${query ? `?${query}` : ''}`
}

/** Strips tokens, keys and anything identifying from text before it reaches the log. */
export function redact(text: string): string {
  const home = homedir()
  // Links first, so the key=value pass below doesn't split a URL in two.
  let out = text
    .replace(/\b(?:https?|stremio):\/\/[^\s"'<>)\]]+/gi, (u) => redactUrl(u.replace(/^stremio:/i, 'https:')))
    .replace(/\bBearer\s+[\w.~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(SECRET_FIELDS, (_m, key: string, sep: string) => `${key}${sep}[redacted]`)
  // The Windows user name shows up in every path under the user folder.
  if (home) out = out.split(home).join('~')
  return out
}

function format(value: unknown): string {
  if (value === undefined) return ''
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function rotate() {
  try {
    if (statSync(logFile()).size < MAX_BYTES) return
    if (existsSync(oldFile())) unlinkSync(oldFile())
    renameSync(logFile(), oldFile())
  } catch {
    // No file yet, or it is locked; try again on the next write.
  }
}

let writes = 0

/** Appends one line. Does nothing unless dev mode is on. */
export function log(level: LogLevel, scope: string, message: string, data?: unknown) {
  if (!enabled) return
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(2)
  const extra = format(data)
  const line = `${new Date().toISOString()} +${seconds}s ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${extra ? ` ${extra}` : ''}`
  try {
    mkdirSync(logDir(), { recursive: true })
    // Checking the size every write would be wasteful; every 50 lines keeps the file close to the cap.
    if (writes++ % 50 === 0) rotate()
    appendFileSync(logFile(), redact(line).replace(/\r?\n/g, '\n    ') + '\n')
  } catch {
    // Logging must never break the app.
  }
}

export const isDevMode = () => enabled

function setEnabled(on: boolean) {
  if (on === enabled) return
  if (!on) log('info', 'dev', 'Dev mode off')
  enabled = on
  if (on) {
    log('info', 'dev', `Dev mode on · Matzio ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform} ${process.getSystemVersion()} ${process.arch}`)
  }
}

/** Reads the saved setting straight from disk so start-up is logged before the window exists. */
function readSavedSetting(): boolean {
  try {
    const settings = JSON.parse(readFileSync(join(app.getPath('userData'), 'data', 'matzio.settings.json'), 'utf8'))
    return settings?.devMode === true
  } catch {
    return false
  }
}

export function registerDevLog() {
  setEnabled(readSavedSetting())

  process.on('uncaughtException', (e) => log('error', 'main', 'Uncaught exception', e))
  process.on('unhandledRejection', (e) => log('error', 'main', 'Unhandled promise rejection', e))

  ipcMain.on('devlog:set-enabled', (_e, on: boolean) => setEnabled(!!on))
  ipcMain.on('devlog:write', (_e, level: LogLevel, scope: string, message: string, data?: unknown) => {
    if (level !== 'info' && level !== 'warn' && level !== 'error') level = 'info'
    log(level, `ui:${String(scope).slice(0, 20)}`, String(message).slice(0, 2000), data)
  })
  ipcMain.handle('devlog:info', () => {
    let size = 0
    try {
      size = statSync(logFile()).size
    } catch {
      // No log yet.
    }
    // Shown in Settings; %APPDATA% is what people can paste into Explorer's address bar.
    const folder = process.platform === 'win32' ? '%APPDATA%\\Matzio\\logs' : redact(logDir())
    return { enabled, folder, size }
  })
  ipcMain.handle('devlog:open-folder', async () => {
    mkdirSync(logDir(), { recursive: true })
    const error = await shell.openPath(logDir())
    return error ? { ok: false as const, error } : { ok: true as const }
  })
  ipcMain.handle('devlog:copy', () => {
    try {
      const older = existsSync(oldFile()) ? readFileSync(oldFile(), 'utf8') : ''
      const current = existsSync(logFile()) ? readFileSync(logFile(), 'utf8') : ''
      const text = older + current
      if (!text) return { ok: false as const, error: 'The log is empty so far.' }
      clipboard.writeText(text)
      return { ok: true as const, bytes: Buffer.byteLength(text) }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('devlog:clear', () => {
    for (const f of [logFile(), oldFile()]) {
      try {
        if (existsSync(f)) unlinkSync(f)
      } catch {
        // A locked file is overwritten below instead.
        try {
          writeFileSync(f, '')
        } catch {
          // Leave it.
        }
      }
    }
    log('info', 'dev', 'Log cleared')
  })
}

/** Milestones of a launch, logged with the time since the process started. */
export function mark(step: string) {
  log('info', 'startup', `${step} after ${Date.now() - startedAt} ms`)
}
