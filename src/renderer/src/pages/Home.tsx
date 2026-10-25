import { Link } from 'react-router-dom'
import CatalogRow, { useCatalog } from '../components/CatalogRow'
import Hero from '../components/Hero'
import ContinueRow from '../components/ContinueRow'
import { useAddons } from '../stremio/addons'
import { catalogExtras } from '../stremio/client'

export default function Home() {
  const { addons, loading } = useAddons()

  // Home shows every catalog that can load without input (no required search/genre).
  const rows = addons.flatMap((addon) =>
    addon.manifest.catalogs
      .filter((c) => catalogExtras(c).required.size === 0)
      .map((catalog) => ({ addon, catalog }))
  )

  const first = rows[0]
  const featured = useCatalog(first?.addon, first?.catalog)
  const hero = featured.status === 'done' ? featured.value.find((m) => m.background) ?? featured.value[0] : undefined

  if (!loading && rows.length === 0) {
    return (
      <div className="page">
        <section className="empty-state glass">
          <h1 className="page-title">Nothing to show yet</h1>
          <p>Install an addon with catalogs, like Cinemeta, to fill your home screen.</p>
          <Link to="/settings" className="btn btn-primary">Manage addons</Link>
        </section>
      </div>
    )
  }

  return (
    <div className="page">
      {hero ? <Hero meta={hero} eyebrow="Featured" /> : <section className="hero glass skeleton" />}
      <ContinueRow />
      {rows.map(({ addon, catalog }) => (
        <CatalogRow key={`${addon.transportUrl}|${catalog.type}|${catalog.id}`} addon={addon} catalog={catalog} />
      ))}
    </div>
  )
}
