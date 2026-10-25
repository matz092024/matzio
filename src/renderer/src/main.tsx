import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { SettingsProvider } from './settings'
import { AddonsProvider } from './stremio/addons'
import { LibraryProvider } from './library'
import { ProgressProvider } from './progress'
import { PlaybackProvider } from './playback'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsProvider>
      <AddonsProvider>
        <LibraryProvider>
          <ProgressProvider>
            <HashRouter>
              <PlaybackProvider>
                <App />
              </PlaybackProvider>
            </HashRouter>
          </ProgressProvider>
        </LibraryProvider>
      </AddonsProvider>
    </SettingsProvider>
  </React.StrictMode>
)
