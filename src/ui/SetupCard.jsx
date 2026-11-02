import { useEffect, useRef, useState } from 'react'
import { useDialogFocus } from './dialogFocus.js'
import {
  SETUP_LATER,
  SETUP_QUESTION,
  SETUP_START,
  clampAgentCount,
  initialAgentCount,
  pickedLanes,
  postponeSetup,
  setupCountLabel,
  setupFromAnswer,
  setupNeeded,
  setupPostponed,
  setupSavePayload,
} from './setup.js'

const NOOP = () => {}

function messageOf(error, fallback) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export default function SetupCard({
  client = null,
  answer = undefined,
  onClose = NOOP,
  onCheck = NOOP,
}) {
  const [state, setState] = useState(answer)
  const [count, setCount] = useState(() => initialAgentCount(setupFromAnswer(answer)?.max))
  const [closed, setClosed] = useState(() => setupPostponed())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const cardRef = useRef(null)
  const onCheckRef = useRef(onCheck)
  onCheckRef.current = onCheck

  useEffect(() => {
    if (closed || answer !== undefined) {
      onCheckRef.current()
      return undefined
    }
    if (!client || typeof client.lanes !== 'function') {
      setState(null)
      onCheckRef.current()
      return undefined
    }
    let alive = true
    Promise.resolve()
      .then(() => client.lanes())
      .then((value) => {
        if (!alive) return
        setState(value)
        setCount(initialAgentCount(setupFromAnswer(value)?.max))
        if (!setupNeeded(value)) onCheckRef.current()
      })
      .catch(() => {
        if (!alive) return
        setState(null)
        onCheckRef.current()
      })
    return () => {
      alive = false
    }
  }, [answer, client, closed])

  const info = setupFromAnswer(state)
  const needed = setupNeeded(state)
  const canSave = Boolean(client && typeof client.setActiveLanes === 'function')

  useDialogFocus(!closed && needed && Boolean(info), { containerRef: cardRef })

  function change(delta) {
    if (!info) return
    setCount((value) => clampAgentCount(value + delta, info.max))
  }

  function later() {
    postponeSetup()
    setClosed(true)
    onCheckRef.current()
    onClose()
  }

  async function start() {
    if (!info || saving) return
    const payload = setupSavePayload(info.lanes, count)
    if (payload.lanes.length === 0) {
      setError('Pick at least one agent.')
      return
    }
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      await client.setActiveLanes(payload)
      setClosed(true)
      onCheckRef.current()
      onClose()
    } catch (err) {
      setError(messageOf(err, 'The bridge refused the choice.'))
    } finally {
      setSaving(false)
    }
  }

  if (closed || !needed || !info) return null
  const lanes = pickedLanes(info.lanes, count)

  return (
    <div className="mr-setup-backdrop">
      <section
        className="mr-setup"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mr-setup-title"
      >
        <p className="mr-setup-kicker mono">First run</p>
        <h2 className="mr-setup-title" id="mr-setup-title">
          {SETUP_QUESTION}
        </h2>
        <div className="mr-setup-stepper" role="group" aria-label="Agent count">
          <button
            type="button"
            className="mr-setup-step mono"
            aria-label="Fewer agents"
            onClick={() => change(-1)}
            disabled={count <= 1}
          >
            -
          </button>
          <span className="mr-setup-count mono" aria-live="polite">
            {setupCountLabel(count)}
          </span>
          <button
            type="button"
            className="mr-setup-step mono"
            aria-label="More agents"
            onClick={() => change(1)}
            disabled={count >= info.max}
          >
            +
          </button>
        </div>
        <ul className="mr-setup-lanes" aria-label="Agents picked">
          {lanes.map((lane) => (
            <li className="mr-setup-lane" key={lane.key}>
              <span className="mr-setup-lane-name">{lane.name || lane.key}</span>
              <span className="mr-setup-lane-key mono">{lane.key}</span>
            </li>
          ))}
        </ul>
        {!canSave && (
          <p className="mr-setup-note mono">
            Saving agents is not available from this bridge.
          </p>
        )}
        {error && (
          <p className="mr-setup-error mono" role="status">
            {error}
          </p>
        )}
        <div className="mr-setup-actions">
          <button type="button" className="mr-setup-later mono" onClick={later}>
            {SETUP_LATER}
          </button>
          <button
            type="button"
            className="mr-setup-start mono"
            onClick={start}
            disabled={saving || !canSave}
          >
            {saving ? 'Saving' : SETUP_START}
          </button>
        </div>
      </section>
    </div>
  )
}
