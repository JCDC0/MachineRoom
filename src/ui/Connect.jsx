import { useRef, useState } from 'react'
import { name, tagline } from './brand.js'
import { DEFAULT_SETTINGS } from './settings.js'

const DEFAULT_INITIAL = {
  source: DEFAULT_SETTINGS.source,
  bridge: DEFAULT_SETTINGS.bridge,
  paperclip: DEFAULT_SETTINGS.paperclip,
  company: DEFAULT_SETTINGS.company,
}

export function validateConnectUrl(source, value) {
  if (source === 'demo') return null
  const trimmed = String(value ?? '').trim()
  if (source === 'bridge') {
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
  if (source === 'paperclip') {
    if (!trimmed) return 'Enter the Paperclip URL or proxy path.'
    if (/\s/.test(trimmed)) return 'Paperclip URL must not contain spaces.'
    if (trimmed.startsWith('/')) {
      return trimmed.length > 1 ? null : 'Enter a proxy path such as /paperclip.'
    }
    try {
      const parsed = new URL(trimmed)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'Paperclip URL must start with / or http://.'
      }
      if (!parsed.hostname) return 'Enter a valid host for the Paperclip URL.'
      return null
    } catch {
      return 'Enter a path starting with / or a full http:// URL.'
    }
  }
  return null
}

export default function Connect({
  initial = DEFAULT_INITIAL,
  error = null,
  busy = false,
  onSubmit,
  onReplay,
  onDemo,
}) {
  const [source, setSource] = useState(initial?.source ?? DEFAULT_INITIAL.source)
  const [bridge, setBridge] = useState(initial?.bridge ?? DEFAULT_INITIAL.bridge)
  const [paperclip, setPaperclip] = useState(initial?.paperclip ?? DEFAULT_INITIAL.paperclip)
  const [company, setCompany] = useState(initial?.company ?? DEFAULT_INITIAL.company)
  const [fieldErrors, setFieldErrors] = useState({ bridge: null, paperclip: null })
  const bridgeInputRef = useRef(null)
  const paperclipInputRef = useRef(null)

  function currentSettings(nextSource = source) {
    return {
      source: nextSource,
      bridge: bridge.trim(),
      paperclip: paperclip.trim(),
      company: company.trim(),
    }
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (busy) return
    if (source === 'bridge') {
      const problem = validateConnectUrl('bridge', bridge)
      if (problem) {
        setFieldErrors({ bridge: problem, paperclip: null })
        bridgeInputRef.current?.focus()
        return
      }
    } else if (source === 'paperclip') {
      const problem = validateConnectUrl('paperclip', paperclip)
      if (problem) {
        setFieldErrors({ bridge: null, paperclip: problem })
        paperclipInputRef.current?.focus()
        return
      }
    }
    setFieldErrors({ bridge: null, paperclip: null })
    onSubmit?.(currentSettings(source))
  }

  function handleDemo() {
    if (busy) return
    setFieldErrors({ bridge: null, paperclip: null })
    setSource('demo')
    if (onDemo) onDemo()
    else onSubmit?.(currentSettings('demo'))
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

        <form className="connect-grid" onSubmit={handleSubmit} noValidate>
          <section className={`connect-card ${source === 'bridge' ? 'is-selected' : ''}`}>
            <div className="connect-card-head hud-header-strip">
              <label className="connect-radio-label" htmlFor="source-bridge">
                <input
                  id="source-bridge"
                  type="radio"
                  name="source"
                  value="bridge"
                  checked={source === 'bridge'}
                  onChange={() => {
                    setSource('bridge')
                    setFieldErrors((prev) => ({ ...prev, paperclip: null }))
                  }}
                />
                <span>Connect through the bridge</span>
              </label>
              <span className="connect-tag mono">Recommended</span>
            </div>
            <p className="connect-hint">
              Run <code className="mono">npm run bridge</code> in your terminal to stream agents and the project file list.
            </p>
            <div className="connect-field">
              <div className="connect-field-row">
                <label htmlFor="connect-bridge-url" className="mono">
                  Bridge URL
                </label>
                {fieldErrors.bridge && (
                  <span id="connect-bridge-error" className="connect-field-error mono" role="alert">
                    {fieldErrors.bridge}
                  </span>
                )}
              </div>
              <input
                ref={bridgeInputRef}
                id="connect-bridge-url"
                type="url"
                className="mono"
                value={bridge}
                onFocus={() => setSource('bridge')}
                onChange={(event) => {
                  setSource('bridge')
                  setBridge(event.target.value)
                  if (fieldErrors.bridge) {
                    setFieldErrors((prev) => ({ ...prev, bridge: null }))
                  }
                }}
                aria-invalid={Boolean(fieldErrors.bridge)}
                aria-describedby={fieldErrors.bridge ? 'connect-bridge-error' : undefined}
                disabled={busy}
              />
            </div>
          </section>

          <section className={`connect-card ${source === 'paperclip' ? 'is-selected' : ''}`}>
            <div className="connect-card-head hud-header-strip">
              <label className="connect-radio-label" htmlFor="source-paperclip">
                <input
                  id="source-paperclip"
                  type="radio"
                  name="source"
                  value="paperclip"
                  checked={source === 'paperclip'}
                  onChange={() => {
                    setSource('paperclip')
                    setFieldErrors((prev) => ({ ...prev, bridge: null }))
                  }}
                />
                <span>Connect to Paperclip directly</span>
              </label>
              <span className="connect-tag mono">Needs the dev server</span>
            </div>
            <p className="connect-hint">
              Connects over the Vite proxy. Folders appear as agents touch them.
            </p>
            <div className="connect-fields-pair">
              <div className="connect-field">
                <div className="connect-field-row">
                  <label htmlFor="connect-paperclip-url" className="mono">
                    Paperclip URL
                  </label>
                  {fieldErrors.paperclip && (
                    <span id="connect-paperclip-error" className="connect-field-error mono" role="alert">
                      {fieldErrors.paperclip}
                    </span>
                  )}
                </div>
                <input
                  ref={paperclipInputRef}
                  id="connect-paperclip-url"
                  type="text"
                  className="mono"
                  value={paperclip}
                  onFocus={() => setSource('paperclip')}
                  onChange={(event) => {
                    setSource('paperclip')
                    setPaperclip(event.target.value)
                    if (fieldErrors.paperclip) {
                      setFieldErrors((prev) => ({ ...prev, paperclip: null }))
                    }
                  }}
                  aria-invalid={Boolean(fieldErrors.paperclip)}
                  aria-describedby={fieldErrors.paperclip ? 'connect-paperclip-error' : undefined}
                  disabled={busy}
                />
              </div>
              <div className="connect-field">
                <div className="connect-field-row">
                  <label htmlFor="connect-company-id" className="mono">
                    Company ID (optional)
                  </label>
                </div>
                <input
                  id="connect-company-id"
                  type="text"
                  className="mono"
                  value={company}
                  placeholder="First company if blank"
                  onFocus={() => setSource('paperclip')}
                  onChange={(event) => {
                    setSource('paperclip')
                    setCompany(event.target.value)
                  }}
                  disabled={busy}
                />
              </div>
            </div>
          </section>

          <div className="connect-submit-bar">
            <button type="submit" className="connect-submit" disabled={busy}>
              {busy ? 'Connecting...' : 'Connect to Paperclip'}
            </button>
          </div>

          <section className={`connect-card connect-choice ${source === 'demo' ? 'is-selected' : ''}`}>
            <div className="connect-card-head hud-header-strip">
              <h2>Watch the demo</h2>
              <span className="connect-tag mono">Simulated live</span>
            </div>
            <p className="connect-hint">
              Plays a recorded multi-agent run through the live feed with no Paperclip server needed.
            </p>
            <button type="button" className="connect-action" onClick={handleDemo} disabled={busy}>
              Watch the demo
            </button>
          </section>

          <section className="connect-card connect-choice">
            <div className="connect-card-head hud-header-strip">
              <h2>Open the recorded replay</h2>
              <span className="connect-tag mono">5 min run</span>
            </div>
            <p className="connect-hint">
              Inspect a four-agent session with the timeline scrubber, run markers and speed controls.
            </p>
            <button type="button" className="connect-action" onClick={handleReplay} disabled={busy}>
              Open the recorded replay
            </button>
          </section>
        </form>
      </div>
    </main>
  )
}
