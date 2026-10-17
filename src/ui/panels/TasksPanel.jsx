import { useEffect, useState } from 'react'
import IssueThread from './IssueThread.jsx'
import { statusLabel } from './format.js'

const OPEN_ORDER = {
  in_progress: 1,
  in_review: 2,
  blocked: 3,
  todo: 4,
  backlog: 5,
}

export default function TasksPanel({ client }) {
  const [issues, setIssues] = useState([])
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [selectedIssueId, setSelectedIssueId] = useState(null)

  async function loadData() {
    setLoading(true)
    setLoadError(null)
    try {
      const [issueList, agentList] = await Promise.all([
        client.issues(),
        client.agents(),
      ])
      setIssues(issueList)
      setAgents(agentList)
    } catch (err) {
      setLoadError(err.message || 'Could not load tasks.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [client])

  if (loading) {
    return <div className="panel-state mono">Loading tasks...</div>
  }

  if (loadError) {
    return (
      <div className="panel-state">
        <div className="panel-error-message">{loadError}</div>
        <button type="button" onClick={loadData}>Retry</button>
      </div>
    )
  }

  const selectedIssue = issues.find((issue) => issue.id === selectedIssueId)
  if (selectedIssue) {
    return (
      <IssueThread
        issue={selectedIssue}
        client={client}
        agents={agents}
        onBack={() => setSelectedIssueId(null)}
        onRefresh={loadData}
      />
    )
  }

  const openIssues = issues
    .filter((issue) => issue.status !== 'done' && issue.status !== 'cancelled')
    .sort((a, b) => (OPEN_ORDER[a.status] ?? 99) - (OPEN_ORDER[b.status] ?? 99))

  const finishedIssues = issues.filter(
    (issue) => issue.status === 'done' || issue.status === 'cancelled'
  )

  const agentName = (id) => agents.find((a) => a.id === id)?.name ?? 'Unassigned'

  function renderRow(issue) {
    return (
      <button
        key={issue.id}
        type="button"
        className="task-row"
        onClick={() => setSelectedIssueId(issue.id)}
      >
        <div className="task-row-top">
          <span className="task-identifier mono">{issue.identifier}</span>
          <span className="task-status mono">{statusLabel(issue.status)}</span>
          <span className="task-priority mono">{issue.priority}</span>
        </div>
        <div className="task-title">{issue.title}</div>
        <div className="task-assignee">Assignee: {agentName(issue.assigneeAgentId)}</div>
      </button>
    )
  }

  return (
    <div className="tasks-panel">
      <div className="panel-toolbar">
        <span className="panel-count mono">{issues.length} tasks</span>
        <button type="button" onClick={loadData}>Refresh</button>
      </div>

      {issues.length === 0 ? (
        <div className="panel-state is-dim mono">No tasks found.</div>
      ) : (
        <div className="tasks-list">
          {openIssues.length > 0 ? (
            <div className="tasks-group" aria-label="Open tasks">
              {openIssues.map(renderRow)}
            </div>
          ) : (
            <div className="panel-state is-dim mono">No open tasks.</div>
          )}

          {finishedIssues.length > 0 && (
            <details className="tasks-finished">
              <summary className="tasks-finished-summary">
                Finished ({finishedIssues.length})
              </summary>
              <div className="tasks-group" aria-label="Finished tasks">
                {finishedIssues.map(renderRow)}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
