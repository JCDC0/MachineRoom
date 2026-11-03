import { useEffect, useRef, useState } from 'react'
import { useDialogFocus } from './dialogFocus.js'

export const UNLOCK_TEXT =
  'Allow subagents deeper than 2 levels? Each level can multiply the runs, tokens and cost of one task, and a deep tree is hard to stop. Only unlock this if you watch the costs.'

export const DEPTH_CHOICES = [1, 2]
export const UNLOCKED_CHOICES = [1, 2, 3, 4]

export function depthAnswer(value) {
  const limit = Number.isInteger(value?.limit) && value.limit >= 1 && value.limit <= 4 ? value.limit : 2
  return { limit, unlocked: value?.unlocked === true }
}

export default function AgentDepthSettings({ client = null }) {
  const canRead = Boolean(client) && typeof client.agentDepth === 'function'
  const canWrite = Boolean(client) && typeof client.setAgentDepth === 'function'
  const available = canRead && canWrite
  const [state, setState] = useState({ limit: 2, unlocked: false })
  const [loading, setLoading] = useState(available)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const cardRef = useRef(null)

  useEffect(() => {
    if (!available) return undefined
    let alive = true
    setLoading(true)
    setError('')
    Promise.resolve()
      .then(() => client.agentDepth())
      .then((answer) => {
        if (!alive) return
        setState(depthAnswer(answer))
        setLoading(false)
      })
      .catch((failure) => {
        if (!alive) return
        setLoading(false)
        setError(String(failure?.message ?? failure))
      })
    return () => {
      alive = false
    }
  }, [client, available])

  async function save(patch) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    const next = { ...state, ...patch }
    try {
      const answer = await client.setAgentDepth({ ...next, confirmed: true })
      setState(depthAnswer(answer ?? next))
    } catch (failure) {
      setError(String(failure?.message ?? failure))
    }
    busyRef.current = false
    setBusy(false)
  }

  useDialogFocus(confirm, { containerRef: cardRef, openerSelector: 'mr-depth-confirm' })

  useEffect(() => {
    if (!confirm) return undefined
    function onKey(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      setConfirm(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [confirm])

  if (!available) return null

  const choices = state.unlocked ? UNLOCKED_CHOICES : DEPTH_CHOICES

  return (
    <section className="hud-settings-section mr-depth" aria-labelledby="mr-depth-title">
      <h3 id="mr-depth-title" className="hud-settings-section-title">Subagents</h3>
      <div className="hud-settings-row">
        <span className="hud-settings-label">Subagent depth</span>
        <div className="hud-settings-actions mr-depth-choices">
          {choices.map((depth) => (
            <button
              key={depth}
              type="button"
              className={`mr-depth-choice ${state.limit === depth ? 'is-on' : ''}`}
              aria-label={`Subagent depth ${depth}`}
              aria-pressed={state.limit === depth}
              disabled={loading || busy}
              onClick={() => save({ limit: depth, unlocked: state.unlocked })}
            >
              {depth}
            </button>
          ))}
          {state.unlocked ? (
            <button
              type="button"
              className="mr-depth-unlock"
              disabled={loading || busy}
              onClick={() => save({ limit: 2, unlocked: false })}
            >
              Lock
            </button>
          ) : (
            <button
              type="button"
              className="mr-depth-unlock"
              aria-controls="mr-depth-confirm"
              aria-expanded={confirm}
              disabled={loading || busy}
              onClick={() => {
                setError('')
                setConfirm(true)
              }}
            >
              Unlock
            </button>
          )}
        </div>
      </div>
      {loading && <p className="mr-depth-state mono">Loading</p>}
      {error !== '' && <p className="mr-depth-state mono is-error">{error}</p>}
      {confirm && (
        <section
          id="mr-depth-confirm"
          ref={cardRef}
          className="mr-depth-confirm"
          aria-label="Unlock subagent depth"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            setConfirm(false)
          }}
        >
          <p className="mr-depth-confirm-text">{UNLOCK_TEXT}</p>
          <div className="mr-depth-confirm-actions">
            <button
              type="button"
              className="mr-depth-confirm-btn is-cancel"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="mr-depth-confirm-btn is-danger"
              disabled={busy}
              onClick={() => {
                setConfirm(false)
                save({ limit: state.limit, unlocked: true })
              }}
            >
              Unlock
            </button>
          </div>
        </section>
      )}
    </section>
  )
}
