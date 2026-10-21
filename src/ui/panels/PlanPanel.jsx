import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { canAsk, copyNote, copyText, planRows } from './plan.js'
import { subscribeToNotices } from './notices.js'

const POLL_MS = 10000

export default function PlanPanel({
  client,
  lanes = null,
  initialGoal = '',
  initialIssue = null,
  initialAnswer = null,
  initialConfirmOpen = false,
}) {
  const [goal, setGoal] = useState(initialGoal)
  const [confirmOpen, setConfirmOpen] = useState(initialConfirmOpen)
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState(null)
  const [issue, setIssue] = useState(initialIssue)
  const [answer, setAnswer] = useState(initialAnswer)
  const [phase, setPhase] = useState(() => {
    if (!initialAnswer || typeof initialAnswer !== 'object') return 'idle'
    return initialAnswer.status === 'ready' ? 'ready' : 'waiting'
  })
  const [planError, setPlanError] = useState(null)
  const [routes, setRoutes] = useState({})
  const [copyMessage, setCopyMessage] = useState(null)

  const mountedRef = useRef(false)
  const askRef = useRef(false)
  const planRef = useRef(false)
  const timerRef = useRef(null)

  const rows = useMemo(() => planRows(answer, lanes), [answer, lanes])
  const problems = useMemo(() => {
    const list = answer !== null && typeof answer === 'object' && Array.isArray(answer.problems) ? answer.problems : []
    return list.filter((problem) => typeof problem === 'string' && problem.trim()).map((problem) => problem.trim())
  }, [answer])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const refreshPlan = useCallback(
    async (issueId) => {
      if (!issueId || typeof client?.plan !== 'function' || planRef.current) return
      planRef.current = true
      try {
        const next = await client.plan(issueId)
        if (!mountedRef.current) return
        setPlanError(null)
        if (next !== null && typeof next === 'object' && next.status === 'ready') {
          setAnswer(next)
          setPhase('ready')
        } else {
          setAnswer(next !== null && typeof next === 'object' ? next : null)
          setRoutes({})
          setPhase('waiting')
        }
      } catch (err) {
        if (!mountedRef.current) return
        setPlanError(err?.message || 'Could not read the plan.')
      } finally {
        planRef.current = false
      }
    },
    [client]
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimer()
    }
  }, [clearTimer])

  useEffect(() => {
    if (!issue?.issueId || phase !== 'waiting' || typeof client?.plan !== 'function') return undefined
    let cancelled = false
    const unsubscribe = subscribeToNotices(client, { topic: 'comments', id: issue.issueId }, () => {
      if (!cancelled) refreshPlan(issue.issueId)
    })
    timerRef.current = setInterval(() => {
      if (!cancelled) refreshPlan(issue.issueId)
    }, POLL_MS)
    return () => {
      cancelled = true
      unsubscribe?.()
      clearTimer()
    }
  }, [client, issue, phase, refreshPlan, clearTimer])

  useEffect(() => {
    if (phase !== 'ready' || typeof client?.suggestRoute !== 'function' || rows.length === 0) {
      return undefined
    }
    let cancelled = false
    const load = async () => {
      const entries = await Promise.all(
        rows.map(async (row) => {
          try {
            const route = await client.suggestRoute(row.profile)
            return [row.id, { status: 'ready', route }]
          } catch (err) {
            return [row.id, { status: 'error', message: err?.message || 'Could not read the route.' }]
          }
        })
      )
      if (!cancelled) setRoutes(Object.fromEntries(entries))
    }
    load()
    return () => {
      cancelled = true
    }
  }, [client, phase, rows])

  async function handleAsk() {
    if (askRef.current) return
    const text = goal.trim()
    if (!canAsk(text)) {
      setAskError('Write the goal in 1 to 2000 characters.')
      return
    }
    if (typeof client?.askPlanner !== 'function') {
      setAskError('The planner is not available.')
      return
    }
    askRef.current = true
    setAsking(true)
    setAskError(null)
    setPlanError(null)
    setAnswer(null)
    setIssue(null)
    setRoutes({})
    setCopyMessage(null)
    setPhase('waiting')
    try {
      const created = await client.askPlanner(text)
      if (!mountedRef.current) return
      if (!created?.issueId) throw new Error('The planner task has no id.')
      const nextIssue = { issueId: created.issueId, identifier: created.identifier ?? null }
      setIssue(nextIssue)
      setConfirmOpen(false)
      await refreshPlan(nextIssue.issueId)
    } catch (err) {
      if (!mountedRef.current) return
      setAskError(err?.message || 'Could not ask the planner.')
      setPhase('idle')
    } finally {
      if (mountedRef.current) setAsking(false)
      askRef.current = false
    }
  }

  async function handleCopy() {
    const text = copyText(answer, lanes)
    if (!text) return
    try {
      if (!navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setCopyMessage(copyNote(rows.length))
    } catch {
      setCopyMessage('Copy failed.')
    }
  }

  function routeLine(row) {
    const entry = Object.hasOwn(routes, row.id) ? routes[row.id] : null
    if (!entry) return { error: false, text: 'Reading the route.' }
    if (entry.status === 'error') return { error: true, text: entry.message }
    const route = entry.route
    const reason = typeof route?.reason === 'string' && route.reason.trim() ? route.reason.trim() : 'No route reason.'
    return { error: route?.choice === null, text: reason }
  }

  const waiting = asking || phase === 'waiting'
  const askDisabled = !canAsk(goal) || waiting

  return (
    <div className="plan-panel">
      <div className="panel-field plan-goal-field">
        <div className="panel-field-head">
          <label htmlFor="plan-goal">Goal</label>
          <span className="plan-goal-count mono">{`${goal.length} / 2000`}</span>
        </div>
        <textarea
          id="plan-goal"
          rows={4}
          maxLength={2000}
          value={goal}
          disabled={waiting}
          onChange={(event) => {
            setGoal(event.target.value)
            setCopyMessage(null)
            if (askError) setAskError(null)
          }}
          placeholder="What should the planner split into briefs?"
        />
      </div>

      <div className="panel-actions plan-actions">
        <button
          type="button"
          disabled={askDisabled}
          onClick={() => {
            setConfirmOpen(true)
            setAskError(null)
          }}
        >
          Ask the planner
        </button>
      </div>

      {confirmOpen && (
        <div className="brief-confirm-card plan-confirm-card" role="region" aria-label="Confirm plan request">
          <div className="brief-confirm-warning">
            Ask PLANNER to split this goal into briefs? It creates a task in Paperclip and spends from PLANNER's budget.
          </div>
          <div className="brief-confirm-actions">
            <button
              type="button"
              className="brief-confirm-btn"
              disabled={asking}
              onClick={handleAsk}
            >
              {asking ? 'Asking' : 'Ask'}
            </button>
            <button
              type="button"
              className="brief-cancel-btn"
              disabled={asking}
              onClick={() => {
                setConfirmOpen(false)
                setAskError(null)
              }}
            >
              Cancel
            </button>
          </div>
          {askError && (
            <div className="brief-confirm-error mono" role="alert">
              {askError}
            </div>
          )}
        </div>
      )}

      {!confirmOpen && askError && (
        <div className="plan-problem mono" role="alert">
          {askError}
        </div>
      )}

      {waiting && (
        <div className="brief-state plan-waiting mono" role="status">
          Waiting for PLANNER.
        </div>
      )}

      {planError && (
        <div className="plan-problem mono" role="alert">
          {planError}
        </div>
      )}

      {phase === 'ready' && (
        <div className="plan-result">
          <div className="plan-result-head">
            <span className="panel-count mono">{`${rows.length} ${rows.length === 1 ? 'brief' : 'briefs'}`}</span>
            {rows.length > 0 && (
              <button type="button" className="plan-copy-btn" onClick={handleCopy}>
                Copy as Markdown
              </button>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="panel-state is-dim mono">The plan has no briefs.</div>
          ) : (
            <div className="plan-briefs">
              {rows.map((row) => {
                const line = routeLine(row)
                return (
                  <article className="plan-brief" key={row.id}>
                    <h3 className="plan-brief-heading">{row.heading}</h3>
                    <div className="plan-brief-meta mono">
                      <span>{`Size: ${row.size || 'unknown'}`}</span>
                      <span>{`Files: ${row.files.length > 0 ? row.files.join(', ') : 'none'}`}</span>
                      <span>{`Tests: ${row.tests.length > 0 ? row.tests.join(', ') : 'none'}`}</span>
                    </div>
                    <div className={`plan-brief-route mono${line.error ? ' is-error' : ''}`}>
                      {line.text}
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          {copyMessage && (
            <div className="plan-copy-message mono" role="status">
              {copyMessage}
            </div>
          )}
        </div>
      )}

      {problems.length > 0 && (
        <div className="plan-problems" role="alert">
          {problems.map((problem, index) => (
            <div className="plan-problem" key={`${index}-${problem}`}>
              {problem}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
