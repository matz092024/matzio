import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { SettingsProvider } from './settings'
import { AddonsProvider } from './stremio/addons'
import { LibraryProvider } from './library'
import { ProgressProvider } from './progress'
import { PlaybackProvider } from './playback'
import PlayerOverlay from './player/PlayerOverlay'
import './styles/global.css'
import { installDevlog } from './devlog'

const root = ReactDOM.createRoot(document.getElementById('root')!)

// The player controls run in their own transparent window over the embedded video,
// so they load the same bundle with nothing but the theme around them.
if (/^#\/?overlay/.test(window.location.hash)) {
  document.body.classList.add('overlay-body')
  installDevlog('overlay')
  root.render(
    <React.StrictMode>
      <SettingsProvider persist={false}>
        <PlayerOverlay />
      </SettingsProvider>
    </React.StrictMode>
  )
} else {
  installDevlog('app')
  root.render(
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
}
