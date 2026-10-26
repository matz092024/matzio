import { app, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

export type UpdateStatus =
  | { state: 'unsupported' }
  | { state: 'idle' | 'checking' | 'up-to-date' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

const CHECK_EVERY = 4 * 60 * 60 * 1000

/**
 * Keeps the installed app current from the GitHub Releases page.
 * New builds download quietly in the background; the app asks before restarting,
 * and an update that was put off installs the next time Matzio closes.
 */
export function registerUpdater(broadcast: (channel: string, payload: unknown) => void) {
  // Only the installed app can update itself; running from source has nothing to replace.
  let status: UpdateStatus = app.isPackaged ? { state: 'idle' } : { state: 'unsupported' }
  const set = (s: UpdateStatus) => {
    status = s
    broadcast('update:status', s)
  }

  ipcMain.handle('update:status', () => ({ version: app.getVersion(), status }))
  ipcMain.handle('update:check', () => check())
  ipcMain.handle('update:install', () => {
    // Silent reinstall into the same folder, then start Matzio again.
    if (status.state === 'ready') autoUpdater.quitAndInstall(true, true)
  })

  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // The feed always points at the newest release, so the old installer's blockmap isn't reachable for a delta.
  autoUpdater.disableDifferentialDownload = true
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => {
    if (status.state !== 'ready' && status.state !== 'downloading') set({ state: 'checking' })
  })
  autoUpdater.on('update-not-available', () => set({ state: 'up-to-date' }))
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => {
    if (status.state === 'downloading') set({ ...status, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (e) => {
    // A finished download stays ready even if a later check fails (e.g. offline).
    if (status.state !== 'ready') set({ state: 'error', message: friendly(e) })
  })

  check()
  setInterval(check, CHECK_EVERY)

  async function check() {
    if (!app.isPackaged || status.state === 'ready' || status.state === 'downloading') return
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      // Reported through the 'error' event.
    }
  }
}

function friendly(e: Error): string {
  const m = e.message || ''
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET|net::/i.test(m)) return 'Couldn’t reach GitHub. Matzio will try again later.'
  if (/404|latest\.yml/i.test(m)) return 'No update information on the Releases page yet.'
  return 'Couldn’t check for updates. Matzio will try again later.'
}
