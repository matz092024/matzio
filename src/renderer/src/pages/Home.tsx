import Row from '../components/Row'
import Poster from '../components/Poster'
import ContinueCard from '../components/ContinueCard'
import { ListIcon, PlayIcon, PlusIcon } from '../components/Icons'
import { artFor } from '../components/Poster'
import { continueWatching, featured, titles } from '../placeholder'
import { useSettings } from '../settings'

export default function Home() {
  const { settings } = useSettings()

  return (
    <div className="page">
      <section className="hero glass">
        <div className="hero-art" style={{ backgroundImage: artFor(featured.tone + 40) }} />
        <div className="hero-body">
          <span className="eyebrow">Up next</span>
          <h1 className="hero-title">{featured.name}</h1>
          <p className="hero-meta">{featured.episode} · {featured.year} · {featured.genres.join(', ')}</p>
          <p className="hero-synopsis">{featured.synopsis}</p>
          <div className="hero-actions">
            <button className="btn btn-primary" title={settings.quickPlay === 'first' ? 'Plays the first stream right away' : 'Lets you pick a stream'}>
              <PlayIcon width={16} height={16} />
              Play
            </button>
            <button className="btn btn-glass">
              <ListIcon width={16} height={16} />
              Choose stream
            </button>
            <button className="btn btn-icon" aria-label="Add to library">
              <PlusIcon width={18} height={18} />
            </button>
          </div>
        </div>
      </section>

      <Row title="Continue watching">
        {continueWatching.map((t) => <ContinueCard key={t.id} title={t} />)}
      </Row>
      <Row title="Popular series">
        {titles.filter((t) => t.kind === 'series').map((t) => <Poster key={t.id} title={t} />)}
      </Row>
      <Row title="Popular movies">
        {titles.filter((t) => t.kind === 'movie').map((t) => <Poster key={t.id} title={t} />)}
      </Row>
    </div>
  )
}
