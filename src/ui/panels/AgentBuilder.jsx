import { useEffect, useState } from 'react'
import { visibleText } from '../../model/paths.js'
import { statusLabel } from './format.js'
import { subscribeToNotices } from './notices.js'

export const NEW_LANES_TEXT = 'New lanes are added in docs/agents/lanes.json.'
export const AGENTS_UNAVAILABLE = 'The lanes need a newer bridge.'

export default function AgentBuilder({
  client,
  initialAgents = null,
}) {
  const [agents, setAgents] = useState(() => (Array.isArray(initialAgents) ? initialAgents : []))
  const [loading, setLoading] = useState(() => !Array.isArray(initialAgents))
  const [loadError, setLoadError] = useState(null)
  const [refreshError, setRefreshError] = useState(null)
  const canRead = typeof client?.agents === 'function'

  async function loadData({ isInitial = false } = {}) {
    if (!canRead) return
    setRefreshError(null)
    if (isInitial) {
      setLoading(true)
      setLoadError(null)
    }
    try {
      const agentList = await client.agents()
      setAgents(Array.isArray(agentList) ? agentList : [])
    } catch (err) {
      if (isInitial) setLoadError(err.message || 'Could not load the lanes.')
      else setRefreshError(err?.message || 'Could not refresh the lanes.')
    } finally {
      if (isInitial) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!canRead) return
    loadData({ isInitial: true })
  }, [client])

  useEffect(() => {
    return subscribeToNotices(client, 'agents', () => {
      loadData({ isInitial: false })
    })
  }, [client])

  if (!canRead) {
    return <div className="panel-state is-dim mono">{AGENTS_UNAVAILABLE}</div>
  }

  if (loading) {
    return <div className="panel-state mono">Loading lanes...</div>
  }

  if (loadError) {
    return (
      <div className="panel-state">
        <div className="panel-error-message">{loadError}</div>
        <button type="button" onClick={() => loadData({ isInitial: true })}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="agent-builder-panel">
      <div className="panel-toolbar">
        <span className="panel-count mono">Lanes ({agents.length})</span>
        <div className="agent-builder-toolbar-actions">
          <button type="button" onClick={() => loadData({ isInitial: false })}>
            Refresh
          </button>
        </div>
      </div>

      {refreshError && <p className="panel-error-message" role="alert">{refreshError}</p>}
      <p className="agent-builder-note mono">{NEW_LANES_TEXT}</p>

      <section className="agent-builder-list-section" aria-label="Lanes">
        {agents.length === 0 ? (
          <div className="panel-state is-dim mono">No lanes found.</div>
        ) : (
          <div className="agent-builder-list">
            {agents.map((agent) => (
              <div key={agent.id} className="task-row agent-builder-row">
                <div className="task-row-top">
                  <span className="agent-row-name">{visibleText(agent.name)}</span>
                  <span className="task-status mono">
                    {statusLabel(agent.status)}
                  </span>
                  {agent.role ? <span className="task-priority mono">{visibleText(agent.role)}</span> : null}
                </div>
                <div className="task-assignee mono">
                  {visibleText(agent.adapterType)}
                  {agent.model ? ` // ${visibleText(agent.model)}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
