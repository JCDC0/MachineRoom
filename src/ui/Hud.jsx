import { Fragment, useEffect, useRef, useState } from 'react'
import { name } from './brand.js'
import Transport from './Transport.jsx'
import ControlDrawer from './panels/ControlDrawer.jsx'
import AgentDock from './AgentDock.jsx'
import Assistant from './Assistant.jsx'
import Guide from './Guide.jsx'
import Launcher from './Launcher.jsx'
import OrchestratorChat from './OrchestratorChat.jsx'
import Settings from './Settings.jsx'
import SetupCard from './SetupCard.jsx'
import Sidebar from './Sidebar.jsx'
import { agentForNumber, agentList } from './agentList.js'
import { wideLayout } from './agentStrip.js'
import { guideCanOpen, markGuideSeen, shouldShowGuide } from './guide.js'
import { healthNotice } from './healthNotice.js'
import { ladderGroups } from './ladderGroups.js'
import { lensProject } from './lens.js'
import {
  REPLAY_LINE,
  currentSessionTitle,
  drawerEntry,
  lowerBreadcrumb,
  overviewEntries,
} from './lowerHalf.js'
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

function EventLogBody({ entries, bodyRef = null }) {
  return (
    <div className="hud-log-body mono" ref={bodyRef}>
      {entries.length === 0 ? (
        <div className="log-line is-dim">No events recorded.</div>
      ) : (
        entries.map((entry, index) => {
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
  )
}

function OverviewIcon({ id }) {
  const props = {
    viewBox: '0 0 16 16',
    width: 16,
    height: 16,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }
  if (id === 'agent') {
    return (
      <svg {...props}>
        <circle cx="8" cy="5.5" r="2.5" />
        <path d="M3 13c0-2.2 2.2-3.5 5-3.5s5 1.3 5 3.5" />
      </svg>
    )
  }
  if (id === 'costs') {
    return (
      <svg {...props}>
        <path d="M3 12V8M8 12V4M13 12V6" />
      </svg>
    )
  }
  return (
    <svg {...props}>
      <circle cx="8" cy="8" r="5" />
    </svg>
  )
}

export function OverviewCard({ entries = overviewEntries(), onOpen = () => {}, hidden = false }) {
  return (
    <aside className="hud-overview" aria-label="Overview" hidden={hidden}>
      <h2 className="hud-overview-title">Overview</h2>
      <ul className="hud-overview-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className={`hud-overview-entry is-${entry.id}`}
              onClick={() => onOpen(entry.id)}
            >
              <span className="hud-overview-icon" aria-hidden="true">
                <OverviewIcon id={entry.id} />
              </span>
              <span className="hud-overview-label">{entry.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

export function LowerDrawer({
  entry = null,
  hidden = false,
  onBack = () => {},
  children = null,
}) {
  return (
    <aside
      id="hud-drawer"
      className="hud-drawer"
      aria-label={entry ? `${entry.title} drawer` : 'Drawer'}
      hidden={hidden}
    >
      <header className="hud-drawer-head">
        <button
          type="button"
          className="hud-drawer-back mono"
          onClick={onBack}
          aria-label="Back to overview"
        >
          Back
        </button>
        <h2 className="hud-drawer-title">{entry ? entry.title : ''}</h2>
      </header>
      <div className="hud-drawer-body">{children}</div>
    </aside>
  )
}

export default function Hud({
  snapshot,
  project = '',
  focused,
  speeds,
  fpsStats = null,
  markers = [],
  log = [],
  costs = null,
  liveRuns = null,
  tasks = null,
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
  ladder = null,
  helpOpen: controlledHelpOpen,
  initialHelpOpen = false,
  assistantOpen = false,
  effects = null,
  onSettingsChange = () => {},
  sidebar = null,
  settingsRequest = 0,
}) {
  const [logOpen, setLogOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [controlOpen, setControlOpen] = useState(() => Boolean(controlTarget?.nonce != null))
  const [chatOpen, setChatOpen] = useState(false)
  const [chatFocus, setChatFocus] = useState(0)
  const [chatTab, setChatTab] = useState('orchestrator')
  const [chatListOpen, setChatListOpen] = useState(false)
  const [orchestratorList, setOrchestratorList] = useState([])
  const [sessionTitle, setSessionTitle] = useState('')
  const [idleOpen, setIdleOpen] = useState(false)
  const [drawer, setDrawer] = useState(null)
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? Number(window.innerWidth) || 0 : 0
  )
  const [orchestratorNonce, setOrchestratorNonce] = useState(0)
  const [orchestratorInfo, setOrchestratorInfo] = useState(null)
  const [guideOpen, setGuideOpen] = useState(
    () => typeof window !== 'undefined' && shouldShowGuide()
  )
  const [setupChecked, setSetupChecked] = useState(
    () => mode !== 'live' || !client || typeof client.lanes !== 'function'
  )
  const [internalHelpOpen, setHelpOpen] = useState(
    () => Boolean(initialHelpOpen || controlledHelpOpen)
  )
  const helpOpen = controlledHelpOpen !== undefined ? Boolean(controlledHelpOpen) : internalHelpOpen
  const [healthOpen, setHealthOpen] = useState(false)
  const notice = healthNotice(health)
  const chatAvailable = orchestratorOn(health)
  const wide = wideLayout(viewportWidth)
  const floatingChat = !wide || mode === 'replay'
  const logBodyRef = useRef(null)
  const lowerLogRef = useRef(null)
  const settingsCountRef = useRef(Number(settingsRequest) || 0)
  const lastControlNonceRef = useRef(controlTarget?.nonce ?? null)
  const visibleLog = log.slice(-50)
  const visibleShortcuts = (client ? SHORTCUTS : SHORTCUTS.filter(([k]) => k !== 'C')).map(
    ([keys, description]) =>
      chatAvailable && keys === '/' ? [keys, 'Talk to the orchestrator'] : [keys, description]
  )

  const agents = (snapshot?.agents ?? []).map(({ key, name }) => ({ key, name }))
  const list = agentList(snapshot?.agents ?? [], idleOpen)
  const grouped = ladderGroups(list.rows, ladder)
  const nav = grouped ?? list
  const workingAgent = list.rows.find((row) => row.agent?.status === 'working')?.agent ?? null
  const activeRows = list.rows.filter((row) => row.group !== 'idle')
  const idleRows = list.rows.filter((row) => row.group === 'idle')
  const listRef = useRef(nav)
  const focusRef = useRef(onFocus)
  listRef.current = nav
  focusRef.current = onFocus
  const context = { agents, paths: assistantPaths }
  const projectLabel = lensProject(project)
  const conversationTabs = [
    { id: 'orchestrator', label: 'Main' },
    ...orchestratorList
      .filter((entry) => entry && entry.id !== 'orchestrator')
      .map((entry) => ({ id: entry.id, label: entry.name || entry.id })),
  ]
  const conversation =
    conversationTabs.find((tab) => tab.id === chatTab) ?? conversationTabs[0]
  const conversationTitle = conversation?.label ?? 'Main'

  function chooseConversation(id) {
    setChatTab(id)
    setChatListOpen(false)
    if (chatAvailable) setChatOpen(true)
  }

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
    function onResize() {
      setViewportWidth(Number(window.innerWidth) || 0)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (wide) setSessionsOpen(false)
  }, [wide])

  function openDrawer(id) {
    setDrawer(id)
    setLogOpen(false)
    setSettingsOpen(false)
  }

  function closeDrawer() {
    setDrawer(null)
  }

  function toggleLog() {
    const next = !logOpen
    setLogOpen(next)
    if (next) {
      setControlOpen(false)
      if (wide) setSettingsOpen(false)
    }
  }

  function toggleSettings() {
    const next = !settingsOpen
    setSettingsOpen(next)
    if (next && wide) {
      setControlOpen(false)
      setLogOpen(false)
    }
  }

  useEffect(() => {
    if (controlOpen) {
      setLogOpen(false)
      if (wide) setSettingsOpen(false)
    }
  }, [controlOpen, wide])

  useEffect(() => {
    if (!chatAvailable) setChatOpen(false)
  }, [chatAvailable])

  useEffect(() => {
    const next = Number(settingsRequest) || 0
    const previous = settingsCountRef.current
    if (next === previous) return
    settingsCountRef.current = next
    if (next < previous) return
    setSettingsOpen(true)
    if (wide) {
      setControlOpen(false)
      setLogOpen(false)
    }
  }, [settingsRequest, wide])

  useEffect(() => {
    if (!wide || mode === 'replay' || !client || typeof client.orchestratorSessions !== 'function') {
      setSessionTitle('')
      return undefined
    }
    let active = true
    async function readTitle() {
      try {
        const answer = await client.orchestratorSessions(
          chatTab === 'orchestrator' ? {} : { id: chatTab }
        )
        if (active) setSessionTitle(currentSessionTitle(answer))
      } catch {
        if (active) setSessionTitle('')
      }
    }
    readTitle()
    const timer = setInterval(readTitle, 60000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [client, chatTab, mode, wide, orchestratorNonce])

  useEffect(() => {
    if (!client || typeof client.orchestrators !== 'function' || (!chatAvailable && !wide)) {
      setOrchestratorInfo(null)
      return undefined
    }
    let active = true
    async function read() {
      try {
        const answer = await client.orchestrators()
        if (!active) return
        const items = Array.isArray(answer) ? answer : Array.isArray(answer?.orchestrators) ? answer.orchestrators : []
        const list = items.filter((entry) => entry && typeof entry.id === 'string' && entry.id)
        const main = list.find((entry) => entry.id === 'orchestrator') ?? null
        setOrchestratorInfo(main)
        setOrchestratorList(list)
      } catch {
        if (active) {
          setOrchestratorInfo(null)
          setOrchestratorList([])
        }
      }
    }
    read()
    const timer = setInterval(read, 60000)
    const unsubscribe =
      typeof client.subscribe === 'function'
        ? client.subscribe((notice) => {
            if (notice && notice.topic === 'orchestrator') read()
          })
        : null
    return () => {
      active = false
      clearInterval(timer)
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [chatAvailable, client, wide, orchestratorNonce])

  useEffect(() => {
    if (chatTab === 'orchestrator') return
    if (orchestratorList.length === 0) return
    if (!orchestratorList.some((entry) => entry.id === chatTab)) setChatTab('orchestrator')
  }, [chatTab, orchestratorList])

  async function changeAutocompact(id, on, percent) {
    if (!client || typeof client.setAutocompact !== 'function') {
      return { ok: false, message: 'Autocompact is not available from this bridge.' }
    }
    try {
      const answer =
        percent === undefined || percent === null
          ? await client.setAutocompact(id, on)
          : await client.setAutocompact(id, on, percent)
      setOrchestratorInfo((current) => ({
        ...(current ?? {}),
        ...(answer && typeof answer === 'object' ? answer : {}),
        id: current?.id ?? id,
        autocompact: on,
      }))
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error && error.message ? error.message : 'The bridge refused the change.',
      }
    }
  }

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
        setMenuOpen(false)
        setSessionsOpen(false)
        setChatListOpen(false)
        if (wide) setDrawer(null)
        return
      }
      if (hudKeyBlocked(event.target)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 'l' || event.key === 'L') {
        event.preventDefault()
        toggleLog()
      } else if (chatAvailable && event.key === '/') {
        event.preventDefault()
        if (floatingChat) setChatOpen(true)
        else setChatFocus((value) => value + 1)
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
  }, [client, chatAvailable, floatingChat, wide, drawer, logOpen])

  useEffect(() => {
    if (logOpen && logBodyRef.current) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight
    }
  }, [logOpen, visibleLog.length])

  useEffect(() => {
    if (wide && mode === 'replay' && lowerLogRef.current) {
      lowerLogRef.current.scrollTop = lowerLogRef.current.scrollHeight
    }
  }, [wide, mode, visibleLog.length])

  function renderAgentRow(row, indent = 0) {
    const { agent, depth, number, group, visible } = row
    const isOpen = isTerminalOpen(openTerminals, agent.key)
    const classes = [
      'hud-agent-row',
      depth > 0 ? 'is-subagent' : '',
      group === 'idle' && !visible ? 'is-idle-hidden' : '',
    ]
      .filter(Boolean)
      .join(' ')
    const left = indent + (depth > 0 ? depth * 16 : 0)
    return (
      <div
        key={agent.key}
        className={classes}
        aria-hidden={visible ? undefined : true}
        style={left > 0 ? { paddingLeft: `${left}px` } : undefined}
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

  function renderGroupHeader(group) {
    if (!group.header) return null
    const state = group.header.state
    const stateText = state ? STATUS_TEXT[state] ?? state : ''
    const count = group.header.laneCount
    return (
      <div className="hud-agent-row hud-agent-group">
        <span className="agent-name">{group.header.name}</span>
        {stateText ? <span className="agent-subtag agent-status mono">{stateText}</span> : null}
        <span className="agent-subtag agent-lane mono">{`${count} ${count === 1 ? 'lane' : 'lanes'}`}</span>
      </div>
    )
  }

  function renderIdleRow(count) {
    return (
      <div className="hud-agent-row">
        <button
          type="button"
          className="idle-toggle"
          aria-expanded={idleOpen}
          onClick={() => setIdleOpen((open) => !open)}
        >
          <span className="idle-toggle-label">{`${count} idle ${count === 1 ? 'lane' : 'lanes'}`}</span>
          <span className="agent-key mono">{idleOpen ? '-' : '+'}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="hud">
      <header className={`hud-menu${menuOpen ? ' is-open' : ''}`}>
        {wide ? (
          <div className="hud-band" role="group" aria-label="Project and conversation">
            <span className="hud-band-project">{projectLabel}</span>
            <div className="hud-band-chat">
              <button
                type="button"
                className="hud-band-switch"
                aria-expanded={chatListOpen}
                aria-haspopup="listbox"
                aria-label={`Orchestrator conversations, showing ${conversationTitle}`}
                onClick={() => setChatListOpen((open) => !open)}
              >
                <span className="hud-band-v mono" aria-hidden="true">V</span>
                <span className="hud-band-title">{conversationTitle}</span>
              </button>
              {chatListOpen && (
                <div className="hud-band-list" role="listbox" aria-label="Orchestrator conversations">
                  {conversationTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="option"
                      aria-selected={tab.id === chatTab}
                      className={`hud-band-choice${tab.id === chatTab ? ' is-current' : ''}`}
                      onClick={() => chooseConversation(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="hud-header-strip">
            <h1>{name}</h1>
            <span className="hud-status-tag">{mode === 'live' ? 'LIVE' : 'REPLAY'}</span>
          </div>
        )}

        <button
          type="button"
          className="hud-menu-toggle"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? 'Close' : 'Menu'}
        </button>

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
          {!wide && (
            <button
              type="button"
              className="hud-action"
              aria-pressed={sessionsOpen}
              aria-expanded={sessionsOpen}
              aria-controls="mr-side-overlay"
              onClick={() => {
                setMenuOpen(false)
                setSessionsOpen(true)
              }}
            >
              <span>Sessions</span>
            </button>
          )}
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
              aria-pressed={floatingChat ? chatOpen : undefined}
              aria-expanded={floatingChat ? chatOpen : undefined}
              aria-controls={floatingChat ? 'hud-orchestrator-chat' : undefined}
              onClick={() => {
                if (floatingChat) setChatOpen((open) => !open)
                else setChatFocus((value) => value + 1)
              }}
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
            onClick={toggleLog}
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
            onClick={toggleSettings}
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

      {!wide && (
        <section className="hud-dock" aria-label="Dock">
        <div className="hud-dock-agents">
          {fpsStats ? (
            <p className="hud-fps-line mono">
              {`frame ${Math.round(fpsStats.median)} ms, p95 ${Math.round(fpsStats.p95)} ms`}
            </p>
          ) : null}
          <div className="hud-agents-box">
            <nav className="hud-agents" aria-label="Agents">
              {grouped
                ? grouped.groups.map((group) => (
                    <Fragment key={group.key}>
                      {renderGroupHeader(group)}
                      {group.rows.map((row) => renderAgentRow(row, group.indent))}
                      {group.idleCount > 0 && renderIdleRow(group.idleCount)}
                      {group.idleRows.map((row) => renderAgentRow(row, group.indent))}
                    </Fragment>
                  ))
                : (
                    <>
                      {activeRows.map((row) => renderAgentRow(row))}
                      {list.idleCount > 0 && renderIdleRow(list.idleCount)}
                      {idleRows.map((row) => renderAgentRow(row))}
                    </>
                  )}
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
          {logOpen && (
            <aside id="hud-log-drawer" className="hud-log" aria-label="Event log">
              <header className="hud-log-header hud-header-strip">
                <span className="hud-log-title">Event Log</span>
                <span className="hud-log-count mono">{visibleLog.length}</span>
              </header>
              <EventLogBody entries={visibleLog} bodyRef={logBodyRef} />
            </aside>
          )}
        </div>
        <div className="hud-dock-context">
          <AgentDock
            agent={focused}
            working={workingAgent}
            lanes={snapshot?.agents ?? []}
            costs={costs}
            liveRuns={liveRuns}
            tasks={tasks}
            log={log}
            orchestrator={orchestratorInfo}
            onFocus={onFocus}
            onToggleTerminal={onToggleTerminal}
            onOpenChat={() => chatAvailable && setChatOpen(true)}
            onAutocompact={changeAutocompact}
          />
        </div>
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
        <ul className="hud-legend mono" aria-label="Legend">
          <li className="is-white">activity</li>
          <li className="is-red">failure</li>
          <li className="is-yellow">active</li>
          <li className="is-green">finished</li>
          <li className="is-line">Line from an agent: the file it is working on</li>
        </ul>
        </section>
      )}

      {!wide && (
        <Transport
          snapshot={snapshot}
          speeds={speeds}
          markers={markers}
          onToggle={onToggle}
          onSeek={onSeek}
          onSpeed={onSpeed}
        />
      )}

      {wide && (
        <Transport
          snapshot={snapshot}
          speeds={speeds}
          markers={markers}
          onToggle={onToggle}
          onSeek={onSeek}
          onSpeed={onSpeed}
        />
      )}

      {wide && settingsOpen && (
        <div className="hud-dropdown is-settings">
          <Settings
            effects={effects}
            onChange={onSettingsChange}
            onClose={() => setSettingsOpen(false)}
          />
        </div>
      )}

      {wide && logOpen && (
        <aside id="hud-log-drawer" className="hud-dropdown hud-log" aria-label="Event log">
          <header className="hud-log-header hud-header-strip">
            <span className="hud-log-title">Event Log</span>
            <span className="hud-log-count mono">{visibleLog.length}</span>
            <button type="button" className="hud-dropdown-close mono" onClick={() => setLogOpen(false)}>
              Close
            </button>
          </header>
          <EventLogBody entries={visibleLog} bodyRef={logBodyRef} />
        </aside>
      )}

      {wide && (
        <div className={`hud-lower${drawer ? ' has-drawer' : ''}`}>
          <div className="hud-lower-left">
            {sidebar ?? (
              <Sidebar
                client={client}
                live={mode === 'live'}
                project={project}
                onOpenSettings={() => {
                  setSettingsOpen(true)
                  setControlOpen(false)
                  setLogOpen(false)
                }}
              />
            )}
          </div>
          <div className="hud-lower-main">
            <p className="hud-lower-crumb mono">{lowerBreadcrumb(project, sessionTitle)}</p>
            {mode === 'replay' ? (
              <div className="hud-lower-replay">
                <div className="hud-lower-log">
                  <EventLogBody entries={visibleLog} bodyRef={lowerLogRef} />
                </div>
                <div className="hud-lower-replay-foot">
                  <p className="hud-lower-note">{REPLAY_LINE}</p>
                  <button
                    type="button"
                    className="hud-lower-connect"
                    onClick={() => onMode('live')}
                  >
                    Connect
                  </button>
                </div>
              </div>
            ) : client && chatAvailable ? (
              <OrchestratorChat
                client={client}
                open
                inline
                focusRequest={chatFocus}
                selected={chatTab}
                onSelect={setChatTab}
                onAutocompact={changeAutocompact}
                onOrchestratorChange={() => setOrchestratorNonce((value) => value + 1)}
              />
            ) : (
              <div className="hud-lower-replay">
                <div className="hud-lower-log">
                  <EventLogBody entries={visibleLog} bodyRef={lowerLogRef} />
                </div>
                <div className="hud-lower-replay-foot">
                  <p className="hud-lower-note">The orchestrator is not connected.</p>
                </div>
              </div>
            )}
          </div>
          <div className="hud-lower-right">
            <OverviewCard
              hidden={Boolean(drawer)}
              onOpen={openDrawer}
            />
            <LowerDrawer
              entry={drawer ? drawerEntry(drawer) : null}
              hidden={!drawer}
              onBack={closeDrawer}
            >
              <div className="hud-drawer-section" hidden={drawer !== 'agent'}>
                <AgentDock
                  agent={focused}
                  working={workingAgent}
                  lanes={snapshot?.agents ?? []}
                  costs={costs}
                  liveRuns={liveRuns}
                  tasks={tasks}
                  log={log}
                  orchestrator={orchestratorInfo}
                  onFocus={onFocus}
                  onToggleTerminal={onToggleTerminal}
                  onOpenChat={() => {
                    setChatFocus((value) => value + 1)
                    setDrawer(null)
                  }}
                  onAutocompact={changeAutocompact}
                />
              </div>
              <div className="hud-drawer-section" hidden={drawer !== 'costs'}>
                <div id="hud-dock-costs" className="hud-dock-costs" />
              </div>
            </LowerDrawer>
          </div>
        </div>
      )}

      {client && (
        <ControlDrawer
          client={client}
          open={controlOpen}
          onClose={() => setControlOpen(false)}
          controlTarget={controlTarget}
        />
      )}

      {!wide && sessionsOpen && (
        <div
          id="mr-side-overlay"
          className="mr-side-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Projects and conversations"
        >
          <header className="mr-side-overlay-head">
            <span className="mr-side-overlay-title mono">Sessions</span>
            <button
              type="button"
              className="mr-side-overlay-close"
              onClick={() => setSessionsOpen(false)}
            >
              Close
            </button>
          </header>
          <Sidebar
            client={client}
            live={mode === 'live'}
            project={project}
            onOpenSettings={() => {
              setSessionsOpen(false)
              setMenuOpen(false)
              toggleSettings()
            }}
          />
        </div>
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

      {guideOpen && setupChecked && <Guide mode={mode} onClose={closeGuide} />}

      {mode === 'live' && client && (
        <SetupCard client={client} onCheck={() => setSetupChecked(true)} />
      )}

      <Launcher client={client} live={mode === 'live'} />

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

      {client && chatAvailable && floatingChat && (
        <OrchestratorChat
          client={client}
          open={chatOpen}
          selected={chatTab}
          onSelect={setChatTab}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  )
}
