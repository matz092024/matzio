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
  player: {
    play: (req: PlayRequest): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke('player:play', req),
    stop: (): Promise<void> => ipcRenderer.invoke('player:stop'),
    detect: (customPath?: string): Promise<{ path: string | null; customOk: boolean | null }> => ipcRenderer.invoke('player:detect', customPath),
    browse: (): Promise<string | null> => ipcRenderer.invoke('player:browse'),
    onProgress: (cb: (p: PlayerProgress) => void) => subscribe('player:progress', cb),
    onEnded: (cb: (p: PlayerProgress & { error?: string }) => void) => subscribe('player:ended', cb)
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
