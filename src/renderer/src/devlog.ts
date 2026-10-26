// Sends a line to the dev log. The main process drops it unless dev mode is on, and strips secrets first.

type Level = 'info' | 'warn' | 'error'

function toData(value: unknown): unknown {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  return value
}

export function devlog(level: Level, scope: string, message: string, data?: unknown) {
  try {
    window.matzio?.devlog.write(level, scope, message, toData(data))
  } catch {
    // Data that can't be sent over IPC isn't worth breaking anything for.
    window.matzio?.devlog.write(level, scope, message)
  }
}

/** Uncaught errors in the page, and when the first screen was drawn. */
export function installDevlog(windowName: string) {
  window.addEventListener('error', (e) => devlog('error', windowName, e.message, e.error ?? `${e.filename}:${e.lineno}`))
  window.addEventListener('unhandledrejection', (e) => devlog('error', windowName, 'Unhandled promise rejection', e.reason))
  requestAnimationFrame(() => devlog('info', 'startup', `${windowName} first paint ${Math.round(performance.now())} ms after the page started`))
}
