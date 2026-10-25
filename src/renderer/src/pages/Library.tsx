import Poster from '../components/Poster'
import ContinueCard from '../components/ContinueCard'
import Row from '../components/Row'
import { continueWatching, titles } from '../placeholder'

export default function Library() {
  return (
    <div className="page">
      <header className="page-header">
        <h1 className="page-title">Library</h1>
      </header>
      <Row title="In progress">
        {continueWatching.map((t) => <ContinueCard key={t.id} title={t} />)}
      </Row>
      <h2 className="row-title">Saved</h2>
      <div className="grid">
        {titles.slice(0, 6).map((t) => <Poster key={t.id} title={t} />)}
      </div>
    </div>
  )
}
