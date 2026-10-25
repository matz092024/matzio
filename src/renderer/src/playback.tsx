import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAddons } from './stremio/addons'
import { fetchMeta, fetchStreams, isPlayable, type AddonStream } from './stremio/client'
import type { MetaDetail, MetaPreview, Video } from './stremio/types'
import { isWatched, useProgress, type WatchEntry } from './progress'
import { useSettings } from './settings'
import StreamPicker from './components/StreamPicker'

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
  const request = useRef(0)

  useEffect(() => {
    const player = window.matzio?.player
    if (!player) return
    return player.onEnded((p) => {
      setStatus((s) => (s.kind === 'playing' || s.kind === 'busy' ? { kind: 'idle' } : s))
      if (p.error) setStatus({ kind: 'error', text: `mpv couldn’t start: ${p.error}`, settingsLink: true })
    })
  }, [])

  // Errors fade out on their own after a while.
  useEffect(() => {
    if (status.kind !== 'error' && status.kind !== 'playing') return
    const t = setTimeout(() => setStatus({ kind: 'idle' }), status.kind === 'error' ? 8000 : 4000)
    return () => clearTimeout(t)
  }, [status])

  const start = async (target: Target, stream: AddonStream & { url: string }) => {
    const player = window.matzio?.player
    if (!player) {
      setStatus({ kind: 'error', text: 'Playback works in the desktop app.' })
      return
    }
    const { meta, video } = target
    const videoId = video?.id ?? meta.id
    const saved = progress.get(videoId)
    const startAt = saved && !isWatched(saved) && saved.position > RESUME_MIN_SECONDS ? saved.position : 0
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
    setStatus({ kind: 'busy', text: 'Opening player…' })
    const result = await player.play({
      key: videoId,
      url: stream.url,
      title,
      start: startAt,
      headers: stream.behaviorHints?.proxyHeaders?.request,
      mpvPath: settings.mpvPath || undefined
    })
    if (result.ok) setStatus({ kind: 'playing', text: `Playing ${title}` })
    else if (result.error === 'mpv-missing') setStatus({ kind: 'error', text: 'mpv isn’t installed or couldn’t be found.', settingsLink: true })
    else setStatus({ kind: 'error', text: result.error })
  }

  const play: PlaybackContextValue['play'] = async (preview, video, options) => {
    const id = ++request.current
    const stale = () => id !== request.current
    try {
      setStatus({ kind: 'busy', text: 'Finding streams…' })
      let meta = preview as MetaDetail
      if (meta.type === 'series' && !video && !meta.videos) meta = await fetchMeta(addons, meta.type, meta.id)
      if (stale()) return

      if (meta.type === 'series' && !video) {
        const next = nextUp(meta, progress.latestFor(meta.id))
        if (!next) {
          setStatus({ kind: 'error', text: 'No episodes are out yet.' })
          return
        }
        video = next.video
      }

      const all = await fetchStreams(addons, meta.type, video?.id ?? meta.id)
      if (stale()) return
      const playable = all.filter(isPlayable)
      const target = { meta, video }

      if (playable.length === 0) {
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
        setStatus({ kind: 'idle' })
        setPicker({ target, streams: playable, hidden: all.length - playable.length })
        return
      }
      await start(target, playable[0])
    } catch (e) {
      if (!stale()) setStatus({ kind: 'error', text: e instanceof Error ? e.message : 'Something went wrong.' })
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
      {status.kind !== 'idle' && (
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
