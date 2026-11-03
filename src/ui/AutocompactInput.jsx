import { useEffect, useId, useRef, useState } from 'react'
import {
  autocompactRequest,
  autocompactState,
  compactsAtLine,
  convertAutocompactValue,
  valueProblem,
} from './autocompact.js'

function messageOf(error, fallback) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export default function AutocompactInput({ orchestrator = null, client = null, onSaved = () => {} }) {
  const snapshot = autocompactState(orchestrator)
  const [on, setOn] = useState(snapshot.on)
  const [mode, setMode] = useState(snapshot.mode)
  const [value, setValue] = useState(String(snapshot.value))
  const [rules, setRules] = useState(snapshot.rules)
  const [confirm, setConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const inputId = useId()
  const rulesId = useId()
  const idRef = useRef(snapshot.id)
  const dirtyRef = useRef({ on: false, mode: false, value: false, rules: false })

  useEffect(() => {
    const next = autocompactState(orchestrator)
    if (idRef.current !== next.id) {
      idRef.current = next.id
      dirtyRef.current = { on: false, mode: false, value: false, rules: false }
      setOn(next.on)
      setMode(next.mode)
      setValue(String(next.value))
      setRules(next.rules)
      setConfirm(false)
      setError('')
      return
    }
    const dirty = dirtyRef.current
    if (!dirty.on) setOn(next.on)
    if (!dirty.mode) setMode(next.mode)
    if (!dirty.value) setValue(String(next.value))
    if (!dirty.rules) setRules(next.rules)
    setError('')
  }, [
    orchestrator?.id,
    orchestrator?.autocompact,
    orchestrator?.autocompactMode,
    orchestrator?.autocompactValue,
    orchestrator?.autocompactPercent,
    orchestrator?.compactRules,
    orchestrator?.contextWindow,
  ])

  const problem = valueProblem(mode, value)
  const at = compactsAtLine(mode, value, snapshot.window)
  const canSave = typeof client?.setAutocompact === 'function'
  const name = typeof orchestrator?.name === 'string' && orchestrator.name.trim()
    ? orchestrator.name.trim()
    : 'the orchestrator'
  const usingDefault = rules.trim() === ''

  function flipUnit(next) {
    if (next === mode) return
    const number = Number(value)
    if (value.trim() !== '' && Number.isFinite(number)) {
      setValue(String(convertAutocompactValue(number, mode, next, snapshot.window)))
    }
    dirtyRef.current.mode = true
    dirtyRef.current.value = true
    setMode(next)
    setSaved('')
  }

  function toggleOn(next) {
    dirtyRef.current.on = true
    setOn(next)
    setSaved('')
  }

  function ask() {
    if (!canSave || problem || saving) return
    setConfirm(true)
    setError('')
    setSaved('')
  }

  async function save() {
    if (saving) return
    if (typeof client?.setAutocompact !== 'function') {
      setConfirm(false)
      setError('The bridge cannot change autocompact.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const answer = await client.setAutocompact(
        autocompactRequest({ id: snapshot.id, on, mode, value, rules })
      )
      dirtyRef.current = { on: false, mode: false, value: false, rules: false }
      setConfirm(false)
      setSaved('Saved.')
      onSaved(answer)
    } catch (failure) {
      setError(messageOf(failure, 'The bridge refused the change.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mr-autocompact" aria-label="Autocompact">
      <div className="mr-autocompact-head">
        <label className="mr-autocompact-switch">
          <input
            type="checkbox"
            role="switch"
            aria-label="Autocompact"
            checked={on}
            disabled={!canSave}
            onChange={(event) => toggleOn(event.target.checked)}
          />
          <span>Autocompact</span>
        </label>
        <div className="mr-autocompact-units" role="group" aria-label="Autocompact unit">
          <button
            type="button"
            className="mr-autocompact-unit"
            aria-pressed={mode === 'percent'}
            onClick={() => flipUnit('percent')}
          >
            %
          </button>
          <button
            type="button"
            className="mr-autocompact-unit"
            aria-pressed={mode === 'tokens'}
            onClick={() => flipUnit('tokens')}
          >
            tokens
          </button>
        </div>
      </div>
      <label className="mr-autocompact-label" htmlFor={inputId}>
        Compact at
      </label>
      <input
        id={inputId}
        className="mr-autocompact-number"
        type="number"
        inputMode={mode === 'tokens' ? 'numeric' : 'decimal'}
        min={mode === 'tokens' ? 1000 : 0}
        max={mode === 'tokens' ? 10000000 : 100}
        step={mode === 'tokens' ? 1 : 'any'}
        value={value}
        aria-label="Autocompact value"
        aria-invalid={Boolean(problem)}
        onChange={(event) => {
          dirtyRef.current.value = true
          setValue(event.target.value)
          setSaved('')
        }}
      />
      {at && <p className="mr-autocompact-at mono">{at}</p>}
      {problem && <p className="mr-autocompact-note is-error">{problem}</p>}
      <label className="mr-autocompact-label" htmlFor={rulesId}>
        Compact rules
      </label>
      <textarea
        id={rulesId}
        className="mr-autocompact-rules"
        rows={3}
        maxLength={2000}
        value={rules}
        placeholder={snapshot.defaultCompactRules}
        aria-label="Compact rules"
        onChange={(event) => {
          dirtyRef.current.rules = true
          setRules(event.target.value.slice(0, 2000))
          setSaved('')
        }}
      />
      {usingDefault && <p className="mr-autocompact-note">Using the default rules.</p>}
      <div className="mr-autocompact-actions">
        <button
          type="button"
          className="strip-btn mono"
          onClick={ask}
          disabled={!canSave || Boolean(problem) || saving}
        >
          Save
        </button>
        {saved && <span className="mr-autocompact-saved mono">{saved}</span>}
      </div>
      {!canSave && <p className="mr-autocompact-note">The bridge cannot change autocompact.</p>}
      {confirm && (
        <section className="mr-orch-confirm" aria-label="Save autocompact">
          <p className="mr-orch-confirm-text">{`Save autocompact for ${name}?`}</p>
          <p className="mr-orch-confirm-detail mono">{on ? 'Autocompact is on.' : 'Autocompact is off.'}</p>
          {at && <p className="mr-orch-confirm-detail mono">{at}</p>}
          <p className="mr-orch-confirm-detail mono">
            {usingDefault ? 'Using the default rules.' : 'Saving the owner rules.'}
          </p>
          {error && <p className="mr-autocompact-note is-error">{error}</p>}
          <div className="mr-orch-confirm-actions">
            <button
              type="button"
              className="mr-orch-confirm-btn is-start"
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Saving' : 'Save'}
            </button>
            <button
              type="button"
              className="mr-orch-confirm-btn is-cancel"
              onClick={() => {
                setConfirm(false)
                setError('')
              }}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
    </section>
  )
}
