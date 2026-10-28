import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { PlayerState, PlayerTrack } from '../../../preload'
import {
  AudioIcon,
  CloseIcon,
  ExpandIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  ShrinkIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SubtitlesIcon,
  VolumeIcon
} from '../components/Icons'
import { useSettings } from '../settings'
import BufferPanel from './BufferPanel'

const HIDE_AFTER = 2800

function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const s = Math.floor(seconds % 60)
  const m = Math.floor((seconds / 60) % 60)
  const h = Math.floor(seconds / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

const empty: PlayerState = {
  active: false,
  embedded: true,
  key: '',
  title: '',
  paused: false,
  position: 0,
  duration: 0,
  volume: 100,
  muted: false,
  buffering: true,
  tracks: []
}

function TrackMenu({
  label,
  icon,
  tracks,
  offLabel,
  onPick
}: {
  label: string
  icon: React.ReactNode
  tracks: PlayerTrack[]
  offLabel?: string
  onPick: (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  if (tracks.length === 0 && !offLabel) return null
  const selected = tracks.find((t) => t.selected)

  return (
    <div className="pl-menu-wrap" ref={box} data-open={open || undefined}>
      <button className="pl-btn" aria-label={label} aria-expanded={open} title={label} onClick={() => setOpen((o) => !o)}>
        {icon}
      </button>
      {open && (
        <div className="pl-menu glass" role="menu">
          <div className="pl-menu-title">{label}</div>
          {offLabel && (
            <button role="menuitemradio" aria-checked={!selected} className={!selected ? 'active' : ''} onClick={() => { onPick(-1); setOpen(false) }}>
              {offLabel}
            </button>
          )}
          {tracks.map((t, i) => (
            <Fragment key={t.id}>
              {t.addon && !tracks[i - 1]?.addon && <div className="pl-menu-title pl-menu-section">From addons</div>}
              <button
                role="menuitemradio"
                aria-checked={t.selected}
                className={t.selected ? 'active' : ''}
                onClick={() => { onPick(t.id); setOpen(false) }}
              >
                {t.label}
              </button>
            </Fragment>
          ))}
          {tracks.length === 0 && <div className="pl-menu-empty">Nothing here for this file.</div>}
        </div>
      )}
    </div>
  )
}

/**
 * The controls drawn over the embedded mpv surface. This runs in its own transparent
 * window pinned over the app window, because mpv paints above the web page.
 */
export default function PlayerOverlay() {
  const player = window.matzio?.player
  const [state, setState] = useState<PlayerState>(empty)
  const [fullscreen, setFullscreen] = useState(false)
  const [visible, setVisible] = useState(true)
  const [scrub, setScrub] = useState<number | null>(null)
  const { settings } = useSettings()
  // Starts from the Settings toggle; I flips it for this video only.
  const [showStats, setShowStats] = useState(settings.bufferInfo)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menuOpen = useRef(false)

  useEffect(() => {
    if (!player) return
    player.state().then(setState)
    return player.onState(setState)
  }, [player])

  useEffect(() => {
    const win = window.matzio?.window
    if (!win) return
    win.isFullscreen().then(setFullscreen)
    return win.onFullscreenChange(setFullscreen)
  }, [])

  const wake = useCallback(() => {
    setVisible(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      // Controls stay put while paused, while scrubbing, or with a menu open.
      if (menuOpen.current) return wake()
      setVisible(false)
    }, HIDE_AFTER)
  }, [])

  useEffect(() => {
    wake()
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [wake])

  const keepVisible = state.paused || state.buffering || scrub !== null
  const showing = visible || keepVisible

  const position = scrub ?? state.position
  const duration = state.duration

  const togglePause = useCallback(() => player?.setPaused(!state.paused), [player, state.paused])
  const close = useCallback(() => player?.stop(), [player])
  const toggleFullscreen = useCallback(() => window.matzio?.window.setFullscreen(!fullscreen), [fullscreen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) {
        // Let the scrubber and volume slider handle their own arrow keys.
        if (e.key.startsWith('Arrow')) return
      }
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault()
          togglePause()
          break
        case 'ArrowRight':
          player?.seekBy(e.shiftKey ? 60 : 10)
          break
        case 'ArrowLeft':
          player?.seekBy(e.shiftKey ? -60 : -10)
          break
        case 'ArrowUp':
          player?.setVolume(Math.min(100, state.volume + 5))
          break
        case 'ArrowDown':
          player?.setVolume(Math.max(0, state.volume - 5))
          break
        case 'm':
        case 'M':
          player?.setMuted(!state.muted)
          break
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        case 'Escape':
          if (fullscreen) window.matzio?.window.setFullscreen(false)
          else close()
          break
        case 'q':
        case 'Q':
          close()
          break
        case 'i':
        case 'I':
          setShowStats((v) => !v)
          break
      }
      wake()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, fullscreen, player, state.muted, state.volume, togglePause, toggleFullscreen, wake])

  return (
    <>
      {showStats && state.active && <BufferPanel />}
      <div
        className={`pl ${showing ? 'pl-show' : 'pl-hide'}`}
        onMouseMove={wake}
        onDoubleClick={toggleFullscreen}
        onClick={(e) => {
          if (e.target === e.currentTarget) togglePause()
        }}
      >
        <div className="pl-top">
          <button className="pl-btn pl-back" onClick={close} aria-label="Close the player" title="Close the player (Esc)">
            <CloseIcon width={18} height={18} />
          </button>
          <div className="pl-title" title={state.title}>{state.title}</div>
        </div>

        {state.buffering && (
          <div className="pl-center" aria-live="polite">
            <span className="spinner spinner-lg" aria-hidden />
            <span className="pl-center-text">Buffering…</span>
          </div>
        )}
        {!state.buffering && state.paused && (
          <div className="pl-center pl-center-quiet" aria-hidden>
            <PauseIcon width={34} height={34} />
          </div>
        )}

        <div className="pl-bottom">
          <div className="pl-scrub">
            <span className="pl-time">{clock(position)}</span>
            <input
              className="pl-range"
              type="range"
              min={0}
              max={Math.max(1, Math.floor(duration))}
              step={1}
              value={Math.min(position, Math.max(1, duration))}
              aria-label="Position"
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={() => {
                if (scrub !== null) player?.seekTo(scrub)
                setScrub(null)
              }}
              onKeyUp={() => {
                if (scrub !== null) player?.seekTo(scrub)
                setScrub(null)
              }}
              style={{ ['--pl-progress' as string]: `${duration > 0 ? (position / duration) * 100 : 0}%` }}
              disabled={duration <= 0}
            />
            <span className="pl-time">{duration > 0 ? `−${clock(duration - position)}` : '--:--'}</span>
          </div>

          <div className="pl-row">
            <button className="pl-btn pl-play" onClick={togglePause} aria-label={state.paused ? 'Play' : 'Pause'} title="Play or pause (Space)">
              {state.paused ? <PlayIcon width={20} height={20} /> : <PauseIcon width={20} height={20} />}
            </button>
            <button className="pl-btn" onClick={() => player?.seekBy(-10)} aria-label="Back 10 seconds" title="Back 10 seconds (←)">
              <SkipBackIcon width={19} height={19} />
            </button>
            <button className="pl-btn" onClick={() => player?.seekBy(10)} aria-label="Forward 10 seconds" title="Forward 10 seconds (→)">
              <SkipForwardIcon width={19} height={19} />
            </button>

            <div className="pl-volume">
              <button className="pl-btn" onClick={() => player?.setMuted(!state.muted)} aria-label={state.muted ? 'Unmute' : 'Mute'} title="Mute (M)">
                {state.muted || state.volume === 0 ? <MuteIcon width={19} height={19} /> : <VolumeIcon width={19} height={19} />}
              </button>
              <input
                className="pl-range pl-range-sm"
                type="range"
                min={0}
                max={100}
                step={1}
                value={state.muted ? 0 : state.volume}
                aria-label="Volume"
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (state.muted && v > 0) player?.setMuted(false)
                  player?.setVolume(v)
                }}
                style={{ ['--pl-progress' as string]: `${state.muted ? 0 : Math.min(100, state.volume)}%` }}
              />
            </div>

            <div className="pl-spacer" />

            <div
              className="pl-tracks"
              onMouseEnter={() => (menuOpen.current = true)}
              onMouseLeave={() => (menuOpen.current = false)}
            >
              <TrackMenu
                label="Subtitles"
                icon={<SubtitlesIcon width={19} height={19} />}
                tracks={state.tracks.filter((t) => t.kind === 'sub')}
                offLabel="Off"
                onPick={(id) => player?.setTrack('sub', id)}
              />
              <TrackMenu
                label="Audio"
                icon={<AudioIcon width={19} height={19} />}
                tracks={state.tracks.filter((t) => t.kind === 'audio')}
                onPick={(id) => player?.setTrack('audio', id)}
              />
            </div>
            <button className="pl-btn" onClick={toggleFullscreen} aria-label={fullscreen ? 'Leave full screen' : 'Full screen'} title="Full screen (F)">
              {fullscreen ? <ShrinkIcon width={19} height={19} /> : <ExpandIcon width={19} height={19} />}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
