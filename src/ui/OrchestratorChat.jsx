import { useContext, useEffect, useId, useRef, useState } from 'react'
import CompactCard from './AgentStrip.jsx'
import {
  contextLine,
  effortLabel,
  effortLevels,
  modelChoices,
  orchestratorEffort,
} from './agentStrip.js'
import { addSub, freeLanes, idFromName, ladderFromOrchestrators, removeSub, subFromForm } from './ladderForm.js'
import {
  ORCH_MAX_CHARS,
  ORCH_REFRESH_MS,
  ORCH_START_CONFIRM,
  ORCH_STOP_CONFIRM,
  OrchestratorActivity,
  canSend,
  charCount,
  chatBlocks,
  chatLines,
  clampDraft,
  errorText,
  isSendKey,
  needsStartConfirm,
  normalizeChat,
  projectBaseName,
  statusDetail,
  statusTone,
} from './orchestratorChat.js'

function InlineSpans({ spans }) {
  return spans.map((span, index) =>
    span.kind === 'code' ? (
      <code key={index} className="mr-orch-code">
        {span.text}
      </code>
    ) : (
      <span key={index}>{span.text}</span>
    )
  )
}

function ChatBlocks({ text }) {
  return chatBlocks(text).map((block, index) => {
    if (block.kind === 'code') {
      return (
        <pre key={index} className="mr-orch-block is-code">
          <code>{block.text}</code>
        </pre>
      )
    }
    if (block.kind === 'list') {
      const items = block.items.map((item, itemIndex) => (
        <li key={itemIndex}>
          <InlineSpans spans={item.spans} />
        </li>
      ))
      const start = block.ordered && block.start !== 1 ? block.start : undefined
      return block.ordered ? (
        <ol key={index} className="mr-orch-block is-list" start={start}>
          {items}
        </ol>
      ) : (
        <ul key={index} className="mr-orch-block is-list">
          {items}
        </ul>
      )
    }
    if (block.kind === 'heading') {
      return (
        <p key={index} className="mr-orch-block is-heading">
          <InlineSpans spans={block.spans} />
        </p>
      )
    }
    return (
      <p key={index} className="mr-orch-block is-para">
        <InlineSpans spans={block.spans} />
      </p>
    )
  })
}

function initialChatState(initialChat) {
  return normalizeChat(initialChat)
}

function initialList(value) {
  if (!Array.isArray(value)) return []
  return value.filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id)
}

function emptyForm() {
  return { name: '', id: '', harness: 'opencode', model: '', lanes: [], scope: '', restricted: true }
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

export default function OrchestratorChat({
  client = null,
  open = true,
  onClose,
  inline = false,
  focusRequest = 0,
  onAutocompact = () => ({ ok: true }),
  onOrchestratorChange = () => {},
  selected: selectedTab = undefined,
  onSelect = null,
  initialChat = null,
  initialDraft = '',
  initialConfirm = null,
  initialOrchestrators = null,
  initialSelected = 'orchestrator',
  initialForm = null,
  activity = '',
}) {
  const [chats, setChats] = useState(() => ({ orchestrator: initialChatState(initialChat) }))
  const [list, setList] = useState(() => initialList(initialOrchestrators))
  const [ownSelected, setOwnSelected] = useState(() =>
    typeof initialSelected === 'string' && initialSelected ? initialSelected : 'orchestrator'
  )
  const controlled = typeof selectedTab === 'string' && selectedTab !== ''
  const selected = controlled ? selectedTab : ownSelected
  const [loadedIds, setLoadedIds] = useState(() => (initialChat ? { orchestrator: true } : {}))
  const [draft, setDraft] = useState(() => clampDraft(initialDraft))
  const [confirm, setConfirm] = useState(() =>
    initialConfirm === 'start' || initialConfirm === 'stop' ? initialConfirm : null
  )
  const [startedIds, setStartedIds] = useState(() => {
    const first = initialChatState(initialChat)
    return needsStartConfirm(first) ? {} : { orchestrator: true }
  })
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [saving, setSaving] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState(null)
  const [readError, setReadError] = useState(null)
  const [problems, setProblems] = useState([])
  const [form, setForm] = useState(() =>
    initialForm && typeof initialForm === 'object' ? { ...emptyForm(), ...initialForm } : null
  )
  const [idTouched, setIdTouched] = useState(Boolean(initialForm && typeof initialForm === 'object' && initialForm.id))
  const [confirmSub, setConfirmSub] = useState(null)
  const [detach, setDetach] = useState(null)
  const [modelsOpen, setModelsOpen] = useState(false)
  const [models, setModels] = useState(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [modelConfirm, setModelConfirm] = useState(null)
  const [modelSaving, setModelSaving] = useState(false)
  const [modelError, setModelError] = useState('')
  const [modelSaved, setModelSaved] = useState('')
  const [effortOpen, setEffortOpen] = useState(false)
  const [effortConfirm, setEffortConfirm] = useState('')
  const [effortSaving, setEffortSaving] = useState(false)
  const [effortError, setEffortError] = useState('')
  const [effortSaved, setEffortSaved] = useState('')
  const [compactOpen, setCompactOpen] = useState(false)

  const inputId = useId()
  const formId = useId()
  const logRef = useRef(null)
  const inputRef = useRef(null)
  const readChatRef = useRef(null)
  const readListRef = useRef(null)
  const focusAtRef = useRef(Number(focusRequest) || 0)
  const roomActivity = useContext(OrchestratorActivity)

  const subs = list.filter((entry) => entry.id !== 'orchestrator')
  const current = list.find((entry) => entry.id === selected) ?? null
  const chat = chats[selected] ?? normalizeChat(null)
  const loaded = Boolean(loadedIds[selected])
  const state = loaded ? chat.state : current?.state ?? chat.state
  const doing = selected === 'orchestrator' ? activity || roomActivity : ''
  const status = statusDetail(state, doing)
  const tone = statusTone(state)
  const count = charCount(draft)
  const working = state === 'working'
  const model = chat.model || (typeof current?.model === 'string' ? current.model : '')
  const harness = typeof current?.harness === 'string' ? current.harness : ''
  const shownModel = modelSaved || model || 'not reported'
  const shownEffort = effortSaved || effortLabel(orchestratorEffort(list, selected), harness)
  const modelList = modelChoices(models, harness)
  const effortChoices = effortLevels(harness)
  const context = contextLine({
    context: { tokens: current?.contextTokens, window: current?.contextWindow },
  })
  const canSetModel = inline && typeof client?.setOrchestratorModel === 'function'
  const canSetEffort = inline && typeof client?.setOrchestratorEffort === 'function'
  const project = chat.project
  const projectLabel = projectBaseName(project)
  const lines = chatLines(chat)
  const problem = error ?? readError
  const canAttach = Boolean(
    client && typeof client.orchestrators === 'function' && typeof client.setLadder === 'function' && list.length > 0
  )
  const ladder = ladderFromOrchestrators(list)
  const mainLanes = list.find((entry) => entry.id === 'orchestrator')?.lanes ?? []
  const free = freeLanes(mainLanes, ladder)
  const tabs = [
    {
      id: 'orchestrator',
      label: 'Main',
      state: list.find((entry) => entry.id === 'orchestrator')?.state ?? chats.orchestrator?.state ?? 'idle',
      sub: false,
    },
    ...subs.map((entry) => ({
      id: entry.id,
      label: entry.name || entry.id,
      state: entry.state ?? chats[entry.id]?.state ?? 'idle',
      sub: true,
    })),
  ]
  const startText =
    selected === 'orchestrator'
      ? project
        ? `The orchestrator works in ${project} with full permissions. It plans, starts lanes, merges what passes on a branch and never pushes. It uses your Claude subscription.`
        : ORCH_START_CONFIRM
      : `${current?.name || selected} runs on this project with full permissions. It plans for its lanes, works in its scope and reports to the main orchestrator.`

  useEffect(() => {
    if (!open) return undefined
    if (!client || typeof client.orchestrator !== 'function') {
      setUnavailable(true)
      return undefined
    }
    setUnavailable(false)
    let stopped = false

    async function readList() {
      if (typeof client.orchestrators !== 'function') return
      try {
        const answer = await client.orchestrators()
        const items = Array.isArray(answer) ? answer : Array.isArray(answer?.orchestrators) ? answer.orchestrators : []
        if (stopped || items.length === 0) return
        setList(items.filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id))
      } catch {}
    }

    readListRef.current = readList
    readList()
    const timer = setInterval(readList, ORCH_REFRESH_MS)

    return () => {
      stopped = true
      clearInterval(timer)
      readListRef.current = null
    }
  }, [open, client])

  useEffect(() => {
    if (!open) return undefined
    if (!client || typeof client.orchestrator !== 'function') {
      setUnavailable(true)
      return undefined
    }
    setUnavailable(false)
    let stopped = false
    const id = selected

    async function readChat() {
      try {
        const answer = await client.orchestrator(id === 'orchestrator' ? undefined : id)
        if (stopped) return
        const next = normalizeChat(answer)
        setChats((currentChats) => ({ ...currentChats, [id]: next }))
        setLoadedIds((currentLoaded) => (currentLoaded[id] ? currentLoaded : { ...currentLoaded, [id]: true }))
        setReadError(null)
        setList((currentList) =>
          currentList.map((entry) => (entry.id === id ? { ...entry, state: next.state } : entry))
        )
      } catch (failure) {
        if (stopped) return
        setLoadedIds((currentLoaded) => ({ ...currentLoaded, [id]: true }))
        setReadError(errorText(failure, 'Could not read the orchestrator.'))
      }
    }

    readChatRef.current = readChat
    readChat()
    const timer = setInterval(readChat, ORCH_REFRESH_MS)
    let unsubscribe = null
    if (typeof client.subscribe === 'function') {
      unsubscribe = client.subscribe((notice) => {
        if (notice && notice.topic === 'orchestrator') {
          readChat()
          readListRef.current?.()
        }
      })
    }

    return () => {
      stopped = true
      clearInterval(timer)
      unsubscribe?.()
      readChatRef.current = null
    }
  }, [open, client, selected])

  useEffect(() => {
    if (!open || inline) return undefined
    const timer = setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(timer)
  }, [open, inline])

  useEffect(() => {
    if (!inline) return
    const next = Number(focusRequest) || 0
    if (next === focusAtRef.current) return
    focusAtRef.current = next
    inputRef.current?.focus()
  }, [inline, focusRequest])

  useEffect(() => {
    setModelsOpen(false)
    setEffortOpen(false)
    setCompactOpen(false)
    setModelConfirm(null)
    setEffortConfirm('')
    setModelError('')
    setEffortError('')
    setModelSaved('')
    setEffortSaved('')
  }, [selected])

  useEffect(() => {
    setModelSaved('')
  }, [current?.model])

  useEffect(() => {
    setEffortSaved('')
  }, [current?.effort])

  useEffect(() => {
    if (open && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [open, selected, lines.length])

  useEffect(() => {
    if (!open) return undefined
    function onKey(event) {
      if (event.key !== 'Escape') return
      if (saving) return
      if (detach) {
        setDetach(null)
        return
      }
      if (confirmSub) {
        setConfirmSub(null)
        return
      }
      if (form) {
        setForm(null)
        setIdTouched(false)
        return
      }
      if (confirm) {
        setConfirm(null)
        return
      }
      onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, confirm, confirmSub, detach, form, saving, onClose])

  useEffect(() => {
    if (selected === 'orchestrator' || list.length === 0) return
    if (!list.some((entry) => entry.id === selected)) changeSelected('orchestrator')
  }, [list, selected])

  function changeSelected(id) {
    if (controlled) onSelect?.(id)
    else setOwnSelected(id)
  }

  async function deliver(text, id = selected) {
    if (!client) {
      setError('The orchestrator is not connected.')
      return
    }
    setSending(true)
    setError(null)
    setProblems([])
    setConfirm(null)
    try {
      if (typeof client.sendOrchestrator === 'function') {
        await client.sendOrchestrator(text, id === 'orchestrator' ? {} : { id })
      } else if (id === 'orchestrator' && typeof client.sendToOrchestrator === 'function') {
        await client.sendToOrchestrator(text, { confirmed: true })
      } else {
        throw new Error('The orchestrator is not connected.')
      }
      setStartedIds((currentStarted) => ({ ...currentStarted, [id]: true }))
      setDraft((currentDraft) => (currentDraft.trim() === text ? '' : currentDraft))
      if (id === selected) await readChatRef.current?.()
      await readListRef.current?.()
    } catch (failure) {
      setError(errorText(failure, 'Could not send the message.'))
    } finally {
      setSending(false)
    }
  }

  function requestSend() {
    const text = draft.trim()
    if (!canSend(text) || sending || unavailable) return
    if (!startedIds[selected] && needsStartConfirm(chat)) {
      setConfirm('start')
      return
    }
    deliver(text)
  }

  function startConfirmed() {
    const text = draft.trim()
    setConfirm(null)
    if (canSend(text)) deliver(text)
  }

  function stopConfirmed() {
    if (!client || typeof client.stopOrchestrator !== 'function') {
      setError('The orchestrator is not connected.')
      return
    }
    setStopping(true)
    setError(null)
    const options = selected === 'orchestrator' ? { confirmed: true } : { confirmed: true, id: selected }
    client
      .stopOrchestrator(options)
      .then(async () => {
        setConfirm(null)
        if (selected === 'orchestrator') await readChatRef.current?.()
        await readListRef.current?.()
      })
      .catch((failure) => setError(errorText(failure, 'Could not stop the orchestrator.')))
      .finally(() => setStopping(false))
  }

  function handleSubmit(event) {
    event.preventDefault()
    requestSend()
  }

  function handleKeyDown(event) {
    if (sending) return
    if (!isSendKey(event)) return
    event.preventDefault()
    requestSend()
  }

  function closePickers() {
    setModelsOpen(false)
    setEffortOpen(false)
    setCompactOpen(false)
    setModelConfirm(null)
    setEffortConfirm('')
    setModelError('')
    setEffortError('')
  }

  function messageOf(failure, fallback) {
    return errorText(failure, fallback)
  }

  async function openModels() {
    if (modelsOpen) {
      setModelsOpen(false)
      return
    }
    closePickers()
    setModelsOpen(true)
    if (models !== null || typeof client?.models !== 'function') return
    setModelsLoading(true)
    setModelsError('')
    try {
      setModels(await client.models())
    } catch (failure) {
      setModelsError(messageOf(failure, 'Models are not available.'))
    } finally {
      setModelsLoading(false)
    }
  }

  async function saveModel() {
    if (!modelConfirm || modelSaving) return
    if (typeof client?.setOrchestratorModel !== 'function') {
      setModelError('The bridge cannot set a model.')
      return
    }
    setModelSaving(true)
    setModelError('')
    try {
      await client.setOrchestratorModel({
        id: selected,
        model: modelConfirm.id,
        confirmed: true,
      })
      setModelSaved(modelConfirm.label)
      setModelConfirm(null)
      onOrchestratorChange()
    } catch (failure) {
      setModelError(messageOf(failure, 'The bridge refused the model.'))
    } finally {
      setModelSaving(false)
    }
  }

  function openEffort() {
    if (effortOpen) {
      setEffortOpen(false)
      return
    }
    closePickers()
    setEffortOpen(true)
  }

  async function saveEffort() {
    if (!effortConfirm || effortSaving) return
    if (typeof client?.setOrchestratorEffort !== 'function') {
      setEffortError('The bridge cannot set an effort.')
      return
    }
    setEffortSaving(true)
    setEffortError('')
    try {
      await client.setOrchestratorEffort({
        id: selected,
        effort: effortConfirm,
        confirmed: true,
      })
      setEffortSaved(effortConfirm)
      setEffortConfirm('')
      onOrchestratorChange()
    } catch (failure) {
      setEffortError(messageOf(failure, 'The bridge refused the effort.'))
    } finally {
      setEffortSaving(false)
    }
  }

  function toggleCompact() {
    if (compactOpen) {
      setCompactOpen(false)
      return
    }
    closePickers()
    setCompactOpen(true)
  }

  function selectTab(id) {
    if (id === selected) return
    changeSelected(id)
    setConfirm(null)
    setConfirmSub(null)
    setDetach(null)
    setForm(null)
    setIdTouched(false)
    setProblems([])
    setError(null)
    setReadError(null)
  }

  function openForm() {
    setForm(emptyForm())
    setIdTouched(false)
    setConfirm(null)
    setConfirmSub(null)
    setDetach(null)
    setProblems([])
    setError(null)
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
    setError(null)
    setConfirmSub(subFromForm(form))
  }

  function requestDetach(id) {
    const entry = list.find((item) => item.id === id)
    if (!entry) return
    setDetach(entry)
    setForm(null)
    setConfirmSub(null)
    setConfirm(null)
    setProblems([])
    setError(null)
  }

  async function saveSub() {
    if (!confirmSub) return
    if (!client || typeof client.setLadder !== 'function') {
      setError('The ladder is not connected.')
      return
    }
    setSaving(true)
    setError(null)
    setProblems([])
    try {
      await client.setLadder(addSub(ladder, confirmSub))
      const id = confirmSub.id
      setConfirmSub(null)
      setForm(null)
      setIdTouched(false)
      await readListRef.current?.()
      changeSelected(id)
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
    if (!client || typeof client.setLadder !== 'function') {
      setError('The ladder is not connected.')
      return
    }
    setSaving(true)
    setError(null)
    setProblems([])
    try {
      const id = detach.id
      await client.setLadder(removeSub(ladder, id))
      setDetach(null)
      setConfirmSub(null)
      setForm(null)
      setIdTouched(false)
      await readListRef.current?.()
      if (selected === id) changeSelected('orchestrator')
    } catch (failure) {
      const nextProblems = Array.isArray(failure?.problems) ? failure.problems : []
      setProblems(nextProblems)
      if (nextProblems.length === 0) setError(errorText(failure, 'Could not save the ladder.'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <aside
      id={inline ? undefined : 'hud-orchestrator-chat'}
      className={`mr-orch${inline ? ' is-inline' : ''}`}
      aria-label="Orchestrator chat"
    >
      {!inline || canAttach ? (
        <header className="mr-orch-head">
          <span className="mr-orch-title">Orchestrator</span>
          {canAttach ? (
            <button type="button" className="mr-orch-attach-open" onClick={openForm} disabled={saving}>
              Attach
            </button>
          ) : null}
          {model ? <span className="mr-orch-model mono">{model}</span> : null}
          {projectLabel ? (
            <span className="mr-orch-project mr-orch-model mono" title={project}>
              {projectLabel}
            </span>
          ) : null}
          {inline ? null : (
            <button
              type="button"
              className="mr-orch-close"
              onClick={() => onClose?.()}
              aria-label="Close orchestrator chat"
            >
              ×
            </button>
          )}
        </header>
      ) : null}

      {subs.length > 0 ? (
        <div className="mr-orch-tabs" aria-label="Orchestrators">
          {tabs.map((tab) => {
            const active = selected === tab.id
            return (
              <div key={tab.id} className={`mr-orch-tab-wrap${active ? ' is-active' : ''}`}>
                <button
                  type="button"
                  className={`mr-orch-tab${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => selectTab(tab.id)}
                >
                  <span className={`mr-orch-tab-dot is-${statusTone(tab.state)}`} aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
                {tab.sub ? (
                  <button
                    type="button"
                    className="mr-orch-tab-detach"
                    aria-label={`Detach ${tab.label}`}
                    onClick={() => requestDetach(tab.id)}
                    disabled={saving}
                  >
                    Detach
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      <p className={`mr-orch-status is-${tone} mono`} role="status" aria-live="polite">
        <span className="mr-orch-dot" aria-hidden="true" />
        <span>{status}</span>
      </p>

      {problem || problems.length > 0 ? (
        <div className="mr-orch-error" role="alert">
          {problem ? <p>{problem}</p> : null}
          {problems.length > 0 ? (
            <>
              <p>Fix these and save again.</p>
              <ul className="mr-orch-problems">
                {problems.map((entry, index) => (
                  <li key={index}>{entry}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

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
          <div className="mr-orch-log" role="log" aria-live="polite" ref={logRef}>
            {lines.length === 0 ? (
              <p className="mr-orch-empty">
                {loaded ? 'Tell the orchestrator what you want built.' : 'Reading the chat.'}
              </p>
            ) : (
              lines.map((line) => (
                <div key={line.id} className={`mr-orch-line is-${line.from}`}>
                  {line.from === 'room' ? <span className="mr-orch-who mono">room</span> : null}
                  {line.from === 'owner' ? (
                    <span className="mr-orch-text">{line.text}</span>
                  ) : (
                    <div className={`mr-orch-blocks is-${line.from}`}>
                      <ChatBlocks text={line.text} />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {confirm === 'start' ? (
            <section className="mr-orch-confirm" aria-label="Start the orchestrator">
              <p className="mr-orch-confirm-text">{startText}</p>
              <div className="mr-orch-confirm-actions">
                <button
                  type="button"
                  className="mr-orch-confirm-btn is-start"
                  onClick={startConfirmed}
                  disabled={sending || !canSend(draft)}
                >
                  Start
                </button>
                <button
                  type="button"
                  className="mr-orch-confirm-btn is-cancel"
                  onClick={() => setConfirm(null)}
                  disabled={sending}
                >
                  Cancel
                </button>
              </div>
            </section>
          ) : null}

          {confirm === 'stop' ? (
            <section className="mr-orch-confirm is-stop" aria-label="Stop the orchestrator">
              <p className="mr-orch-confirm-text">{ORCH_STOP_CONFIRM}</p>
              <div className="mr-orch-confirm-actions">
                <button
                  type="button"
                  className="mr-orch-confirm-btn is-stop"
                  onClick={stopConfirmed}
                  disabled={stopping}
                >
                  Stop
                </button>
                <button
                  type="button"
                  className="mr-orch-confirm-btn is-cancel"
                  onClick={() => setConfirm(null)}
                  disabled={stopping}
                >
                  Cancel
                </button>
              </div>
            </section>
          ) : null}

          {inline ? (
            <form className="mr-orch-form hud-lower-input" onSubmit={handleSubmit}>
              <textarea
                id={inputId}
                ref={inputRef}
                className="mr-orch-input mono"
                value={draft}
                maxLength={ORCH_MAX_CHARS}
                rows={2}
                spellCheck="false"
                placeholder="Ask the orchestrator anything"
                aria-label="Message to the orchestrator"
                onChange={(event) => setDraft(clampDraft(event.target.value))}
                onKeyDown={handleKeyDown}
              />
              <div className="hud-lower-tools">
                <button
                  type="button"
                  className="hud-strip-model"
                  aria-expanded={modelsOpen}
                  aria-label={`Models for ${current?.name || 'the orchestrator'}`}
                  onClick={openModels}
                >
                  <span>Model:</span>
                  <span className="hud-lower-picker-value mono">{shownModel}</span>
                  <span className="hud-lower-picker-v mono" aria-hidden="true">
                    V
                  </span>
                </button>
                <button
                  type="button"
                  className="hud-strip-effort"
                  aria-expanded={effortOpen}
                  aria-label={`Effort for ${current?.name || 'the orchestrator'}`}
                  onClick={openEffort}
                >
                  <span>Effort:</span>
                  <span className="hud-lower-picker-value mono">{shownEffort}</span>
                  <span className="hud-lower-picker-v mono" aria-hidden="true">
                    V
                  </span>
                </button>
                <button
                  type="button"
                  className="hud-strip-compact"
                  aria-expanded={compactOpen}
                  onClick={toggleCompact}
                >
                  Compact
                </button>
                <span className="hud-lower-context mono">{context}</span>
                {working ? (
                  <button
                    type="button"
                    className="mr-orch-stop hud-lower-stop"
                    onClick={() => setConfirm('stop')}
                    disabled={stopping}
                  >
                    Stop
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="hud-lower-send"
                  aria-label={sending ? 'Sending' : 'Send'}
                  disabled={!canSend(draft) || sending || unavailable}
                >
                  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                    <path
                      d="M2 8h11M9 4l4 4-4 4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              <div className="mr-orch-meta">
                {count ? <span className="mr-orch-count mono">{count}</span> : null}
              </div>

              {modelsOpen ? (
                <div className="strip-pop is-models" aria-label="Models">
                  {typeof client?.models !== 'function' && (
                    <p className="strip-note">Models are not available.</p>
                  )}
                  {typeof client?.models === 'function' && modelsLoading && (
                    <p className="strip-note">Loading models.</p>
                  )}
                  {typeof client?.models === 'function' && !modelsLoading && modelsError && (
                    <p className="strip-note is-error">{modelsError}</p>
                  )}
                  {typeof client?.models === 'function' &&
                    !modelsLoading &&
                    !modelsError &&
                    modelList.length === 0 && (
                      <p className="strip-note">No models for this harness.</p>
                    )}
                  {modelList.map((choice) => (
                    <button
                      type="button"
                      className={`strip-model-choice${choice.id === model ? ' is-current' : ''}`}
                      key={choice.id}
                      onClick={() => {
                        setModelsOpen(false)
                        setModelError('')
                        setModelConfirm(choice)
                      }}
                    >
                      {choice.label}
                    </button>
                  ))}
                  {!canSetModel && <p className="strip-note">Read only here.</p>}
                </div>
              ) : null}

              {modelConfirm ? (
                <div className="strip-pop is-confirm">
                  <section className="mr-orch-confirm" aria-label="Set the model">
                    <p className="mr-orch-confirm-text">
                      {`Set ${modelConfirm.label} for ${current?.name || 'the orchestrator'}?`}
                    </p>
                    {modelError ? <p className="strip-note is-error">{modelError}</p> : null}
                    <div className="mr-orch-confirm-actions">
                      <button
                        type="button"
                        className="mr-orch-confirm-btn is-start"
                        onClick={saveModel}
                        disabled={modelSaving}
                      >
                        Set
                      </button>
                      <button
                        type="button"
                        className="mr-orch-confirm-btn is-cancel"
                        onClick={() => {
                          setModelConfirm(null)
                          setModelError('')
                        }}
                        disabled={modelSaving}
                      >
                        Cancel
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}

              {effortOpen ? (
                <div className="strip-pop is-effort" aria-label="Effort">
                  {effortChoices.length === 0 ? (
                    <p className="strip-note">No effort levels for this harness.</p>
                  ) : (
                    effortChoices.map((level) => (
                      <button
                        type="button"
                        className={`strip-model-choice${level === shownEffort ? ' is-current' : ''}`}
                        key={level}
                        onClick={() => {
                          setEffortOpen(false)
                          setEffortError('')
                          setEffortConfirm(level)
                        }}
                      >
                        {level}
                      </button>
                    ))
                  )}
                  {!canSetEffort && <p className="strip-note">Read only here.</p>}
                </div>
              ) : null}

              {effortConfirm ? (
                <div className="strip-pop is-confirm">
                  <section className="mr-orch-confirm" aria-label="Set the effort">
                    <p className="mr-orch-confirm-text">
                      {`Set effort ${effortConfirm} for ${current?.name || 'the orchestrator'}?`}
                    </p>
                    {effortError ? <p className="strip-note is-error">{effortError}</p> : null}
                    <div className="mr-orch-confirm-actions">
                      <button
                        type="button"
                        className="mr-orch-confirm-btn is-start"
                        onClick={saveEffort}
                        disabled={effortSaving}
                      >
                        Set
                      </button>
                      <button
                        type="button"
                        className="mr-orch-confirm-btn is-cancel"
                        onClick={() => {
                          setEffortConfirm('')
                          setEffortError('')
                        }}
                        disabled={effortSaving}
                      >
                        Cancel
                      </button>
                    </div>
                  </section>
                </div>
              ) : null}

              {compactOpen ? (
                <div className="strip-pop is-compact">
                  <CompactCard
                    name={current?.name || 'the orchestrator'}
                    id={selected}
                    orchestrator={current}
                    client={client}
                    onAutocompact={onAutocompact}
                    onChange={onOrchestratorChange}
                    onClose={() => setCompactOpen(false)}
                  />
                </div>
              ) : null}
            </form>
          ) : (
            <form className="mr-orch-form" onSubmit={handleSubmit}>
              <label className="mr-orch-label mono" htmlFor={inputId}>
                Message
              </label>
              <textarea
                id={inputId}
                ref={inputRef}
                className="mr-orch-input mono"
                value={draft}
                maxLength={ORCH_MAX_CHARS}
                rows={3}
                spellCheck="false"
                placeholder="What should be built?"
                aria-label="Message to the orchestrator"
                onChange={(event) => setDraft(clampDraft(event.target.value))}
                onKeyDown={handleKeyDown}
              />
              <div className="mr-orch-meta">
                <span className="mr-orch-hint mono">Enter sends. Shift+Enter adds a line.</span>
                {count ? <span className="mr-orch-count mono">{count}</span> : null}
              </div>
              <div className="mr-orch-actions">
                <button type="submit" className="mr-orch-send" disabled={!canSend(draft) || sending || unavailable}>
                  {sending ? 'Sending' : 'Send'}
                </button>
                {working ? (
                  <button
                    type="button"
                    className="mr-orch-stop"
                    onClick={() => setConfirm('stop')}
                    disabled={stopping}
                  >
                    Stop
                  </button>
                ) : null}
              </div>
            </form>
          )}
        </>
      )}

      {unavailable ? <p className="mr-orch-note mono">The orchestrator is not connected.</p> : null}
    </aside>
  )
}
