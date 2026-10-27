import { Link } from 'react-router-dom'
import Poster from '../components/Poster'
import { useLibrary } from '../library'

export default function Library() {
  const { items } = useLibrary()

  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Watchlist</h1>
      </header>
      {items.length === 0 ? (
        <section className="empty-state glass">
          <p>Titles you save with the + button show up here, and on your Trakt watchlist when Trakt is connected.</p>
          <Link to="/discover" className="btn btn-glass">Find something</Link>
        </section>
      ) : (
        <div className="grid">
          {items.map((m) => <Poster key={`${m.type}:${m.id}`} meta={m} />)}
        </div>
      )}
    </div>
  )
}
