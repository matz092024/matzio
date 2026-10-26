import { BaseWindow, BrowserWindow } from 'electron'
import { join } from 'path'

/**
 * The window id mpv's --wid draws into. HWNDs (Windows) and X11 window ids both
 * fit in the low 32 bits of the handle Electron hands back.
 */
export function nativeWindowId(win: BaseWindow): number | null {
  try {
    const buf = win.getNativeWindowHandle()
    return buf.length >= 4 ? buf.readUInt32LE(0) : null
  } catch {
    return null
  }
}

/**
 * The built-in player's two windows, stacked over the app window and pinned to it:
 *
 * - video: a clear native window with no web page, which mpv draws into. On Windows Chromium
 *   draws a window's own content above its child windows, so mpv can't draw into the app
 *   window, and this one has to stay transparent for mpv's child window to show.
 * - controls: a transparent page with Matzio's controls. It is owned by the video window,
 *   and Windows always keeps an owned window above its owner.
 */
export class PlayerSurface {
  private video: BaseWindow | null = null
  private controls: BrowserWindow | null = null

  constructor(
    private parent: BrowserWindow,
    /** Alt+F4 or anything else that closes a player window should stop playback too. */
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
    parent.on('minimize', () => {
      this.controls?.hide()
      this.video?.hide()
    })
    parent.on('restore', () => {
      this.video?.showInactive()
      this.controls?.show()
    })
  }

  /** Puts the video window over the app and returns the id mpv should draw into. */
  prepare(): number | null {
    if (!this.video || this.video.isDestroyed()) {
      const video = new BaseWindow({
        parent: this.parent,
        ...this.parent.getContentBounds(),
        show: false,
        frame: false,
        // Chromium composites a window's own surface above its child windows, so an opaque
        // background here would cover mpv's picture. Left clear, only mpv's child shows.
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        focusable: false,
        skipTaskbar: true,
        title: 'Matzio video'
      })
      video.on('closed', () => {
        const wasOpen = this.video === video
        this.video = null
        if (wasOpen) this.onClosed()
      })
      this.video = video
    }
    this.syncBounds()
    this.video.showInactive()
    return nativeWindowId(this.video)
  }

  /** Shows the controls over the video. */
  open() {
    const video = this.video
    if (!video || video.isDestroyed()) return
    if (this.controls && !this.controls.isDestroyed()) {
      this.syncBounds()
      this.controls.focus()
      return
    }
    const win = new BrowserWindow({
      parent: video,
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
    this.controls = win

    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      this.syncBounds()
      win.show()
      win.focus()
    })
    win.on('closed', () => {
      const wasOpen = this.controls === win
      this.controls = null
      if (wasOpen) this.onClosed()
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/overlay`)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/overlay' })
    }
  }

  close() {
    const { controls, video } = this
    this.controls = null
    this.video = null
    if (controls && !controls.isDestroyed()) controls.destroy()
    if (video && !video.isDestroyed()) video.destroy()
    if ((controls || video) && !this.parent.isDestroyed()) this.parent.focus()
  }

  private syncBounds() {
    if (this.parent.isDestroyed()) return
    const bounds = this.parent.getContentBounds()
    for (const win of [this.video, this.controls]) {
      if (win && !win.isDestroyed()) win.setBounds(bounds)
    }
  }
}
