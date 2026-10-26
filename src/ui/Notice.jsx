import { useEffect } from 'react'
import { name, tagline } from './brand.js'

export const NOTHING_RECORDED = 'Nothing recorded yet. Replay starts with the first conversation.'

const COPY = {
  loading: ['Loading room', 'Reading the agent feed and project files.'],
  empty: ['Nothing to replay', NOTHING_RECORDED],
  error: ['Could not load the room', 'The agent feed could not be read. Check the connection and try again.'],
}

export default function Notice({
  status = 'loading',
  message,
  title: heading,
  onRetry,
  retryLabel = 'Try again',
  onLive,
  liveLabel = 'Back to live',
  onConnect,
  connectLabel = 'Connection settings',
  children,
}) {
  const [title, text] = COPY[status] ?? COPY.error
  const isError = status === 'error'

  useEffect(() => {
    const leave = onLive ?? onConnect ?? onRetry
    if (typeof leave !== 'function') return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') leave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onLive, onConnect, onRetry])

  return (
    <main className="notice" role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'}>
      <header className="notice-header">
        <p className="notice-brand mono">{name}</p>
        <p className="notice-tagline">{tagline}</p>
      </header>
      <div className="notice-panel">
        <div className="hud-header-strip">
          <h1>{heading ?? title}</h1>
        </div>
        <div className="notice-body">
          <p className="notice-message mono">{message ?? text}</p>
          {(typeof onRetry === 'function' || typeof onLive === 'function' || typeof onConnect === 'function' || children) && (
            <div className="notice-actions">
              {typeof onRetry === 'function' && (
                <button type="button" onClick={onRetry}>
                  {retryLabel}
                </button>
              )}
              {typeof onLive === 'function' && (
                <button type="button" className="notice-live" onClick={onLive}>
                  {liveLabel}
                </button>
              )}
              {typeof onConnect === 'function' && (
                <button type="button" className="notice-connect" onClick={onConnect}>
                  {connectLabel}
                </button>
              )}
              {children}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
