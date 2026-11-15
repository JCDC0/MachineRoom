import { useEffect, useRef, useState } from 'react'
import { visibleText } from '../../model/paths.js'
import { subscribeToNotices } from './notices.js'
import {
  canAskMain,
  canMerge,
  defaultMergeMessage,
  formatChecksNotice,
  isFastForwardRefusal,
  mergeHead,
  MOVED_BRANCH_ERROR,
  normalizeChecks,
  patchLines,
  prepareMergeMessage,
  reviewRow,
} from './reviews.js'

const OUTSIDE_SCOPE_START = 'The lane changed files outside the scope of '

export function isOutsideScopeRefusal(error) {
  if (error?.outside === true) return true
  const message = typeof error?.message === 'string' ? error.message : ''
  return message.startsWith(OUTSIDE_SCOPE_START)
}

function checksColor(checks) {
  if (checks === 'failed') return 'var(--red)'
  if (checks === 'passed') return 'var(--green)'
  return 'var(--yellow)'
}

export function playNotice(play, commit, playHead) {
  const short = typeof commit === 'string' ? commit.slice(0, 7) : ''
  const stayedShort = typeof playHead === 'string' ? playHead.slice(0, 7) : ''
  if (play === 'moved') return `The play worktree moved to ${short}.`
  if (play === 'dirty') {
    return stayedShort
      ? `The play worktree has changes, so it stayed on ${stayedShort}.`
      : 'The play worktree has changes, so it stayed.'
  }
  if (play === 'not detached') {
    return stayedShort
      ? `The play worktree is on a branch, so it stayed on ${stayedShort}.`
      : 'The play worktree is on a branch, so it stayed.'
  }
  if (play === 'failed') return `The play worktree could not move to ${short}.`
  return ''
}

export function MergeConfirmCard({
  target,
  message,
  messageValid,
  merging,
  mergedBanner,
  playLine,
  mergeError,
  conflictFiles,
  onMessageChange,
  onConfirm,
  onCancel,
}) {
  if (!target) return null
  const base = target.base || 'main'
  const isFastForward = target.strategy === 'fast-forward'
  const checks = normalizeChecks(target.checks)
  const laneName = target.branch ? `${target.lane}'s ${target.branch}` : `${target.lane}'s work`
  return (
    <div className="brief-confirm-card review-confirm-card" role="region" aria-label={`Confirm merge for ${target.lane}`}>
      <div className="brief-confirm-warning">
        {`Merge ${laneName} (${target.headShort}) into ${base}? It changes the project checkout and never pushes.`}
      </div>
      <div
        className={`review-confirm-checks is-${checks} mono`}
        style={{ fontSize: '11px', color: checksColor(checks) }}
      >
        {formatChecksNotice(checks)}
      </div>
      {isFastForward ? (
        <div className="review-last-run mono">
          {"Fast-forward merge. The lane's commits are kept as they are."}
        </div>
      ) : (
        <div className="panel-field review-message-field">
          <label htmlFor={`merge-msg-${target.lane}`}>Message</label>
          <input
            id={`merge-msg-${target.lane}`}
            type="text"
            className="mono"
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            disabled={merging}
          />
        </div>
      )}
      <div className="brief-confirm-actions">
        <button
          type="button"
          className="brief-confirm-btn"
          disabled={merging || (!isFastForward && !messageValid)}
          onClick={onConfirm}
        >
          {merging ? 'Merging' : 'Merge'}
        </button>
        <button
          type="button"
          className="brief-cancel-btn"
          disabled={merging}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      {mergedBanner && !mergeError && (
        <div className="review-merged-banner mono" role="status">
          <div>{mergedBanner}</div>
          {playLine && <div className="review-play-line">{playLine}</div>}
        </div>
      )}
      {mergeError && (
        <div className="brief-confirm-error review-merge-error mono" role="alert">
          <div>{mergeError}</div>
          {conflictFiles.length > 0 && (
            <ul className="review-conflict-files">
              {conflictFiles.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export function PrepareConfirmCard({ target, sending, onConfirm, onCancel }) {
  if (!target) return null
  const branch = target.branch || 'its work'
  const base = target.base || 'main'
  return (
    <div
      className="brief-confirm-card review-confirm-card review-prepare-card"
      role="region"
      aria-label={`Confirm prepare for ${target.lane}`}
    >
      <div className="brief-confirm-warning">
        {`Ask Main to prepare ${target.lane}'s ${branch} (${target.headShort}) into ${base}?`}
      </div>
      <div className="review-last-run mono">
        {"Main rebases or merges the branch onto the destination in the lane's worktree, runs the project's checks and reports. It does not merge into the destination."}
      </div>
      <div className="brief-confirm-actions">
        <button
          type="button"
          className="brief-confirm-btn"
          disabled={sending}
          onClick={onConfirm}
        >
          {sending ? 'Sending' : 'Send'}
        </button>
        <button
          type="button"
          className="brief-cancel-btn"
          disabled={sending}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export function OutsideConfirmCard({ target, files, mergeError, merging, onConfirm, onCancel }) {
  if (!target) return null
  const branch = target.branch ? `${target.lane}'s ${target.branch}` : `${target.lane}'s work`
  return (
    <div
      className="brief-confirm-card review-confirm-card review-outside-card"
      role="region"
      aria-label={`Confirm merge anyway for ${target.lane}`}
    >
      <div className="brief-confirm-warning">
        {`Merge ${branch} (${target.headShort}) even though it changes files outside the sub's scope?`}
      </div>
      <ul className="review-conflict-files mono">
        {files.map((file) => (
          <li key={file}>{visibleText(file)}</li>
        ))}
      </ul>
      <div className="brief-confirm-actions">
        <button
          type="button"
          className="brief-confirm-btn"
          disabled={merging}
          onClick={onConfirm}
        >
          {merging ? 'Merging' : 'Merge anyway'}
        </button>
        <button
          type="button"
          className="brief-cancel-btn"
          disabled={merging}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      {mergeError && (
        <div className="brief-confirm-error review-merge-error mono" role="alert">
          {mergeError}
        </div>
      )}
    </div>
  )
}

export default function ReviewsPanel({
  client,
  initialReviews = null,
  initialDiff = null,
}) {
  const [reviews, setReviews] = useState(() => (Array.isArray(initialReviews) ? initialReviews : []))
  const [loading, setLoading] = useState(() => initialReviews == null)
  const [loadError, setLoadError] = useState(null)
  const [refreshError, setRefreshError] = useState(null)

  const [selectedLane, setSelectedLane] = useState(() => initialDiff?.lane ?? null)
  const [diff, setDiff] = useState(initialDiff)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState(null)
  const diffReqRef = useRef(0)
  const mountedRef = useRef(true)

  const [confirmTarget, setConfirmTarget] = useState(null)
  const [mergeMessage, setMergeMessage] = useState('')
  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState(null)
  const [mergeConflictFiles, setMergeConflictFiles] = useState([])
  const [mergeSuccessByLane, setMergeSuccessByLane] = useState({})
  const [movedByLane, setMovedByLane] = useState({})
  const [outsideByLane, setOutsideByLane] = useState({})
  const [outsideTarget, setOutsideTarget] = useState(null)

  const [prepareTarget, setPrepareTarget] = useState(null)
  const [preparing, setPreparing] = useState(false)
  const [prepareErrorByLane, setPrepareErrorByLane] = useState({})
  const [prepareSentByLane, setPrepareSentByLane] = useState({})
  const [refusedByLane, setRefusedByLane] = useState({})

  function clearPrepareNotice(lane) {
    setPrepareErrorByLane((prev) => {
      if (!Object.hasOwn(prev, lane)) return prev
      const next = { ...prev }
      delete next[lane]
      return next
    })
    setPrepareSentByLane((prev) => {
      if (!Object.hasOwn(prev, lane)) return prev
      const next = { ...prev }
      delete next[lane]
      return next
    })
  }

  function clearMoved(lane) {
    setMovedByLane((prev) => {
      if (!prev[lane]) return prev
      const next = { ...prev }
      delete next[lane]
      return next
    })
  }

  function clearOutside(lane) {
    setOutsideByLane((prev) => {
      if (!Object.hasOwn(prev, lane)) return prev
      const next = { ...prev }
      delete next[lane]
      return next
    })
  }

  async function loadReviews({ isInitial = false } = {}) {
    if (typeof client?.reviews !== 'function') {
      setLoading(false)
      return
    }
    setRefreshError(null)
    if (isInitial) {
      setLoading(true)
      setLoadError(null)
    }
    try {
      const list = await client.reviews()
      if (!mountedRef.current) return
      setReviews(Array.isArray(list) ? list : [])
      setLoadError(null)
    } catch (err) {
      if (!mountedRef.current) return
      if (isInitial) {
        setLoadError(err.message || 'Could not load reviews.')
      } else {
        setRefreshError(err?.message || 'Could not refresh reviews.')
      }
    } finally {
      if (isInitial && mountedRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

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
    clearMoved(lane)
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
    const moved = movedByLane[review.lane]
    if (selectedLane === review.lane && !diffError && !moved) {
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
    const result = mergeHead(row, diff)
    if (result.error) {
      setMovedByLane((prev) => ({ ...prev, [row.lane]: result.error }))
      setConfirmTarget((current) => (current?.lane === row.lane ? null : current))
      return
    }
    clearMoved(row.lane)
    const isFastForward = row.strategy === 'fast-forward'
    setOutsideTarget((current) => (current?.lane === row.lane ? null : current))
    setConfirmTarget({
      lane: row.lane,
      branch: row.branch,
      base: row.base || 'main',
      baseHead: row.baseHead,
      strategy: row.strategy,
      checks: row.checks,
      head: result.head,
      headShort: result.head.slice(0, 7),
      message: isFastForward ? '' : defaultMergeMessage(review),
    })
    setMergeMessage(isFastForward ? '' : defaultMergeMessage(review))
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

  function handleOpenPrepare(event, review, row) {
    event.stopPropagation()
    if (merging || preparing) return
    if (!canAskMain(client)) return
    if (prepareTarget?.lane === row.lane) {
      setPrepareTarget(null)
      return
    }
    const result = mergeHead(row, diff)
    if (result.error) {
      setMovedByLane((prev) => ({ ...prev, [row.lane]: result.error }))
      setPrepareTarget((current) => (current?.lane === row.lane ? null : current))
      return
    }
    clearMoved(row.lane)
    setConfirmTarget((current) => (current?.lane === row.lane ? null : current))
    setMergeError(null)
    setMergeConflictFiles([])
    clearPrepareNotice(row.lane)
    setPrepareTarget({
      lane: row.lane,
      branch: row.branch,
      base: row.base || 'main',
      head: result.head,
      headShort: result.head.slice(0, 7),
    })
  }

  function handleCancelPrepare() {
    if (preparing) return
    setPrepareTarget(null)
  }

  async function handleConfirmPrepare() {
    if (preparing || !prepareTarget || !canAskMain(client)) return
    const target = prepareTarget
    const text = prepareMergeMessage(target)
    if (!text) return
    setPreparing(true)
    clearPrepareNotice(target.lane)
    try {
      await client.sendOrchestrator(text)
      if (!mountedRef.current) return
      setPrepareSentByLane((prev) => ({ ...prev, [target.lane]: 'Sent to Main.' }))
      setPrepareTarget(null)
    } catch (err) {
      if (!mountedRef.current) return
      setPrepareErrorByLane((prev) => ({
        ...prev,
        [target.lane]: err?.message || 'Could not send to Main.',
      }))
    } finally {
      if (mountedRef.current) {
        setPreparing(false)
      }
    }
  }

  const isFastForwardConfirm = confirmTarget?.strategy === 'fast-forward'
  const isMessageValid =
    isFastForwardConfirm ||
    (typeof mergeMessage === 'string' &&
      mergeMessage.length >= 1 &&
      mergeMessage.length <= 200 &&
      !/[\r\n]/.test(mergeMessage))

  async function sendMerge(target, { allowOutside = false } = {}) {
    if (merging || !target || typeof client?.mergeReview !== 'function') return
    const isFastForward = target.strategy === 'fast-forward'
    const message = allowOutside && typeof target.message === 'string' ? target.message : mergeMessage
    const valid =
      isFastForward ||
      (typeof message === 'string' &&
        message.length >= 1 &&
        message.length <= 200 &&
        !/[\r\n]/.test(message))
    if (!valid) return
    setMerging(true)
    setMergeError(null)
    setMergeConflictFiles([])
    try {
      const options = {
        head: target.head,
        base: target.base,
        baseHead: target.baseHead,
      }
      if (!isFastForward) {
        options.message = message
      }
      if (allowOutside) {
        options.allowOutside = true
      }
      const result = await client.mergeReview(target.lane, options)
      if (!mountedRef.current) return
      const commitShort = typeof result?.commit === 'string' ? result.commit.slice(0, 7) : ''
      const text = `Merged as ${commitShort}.`
      const playLine = playNotice(result?.play, result?.commit, result?.playHead)
      setMergeSuccessByLane((prev) => ({ ...prev, [target.lane]: { text, playLine } }))
      setRefusedByLane((prev) => {
        if (!Object.hasOwn(prev, target.lane)) return prev
        const next = { ...prev }
        delete next[target.lane]
        return next
      })
      clearOutside(target.lane)
      setConfirmTarget(null)
      setOutsideTarget(null)
      setMergeMessage('')
      await loadReviews({ isInitial: false })
    } catch (err) {
      if (!mountedRef.current) return
      const text = err.message || 'Could not merge lane.'
      if (isOutsideScopeRefusal(err)) {
        setOutsideByLane((prev) => ({
          ...prev,
          [target.lane]: {
            target: { ...target, message: isFastForward ? '' : message },
            files: Array.isArray(err?.files) ? err.files : [],
            error: text,
          },
        }))
        setConfirmTarget((current) => (current?.lane === target.lane ? null : current))
        setOutsideTarget(null)
        setMergeError(null)
        setMergeConflictFiles([])
      } else {
        setMergeError(text)
        setMergeConflictFiles(Array.isArray(err?.files) ? err.files : [])
        if (target.strategy === 'fast-forward' && isFastForwardRefusal(text)) {
          setRefusedByLane((prev) => ({ ...prev, [target.lane]: target.head }))
        }
      }
    } finally {
      if (mountedRef.current) {
        setMerging(false)
      }
    }
  }

  async function handleConfirmMerge() {
    if (!confirmTarget || !isMessageValid) return
    await sendMerge(confirmTarget)
  }

  function handleOpenOutside(event, row) {
    event.stopPropagation()
    if (merging) return
    const refusal = outsideByLane[row.lane]
    if (!refusal?.target) return
    if (row.head !== refusal.target.head) {
      setMovedByLane((prev) => ({ ...prev, [row.lane]: MOVED_BRANCH_ERROR }))
      clearOutside(row.lane)
      setOutsideTarget((current) => (current?.lane === row.lane ? null : current))
      return
    }
    clearMoved(row.lane)
    setConfirmTarget((current) => (current?.lane === row.lane ? null : current))
    setMergeError(null)
    setMergeConflictFiles([])
    setOutsideTarget(refusal.target)
  }

  async function handleConfirmOutside() {
    if (merging || !outsideTarget) return
    await sendMerge(outsideTarget, { allowOutside: true })
  }

  function handleCancelOutside() {
    if (merging) return
    setOutsideTarget(null)
    setMergeError(null)
    setMergeConflictFiles([])
  }

  const lines = diff?.patch ? patchLines(diff.patch) : []
  const base = reviews.find((review) => typeof review?.base === 'string' && review.base)?.base ?? ''

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

      {refreshError && <p className="panel-error-message" role="alert">{refreshError}</p>}

      {base && !loading && (
        <div className="review-last-run mono">{`Each lane is compared against ${visibleText(base)}.`}</div>
      )}

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
            const isPrepareOpen = prepareTarget?.lane === row.lane
            const merged = mergeSuccessByLane[row.lane]
            const mergedBanner = merged?.text ?? ''
            const playLine = merged?.playLine ?? ''
            const refusedHead = refusedByLane[row.lane]
            const showPrepare =
              !row.error &&
              canAskMain(client) &&
              (row.behindDestination || (Boolean(row.head) && refusedHead === row.head))
            const prepareSent = prepareSentByLane[row.lane]
            const prepareError = prepareErrorByLane[row.lane]
            const outsideRefusal = outsideByLane[row.lane]
            const showOutside = Boolean(outsideRefusal && outsideRefusal.target?.head === row.head)

            return (
              <div
                key={row.lane}
                className={`review-card ${isSelected ? 'is-selected' : ''} ${row.error ? 'is-error' : ''}`}
              >
                <div className="review-row" onClick={() => handleRowClick(review)}>
                  <div className="review-row-head">
                    <span className="review-lane">{row.lane}</span>
                    {row.branch && <span className="review-branch mono">{row.branch}</span>}
                    {!row.error && (
                      <span
                        className="review-row-actions"
                        style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space)' }}
                      >
                        <span
                          className={`review-checks is-${row.checks} mono`}
                          style={{ fontSize: '11px', color: checksColor(row.checks) }}
                        >
                          {row.checksText}
                        </span>
                        <button
                          type="button"
                          className="review-expand-btn"
                          aria-expanded={isSelected}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRowClick(review)
                          }}
                        >
                          {isSelected ? 'Hide' : 'Diff'}
                        </button>
                        {showPrepare && (
                          <button
                            type="button"
                            className="review-prepare-btn"
                            onClick={(e) => handleOpenPrepare(e, review, row)}
                          >
                            Ask to prepare
                          </button>
                        )}
                        {row.canMerge && (
                          <button
                            type="button"
                            className="review-merge-btn"
                            onClick={(e) => handleOpenConfirm(e, review, row)}
                          >
                            Merge
                          </button>
                        )}
                      </span>
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
                      {movedByLane[row.lane] && (
                        <div className="review-error mono" role="alert">
                          {movedByLane[row.lane]}
                        </div>
                      )}
                      {prepareSent && (
                        <div className="review-prepare-sent mono" role="status">
                          {prepareSent}
                        </div>
                      )}
                      {prepareError && (
                        <div className="review-error mono" role="alert">
                          {prepareError}
                        </div>
                      )}
                      {showOutside && (
                        <div className="review-scope-refusal" role="alert">
                          <div className="mono">{outsideRefusal.error}</div>
                          {outsideRefusal.files.length > 0 && (
                            <ul className="review-conflict-files mono">
                              {outsideRefusal.files.map((file) => (
                                <li key={file}>{visibleText(file)}</li>
                              ))}
                            </ul>
                          )}
                          <button
                            type="button"
                            className="review-merge-anyway-btn"
                            disabled={merging}
                            onClick={(e) => handleOpenOutside(e, row)}
                          >
                            Merge anyway
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {mergedBanner && !isConfirmOpen && (
                  <div className="review-merged-banner mono" role="status">
                    <div>{mergedBanner}</div>
                    {playLine && <div className="review-play-line">{playLine}</div>}
                  </div>
                )}

                {isPrepareOpen && (
                  <PrepareConfirmCard
                    target={prepareTarget}
                    sending={preparing}
                    onConfirm={handleConfirmPrepare}
                    onCancel={handleCancelPrepare}
                  />
                )}

                {isConfirmOpen && (
                  <MergeConfirmCard
                    target={confirmTarget}
                    message={mergeMessage}
                    messageValid={isMessageValid}
                    merging={merging}
                    mergedBanner={mergedBanner}
                    playLine={playLine}
                    mergeError={mergeError}
                    conflictFiles={mergeConflictFiles}
                    onMessageChange={setMergeMessage}
                    onConfirm={handleConfirmMerge}
                    onCancel={handleCancelConfirm}
                  />
                )}

                {outsideTarget?.lane === row.lane && (
                  <OutsideConfirmCard
                    target={outsideTarget}
                    files={outsideByLane[row.lane]?.files ?? []}
                    mergeError={mergeError}
                    merging={merging}
                    onConfirm={handleConfirmOutside}
                    onCancel={handleCancelOutside}
                  />
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
                                <span className="review-diff-path">{visibleText(file.path)}</span>
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
                                {visibleText(line.text)}
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
