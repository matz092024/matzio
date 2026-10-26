import { app, safeStorage } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Trakt.tv sync. Sign-in uses Trakt's device-code flow (you approve Matzio on trakt.tv, no password
 * ever reaches the app), and finished movies and episodes are added to your Trakt history.
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

export interface TraktStatus {
  /** A Trakt API app (at least a client id) is available. */
  configured: boolean
  /** The keys came with this build, so Settings doesn't need to ask for them. */
  builtIn: boolean
  username: string | null
  /** Finished titles not yet sent, e.g. because the computer was offline. */
  pending: number
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

export class Trakt {
  private data: Stored = load()
  private login: { timer: NodeJS.Timeout; deadline: number } | null = null
  private flushing: Promise<void> | null = null

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
      pending: this.data.pending?.length ?? 0
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

  private async request<T>(path: string, body?: unknown, auth = false): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': this.app.clientId,
      'User-Agent': `Matzio/${app.getVersion()}`
    }
    if (auth && this.data.tokens) headers.Authorization = `Bearer ${this.data.tokens.access_token}`
    const res = await fetch(API + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      // Some error replies are plain text.
    }
    return { status: res.status, data: data as T }
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
    this.update({ tokens: undefined, username: undefined, pending: [] })
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
  private async authed<T>(path: string, body?: unknown) {
    const t = this.data.tokens
    if (!t) throw new TraktError(401, 'Not connected to Trakt.')
    if (Date.now() / 1000 > t.created_at + t.expires_in - 3600) await this.refresh()
    let r = await this.request<T>(path, body, true)
    if (r.status === 401 && (await this.refresh())) r = await this.request<T>(path, body, true)
    if (r.status >= 400) throw new TraktError(r.status, `Trakt replied with HTTP ${r.status}.`)
    return r
  }

  /** Queues a finished movie or episode for your Trakt history and sends it right away if possible. */
  markWatched(item: WatchedItem) {
    if (!this.data.tokens || !traktIds(item.id)) return
    if (item.type === 'series' && (item.season === undefined || item.episode === undefined)) return
    this.update({ pending: [...(this.data.pending ?? []), item] })
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
      })
      .catch((e) => {
        const status = e instanceof TraktError ? e.status : 0
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
}
