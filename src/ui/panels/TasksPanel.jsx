import { useEffect, useRef, useState } from 'react'
import { visibleText } from '../../model/paths.js'
import IssueThread from './IssueThread.jsx'
import { statusLabel } from './format.js'
import { resolveIssue, subscribeToNotices } from './notices.js'

const OPEN_ORDER = {
  in_progress: 1,
  in_review: 2,
  blocked: 3,
  todo: 4,
  backlog: 5,
}

export function openRank(status) {
  return Object.hasOwn(OPEN_ORDER, status) ? OPEN_ORDER[status] : 99
}

export function liveRunMark(issueId, runs, agents = []) {
  const mine = (Array.isArray(runs) ? runs : []).filter((run) => run?.issueId === issueId && (run.status === 'running' || run.status === 'queued'))
  const run = mine.find((item) => item.status === 'running') ?? mine[0]
  if (!run) return null
  const name = run.agentName ?? agents.find((agent) => agent.id === run.agentId)?.name ?? 'agent'
  return { status: run.status, text: `${run.status} ${visibleText(name)}` }
}

export default function TasksPanel({ client, controlTarget = null, initialIssues = null, initialAgents = null, initialLiveRuns = null }) {
  const [issues, setIssues] = useState(() => (Array.isArray(initialIssues) ? initialIssues : []))
  const [agents, setAgents] = useState(() => (Array.isArray(initialAgents) ? initialAgents : []))
  const [liveRuns, setLiveRuns] = useState(() => (Array.isArray(initialLiveRuns) ? initialLiveRuns : []))
  const [loading, setLoading] = useState(() => initialIssues == null)
  const [loadError, setLoadError] = useState(null)
  const [selectedIssueId, setSelectedIssueId] = useState(null)
  const [notice, setNotice] = useState(null)
  const lastHandledNonceRef = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function loadData({ isInitial = false } = {}) {
    if (isInitial) {
      setLoading(true)
      setLoadError(null)
    }
    try {
      const [issueList, agentList] = await Promise.all([
        client.issues(),
        client.agents(),
      ])
      setIssues(issueList)
      setAgents(agentList)
    } catch (err) {
      if (isInitial) {
        setLoadError(err.message || 'Could not load tasks.')
      }
    } finally {
      if (isInitial) {
        setLoading(false)
      }
    }
  }

  async function refreshLiveRuns() {
    try {
      const runs = await client.liveRuns()
      if (mountedRef.current) setLiveRuns(Array.isArray(runs) ? runs : [])
    } catch {
      if (mountedRef.current) setLiveRuns([])
    }
  }

  async function refreshIssues() {
    try {
      const issueList = await client.issues()
      setIssues(issueList)
    } catch {
      return
    }
  }

  useEffect(() => {
    if (initialIssues == null) loadData({ isInitial: true })
    refreshLiveRuns()
  }, [client])

  useEffect(() => {
    return subscribeToNotices(client, 'liveRuns', () => {
      refreshLiveRuns()
    })
  }, [client])

  useEffect(() => {
    return subscribeToNotices(client, 'issues', () => {
      refreshIssues()
    })
  }, [client])

  useEffect(() => {
    if (loading || loadError) return
    if (controlTarget?.nonce == null) {
      lastHandledNonceRef.current = null
      return
    }
    if (controlTarget.nonce === lastHandledNonceRef.current) return

    lastHandledNonceRef.current = controlTarget.nonce

    const rawId = controlTarget.issueIdentifier
    const targetIdentifier = typeof rawId === 'string' ? rawId.trim() : (rawId != null ? String(rawId).trim() : '')
    if (!targetIdentifier) {
      setSelectedIssueId(null)
      setNotice(null)
      return
    }

    resolveIssue(targetIdentifier, issues, () => client.issues())
      .then(({ issue, issues: fresh }) => {
        if (!mountedRef.current) return
        if (fresh !== issues) setIssues(fresh)
        setSelectedIssueId(issue ? issue.id : null)
        setNotice(issue ? null : 'That task was not found.')
      })
      .catch(() => {
        if (!mountedRef.current) return
        setSelectedIssueId(null)
        setNotice('That task was not found.')
      })
  }, [loading, loadError, issues, controlTarget])

  if (loading) {
    return <div className="panel-state mono">Loading tasks...</div>
  }

  if (loadError) {
    return (
      <div className="panel-state">
        <div className="panel-error-message">{loadError}</div>
        <button type="button" onClick={() => loadData({ isInitial: true })}>Retry</button>
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
        onBack={() => {
          setSelectedIssueId(null)
          setNotice(null)
        }}
        onRefresh={() => loadData({ isInitial: false })}
      />
    )
  }

  const openIssues = issues
    .filter((issue) => issue.status !== 'done' && issue.status !== 'cancelled')
    .sort((a, b) => openRank(a.status) - openRank(b.status))

  const finishedIssues = issues.filter(
    (issue) => issue.status === 'done' || issue.status === 'cancelled'
  )

  const agentName = (id) => agents.find((a) => a.id === id)?.name ?? 'Unassigned'

  function renderRow(issue) {
    const mark = liveRunMark(issue.id, liveRuns, agents)
    return (
      <button
        key={issue.id}
        type="button"
        className="task-row"
        onClick={() => {
          setNotice(null)
          setSelectedIssueId(issue.id)
        }}
      >
        <div className="task-row-top">
          <span className="task-identifier mono">{issue.identifier}</span>
          <span className="task-status mono">{statusLabel(issue.status)}</span>
          {mark && <span className={`task-live mono is-${mark.status}`}>{mark.text}</span>}
          <span className="task-priority mono">{issue.priority}</span>
        </div>
        <div className="task-title">{issue.title}</div>
        <div className="task-assignee">Assignee: {agentName(issue.assigneeAgentId)}</div>
      </button>
    )
  }

  return (
    <div className="tasks-panel">
      {notice && (
        <div className="panel-banner is-error" role="alert">
          {notice}
        </div>
      )}

      <div className="panel-toolbar">
        <span className="panel-count mono">{issues.length} tasks</span>
        <button type="button" onClick={() => loadData({ isInitial: false })}>Refresh</button>
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
