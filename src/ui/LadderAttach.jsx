import { useEffect, useId, useRef, useState } from 'react'
import {
  addSub,
  freeLanes,
  idFromName,
  ladderFromOrchestrators,
  removeSub,
  subFromForm,
} from './ladderForm.js'
import { ORCH_REFRESH_MS, errorText } from './orchestratorChat.js'

function emptyForm() {
  return { name: '', id: '', harness: 'opencode', model: '', lanes: [], scope: '', restricted: true }
}

function orchestratorList(value) {
  if (!Array.isArray(value)) return []
  return value.filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id)
}

function AttachForm({ form, lanes, idBase, disabled, onField, onName, onReview, onCancel }) {
  const name = String(form.name ?? '')
  const id = String(form.id ?? '')
  const lanesChosen = Array.isArray(form.lanes) ? form.lanes : []

  function toggleLane(lane) {
    const next = lanesChosen.includes(lane) ? lanesChosen.filter((entry) => entry !== lane) : [...lanesChosen, lane]
    onField('lanes', next)
  }

  return (
    <section className="mr-orch-attach" aria-label="Attach a sub orchestrator">
      <p className="mr-orch-attach-title mono">Attach a sub orchestrator</p>
      <label className="mr-orch-field" htmlFor={`${idBase}-name`}>
        <span className="mr-orch-field-label mono">Name</span>
        <input
          id={`${idBase}-name`}
          className="mr-orch-field-input mono"
          value={name}
          maxLength={40}
          spellCheck="false"
          onChange={(event) => onName(event.target.value)}
        />
      </label>
      <label className="mr-orch-field" htmlFor={`${idBase}-id`}>
        <span className="mr-orch-field-label mono">Id</span>
        <input
          id={`${idBase}-id`}
          className="mr-orch-field-input mono"
          value={id}
          maxLength={24}
          spellCheck="false"
          onChange={(event) => onField('id', event.target.value)}
        />
      </label>
      <label className="mr-orch-field" htmlFor={`${idBase}-harness`}>
        <span className="mr-orch-field-label mono">Harness</span>
        <select
          id={`${idBase}-harness`}
          className="mr-orch-field-input mono"
          value={form.harness === 'claude' ? 'claude' : 'opencode'}
          onChange={(event) => onField('harness', event.target.value)}
        >
          <option value="claude">claude</option>
          <option value="opencode">opencode</option>
        </select>
      </label>
      <label className="mr-orch-field" htmlFor={`${idBase}-model`}>
        <span className="mr-orch-field-label mono">Model</span>
        <input
          id={`${idBase}-model`}
          className="mr-orch-field-input mono"
          value={String(form.model ?? '')}
          spellCheck="false"
          onChange={(event) => onField('model', event.target.value)}
        />
      </label>
      <fieldset className="mr-orch-lanes">
        <legend className="mr-orch-field-label mono">Lanes</legend>
        {lanes.length === 0 ? (
          <p className="mr-orch-hint">Every lane belongs to a sub already.</p>
        ) : (
          lanes.map((lane) => (
            <label key={lane} className="mr-orch-lane">
              <input
                type="checkbox"
                checked={lanesChosen.includes(lane)}
                onChange={() => toggleLane(lane)}
              />
              <span className="mono">{lane}</span>
            </label>
          ))
        )}
      </fieldset>
      <label className="mr-orch-field" htmlFor={`${idBase}-scope`}>
        <span className="mr-orch-field-label mono">Scope, one glob per line</span>
        <textarea
          id={`${idBase}-scope`}
          className="mr-orch-field-input is-scope mono"
          rows={3}
          spellCheck="false"
          value={String(form.scope ?? '')}
          onChange={(event) => onField('scope', event.target.value)}
        />
      </label>
      <label className="mr-orch-switch" htmlFor={`${idBase}-restricted`}>
        <input
          id={`${idBase}-restricted`}
          type="checkbox"
          checked={form.restricted !== false}
          onChange={(event) => onField('restricted', event.target.checked)}
        />
        <span>Restricted</span>
      </label>
      <div className="mr-orch-confirm-actions">
        <button
          type="button"
          className="mr-orch-confirm-btn is-start"
          onClick={onReview}
          disabled={disabled || (!name.trim() && !id.trim())}
        >
          Review
        </button>
        <button type="button" className="mr-orch-confirm-btn is-cancel" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
      </div>
    </section>
  )
}

function AttachConfirm({ sub, saving, onSave, onCancel }) {
  const lanes = sub.lanes.length > 0 ? sub.lanes.join(', ') : 'none'
  const scope = sub.scope.length > 0 ? sub.scope.join(', ') : 'none'
  return (
    <section className="mr-orch-confirm is-attach" aria-label="Attach the sub orchestrator">
      <p className="mr-orch-confirm-text">Attach {sub.name || sub.id}?</p>
      <p className="mr-orch-confirm-detail mono">Lanes: {lanes}</p>
      <p className="mr-orch-confirm-detail mono">Scope: {scope}</p>
      <p className="mr-orch-confirm-text">
        {sub.restricted
          ? 'Restricted. Its lanes may change files only in its scope.'
          : 'Open. Its lanes may change files anywhere in the project.'}
      </p>
      <div className="mr-orch-confirm-actions">
        <button type="button" className="mr-orch-confirm-btn is-start" onClick={onSave} disabled={saving}>
          {saving ? 'Saving' : 'Save'}
        </button>
        <button type="button" className="mr-orch-confirm-btn is-cancel" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </section>
  )
}

function DetachConfirm({ sub, saving, onDetach, onCancel }) {
  return (
    <section className="mr-orch-confirm is-detach" aria-label="Detach the sub orchestrator">
      <p className="mr-orch-confirm-text">
        Detach {sub.name || sub.id}? Its lanes go back to the main orchestrator and its turn stops.
      </p>
      <div className="mr-orch-confirm-actions">
        <button type="button" className="mr-orch-confirm-btn is-stop" onClick={onDetach} disabled={saving}>
          {saving ? 'Saving' : 'Detach'}
        </button>
        <button type="button" className="mr-orch-confirm-btn is-cancel" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </section>
  )
}

export function LadderAttach({ client = null, initialList: initialOrchestrators = null, initialForm = null }) {
  const canLadder = Boolean(
    client && typeof client.orchestrators === 'function' && typeof client.setLadder === 'function'
  )
  const [list, setList] = useState(() => orchestratorList(initialOrchestrators))
  const [form, setForm] = useState(() =>
    initialForm && typeof initialForm === 'object' ? { ...emptyForm(), ...initialForm } : null
  )
  const [idTouched, setIdTouched] = useState(Boolean(initialForm && typeof initialForm === 'object' && initialForm.id))
  const [confirmSub, setConfirmSub] = useState(null)
  const [detach, setDetach] = useState(null)
  const [problems, setProblems] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const formId = useId()
  const readListRef = useRef(null)

  useEffect(() => {
    if (!canLadder) return undefined
    let stopped = false

    async function readList() {
      try {
        const answer = await client.orchestrators()
        const items = Array.isArray(answer) ? answer : Array.isArray(answer?.orchestrators) ? answer.orchestrators : []
        if (stopped || items.length === 0) return
        setList(orchestratorList(items))
      } catch {}
    }

    readListRef.current = readList
    readList()
    const timer = setInterval(readList, ORCH_REFRESH_MS)
    let unsubscribe = null
    if (typeof client.subscribe === 'function') {
      unsubscribe = client.subscribe((notice) => {
        if (notice && notice.topic === 'orchestrator') readList()
      })
    }

    return () => {
      stopped = true
      clearInterval(timer)
      unsubscribe?.()
      readListRef.current = null
    }
  }, [client, canLadder])

  useEffect(() => {
    if (!form && !confirmSub && !detach) return undefined
    function onKey(event) {
      if (event.key !== 'Escape' || saving) return
      if (detach) {
        setDetach(null)
        return
      }
      if (confirmSub) {
        setConfirmSub(null)
        return
      }
      setForm(null)
      setIdTouched(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmSub, detach, form, saving])

  if (!canLadder) return null

  const subs = list.filter((entry) => entry.id !== 'orchestrator')
  const ladder = ladderFromOrchestrators(list)
  const mainLanes = list.find((entry) => entry.id === 'orchestrator')?.lanes ?? []
  const free = freeLanes(mainLanes, ladder)

  function openForm() {
    setForm(emptyForm())
    setIdTouched(false)
    setConfirmSub(null)
    setDetach(null)
    setProblems([])
    setError('')
  }

  function cancelForm() {
    setForm(null)
    setConfirmSub(null)
    setIdTouched(false)
  }

  function changeName(value) {
    setForm((currentForm) => {
      if (!currentForm) return currentForm
      const next = { ...currentForm, name: value }
      if (!idTouched) next.id = idFromName(value)
      return next
    })
  }

  function changeField(field, value) {
    if (field === 'id') setIdTouched(true)
    setForm((currentForm) => (currentForm ? { ...currentForm, [field]: value } : currentForm))
  }

  function reviewForm() {
    if (!form) return
    setProblems([])
    setError('')
    setConfirmSub(subFromForm(form))
  }

  function requestDetach(id) {
    const entry = list.find((item) => item.id === id)
    if (!entry) return
    setDetach(entry)
    setForm(null)
    setConfirmSub(null)
    setProblems([])
    setError('')
  }

  async function saveSub() {
    if (!confirmSub) return
    setSaving(true)
    setError('')
    setProblems([])
    try {
      await client.setLadder(addSub(ladder, confirmSub))
      setConfirmSub(null)
      setForm(null)
      setIdTouched(false)
      await readListRef.current?.()
    } catch (failure) {
      const nextProblems = Array.isArray(failure?.problems) ? failure.problems : []
      setProblems(nextProblems)
      if (nextProblems.length === 0) setError(errorText(failure, 'Could not save the ladder.'))
    } finally {
      setSaving(false)
    }
  }

  async function saveDetach() {
    if (!detach) return
    setSaving(true)
    setError('')
    setProblems([])
    try {
      await client.setLadder(removeSub(ladder, detach.id))
      setDetach(null)
      setConfirmSub(null)
      setForm(null)
      setIdTouched(false)
      await readListRef.current?.()
    } catch (failure) {
      const nextProblems = Array.isArray(failure?.problems) ? failure.problems : []
      setProblems(nextProblems)
      if (nextProblems.length === 0) setError(errorText(failure, 'Could not save the ladder.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mr-ladder" aria-label="Sub orchestrators">
      {form ? (
        <AttachForm
          form={form}
          lanes={free}
          idBase={formId}
          disabled={saving}
          onField={changeField}
          onName={changeName}
          onReview={reviewForm}
          onCancel={cancelForm}
        />
      ) : confirmSub ? (
        <AttachConfirm
          sub={confirmSub}
          saving={saving}
          onSave={saveSub}
          onCancel={() => setConfirmSub(null)}
        />
      ) : detach ? (
        <DetachConfirm sub={detach} saving={saving} onDetach={saveDetach} onCancel={() => setDetach(null)} />
      ) : (
        <>
          <div className="mr-side-head">
            <span className="mr-side-head-title mono">Sub orchestrators</span>
            <button type="button" className="mr-orch-attach-open" onClick={openForm} disabled={saving}>
              Attach
            </button>
          </div>
          {subs.length === 0 ? <p className="mr-side-note">No sub orchestrators yet.</p> : null}
          <div className="mr-ladder-subs">
            {subs.map((sub) => {
              const label = sub.name || sub.id
              return (
                <div className="mr-ladder-sub" key={sub.id}>
                  <span className="mr-ladder-sub-label">{label}</span>
                  <button
                    type="button"
                    className="mr-side-action is-danger"
                    aria-label={`Detach ${label}`}
                    disabled={saving}
                    onClick={() => requestDetach(sub.id)}
                  >
                    Detach
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
      {error ? (
        <p className="mr-side-error mono" role="alert">
          {error}
        </p>
      ) : null}
      {problems.length > 0 ? (
        <div className="mr-ladder-problems" role="alert">
          <p className="mr-side-note">Fix these and save again.</p>
          <ul className="mr-orch-problems">
            {problems.map((entry, index) => (
              <li key={index}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

export default LadderAttach
