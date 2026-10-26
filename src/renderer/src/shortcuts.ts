import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSettings } from './settings'

/** Shown in Settings. Each entry lists the alternative keys for one action. */
export const shortcutList: [keys: string[], action: string][] = [
  [['P'], 'Play (on a title page)'],
  [['/', 'Ctrl + F'], 'Search'],
  [['1', '2', '3'], 'Home, Discover, Library'],
  [['Ctrl + ,'], 'Settings'],
  [['N'], 'Night dim on or off'],
  [['Alt + ←', 'Backspace'], 'Back'],
  [['Esc'], 'Close the stream list']
]

/** Keys the embedded player handles while something is playing. */
export const playerShortcutList: [keys: string[], action: string][] = [
  [['Space', 'K'], 'Pause or resume'],
  [['←', '→'], 'Skip 10 seconds'],
  [['Shift + ←', 'Shift + →'], 'Skip a minute'],
  [['↑', '↓'], 'Volume'],
  [['M'], 'Mute'],
  [['F'], 'Full screen'],
  [['I'], 'Buffer info on or off'],
  [['Esc', 'Q'], 'Close the player']
]

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export function useShortcuts() {
  const navigate = useNavigate()
  const { settings, update } = useSettings()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const ctrl = e.ctrlKey || e.metaKey

      if (ctrl && e.key === ',') return e.preventDefault(), navigate('/settings')
      if (ctrl && e.key.toLowerCase() === 'f') return e.preventDefault(), navigate('/discover', { state: { focusSearch: true } })
      if (e.altKey && e.key === 'ArrowLeft') return e.preventDefault(), navigate(-1)
      if (isTyping(e.target) || ctrl || e.altKey || document.querySelector('.sheet')) return

      switch (e.key) {
        case '/':
          e.preventDefault()
          navigate('/discover', { state: { focusSearch: true } })
          break
        case '1':
          navigate('/')
          break
        case '2':
          navigate('/discover')
          break
        case '3':
          navigate('/library')
          break
        case 'n':
        case 'N':
          update({ nightDim: !settings.nightDim })
          break
        case 'p':
        case 'P':
          document.querySelector<HTMLButtonElement>('[data-shortcut="play"]:not(:disabled)')?.click()
          break
        case 'Backspace':
          e.preventDefault()
          navigate(-1)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, settings.nightDim, update])
}
