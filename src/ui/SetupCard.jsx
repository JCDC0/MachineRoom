import { useEffect, useRef, useState } from 'react'
import { useDialogFocus } from './dialogFocus.js'
import {
  SETUP_LATER,
  SETUP_QUESTION,
  clampAgentCount,
  initialAgentCount,
  pickedLanes,
  postponeSetup,
  setupCountLabel,
  setupFromAnswer,
  setupNeeded,
  setupPostponed,
  setupProjects,
  setupSavePayload,
  setupStartLabel,
  setupTeams,
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
  const [teams, setTeams] = useState([])
  const [projects, setProjects] = useState([])
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

  useEffect(() => {
    if (closed || !client) return undefined
    let alive = true
    Promise.resolve()
      .then(() => client.teams?.())
      .then((value) => {
        if (alive && value) setTeams(setupTeams(value))
      })
      .catch(() => {})
    Promise.resolve()
      .then(() => client.projects?.())
      .then((value) => {
        if (alive && value) setProjects(setupProjects(value))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [client, closed])

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

  async function applyTeam(name) {
    if (saving) return
    if (typeof client?.applyTeam !== 'function') {
      setError('This bridge cannot apply a team.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await client.applyTeam({ name, confirmed: true })
      setClosed(true)
      onCheckRef.current()
      onClose()
    } catch (err) {
      setError(messageOf(err, 'The bridge refused the team.'))
    } finally {
      setSaving(false)
    }
  }

  async function copyTeam(path) {
    if (saving) return
    if (typeof client?.copyProjectTeam !== 'function') {
      setError('This bridge cannot copy a team.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await client.copyProjectTeam({ path, confirmed: true })
      setClosed(true)
      onCheckRef.current()
      onClose()
    } catch (err) {
      setError(messageOf(err, 'The bridge refused the copy.'))
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
        {teams.length > 0 ? (
          <div className="mr-setup-options" role="group" aria-label="Saved teams">
            <p className="mr-setup-options-title mono">Saved teams</p>
            {teams.map((team) => (
              <button
                type="button"
                className="mr-setup-team mono"
                key={team.name}
                disabled={saving || typeof client?.applyTeam !== 'function'}
                onClick={() => applyTeam(team.name)}
              >
                {team.name}
              </button>
            ))}
          </div>
        ) : null}
        {projects.length > 0 && typeof client?.copyProjectTeam === 'function' ? (
          <div className="mr-setup-options" role="group" aria-label="Copy a team">
            <p className="mr-setup-options-title mono">Copy from</p>
            {projects.map((row) => (
              <button
                type="button"
                className="mr-setup-team mono"
                key={row.path}
                disabled={saving}
                onClick={() => copyTeam(row.path)}
              >
                {`Copy from ${row.name}`}
              </button>
            ))}
          </div>
        ) : null}
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
            {saving ? 'Saving' : setupStartLabel(count)}
          </button>
        </div>
      </section>
    </div>
  )
}
