import { name, tagline } from './brand.js'

const COPY = {
  loading: ['Loading room', 'Reading the agent feed and project files.'],
  empty: ['Nothing recorded yet', 'This run has no agent activity to show yet.'],
  error: ['Could not load the room', 'The agent feed could not be read. Check the connection and try again.'],
}

export default function Notice({
  status = 'loading',
  message,
  title: heading,
  onRetry,
  retryLabel = 'Try again',
  children,
}) {
  const [title, text] = COPY[status] ?? COPY.error
  const isError = status === 'error'

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
          {(onRetry || children) && (
            <div className="notice-actions">
              {onRetry && (
                <button type="button" onClick={onRetry}>
                  {retryLabel}
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
