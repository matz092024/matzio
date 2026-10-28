import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAddons } from './stremio/addons'
import { fetchMeta, fetchStreams, isPlayable, type AddonStream } from './stremio/client'
import type { MetaDetail, MetaPreview, Video } from './stremio/types'
import { fraction, isWatched, useProgress, type WatchEntry } from './progress'
import { useSettings } from './settings'
import StreamPicker from './components/StreamPicker'
import LoadingScreen from './components/LoadingScreen'
import { devlog } from './devlog'

const RESUME_MIN_SECONDS = 30

/** Regular episodes in viewing order, specials and unreleased ones left out. */
export function playableEpisodes(meta: MetaDetail): Video[] {
  const now = Date.now()
  return (meta.videos ?? [])
    .filter((v) => (v.season ?? 0) > 0 && (!v.released || new Date(v.released).getTime() <= now))
    .sort((a, b) => (a.season! - b.season!) || ((a.episode ?? 0) - (b.episode ?? 0)))
}

export function episodeLabel(v: Pick<Video, 'season' | 'episode'>) {
  return `S${v.season} · E${v.episode}`
}

/**
 * What Play should start for a series: the episode you're partway through,
 * otherwise the one after the last you finished, otherwise the first.
 */
export function nextUp(meta: MetaDetail, latest?: WatchEntry): { video: Video; resume: boolean } | null {
  const episodes = playableEpisodes(meta)
  if (episodes.length === 0) return null
  if (!latest) return { video: episodes[0], resume: false }
  const i = episodes.findIndex((v) => v.id === latest.videoId)
  if (i === -1) return { video: episodes[0], resume: false }
  if (!isWatched(latest)) return { video: episodes[i], resume: latest.position > RESUME_MIN_SECONDS }
  return episodes[i + 1] ? { video: episodes[i + 1], resume: false } : { video: episodes[i], resume: false }
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string }
  | { kind: 'playing'; text: string }
  | { kind: 'error'; text: string; settingsLink?: boolean }

interface Target {
  meta: MetaDetail
  video?: Video
}

interface PlaybackContextValue {
  /** Plays a movie, a specific episode, or (for a series with no episode given) whatever is next up. */
  play: (meta: MetaPreview | MetaDetail, video?: Video, options?: { choose?: boolean }) => Promise<void>
}

const PlaybackContext = createContext<PlaybackContextValue | null>(null)

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const { addons } = useAddons()
  const { settings } = useSettings()
  const progress = useProgress()
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [picker, setPicker] = useState<{ target: Target; streams: AddonStream[]; hidden: number } | null>(null)
  /** The title whose loading screen is up while streams are found and the player opens. */
  const [loading, setLoading] = useState<Target | null>(null)
  const request = useRef(0)

  const cancel = () => {
    request.current++
    setLoading(null)
    setStatus({ kind: 'idle' })
  }

  useEffect(() => {
    const player = window.matzio?.player
    if (!player) return
    const offEnded = player.onEnded((p) => {
      setStatus((s) => (s.kind === 'playing' || s.kind === 'busy' ? { kind: 'idle' } : s))
      if (p.error) devlog('error', 'playback', 'mpv reported an error', p.error)
      if (p.error) setStatus({ kind: 'error', text: `mpv couldn’t start: ${p.error}`, settingsLink: true })
    })
    // e.g. the built-in player couldn't draw into the window, so mpv opened on its own.
    const offNotice = player.onNotice((text) => setStatus({ kind: 'error', text }))
    return () => {
      offEnded()
      offNotice()
    }
  }, [])

  // Errors fade out on their own after a while.
  useEffect(() => {
    if (status.kind !== 'error' && status.kind !== 'playing') return
    const t = setTimeout(() => setStatus({ kind: 'idle' }), status.kind === 'error' ? 8000 : 4000)
    return () => clearTimeout(t)
  }, [status])

  const start = async (target: Target, stream: AddonStream & { url: string }, id = ++request.current) => {
    const stale = () => id !== request.current
    const player = window.matzio?.player
    if (!player) {
      setLoading(null)
      setStatus({ kind: 'error', text: 'Playback works in the desktop app.' })
      return
    }
    const { meta, video } = target
    const videoId = video?.id ?? meta.id
    const saved = progress.get(videoId)
    const resume = !!saved && !isWatched(saved) && saved.position > RESUME_MIN_SECONDS
    const startAt = resume && !saved.estimated ? saved.position : 0
    // A resume point from Trakt is only a percentage of the video, so mpv seeks to that percentage.
    const startPercent = resume && saved.estimated ? fraction(saved) * 100 : undefined
    const title = video ? `${meta.name} · ${episodeLabel(video)}${video.title ?? video.name ? ` · ${video.title ?? video.name}` : ''}` : meta.name

    progress.begin({
      videoId,
      metaId: meta.id,
      type: meta.type,
      name: meta.name,
      poster: meta.poster,
      background: meta.background,
      season: video?.season,
      episode: video?.episode,
      episodeTitle: video?.title ?? video?.name
    })
    setLoading(target)
    setStatus({ kind: 'busy', text: 'Opening player…' })
    devlog('info', 'playback', `Starting ${title}`, {
      addon: stream.addon,
      stream: stream.name ?? stream.title ?? '',
      resumeAt: startPercent ? `${startPercent.toFixed(1)}%` : Math.round(startAt),
      mode: settings.playerMode,
      fallback: settings.playerFallback,
      bufferSeconds: settings.bufferSeconds
    })
    const result = await player.play({
      key: videoId,
      url: stream.url,
      title,
      start: startAt,
      startPercent,
      headers: stream.behaviorHints?.proxyHeaders?.request,
      mpvPath: settings.mpvPath || undefined,
      embed: settings.playerMode !== 'external',
      fallback: settings.playerFallback,
      bufferSeconds: settings.bufferSeconds,
      tracks: {
        audioLang: settings.audioLang,
        subLang: settings.subLang,
        subsForeignOnly: settings.subsForeignOnly,
        avoidSdh: settings.avoidSdh
      }
    })
    if (stale()) {
      // Cancelled while mpv was starting.
      if (result.ok) player.stop()
      return
    }
    setLoading(null)
    if (!result.ok) devlog('error', 'playback', 'Couldn’t start playback', result.error)
    // The embedded player has its own controls on screen, so it needs no toast.
    if (result.ok) setStatus(result.embedded ? { kind: 'idle' } : { kind: 'playing', text: `Playing ${title}` })
    else if (result.error === 'mpv-missing') setStatus({ kind: 'error', text: 'mpv couldn’t be found. Select mpv.exe in Settings.', settingsLink: true })
    else setStatus({ kind: 'error', text: result.error, settingsLink: true })
  }

  const play: PlaybackContextValue['play'] = async (preview, video, options) => {
    const id = ++request.current
    const stale = () => id !== request.current
    try {
      let meta = preview as MetaDetail
      setLoading({ meta, video })
      setStatus({ kind: 'busy', text: 'Finding streams…' })
      if (meta.type === 'series' && !video && !meta.videos) {
        meta = await fetchMeta(addons, meta.type, meta.id)
        if (stale()) return
        // The full details can bring a backdrop or logo the catalog entry didn't have.
        setLoading({ meta, video })
      }
      if (stale()) return

      if (meta.type === 'series' && !video) {
        const next = nextUp(meta, progress.latestFor(meta.id))
        if (!next) {
          setLoading(null)
          setStatus({ kind: 'error', text: 'No episodes are out yet.' })
          return
        }
        video = next.video
        setLoading({ meta, video })
      }

      const all = await fetchStreams(addons, meta.type, video?.id ?? meta.id)
      if (stale()) return
      const playable = all.filter(isPlayable)
      const target = { meta, video }
      devlog('info', 'playback', `Found ${all.length} stream(s), ${playable.length} playable, for ${meta.type} ${video?.id ?? meta.id}`)

      if (playable.length === 0) {
        setLoading(null)
        setStatus({
          kind: 'error',
          text: all.length
            ? 'Only torrent streams were found. Add a debrid key to your stream addon to get direct links.'
            : 'No streams found. Check that a stream addon (like Torrentio with your debrid key) is installed.',
          settingsLink: true
        })
        return
      }
      if (options?.choose || settings.quickPlay === 'ask') {
        setLoading(null)
        setStatus({ kind: 'idle' })
        setPicker({ target, streams: playable, hidden: all.length - playable.length })
        return
      }
      await start(target, playable[0], id)
    } catch (e) {
      devlog('error', 'playback', 'Finding streams failed', e)
      if (stale()) return
      setLoading(null)
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : 'Something went wrong.' })
    }
  }

  return (
    <PlaybackContext.Provider value={{ play }}>
      {children}
      {picker && (
        <StreamPicker
          title={picker.target.video ? `${picker.target.meta.name} · ${episodeLabel(picker.target.video)}` : picker.target.meta.name}
          streams={picker.streams}
          hidden={picker.hidden}
          onPick={(s) => {
            const target = picker.target
            setPicker(null)
            start(target, s as AddonStream & { url: string })
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {loading && (
        <LoadingScreen
          key={loading.meta.id}
          meta={loading.meta}
          episode={loading.video ? [episodeLabel(loading.video), loading.video.title ?? loading.video.name].filter(Boolean).join(' · ') : undefined}
          text={status.kind === 'busy' ? status.text : 'Loading…'}
          onCancel={cancel}
        />
      )}
      {status.kind !== 'idle' && !(loading && status.kind === 'busy') && (
        <div className={`toast glass ${status.kind}`} role="status">
          {status.kind === 'busy' && <span className="spinner" aria-hidden />}
          <span>{status.text}</span>
          {status.kind === 'error' && status.settingsLink && (
            <button className="toast-link" onClick={() => { setStatus({ kind: 'idle' }); navigate('/settings') }}>Settings</button>
          )}
        </div>
      )}
    </PlaybackContext.Provider>
  )
}

export function usePlayback() {
  const ctx = useContext(PlaybackContext)
  if (!ctx) throw new Error('usePlayback must be used inside PlaybackProvider')
  return ctx
}
