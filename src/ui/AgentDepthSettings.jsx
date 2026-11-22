import { useEffect, useRef, useState } from 'react'
import { useDialogFocus } from './dialogFocus.js'

export const UNLOCK_TEXT =
  'Allow subagents deeper than 2 levels? Each level can multiply the runs, tokens and cost of one task, and a deep tree is hard to stop. Only unlock this if you watch the costs.'

export const DEPTH_CHOICES = [1, 2]
export const UNLOCKED_CHOICES = [1, 2, 3, 4]

export function hideOccupiedText(ring, agents, depth) {
  const who = agents === 1 ? '1 agent' : `${agents} agents`
  const pronoun = agents === 1 ? 'it' : 'them'
  return `Ring ${ring} holds ${who}. A depth of ${depth} hides ${pronoun} until you raise it again.`
}

export function depthAnswer(value, fallback = null) {
  const limit = Number.isInteger(value?.limit) && value.limit >= 1 && value.limit <= 4 ? value.limit : 2
  const deepest =
    Number.isInteger(value?.deepest) && value.deepest >= 0
      ? value.deepest
      : Number.isInteger(fallback?.deepest) && fallback.deepest >= 0
        ? fallback.deepest
        : 0
  const deepestAgents =
    Number.isInteger(value?.deepestAgents) && value.deepestAgents >= 0
      ? value.deepestAgents
      : fallback && fallback.deepest === deepest && Number.isInteger(fallback.deepestAgents) && fallback.deepestAgents >= 0
        ? fallback.deepestAgents
        : deepest > 0
          ? 1
          : 0
  return { limit, unlocked: value?.unlocked === true, deepest, deepestAgents }
}

export default function AgentDepthSettings({ client = null }) {
  const canRead = Boolean(client) && typeof client.agentDepth === 'function'
  const canWrite = Boolean(client) && typeof client.setAgentDepth === 'function'
  const available = canRead && canWrite
  const [state, setState] = useState({ limit: 2, unlocked: false, deepest: 0, deepestAgents: 0 })
  const [loading, setLoading] = useState(available)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState(null)
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
    const payload = {
      limit: patch.limit ?? state.limit,
      unlocked: patch.unlocked ?? state.unlocked,
      confirmed: true,
    }
    if (patch.hideOccupied === true) payload.hideOccupied = true
    try {
      const answer = await client.setAgentDepth(payload)
      setState((current) => depthAnswer(answer ?? payload, current))
    } catch (failure) {
      setError(String(failure?.message ?? failure))
    }
    busyRef.current = false
    setBusy(false)
  }

  function pickDepth(depth, unlocked = state.unlocked) {
    if (depth < state.limit && depth <= state.deepest) {
      setError('')
      setDialog({ kind: 'hide', limit: depth, unlocked })
      return
    }
    setDialog(null)
    save({ limit: depth, unlocked })
  }

  const dialogKey = dialog ? `${dialog.kind}:${dialog.limit ?? ''}` : false
  useDialogFocus(dialogKey, {
    containerRef: cardRef,
    openerSelector: dialog?.kind === 'unlock' ? 'mr-depth-confirm' : '',
  })

  useEffect(() => {
    if (!dialog) return undefined
    function onKey(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      setDialog(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dialog])

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
              onClick={() => pickDepth(depth)}
            >
              {depth}
            </button>
          ))}
          {state.unlocked ? (
            <button
              type="button"
              className="mr-depth-unlock"
              disabled={loading || busy}
              onClick={() => pickDepth(2, false)}
            >
              Lock
            </button>
          ) : (
            <button
              type="button"
              className="mr-depth-unlock"
              aria-controls="mr-depth-confirm"
              aria-expanded={dialog?.kind === 'unlock'}
              disabled={loading || busy}
              onClick={() => {
                setError('')
                setDialog({ kind: 'unlock' })
              }}
            >
              Unlock
            </button>
          )}
        </div>
      </div>
      {loading && <p className="mr-depth-state mono">Loading</p>}
      {error !== '' && <p className="mr-depth-state mono is-error">{error}</p>}
      {dialog && (
        <section
          id="mr-depth-confirm"
          ref={cardRef}
          className="mr-depth-confirm"
          aria-label={dialog.kind === 'unlock' ? 'Unlock subagent depth' : 'Hide occupied ring'}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            setDialog(null)
          }}
        >
          <p className="mr-depth-confirm-text">
            {dialog.kind === 'unlock'
              ? UNLOCK_TEXT
              : hideOccupiedText(state.deepest, state.deepestAgents, dialog.limit)}
          </p>
          <div className="mr-depth-confirm-actions">
            <button
              type="button"
              className="mr-depth-confirm-btn is-cancel"
              disabled={busy}
              onClick={() => setDialog(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="mr-depth-confirm-btn is-danger"
              disabled={busy}
              onClick={() => {
                const current = dialog
                setDialog(null)
                if (current.kind === 'unlock') {
                  save({ limit: state.limit, unlocked: true })
                } else {
                  save({ limit: current.limit, unlocked: current.unlocked, hideOccupied: true })
                }
              }}
            >
              {dialog.kind === 'unlock' ? 'Unlock' : 'Hide'}
            </button>
          </div>
        </section>
      )}
    </section>
  )
}
