import { useEffect, useRef, useState } from 'react'
import Transport from './Transport.jsx'

const STATUS_TEXT = {
  idle: 'idle',
  queued: 'queued',
  working: 'working',
  error: 'failed',
  done: 'finished',
}

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
  onToggle,
  onSeek,
  onSpeed,
  onFocus,
  onOverview,
}) {
  const [logOpen, setLogOpen] = useState(false)
  const logBodyRef = useRef(null)
  const visibleLog = log.slice(-50)

  useEffect(() => {
    function onKey(event) {
      if (event.target.closest('input, textarea, select')) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 'l' || event.key === 'L') {
        event.preventDefault()
        setLogOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (logOpen && logBodyRef.current) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight
    }
  }, [logOpen, visibleLog.length])

  return (
    <div className="hud">
      <div className="hud-top-left">
        <header className="hud-title">
          <h1>Machine Room</h1>
          <p className="mono">REPLAY // {rootName}</p>
        </header>

        <ul className="hud-legend mono" aria-label="Colour legend">
          <li className="is-white">activity</li>
          <li className="is-red">failure</li>
          <li className="is-yellow">finished</li>
        </ul>
      </div>

      <div className="hud-top-right">
        <button
          type="button"
          className="hud-action"
          aria-pressed={logOpen}
          aria-expanded={logOpen}
          aria-controls="hud-log-drawer"
          onClick={() => setLogOpen((open) => !open)}
        >
          <span>Log</span>
          <span className="agent-key mono">L</span>
        </button>
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
