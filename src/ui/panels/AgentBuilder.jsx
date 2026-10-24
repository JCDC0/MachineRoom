import { useEffect, useState } from 'react'
import { visibleText } from '../../model/paths.js'
import { statusLabel } from './format.js'
import { subscribeToNotices } from './notices.js'

export const NEW_LANES_TEXT = 'New lanes are added in docs/agents/lanes.json.'

export default function AgentBuilder({
  client,
  initialAgents = null,
}) {
  const [agents, setAgents] = useState(() => (Array.isArray(initialAgents) ? initialAgents : []))
  const [loading, setLoading] = useState(() => !Array.isArray(initialAgents))
  const [loadError, setLoadError] = useState(null)

  async function loadData({ isInitial = false } = {}) {
    if (isInitial) {
      setLoading(true)
      setLoadError(null)
    }
    try {
      const agentList = await client.agents()
      setAgents(Array.isArray(agentList) ? agentList : [])
    } catch (err) {
      if (isInitial) {
        setLoadError(err.message || 'Could not load the lanes.')
      }
    } finally {
      if (isInitial) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    loadData({ isInitial: true })
  }, [client])

  useEffect(() => {
    return subscribeToNotices(client, 'agents', () => {
      loadData({ isInitial: false })
    })
  }, [client])

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
                  <span className="task-priority mono">{visibleText(agent.role)}</span>
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
