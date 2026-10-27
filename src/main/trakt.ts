import { app, safeStorage } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { log } from './devlog'

/**
 * Trakt.tv sync. Sign-in uses Trakt's device-code flow (you approve Matzio on trakt.tv, no password
 * ever reaches the app), and finished movies and episodes are added to your Trakt history.
 * Where you are in a movie or episode is saved to Trakt's playback progress while you watch, and
 * your Trakt history and resume points are pulled back into the app. The app's Watchlist is kept in
 * step with your Trakt watchlist both ways.
 * Everything runs here in the main process so the app keys and tokens never reach the page.
 *
 * Trakt apps made since October 2026 sign in with PKCE and have no client secret, so the secret is
 * optional: it's sent only when one was entered, and every sign-in carries a PKCE challenge.
 */

const API = process.env.TRAKT_API_URL || 'https://api.trakt.tv'
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'

/** Keys baked in at build time (MAIN_VITE_TRAKT_CLIENT_ID / _SECRET); otherwise entered in Settings. */
const BUILT_IN = {
  clientId: import.meta.env.MAIN_VITE_TRAKT_CLIENT_ID ?? '',
  clientSecret: import.meta.env.MAIN_VITE_TRAKT_CLIENT_SECRET ?? ''
}

export interface WatchedItem {
  type: 'movie' | 'series'
  /** The title's Stremio id: an IMDb id (tt…) or tmdb:… */
  id: string
  season?: number
  episode?: number
  /** ISO time it was finished. */
  watchedAt: string
}

/** Where you are in a movie or episode, as a percentage, for Trakt's playback progress. */
export interface ProgressItem {
  type: 'movie' | 'series'
  id: string
  season?: number
  episode?: number
  /** 0–100 */
  progress: number
}

/** A watched title or resume point from Trakt, shaped like the app's own progress entries. */
export interface ImportedEntry {
  videoId: string
  metaId: string
  type: 'movie' | 'series'
  name: string
  poster?: string
  background?: string
  season?: number
  episode?: number
  episodeTitle?: string
  /** 1 for finished titles. */
  fraction: number
  /** Seconds, when Trakt knows it; 0 otherwise. */
  runtime: number
  updatedAt: number
}

/** A title added to or removed from the app's Watchlist, to repeat on Trakt. */
export interface WatchlistChange {
  type: 'movie' | 'series'
  id: string
  /** true to add, false to remove. */
  add: boolean
}

/** A title on your Trakt watchlist, shaped like the app's own Watchlist entries. */
export interface WatchlistTitle {
  id: string
  type: 'movie' | 'series'
  name: string
  poster?: string
  releaseInfo?: string
  addedAt: number
}

/** What the app's Watchlist needs to do to match Trakt; null when nothing changed. */
export interface WatchlistPull {
  add: WatchlistTitle[]
  /** Ids removed on Trakt since the last sync. */
  remove: string[]
}

export interface TraktStatus {
  /** A Trakt API app (at least a client id) is available. */
  configured: boolean
  /** The keys came with this build, so Settings doesn't need to ask for them. */
  builtIn: boolean
  username: string | null
  /** Finished titles and Watchlist changes not yet sent, e.g. because the computer was offline. */
  pending: number
  /** When your Trakt history was last pulled into the app (ISO), or null if never. */
  pulledAt: string | null
}

export type LoginEvent =
  | { state: 'connected'; username: string | null }
  | { state: 'expired' | 'denied' | 'error'; message: string }

interface Tokens {
  access_token: string
  refresh_token: string
  created_at: number
  expires_in: number
}

interface Stored {
  clientId?: string
  clientSecret?: string
  tokens?: Tokens
  username?: string | null
  pending?: WatchedItem[]
  /** The latest position per video not yet saved to Trakt. Only the newest one for each video is kept. */
  progress?: Record<string, ProgressItem>
  /** Trakt's last-activity stamps at the last pull, to skip pulls when nothing changed. */
  activity?: string
  pulledAt?: string
  /** Watchlist changes not yet sent, one per title (the latest wins). */
  watchlistQueue?: Record<string, WatchlistChange>
  /**
   * Titles on your Trakt watchlist as of the last sync, so a title missing from Trakt can be told
   * apart: removed there (it was on this list) or added here and not sent yet (it wasn't).
   * Unset until the first sync after connecting, which merges both lists.
   */
  watchlistKnown?: string[]
  /** Titles Trakt couldn't find, so they're not offered to it again. */
  watchlistUnmatched?: string[]
  watchlistActivity?: string
}

const file = () => join(app.getPath('userData'), 'trakt.json')

// Stored encrypted with the OS keychain (DPAPI on Windows) when available.
function load(): Stored {
  try {
    if (!existsSync(file())) return {}
    const raw = readFileSync(file())
    const text = raw.subarray(0, 4).toString() === 'enc:' ? safeStorage.decryptString(raw.subarray(4)) : raw.toString('utf8')
    return JSON.parse(text)
  } catch {
    return {}
  }
}

function save(data: Stored) {
  const text = JSON.stringify(data)
  try {
    const out = safeStorage.isEncryptionAvailable() ? Buffer.concat([Buffer.from('enc:'), safeStorage.encryptString(text)]) : Buffer.from(text)
    writeFileSync(file(), out)
  } catch {
    // Not persisted; sign-in lasts for this session only.
  }
}

class TraktError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** Turns a Stremio id into Trakt ids, or null for catalogs Trakt can't match (kitsu:, etc.). */
function traktIds(id: string): Record<string, string | number> | null {
  if (/^tt\d+$/.test(id)) return { imdb: id }
  const tmdb = /^tmdb:(\d+)$/.exec(id)
  if (tmdb) return { tmdb: Number(tmdb[1]) }
  return null
}

const progressKey = (i: { id: string; season?: number; episode?: number }) => (i.season === undefined ? i.id : `${i.id}:${i.season}:${i.episode}`)

/** Cinemeta's artwork, which is what the app shows for these titles anyway. */
const art = (imdb?: string) =>
  imdb ? { poster: `https://images.metahub.space/poster/medium/${imdb}/img`, background: `https://images.metahub.space/background/medium/${imdb}/img` } : {}

/** The Stremio id for a Trakt title: its IMDb id, otherwise its TMDB id. */
function stremioId(ids?: { imdb?: string | null; tmdb?: number | null }): string | null {
  if (ids?.imdb && /^tt\d+$/.test(ids.imdb)) return ids.imdb
  if (ids?.tmdb) return `tmdb:${ids.tmdb}`
  return null
}

const time = (iso?: string | null) => (iso ? Date.parse(iso) || 0 : 0)

interface TraktTitle {
  title?: string
  runtime?: number
  ids?: { imdb?: string | null; tmdb?: number | null }
}

export class Trakt {
  private data: Stored = load()
  private login: { timer: NodeJS.Timeout; deadline: number } | null = null
  private flushing: Promise<void> | null = null
  private savingProgress = false
  private flushingWatchlist: Promise<void> | null = null
  /** Trakt asked us to slow down; nothing is sent before this time. */
  private backoffUntil = 0

  constructor(private onLogin: (e: LoginEvent) => void, private onChange: (s: TraktStatus) => void) {}

  private get app() {
    return BUILT_IN.clientId ? BUILT_IN : { clientId: this.data.clientId ?? '', clientSecret: this.data.clientSecret ?? '' }
  }

  /** The app's client id, plus its secret when it has one (older Trakt apps). */
  private credentials() {
    const { clientId, clientSecret } = this.app
    return clientSecret ? { client_id: clientId, client_secret: clientSecret } : { client_id: clientId }
  }

  status(): TraktStatus {
    return {
      configured: !!this.app.clientId,
      builtIn: !!BUILT_IN.clientId,
      username: this.data.tokens ? (this.data.username ?? '') : null,
      pending: (this.data.pending?.length ?? 0) + Object.keys(this.data.watchlistQueue ?? {}).length,
      pulledAt: this.data.tokens ? (this.data.pulledAt ?? null) : null
    }
  }

  private update(patch: Partial<Stored>) {
    this.data = { ...this.data, ...patch }
    save(this.data)
    this.onChange(this.status())
  }

  setApp(clientId: string, clientSecret: string) {
    this.cancelLogin()
    // New keys belong to a different Trakt app, so the old sign-in can't be reused.
    this.update({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), tokens: undefined, username: undefined })
    return this.status()
  }

  private async request<T>(path: string, body?: unknown, auth = false, method?: 'DELETE'): Promise<{ status: number; data: T; retryAfter: number }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': this.app.clientId,
      'User-Agent': `Matzio/${app.getVersion()}`
    }
    if (auth && this.data.tokens) headers.Authorization = `Bearer ${this.data.tokens.access_token}`
    const res = await fetch(API + path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      // Some error replies are plain text.
    }
    return { status: res.status, data: data as T, retryAfter: Number(res.headers.get('retry-after')) || 0 }
  }

  /** Starts sign-in. Show the code to the user; the result arrives through onLogin. */
  async startLogin(): Promise<{ userCode: string; verificationUrl: string; expiresIn: number }> {
    this.cancelLogin()
    if (!this.app.clientId) throw new Error('Add your Trakt app’s Client ID first.')
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const { status, data } = await this.request<{ device_code: string; user_code: string; verification_url: string; expires_in: number; interval: number }>(
      '/oauth/device/code',
      { client_id: this.app.clientId, code_challenge: challenge, code_challenge_method: 'S256' }
    )
    if (status !== 200 || !data?.device_code) {
      throw new Error(status === 401 || status === 403 ? 'Trakt didn’t accept the Client ID. Check it in Settings.' : `Trakt sign-in failed (HTTP ${status}).`)
    }

    const deadline = Date.now() + data.expires_in * 1000
    let interval = Math.max(1, data.interval) * 1000
    const poll = async () => {
      if (!this.login) return
      if (Date.now() > deadline) return this.finishLogin({ state: 'expired', message: 'The code expired. Try connecting again.' })
      try {
        const r = await this.request<Tokens>('/oauth/device/token', { code: data.device_code, code_verifier: verifier, ...this.credentials() })
        if (!this.login) return
        if (r.status === 200 && r.data?.access_token) {
          this.finishLogin(null)
          this.update({ tokens: r.data })
          const username = await this.fetchUsername()
          this.update({ username })
          this.onLogin({ state: 'connected', username })
          this.flush()
          this.saveProgress()
          this.flushWatchlist()
          return
        }
        if (r.status === 418) return this.finishLogin({ state: 'denied', message: 'Access was denied on trakt.tv.' })
        if (r.status === 404 || r.status === 409 || r.status === 410) return this.finishLogin({ state: 'expired', message: 'The code expired. Try connecting again.' })
        if (r.status === 401 || r.status === 403) return this.finishLogin({ state: 'error', message: 'Trakt didn’t accept the app keys. Check them in Settings.' })
        if (r.status === 429) interval += 1000
        // 400 means still waiting for you to approve.
      } catch {
        // Offline for a moment; keep waiting until the code expires.
      }
      if (this.login) this.login.timer = setTimeout(poll, interval)
    }
    this.login = { timer: setTimeout(poll, interval), deadline }
    return { userCode: data.user_code, verificationUrl: data.verification_url, expiresIn: data.expires_in }
  }

  private finishLogin(event: LoginEvent | null) {
    if (this.login) clearTimeout(this.login.timer)
    this.login = null
    if (event) log(event.state === 'connected' ? 'info' : 'warn', 'trakt', `Sign-in ${event.state}`, 'message' in event ? event.message : undefined)
    if (event) this.onLogin(event)
  }

  cancelLogin() {
    this.finishLogin(null)
  }

  private async fetchUsername(): Promise<string | null> {
    try {
      const r = await this.authed<{ user?: { username?: string; name?: string } }>('/users/settings')
      return r.data?.user?.username ?? null
    } catch {
      return null
    }
  }

  async disconnect() {
    this.cancelLogin()
    const token = this.data.tokens?.access_token
    this.update({
      tokens: undefined,
      username: undefined,
      pending: [],
      progress: {},
      activity: undefined,
      pulledAt: undefined,
      watchlistQueue: {},
      watchlistKnown: undefined,
      watchlistUnmatched: undefined,
      watchlistActivity: undefined
    })
    if (token) {
      // Best effort: the app forgets the token either way.
      await this.request('/oauth/revoke', { token, ...this.credentials() }).catch(() => {})
    }
    return this.status()
  }

  private async refresh(): Promise<boolean> {
    const tokens = this.data.tokens
    if (!tokens) return false
    const r = await this.request<Tokens>('/oauth/token', {
      refresh_token: tokens.refresh_token,
      ...this.credentials(),
      redirect_uri: REDIRECT_URI,
      grant_type: 'refresh_token'
    })
    if (r.status === 200 && r.data?.access_token) {
      this.update({ tokens: r.data })
      return true
    }
    if (r.status === 400 || r.status === 401) {
      // The sign-in was revoked on trakt.tv; show Disconnected so it can be redone.
      this.update({ tokens: undefined, username: undefined })
    }
    return false
  }

  /** A signed-in request that refreshes the token when it has expired. */
  private async authed<T>(path: string, body?: unknown, method?: 'DELETE') {
    const t = this.data.tokens
    if (!t) throw new TraktError(401, 'Not connected to Trakt.')
    if (Date.now() / 1000 > t.created_at + t.expires_in - 3600) await this.refresh()
    let r = await this.request<T>(path, body, true, method)
    if (r.status === 401 && (await this.refresh())) r = await this.request<T>(path, body, true, method)
    if (r.status === 429) this.backoffUntil = Date.now() + Math.max(r.retryAfter, 1) * 1000
    if (r.status >= 400) throw new TraktError(r.status, `Trakt replied with HTTP ${r.status}.`)
    return r
  }

  /** Queues a finished movie or episode for your Trakt history and sends it right away if possible. */
  markWatched(item: WatchedItem) {
    if (!this.data.tokens || !traktIds(item.id)) return
    if (item.type === 'series' && (item.season === undefined || item.episode === undefined)) return
    // A finished title has no resume point left to save.
    const { [progressKey(item)]: _done, ...progress } = this.data.progress ?? {}
    this.update({ pending: [...(this.data.pending ?? []), item], progress })
    this.flush()
  }

  /** Sends everything waiting. Items that fail for network reasons stay queued for the next try. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing.then(() => this.flush())
    const items = this.data.pending ?? []
    if (!this.data.tokens || items.length === 0) return Promise.resolve()

    const movies: unknown[] = []
    const shows = new Map<string, { ids: Record<string, string | number>; seasons: Map<number, { number: number; watched_at: string }[]> }>()
    for (const item of items) {
      const ids = traktIds(item.id)
      if (!ids) continue
      if (item.type === 'movie') {
        movies.push({ ids, watched_at: item.watchedAt })
        continue
      }
      const show = shows.get(item.id) ?? { ids, seasons: new Map() }
      shows.set(item.id, show)
      const eps = show.seasons.get(item.season!) ?? []
      eps.push({ number: item.episode!, watched_at: item.watchedAt })
      show.seasons.set(item.season!, eps)
    }
    const body = {
      movies,
      shows: [...shows.values()].map((s) => ({ ids: s.ids, seasons: [...s.seasons].map(([number, episodes]) => ({ number, episodes })) }))
    }

    this.flushing = this.authed('/sync/history', body)
      .then(() => {
        // Titles Trakt couldn't match are dropped too; retrying them won't help.
        const sent = new Set(items)
        this.update({ pending: (this.data.pending ?? []).filter((i) => !sent.has(i)) })
        return this.clearPlayback(items)
      })
      .catch((e) => {
        const status = e instanceof TraktError ? e.status : 0
        log('warn', 'trakt', `History sync failed for ${items.length} item(s)`, e)
        // Network errors, rate limits and server trouble are retried later; anything else would fail again.
        const retry = status === 0 || status === 401 || status === 429 || status >= 500
        if (!retry) {
          const sent = new Set(items)
          this.update({ pending: (this.data.pending ?? []).filter((i) => !sent.has(i)) })
        }
      })
      .finally(() => {
        this.flushing = null
      })
    return this.flushing
  }

  /** Trakt keeps a resume point after a title is added to history, so finished titles have theirs removed. */
  private async clearPlayback(items: WatchedItem[]) {
    try {
      const r = await this.authed<{ id: number; type: string; movie?: TraktTitle; show?: TraktTitle; episode?: { season: number; number: number } }[]>('/sync/playback')
      const done = new Set(items.map(progressKey))
      for (const p of r.data ?? []) {
        const id = stremioId(p.type === 'movie' ? p.movie?.ids : p.show?.ids)
        if (!id) continue
        const key = p.type === 'movie' ? id : progressKey({ id, season: p.episode?.season, episode: p.episode?.number })
        if (done.has(key)) await this.authed(`/sync/playback/${p.id}`, undefined, 'DELETE')
      }
    } catch (e) {
      log('warn', 'trakt', 'Couldn’t clear finished resume points', e)
    }
  }

  /**
   * Saves where you are in a movie or episode to Trakt (as a paused scrobble, which is what Trakt
   * keeps as playback progress). Without an item, just retries whatever is waiting. Only the newest
   * position per video is kept, so being offline for an hour still sends one call per video.
   */
  saveProgress(item?: ProgressItem) {
    if (!this.data.tokens) return
    if (item) {
      if (!traktIds(item.id) || item.progress < 1 || item.progress >= 100) return
      if (item.type === 'series' && (item.season === undefined || item.episode === undefined)) return
      // Kept in memory and written to disk with the next status change, so a tick doesn't rewrite the file.
      this.data.progress = { ...(this.data.progress ?? {}), [progressKey(item)]: { ...item, progress: Math.round(item.progress * 100) / 100 } }
      save(this.data)
    }
    void this.sendProgress()
  }

  private async sendProgress() {
    if (this.savingProgress || Date.now() < this.backoffUntil) return
    this.savingProgress = true
    try {
      for (const [key, item] of Object.entries(this.data.progress ?? {})) {
        const ids = traktIds(item.id)!
        const body =
          item.type === 'movie'
            ? { movie: { ids }, progress: item.progress }
            : { show: { ids }, episode: { season: item.season, number: item.episode }, progress: item.progress }
        let drop = true
        try {
          await this.authed('/scrobble/pause', body)
        } catch (e) {
          const status = e instanceof TraktError ? e.status : 0
          // Offline, rate limited or Trakt having trouble: keep it and try again with the next tick.
          drop = !(status === 0 || status === 401 || status === 429 || status >= 500)
          log(drop ? 'warn' : 'info', 'trakt', `Saving progress failed (${status || 'offline'})`, drop ? item : undefined)
          if (!drop) return
        }
        // A newer position may have arrived while this one was on its way; that one still needs sending.
        const now = this.data.progress?.[key]
        if (drop && now && now.progress === item.progress) {
          const { [key]: _sent, ...rest } = this.data.progress ?? {}
          this.data.progress = rest
          save(this.data)
        }
        // Trakt allows about one write a second.
        await new Promise((r) => setTimeout(r, 1000))
      }
    } finally {
      this.savingProgress = false
    }
  }

  /**
   * Your Trakt history and resume points, for the app to merge into its own. Returns null when
   * nothing changed on Trakt since the last pull (unless forced), so regular checks cost one call.
   */
  async pull(force = false): Promise<ImportedEntry[] | null> {
    if (!this.data.tokens) return null
    const act = await this.authed<{ movies?: { watched_at?: string; paused_at?: string }; episodes?: { watched_at?: string; paused_at?: string } }>(
      '/sync/last_activities'
    )
    const a = act.data ?? {}
    const stamp = [a.movies?.watched_at, a.movies?.paused_at, a.episodes?.watched_at, a.episodes?.paused_at].join('|')
    if (!force && stamp === this.data.activity) return null

    type Watched = { last_watched_at?: string; movie?: TraktTitle; show?: TraktTitle; seasons?: { number: number; episodes: { number: number; last_watched_at?: string }[] }[] }
    type Playback = { progress: number; paused_at?: string; type: string; movie?: TraktTitle; show?: TraktTitle; episode?: TraktTitle & { season: number; number: number } }
    const [movies, shows, playback] = await Promise.all([
      this.authed<Watched[]>('/sync/watched/movies'),
      this.authed<Watched[]>('/sync/watched/shows'),
      this.authed<Playback[]>('/sync/playback?extended=full')
    ])

    const out: ImportedEntry[] = []
    for (const w of movies.data ?? []) {
      const id = stremioId(w.movie?.ids)
      if (!id) continue
      out.push({ videoId: id, metaId: id, type: 'movie', name: w.movie?.title ?? '', ...art(w.movie?.ids?.imdb ?? undefined), fraction: 1, runtime: 0, updatedAt: time(w.last_watched_at) })
    }
    for (const w of shows.data ?? []) {
      const id = stremioId(w.show?.ids)
      if (!id) continue
      for (const season of w.seasons ?? []) {
        // Specials (season 0) aren't in the app's episode lists.
        if (season.number === 0) continue
        for (const ep of season.episodes ?? []) {
          out.push({
            videoId: `${id}:${season.number}:${ep.number}`,
            metaId: id,
            type: 'series',
            name: w.show?.title ?? '',
            ...art(w.show?.ids?.imdb ?? undefined),
            season: season.number,
            episode: ep.number,
            fraction: 1,
            runtime: 0,
            updatedAt: time(ep.last_watched_at ?? w.last_watched_at)
          })
        }
      }
    }
    for (const p of playback.data ?? []) {
      const title = p.type === 'movie' ? p.movie : p.show
      const id = stremioId(title?.ids)
      if (!id || !(p.progress > 0)) continue
      const ep = p.type === 'episode' ? p.episode : undefined
      if (p.type === 'episode' && !ep) continue
      out.push({
        videoId: ep ? `${id}:${ep.season}:${ep.number}` : id,
        metaId: id,
        type: ep ? 'series' : 'movie',
        name: title?.title ?? '',
        ...art(title?.ids?.imdb ?? undefined),
        season: ep?.season,
        episode: ep?.number,
        episodeTitle: ep?.title,
        fraction: Math.min(1, p.progress / 100),
        runtime: ((ep ? (ep.runtime ?? title?.runtime) : title?.runtime) ?? 0) * 60,
        updatedAt: time(p.paused_at)
      })
    }

    this.update({ activity: stamp, pulledAt: new Date().toISOString() })
    log('info', 'trakt', `Pulled ${out.length} watched or in-progress item(s) from Trakt`)
    return out
  }

  /** Queues a Watchlist add or removal for Trakt and sends it right away if possible. */
  updateWatchlist(change: WatchlistChange) {
    if (!this.data.tokens || !traktIds(change.id)) return
    if (change.type !== 'movie' && change.type !== 'series') return
    this.update({ watchlistQueue: { ...(this.data.watchlistQueue ?? {}), [change.id]: { type: change.type, id: change.id, add: change.add } } })
    void this.flushWatchlist()
  }

  /** Sends waiting Watchlist changes: adds in one call, removals in another. Network failures stay queued. */
  flushWatchlist(): Promise<void> {
    if (this.flushingWatchlist) return this.flushingWatchlist
    const changes = Object.values(this.data.watchlistQueue ?? {})
    if (!this.data.tokens || changes.length === 0 || Date.now() < this.backoffUntil) return Promise.resolve()

    const run = async () => {
      const adds = changes.filter((c) => c.add)
      const removes = changes.filter((c) => !c.add)
      const body = (list: WatchlistChange[]) => ({
        movies: list.filter((c) => c.type === 'movie').map((c) => ({ ids: traktIds(c.id) })),
        shows: list.filter((c) => c.type === 'series').map((c) => ({ ids: traktIds(c.id) }))
      })
      for (const [list, path] of [[adds, '/sync/watchlist'], [removes, '/sync/watchlist/remove']] as const) {
        if (list.length === 0) continue
        let notFound: string[] = []
        try {
          const r = await this.authed<{ not_found?: { movies?: { ids?: TraktTitle['ids'] }[]; shows?: { ids?: TraktTitle['ids'] }[] } }>(path, body(list))
          const nf = r.data?.not_found
          notFound = [...(nf?.movies ?? []), ...(nf?.shows ?? [])].map((t) => stremioId(t.ids)).filter((id): id is string => !!id)
        } catch (e) {
          const status = e instanceof TraktError ? e.status : 0
          log('warn', 'trakt', `Watchlist sync failed for ${list.length} title(s)`, e)
          // Offline, rate limited or Trakt having trouble: keep them for the next try. Anything else would fail again.
          if (status === 0 || status === 401 || status === 429 || status >= 500) return
        }
        const known = new Set(this.data.watchlistKnown ?? [])
        const unmatched = new Set(this.data.watchlistUnmatched ?? [])
        const queue = { ...(this.data.watchlistQueue ?? {}) }
        for (const c of list) {
          // A newer change to the same title may have arrived meanwhile; that one still needs sending.
          if (queue[c.id]?.add === c.add) delete queue[c.id]
          if (!c.add) known.delete(c.id)
          else if (notFound.includes(c.id)) unmatched.add(c.id)
          else known.add(c.id)
        }
        this.update({ watchlistQueue: queue, watchlistKnown: this.data.watchlistKnown && [...known], watchlistUnmatched: [...unmatched] })
        // Trakt allows about one write a second.
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
    this.flushingWatchlist = run().finally(() => {
      this.flushingWatchlist = null
    })
    return this.flushingWatchlist
  }

  /**
   * Compares your Trakt watchlist with the app's Watchlist (`local`) and says what to add and remove
   * here. Titles only in the app are queued to go up to Trakt. The first sync after connecting merges
   * both lists without removing anything. Returns null when nothing changed on Trakt (unless forced).
   */
  async pullWatchlist(local: { id: string; type: string }[], force = false): Promise<WatchlistPull | null> {
    if (!this.data.tokens) return null
    // Changes made here go up first, so the list read back already has them.
    await this.flushWatchlist()
    const act = await this.authed<{ watchlist?: { updated_at?: string }; movies?: { watchlisted_at?: string }; shows?: { watchlisted_at?: string } }>(
      '/sync/last_activities'
    )
    const a = act.data ?? {}
    const stamp = [a.watchlist?.updated_at, a.movies?.watchlisted_at, a.shows?.watchlisted_at].join('|')
    if (!force && this.data.watchlistKnown && stamp === this.data.watchlistActivity) return null

    type Listed = { listed_at?: string; movie?: TraktTitle & { year?: number }; show?: TraktTitle & { year?: number } }
    const [movies, shows] = await Promise.all([this.authed<Listed[]>('/sync/watchlist/movies'), this.authed<Listed[]>('/sync/watchlist/shows')])
    const remote = new Map<string, WatchlistTitle>()
    for (const [list, type] of [[movies.data, 'movie'], [shows.data, 'series']] as const) {
      for (const l of list ?? []) {
        const title = type === 'movie' ? l.movie : l.show
        const id = stremioId(title?.ids)
        if (!id) continue
        remote.set(id, {
          id,
          type,
          name: title?.title ?? '',
          poster: art(title?.ids?.imdb ?? undefined).poster,
          releaseInfo: title?.year ? String(title.year) : undefined,
          addedAt: time(l.listed_at) || Date.now()
        })
      }
    }

    const queue = this.data.watchlistQueue ?? {}
    const known = this.data.watchlistKnown ? new Set(this.data.watchlistKnown) : null
    const unmatched = new Set(this.data.watchlistUnmatched ?? [])
    const here = new Set(local.map((l) => l.id))
    // On Trakt but not here: added on Trakt, unless it's waiting to be removed there.
    const add = [...remote.values()].filter((t) => !here.has(t.id) && queue[t.id]?.add !== false)
    const remove: string[] = []
    const upload: WatchlistChange[] = []
    for (const l of local) {
      if (remote.has(l.id) || queue[l.id] || !traktIds(l.id) || (l.type !== 'movie' && l.type !== 'series')) continue
      // Was on Trakt last time and isn't now: removed there. Otherwise it was added here and Trakt hasn't got it.
      if (known?.has(l.id)) remove.push(l.id)
      else if (!unmatched.has(l.id)) upload.push({ id: l.id, type: l.type, add: true })
    }

    this.update({
      watchlistKnown: [...remote.keys()],
      watchlistActivity: stamp,
      watchlistQueue: { ...queue, ...Object.fromEntries(upload.map((c) => [c.id, c])) }
    })
    if (upload.length) void this.flushWatchlist()
    log('info', 'trakt', `Watchlist: ${add.length} from Trakt, ${remove.length} removed on Trakt, ${upload.length} sent to Trakt`)
    return { add, remove }
  }
}
