import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export interface Settings {
  /** Lowers overall brightness and contrast for late-night watching. */
  nightDim: boolean
  /** Turns off transitions and hover motion. */
  reduceMotion: boolean
  /** How strong the frosted glass blur is. */
  glass: 'subtle' | 'normal' | 'strong'
  /** What the Play button does when a title has several streams. */
  quickPlay: 'first' | 'ask'
}

const defaults: Settings = {
  nightDim: false,
  reduceMotion: false,
  glass: 'normal',
  quickPlay: 'first'
}

const STORAGE_KEY = 'matzio.settings'

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults
  } catch {
    return defaults
  }
}

const SettingsContext = createContext<{
  settings: Settings
  update: (patch: Partial<Settings>) => void
} | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Storage can be unavailable; settings then last for this session only.
    }
    const root = document.documentElement
    root.dataset.night = String(settings.nightDim)
    root.dataset.motion = settings.reduceMotion ? 'reduce' : 'full'
    root.dataset.glass = settings.glass
  }, [settings])

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }))

  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
