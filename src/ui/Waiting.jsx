import { useEffect, useState } from 'react'
import { wideLayout } from './agentStrip.js'
import { listsOrchestrator } from './orchestratorChat.js'

const STATUS_COPY = {
  connecting: {
    badge: 'Connecting',
    title: 'Connecting to the live feed',
    detail: 'Opening the live event feed. The room updates as soon as the stream answers.',
    tone: 'normal',
  },
  live: {
    badge: 'Connected',
    title: 'Waiting for the first run',
    detail: 'The room is waiting for the first run. Start one from Dispatch (C) or with npm run run-lane.',
    tone: 'live',
  },
  reconnecting: {
    badge: 'Reconnecting',
    title: 'The live feed dropped',
    detail: 'The live stream closed unexpectedly. The viewer will retry automatically.',
    tone: 'error',
  },
  disconnected: {
    badge: 'Disconnected',
    title: 'The live feed is not reachable',
    detail: 'Could not reach the live stream. Check that the bridge is running. It will retry automatically.',
    tone: 'error',
  },
}

export default function Waiting({ agents = [], status = 'connecting', orchestrator, onClose, children }) {
  const [dismissed, setDismissed] = useState(false)
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && wideLayout(window.innerWidth)
  )

  useEffect(() => {
    setDismissed(false)
  }, [status])

  useEffect(() => {
    function onResize() {
      setWide(wideLayout(window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (dismissed) return null

  const copy = STATUS_COPY[status] ?? STATUS_COPY.connecting
  const hasOrchestrator = typeof orchestrator === 'boolean' ? orchestrator : listsOrchestrator(agents)
  const detail =
    status === 'live' && hasOrchestrator
      ? wide
        ? 'Nothing is running yet. Press / or click ORCHESTRATOR at the top, and the chat sits in the lower half, under the transport.'
        : 'Nothing is running yet. Press / or click ORCHESTRATOR at the top, and the chat opens at the bottom right.'
      : copy.detail
  const names = agents.map((agent) => agent.name).filter(Boolean)
  const agentSummary =
    names.length === 0
      ? 'No agents listed yet.'
      : names.length > 4
        ? `${names.length} agents ready.`
        : `${names.length === 1 ? '1 agent ready' : `${names.length} agents ready`}: ${names.join(', ')}`

  return (
    <aside
      className={`waiting is-${copy.tone}`}
      role={copy.tone === 'error' ? 'alert' : 'status'}
      aria-live={copy.tone === 'error' ? 'assertive' : 'polite'}
    >
      <div className="waiting-card">
        <div className="waiting-header hud-header-strip">
          <span className="waiting-dot" aria-hidden="true" />
          <span className="waiting-badge mono">{copy.badge}</span>
          <button type="button" className="waiting-close mono" aria-label="Close waiting notice" title="Close" onClick={() => { setDismissed(true); onClose?.() }}>×</button>
        </div>
        <div className="waiting-body">
          <h2 className="waiting-title">
            {copy.title}
            <span className="waiting-cursor" aria-hidden="true">_</span>
          </h2>
          <p className="waiting-detail">{detail}</p>
          <p className="waiting-agents mono">{agentSummary}</p>
          {children && <div className="waiting-actions">{children}</div>}
        </div>
      </div>
    </aside>
  )
}
