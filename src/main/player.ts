import { app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { statSync } from 'fs'
import { connect, type Socket } from 'net'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import { isDevMode, log } from './devlog'

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
  /** Draw inside the Matzio window instead of mpv's own window. */
  embed?: boolean
}

export interface PlayerProgress {
  key: string
  position: number
  duration: number
}

export interface PlayerTrack {
  id: number
  kind: 'audio' | 'sub'
  label: string
  selected: boolean
}

/** Everything the on-screen controls need. Pushed to the windows as it changes. */
export interface PlayerState {
  active: boolean
  embedded: boolean
  key: string
  title: string
  paused: boolean
  position: number
  duration: number
  volume: number
  muted: boolean
  /** mpv is waiting on the network, so the controls can show a spinner. */
  buffering: boolean
  tracks: PlayerTrack[]
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
  // Bundled copy, shipped with the installer.
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

const idleState: PlayerState = {
  active: false,
  embedded: false,
  key: '',
  title: '',
  paused: false,
  position: 0,
  duration: 0,
  volume: 100,
  muted: false,
  buffering: false,
  tracks: []
}

type MpvTrack = {
  id?: number
  type?: string
  title?: string
  lang?: string
  selected?: boolean
  codec?: string
  'demux-channel-count'?: number
}

function trackLabel(t: MpvTrack): string {
  const parts = [t.title, t.lang?.toUpperCase(), t.codec?.toUpperCase()].filter(Boolean) as string[]
  const channels = t['demux-channel-count']
  if (channels && channels > 2) parts.push(`${channels}.0`.replace(/^6\.0$/, '5.1').replace(/^8\.0$/, '7.1'))
  return parts.length ? parts.join(' · ') : `Track ${t.id ?? '?'}`
}

/** One video at a time; starting a new stream replaces the current one. */
export class Player {
  private proc: ChildProcess | null = null
  private socket: Socket | null = null
  private progress: PlayerProgress = { key: '', position: 0, duration: 0 }
  private state: PlayerState = { ...idleState }
  private nextRequestId = 100
  /** When the current mpv was started, for the dev log's time-to-first-frame. */
  private launchedAt = 0
  private firstFrameLogged = false

  constructor(
    private hooks: {
      onProgress: (p: PlayerProgress) => void
      onEnded: (p: PlayerProgress & { error?: string }) => void
      onState: (s: PlayerState) => void
      /** The window handle to draw into, when the request asks to embed. */
      embedTarget: () => number | null
    }
  ) {}

  getState(): PlayerState {
    return { ...this.state, tracks: [...this.state.tracks] }
  }

  private pushState(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch }
    this.hooks.onState(this.getState())
  }

  play(req: PlayRequest): { ok: true; embedded: boolean } | { ok: false; error: string } {
    const found = findAllMpv(req.mpvPath)
    if (found.length === 0) {
      log('error', 'mpv', 'No mpv found', { customPath: req.mpvPath ?? '', searched: [...new Set(candidates(req.mpvPath))] })
      return { ok: false, error: 'mpv-missing' }
    }

    const wid = req.embed ? this.hooks.embedTarget() : null
    const embedded = wid !== null
    if (req.embed && !embedded) log('warn', 'mpv', 'Built-in player asked for, but the window handle was unavailable; using a separate window')

    this.stop()
    this.progress = { key: req.key, position: req.start ?? 0, duration: 0 }

    const ipcPath = isWindows
      ? `\\\\.\\pipe\\matzio-mpv-${process.pid}-${Date.now()}`
      : join(tmpdir(), `matzio-mpv-${process.pid}-${Date.now()}.sock`)
    const args = [
      '--force-window=immediate',
      '--keep-open=no',
      '--idle=no',
      '--hwdec=auto-safe',
      `--force-media-title=${req.title}`,
      `--title=${req.title} · Matzio`,
      `--input-ipc-server=${ipcPath}`
    ]
    if (embedded) {
      args.push(
        `--wid=${wid}`,
        // Matzio draws the controls, and all input lands in the Electron window above mpv.
        '--osc=no',
        '--osd-level=0',
        '--input-default-bindings=no',
        '--input-vo-keyboard=no',
        '--input-cursor=no',
        '--no-window-dragging',
        '--background=#000000'
      )
    } else {
      args.push('--fullscreen', '--osd-bar=yes', '--osd-font-size=32', '--osd-color=#DDDDDD', '--osd-border-size=1')
    }
    if (req.start && req.start > 5) args.push(`--start=${Math.floor(req.start)}`)
    const headers = Object.entries(req.headers ?? {})
    if (headers.length) {
      // mpv splits this list on commas, so escape any inside values.
      args.push(`--http-header-fields=${headers.map(([k, v]) => `${k}: ${v}`.replace(/,/g, '\\,')).join(',')}`)
    }
    // In dev mode mpv's own warnings and errors are captured too.
    const dev = isDevMode()
    if (dev) args.push('--msg-level=all=warn', '--term-status-msg=')
    args.push('--', req.url)

    // spawn throws straight away for files Windows can't run (EFTYPE, EACCES), so fall through to the next copy.
    let proc: ChildProcess | null = null
    const failures: string[] = []
    for (const mpv of found) {
      try {
        proc = spawn(mpv, args, { stdio: dev ? ['ignore', 'pipe', 'pipe'] : 'ignore', windowsHide: false })
        log('info', 'mpv', `Started ${mpv} (pid ${proc.pid ?? '?'})`, {
          title: req.title,
          embedded,
          start: req.start ?? 0,
          // Header values can hold keys, so only their names are kept.
          headers: Object.keys(req.headers ?? {}),
          url: req.url,
          args: args.slice(0, -2).filter((a) => !a.startsWith('--http-header-fields') && !a.startsWith('--input-ipc-server'))
        })
        break
      } catch (e) {
        failures.push(`${mpv} (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`)
        log('warn', 'mpv', `Couldn’t run ${mpv}`, e)
      }
    }
    if (!proc) return { ok: false, error: `Couldn’t start mpv: ${failures.join(', ')}` }
    this.proc = proc
    const launchedAt = Date.now()
    this.launchedAt = launchedAt
    this.firstFrameLogged = false
    let spawnError: string | undefined
    if (dev) {
      // A broken stream can make mpv print the same warning many times, so each run logs at most 200 lines.
      let lines = 0
      const capture = (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split(/\r?\n/)) {
          if (!line.trim() || lines >= 200) continue
          lines++
          log('warn', 'mpv', line.trim().slice(0, 500))
          if (lines === 200) log('warn', 'mpv', 'More mpv output was left out')
        }
      }
      proc.stdout?.on('data', capture)
      proc.stderr?.on('data', capture)
    }

    this.pushState({
      ...idleState,
      active: true,
      embedded,
      key: req.key,
      title: req.title,
      position: req.start ?? 0,
      buffering: true
    })

    proc.on('error', (e) => {
      spawnError = e.message
      log('error', 'mpv', 'mpv process error', e)
      // A process that never started won't emit 'exit', so report the failure here.
      if (proc.pid === undefined && this.proc === proc) {
        this.proc = null
        this.finish(spawnError)
      }
    })
    proc.on('exit', (code, signal) => {
      log(code ? 'warn' : 'info', 'mpv', `mpv exited (code ${code ?? '-'}${signal ? `, ${signal}` : ''}) after ${Date.now() - launchedAt} ms`)
      if (this.proc !== proc) return
      this.proc = null
      this.socket?.destroy()
      this.socket = null
      this.finish(spawnError)
    })

    this.connect(ipcPath, proc)
    return { ok: true, embedded }
  }

  stop() {
    const proc = this.proc
    if (!proc) return
    this.proc = null
    this.socket?.destroy()
    this.socket = null
    proc.kill()
    this.finish()
  }

  private finish(error?: string) {
    log(error ? 'error' : 'info', 'player', `Playback ended at ${Math.round(this.progress.position)} of ${Math.round(this.progress.duration)} s`, error)
    this.hooks.onEnded({ ...this.progress, error })
    this.pushState({ ...idleState })
  }

  /** Sends one mpv command; ignored when nothing is playing. */
  command(...cmd: (string | number | boolean)[]) {
    const socket = this.socket
    if (!socket || socket.destroyed) return
    socket.write(JSON.stringify({ command: cmd, request_id: this.nextRequestId++ }) + '\n')
  }

  setPaused(paused: boolean) {
    this.command('set_property', 'pause', paused)
    // Reflect it right away so the button doesn't lag behind the keypress.
    this.pushState({ paused })
  }

  seekTo(seconds: number) {
    this.command('seek', Math.max(0, seconds), 'absolute')
    this.progress.position = Math.max(0, seconds)
    this.pushState({ position: this.progress.position })
  }

  seekBy(seconds: number) {
    this.command('seek', seconds, 'relative')
  }

  setVolume(volume: number) {
    const v = Math.max(0, Math.min(130, Math.round(volume)))
    this.command('set_property', 'volume', v)
    this.pushState({ volume: v })
  }

  setMuted(muted: boolean) {
    this.command('set_property', 'mute', muted)
    this.pushState({ muted })
  }

  /** `id` of -1 turns subtitles off. */
  setTrack(kind: 'audio' | 'sub', id: number) {
    this.command('set_property', kind === 'audio' ? 'aid' : 'sid', id < 0 ? 'no' : id)
    this.pushState({
      tracks: this.state.tracks.map((t) => (t.kind === kind ? { ...t, selected: t.id === id } : t))
    })
  }

  /** mpv creates the IPC endpoint shortly after starting, so retry for a few seconds. */
  private connect(path: string, proc: ChildProcess, attempt = 0) {
    if (this.proc !== proc) return
    const socket = connect(path)
    socket.once('error', () => {
      socket.destroy()
      if (attempt < 40) setTimeout(() => this.connect(path, proc, attempt + 1), 150)
      else log('error', 'mpv', 'Couldn’t connect to mpv’s control pipe, so the controls won’t work for this video')
    })
    socket.once('connect', () => {
      if (this.proc !== proc) return socket.destroy()
      log('info', 'mpv', `Control pipe connected after ${Date.now() - this.launchedAt} ms`)
      this.socket = socket
      const observe = (id: number, name: string) => socket.write(JSON.stringify({ command: ['observe_property', id, name] }) + '\n')
      observe(1, 'time-pos')
      observe(2, 'duration')
      observe(3, 'pause')
      observe(4, 'volume')
      observe(5, 'mute')
      observe(6, 'paused-for-cache')
      observe(7, 'track-list')
      observe(8, 'media-title')
    })
    let buffer = ''
    let lastSaved = 0
    let lastUi = 0
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
        if (msg.event !== 'property-change') continue
        const { name, data } = msg
        if (name === 'time-pos' && typeof data === 'number') {
          this.progress.position = data
          this.state.position = data
        } else if (name === 'duration' && typeof data === 'number') {
          this.progress.duration = data
          this.state.duration = data
        } else if (name === 'pause' && typeof data === 'boolean') {
          this.state.paused = data
        } else if (name === 'volume' && typeof data === 'number') {
          this.state.volume = Math.round(data)
        } else if (name === 'mute' && typeof data === 'boolean') {
          this.state.muted = data
        } else if (name === 'paused-for-cache' && typeof data === 'boolean') {
          this.state.buffering = data
        } else if (name === 'media-title' && typeof data === 'string' && data) {
          // Keep the title Matzio asked for; mpv only overrides it when the file carries a better one.
          if (!this.state.title) this.state.title = data
        } else if (name === 'track-list' && Array.isArray(data)) {
          this.state.tracks = (data as MpvTrack[])
            .filter((t) => (t.type === 'audio' || t.type === 'sub') && typeof t.id === 'number')
            .map((t) => ({ id: t.id as number, kind: t.type as 'audio' | 'sub', label: trackLabel(t), selected: !!t.selected }))
        } else {
          continue
        }
        // The first frame means it's really playing, not still opening the stream.
        if (name === 'time-pos' && this.state.buffering && !this.state.paused) this.state.buffering = false
        if (name === 'time-pos' && !this.firstFrameLogged) {
          this.firstFrameLogged = true
          log('info', 'mpv', `First frame after ${Date.now() - this.launchedAt} ms`)
        }
        if (name === 'paused-for-cache' && data === true && this.firstFrameLogged) log('info', 'mpv', `Buffering at ${Math.round(this.progress.position)} s`)

        const now = Date.now()
        if (name !== 'time-pos' || now - lastUi > 250) {
          lastUi = now
          this.hooks.onState(this.getState())
        }
        if (now - lastSaved > 5000) {
          lastSaved = now
          this.hooks.onProgress({ ...this.progress })
        }
      }
    })
  }
}
