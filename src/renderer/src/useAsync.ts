import { useEffect, useState } from 'react'
import { devlog } from './devlog'

export type AsyncState<T> = { status: 'loading' } | { status: 'error'; error: Error } | { status: 'done'; value: T }

const cache = new Map<string, unknown>()
const inFlight = new Map<string, Promise<unknown>>()
// Start-up timing for the dev log: when the first saved and the first fresh result reached the screen.
const firstShown = { saved: false, fresh: false }
function noteFirst(kind: 'saved' | 'fresh') {
  if (firstShown[kind]) return
  firstShown[kind] = true
  devlog('info', 'startup', `First ${kind === 'saved' ? 'saved' : 'fresh'} result on screen ${Math.round(performance.now())} ms after the page started`)
}

/**
 * Runs `load` whenever `key` changes. Results are cached by key for the rest of the session,
 * and components asking for the same key at once share one request.
 * With `persist`, the last result is also kept on disk and shown straight away on the next start
 * while the fresh one loads; if loading then fails, the saved result stays on screen.
 */
export function useAsync<T>(key: string | null, load: () => Promise<T>, persist = false): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>(() =>
    key && cache.has(key) ? { status: 'done', value: cache.get(key) as T } : { status: 'loading' }
  )

  useEffect(() => {
    if (!key) return
    if (cache.has(key)) {
      setState({ status: 'done', value: cache.get(key) as T })
      return
    }
    let active = true
    let fresh = false
    setState({ status: 'loading' })
    const disk = persist ? window.matzio?.cache : undefined
    let promise = inFlight.get(key) as Promise<T> | undefined
    if (!promise) {
      promise = load()
      inFlight.set(key, promise)
      promise
        .then((value) => {
          cache.set(key, value)
          disk?.set(key, value)
        })
        .catch(() => {})
        .finally(() => inFlight.delete(key))
    }
    const saved = (disk?.get(key) ?? Promise.resolve(null)).catch(() => null) as Promise<T | null>
    saved.then((value) => {
      if (active && !fresh && value != null) {
        setState({ status: 'done', value })
        noteFirst('saved')
      }
    })
    promise
      .then((value) => {
        fresh = true
        if (active) {
          setState({ status: 'done', value })
          noteFirst('fresh')
        }
      })
      .catch(async (error) => {
        // Offline or the addon is down: fall back to what was saved last time, if anything.
        const value = await saved
        if (!active) return
        if (value != null) setState({ status: 'done', value })
        else setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) })
      })
    return () => {
      active = false
    }
    // `load` is expected to change with `key`; keying on it alone avoids refetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}
