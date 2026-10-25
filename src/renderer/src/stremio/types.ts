// Shapes from the Stremio addon protocol:
// https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses

export type ContentType = 'movie' | 'series' | 'channel' | 'tv' | (string & {})

export interface ExtraProp {
  name: string
  isRequired?: boolean
  options?: string[]
}

export interface ManifestCatalog {
  type: ContentType
  id: string
  name?: string
  extra?: ExtraProp[]
  /** Legacy form of `extra`. */
  extraSupported?: string[]
  extraRequired?: string[]
}

export type ManifestResource = string | { name: string; types?: ContentType[]; idPrefixes?: string[] }

export interface Manifest {
  id: string
  version: string
  name: string
  description?: string
  logo?: string
  types: ContentType[]
  resources: ManifestResource[]
  catalogs: ManifestCatalog[]
  idPrefixes?: string[]
  behaviorHints?: { configurable?: boolean; configurationRequired?: boolean; adult?: boolean }
}

export interface MetaPreview {
  id: string
  type: ContentType
  name: string
  poster?: string
  posterShape?: 'poster' | 'square' | 'landscape'
  background?: string
  logo?: string
  description?: string
  releaseInfo?: string
  imdbRating?: string
  genres?: string[]
}

export interface Video {
  id: string
  title?: string
  name?: string
  season?: number
  episode?: number
  released?: string
  thumbnail?: string
  overview?: string
  description?: string
}

export interface MetaDetail extends MetaPreview {
  runtime?: string
  cast?: string[]
  director?: string[]
  videos?: Video[]
  links?: { name: string; category: string; url: string }[]
}

export interface Stream {
  url?: string
  ytId?: string
  infoHash?: string
  externalUrl?: string
  name?: string
  title?: string
  description?: string
  behaviorHints?: {
    notWebReady?: boolean
    bingeGroup?: string
    filename?: string
    videoSize?: number
    proxyHeaders?: { request?: Record<string, string>; response?: Record<string, string> }
  }
}

export interface InstalledAddon {
  transportUrl: string
  manifest: Manifest
}
