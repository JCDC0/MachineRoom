import { useContext, useEffect, useId, useRef, useState } from 'react'
import MenuIcon from './MenuIcon.jsx'
import CompactCard from './AgentStrip.jsx'
import ModelRefresh, { useHarnessModels } from './ModelRefresh.jsx'
import { filterModelChoices, groupModelChoices, modelChoiceText } from './modelRefresh.js'
import {
  contextLine,
  effortLabel,
  effortLevels,
  modelChoices,
  orchestratorEffort,
} from './agentStrip.js'
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
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState(null)
  const [readError, setReadError] = useState(null)
  const [modelsOpen, setModelsOpen] = useState(false)
  const [models, setModels] = useState(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [modelQuery, setModelQuery] = useState('')
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
  const staticModels = modelChoices(models, harness)
  const modelRefresh = useHarnessModels({
    client,
    harness,
    open: modelsOpen,
    fallback: staticModels,
    value: model,
  })
  const modelList = modelRefresh.choices
  const visibleModels = filterModelChoices(modelRefresh.choices, modelQuery)
  const modelGroups = groupModelChoices(
    visibleModels,
    visibleModels.some((choice) => choice.id === model) ? model : ''
  )
  const effortChoices = effortLevels(harness)
  const context = contextLine({
    context: { tokens: current?.contextTokens, window: current?.contextWindow },
  })
  const canSetModel = inline && typeof client?.setOrchestratorModel === 'function'
  const canSetEffort = inline && typeof client?.setOrchestratorEffort === 'function'
  const canReadModels =
    typeof client?.models === 'function' || typeof client?.harnessModels === 'function'
  const project = chat.project
  const projectLabel = projectBaseName(project)
  const lines = chatLines(chat)
  const problem = error ?? readError
  const tabs = [
    {
      id: 'orchestrator',
      label: 'Main',
      state: list.find((entry) => entry.id === 'orchestrator')?.state ?? chats.orchestrator?.state ?? 'idle',
    },
    ...subs.map((entry) => ({
      id: entry.id,
      label: entry.name || entry.id,
      state: entry.state ?? chats[entry.id]?.state ?? 'idle',
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
    setModelQuery('')
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
      if (confirm) {
        setConfirm(null)
        return
      }
      onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, confirm, onClose])

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
    setModelQuery('')
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
    setModelQuery('')
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

  function chooseModel(choice) {
    setModelsOpen(false)
    setModelQuery('')
    setModelError('')
    setModelConfirm(choice)
  }

  function renderModelChoice(choice) {
    return (
      <button
        type="button"
        className={`strip-model-choice mr-model-choice${choice.id === model ? ' is-current' : ''}`}
        key={choice.id}
        title={modelChoiceText(choice)}
        onClick={() => chooseModel(choice)}
      >
        <span className="mr-model-choice-name">{choice.label}</span>
        {choice.label !== choice.id ? (
          <span className="mr-model-choice-id mono">{choice.id}</span>
        ) : null}
      </button>
    )
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
    setError(null)
    setReadError(null)
  }

  if (!open) return null

  return (
    <aside
      id={inline ? undefined : 'hud-orchestrator-chat'}
      className={`mr-orch${inline ? ' is-inline' : ''}`}
      aria-label="Orchestrator chat"
    >
      {!inline ? (
        <header className="mr-orch-head">
          <span className="mr-orch-title">Orchestrator</span>
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
              </div>
            )
          })}
        </div>
      ) : null}

      <p className={`mr-orch-status is-${tone} mono`} role="status" aria-live="polite">
        <span className="mr-orch-dot" aria-hidden="true" />
        <span>{status}</span>
      </p>

      {problem ? (
        <div className="mr-orch-error" role="alert">
          <p>{problem}</p>
        </div>
      ) : null}

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
                  <span className="hud-lower-picker-v" aria-hidden="true">
                    <MenuIcon />
                  </span>
                </button>
                <ModelRefresh
                  onRefresh={modelRefresh.refresh}
                  loading={modelRefresh.loading}
                  disabled={!modelRefresh.canRefresh}
                />
                <button
                  type="button"
                  className="hud-strip-effort"
                  aria-expanded={effortOpen}
                  aria-label={`Effort for ${current?.name || 'the orchestrator'}`}
                  onClick={openEffort}
                >
                  <span>Effort:</span>
                  <span className="hud-lower-picker-value mono">{shownEffort}</span>
                  <span className="hud-lower-picker-v" aria-hidden="true">
                    <MenuIcon />
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
              {modelRefresh.error ? (
                <p className="mr-model-error mono" role="alert">
                  {modelRefresh.error}
                </p>
              ) : null}
              <div className="mr-orch-meta">
                {count ? <span className="mr-orch-count mono">{count}</span> : null}
              </div>

              {modelsOpen ? (
                <div className="strip-pop is-models" aria-label="Models">
                  <div className="mr-model-pop-head">
                    <input
                      type="search"
                      className="mr-model-search mono"
                      value={modelQuery}
                      placeholder="Search models..."
                      aria-label="Search models"
                      onChange={(event) => setModelQuery(event.target.value)}
                    />
                  </div>
                  {!canReadModels && <p className="strip-note">Models are not available.</p>}
                  {(modelsLoading || modelRefresh.loading) && (
                    <p className="strip-note">Loading models.</p>
                  )}
                  {!modelsLoading && modelsError ? (
                    <p className="strip-note is-error">{modelsError}</p>
                  ) : null}
                  {!modelsLoading && !modelRefresh.loading && canReadModels && modelList.length === 0 && (
                    <p className="strip-note">No models for this harness.</p>
                  )}
                  {!modelsLoading &&
                    !modelRefresh.loading &&
                    modelList.length > 0 &&
                    visibleModels.length === 0 && <p className="strip-note">No models found</p>}
                  {modelGroups.current ? (
                    <>
                      <p className="mr-model-group mono">Current</p>
                      {renderModelChoice(modelGroups.current)}
                    </>
                  ) : null}
                  {modelGroups.rest.length > 0 ? (
                    <>
                      <p className="mr-model-group mono">Models</p>
                      {modelGroups.rest.map((choice) => renderModelChoice(choice))}
                    </>
                  ) : null}
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

      {unavailable ? <p className="mr-orch-note mono">The orchestrator is not connected.</p> : null}
    </aside>
  )
}
