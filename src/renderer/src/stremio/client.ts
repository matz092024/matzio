import { devlog } from '../devlog'
import type { ContentType, InstalledAddon, Manifest, ManifestCatalog, MetaDetail, MetaPreview, Stream, Subtitle } from './types'

/** Accepts stremio:// links, bare base URLs, and full manifest URLs. */
export function normalizeManifestUrl(input: string): string {
  let url = input.trim()
  if (url.startsWith('stremio://')) url = 'https://' + url.slice('stremio://'.length)
  if (!/^https?:\/\//.test(url)) url = 'https://' + url
  url = url.replace(/\/+$/, '')
  if (!url.endsWith('/manifest.json')) url += '/manifest.json'
  return url
}

function baseOf(transportUrl: string) {
  return transportUrl.replace(/\/manifest\.json$/, '')
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const started = performance.now()
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return (await res.json()) as T
  } catch (e) {
    // The dev log keeps the addon's host and the request path; keys in the link are stripped.
    if (!signal?.aborted) devlog('warn', 'addon', `Request failed after ${Math.round(performance.now() - started)} ms: ${url}`, e instanceof Error ? e.message : String(e))
    throw e
  }
}

export async function fetchManifest(transportUrl: string): Promise<Manifest> {
  let manifest: Manifest
  try {
    manifest = await getJson<Manifest>(transportUrl)
  } catch {
    throw new Error('Couldn’t reach that addon. Check the link and your connection.')
  }
  if (!manifest?.id || !manifest?.name || !Array.isArray(manifest.resources)) {
    throw new Error('That URL did not return a Stremio addon manifest.')
  }
  manifest.catalogs ??= []
  manifest.types ??= []
  return manifest
}

export type Extra = Record<string, string | number | undefined>

function resourceUrl(addon: InstalledAddon, resource: string, type: string, id: string, extra?: Extra) {
  let url = `${baseOf(addon.transportUrl)}/${resource}/${encodeURIComponent(type)}/${encodeURIComponent(id)}`
  const pairs = Object.entries(extra ?? {}).filter(([, v]) => v !== undefined && v !== '')
  if (pairs.length) {
    url += '/' + pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
  }
  return url + '.json'
}

/** Whether an addon serves `resource` for this type and id. */
export function supports(addon: InstalledAddon, resource: string, type: ContentType, id?: string): boolean {
  const { manifest } = addon
  for (const r of manifest.resources) {
    const name = typeof r === 'string' ? r : r.name
    if (name !== resource) continue
    const types = typeof r === 'string' ? manifest.types : r.types ?? manifest.types
    const prefixes = typeof r === 'string' ? manifest.idPrefixes : r.idPrefixes ?? manifest.idPrefixes
    if (!types.includes(type)) continue
    if (id && prefixes?.length && !prefixes.some((p) => id.startsWith(p))) continue
    return true
  }
  return false
}

export function catalogExtras(catalog: ManifestCatalog) {
  const names = new Set<string>()
  const required = new Set<string>(catalog.extraRequired ?? [])
  for (const e of catalog.extra ?? []) {
    names.add(e.name)
    if (e.isRequired) required.add(e.name)
  }
  for (const n of catalog.extraSupported ?? []) names.add(n)
  const genres = catalog.extra?.find((e) => e.name === 'genre')?.options ?? []
  return { names, required, genres }
}

export async function fetchCatalog(addon: InstalledAddon, catalog: ManifestCatalog, extra?: Extra, signal?: AbortSignal) {
  const data = await getJson<{ metas?: MetaPreview[] }>(resourceUrl(addon, 'catalog', catalog.type, catalog.id, extra), signal)
  return data.metas ?? []
}

/** Asks each addon that serves meta for this id, in install order, and returns the first answer. */
export async function fetchMeta(addons: InstalledAddon[], type: ContentType, id: string, signal?: AbortSignal) {
  let lastError: unknown
  for (const addon of addons.filter((a) => supports(a, 'meta', type, id))) {
    try {
      const data = await getJson<{ meta?: MetaDetail }>(resourceUrl(addon, 'meta', type, id), signal)
      if (data.meta) return data.meta
    } catch (e) {
      if (signal?.aborted) throw e
      lastError = e
    }
  }
  throw lastError ?? new Error('None of your addons have details for this title.')
}

export interface AddonStream extends Stream {
  addon: string
}

/** Streams from every addon that has them, in install order, so the first one is the top pick. */
export async function fetchStreams(addons: InstalledAddon[], type: ContentType, id: string, signal?: AbortSignal) {
  const sources = addons.filter((a) => supports(a, 'stream', type, id))
  const results = await Promise.allSettled(
    sources.map((a) => getJson<{ streams?: Stream[] }>(resourceUrl(a, 'stream', type, id), signal))
  )
  return results.flatMap((r, i) =>
    r.status === 'fulfilled' ? (r.value.streams ?? []).map((s) => ({ ...s, addon: sources[i].manifest.name })) : []
  )
}

export interface AddonSubtitle extends Subtitle {
  addon: string
}

/**
 * Asks every subtitles addon for this video at once, and hands each addon's list to `onResult`
 * as it arrives, so one slow addon doesn't hold back the rest. Each gets `timeoutMs` before it's
 * given up on; failures are only logged. Resolves once every addon has answered or timed out.
 */
export async function fetchSubtitles(
  addons: InstalledAddon[],
  type: ContentType,
  id: string,
  extra: Extra,
  onResult: (subs: AddonSubtitle[]) => void,
  { timeoutMs = 8000, signal }: { timeoutMs?: number; signal?: AbortSignal } = {}
) {
  const sources = addons.filter((a) => supports(a, 'subtitles', type, id))
  await Promise.allSettled(
    sources.map(async (a) => {
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort)
      const timer = setTimeout(() => {
        devlog('warn', 'addon', `${a.manifest.name} took over ${timeoutMs / 1000} s for subtitles; skipped`)
        abort()
      }, timeoutMs)
      try {
        const data = await getJson<{ subtitles?: Subtitle[] }>(resourceUrl(a, 'subtitles', type, id, extra), controller.signal)
        const subs = (Array.isArray(data.subtitles) ? data.subtitles : [])
          .filter((s) => typeof s?.url === 'string' && /^https?:\/\//.test(s.url))
          .map((s) => ({ id: s.id, url: s.url, lang: s.lang, addon: a.manifest.name }))
        if (!controller.signal.aborted) onResult(subs)
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
      }
    })
  )
}

/** Matzio plays direct links (what debrid addons return); torrents, YouTube and external links are skipped. */
export function isPlayable<T extends Stream>(stream: T): stream is T & { url: string } {
  return typeof stream.url === 'string' && /^https?:\/\//.test(stream.url)
}
