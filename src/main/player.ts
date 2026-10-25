import { app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { statSync } from 'fs'
import { connect, type Socket } from 'net'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'

export interface PlayRequest {
  /** Echoed back with progress so the app knows which video it belongs to. */
  key: string
  url: string
  title: string
  /** Seconds to resume from. */
  start?: number
  /** Extra HTTP headers some addons require (behaviorHints.proxyHeaders.request). */
  headers?: Record<string, string>
  /** Path the user set in Settings; empty means auto-detect. */
  mpvPath?: string
}

export interface PlayerProgress {
  key: string
  position: number
  duration: number
}

const isWindows = process.platform === 'win32'
const exe = isWindows ? 'mpv.exe' : 'mpv'

/** Accepts what people paste: quoted paths ("Copy as path" adds quotes) and the folder mpv is in. */
function normalizeCustom(input: string): string[] {
  const path = input.trim().replace(/^"(.*)"$/, '$1').trim()
  if (!path) return []
  return path.toLowerCase().endsWith('.exe') || !isWindows ? [path, join(path, exe)] : [join(path, exe), path]
}

function candidates(custom?: string): string[] {
  const list: string[] = []
  if (custom) list.push(...normalizeCustom(custom))
  // Bundled copy, shipped with the installer in a later step.
  list.push(join(process.resourcesPath ?? '', 'mpv', exe))
  list.push(join(app.getAppPath(), 'resources', 'mpv', exe))
  for (const dir of (process.env.PATH ?? '').split(delimiter)) if (dir) list.push(join(dir, exe))
  if (isWindows) {
    const { LOCALAPPDATA = '', USERPROFILE = '', ProgramFiles = 'C:\\Program Files', ProgramData = 'C:\\ProgramData' } = process.env
    list.push(
      join(ProgramFiles, 'mpv', exe),
      join(LOCALAPPDATA, 'Programs', 'mpv', exe),
      join(LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', exe),
      join(USERPROFILE, 'scoop', 'apps', 'mpv', 'current', exe),
      join(USERPROFILE, 'scoop', 'shims', exe),
      join(ProgramData, 'chocolatey', 'bin', exe)
    )
  }
  return list
}

/**
 * Real executables only. Windows "app execution aliases" (0-byte stubs in WindowsApps, which is on PATH)
 * look like mpv.exe but can't be started directly and fail with EFTYPE, so they're skipped.
 */
function isRunnable(p: string) {
  try {
    const st = statSync(p)
    if (!st.isFile() || st.size === 0) return false
    return isWindows ? p.toLowerCase().endsWith('.exe') : (st.mode & 0o111) !== 0
  } catch {
    return false
  }
}

export function findAllMpv(custom?: string): string[] {
  return [...new Set(candidates(custom))].filter(isRunnable)
}

export function findMpv(custom?: string): string | null {
  return findAllMpv(custom)[0] ?? null
}

/** What Settings shows: the mpv that will be used, and whether the path the user set works. */
export function detectMpv(custom?: string): { path: string | null; customOk: boolean | null } {
  const path = findMpv(custom)
  if (!custom?.trim()) return { path, customOk: null }
  return { path, customOk: normalizeCustom(custom).some(isRunnable) }
}

/** One mpv window at a time; starting a new stream replaces the current one. */
export class Player {
  private proc: ChildProcess | null = null
  private socket: Socket | null = null
  private progress: PlayerProgress = { key: '', position: 0, duration: 0 }

  constructor(
    private onProgress: (p: PlayerProgress) => void,
    private onEnded: (p: PlayerProgress & { error?: string }) => void
  ) {}

  play(req: PlayRequest): { ok: true } | { ok: false; error: string } {
    const found = findAllMpv(req.mpvPath)
    if (found.length === 0) return { ok: false, error: 'mpv-missing' }

    this.stop()
    this.progress = { key: req.key, position: req.start ?? 0, duration: 0 }

    const ipcPath = isWindows ? `\\\\.\\pipe\\matzio-mpv-${process.pid}-${Date.now()}` : join(tmpdir(), `matzio-mpv-${process.pid}-${Date.now()}.sock`)
    const args = [
      '--force-window=immediate',
      '--fullscreen',
      '--keep-open=no',
      '--hwdec=auto-safe',
      '--osd-bar=yes',
      '--osd-font-size=32',
      '--osd-color=#DDDDDD',
      '--osd-border-size=1',
      `--force-media-title=${req.title}`,
      `--title=${req.title} · Matzio`,
      `--input-ipc-server=${ipcPath}`
    ]
    if (req.start && req.start > 5) args.push(`--start=${Math.floor(req.start)}`)
    const headers = Object.entries(req.headers ?? {})
    if (headers.length) {
      // mpv splits this list on commas, so escape any inside values.
      args.push(`--http-header-fields=${headers.map(([k, v]) => `${k}: ${v}`.replace(/,/g, '\\,')).join(',')}`)
    }
    args.push('--', req.url)

    // spawn throws straight away for files Windows can't run (EFTYPE, EACCES), so fall through to the next copy.
    let proc: ChildProcess | null = null
    const failures: string[] = []
    for (const mpv of found) {
      try {
        proc = spawn(mpv, args, { stdio: 'ignore', windowsHide: false })
        break
      } catch (e) {
        failures.push(`${mpv} (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`)
      }
    }
    if (!proc) return { ok: false, error: `Couldn’t start mpv: ${failures.join(', ')}` }
    this.proc = proc
    let spawnError: string | undefined

    proc.on('error', (e) => {
      spawnError = e.message
      // A process that never started won't emit 'exit', so report the failure here.
      if (proc.pid === undefined && this.proc === proc) {
        this.proc = null
        this.onEnded({ ...this.progress, error: spawnError })
      }
    })
    proc.on('exit', () => {
      if (this.proc !== proc) return
      this.proc = null
      this.socket?.destroy()
      this.socket = null
      this.onEnded({ ...this.progress, error: spawnError })
    })

    this.connect(ipcPath, proc)
    return { ok: true }
  }

  stop() {
    const proc = this.proc
    if (!proc) return
    this.proc = null
    this.socket?.destroy()
    this.socket = null
    proc.kill()
    this.onEnded({ ...this.progress })
  }

  /** mpv creates the IPC endpoint shortly after starting, so retry for a few seconds. */
  private connect(path: string, proc: ChildProcess, attempt = 0) {
    if (this.proc !== proc) return
    const socket = connect(path)
    socket.once('error', () => {
      socket.destroy()
      if (attempt < 40) setTimeout(() => this.connect(path, proc, attempt + 1), 150)
    })
    socket.once('connect', () => {
      if (this.proc !== proc) return socket.destroy()
      this.socket = socket
      socket.write(JSON.stringify({ command: ['observe_property', 1, 'time-pos'] }) + '\n')
      socket.write(JSON.stringify({ command: ['observe_property', 2, 'duration'] }) + '\n')
    })
    let buffer = ''
    let lastSent = 0
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        let msg: { event?: string; name?: string; data?: unknown }
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.event !== 'property-change' || typeof msg.data !== 'number') continue
        if (msg.name === 'time-pos') this.progress.position = msg.data
        if (msg.name === 'duration') this.progress.duration = msg.data
        const now = Date.now()
        if (now - lastSent > 5000) {
          lastSent = now
          this.onProgress({ ...this.progress })
        }
      }
    })
  }
}
