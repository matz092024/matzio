import { contextBridge, ipcRenderer } from 'electron'

export interface PlayRequest {
  key: string
  url: string
  title: string
  start?: number
  headers?: Record<string, string>
  mpvPath?: string
}

export interface PlayerProgress {
  key: string
  position: number
  duration: number
}

export interface TraktStatus {
  configured: boolean
  builtIn: boolean
  username: string | null
  pending: number
}

export interface TraktWatchedItem {
  type: 'movie' | 'series'
  id: string
  season?: number
  episode?: number
  watchedAt: string
}

export type TraktLoginEvent =
  | { state: 'connected'; username: string | null }
  | { state: 'expired' | 'denied' | 'error'; message: string }

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
    play: (req: PlayRequest): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke('player:play', req),
    stop: (): Promise<void> => ipcRenderer.invoke('player:stop'),
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
    onStatus: (cb: (s: TraktStatus) => void) => subscribe('trakt:status', cb),
    onLoginResult: (cb: (e: TraktLoginEvent) => void) => subscribe('trakt:login-result', cb)
  },
  updates: {
    status: (): Promise<{ version: string; status: UpdateStatus }> => ipcRenderer.invoke('update:status'),
    check: (): Promise<void> => ipcRenderer.invoke('update:check'),
    /** Restarts Matzio into the downloaded version. */
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onStatus: (cb: (s: UpdateStatus) => void) => subscribe('update:status', cb)
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
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
