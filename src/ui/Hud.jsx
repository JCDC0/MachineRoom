import { useEffect, useRef, useState } from 'react'
import { name } from './brand.js'
import Transport from './Transport.jsx'
import ControlDrawer from './panels/ControlDrawer.jsx'
import Assistant from './Assistant.jsx'
import Guide from './Guide.jsx'
import OrchestratorChat from './OrchestratorChat.jsx'
import Settings from './Settings.jsx'
import { agentForNumber, agentList } from './agentList.js'
import { guideCanOpen, markGuideSeen, shouldShowGuide } from './guide.js'
import { healthNotice } from './healthNotice.js'
import { orchestratorOn } from './orchestratorChat.js'
import {
  areAllTerminalsOpen,
  isTerminalOpen,
  logButtonAriaLabel,
  toggleAllTerminalsLabel,
} from './terminalButtons.js'

export { agentRows } from './agentList.js'

const STATUS_TEXT = {
  idle: 'idle',
  queued: 'queued',
  working: 'working',
  error: 'failed',
  done: 'finished',
}

export const SHORTCUTS = [
  ['Space', 'Play or pause replay'],
  ['0', 'Overview camera'],
  ['1 to 9', 'Focus agent 1 to 9'],
  ['F', 'Follow the working agent: wide, close up, off'],
  ['T', 'Show or hide the log of the selected agent, or of every agent'],
  ['Left and Right arrows', 'Seek backward or forward 5 seconds'],
  ['[ and ]', 'Decrease or increase replay speed'],
  ['/', 'Open assistant terminal'],
  ['L', 'Toggle event log'],
  ['C', 'Toggle control drawer'],
  ['?', 'Toggle keyboard help'],
]

export function hudKeyBlocked(target) {
  const dialog = typeof document === 'undefined' ? null : document.querySelector('[role="dialog"]')
  return Boolean(dialog || target?.closest?.('input, textarea, select, [role="dialog"]'))
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
  fpsStats = null,
  markers = [],
  log = [],
  mode = 'replay',
  onMode = () => {},
  liveAvailable = false,
  client = null,
  assistantPaths = [],
  onAssistantAction = () => {},
  askAssistant = null,
  controlTarget = null,
  onToggle,
  onSeek,
  onSpeed,
  onFocus,
  onOverview,
  openTerminals = [],
  onToggleTerminal = () => {},
  onShowTerminals = () => {},
  health = null,
  helpOpen: controlledHelpOpen,
  initialHelpOpen = false,
  assistantOpen = false,
  effects = null,
  onSettingsChange = () => {},
}) {
  const [logOpen, setLogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [controlOpen, setControlOpen] = useState(() => Boolean(controlTarget?.nonce != null))
  const [chatOpen, setChatOpen] = useState(false)
  const [idleOpen, setIdleOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(
    () => typeof window !== 'undefined' && shouldShowGuide() && guideCanOpen(document)
  )
  const [internalHelpOpen, setHelpOpen] = useState(
    () => Boolean(initialHelpOpen || controlledHelpOpen)
  )
  const helpOpen = controlledHelpOpen !== undefined ? Boolean(controlledHelpOpen) : internalHelpOpen
  const [healthOpen, setHealthOpen] = useState(false)
  const notice = healthNotice(health)
  const chatAvailable = orchestratorOn(health)
  const logBodyRef = useRef(null)
  const lastControlNonceRef = useRef(controlTarget?.nonce ?? null)
  const visibleLog = log.slice(-50)
  const visibleShortcuts = (client ? SHORTCUTS : SHORTCUTS.filter(([k]) => k !== 'C')).map(
    ([keys, description]) =>
      chatAvailable && keys === '/' ? [keys, 'Talk to the orchestrator'] : [keys, description]
  )

  const agents = (snapshot?.agents ?? []).map(({ key, name }) => ({ key, name }))
  const list = agentList(snapshot?.agents ?? [], idleOpen)
  const activeRows = list.rows.filter((row) => row.group !== 'idle')
  const idleRows = list.rows.filter((row) => row.group === 'idle')
  const listRef = useRef(list)
  const focusRef = useRef(onFocus)
  listRef.current = list
  focusRef.current = onFocus
  const idleLabel = `${list.idleCount} idle ${list.idleCount === 1 ? 'lane' : 'lanes'}`
  const context = { agents, paths: assistantPaths }

  function closeGuide() {
    markGuideSeen()
    setGuideOpen(false)
  }

  function openGuide() {
    if (typeof document === 'undefined' || !guideCanOpen(document)) return
    setHelpOpen(false)
    setGuideOpen(true)
  }

  useEffect(() => {
    if (controlOpen) {
      setLogOpen(false)
    }
  }, [controlOpen])

  useEffect(() => {
    if (!chatAvailable) setChatOpen(false)
  }, [chatAvailable])

  useEffect(() => {
    function onKey(event) {
      if (!/^[1-9]$/.test(event.key)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (hudKeyBlocked(event.target)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const agent = agentForNumber(listRef.current, event.key)
      if (agent) focusRef.current(agent.key)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    if (controlTarget?.nonce != null) {
      if (controlTarget.nonce !== lastControlNonceRef.current) {
        lastControlNonceRef.current = controlTarget.nonce
        setControlOpen(true)
        setLogOpen(false)
      }
    } else {
      lastControlNonceRef.current = null
    }
  }, [controlTarget])

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') {
        setHelpOpen(false)
        setHealthOpen(false)
        setSettingsOpen(false)
        return
      }
      if (hudKeyBlocked(event.target)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 'l' || event.key === 'L') {
        event.preventDefault()
        setLogOpen((open) => {
          const next = !open
          if (next) setControlOpen(false)
          return next
        })
      } else if (chatAvailable && event.key === '/') {
        event.preventDefault()
        setChatOpen(true)
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [client, chatAvailable])

  useEffect(() => {
    if (logOpen && logBodyRef.current) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight
    }
  }, [logOpen, visibleLog.length])

  function renderAgentRow({ agent, depth, number, group, visible }) {
    const isOpen = isTerminalOpen(openTerminals, agent.key)
    const classes = [
      'hud-agent-row',
      depth > 0 ? 'is-subagent' : '',
      group === 'idle' && !visible ? 'is-idle-hidden' : '',
    ]
      .filter(Boolean)
      .join(' ')
    return (
      <div
        key={agent.key}
        className={classes}
        aria-hidden={visible ? undefined : true}
        style={depth > 0 ? { paddingLeft: `${depth * 16}px` } : undefined}
      >
        <button
          type="button"
          className={`agent is-${agent.status}`}
          aria-pressed={focused === agent.key}
          onClick={() => onFocus(agent.key)}
        >
          <span className="agent-head">
            <span className="dot" aria-hidden="true" />
            <span className="agent-name">{agent.name}</span>
            {number !== null && <span className="agent-key mono">{number}</span>}
          </span>
          <span className="agent-subtags mono">
            <span className="agent-subtag agent-lane">{agent.key}</span>
            <span className="agent-subtag agent-status">{STATUS_TEXT[agent.status] ?? agent.status}</span>
            {depth > 0 && <span className="agent-subtag agent-subagent">subagent</span>}
          </span>
        </button>
        <button
          type="button"
          className="agent-log"
          aria-pressed={isOpen}
          aria-label={logButtonAriaLabel(agent.name, isOpen)}
          onClick={() => onToggleTerminal(agent.key)}
        >
          Log
        </button>
      </div>
    )
  }

  return (
    <div className="hud">
      <header className="hud-menu">
        <div className="hud-header-strip">
          <h1>{name}</h1>
          <span className="hud-status-tag">{mode === 'live' ? 'LIVE' : 'REPLAY'}</span>
        </div>

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
          {client && chatAvailable && (
            <button
              type="button"
              className="hud-action"
              aria-pressed={chatOpen}
              aria-expanded={chatOpen}
              aria-controls="hud-orchestrator-chat"
              onClick={() => setChatOpen((open) => !open)}
            >
              <span>Orchestrator</span>
              <span className="agent-key mono">/</span>
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
            aria-pressed={settingsOpen}
            aria-expanded={settingsOpen}
            aria-controls="hud-settings"
            aria-label="Settings"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <span>Settings</span>
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

        {notice && (
          <div className={`hud-health is-${notice.tone}`}>
            <button
              type="button"
              className="hud-health-chip mono"
              onClick={() => setHealthOpen((open) => !open)}
              aria-expanded={healthOpen}
            >
              {notice.title}
            </button>
            {healthOpen && (
              <div className="hud-health-popover" role="dialog" aria-label="Health details">
                <ul className="hud-health-lines mono">
                  {notice.lines.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="hud-health-close mono"
                  onClick={() => setHealthOpen(false)}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      <section className="hud-dock" aria-label="Dock">
        <div className="hud-dock-agents">
          {fpsStats ? (
            <p className="hud-fps-line mono">
              {`frame ${Math.round(fpsStats.median)} ms, p95 ${Math.round(fpsStats.p95)} ms`}
            </p>
          ) : null}
          <div className="hud-agents-box">
            <nav className="hud-agents" aria-label="Agents">
              {activeRows.map(renderAgentRow)}
              {list.idleCount > 0 && (
                <div className="hud-agent-row">
                  <button
                    type="button"
                    className="idle-toggle"
                    aria-expanded={idleOpen}
                    onClick={() => setIdleOpen((open) => !open)}
                  >
                    <span className="idle-toggle-label">{idleLabel}</span>
                    <span className="agent-key mono">{idleOpen ? '-' : '+'}</span>
                  </button>
                </div>
              )}
              {idleRows.map(renderAgentRow)}
              <div className="hud-agent-row">
                <button
                  type="button"
                  className="overview"
                  aria-pressed={focused === null}
                  onClick={onOverview}
                >
                  <span className="overview-label">Overview</span>
                  <span className="agent-key mono">0</span>
                </button>
                <button
                  type="button"
                  className="agent-log"
                  aria-pressed={areAllTerminalsOpen(snapshot?.agents, openTerminals)}
                  onClick={() => onShowTerminals(!areAllTerminalsOpen(snapshot?.agents, openTerminals))}
                >
                  {toggleAllTerminalsLabel(snapshot?.agents, openTerminals)}
                </button>
              </div>
            </nav>
          </div>
          <ul className="hud-legend mono" aria-label="Legend">
            <li className="is-white">activity</li>
            <li className="is-red">failure</li>
            <li className="is-yellow">active</li>
            <li className="is-green">finished</li>
            <li className="is-line">Line from an agent: the file it is working on</li>
          </ul>
          {logOpen && (
            <aside id="hud-log-drawer" className="hud-log" aria-label="Event log">
              <header className="hud-log-header hud-header-strip">
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
        </div>
        <div className="hud-dock-context" />
        <div className="hud-dock-side">
          {settingsOpen && (
            <Settings
              effects={effects}
              onChange={onSettingsChange}
              onClose={() => setSettingsOpen(false)}
            />
          )}
          <div id="hud-dock-costs" className="hud-dock-costs" />
        </div>
      </section>

      {client && (
        <ControlDrawer
          client={client}
          open={controlOpen}
          onClose={() => setControlOpen(false)}
          controlTarget={controlTarget}
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
            <header className="hud-help-header hud-header-strip">
              <h2 id="hud-help-title">Keyboard Shortcuts</h2>
              <button type="button" className="hud-help-close" onClick={openGuide}>
                Guide
              </button>
              <button
                type="button"
                className="hud-help-close"
                onClick={() => setHelpOpen(false)}
              >
                Close
              </button>
            </header>
            <ol className="hud-shortcuts hud-index-list">
              {visibleShortcuts.map(([keys, description], index) => (
                <li key={keys} className="hud-shortcut-row">
                  <span className="hud-index-rule mono" aria-hidden="true">│</span>
                  <span className="hud-index-num mono">{index + 1}</span>
                  <span className="hud-shortcut-key mono">{keys}</span>
                  <span className="hud-shortcut-desc">{description}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}

      {guideOpen && <Guide onClose={closeGuide} />}

      {!chatAvailable && (
        <Assistant
          context={context}
          onAction={onAssistantAction}
          onAssistantAction={onAssistantAction}
          ask={askAssistant}
          askAssistant={askAssistant}
          initialOpen={assistantOpen}
        />
      )}

      {client && chatAvailable && (
        <OrchestratorChat
          client={client}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
        />
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
