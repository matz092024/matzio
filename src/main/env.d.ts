/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Trakt API app keys, set at build time (see README). Optional: they can be entered in Settings instead. */
  readonly MAIN_VITE_TRAKT_CLIENT_ID?: string
  readonly MAIN_VITE_TRAKT_CLIENT_SECRET?: string
}
