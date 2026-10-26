import Row from './Row'
import Poster, { PosterSkeleton } from './Poster'
import { fetchCatalog } from '../stremio/client'
import type { InstalledAddon, ManifestCatalog, MetaPreview } from '../stremio/types'
import { useAsync } from '../useAsync'
import { cachedCatalog, rememberCatalog } from '../catalogCache'

export function catalogTitle(catalog: ManifestCatalog) {
  const kind = catalog.type === 'movie' ? 'movies' : catalog.type
  return catalog.name ? `${catalog.name} ${kind}` : kind
}

export function useCatalog(addon: InstalledAddon | undefined, catalog: ManifestCatalog | undefined, extra: Record<string, string | number | undefined> = {}) {
  const extraKey = JSON.stringify(extra)
  const key = addon && catalog ? `catalog|${addon.transportUrl}|${catalog.type}|${catalog.id}|${extraKey}` : null
  // Last launch's results show instantly; the fresh ones replace them when they arrive.
  return useAsync(
    key,
    () =>
      fetchCatalog(addon!, catalog!, extra).then((metas) => {
        rememberCatalog(key!, metas)
        return metas
      }),
    key ? cachedCatalog<MetaPreview[]>(key) : undefined
  )
}

export default function CatalogRow({ addon, catalog }: { addon: InstalledAddon; catalog: ManifestCatalog }) {
  const state = useCatalog(addon, catalog)

  // A row that failed or came back empty is left out; one broken addon shouldn't clutter Home.
  if (state.status === 'error' || (state.status === 'done' && state.value.length === 0)) return null

  return (
    <Row title={catalogTitle(catalog)}>
      {state.status === 'loading'
        ? Array.from({ length: 8 }, (_, i) => <PosterSkeleton key={i} />)
        : state.value.map((m) => <Poster key={`${m.type}:${m.id}`} meta={m} />)}
    </Row>
  )
}
