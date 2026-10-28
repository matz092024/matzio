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
  /** If the built-in player fails to start, try the same stream again in mpv's own window. */
  playerFallback: boolean
  /** Where mpv lives; empty means find it automatically. */
  mpvPath: string
  /** How often, in seconds, your place in a movie or episode is saved (and sent to Trakt). */
  progressInterval: number
  /** Most seconds of video mpv buffers ahead of the playhead. */
  bufferSeconds: number
  /** Show buffer numbers over the built-in player. */
  bufferInfo: boolean
  /** Preferred audio language (two-letter code); empty plays the file's default. */
  audioLang: string
  /** Preferred subtitle language; 'off' for none, empty for the file's default. */
  subLang: string
  /** Only show subtitles when the audio is in another language. */
  subsForeignOnly: boolean
  /** Skip SDH subtitles when a regular track in the same language exists. */
  avoidSdh: boolean
  /** Keep a log of errors and playback details to send with bug reports. */
  devMode: boolean
}

const defaults: Settings = {
  nightDim: false,
  reduceMotion: false,
  glass: 'normal',
  quickPlay: 'first',
  playerMode: 'integrated',
  playerFallback: true,
  mpvPath: '',
  progressInterval: 5,
  bufferSeconds: 60,
  bufferInfo: false,
  audioLang: '',
  subLang: '',
  subsForeignOnly: false,
  avoidSdh: true,
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

  // Picking a track in the player makes its language the new preference.
  useEffect(() => {
    if (!persist) return
    return window.matzio?.player.onTrackChoice((c) => {
      if (c.kind === 'audio' && c.lang) setSettings((s) => ({ ...s, audioLang: c.lang! }))
      // Turning subtitles off is often just for this video, so that isn't remembered.
      if (c.kind === 'sub' && c.lang && c.lang !== 'off') setSettings((s) => ({ ...s, subLang: c.lang! }))
    })
  }, [persist])

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }))

  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
