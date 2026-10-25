# Matzio

A calm, dark media center for Windows with Stremio addon support.

## Run it

```bash
npm install
npm run fetch-mpv  # optional: downloads mpv for Windows into resources/mpv so the app uses it
npm run dev        # opens the app with live reload
npm run dist:win   # builds a Windows installer into dist/
```

On npm 11+, approve the install scripts once if `npm install` warns about them:

```bash
npm install-scripts approve electron esbuild electron-winstaller
npm rebuild electron esbuild
```

## Player

Video plays in [mpv](https://mpv.io). Matzio looks for it in this order: the path in Settings → Player, `resources/mpv` (from `npm run fetch-mpv`), your `PATH`, then common install folders. If it isn't found, click **Browse…** in Settings and select `mpv.exe` from the folder you unzipped.

## Roadmap

1. App shell and dark glass design system
2. Stremio addons: install by URL, catalogs, title details
3. Playback with mpv, stream picker, one-click Play (first stream)
4. Continue Watching, keyboard shortcuts, installer polish
