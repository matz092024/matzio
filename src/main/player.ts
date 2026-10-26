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
  /** Most seconds to buffer ahead (Settings → Buffer ahead). Left out, mpv's defaults apply. */
  bufferSeconds?: number
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

/** Buffer numbers for the optional info panel. Each is null when mpv can't say right now. */
export interface PlayerStats {
  /** Seconds buffered past the playhead. */
  ahead: number | null
  /** The most mpv will buffer ahead, in seconds. */
  limitSeconds: number | null
  /** Bytes buffered past the playhead. */
  aheadBytes: number | null
  /** Bytes held in the cache in total, including what's already been watched. */
  totalBytes: number | null
  /** The most mpv will hold ahead, in bytes. */
  limitBytes: number | null
  /** Download speed, in bytes per second. */
  speed: number | null
  /** filling: still downloading; full: reached the limit and waiting; complete: the rest of the file is in. */
  fill: 'filling' | 'full' | 'complete' | null
  /** While stalled, how far mpv is towards resuming (0-100). */
  resumePercent: number | null
  /** Frames the decoder skipped to keep up. */
  droppedDecoder: number | null
  /** Frames the video output skipped. */
  droppedOutput: number | null
}

/**
 * The memory ceiling that goes with a buffer length. mpv stops at whichever limit it hits
 * first, and its default 150 MiB holds only ~20 s of a 4K remux, so the ceiling grows with
 * the seconds asked for (room for ~50 Mbit/s), capped at 2 GiB.
 */
export function bufferMiB(seconds: number): number {
  return Math.round(Math.min(2048, Math.max(150, seconds * 6)))
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

/** The line in mpv's output that explains why it quit, e.g. an option this mpv doesn't accept. */
function lastError(log: string): string | undefined {
  const lines = log.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return [...lines].reverse().find((l) => /error|fail|invalid|unknown|not found/i.test(l)) ?? lines.at(-1)
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
  /** get_property calls waiting on mpv's reply, by request id. */
  private pending = new Map<number, (data: unknown) => void>()
  /** When the current mpv was started, for the dev log's time-to-first-frame. */
  private launchedAt = 0
  private firstFrameLogged = false

  constructor(
    private hooks: {
      onProgress: (p: PlayerProgress) => void
      onEnded: (p: PlayerProgress & { error?: string; mpvError?: string }) => void
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

    // Stop what's playing first: that closes its player windows, which must not take the new ones with them.
    this.stop()

    const wid = req.embed ? this.hooks.embedTarget() : null
    const embedded = wid !== null
    if (req.embed && !embedded) log('warn', 'mpv', 'Built-in player asked for, but the window handle was unavailable; using a separate window')

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
        '--no-window-dragging'
      )
    } else {
      args.push('--fullscreen', '--osd-bar=yes', '--osd-font-size=32', '--osd-color=#DDDDDD', '--osd-border-size=1')
    }
    if (req.bufferSeconds && req.bufferSeconds > 0) {
      const secs = Math.round(req.bufferSeconds)
      args.push('--cache=yes', `--cache-secs=${secs}`, `--demuxer-max-bytes=${bufferMiB(secs)}MiB`)
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
        // stderr is kept so a failed start can say what mpv complained about; dev mode logs stdout too.
        proc = spawn(mpv, args, { stdio: ['ignore', dev ? 'pipe' : 'ignore', 'pipe'], windowsHide: false })
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
    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-4000)
    })
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
      this.finish(spawnError, code ? lastError(stderr) : undefined)
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

  private finish(error?: string, mpvError?: string) {
    log(error || mpvError ? 'error' : 'info', 'player', `Playback ended at ${Math.round(this.progress.position)} of ${Math.round(this.progress.duration)} s`, error ?? mpvError)
    // Clear the state first: onEnded may start the same stream again in mpv's own window.
    this.pushState({ ...idleState })
    this.hooks.onEnded({ ...this.progress, error, mpvError })
  }

  /** Sends one mpv command; ignored when nothing is playing. */
  command(...cmd: (string | number | boolean)[]) {
    const socket = this.socket
    if (!socket || socket.destroyed) return
    socket.write(JSON.stringify({ command: cmd, request_id: this.nextRequestId++ }) + '\n')
  }

  /** Asks mpv for one property; resolves to undefined if it isn't available or mpv doesn't answer. */
  private getProperty(name: string): Promise<unknown> {
    const socket = this.socket
    if (!socket || socket.destroyed) return Promise.resolve(undefined)
    const id = this.nextRequestId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(undefined)
      }, 1000)
      this.pending.set(id, (data) => {
        clearTimeout(timer)
        resolve(data)
      })
      socket.write(JSON.stringify({ command: ['get_property', name], request_id: id }) + '\n')
    })
  }

  /** Buffer and frame numbers, read on demand so nothing is polled while the panel is off. */
  async stats(): Promise<PlayerStats | null> {
    if (!this.socket || this.socket.destroyed) return null
    const names = [
      'demuxer-cache-duration',
      'demuxer-cache-state',
      'cache-speed',
      'cache-secs',
      'demuxer-max-bytes',
      'paused-for-cache',
      'cache-buffering-state',
      'decoder-frame-drop-count',
      'frame-drop-count'
    ] as const
    const values = await Promise.all(names.map((n) => this.getProperty(n)))
    const got = Object.fromEntries(names.map((n, i) => [n, values[i]])) as Record<(typeof names)[number], unknown>
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const cache = (got['demuxer-cache-state'] ?? {}) as { 'fw-bytes'?: unknown; 'total-bytes'?: unknown; eof?: unknown; idle?: unknown; 'eof-cached'?: unknown }
    const limitSeconds = num(got['cache-secs'])
    return {
      ahead: num(got['demuxer-cache-duration']),
      // mpv's default is "very high" (hours), which isn't a limit worth showing.
      limitSeconds: limitSeconds !== null && limitSeconds < 24 * 3600 ? limitSeconds : null,
      aheadBytes: num(cache['fw-bytes']),
      totalBytes: num(cache['total-bytes']),
      limitBytes: num(got['demuxer-max-bytes']),
      speed: num(got['cache-speed']),
      fill: cache.eof === true || cache['eof-cached'] === true ? 'complete' : cache.idle === true ? 'full' : cache.idle === false ? 'filling' : null,
      resumePercent: got['paused-for-cache'] === true ? num(got['cache-buffering-state']) : null,
      droppedDecoder: num(got['decoder-frame-drop-count']),
      droppedOutput: num(got['frame-drop-count'])
    }
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
        let msg: { event?: string; name?: string; data?: unknown; request_id?: number; error?: string }
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.request_id !== undefined && this.pending.has(msg.request_id)) {
          const done = this.pending.get(msg.request_id)!
          this.pending.delete(msg.request_id)
          done(msg.error === 'success' ? msg.data : undefined)
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
