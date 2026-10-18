import { useEffect, useState } from 'react'
import { statusLabel, timeAgo } from './format.js'
import { subscribeToNotices } from './notices.js'

export default function IssueThread({ issue, client, agents = [], onBack, onRefresh }) {
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState(null)

  async function loadComments({ isInitial = false } = {}) {
    if (isInitial) {
      setLoading(true)
      setLoadError(null)
    }
    try {
      const list = await client.comments(issue.id)
      setComments(list)
    } catch (err) {
      if (isInitial) {
        setLoadError(err.message || 'Could not load comments.')
      }
    } finally {
      if (isInitial) {
        setLoading(false)
      }
    }
  }

  async function handleRefresh() {
    await Promise.all([loadComments({ isInitial: false }), onRefresh?.()])
  }

  useEffect(() => {
    loadComments({ isInitial: true })
  }, [client, issue.id])

  useEffect(() => {
    return subscribeToNotices(client, { topic: 'comments', id: issue.id }, () => {
      loadComments()
    })
  }, [client, issue.id])

  async function handlePost(event) {
    event?.preventDefault?.()
    if (!body.trim() || posting) return

    setPosting(true)
    setPostError(null)
    try {
      const newComment = await client.postComment(issue.id, body.trim())
      setComments((prev) => [...prev, newComment])
      setBody('')
    } catch (err) {
      setPostError(err.message || 'Could not post comment.')
    } finally {
      setPosting(false)
    }
  }

  function handleKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      handlePost()
    }
  }

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

      <form className="thread-composer" onSubmit={handlePost}>
        {postError && (
          <div className="panel-banner is-error" role="alert">
            {postError}
          </div>
        )}
        <div className="panel-field">
          <label htmlFor="thread-comment-input">Add comment</label>
          <textarea
            id="thread-comment-input"
            rows={3}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={posting}
            placeholder="Write a comment. Press Ctrl+Enter to send."
          />
        </div>
        <div className="panel-actions">
          <button type="submit" disabled={posting || !body.trim()}>
            {posting ? 'Posting...' : 'Post comment'}
          </button>
        </div>
      </form>
    </div>
  )
}
