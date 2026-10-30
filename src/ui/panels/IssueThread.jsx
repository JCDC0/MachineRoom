import { useEffect, useRef, useState } from 'react'
import { statusLabel, timeAgo } from './format.js'
import { subscribeToNotices } from './notices.js'

export default function IssueThread({ issue, client, agents = [], onBack, onRefresh }) {
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const commentsReqRef = useRef(0)

  async function loadComments({ isInitial = false } = {}) {
    const ticket = commentsReqRef.current + 1
    commentsReqRef.current = ticket
    if (isInitial) {
      setLoading(true)
      setLoadError(null)
    }
    try {
      const list = await client.comments(issue.id)
      if (commentsReqRef.current !== ticket) return
      setComments(list)
    } catch (err) {
      if (commentsReqRef.current !== ticket) return
      if (isInitial) {
        setLoadError(err.message || 'Could not load comments.')
      }
    } finally {
      if (commentsReqRef.current === ticket) {
        setLoading(false)
      }
    }
  }

  async function handleRefresh() {
    await Promise.all([loadComments({ isInitial: false }), onRefresh?.()])
  }

  useEffect(() => {
    setComments([])
    loadComments({ isInitial: true })
  }, [client, issue.id])

  useEffect(() => {
    return subscribeToNotices(client, { topic: 'comments', id: issue.id }, () => {
      loadComments()
    })
  }, [client, issue.id])

  const assignee = agents.find((a) => a.id === issue.assigneeAgentId)
  const assigneeName = assignee?.name ?? 'Unassigned'

  return (
    <div className="thread-view">
      <div className="thread-nav">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <button type="button" onClick={handleRefresh}>
          Refresh
        </button>
      </div>

      <header className="thread-header">
        <div className="thread-id-row">
          <span className="mono thread-id">{issue.identifier}</span>
          <span className="thread-status mono">{statusLabel(issue.status)}</span>
          <span className="thread-priority mono">{issue.priority}</span>
        </div>
        <h3 className="thread-title">{issue.title}</h3>
        <div className="thread-assignee">
          Assignee: <span className="thread-assignee-name">{assigneeName}</span>
        </div>
        {issue.description ? (
          <div className="thread-description">{issue.description}</div>
        ) : (
          <div className="thread-description is-dim">No description provided.</div>
        )}
      </header>

      <section className="thread-comments" aria-label="Comments">
        <h4 className="thread-subtitle">Activity</h4>

        {loading && <div className="panel-state mono">Loading comments...</div>}

        {loadError && (
          <div className="panel-state">
            <div className="panel-error-message">{loadError}</div>
            <button type="button" onClick={() => loadComments({ isInitial: true })}>Retry</button>
          </div>
        )}

        {!loading && !loadError && comments.length === 0 && (
          <div className="panel-state is-dim mono">No comments yet.</div>
        )}

        {!loading && !loadError && comments.length > 0 && (
          <div className="comments-list">
            {comments.map((comment) => (
              <div key={comment.id} className="comment-card">
                <div className="comment-header">
                  <span className="comment-author">{comment.authorName}</span>
                  <span className="comment-time mono">{timeAgo(comment.createdAt)}</span>
                </div>
                <div className="comment-body">{comment.body}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
