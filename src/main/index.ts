import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { detectMpv, Player, type PlayRequest, type PlayerState } from './player'
import { PlayerSurface } from './overlay'
import { Trakt, type ProgressItem, type WatchedItem, type WatchlistChange } from './trakt'
import { registerUpdater } from './updater'
import { registerStore } from './store'
import { log, mark, registerDevLog } from './devlog'

// Pin the data folder to %APPDATA%\Matzio so dev runs, installs and updates all share it.
app.setPath('userData', join(app.getPath('appData'), 'Matzio'))
registerDevLog()
registerStore()

/** The app window. The built-in player's video and controls windows sit pinned above it. */
let mainWindow: BrowserWindow | null = null
let surface: PlayerSurface | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#00000000',
    // Windows 11 gives us real acrylic blur behind the window; older Windows falls back to the CSS background.
    backgroundMaterial: 'acrylic',
    title: 'Matzio',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  win.once('ready-to-show', () => {
    mark('Window ready to show')
    win.show()
  })

  // Dev mode: page crashes, failed loads and script errors from the window.
  const wc = win.webContents
  wc.once('did-finish-load', () => mark('Page loaded'))
  wc.on('did-fail-load', (_e, code, description, url) => log('error', 'window', `Page failed to load (${code} ${description})`, url))
  wc.on('render-process-gone', (_e, details) => log('error', 'window', `Page process ended: ${details.reason}`, { exitCode: details.exitCode }))
  wc.on('unresponsive', () => log('warn', 'window', 'Window stopped responding'))
  wc.on('responsive', () => log('info', 'window', 'Window responding again'))
  wc.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') log(e.level === 'error' ? 'error' : 'warn', 'console', e.message, `${e.sourceId}:${e.lineNumber}`)
  })

  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))
  const sendFullscreen = () => broadcast('window:fullscreen', win.isFullScreen())
  win.on('enter-full-screen', sendFullscreen)
  win.on('leave-full-screen', sendFullscreen)

  // Playback belongs to this window, so it ends with it.
  win.on('close', () => player.stop())
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
      surface = null
    }
  })

  mainWindow = win
  surface = new PlayerSurface(win, () => player.stop())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
ipcMain.on('window:toggle-maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())

// Progress goes to every window; there is only one in practice.
const broadcast = (channel: string, payload: unknown) => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}
/** The embedded attempt in flight, so a player that can't embed can retry in its own window. */
let embedAttempt: { req: PlayRequest; startedAt: number } | null = null

const onEnded = (p: { key: string; position: number; duration: number; error?: string; mpvError?: string }) => {
  const attempt = embedAttempt
  embedAttempt = null
  // mpv quitting within a few seconds without ever opening the file usually means it
  // couldn't draw into our window, so give the same stream its own mpv window instead.
  if (attempt && p.duration === 0 && Date.now() - attempt.startedAt < 6000) {
    log('warn', 'player', `Built-in player quit after ${Date.now() - attempt.startedAt} ms without opening the file; retrying in mpv's own window`, p.error ?? p.mpvError)
    const retry = player.play({ ...attempt.req, embed: false })
    if (!retry.ok) log('error', 'player', 'Separate-window fallback failed too', retry.error)
    if (retry.ok) {
      const why = p.mpvError ? ` mpv said: ${p.mpvError}` : ''
      broadcast('player:notice', `The built-in player couldn’t start, so mpv opened in its own window.${why}`)
      return
    }
  }
  broadcast('player:ended', p)
}

const player: Player = new Player({
  onProgress: (p) => broadcast('player:progress', p),
  onEnded: (p) => onEnded(p),
  onState: (s: PlayerState) => {
    broadcast('player:state', s)
    if (s.active && s.embedded) surface?.open()
    else if (!s.active) surface?.close()
  },
  embedTarget: () => surface?.prepare() ?? null
})

ipcMain.handle('player:play', (_e, req: PlayRequest) => {
  try {
    // Whatever was starting before is being replaced on purpose, so don't retry it.
    embedAttempt = null
    const result = player.play(req)
    embedAttempt = result.ok && result.embedded ? { req, startedAt: Date.now() } : null
    if (!result.ok) {
      surface?.close()
      log('error', 'player', 'Play request failed', result.error)
    }
    return result
  } catch (e) {
    log('error', 'player', 'Play request threw', e)
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})
ipcMain.handle('player:stop', () => player.stop())
ipcMain.handle('player:state', () => player.getState())
ipcMain.handle('player:stats', () => player.stats())
ipcMain.on('player:paused', (_e, paused: boolean) => player.setPaused(paused))
ipcMain.on('player:seek-to', (_e, seconds: number) => player.seekTo(seconds))
ipcMain.on('player:seek-by', (_e, seconds: number) => player.seekBy(seconds))
ipcMain.on('player:volume', (_e, volume: number) => player.setVolume(volume))
ipcMain.on('player:muted', (_e, muted: boolean) => player.setMuted(muted))
ipcMain.on('player:track', (_e, kind: 'audio' | 'sub', id: number) => player.setTrack(kind, id))
ipcMain.on('player:progress-interval', (_e, seconds: number) => player.setProgressInterval(seconds))
ipcMain.on('player:fullscreen', (_e, full?: boolean) => {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  win.setFullScreen(full ?? !win.isFullScreen())
})
ipcMain.handle('window:is-fullscreen', () => !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen())
ipcMain.handle('player:detect', (_e, custom?: string) => detectMpv(custom))
ipcMain.handle('player:browse', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const options = {
    title: 'Select mpv.exe',
    properties: ['openFile' as const],
    filters: process.platform === 'win32' ? [{ name: 'mpv', extensions: ['exe'] }] : []
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0] ?? null
})

let trakt: Trakt

ipcMain.handle('trakt:status', () => trakt.status())
ipcMain.handle('trakt:set-app', (_e, clientId: string, clientSecret: string) => trakt.setApp(clientId, clientSecret))
ipcMain.handle('trakt:login', async () => {
  try {
    const code = await trakt.startLogin()
    // Saves a step on trakt.tv: the code is ready to paste and the activation page is open.
    clipboard.writeText(code.userCode)
    shell.openExternal(code.verificationUrl).catch(() => {})
    return { ok: true as const, ...code }
  } catch (e) {
    log('error', 'trakt', 'Sign-in could not start', e)
    return { ok: false as const, error: e instanceof Error ? e.message : 'Couldn’t reach Trakt.' }
  }
})
ipcMain.handle('trakt:cancel-login', () => trakt.cancelLogin())
ipcMain.handle('trakt:disconnect', () => trakt.disconnect())
ipcMain.handle('trakt:watched', (_e, item: WatchedItem) => trakt.markWatched(item))
ipcMain.on('trakt:progress', (_e, item: ProgressItem) => trakt.saveProgress(item))
ipcMain.handle('trakt:pull', async (_e, force?: boolean) => {
  try {
    return { ok: true as const, entries: await trakt.pull(force) }
  } catch (e) {
    log('warn', 'trakt', 'Pulling history failed', e)
    return { ok: false as const, error: e instanceof Error ? e.message : 'Couldn’t reach Trakt.' }
  }
})
ipcMain.on('trakt:watchlist', (_e, change: WatchlistChange) => trakt.updateWatchlist(change))
ipcMain.handle('trakt:pull-watchlist', async (_e, local: { id: string; type: string }[], force?: boolean) => {
  try {
    return { ok: true as const, changes: await trakt.pullWatchlist(local, force) }
  } catch (e) {
    log('warn', 'trakt', 'Pulling the watchlist failed', e)
    return { ok: false as const, error: e instanceof Error ? e.message : 'Couldn’t reach Trakt.' }
  }
})

app.whenReady().then(() => {
  mark('App ready')
  trakt = new Trakt(
    (e) => broadcast('trakt:login-result', e),
    (s) => broadcast('trakt:status', s)
  )
  // Anything finished while offline goes out at start-up and then every 15 minutes.
  trakt.flush()
  trakt.saveProgress()
  trakt.flushWatchlist()
  setInterval(() => {
    trakt.flush()
    trakt.saveProgress()
    trakt.flushWatchlist()
  }, 15 * 60 * 1000)
  registerUpdater(broadcast)
  createWindow()
  mark('Window created')
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => player.stop())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
