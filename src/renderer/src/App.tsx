import { Navigate, Route, Routes } from 'react-router-dom'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import Home from './pages/Home'
import Discover from './pages/Discover'
import Library from './pages/Library'
import Settings from './pages/Settings'
import Detail from './pages/Detail'
import Connections from './pages/Connections'
import { useShortcuts } from './shortcuts'
import { useTraktSync } from './trakt'
import { UpdatePrompt } from './updates'

export default function App() {
  useShortcuts()
  useTraktSync()
  return (
    <div className="app">
      <div className="backdrop" aria-hidden />
      <TitleBar />
      <div className="shell">
        <Sidebar />
        <main className="content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/library" element={<Library />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/connections" element={<Connections />} />
            <Route path="/detail/:type/:id" element={<Detail />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <UpdatePrompt />
    </div>
  )
}
