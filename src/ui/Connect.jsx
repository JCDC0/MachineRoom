import { useEffect, useRef, useState } from 'react'
import { name, tagline } from './brand.js'
import { isFirstBoot } from './guide.js'
import { DEFAULT_SETTINGS } from './settings.js'

export const TOUR_QUERY = '?replay&fixture=scenario-i&tour'
export const CONNECT_INTRO =
  'MachineRoom shows coding agents working on your project as a 3D room in the browser. It follows the orchestrator, sub orchestrators and coding lanes live on your files, or replays a recorded run.'

const DEFAULT_INITIAL = {
  bridge: DEFAULT_SETTINGS.bridge,
}

export function validateBridgeUrl(value) {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return 'Enter the bridge URL.'
  if (/\s/.test(trimmed)) return 'Bridge URL must not contain spaces.'
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'Bridge URL must start with http:// or https://.'
    }
    if (!parsed.hostname) return 'Enter a valid host for the bridge URL.'
    return null
  } catch {
    return 'Enter a full http:// or https:// URL.'
  }
}

export default function Connect({
  initial = DEFAULT_INITIAL,
  error = null,
  busy = false,
  firstBoot = undefined,
  onTour,
  onSubmit,
  onReplay,
  onDemo,
}) {
  const [bridge, setBridge] = useState(initial?.bridge ?? DEFAULT_INITIAL.bridge)
  const [fieldError, setFieldError] = useState(null)
  const tourButtonRef = useRef(null)
  const bridgeInputRef = useRef(null)
  const lastInitialBridgeRef = useRef(initial?.bridge ?? DEFAULT_INITIAL.bridge)
  const boot = firstBoot !== undefined ? Boolean(firstBoot) : isFirstBoot()

  useEffect(() => {
    if (boot) tourButtonRef.current?.focus?.()
  }, [boot])

  useEffect(() => {
    const next = initial?.bridge
    if (typeof next !== 'string' || next === lastInitialBridgeRef.current) return
    const previous = lastInitialBridgeRef.current
    lastInitialBridgeRef.current = next
    setBridge((current) => (current === previous ? next : current))
  }, [initial?.bridge])

  function currentSettings() {
    return { source: 'bridge', bridge: bridge.trim() }
  }

  function handleTour() {
    if (busy) return
    if (onTour) {
      onTour()
      return
    }
    if (typeof window === 'undefined') return
    const href = `${window.location?.pathname ?? '/'}${TOUR_QUERY}`
    window.history?.replaceState?.(null, '', href)
    if (onReplay) {
      onReplay()
      return
    }
    window.location?.assign?.(href)
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (busy) return
    const problem = validateBridgeUrl(bridge)
    if (problem) {
      setFieldError(problem)
      bridgeInputRef.current?.focus()
      return
    }
    setFieldError(null)
    onSubmit?.(currentSettings())
  }

  function handleDemo() {
    if (busy) return
    setFieldError(null)
    if (onDemo) onDemo()
    else onSubmit?.({ source: 'demo', bridge: bridge.trim() })
  }

  function handleReplay() {
    if (busy) return
    onReplay?.()
  }

  return (
    <main className="connect">
      <div className="connect-shell">
        <header className="connect-header">
          <div className="connect-brand">
            <h1>{name}</h1>
            <p className="connect-tagline">{tagline}</p>
          </div>
          <ul className="hud-legend mono" aria-label="Colour legend">
            <li className="is-white">activity</li>
            <li className="is-red">failure</li>
            <li className="is-yellow">active</li>
            <li className="is-green">finished</li>
          </ul>
        </header>

        {error && (
          <div className="connect-error" role="alert">
            <span className="connect-error-label mono">Connection failed</span>
            <p>{error}</p>
          </div>
        )}

        <section className={`connect-card connect-tour${boot ? ' is-selected' : ''}`}>
          <p className="connect-intro">{CONNECT_INTRO}</p>
          <button
            ref={tourButtonRef}
            type="button"
            className="connect-tour-button mono"
            onClick={handleTour}
            disabled={busy}
            autoFocus={boot || undefined}
          >
            Take the tour
          </button>
        </section>

        <form className="connect-grid" onSubmit={handleSubmit} noValidate>
          <section className="connect-card is-selected">
            <div className="connect-card-head hud-header-strip">
              <h2>Connect through the bridge</h2>
            </div>
            <p className="connect-hint">
              After <code className="mono">npm link</code>, run <code className="mono">machineroom YOUR-PROJECT</code> in a terminal. Or run <code className="mono">npm run serve -- up --root YOUR-PROJECT</code> in the MachineRoom folder. Then open the address it prints, or paste the bridge address below.
            </p>
            <div className="connect-field">
              <div className="connect-field-row">
                <label htmlFor="connect-bridge-url" className="mono">
                  Bridge URL
                </label>
                {fieldError && (
                  <span id="connect-bridge-error" className="connect-field-error mono" role="alert">
                    {fieldError}
                  </span>
                )}
              </div>
              <input
                ref={bridgeInputRef}
                id="connect-bridge-url"
                type="url"
                className="mono"
                value={bridge}
                onChange={(event) => {
                  setBridge(event.target.value)
                  if (fieldError) setFieldError(null)
                }}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={fieldError ? 'connect-bridge-error' : undefined}
                disabled={busy}
              />
            </div>
          </section>

          <div className="connect-submit-bar">
            <button type="submit" className="connect-submit" disabled={busy}>
              {busy ? 'Connecting...' : 'Connect'}
            </button>
          </div>

          <section className="connect-card connect-choice">
            <div className="connect-card-head hud-header-strip">
              <h2>Watch the demo</h2>
              <span className="connect-tag mono">Simulated live</span>
            </div>
            <p className="connect-hint">
              Plays a recorded run through the live feed with no server.
            </p>
            <button type="button" className="connect-action" onClick={handleDemo} disabled={busy}>
              Watch the demo
            </button>
          </section>

          <section className="connect-card connect-choice">
            <div className="connect-card-head hud-header-strip">
              <h2>Replay what this page has seen</h2>
              <span className="connect-tag mono">This visit</span>
            </div>
            <p className="connect-hint">
              Plays back what this page has seen since the first conversation, with the timeline scrubber, run markers and speed controls. For a sample run, take the tour.
            </p>
            <button type="button" className="connect-action" onClick={handleReplay} disabled={busy}>
              Open the replay
            </button>
          </section>
        </form>
      </div>
    </main>
  )
}
