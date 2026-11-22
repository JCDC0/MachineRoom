import { useEffect, useRef, useState } from 'react'
import { useDialogFocus } from './dialogFocus.js'

export const UNLOCK_TEXT =
  'Allow subagents deeper than 2 levels? Each level can multiply the runs, tokens and cost of one task, and a deep tree is hard to stop. Only unlock this if you watch the costs.'

export const DEPTH_CHOICES = [1, 2]
export const UNLOCKED_CHOICES = [1, 2, 3, 4]

function normalizedRings(value) {
  if (!Array.isArray(value)) return null
  const byRing = new Map()
  for (const item of value) {
    if (!item || !Number.isInteger(item.ring) || item.ring < 0) continue
    if (!Number.isInteger(item.agents) || item.agents <= 0) continue
    byRing.set(item.ring, (byRing.get(item.ring) ?? 0) + item.agents)
  }
  return [...byRing.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ring, agents]) => ({ ring, agents }))
}

export function hideOccupiedText(ringOrRings, agentsOrDepth, maybeDepth) {
  if (Array.isArray(ringOrRings)) {
    const depth = agentsOrDepth
    const occupied = (normalizedRings(ringOrRings) ?? []).filter((item) => item.ring >= depth)
    if (occupied.length === 0) return ''
    if (occupied.length === 1) {
      return hideOccupiedText(occupied[0].ring, occupied[0].agents, depth)
    }
    const total = occupied.reduce((sum, item) => sum + item.agents, 0)
    const numbers = occupied.map((item) => item.ring)
    const list = `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`
    const who = total === 1 ? '1 agent' : `${total} agents`
    const pronoun = total === 1 ? 'it' : 'them'
    return `Rings ${list} hold ${who}. A depth of ${depth} hides ${pronoun} until you raise it again.`
  }
  const who = agentsOrDepth === 1 ? '1 agent' : `${agentsOrDepth} agents`
  const pronoun = agentsOrDepth === 1 ? 'it' : 'them'
  return `Ring ${ringOrRings} holds ${who}. A depth of ${maybeDepth} hides ${pronoun} until you raise it again.`
}

export function depthAnswer(value, fallback = null) {
  const limit =
    Number.isInteger(value?.limit) && value.limit >= 1 && value.limit <= 4
      ? value.limit
      : Number.isInteger(fallback?.limit) && fallback.limit >= 1 && fallback.limit <= 4
        ? fallback.limit
        : 2
  const unlocked = typeof value?.unlocked === 'boolean' ? value.unlocked : fallback?.unlocked === true
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
  const explicitRings = normalizedRings(value?.rings)
  const rings =
    explicitRings !== null
      ? explicitRings
      : Number.isInteger(value?.deepest)
        ? deepest > 0 && deepestAgents > 0
          ? [{ ring: deepest, agents: deepestAgents }]
          : []
        : normalizedRings(fallback?.rings) ?? (deepest > 0 && deepestAgents > 0 ? [{ ring: deepest, agents: deepestAgents }] : [])
  return { limit, unlocked, deepest, deepestAgents, rings }
}

export default function AgentDepthSettings({ client = null }) {
  const canRead = Boolean(client) && typeof client.agentDepth === 'function'
  const canWrite = Boolean(client) && typeof client.setAgentDepth === 'function'
  const available = canRead && canWrite
  const [state, setState] = useState({ limit: 2, unlocked: false, deepest: 0, deepestAgents: 0, rings: [] })
  const [loading, setLoading] = useState(available)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  const readSeqRef = useRef(0)
  const cardRef = useRef(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!available) return undefined
    let alive = true
    const seq = ++readSeqRef.current
    setLoading(true)
    setError('')
    Promise.resolve()
      .then(() => client.agentDepth())
      .then((answer) => {
        if (!alive || seq !== readSeqRef.current) return
        setState(depthAnswer(answer))
        setLoading(false)
      })
      .catch((failure) => {
        if (!alive || seq !== readSeqRef.current) return
        setLoading(false)
        setError(String(failure?.message ?? failure))
      })
    return () => {
      alive = false
    }
  }, [client, available])

  useEffect(() => {
    if (!available || typeof client?.subscribe !== 'function') return undefined
    let alive = true
    const unsubscribe = client.subscribe((notice) => {
      if (!notice) return
      if (notice.topic !== 'family' && notice.topic !== 'agents') return
      const seq = ++readSeqRef.current
      Promise.resolve()
        .then(() => client.agentDepth())
        .then((answer) => {
          if (!alive || seq !== readSeqRef.current) return
          const next = depthAnswer(answer)
          setState(next)
          setLoading(false)
          setDialog((current) =>
            current?.kind === 'hide' && (current.limit > next.deepest || current.limit >= next.limit)
              ? null
              : current
          )
        })
        .catch(() => {
          if (alive && seq === readSeqRef.current) setLoading(false)
        })
    })
    return () => {
      alive = false
      if (typeof unsubscribe === 'function') unsubscribe()
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
      if (!mountedRef.current) return
      readSeqRef.current += 1
      setState((current) => depthAnswer(answer ?? payload, current))
    } catch (failure) {
      if (!mountedRef.current) return
      if (
        patch.hideOccupied !== true &&
        Number.isInteger(failure?.deepest) &&
        failure.deepest >= payload.limit
      ) {
        readSeqRef.current += 1
        setState((current) => depthAnswer(failure, current))
        setDialog({ kind: 'hide', limit: payload.limit, unlocked: payload.unlocked })
      } else {
        setError(String(failure?.message ?? failure))
      }
    } finally {
      busyRef.current = false
      if (mountedRef.current) setBusy(false)
    }
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
    openerSelector: 'mr-depth-confirm',
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
              aria-controls="mr-depth-confirm"
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
              aria-controls="mr-depth-confirm"
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
              : hideOccupiedText(state.rings, dialog.limit) ||
                hideOccupiedText(state.deepest, state.deepestAgents, dialog.limit)}
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
