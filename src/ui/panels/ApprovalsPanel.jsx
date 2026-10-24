import { useEffect, useState } from 'react'
import { visibleText } from '../../model/paths.js'
import { approvalTypeLabel, statusLabel, timeAgo } from './format.js'
import { subscribeToNotices } from './notices.js'

const DECISION_LABELS = {
  approve: 'Approve',
  'request-revision': 'Request changes',
  reject: 'Reject',
}

function decisionLabel(decision) {
  return Object.hasOwn(DECISION_LABELS, decision) ? DECISION_LABELS[decision] : 'Approve'
}

export function decisionConfirmText(decision, title, note = '') {
  const action = decisionLabel(decision)
  const quoted = `"${visibleText(title)}"`
  const question = action === 'Request changes' ? `${action} on ${quoted}?` : `${action} ${quoted}?`
  const withNote = typeof note === 'string' && note.trim() ? ' Your note goes with it.' : ''
  return `${question}${withNote}`
}

function startingDecision(initialConfirmOpen, approvals) {
  if (!initialConfirmOpen) return null
  if (typeof initialConfirmOpen === 'object' && initialConfirmOpen.id) {
    return {
      id: initialConfirmOpen.id,
      decision: initialConfirmOpen.decision || 'approve',
    }
  }
  const pending = approvals.find((item) => item.status === 'pending')
  return pending ? { id: pending.id, decision: 'approve' } : null
}

export function emptyApprovalsText(health) {
  if (health && typeof health === 'object' && health.lanes === true && health.paperclip !== true) {
    return 'Lane runs need no approvals.'
  }
  return 'No approvals found.'
}

export default function ApprovalsPanel({
  client,
  onPendingCountChange,
  initialApprovals = null,
  initialAgents = null,
  initialHealth = null,
  initialConfirmOpen = null,
}) {
  const [approvals, setApprovals] = useState(() => (Array.isArray(initialApprovals) ? initialApprovals : []))
  const [agents, setAgents] = useState(() => (Array.isArray(initialAgents) ? initialAgents : []))
  const [health, setHealth] = useState(() => (initialHealth && typeof initialHealth === 'object' ? initialHealth : null))
  const [loading, setLoading] = useState(() => initialApprovals == null)
  const [loadError, setLoadError] = useState(null)

  const [notes, setNotes] = useState({})
  const [decidingId, setDecidingId] = useState(null)
  const [decisionErrors, setDecisionErrors] = useState({})
  const [confirming, setConfirming] = useState(() => startingDecision(initialConfirmOpen, Array.isArray(initialApprovals) ? initialApprovals : []))

  async function loadData({ isInitial = false, preserveDecided = false } = {}) {
    if (isInitial) {
      setLoading(true)
      setLoadError(null)
    }
    try {
      const [approvalList, agentList, healthAnswer] = await Promise.all([
        client.approvals(),
        typeof client.agents === 'function' ? client.agents().catch(() => []) : [],
        typeof client.health === 'function' ? client.health().catch(() => null) : null,
      ])
      if (preserveDecided) {
        setApprovals((prev) => {
          const justDecidedMap = new Map(
            prev.filter((item) => item.justDecided).map((item) => [item.id, item])
          )
          return approvalList.map((item) => {
            const existing = justDecidedMap.get(item.id)
            if (existing) {
              return { ...item, justDecided: true }
            }
            return item
          })
        })
      } else {
        setApprovals(approvalList)
      }
      setAgents(agentList)
      if (healthAnswer && typeof healthAnswer === 'object') setHealth(healthAnswer)
    } catch (err) {
      if (isInitial) {
        setLoadError(err.message || 'Could not load approvals.')
      }
    } finally {
      if (isInitial) {
        setLoading(false)
      }
    }
  }

  async function refreshApprovals() {
    try {
      const approvalList = await client.approvals()
      setApprovals((prev) => {
        const justDecidedMap = new Map(
          prev.filter((item) => item.justDecided).map((item) => [item.id, item])
        )
        return approvalList.map((item) => {
          const existing = justDecidedMap.get(item.id)
          if (existing) {
            return { ...item, justDecided: true }
          }
          return item
        })
      })
    } catch {
      return
    }
  }

  useEffect(() => {
    loadData({ isInitial: true })
  }, [client])

  useEffect(() => {
    return subscribeToNotices(client, 'approvals', () => {
      refreshApprovals()
    })
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
      setConfirming(null)
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
        <button type="button" onClick={() => loadData({ isInitial: true })}>Retry</button>
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
        <button type="button" onClick={() => loadData({ isInitial: false, preserveDecided: false })}>Refresh</button>
      </div>

      {approvals.length === 0 ? (
        <div className="panel-state is-dim mono">{emptyApprovalsText(health)}</div>
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
                            onClick={() => {
                              setDecisionErrors((prev) => ({ ...prev, [item.id]: null }))
                              setConfirming({ id: item.id, decision: 'approve' })
                            }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="approval-btn"
                            disabled={isDeciding}
                            onClick={() => {
                              setDecisionErrors((prev) => ({ ...prev, [item.id]: null }))
                              setConfirming({ id: item.id, decision: 'request-revision' })
                            }}
                          >
                            Request changes
                          </button>
                          <button
                            type="button"
                            className="approval-btn is-reject"
                            disabled={isDeciding}
                            onClick={() => {
                              setDecisionErrors((prev) => ({ ...prev, [item.id]: null }))
                              setConfirming({ id: item.id, decision: 'reject' })
                            }}
                          >
                            Reject
                          </button>
                        </div>

                        {confirming?.id === item.id && (
                          <div className="brief-confirm-card approvals-confirm-card" role="region" aria-label="Confirm approval decision">
                            <div className="brief-confirm-warning">
                              {decisionConfirmText(confirming.decision, item.summary, notes[item.id] ?? '')}
                            </div>
                            <div className="brief-confirm-actions">
                              <button
                                type="button"
                                className="brief-confirm-btn"
                                disabled={isDeciding}
                                onClick={() => handleDecision(item.id, confirming.decision)}
                              >
                                {decisionLabel(confirming.decision)}
                              </button>
                              <button
                                type="button"
                                className="brief-cancel-btn"
                                disabled={isDeciding}
                                onClick={() => {
                                  setConfirming(null)
                                  setDecisionErrors((prev) => ({ ...prev, [item.id]: null }))
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                            {error && (
                              <div className="brief-confirm-error mono" role="alert">
                                {error}
                              </div>
                            )}
                          </div>
                        )}
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
