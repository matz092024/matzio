import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchManifest, normalizeManifestUrl } from './client'
import type { InstalledAddon } from './types'
import { readJson, writeJson } from '../storage'

export const CINEMETA_URL = 'https://v3-cinemeta.strem.io/manifest.json'

const STORAGE_KEY = 'matzio.addons'

interface AddonsContextValue {
  addons: InstalledAddon[]
  /** True until the default catalog addon has loaded on first run. */
  loading: boolean
  install: (url: string) => Promise<InstalledAddon>
  remove: (transportUrl: string) => void
  move: (transportUrl: string, delta: -1 | 1) => void
}

const AddonsContext = createContext<AddonsContextValue | null>(null)

export function AddonsProvider({ children }: { children: ReactNode }) {
  // Checked before anything is saved, so a fresh install can be told apart from an empty addon list.
  const [firstRun] = useState(() => readJson<InstalledAddon[] | null>(STORAGE_KEY, null) === null)
  const [addons, setAddons] = useState<InstalledAddon[]>(() => readJson(STORAGE_KEY, []))
  const [loading, setLoading] = useState(firstRun)

  useEffect(() => writeJson(STORAGE_KEY, addons), [addons])

  // First run: start with Cinemeta so Home and Discover have something to show.
  useEffect(() => {
    if (!firstRun) return
    fetchManifest(CINEMETA_URL)
      .then((manifest) => setAddons((list) => (list.length ? list : [{ transportUrl: CINEMETA_URL, manifest }])))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [firstRun])

  const install = async (input: string) => {
    const transportUrl = normalizeManifestUrl(input)
    const manifest = await fetchManifest(transportUrl)
    if (manifest.behaviorHints?.configurationRequired) {
      throw new Error(`${manifest.name} needs to be configured first. Open its configure page, then paste the link it gives you.`)
    }
    const addon = { transportUrl, manifest }
    setAddons((list) => {
      const existing = list.findIndex((a) => a.transportUrl === transportUrl || a.manifest.id === manifest.id)
      if (existing === -1) return [...list, addon]
      // Reinstalling (e.g. with new settings) replaces it in place and keeps its position.
      return list.map((a, i) => (i === existing ? addon : a))
    })
    return addon
  }

  const remove = (transportUrl: string) => setAddons((list) => list.filter((a) => a.transportUrl !== transportUrl))

  const move = (transportUrl: string, delta: -1 | 1) =>
    setAddons((list) => {
      const i = list.findIndex((a) => a.transportUrl === transportUrl)
      const j = i + delta
      if (i === -1 || j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  return <AddonsContext.Provider value={{ addons, loading, install, remove, move }}>{children}</AddonsContext.Provider>
}

export function useAddons() {
  const ctx = useContext(AddonsContext)
  if (!ctx) throw new Error('useAddons must be used inside AddonsProvider')
  return ctx
}
