import { app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { statSync } from 'fs'
import { connect, type Socket } from 'net'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import { isDevMode, log } from './devlog'
import { langCodes, normalizeLang } from '../shared/languages'

export interface PlayRequest {
  /** Echoed back with progress so the app knows which video it belongs to. */
  key: string
  url: string
  title: string
  /** Seconds to resume from. */
  start?: number
  /** Percent to resume from, used when only Trakt's percentage is known. */
  startPercent?: number
  /** Extra HTTP headers some addons require (behaviorHints.proxyHeaders.request). */
  headers?: Record<string, string>
  /** Path the user set in Settings; empty means auto-detect. */
  mpvPath?: string
  /** Draw inside the Matzio window instead of mpv's own window. */
  embed?: boolean
  /** Most seconds to buffer ahead (Settings → Buffer ahead). Left out, mpv's defaults apply. */
  bufferSeconds?: number
  /** Which audio and subtitle tracks to start with (Settings → Audio and subtitles). */
  tracks?: TrackPrefs
}

export interface TrackPrefs {
  /** Two-letter code; empty plays the file's default audio. */
  audioLang: string
  /** Two-letter code, 'off' for no subtitles, or empty for the file's default. */
  subLang: string
  /** Leave subtitles off when the audio is already in the subtitle language (forced ones still show). */
  subsForeignOnly: boolean
  /** Prefer a regular subtitle track over an SDH one in the same language. */
  avoidSdh: boolean
}

/** A track picked by hand in the player's menus, so the app can remember the language. */
export interface TrackChoice {
  kind: 'audio' | 'sub'
  /** Two-letter code where known; null when the track has no language, 'off' for subtitles off. */
  lang: string | null
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
  default?: boolean
  forced?: boolean
  'hearing-impaired'?: boolean
  'visual-impaired'?: boolean
  'demux-channel-count'?: number
}

/** Most files don't set mpv's hearing-impaired flag, so the track name is checked too. */
function isSdh(t: MpvTrack): boolean {
  return !!t['hearing-impaired'] || /\b(sdh|cc|hi|hoh)\b|hearing|deaf|closed caption/i.test(t.title ?? '')
}

/** Commentary and audio description tracks, which shouldn't be what a title starts with. */
function isExtraAudio(t: MpvTrack): boolean {
  return !!t['visual-impaired'] || /commentary|descriptive|audio description|\bad\b/i.test(t.title ?? '')
}

/**
 * Corrects mpv's own pick (from --alang/--slang) once a video has loaded: the main audio over
 * commentary or description, full subtitles in the chosen language, regular ones over SDH.
 * Returns the track ids to switch to (-1 turns subtitles off), and whether SDH cues should be
 * stripped from the subtitles that end up showing.
 */
export function refineTracks(list: MpvTrack[], prefs: TrackPrefs): { aid?: number; sid?: number; filterSdh: boolean } {
  const audio = list.filter((t) => t.type === 'audio' && typeof t.id === 'number')
  const subs = list.filter((t) => t.type === 'sub' && typeof t.id === 'number')
  const out: { aid?: number; sid?: number; filterSdh: boolean } = { filterSdh: false }
  // Same language, flagged default first, then file order.
  const best = (tracks: MpvTrack[]) => [...tracks].sort((a, b) => Number(!!b.default) - Number(!!a.default) || a.id! - b.id!)[0]

  let playing = audio.find((t) => t.selected)
  if (playing && isExtraAudio(playing)) {
    const alt = best(audio.filter((t) => !isExtraAudio(t) && normalizeLang(t.lang) === normalizeLang(playing!.lang)))
    if (alt) {
      out.aid = alt.id
      playing = alt
    }
  }

  if (prefs.subLang === 'off') return out
  const shown = subs.find((t) => t.selected)
  // Lower is better: full subtitles over forced-only ones, regular over SDH, then the file's default.
  const rank = (t: MpvTrack) => (t.forced ? 4 : 0) + (prefs.avoidSdh && isSdh(t) ? 2 : 0) + (t.default ? 0 : 1)
  const pick = (tracks: MpvTrack[]) => [...tracks].sort((a, b) => rank(a) - rank(b) || a.id! - b.id!)[0]
  const switchTo = (t: MpvTrack | undefined) => {
    const id = t?.id ?? -1
    if (id !== (shown?.id ?? -1)) out.sid = id
    out.filterSdh = !!t && prefs.avoidSdh && isSdh(t)
  }

  // mpv versions differ in how they weigh forced and default tracks against the language, so with a
  // language set the choice is made here, the same on every mpv.
  const inLang = prefs.subLang ? subs.filter((t) => normalizeLang(t.lang) === prefs.subLang) : []
  if (inLang.length) {
    if (prefs.subsForeignOnly && playing && normalizeLang(playing.lang) === prefs.subLang) {
      // The audio is already in that language: only forced subtitles, for signs and foreign-language lines.
      switchTo(pick(inLang.filter((t) => t.forced)))
    } else {
      switchTo(pick(inLang))
    }
  } else if (shown && prefs.avoidSdh && isSdh(shown)) {
    // No track in the chosen language, so mpv's pick stands, minus SDH where there's a regular one.
    switchTo(pick(subs.filter((t) => normalizeLang(t.lang) === normalizeLang(shown.lang) && !!t.forced === !!shown.forced)))
  }
  return out
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
  /** How often the position is reported for saving, in ms (Settings → Save progress every). */
  private progressEvery = 5000
  /** Track preferences for the current video, and whether they've been applied to its track list yet. */
  private prefs: TrackPrefs | null = null
  private tracksRefined = false
  /** The full track list from mpv, which has the flags refineTracks needs. */
  private rawTracks: MpvTrack[] = []

  constructor(
    private hooks: {
      onProgress: (p: PlayerProgress) => void
      onEnded: (p: PlayerProgress & { error?: string; mpvError?: string }) => void
      onState: (s: PlayerState) => void
      /** A track picked by hand in the player's menus. */
      onTrackChoice?: (c: TrackChoice) => void
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
    this.prefs = req.tracks ?? null
    this.tracksRefined = false
    this.rawTracks = []

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
    const prefs = req.tracks
    if (prefs?.audioLang) args.push(`--alang=${langCodes(prefs.audioLang).join(',')}`)
    if (prefs?.subLang === 'off') args.push('--sid=no')
    else if (prefs?.subLang) {
      args.push(`--slang=${langCodes(prefs.subLang).join(',')}`, `--subs-with-matching-audio=${prefs.subsForeignOnly ? 'no' : 'yes'}`)
    }
    if (req.start && req.start > 5) args.push(`--start=${Math.floor(req.start)}`)
    // A resume point from Trakt is a percentage, since the stream's exact length isn't known before it opens.
    else if (req.startPercent && req.startPercent > 0 && req.startPercent < 100) args.push(`--start=${req.startPercent.toFixed(2)}%`)
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

  setProgressInterval(seconds: number) {
    if (Number.isFinite(seconds)) this.progressEvery = Math.min(300, Math.max(1, seconds)) * 1000
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

  /** A pick from the player's menus. `id` of -1 turns subtitles off. */
  setTrack(kind: 'audio' | 'sub', id: number) {
    this.selectTrack(kind, id)
    // Picked by hand, so an SDH track shows as it is.
    if (kind === 'sub') this.command('set_property', 'sub-filter-sdh', false)
    const raw = this.rawTracks.find((t) => t.id === id && t.type === kind)
    const lang = id < 0 ? 'off' : raw?.lang ? normalizeLang(raw.lang) : null
    log('info', 'player', `Picked ${kind} track ${id < 0 ? 'off' : id}`, { lang })
    this.hooks.onTrackChoice?.({ kind, lang })
  }

  private selectTrack(kind: 'audio' | 'sub', id: number) {
    this.command('set_property', kind === 'audio' ? 'aid' : 'sid', id < 0 ? 'no' : id)
    this.pushState({
      tracks: this.state.tracks.map((t) => (t.kind === kind ? { ...t, selected: t.id === id } : t))
    })
  }

  /** Once per video, after mpv has made its own pick: swap SDH, commentary and the like for the main track. */
  private refine(list: MpvTrack[]) {
    if (this.tracksRefined || !this.prefs) return
    if (!list.some((t) => t.type === 'audio' || t.type === 'sub')) return
    this.tracksRefined = true
    const r = refineTracks(list, this.prefs)
    log('info', 'player', 'Track preferences applied', {
      prefs: this.prefs,
      picked: list.filter((t) => t.selected).map((t) => `${t.type} ${t.id} ${t.lang ?? ''} ${t.title ?? ''}`.trim()),
      switchAudio: r.aid,
      switchSub: r.sid,
      filterSdh: r.filterSdh
    })
    if (r.aid !== undefined) this.selectTrack('audio', r.aid)
    if (r.sid !== undefined) this.selectTrack('sub', r.sid)
    // Only SDH subtitles in that language: keep them, without the [door creaks] lines.
    if (r.filterSdh) this.command('set_property', 'sub-filter-sdh', true)
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
      // A quick local file can finish loading before the pipe connects, missing file-loaded.
      this.getProperty('track-list').then((list) => {
        if (Array.isArray(list) && (list as MpvTrack[]).some((t) => t.selected)) this.refine(list as MpvTrack[])
      })
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
        // mpv has picked its tracks by now, so the preferences can refine that pick.
        if (msg.event === 'file-loaded') {
          this.getProperty('track-list').then((list) => Array.isArray(list) && this.refine(list as MpvTrack[]))
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
          this.rawTracks = data as MpvTrack[]
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
        if (now - lastSaved >= this.progressEvery) {
          lastSaved = now
          this.hooks.onProgress({ ...this.progress })
        }
      }
    })
  }
}
