import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { readJson, writeJson } from './storage'

export interface Settings {
  /** Lowers overall brightness and contrast for late-night watching. */
  nightDim: boolean
  /** Turns off transitions and hover motion. */
  reduceMotion: boolean
  /** How strong the frosted glass blur is. */
  glass: 'subtle' | 'normal' | 'strong'
  /** What the Play button does when a title has several streams. */
  quickPlay: 'first' | 'ask'
  /** Play inside the Matzio window, or hand the stream to mpv's own window. */
  playerMode: 'integrated' | 'external'
  /** Where mpv lives; empty means find it automatically. */
  mpvPath: string
  /** Keep a log of errors and playback details to send with bug reports. */
  devMode: boolean
}

const defaults: Settings = {
  nightDim: false,
  reduceMotion: false,
  glass: 'normal',
  quickPlay: 'first',
  playerMode: 'integrated',
  mpvPath: '',
  devMode: false
}

const STORAGE_KEY = 'matzio.settings'

function load(): Settings {
  return { ...defaults, ...readJson<Partial<Settings>>(STORAGE_KEY, {}) }
}

const SettingsContext = createContext<{
  settings: Settings
  update: (patch: Partial<Settings>) => void
} | null>(null)

/** `persist` is off in the player overlay window, which only reads the theme. */
export function SettingsProvider({ children, persist = true }: { children: ReactNode; persist?: boolean }) {
  const [settings, setSettings] = useState<Settings>(load)

  useEffect(() => {
    if (persist) {
      writeJson(STORAGE_KEY, settings)
      window.matzio?.devlog.setEnabled(settings.devMode)
    }
    const root = document.documentElement
    root.dataset.night = String(settings.nightDim)
    root.dataset.motion = settings.reduceMotion ? 'reduce' : 'full'
    root.dataset.glass = settings.glass
  }, [settings, persist])

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }))

  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
