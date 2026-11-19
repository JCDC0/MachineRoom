import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { defaultMode, laneModesFor } from '../control/modes.js'
import { HARNESSES, harnessByAdapter, harnessByKey } from '../harnesses/index.js'
import { contextLine } from './agentStrip.js'
import Composer, { RecipientChip } from './Composer.jsx'
import { Chip, Menu } from './controls.jsx'
import Markdown from './markdown.jsx'
import { useLogFollow } from './logScroll.js'
import { agentColor, chatAgentColors } from './orchestratorChat.js'
import { runStartLine } from './panels/runs.js'
import {
  foldPrompt,
  foldToolCalls,
  readDue,
  runClock,
  runOptions,
  runOutcome,
  toolText,
} from './laneConversation.js'

const STATUS_REFRESH_MS = 5000
const MAX_MESSAGE_CHARS = 8000
const GENERIC_RESULT_TEXTS = new Set(['The run ended.', 'The run failed.'])
const STATUS_LABELS = {
  queued: 'Queued',
  fetched: 'Read by the runner',
  interrupted: 'Interrupted the run',
}
const RUN_TONES = { running: 'working', finished: 'finished', failed: 'paused', stopped: 'paused' }

export const LaneSentMessagesContext = createContext(null)

function normalizeHarnessKey(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!raw) return ''
  if (Object.hasOwn(harnessByKey, raw)) return raw
  if (raw === 'direct api') return 'machineroom'
  const byName = HARNESSES.find(
    (entry) => entry.name.toLowerCase() === raw || entry.laneName?.toLowerCase() === raw
  )
  return byName ? byName.key : raw
}

function agentHarnessKey(agent) {
  if (!agent || typeof agent !== 'object') return ''
  const direct = normalizeHarnessKey(agent.harness)
  if (direct && Object.hasOwn(harnessByKey, direct)) return direct
  const adapter = typeof agent.adapterType === 'string' ? agent.adapterType.trim() : ''
  if (adapter && Object.hasOwn(harnessByAdapter, adapter)) return harnessByAdapter[adapter].key
  const parser = normalizeHarnessKey(agent.parser)
  if (parser && Object.hasOwn(harnessByKey, parser)) return parser
  return direct || parser
}

function isFinishedPlanRun(run, conversationData) {
  if (!run || !conversationData) return false
  if (run.running === true || conversationData.running === true) return false
  if (run.killed === true) return false
  if (run.exitCode !== 0) return false
  const mode = typeof run.mode === 'string' ? run.mode.trim().toLowerCase() : ''
  return mode === 'plan'
}

function finalReportText(entries) {
  const list = Array.isArray(entries) ? entries : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index]
    if (item?.role !== 'result') continue
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    if (text && !GENERIC_RESULT_TEXTS.has(text)) return text
  }
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index]
    if (item?.role !== 'agent') continue
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    if (text) return text
  }
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index]
    if (item?.role !== 'line') continue
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    if (text && !text.startsWith('{')) return text
  }
  return ''
}

function initialPlanDraft(entries) {
  const report = finalReportText(entries)
  return report ? `Carry out this plan:\n\n${report}` : 'Carry out this plan:'
}

function editModesFor(harness) {
  return laneModesFor(harness).filter((entry) => entry.id !== 'plan')
}

function initialEditMode(harness, savedMode) {
  const modes = editModesFor(harness)
  if (modes.length === 0) return ''
  const saved = typeof savedMode === 'string' ? savedMode.trim().toLowerCase() : ''
  if (saved && saved !== 'choice' && modes.some((entry) => entry.id === saved)) return saved
  const fallback = defaultMode(harness)
  if (fallback && modes.some((entry) => entry.id === fallback)) return fallback
  return modes[0].id
}

function statusLabel(status) {
  return STATUS_LABELS[status] ?? 'Queued'
}

function toolFailed(entry) {
  if (!entry || typeof entry !== 'object') return false
  if (entry.ok === false || entry.failed === true || Boolean(entry.error)) return true
  const status = typeof entry.status === 'string' ? entry.status.trim().toLowerCase() : ''
  return status === 'failed' || status === 'error'
}

function toolRunning(entry) {
  if (!entry || typeof entry !== 'object') return false
  if (entry.running === true) return true
  const status = typeof entry.status === 'string' ? entry.status.trim().toLowerCase() : ''
  return status === 'running' || status === 'working'
}

function toolToneClass(entries, active = false) {
  const list = Array.isArray(entries) ? entries : [entries]
  if (list.some(toolFailed)) return 'is-failed'
  if (active || list.some(toolRunning)) return 'is-working'
  return ''
}

function RunChip({ options, selected, runState, tone, emptyLabel, onChange }) {
  return (
    <span className="ui-chip ui-chip-select">
      <span className="ui-chip-label" aria-hidden="true">Run</span>
      <span className={`ui-chip-value is-${tone}`} aria-hidden="true">
        {selected && <span className="mr-orch-dot" />}
        {selected ? runClock(selected) : emptyLabel}
      </span>
      <span className="ui-chip-chevron" aria-hidden="true" />
      <select aria-label="Run" value={selected} disabled={options.length === 0}
        onChange={(event) => onChange(event.target.value)}>
        {options.length === 0 && <option value="">{emptyLabel}</option>}
        {options.map((run) => (
          <option value={run.startedAt} key={run.startedAt}>
            {`${runClock(run.startedAt)} ${run.startedAt === selected ? runState : runOutcome(run)}`}
          </option>
        ))}
      </select>
    </span>
  )
}

function taskText(run) {
  const briefs = Array.isArray(run?.briefs) ? run.briefs.filter(Boolean) : []
  if (briefs.length > 0) return `Briefs: ${briefs.join(' ')}`
  const task = typeof run?.task === 'string' && run.task.trim() !== '' ? run.task.trim() : ''
  return `Task: ${task || 'this project'}`
}

export default function LaneConversation({
  client = null,
  lane = '',
  laneName = '',
  project = '',
  lanes = [],
  agentColors = null,
  liveRuns = [],
  runs: givenRuns = null,
  initialStartedAt = '',
  requestKey = 0,
  inline = false,
  focusRequest = 0,
  tick = 0,
  onBack = () => {},
  recipientOptions = null,
  recipients = [],
  onRecipientChange = () => {},
  onRecipientSend = null,
  worktreeChoice = null,
}) {
  const [runs, setRuns] = useState(givenRuns)
  const [historyFailed, setHistoryFailed] = useState(false)
  const [historyRetry, setHistoryRetry] = useState(0)
  const [selected, setSelected] = useState(initialStartedAt)
  const [conversationState, setConversation] = useState({ loading: true, data: null, error: '' })
  const [confirmStop, setConfirmStop] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)
  const [openTools, setOpenTools] = useState({})
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const sharedSentMessages = useContext(LaneSentMessagesContext)
  const localSentMessages = useState([])
  const [sentMessages, setSentMessages] = sharedSentMessages ?? localSentMessages
  const [laneConfig, setLaneConfig] = useState({ lane: '', harness: '', mode: '' })
  const [planConfirmOpen, setPlanConfirmOpen] = useState(false)
  const [planDraft, setPlanDraft] = useState('')
  const [planMode, setPlanMode] = useState('')
  const [planStarting, setPlanStarting] = useState(false)
  const [planStartError, setPlanStartError] = useState('')
  const [planStartStatus, setPlanStartStatus] = useState('')
  const wantedRef = useRef(initialStartedAt)
  const mountedRef = useRef(true)
  const lastReadRef = useRef(null)
  const readSequenceRef = useRef(0)
  const readRef = useRef(null)
  const selectionRef = useRef(null)
  const sentRef = useRef(sentMessages)
  sentRef.current = sentMessages
  const refreshStatusesRef = useRef(null)
  const planModeChosenRef = useRef(false)
  const planStartingRef = useRef(false)
  const inputRef = useRef(null)
  const focusAtRef = useRef(0)
  const inputId = useId()
  const planTaskId = useId()
  selectionRef.current = { lane, startedAt: selected }
  const conversation = conversationState.lane === lane && conversationState.startedAt === selected
    ? conversationState
    : { loading: true, data: null, error: '' }
  const historySettled = Boolean(runs) || historyFailed
  const historyLoading = !historySettled && typeof client?.runs === 'function'
  const emptyRunLabel = historyFailed ? 'Run history unavailable' : historyLoading ? 'Reading runs' : 'No runs'
  const options = useMemo(() => runOptions(runs, lane, { liveRuns, lanes }), [runs, lane, liveRuns, lanes])
  const currentRun = options.find((run) => run.startedAt === selected) ?? null
  const colour = agentColor(lane, agentColors ?? chatAgentColors(lanes))
  const running = conversation.data !== null && (
    typeof conversation.data?.running === 'boolean' ? conversation.data.running : currentRun?.running === true
  )
  const otherLiveRun = options.find((run) => run.running && run.startedAt !== selected)
  const hasLiveRun = Boolean(currentRun?.running || otherLiveRun)
  const selectedRunning = currentRun?.running === true ? conversation.data === null || running : running && !hasLiveRun
  const recipientRunning = onRecipientSend && selectedRunning
  const canCompose = selectedRunning || (onRecipientSend && !hasLiveRun && !running)
  const outcome = runOutcome(currentRun, conversation.data)
  const runState = selectedRunning ? 'running' : outcome
  const tone = RUN_TONES[runState] || 'idle'
  const status = selectedRunning ? 'Working' : outcome ? outcome[0].toUpperCase() + outcome.slice(1) : 'Idle'
  const context = [
    canCompose && selected && `Run ${runClock(selected)}`,
    typeof currentRun?.contextTokens === 'number' && contextLine({
      context: { tokens: currentRun.contextTokens, window: currentRun.contextWindow },
    }).replace(/^Context size (?=\d)/, 'Context '),
  ].filter(Boolean).join(' · ')
  const entries = Array.isArray(conversation.data?.entries) ? conversation.data.entries : []
  const promptEntry = entries.find((entry) => entry.role === 'prompt') ?? null
  const prompt = foldPrompt(promptEntry?.text ?? '')
  const rows = foldToolCalls(entries.filter((entry) => entry.role !== 'prompt'
    && !(outcome && entry.role === 'result' && GENERIC_RESULT_TEXTS.has(entry.text))))
  const named = typeof laneName === 'string' ? laneName.trim() : ''
  const laneKey = typeof lane === 'string' ? lane.trim() : ''
  const matchedLane = lanes.find((entry) => entry?.key === lane)?.name
  const matchedName = typeof matchedLane === 'string' ? matchedLane.trim() : ''
  const label = (named && named !== laneKey ? named : '') || matchedName || named || laneKey || 'Lane'
  const projectLabel = String(project || 'PROJECT').toUpperCase()
  const breadcrumb = `${projectLabel} / ${String(label).toUpperCase()}`
  const loaded = conversation.data !== null
  const isFinishedPlan = isFinishedPlanRun(currentRun, conversation.data)
  const activeLaneConfig = laneConfig.lane === lane ? laneConfig : null
  const laneAgent = (Array.isArray(lanes) ? lanes : []).find((entry) => entry?.key === lane) ?? null
  const planHarness =
    normalizeHarnessKey(conversation.data?.harness) ||
    normalizeHarnessKey(activeLaneConfig?.harness) ||
    agentHarnessKey(laneAgent) ||
    normalizeHarnessKey(currentRun?.harness)
  const savedLaneMode =
    activeLaneConfig?.mode || (typeof laneAgent?.mode === 'string' ? laneAgent.mode.trim() : '')
  const editModes = useMemo(() => editModesFor(planHarness), [planHarness])
  const trimmedDraft = draft.trim()
  const canSend = trimmedDraft.length > 0 && trimmedDraft.length <= MAX_MESSAGE_CHARS
  const visibleSent = sentMessages.filter((item) => item.lane === lane && item.startedAt === selected)
  const follow = useLogFollow(running, entries.length + visibleSent.length)

  useEffect(() => {
    if (focusRequest === focusAtRef.current) return
    focusAtRef.current = focusRequest
    inputRef.current?.focus({ preventScroll: true })
  }, [focusRequest])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    setRuns(givenRuns)
  }, [client, givenRuns, lane])

  useEffect(() => {
    setHistoryFailed(false)
    if (givenRuns || !client || typeof client.runs !== 'function') return undefined
    let active = true
    let readSequence = 0
    let appliedSequence = 0
    async function readRuns(fromNotice = false) {
      const sequence = ++readSequence
      try {
        const answer = await client.runs({ lane })
        if (!active || sequence < appliedSequence) return
        appliedSequence = sequence
        const nextRuns = answer && typeof answer === 'object' ? answer : null
        setRuns(nextRuns)
        setHistoryFailed(false)
        if (fromNotice && nextRuns) {
          const current = selectionRef.current
          const stillLive =
            Array.isArray(nextRuns.running) &&
            nextRuns.running.some((item) => item?.lane === current.lane && item?.startedAt === current.startedAt)
          const finished =
            Array.isArray(nextRuns.recent) &&
            nextRuns.recent.some((item) => item?.lane === current.lane && item?.startedAt === current.startedAt)
          if (!stillLive && finished) readRef.current?.(current.startedAt, { force: true })
        }
      } catch {
        if (!active || sequence < appliedSequence) return
        appliedSequence = sequence
        wantedRef.current = ''
        setHistoryFailed(true)
      }
    }
    readRuns(false)
    const unsubscribe =
      typeof client.subscribe === 'function'
        ? client.subscribe((notice) => {
            if (notice?.topic === 'runs') readRuns(true)
          })
        : null
    return () => {
      active = false
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [client, givenRuns, historyRetry, lane])

  useEffect(() => {
    if (!requestKey) return
    wantedRef.current = initialStartedAt
    if (initialStartedAt) setSelected(initialStartedAt)
  }, [requestKey])

  useEffect(() => {
    const wanted = wantedRef.current
    if (wanted) {
      if (options.some((run) => run.startedAt === wanted)) {
        wantedRef.current = ''
        if (selected !== wanted) setSelected(wanted)
        return
      }
      if (!historySettled) return
      wantedRef.current = ''
    }
    if (options.length === 0) {
      if (historySettled && selected) setSelected('')
      return
    }
    if (!selected || !options.some((run) => run.startedAt === selected)) {
      setSelected(options[0].startedAt)
    }
  }, [options, selected, historySettled])

  useEffect(() => {
    setDraft('')
  }, [lane])

  useEffect(() => {
    if (!lane || !client || typeof client.lanes !== 'function') {
      setLaneConfig({ lane: '', harness: '', mode: '' })
      return undefined
    }
    let active = true
    async function readLanes() {
      try {
        const answer = await client.lanes()
        if (!active) return
        const list = Array.isArray(answer?.lanes) ? answer.lanes : []
        const found = list.find((entry) => entry?.key === lane) ?? null
        setLaneConfig({
          lane,
          harness: typeof found?.harness === 'string' ? found.harness.trim() : '',
          mode: typeof found?.mode === 'string' ? found.mode.trim() : '',
        })
      } catch {
        if (active) setLaneConfig({ lane: '', harness: '', mode: '' })
      }
    }
    readLanes()
    const unsubscribe =
      typeof client.subscribe === 'function'
        ? client.subscribe((notice) => {
            if (notice?.topic === 'agents' || notice?.topic === 'family') readLanes()
          })
        : null
    return () => {
      active = false
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [client, lane])

  useEffect(() => {
    setConfirmStop(false)
    setStopError('')
    setStopping(false)
    setShowPrompt(false)
    setOpenTools({})
    setSendError('')
    setSending(false)
    planModeChosenRef.current = false
    planStartingRef.current = false
    setPlanConfirmOpen(false)
    setPlanDraft('')
    setPlanMode('')
    setPlanStarting(false)
    setPlanStartError('')
    setPlanStartStatus('')
  }, [lane, selected])

  useEffect(() => {
    if (!planConfirmOpen || planModeChosenRef.current) return
    setPlanMode(initialEditMode(planHarness, savedLaneMode))
  }, [planConfirmOpen, planHarness, savedLaneMode])

  async function readConversation(startedAt, { force = false } = {}) {
    if (!startedAt || !client || typeof client.runConversation !== 'function') return
    const isSelected = () => mountedRef.current && selectionRef.current.lane === lane && selectionRef.current.startedAt === startedAt
    if (!isSelected()) return
    const at = Date.now()
    if (!force && !readDue(lastReadRef.current, at)) return
    const sequence = ++readSequenceRef.current
    lastReadRef.current = at
    setConversation((current) => current.lane === lane && current.startedAt === startedAt
      ? { ...current, loading: current.data === null }
      : { lane, startedAt, loading: true, data: null, error: '' })
    try {
      const data = await client.runConversation({ lane, startedAt })
      if (!isSelected() || sequence !== readSequenceRef.current) return
      setConversation({ lane, startedAt, loading: false, data: data && typeof data === 'object' ? data : null, error: '' })
    } catch (failure) {
      if (!isSelected() || sequence !== readSequenceRef.current) return
      setConversation({
        lane,
        startedAt,
        loading: false,
        data: null,
        error: failure?.message || 'Could not read the conversation.',
      })
    }
  }
  readRef.current = readConversation

  useEffect(() => {
    lastReadRef.current = null
    setConversation({ lane, startedAt: selected, loading: true, data: null, error: '' })
    readRef.current?.(selected, { force: true })
    return () => { readSequenceRef.current += 1 }
  }, [client, lane, selected])

  useEffect(() => {
    if (!selected || conversation.data?.running !== true) return
    readRef.current?.(selected)
  }, [tick, selected, conversation.data?.running])

  async function refreshStatuses(targetLane, targetStartedAt) {
    if (!client || typeof client.laneMessageStatus !== 'function') return
    const items = sentRef.current.filter(
      (item) => item.lane === targetLane && item.startedAt === targetStartedAt && !item.missing
    )
    if (items.length === 0) return
    await Promise.all(
      items.map(async (item) => {
        try {
          const answer = await client.laneMessageStatus(item.id)
          if (!mountedRef.current || !answer || typeof answer.status !== 'string') return
          setSentMessages((current) =>
            current.map((entry) => (entry.id === item.id ? { ...entry, status: answer.status } : entry))
          )
        } catch (failure) {
          if (!mountedRef.current) return
          if (/not found/i.test(String(failure?.message ?? ''))) {
            setSentMessages((current) =>
              current.map((entry) => (entry.id === item.id ? { ...entry, missing: true } : entry))
            )
          }
        }
      })
    )
  }
  refreshStatusesRef.current = refreshStatuses

  useEffect(() => {
    if (!selected) return undefined
    if (running) {
      const timer = setInterval(() => {
        refreshStatusesRef.current?.(lane, selected)
      }, STATUS_REFRESH_MS)
      return () => clearInterval(timer)
    }
    if (loaded) refreshStatusesRef.current?.(lane, selected)
    return undefined
  }, [client, lane, selected, running, loaded])

  async function sendMessage(interrupt) {
    const sendToRunning = selectedRunning
    if (!canSend || sending || (!sendToRunning && hasLiveRun) || (sendToRunning ? !client || typeof client.sendLaneMessage !== 'function' : !onRecipientSend)) return
    setSending(true)
    setSendError('')
    try {
      const answer = sendToRunning ? await client.sendLaneMessage({ lane, startedAt: selected, text: trimmedDraft, interrupt: Boolean(interrupt) }) : await onRecipientSend(trimmedDraft)
      if (answer?.ok === false) throw new Error(answer.error)
      if (!mountedRef.current && !sharedSentMessages) return
      if (mountedRef.current) setDraft('')
      const id = typeof answer?.id === 'string' ? answer.id : ''
      if (id) {
        const entry = { id, lane, startedAt: selected, text: trimmedDraft, status: 'queued', missing: false }
        setSentMessages((current) => [...current, entry])
        if (typeof client.laneMessageStatus === 'function') {
          try {
            const statusAnswer = await client.laneMessageStatus(id)
            if ((mountedRef.current || sharedSentMessages) && typeof statusAnswer?.status === 'string') {
              setSentMessages((current) =>
                current.map((item) => (item.id === id ? { ...item, status: statusAnswer.status } : item))
              )
            }
          } catch {}
        }
      }
    } catch (failure) {
      if (!mountedRef.current) return
      setSendError(failure?.message || 'Could not send the message.')
    } finally {
      if (mountedRef.current) setSending(false)
    }
  }

  async function stopRun() {
    if (!client || typeof client.stopRun !== 'function' || !selected) return
    setStopping(true)
    setStopError('')
    try {
      await client.stopRun({ lane, startedAt: selected, confirmed: true })
      if (!mountedRef.current) return
      setConfirmStop(false)
      lastReadRef.current = null
      await readConversation(selected, { force: true })
    } catch (failure) {
      if (!mountedRef.current) return
      setStopError(failure?.message || 'Could not stop the run.')
    } finally {
      if (mountedRef.current) setStopping(false)
    }
  }

  function openPlanHandoff() {
    if (!isFinishedPlan) return
    planModeChosenRef.current = false
    setPlanDraft(initialPlanDraft(entries))
    setPlanMode(initialEditMode(planHarness, savedLaneMode))
    setPlanStartError('')
    setPlanStartStatus('')
    setPlanConfirmOpen(true)
  }

  function cancelPlanHandoff() {
    if (planStartingRef.current) return
    planModeChosenRef.current = false
    setPlanConfirmOpen(false)
    setPlanStartError('')
  }

  async function startPlanHandoff() {
    if (planStartingRef.current || !isFinishedPlan) return
    if (planDraft.trim() === '') return
    if (!client || typeof client.startRun !== 'function') {
      setPlanStartError('Could not start run.')
      return
    }
    planStartingRef.current = true
    setPlanStarting(true)
    setPlanStartError('')
    try {
      const run = planMode ? { tasks: [planDraft], mode: planMode } : { tasks: [planDraft] }
      const answer = await client.startRun(lane, run)
      if (!mountedRef.current) return
      setPlanConfirmOpen(false)
      setPlanStartStatus(runStartLine(answer))
    } catch (failure) {
      if (!mountedRef.current) return
      setPlanStartError(failure?.message || 'Could not start run.')
    } finally {
      planStartingRef.current = false
      if (mountedRef.current) setPlanStarting(false)
    }
  }

  return (
    <aside className={`mr-orch mr-lane-conv${inline ? ' is-inline' : ''}`} aria-label={`${label} conversation`}>
      <header className="mr-lane-conv-head">
        <p className="mr-lane-conv-crumb mono" title={breadcrumb}>
          {projectLabel} /{' '}
          <span className="mr-agent-dot" aria-hidden="true" style={{ background: colour }} />
          {String(label).toUpperCase()}
        </p>
        <Chip label="Back" onClick={onBack} />
      </header>
      {isFinishedPlan && (
        <div className="mr-lane-conv-tools">
          <Chip label="Edit from this plan" disabled={planConfirmOpen} onClick={openPlanHandoff} />
        </div>
      )}

      {historyFailed ? (
        <div className="mr-lane-conv-tools">
          <p className="mr-orch-error mono" role="alert">Could not read run history.</p>
          <button type="button" className="brief-run-btn" onClick={() => setHistoryRetry((attempt) => attempt + 1)}>
            Retry
          </button>
        </div>
      ) : null}

      {confirmStop ? (
        <div className="brief-confirm-card" role="region" aria-label={`Confirm stop ${label}`}>
          <div className="brief-confirm-meta mono">
            <span className="brief-confirm-lane">Lane: {label}</span>
            <span className="brief-confirm-model">{taskText(currentRun)}</span>
            <span className="brief-confirm-id">Started: {selected}</span>
          </div>
          <div className="brief-confirm-warning">This stops the running lane and tells its orchestrator.</div>
          <div className="brief-confirm-actions">
            <button type="button" className="brief-confirm-btn" disabled={stopping} onClick={stopRun}>
              {stopping ? 'Stopping' : 'Confirm'}
            </button>
            <button
              type="button"
              className="brief-cancel-btn"
              disabled={stopping}
              onClick={() => {
                setConfirmStop(false)
                setStopError('')
              }}
            >
              Cancel
            </button>
          </div>
          {stopError ? (
            <div className="brief-confirm-error mono" role="alert">
              {stopError}
            </div>
          ) : null}
        </div>
      ) : null}

      {isFinishedPlan && planConfirmOpen ? (
        <div className="brief-confirm-card" role="region" aria-label="Confirm edit from this plan">
          <div className="brief-confirm-meta mono">
            <span className="brief-confirm-lane">Lane: {label}</span>
          </div>
          <label className="mr-orch-label mono" htmlFor={planTaskId}>
            Task
          </label>
          <textarea
            id={planTaskId}
            className="brief-prompt-box mono"
            rows={6}
            spellCheck="false"
            aria-label="Task"
            value={planDraft}
            onChange={(event) => setPlanDraft(event.target.value)}
          />
          {editModes.length > 0 && (
            <Chip label="Mode" value={planMode} options={editModes.map(({ id, label }) => ({ value: id, label }))}
              onChange={(nextMode) => {
                planModeChosenRef.current = true
                setPlanMode(nextMode)
              }} />
          )}
          <div className="brief-confirm-actions">
            <button
              type="button"
              className="brief-confirm-btn"
              disabled={planStarting || planDraft.trim() === ''}
              onClick={startPlanHandoff}
            >
              {planStarting ? 'Starting' : 'Start'}
            </button>
            <button
              type="button"
              className="brief-cancel-btn"
              disabled={planStarting}
              onClick={cancelPlanHandoff}
            >
              Cancel
            </button>
          </div>
          {planStartError ? (
            <div className="brief-confirm-error mono" role="alert">
              {planStartError}
            </div>
          ) : null}
        </div>
      ) : null}

      {isFinishedPlan && planStartStatus ? (
        <div className="brief-copy-status mono is-ok" role="status">
          {planStartStatus}
        </div>
      ) : null}

      {conversation.error ? <p className="mr-orch-error mono">{conversation.error}</p> : null}
      {conversation.loading && (selected || !historySettled) ? <p className="mr-orch-empty">Reading the conversation.</p> : null}

      <div className="mr-orch-log mr-lane-conv-log" ref={follow.ref} onScroll={follow.onScroll}>
        {(!conversation.loading || (runs && !selected)) && !conversation.error && entries.length === 0 && (!historyFailed || options.length > 0) ? (
          <p className="mr-orch-empty">{options.length === 0 ? 'No runs yet.' : 'Nothing has been said yet.'}</p>
        ) : null}
        {promptEntry ? (
          <section className="mr-lane-conv-prompt" aria-label="Prompt">
            <p className={`mr-lane-conv-prompt-text${prompt.folded && !showPrompt ? ' is-folded' : ''}`}>
              {showPrompt ? promptEntry.text : prompt.text}
            </p>
            {prompt.folded ? (
              <Chip
                className="mr-lane-conv-more"
                label={showPrompt ? 'Show less' : 'Show all'}
                open={showPrompt}
                onClick={() => setShowPrompt((value) => !value)}
              />
            ) : null}
          </section>
        ) : null}
        {rows.map((row, index) => {
          if (row.kind === 'tools') {
            const activeRow = selectedRunning && index === rows.length - 1
            if (row.count === 1) {
              const toneClass = toolToneClass(row.entries[0], activeRow)
              return (
                <p className={`ui-chip mr-lane-conv-tool mono${toneClass ? ` ${toneClass}` : ''}`} key={`tool-${index}`}>
                  {toolText(row.entries[0])}
                </p>
              )
            }
            const open = openTools[index] === true
            const groupTone = toolToneClass(row.entries, activeRow)
            return (
              <div className="mr-lane-conv-tool-group" key={`tools-${index}`}>
                <Chip
                  label={`${row.count} tool calls`}
                  className={`mr-lane-conv-tool-fold${groupTone ? ` ${groupTone}` : ''}`}
                  open={open}
                  onClick={() => setOpenTools((current) => ({ ...current, [index]: !open }))}
                />
                {open
                  ? row.entries.map((entry, at) => {
                      const entryTone = toolToneClass(entry, activeRow && at === row.entries.length - 1)
                      return (
                        <p className={`ui-chip mr-lane-conv-tool mono${entryTone ? ` ${entryTone}` : ''}`} key={`tool-${index}-${at}`}>
                          {toolText(entry)}
                        </p>
                      )
                    })
                  : null}
              </div>
            )
          }
          const entry = row.entry
          if (entry.role === 'agent' || entry.role === 'result') {
            return (
              <div className="mr-orch-line is-orchestrator mr-orch-blocks" key={`entry-${index}`}>
                <Markdown text={entry.text} />
              </div>
            )
          }
          return (
            <p className="mr-lane-conv-line mono" key={`entry-${index}`}>
              {entry.text}
            </p>
          )
        })}
        {visibleSent.length > 0 && (
          <div className="mr-lane-conv-sent" role="region" aria-label="Sent messages">
            {visibleSent.map((item) => (
              <div className="mr-orch-line is-owner" key={item.id}>
                <p className="mr-orch-text">{item.text}</p>
                <p className="mr-lane-conv-line mono">{statusLabel(item.status)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <Composer
        input={canCompose ? {
          ref: inputRef,
          id: inputId,
          value: draft,
          maxLength: MAX_MESSAGE_CHARS,
          placeholder: onRecipientSend ? (recipientRunning ? `Message ${label}` : `Start ${label} with a message`) : 'Message this running lane',
          'aria-label': `Message ${label}`,
          onChange: (event) => setDraft(event.target.value),
        } : null}
        onSubmit={(event) => {
          event.preventDefault()
          sendMessage(false)
        }}
        sending={sending}
        sendDisabled={!canSend || sending}
        status={status}
        tone={tone}
        context={context}
        stop={running ? { onClick: () => setConfirmStop(true), disabled: stopping } : null}
        toolbar={
          <>
            {recipientOptions && <RecipientChip value={lane} onChange={onRecipientChange} recipients={recipients} lanes={recipientOptions} />}
            <RunChip options={options} selected={selected} runState={runState} tone={tone} emptyLabel={emptyRunLabel}
              onChange={(startedAt) => {
                wantedRef.current = ''
                setSelected(startedAt)
              }} />
            {canCompose && !selectedRunning && onRecipientSend && worktreeChoice}
            {selectedRunning && (
              <Menu label="Lane message options" items={[
                { label: 'Send and interrupt', disabled: !canSend || sending, onSelect: () => sendMessage(true) },
              ]} />
            )}
          </>
        }
      >
        {!canCompose && otherLiveRun && (
          <p className="mr-composer-hint">
            {`${label} is working on run ${runClock(otherLiveRun.startedAt)}. Pick that run to message it.`}
          </p>
        )}
        {sendError && <p className="mr-orch-error mono" role="alert">{sendError}</p>}
      </Composer>
    </aside>
  )
}
