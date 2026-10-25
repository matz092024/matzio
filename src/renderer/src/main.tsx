import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { SettingsProvider } from './settings'
import { AddonsProvider } from './stremio/addons'
import { LibraryProvider } from './library'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsProvider>
      <AddonsProvider>
        <LibraryProvider>
          <HashRouter>
            <App />
          </HashRouter>
        </LibraryProvider>
      </AddonsProvider>
    </SettingsProvider>
  </React.StrictMode>
)
