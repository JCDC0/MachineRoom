import { useEffect, useState } from 'react'
import { approvalTypeLabel, statusLabel, timeAgo } from './format.js'

export default function ApprovalsPanel({ client, onPendingCountChange }) {
  const [approvals, setApprovals] = useState([])
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [notes, setNotes] = useState({})
  const [decidingId, setDecidingId] = useState(null)
  const [decisionErrors, setDecisionErrors] = useState({})

  async function loadData() {
    setLoading(true)
    setLoadError(null)
    try {
      const [approvalList, agentList] = await Promise.all([
        client.approvals(),
        client.agents(),
      ])
      setApprovals(approvalList)
      setAgents(agentList)
    } catch (err) {
      setLoadError(err.message || 'Could not load approvals.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [client])

  useEffect(() => {
    const pendingCount = approvals.filter((a) => a.status === 'pending').length
    onPendingCountChange?.(pendingCount)
  }, [approvals, onPendingCountChange])

  async function handleDecision(id, decision) {
    setDecidingId(id)
    setDecisionErrors((prev) => ({ ...prev, [id]: null }))
    const note = notes[id]?.trim()
    try {
      const updated = await client.decideApproval(id, decision, note || undefined)
      setApprovals((prev) =>
        prev.map((item) => (item.id === id ? { ...updated, justDecided: true } : item))
      )
    } catch (err) {
      setDecisionErrors((prev) => ({ ...prev, [id]: err.message || 'Decision failed.' }))
    } finally {
      setDecidingId(null)
    }
  }

  if (loading) {
    return <div className="panel-state mono">Loading approvals...</div>
  }

  if (loadError) {
    return (
      <div className="panel-state">
        <div className="panel-error-message">{loadError}</div>
        <button type="button" onClick={loadData}>Retry</button>
      </div>
    )
  }

  const requesterName = (id) => agents.find((a) => a.id === id)?.name ?? 'Paperclip'

  const activePending = approvals.filter((a) => a.status === 'pending' || a.justDecided)
  const decidedList = approvals.filter((a) => a.status !== 'pending' && !a.justDecided)

  return (
    <div className="approvals-panel">
      <div className="panel-toolbar">
        <span className="panel-count mono">
          {approvals.filter((a) => a.status === 'pending').length} pending
        </span>
        <button type="button" onClick={loadData}>Refresh</button>
      </div>

      {approvals.length === 0 ? (
        <div className="panel-state is-dim mono">No approvals found.</div>
      ) : (
        <div className="approvals-content">
          <div className="approvals-pending" aria-label="Pending approvals">
            {activePending.length === 0 ? (
              <div className="panel-state is-dim mono">No pending approvals.</div>
            ) : (
              activePending.map((item) => {
                const isDeciding = decidingId === item.id
                const error = decisionErrors[item.id]

                return (
                  <div key={item.id} className="approval-card">
                    <div className="approval-card-head">
                      <span className="approval-type">{approvalTypeLabel(item.type)}</span>
                      <span className="approval-time mono">{timeAgo(item.createdAt)}</span>
                    </div>

                    <div className="approval-summary">{item.summary}</div>

                    <div className="approval-requester">
                      Requested by: <span className="approval-requester-name">{requesterName(item.requestedByAgentId)}</span>
                    </div>

                    {item.justDecided ? (
                      <div className="approval-result-in-place" role="status">
                        <span className="approval-result-badge mono">
                          {statusLabel(item.status)}
                        </span>
                        {item.decisionNote && (
                          <span className="approval-result-note">{item.decisionNote}</span>
                        )}
                      </div>
                    ) : (
                      <>
                        {error && (
                          <div className="panel-banner is-error" role="alert">
                            {error}
                          </div>
                        )}

                        <div className="panel-field">
                          <label htmlFor={`approval-note-${item.id}`}>Note (optional)</label>
                          <input
                            id={`approval-note-${item.id}`}
                            type="text"
                            value={notes[item.id] ?? ''}
                            onChange={(e) =>
                              setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                            placeholder="Add a decision note"
                            disabled={isDeciding}
                          />
                        </div>

                        <div className="approval-actions">
                          <button
                            type="button"
                            className="approval-btn is-approve"
                            disabled={isDeciding}
                            onClick={() => handleDecision(item.id, 'approve')}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="approval-btn"
                            disabled={isDeciding}
                            onClick={() => handleDecision(item.id, 'request-revision')}
                          >
                            Request changes
                          </button>
                          <button
                            type="button"
                            className="approval-btn is-reject"
                            disabled={isDeciding}
                            onClick={() => handleDecision(item.id, 'reject')}
                          >
                            Reject
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {decidedList.length > 0 && (
            <details className="approvals-decided">
              <summary className="approvals-decided-summary">
                Decided ({decidedList.length})
              </summary>
              <div className="approvals-decided-list" aria-label="Decided approvals">
                {decidedList.map((item) => (
                  <div key={item.id} className="approval-card is-decided">
                    <div className="approval-card-head">
                      <span className="approval-type">{approvalTypeLabel(item.type)}</span>
                      <span className="approval-status mono">{statusLabel(item.status)}</span>
                    </div>
                    <div className="approval-summary">{item.summary}</div>
                    <div className="approval-requester">
                      Requested by: {requesterName(item.requestedByAgentId)} // {timeAgo(item.createdAt)}
                    </div>
                    {item.decisionNote && (
                      <div className="approval-note-text">Note: {item.decisionNote}</div>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
