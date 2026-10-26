import { useEffect, useState } from 'react'

export type AsyncState<T> = { status: 'loading' } | { status: 'error'; error: Error } | { status: 'done'; value: T }

const cache = new Map<string, unknown>()
const inFlight = new Map<string, Promise<unknown>>()

/**
 * Runs `load` whenever `key` changes. Results are cached by key for the rest of the session,
 * and components asking for the same key at once share one request.
 * `stale` is an older value (e.g. from the last launch) shown while `load` runs; it stays up if `load` fails.
 */
export function useAsync<T>(key: string | null, load: () => Promise<T>, stale?: T): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>(() =>
    key && cache.has(key)
      ? { status: 'done', value: cache.get(key) as T }
      : stale !== undefined
        ? { status: 'done', value: stale }
        : { status: 'loading' }
  )

  useEffect(() => {
    if (!key) return
    if (cache.has(key)) {
      setState({ status: 'done', value: cache.get(key) as T })
      return
    }
    let active = true
    setState(stale !== undefined ? { status: 'done', value: stale } : { status: 'loading' })
    let promise = inFlight.get(key) as Promise<T> | undefined
    if (!promise) {
      promise = load()
      inFlight.set(key, promise)
      promise
        .then((value) => cache.set(key, value))
        .catch(() => {})
        .finally(() => inFlight.delete(key))
    }
    promise
      .then((value) => active && setState({ status: 'done', value }))
      .catch((error) => {
        if (active && stale === undefined) setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) })
      })
    return () => {
      active = false
    }
    // `load` is expected to change with `key`; keying on it alone avoids refetch loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}
