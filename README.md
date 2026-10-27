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

## Trakt

Settings → Trakt links your [Trakt.tv](https://trakt.tv) account. Once connected, every movie or episode you finish (90% watched, the same mark Continue watching uses) is added to your Trakt history. Titles finished while offline are sent later.

The Watchlist (sidebar) is your Trakt watchlist. Adding or removing a movie or show in the app does the same on Trakt right away (queued and sent later when offline), and titles added or removed on trakt.tv show up in the app at start-up, every 15 minutes, and on **Sync now**. The first sync after connecting merges both lists without removing anything. Titles Trakt can't match (for example `kitsu:` ids from anime addons) stay in the app only.

1. Create an API app at [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications/new). Any name works; set the redirect URI to `urn:ietf:wg:oauth:2.0:oob`.
2. Paste its Client ID into Settings → Trakt. Apps made since October 2026 have no Client Secret (Trakt shows "Not issued… PKCE"), so leave that field empty; older apps can still paste theirs. Then click **Connect Trakt** and approve the code on trakt.tv.

The keys and sign-in are kept on your computer (encrypted with Windows' DPAPI), never in this repo. To build the keys into the installer instead, add `TRAKT_CLIENT_ID` (and `TRAKT_CLIENT_SECRET`, only if your app has one) as repository secrets (Settings → Secrets and variables → Actions); the Windows build passes them in as `MAIN_VITE_TRAKT_CLIENT_ID` and `MAIN_VITE_TRAKT_CLIENT_SECRET`, and Settings then skips the keys step. Locally, the same two variables in a `.env.local` file do this.

## Roadmap

1. App shell and dark glass design system
2. Stremio addons: install by URL, catalogs, title details
3. Playback with mpv, stream picker, one-click Play (first stream)
4. Continue Watching, keyboard shortcuts, installer polish
5. Trakt.tv watch history sync
