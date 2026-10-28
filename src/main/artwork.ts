import { app, ipcMain } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { API, keyFor, onKeysChange, tmdbRequest } from './connections'
import { log } from './devlog'

/**
 * Logos, backgrounds and banners from fanart.tv (and TMDB where fanart.tv has none), for the title
 * pages and the loading screen. Used only when a key is saved in Settings → Connections; otherwise the
 * app keeps the art the addons send.
 *
 * fanart.tv finds movies by IMDb or TMDB id, but series only by TVDB id, so series need TMDB to look
 * that up. Results are kept on disk for a week (a day when nothing was found).
 */

export interface Artwork {
  logo?: string
  background?: string
  banner?: string
}

interface FanartImage {
  url: string
  lang?: string
  likes?: string
}

const TMDB_IMAGES = process.env.TMDB_IMAGE_URL || 'https://image.tmdb.org/t/p'
const FOUND_TTL = 7 * 24 * 60 * 60 * 1000
const EMPTY_TTL = 24 * 60 * 60 * 1000

const cacheFile = () => join(app.getPath('userData'), 'artwork-cache.json')
let cache: Record<string, { at: number; art: Artwork }> | null = null
let saveTimer: NodeJS.Timeout | null = null

function loadCache() {
  if (cache) return cache
  try {
    cache = existsSync(cacheFile()) ? JSON.parse(readFileSync(cacheFile(), 'utf8')) : {}
  } catch {
    cache = {}
  }
  return cache!
}

function saveCache() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      writeFileSync(cacheFile(), JSON.stringify(cache ?? {}))
    } catch {
      // The cache is optional.
    }
  }, 2000)
}

/** English first, then art with no text, then anything else; the most liked within each. */
function pick(...lists: (FanartImage[] | undefined)[]): string | undefined {
  const all = lists.flatMap((l, i) => (l ?? []).map((img) => ({ img, list: i })))
  const rank = (lang?: string) => (lang === 'en' ? 0 : !lang || lang === '00' ? 1 : 2)
  all.sort((a, b) => rank(a.img.lang) - rank(b.img.lang) || a.list - b.list || Number(b.img.likes ?? 0) - Number(a.img.likes ?? 0))
  return all[0]?.img.url
}

/** Backgrounds read best without text on them, so those come first there. */
function pickBackground(list?: FanartImage[]): string | undefined {
  const rank = (lang?: string) => (!lang || lang === '00' ? 0 : lang === 'en' ? 1 : 2)
  return [...(list ?? [])].sort((a, b) => rank(a.lang) - rank(b.lang) || Number(b.likes ?? 0) - Number(a.likes ?? 0))[0]?.url
}

async function getJson<T>(url: string, headers: Record<string, string> = { Accept: 'application/json' }): Promise<T | null> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
  return (await res.json()) as T
}

const tmdb = <T>(path: string) => {
  const { url, headers } = tmdbRequest(path)
  return getJson<T>(url, headers)
}

/** The TMDB id for a Stremio id: tmdb:123 directly, an IMDb id through TMDB's lookup. */
async function tmdbId(type: 'movie' | 'series', id: string): Promise<number | null> {
  const direct = /^tmdb:(\d+)$/.exec(id)
  if (direct) return Number(direct[1])
  if (!keyFor('tmdb')) return null
  const found = await tmdb<{ movie_results?: { id: number }[]; tv_results?: { id: number }[] }>(`/find/${id}?external_source=imdb_id`)
  return (type === 'movie' ? found?.movie_results : found?.tv_results)?.[0]?.id ?? null
}

async function fromFanart(type: 'movie' | 'series', id: string): Promise<Artwork> {
  const key = encodeURIComponent(keyFor('fanart'))
  if (type === 'movie') {
    const ref = /^tt\d+$/.test(id) ? id : await tmdbId(type, id)
    if (!ref) return {}
    const d = await getJson<Record<string, FanartImage[]>>(`${API.fanart}/movies/${ref}?api_key=${key}`)
    if (!d) return {}
    return { logo: pick(d.hdmovielogo, d.movielogo), background: pickBackground(d.moviebackground), banner: pick(d.moviebanner) }
  }
  const tv = await tmdbId(type, id)
  if (!tv || !keyFor('tmdb')) return {}
  const ext = await tmdb<{ tvdb_id?: number | null }>(`/tv/${tv}/external_ids`)
  if (!ext?.tvdb_id) return {}
  const d = await getJson<Record<string, FanartImage[]>>(`${API.fanart}/tv/${ext.tvdb_id}?api_key=${key}`)
  if (!d) return {}
  return { logo: pick(d.hdtvlogo, d.clearlogo), background: pickBackground(d.showbackground), banner: pick(d.tvbanner) }
}

async function fromTmdb(type: 'movie' | 'series', id: string): Promise<Artwork> {
  const ref = await tmdbId(type, id)
  if (!ref) return {}
  type Img = { file_path: string; iso_639_1: string | null; vote_average?: number }
  const d = await tmdb<{ logos?: Img[]; backdrops?: Img[] }>(`/${type === 'movie' ? 'movie' : 'tv'}/${ref}/images?include_image_language=en,null`)
  const best = (list: Img[] | undefined, textless: boolean) =>
    [...(list ?? [])].sort((a, b) => {
      const rank = (l: string | null) => (textless ? (l ? 1 : 0) : l === 'en' ? 0 : 1)
      return rank(a.iso_639_1) - rank(b.iso_639_1) || (b.vote_average ?? 0) - (a.vote_average ?? 0)
    })[0]
  const logo = best(d?.logos, false)
  const backdrop = best(d?.backdrops, true)
  return {
    logo: logo && `${TMDB_IMAGES}/w500${logo.file_path}`,
    background: backdrop && `${TMDB_IMAGES}/w1280${backdrop.file_path}`
  }
}

const inFlight = new Map<string, Promise<Artwork | null>>()

/** Art for a title, or null when no key is set or the title can't be looked up. */
async function artworkFor(type: string, id: string): Promise<Artwork | null> {
  if (type !== 'movie' && type !== 'series') return null
  if (!/^(tt\d+|tmdb:\d+)$/.test(id)) return null
  const fanart = !!keyFor('fanart')
  const tmdbKey = !!keyFor('tmdb')
  if (!fanart && !tmdbKey) return null

  const cacheKey = `${type}:${id}`
  const hit = loadCache()[cacheKey]
  if (hit && Date.now() - hit.at < (hit.art.logo || hit.art.background ? FOUND_TTL : EMPTY_TTL)) return hit.art

  const running = inFlight.get(cacheKey)
  if (running) return running
  const job = (async () => {
    const empty: Artwork = {}
    const [fa, tm] = await Promise.all<[Promise<Artwork | null>, Promise<Artwork | null>]>([
      fanart ? fromFanart(type, id).catch((e) => (log('warn', 'artwork', `fanart.tv lookup failed for ${cacheKey}`, e), null)) : Promise.resolve(empty),
      tmdbKey ? fromTmdb(type, id).catch((e) => (log('warn', 'artwork', `TMDB lookup failed for ${cacheKey}`, e), null)) : Promise.resolve(empty)
    ])
    // fanart.tv's art comes first; TMDB fills the gaps.
    const art: Artwork = { logo: fa?.logo ?? tm?.logo, background: fa?.background ?? tm?.background, banner: fa?.banner }
    // A failed lookup (offline, service down) isn't cached, so it's tried again next time.
    if (fa !== null && tm !== null) {
      loadCache()[cacheKey] = { at: Date.now(), art }
      saveCache()
    }
    return art
  })().finally(() => inFlight.delete(cacheKey))
  inFlight.set(cacheKey, job)
  return job
}

export function registerArtwork() {
  // New keys can find art the old ones couldn't, so start fresh.
  onKeysChange(() => {
    cache = {}
    saveCache()
  })
  ipcMain.handle('artwork:get', (_e, type: string, id: string) => artworkFor(type, id))
}
