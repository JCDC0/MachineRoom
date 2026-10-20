import { useEffect, useRef, useState } from 'react'
import { subscribeToNotices } from './notices.js'
import { canMerge, defaultMergeMessage, patchLines, reviewRow } from './reviews.js'

export default function ReviewsPanel({
  client,
  initialReviews = null,
  initialDiff = null,
}) {
  const [reviews, setReviews] = useState(() => (Array.isArray(initialReviews) ? initialReviews : []))
  const [loading, setLoading] = useState(() => initialReviews == null)
  const [loadError, setLoadError] = useState(null)

  const [selectedLane, setSelectedLane] = useState(() => initialDiff?.lane ?? null)
  const [diff, setDiff] = useState(initialDiff)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState(null)
  const diffReqRef = useRef(0)

  const [confirmTarget, setConfirmTarget] = useState(null)
  const [mergeMessage, setMergeMessage] = useState('')
  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState(null)
  const [mergeConflictFiles, setMergeConflictFiles] = useState([])
  const [mergeSuccessByLane, setMergeSuccessByLane] = useState({})

  async function loadReviews({ isInitial = false } = {}) {
    if (typeof client?.reviews !== 'function') {
      setLoading(false)
      return
    }
    if (isInitial) {
      setLoading(true)
      setLoadError(null)
    }
    try {
      const list = await client.reviews()
      setReviews(Array.isArray(list) ? list : [])
      setLoadError(null)
    } catch (err) {
      if (isInitial) {
        setLoadError(err.message || 'Could not load reviews.')
      }
    } finally {
      if (isInitial) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    if (initialReviews == null) {
      loadReviews({ isInitial: true })
    }
    return subscribeToNotices(client, 'runs', () => {
      loadReviews({ isInitial: false })
    })
  }, [client])

  async function loadDiffForLane(lane) {
    if (!lane || typeof client?.reviewDiff !== 'function') return
    const reqId = ++diffReqRef.current
    setSelectedLane(lane)
    setDiffLoading(true)
    setDiffError(null)
    setDiff(null)
    try {
      const data = await client.reviewDiff(lane)
      if (diffReqRef.current !== reqId) return
      setDiff(data)
    } catch (err) {
      if (diffReqRef.current !== reqId) return
      setDiffError(err.message || 'Could not load diff.')
    } finally {
      if (diffReqRef.current === reqId) {
        setDiffLoading(false)
      }
    }
  }

  function handleRowClick(review) {
    if (!review?.lane || review.error) return
    if (selectedLane === review.lane && !diffError) {
      diffReqRef.current += 1
      setSelectedLane(null)
      setDiff(null)
      setDiffLoading(false)
      setDiffError(null)
      return
    }
    loadDiffForLane(review.lane)
  }

  function handleOpenConfirm(event, review, row) {
    event.stopPropagation()
    if (!canMerge(review)) return
    setConfirmTarget({
      lane: row.lane,
      branch: row.branch,
      head: row.head,
      headShort: row.headShort,
    })
    setMergeMessage(defaultMergeMessage(review))
    setMergeError(null)
    setMergeConflictFiles([])
  }

  function handleCancelConfirm() {
    if (merging) return
    setConfirmTarget(null)
    setMergeMessage('')
    setMergeError(null)
    setMergeConflictFiles([])
  }

  const isMessageValid =
    typeof mergeMessage === 'string' &&
    mergeMessage.length >= 1 &&
    mergeMessage.length <= 200 &&
    !/[\r\n]/.test(mergeMessage)

  async function handleConfirmMerge() {
    if (merging || !confirmTarget || !isMessageValid || typeof client?.mergeReview !== 'function') {
      return
    }
    setMerging(true)
    setMergeError(null)
    setMergeConflictFiles([])
    try {
      const result = await client.mergeReview(confirmTarget.lane, {
        head: confirmTarget.head,
        message: mergeMessage,
      })
      const commitShort = typeof result?.commit === 'string' ? result.commit.slice(0, 7) : ''
      const text = `Merged as ${commitShort}.`
      setMergeSuccessByLane((prev) => ({ ...prev, [confirmTarget.lane]: text }))
      await loadReviews({ isInitial: false })
    } catch (err) {
      setMergeError(err.message || 'Could not merge lane.')
      setMergeConflictFiles(Array.isArray(err?.files) ? err.files : [])
    } finally {
      setMerging(false)
    }
  }

  const lines = diff?.patch ? patchLines(diff.patch) : []

  return (
    <div className="reviews-panel">
      <div className="panel-toolbar">
        <span className="panel-count mono">Reviews</span>
        <button
          type="button"
          onClick={() => loadReviews({ isInitial: false })}
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="panel-state mono">Loading reviews...</div>
      ) : loadError ? (
        <div className="panel-state">
          <div className="panel-error-message">{loadError}</div>
          <button type="button" onClick={() => loadReviews({ isInitial: true })}>
            Retry
          </button>
        </div>
      ) : reviews.length === 0 ? (
        <div className="panel-state is-dim mono">No lanes to review.</div>
      ) : (
        <div className="reviews-list">
          {reviews.map((review) => {
            const row = reviewRow(review)
            const isSelected = selectedLane === row.lane
            const isConfirmOpen = confirmTarget?.lane === row.lane
            const mergedBanner = mergeSuccessByLane[row.lane]

            return (
              <div
                key={row.lane}
                className={`review-card ${isSelected ? 'is-selected' : ''} ${row.error ? 'is-error' : ''}`}
              >
                <div
                  className="review-row"
                  role={row.error ? undefined : 'button'}
                  tabIndex={row.error ? undefined : 0}
                  aria-expanded={row.error ? undefined : isSelected}
                  onClick={() => handleRowClick(review)}
                  onKeyDown={(e) => {
                    if (row.error) return
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleRowClick(review)
                    }
                  }}
                >
                  <div className="review-row-head">
                    <span className="review-lane">{row.lane}</span>
                    {row.branch && <span className="review-branch mono">{row.branch}</span>}
                    {row.canMerge && (
                      <button
                        type="button"
                        className="review-merge-btn"
                        onClick={(e) => handleOpenConfirm(e, review, row)}
                      >
                        Merge
                      </button>
                    )}
                  </div>

                  {row.error ? (
                    <div className="review-error mono" role="alert">
                      {row.error}
                    </div>
                  ) : (
                    <>
                      <div className="review-meta mono">
                        <span className="review-ahead">{row.aheadText}</span>
                        <span className="review-files">{row.filesText}</span>
                        {row.dirty && (
                          <span className="review-dirty">{row.dirtyText}</span>
                        )}
                      </div>
                      <div className="review-last-run mono">
                        {row.lastRunText}
                      </div>
                    </>
                  )}
                </div>

                {mergedBanner && !isConfirmOpen && (
                  <div className="review-merged-banner mono" role="status">
                    {mergedBanner}
                  </div>
                )}

                {isConfirmOpen && (
                  <div className="brief-confirm-card review-confirm-card" role="region" aria-label={`Confirm merge for ${confirmTarget.lane}`}>
                    <div className="brief-confirm-warning">
                      {`Merge ${confirmTarget.lane}'s ${confirmTarget.branch} (${confirmTarget.headShort}) into main? It merges in the main checkout and never pushes.`}
                    </div>
                    <div className="panel-field review-message-field">
                      <label htmlFor={`merge-msg-${confirmTarget.lane}`}>Message</label>
                      <input
                        id={`merge-msg-${confirmTarget.lane}`}
                        type="text"
                        className="mono"
                        value={mergeMessage}
                        onChange={(e) => setMergeMessage(e.target.value)}
                        disabled={merging}
                      />
                    </div>
                    <div className="brief-confirm-actions">
                      <button
                        type="button"
                        className="brief-confirm-btn"
                        disabled={merging || !isMessageValid}
                        onClick={handleConfirmMerge}
                      >
                        {merging ? 'Merging' : 'Merge'}
                      </button>
                      <button
                        type="button"
                        className="brief-cancel-btn"
                        disabled={merging}
                        onClick={handleCancelConfirm}
                      >
                        Cancel
                      </button>
                    </div>
                    {mergedBanner && !mergeError && (
                      <div className="review-merged-banner mono" role="status">
                        {mergedBanner}
                      </div>
                    )}
                    {mergeError && (
                      <div className="brief-confirm-error review-merge-error mono" role="alert">
                        <div>{mergeError}</div>
                        {mergeConflictFiles.length > 0 && (
                          <ul className="review-conflict-files">
                            {mergeConflictFiles.map((file) => (
                              <li key={file}>{file}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {isSelected && (
                  <div className="review-diff-view" role="region" aria-label={`Diff for ${row.lane}`}>
                    {diffLoading ? (
                      <div className="review-diff-state mono">Loading diff...</div>
                    ) : diffError ? (
                      <div className="review-diff-error-row" role="alert">
                        <span className="panel-error-message">{diffError}</span>
                        <button type="button" onClick={() => loadDiffForLane(row.lane)}>
                          Retry
                        </button>
                      </div>
                    ) : diff ? (
                      <>
                        {Array.isArray(diff.files) && diff.files.length > 0 ? (
                          <ul className="review-diff-files mono">
                            {diff.files.map((file) => (
                              <li key={file.path} className="review-diff-file">
                                <span className="review-diff-path">{file.path}</span>
                                <span className="review-diff-counts">{`+${file.added} -${file.deleted}`}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="review-diff-state is-dim mono">No files changed.</div>
                        )}

                        {diff.truncated && (
                          <div className="review-patch-truncated mono">
                            The patch was cut at 400 KB.
                          </div>
                        )}

                        {lines.length > 0 ? (
                          <pre className="review-patch mono">
                            {lines.map((line, idx) => (
                              <div
                                key={idx}
                                className={`review-patch-line is-${line.kind}`}
                              >
                                {line.text}
                              </div>
                            ))}
                          </pre>
                        ) : (
                          <div className="review-diff-state is-dim mono">No patch.</div>
                        )}
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
