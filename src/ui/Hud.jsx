import { useEffect, useRef, useState } from 'react'
import { name } from './brand.js'
import Transport from './Transport.jsx'
import ControlDrawer from './panels/ControlDrawer.jsx'
import Assistant from './Assistant.jsx'

const STATUS_TEXT = {
  idle: 'idle',
  queued: 'queued',
  working: 'working',
  error: 'failed',
  done: 'finished',
}

const SHORTCUTS = [
  ['Space', 'Play or pause replay'],
  ['0', 'Overview camera'],
  ['1 to 9', 'Focus agent 1 to 9'],
  ['F', 'Follow the working agent: wide, close up, off'],
  ['Left and Right arrows', 'Seek backward or forward 5 seconds'],
  ['[ and ]', 'Decrease or increase replay speed'],
  ['/', 'Toggle assistant terminal'],
  ['L', 'Toggle event log'],
  ['C', 'Toggle control drawer'],
  ['?', 'Toggle keyboard help'],
]

function formatTime(ms) {
  if (ms == null) return ''
  if (typeof ms === 'string') return ms
  if (ms > 1e11) return new Date(ms).toISOString().slice(11, 19)
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = String(Math.floor(total / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export default function Hud({
  snapshot,
  focused,
  speeds,
  rootName,
  markers = [],
  log = [],
  mode = 'replay',
  onMode = () => {},
  liveAvailable = false,
  client = null,
  assistantPaths = [],
  onAssistantAction = () => {},
  askAssistant = null,
  onToggle,
  onSeek,
  onSpeed,
  onFocus,
  onOverview,
}) {
  const [logOpen, setLogOpen] = useState(false)
  const [controlOpen, setControlOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const logBodyRef = useRef(null)
  const visibleLog = log.slice(-50)
  const visibleShortcuts = client ? SHORTCUTS : SHORTCUTS.filter(([k]) => k !== 'C')

  const agents = (snapshot?.agents ?? []).map(({ key, name }) => ({ key, name }))
  const context = { agents, paths: assistantPaths }

  useEffect(() => {
    if (controlOpen) {
      setLogOpen(false)
    }
  }, [controlOpen])

  useEffect(() => {
    function onKey(event) {
      if (event.target?.closest?.('input, textarea, select')) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 'l' || event.key === 'L') {
        event.preventDefault()
        setLogOpen((open) => {
          const next = !open
          if (next) setControlOpen(false)
          return next
        })
      } else if (client && (event.key === 'c' || event.key === 'C')) {
        event.preventDefault()
        setControlOpen((open) => {
          const next = !open
          if (next) setLogOpen(false)
          return next
        })
      } else if (event.key === '?') {
        event.preventDefault()
        setHelpOpen((open) => !open)
      } else if (event.key === 'Escape') {
        setHelpOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [client])

  useEffect(() => {
    if (logOpen && logBodyRef.current) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight
    }
  }, [logOpen, visibleLog.length])

  return (
    <div className="hud">
      <header className="hud-title">
        <h1>{name}</h1>
        <p className="mono">{mode === 'live' ? 'LIVE' : 'REPLAY'} // {rootName}</p>
        <ul className="hud-legend mono" aria-label="Colour legend">
          <li className="is-white">activity</li>
          <li className="is-red">failure</li>
          <li className="is-yellow">finished</li>
        </ul>
      </header>

      <div className="hud-top-right">
        <div className="hud-modes" role="group" aria-label="Mode">
          <button
            type="button"
            aria-pressed={mode === 'replay'}
            onClick={() => onMode('replay')}
          >
            Replay
          </button>
          <button
            type="button"
            aria-pressed={mode === 'live'}
            disabled={!liveAvailable}
            onClick={() => liveAvailable && onMode('live')}
          >
            Live
          </button>
        </div>

        <div className="hud-actions">
          {client && (
            <button
              type="button"
              className="hud-action"
              aria-pressed={controlOpen}
              aria-expanded={controlOpen}
              aria-controls="hud-control-drawer"
              onClick={() => {
                setControlOpen((open) => {
                  const next = !open
                  if (next) setLogOpen(false)
                  return next
                })
              }}
            >
              <span>Control</span>
              <span className="agent-key mono">C</span>
            </button>
          )}
          <button
            type="button"
            className="hud-action"
            aria-pressed={logOpen}
            aria-expanded={logOpen}
            aria-controls="hud-log-drawer"
            onClick={() => {
              setLogOpen((open) => {
                const next = !open
                if (next) setControlOpen(false)
                return next
              })
            }}
          >
            <span>Log</span>
            <span className="agent-key mono">L</span>
          </button>
          <button
            type="button"
            className="hud-action"
            aria-pressed={helpOpen}
            aria-expanded={helpOpen}
            aria-controls="hud-help-dialog"
            aria-label="Keyboard help"
            onClick={() => setHelpOpen((open) => !open)}
          >
            <span>Help</span>
            <span className="agent-key mono">?</span>
          </button>
        </div>
      </div>

      <nav className="hud-agents" aria-label="Agents">
        {snapshot.agents.map((agent, index) => (
          <button
            key={agent.key}
            type="button"
            className={`agent is-${agent.status}`}
            aria-pressed={focused === agent.key}
            onClick={() => onFocus(agent.key)}
          >
            <span className="dot" aria-hidden="true" />
            <span className="agent-name">{agent.name}</span>
            <span className="agent-status mono">{STATUS_TEXT[agent.status] ?? agent.status}</span>
            <span className="agent-key mono">{index + 1}</span>
          </button>
        ))}
        <button
          type="button"
          className="overview"
          aria-pressed={focused === null}
          onClick={onOverview}
        >
          <span className="overview-label">Overview</span>
          <span className="agent-key mono">0</span>
        </button>
      </nav>

      {logOpen && (
        <aside id="hud-log-drawer" className="hud-log" aria-label="Event log">
          <header className="hud-log-header">
            <span className="hud-log-title">Event Log</span>
            <span className="hud-log-count mono">{visibleLog.length}</span>
          </header>
          <div className="hud-log-body mono" ref={logBodyRef}>
            {visibleLog.length === 0 ? (
              <div className="log-line is-dim">No events recorded.</div>
            ) : (
              visibleLog.map((entry, index) => {
                const stamp = formatTime(entry.time)
                return (
                  <div key={`${entry.time ?? index}-${index}`} className={`log-line is-${entry.tone ?? 'normal'}`}>
                    {stamp && <span className="log-time">{stamp}</span>}
                    {entry.agent && <span className="log-agent">{entry.agent}</span>}
                    <span className="log-text">{entry.text}</span>
                  </div>
                )
              })
            )}
          </div>
        </aside>
      )}

      {client && (
        <ControlDrawer
          client={client}
          open={controlOpen}
          onClose={() => setControlOpen(false)}
        />
      )}

      {helpOpen && (
        <div className="hud-help-backdrop" onClick={() => setHelpOpen(false)}>
          <section
            id="hud-help-dialog"
            className="hud-help"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hud-help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="hud-help-header">
              <h2 id="hud-help-title">Keyboard Shortcuts</h2>
              <button
                type="button"
                className="hud-help-close"
                onClick={() => setHelpOpen(false)}
              >
                Close
              </button>
            </header>
            <dl className="hud-shortcuts">
              {visibleShortcuts.map(([keys, description]) => (
                <div key={keys} className="hud-shortcut-row">
                  <dt className="mono">{keys}</dt>
                  <dd>{description}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}

      <Assistant
        context={context}
        onAction={onAssistantAction}
        ask={askAssistant}
      />

      <Transport
        snapshot={snapshot}
        speeds={speeds}
        markers={markers}
        onToggle={onToggle}
        onSeek={onSeek}
        onSpeed={onSpeed}
      />
    </div>
  )
}
