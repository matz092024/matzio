import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { detectMpv, Player, type PlayRequest } from './player'
import { registerStore } from './store'

// Pin the data folder to %APPDATA%\Matzio so dev runs, installs and updates all share it.
app.setPath('userData', join(app.getPath('appData'), 'Matzio'))
registerStore()

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

  win.once('ready-to-show', () => win.show())

  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))

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
const player = new Player(
  (p) => broadcast('player:progress', p),
  (p) => broadcast('player:ended', p)
)

ipcMain.handle('player:play', (_e, req: PlayRequest) => {
  try {
    return player.play(req)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})
ipcMain.handle('player:stop', () => player.stop())
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

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => player.stop())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
