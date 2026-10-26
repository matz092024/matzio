import { BrowserWindow } from 'electron'
import { join } from 'path'

/**
 * The window id mpv's --wid draws into. HWNDs (Windows) and X11 window ids both
 * fit in the low 32 bits of the handle Electron hands back.
 */
export function nativeWindowId(win: BrowserWindow): number | null {
  try {
    const buf = win.getNativeWindowHandle()
    return buf.length >= 4 ? buf.readUInt32LE(0) : null
  } catch {
    return null
  }
}

/**
 * The player controls. mpv paints a child window on top of the Matzio window, and nothing
 * drawn by the web page can sit above that, so the controls live in their own transparent
 * window that is pinned over the app window and owned by it.
 */
export class ControlsOverlay {
  private win: BrowserWindow | null = null
  private syncing = false

  constructor(
    private parent: BrowserWindow,
    /** Alt+F4 or anything else that closes the overlay should stop playback too. */
    private onClosed: () => void
  ) {
    const sync = () => this.syncBounds()
    parent.on('move', sync)
    parent.on('resize', sync)
    parent.on('maximize', sync)
    parent.on('unmaximize', sync)
    parent.on('restore', sync)
    parent.on('enter-full-screen', sync)
    parent.on('leave-full-screen', sync)
    parent.on('minimize', () => this.win?.hide())
    parent.on('restore', () => this.win?.show())
  }

  isOpen() {
    return !!this.win && !this.win.isDestroyed()
  }

  open() {
    if (this.isOpen()) {
      this.syncBounds()
      this.win!.focus()
      return
    }
    const win = new BrowserWindow({
      parent: this.parent,
      ...this.parent.getContentBounds(),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      title: 'Matzio player',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false
      }
    })
    this.win = win

    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      this.syncBounds()
      win.show()
      win.focus()
    })
    win.on('closed', () => {
      const wasOpen = this.win === win
      this.win = null
      if (wasOpen) this.onClosed()
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/overlay`)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/overlay' })
    }
  }

  close() {
    const win = this.win
    if (!win) return
    this.win = null
    if (!win.isDestroyed()) win.destroy()
    if (!this.parent.isDestroyed()) this.parent.focus()
  }

  private syncBounds() {
    const win = this.win
    if (!win || win.isDestroyed() || this.parent.isDestroyed() || this.syncing) return
    this.syncing = true
    try {
      win.setBounds(this.parent.getContentBounds())
    } finally {
      this.syncing = false
    }
  }
}
