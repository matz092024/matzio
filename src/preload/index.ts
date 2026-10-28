import { contextBridge, ipcRenderer } from 'electron'

export interface PlayRequest {
  key: string
  url: string
  title: string
  start?: number
  startPercent?: number
  headers?: Record<string, string>
  mpvPath?: string
  /** Draw inside the Matzio window instead of mpv's own window. */
  embed?: boolean
  /** Most seconds to buffer ahead. */
  bufferSeconds?: number
  tracks?: TrackPrefs
}

export interface TrackPrefs {
  audioLang: string
  subLang: string
  subsForeignOnly: boolean
  avoidSdh: boolean
}

export interface TrackChoice {
  kind: 'audio' | 'sub'
  lang: string | null
}

export interface PlayerStats {
  ahead: number | null
  limitSeconds: number | null
  aheadBytes: number | null
  totalBytes: number | null
  limitBytes: number | null
  speed: number | null
  fill: 'filling' | 'full' | 'complete' | null
  resumePercent: number | null
  droppedDecoder: number | null
  droppedOutput: number | null
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
  buffering: boolean
  tracks: PlayerTrack[]
}

export interface TraktStatus {
  configured: boolean
  builtIn: boolean
  username: string | null
  pending: number
  pulledAt: string | null
}

export interface TraktWatchedItem {
  type: 'movie' | 'series'
  id: string
  season?: number
  episode?: number
  watchedAt: string
}

export interface TraktProgressItem {
  type: 'movie' | 'series'
  id: string
  season?: number
  episode?: number
  progress: number
}

export interface TraktImportedEntry {
  videoId: string
  metaId: string
  type: 'movie' | 'series'
  name: string
  poster?: string
  background?: string
  season?: number
  episode?: number
  episodeTitle?: string
  fraction: number
  runtime: number
  updatedAt: number
}

export interface TraktWatchlistTitle {
  id: string
  type: 'movie' | 'series'
  name: string
  poster?: string
  releaseInfo?: string
  addedAt: number
}

export type TraktLoginEvent =
  | { state: 'connected'; username: string | null }
  | { state: 'expired' | 'denied' | 'error'; message: string }

export type ArtService = 'tmdb' | 'fanart'

export interface ServiceStatus {
  set: boolean
  hint: string
  state: 'unset' | 'ok' | 'invalid' | 'unknown'
  checkedAt: string | null
}

export type ConnectionsStatus = Record<ArtService, ServiceStatus>

export type UpdateStatus =
  | { state: 'unsupported' }
  | { state: 'idle' | 'checking' | 'up-to-date' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

function subscribe<T>(channel: string, cb: (value: T) => void) {
  const listener = (_: unknown, value: T) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api = {
  platform: process.platform,
  storage: {
    /** Everything saved on disk. Synchronous so data is ready before the first render. */
    load: (): Record<string, unknown> => ipcRenderer.sendSync('store:load'),
    write: (key: string, value: unknown) => ipcRenderer.send('store:write', key, value)
  },
  cache: {
    get: (key: string): Promise<unknown> => ipcRenderer.invoke('cache:get', key),
    set: (key: string, value: unknown) => ipcRenderer.send('cache:set', key, value)
  },
  player: {
    play: (req: PlayRequest): Promise<{ ok: true; embedded: boolean } | { ok: false; error: string }> => ipcRenderer.invoke('player:play', req),
    stop: (): Promise<void> => ipcRenderer.invoke('player:stop'),
    /** State of whatever is playing now, for a window that just opened. */
    state: (): Promise<PlayerState> => ipcRenderer.invoke('player:state'),
    /** Buffer numbers for the info panel; null when nothing is playing. */
    stats: (): Promise<PlayerStats | null> => ipcRenderer.invoke('player:stats'),
    setPaused: (paused: boolean) => ipcRenderer.send('player:paused', paused),
    seekTo: (seconds: number) => ipcRenderer.send('player:seek-to', seconds),
    seekBy: (seconds: number) => ipcRenderer.send('player:seek-by', seconds),
    setVolume: (volume: number) => ipcRenderer.send('player:volume', volume),
    setMuted: (muted: boolean) => ipcRenderer.send('player:muted', muted),
    setTrack: (kind: 'audio' | 'sub', id: number) => ipcRenderer.send('player:track', kind, id),
    /** How often the position is reported (and saved), in seconds. */
    setProgressInterval: (seconds: number) => ipcRenderer.send('player:progress-interval', seconds),
    onState: (cb: (s: PlayerState) => void) => subscribe('player:state', cb),
    onNotice: (cb: (text: string) => void) => subscribe('player:notice', cb),
    /** A track picked by hand in the player, to remember its language. */
    onTrackChoice: (cb: (c: TrackChoice) => void) => subscribe('player:track-choice', cb),
    detect: (customPath?: string): Promise<{ path: string | null; customOk: boolean | null }> => ipcRenderer.invoke('player:detect', customPath),
    browse: (): Promise<string | null> => ipcRenderer.invoke('player:browse'),
    onProgress: (cb: (p: PlayerProgress) => void) => subscribe('player:progress', cb),
    onEnded: (cb: (p: PlayerProgress & { error?: string }) => void) => subscribe('player:ended', cb)
  },
  trakt: {
    status: (): Promise<TraktStatus> => ipcRenderer.invoke('trakt:status'),
    setApp: (clientId: string, clientSecret: string): Promise<TraktStatus> => ipcRenderer.invoke('trakt:set-app', clientId, clientSecret),
    login: (): Promise<{ ok: true; userCode: string; verificationUrl: string; expiresIn: number } | { ok: false; error: string }> =>
      ipcRenderer.invoke('trakt:login'),
    cancelLogin: (): Promise<void> => ipcRenderer.invoke('trakt:cancel-login'),
    disconnect: (): Promise<TraktStatus> => ipcRenderer.invoke('trakt:disconnect'),
    markWatched: (item: TraktWatchedItem): Promise<void> => ipcRenderer.invoke('trakt:watched', item),
    saveProgress: (item: TraktProgressItem) => ipcRenderer.send('trakt:progress', item),
    /** Your Trakt history and resume points; entries is null when nothing changed since the last pull. */
    pull: (force?: boolean): Promise<{ ok: true; entries: TraktImportedEntry[] | null } | { ok: false; error: string }> => ipcRenderer.invoke('trakt:pull', force),
    /** Repeats a Watchlist add or removal on your Trakt watchlist (queued while offline). */
    updateWatchlist: (change: { type: 'movie' | 'series'; id: string; add: boolean }) => ipcRenderer.send('trakt:watchlist', change),
    /** What to add to and remove from the Watchlist to match Trakt; changes is null when nothing changed since the last pull. */
    pullWatchlist: (
      local: { id: string; type: string }[],
      force?: boolean
    ): Promise<{ ok: true; changes: { add: TraktWatchlistTitle[]; remove: string[] } | null } | { ok: false; error: string }> =>
      ipcRenderer.invoke('trakt:pull-watchlist', local, force),
    onStatus: (cb: (s: TraktStatus) => void) => subscribe('trakt:status', cb),
    onLoginResult: (cb: (e: TraktLoginEvent) => void) => subscribe('trakt:login-result', cb)
  },
  connections: {
    status: (): Promise<ConnectionsStatus> => ipcRenderer.invoke('connections:status'),
    /** Checks the key with the service and saves it unless it was refused. */
    set: (service: ArtService, key: string): Promise<{ ok: true; status: ConnectionsStatus } | { ok: false; error: string; status: ConnectionsStatus }> =>
      ipcRenderer.invoke('connections:set', service, key),
    remove: (service: ArtService): Promise<ConnectionsStatus> => ipcRenderer.invoke('connections:remove', service),
    /** Checks every saved key again. */
    check: (): Promise<ConnectionsStatus> => ipcRenderer.invoke('connections:check')
  },
  updates: {
    status: (): Promise<{ version: string; status: UpdateStatus }> => ipcRenderer.invoke('update:status'),
    check: (): Promise<void> => ipcRenderer.invoke('update:check'),
    /** Restarts Matzio into the downloaded version. */
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onStatus: (cb: (s: UpdateStatus) => void) => subscribe('update:status', cb)
  },
  devlog: {
    setEnabled: (on: boolean) => ipcRenderer.send('devlog:set-enabled', on),
    /** Dropped unless dev mode is on. */
    write: (level: 'info' | 'warn' | 'error', scope: string, message: string, data?: unknown) => ipcRenderer.send('devlog:write', level, scope, message, data),
    info: (): Promise<{ enabled: boolean; folder: string; size: number }> => ipcRenderer.invoke('devlog:info'),
    openFolder: (): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke('devlog:open-folder'),
    copy: (): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> => ipcRenderer.invoke('devlog:copy'),
    clear: (): Promise<void> => ipcRenderer.invoke('devlog:clear')
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    setFullscreen: (full?: boolean) => ipcRenderer.send('player:fullscreen', full),
    isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:is-fullscreen'),
    onFullscreenChange: (cb: (full: boolean) => void) => subscribe('window:fullscreen', cb),
    onMaximizedChange: (cb: (maximized: boolean) => void) => {
      const listener = (_: unknown, value: boolean) => cb(value)
      ipcRenderer.on('window:maximized', listener)
      return () => {
        ipcRenderer.removeListener('window:maximized', listener)
      }
    }
  }
}

export type MatzioApi = typeof api

contextBridge.exposeInMainWorld('matzio', api)
