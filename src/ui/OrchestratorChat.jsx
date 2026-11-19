import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Composer, { RecipientChip } from './Composer.jsx'
import { Chip, Menu, Switch } from './controls.jsx'
import Markdown from './markdown.jsx'
import { roomNoticeSummary } from './roomNotice.js'
import LaneConversation from './LaneConversation.jsx'
import CompactCard from './AgentStrip.jsx'
import { useDialogFocus } from './dialogFocus.js'
import { useHarnessModels } from './ModelRefresh.jsx'
import ModelPicker from './ModelPicker.jsx'
import {
  contextLine,
  effortLabel,
  modelChoices,
  orchestratorEffort,
} from './agentStrip.js'
import {
  ORCH_MAX_CHARS,
  ORCH_MAX_LINES,
  ORCH_REFRESH_MS,
  ORCH_STOP_CONFIRM,
  TEAM_TAB,
  agentColor,
  approvalInputText,
  approvalTitle,
  canSend,
  charCount,
  chatAgentColors,
  chatLines,
  clampDraft,
  copyChatText,
  effortMenuLevels,
  errorText,
  isSendKey,
  modeClass,
  modeLabel,
  nearChatBottom,
  needsStartConfirm,
  normalizeApprovals,
  normalizeChat,
  normalizeModes,
  projectBaseName,
  retryTarget,
  runnableLanes,
  sendChatMessage,
  startConfirmText,
  startModeText,
  statusTone,
  teamLines,
  useChatLanes,
  visibleChatText,
  workRows,
  workStepText,
  workText,
} from './orchestratorChat.js'
import { OPEN_CHAT_EVENT } from './transportOrchestrators.js'
import {
  commandKeyAction,
  commandPickText,
  commandQuery,
  filterCommands,
  parseRoomCommand,
} from './slashCommands.js'

const EMPTY = []

function initialChatState(initialChat) {
  return normalizeChat(initialChat)
}

function initialList(value) {
  if (!Array.isArray(value)) return []
  return value.filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id)
}

export function pruneOrchestratorRecord(record, ids) {
  const keep = new Set(Array.isArray(ids) ? ids : [])
  keep.add('orchestrator')
  let dropped = false
  const next = {}
  for (const [id, value] of Object.entries(record ?? {})) {
    if (keep.has(id)) next[id] = value
    else dropped = true
  }
  return dropped ? next : record
}

export default function OrchestratorChat({
  client = null,
  open = true,
  onClose,
  inline = false,
  focusRequest = 0,
  orchestrators = null,
  lanes = null,
  agentColors: givenColors = null,
  onAutocompact = () => ({ ok: true }),
  onOrchestratorChange = () => {},
  selected: selectedTab = undefined,
  onSelect = null,
  selectedLane,
  onSelectLane,
  initialChat = null,
  initialDraft = '',
  initialConfirm = null,
  initialOrchestrators = null,
  initialSelected = 'orchestrator',
  initialRecipient = '',
  liveRuns = [],
  tick = 0,
}) {
  const [chats, setChats] = useState(() => ({ orchestrator: initialChatState(initialChat) }))
  const [list, setList] = useState(() => initialList(orchestrators ?? initialOrchestrators))
  const ownLanes = useChatLanes(lanes === null && open ? client : null)
  const suppliedLanes = lanes ?? ownLanes
  const lanesData = suppliedLanes ?? EMPTY
  const colors = useMemo(() => givenColors ?? chatAgentColors(lanesData), [givenColors, lanesData])
  const [ownLane, setOwnLane] = useState(initialRecipient === 'orchestrator' ? '' : initialRecipient)
  const laneChoice = selectedLane ?? ownLane
  const setLaneChoice = onSelectLane ?? setOwnLane
  const [separateWorktree, setSeparateWorktree] = useState(true)
  const [openAgentAll, setOpenAgentAll] = useState({})
  const [openRoomDetails, setOpenRoomDetails] = useState({})
  const [showAgentMessages, setShowAgentMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('machineroom:show-agent-messages')
      if (saved !== null) return saved === 'true'
    } catch {}
    return true
  })
  const [ownSelected, setOwnSelected] = useState(() =>
    typeof initialSelected === 'string' && initialSelected ? initialSelected : 'orchestrator'
  )
  const controlled = typeof selectedTab === 'string' && selectedTab !== ''
  const selected = controlled ? selectedTab : ownSelected
  const selectionRef = useRef({ id: selected, version: 0 })
  if (selectionRef.current.id !== selected) selectionRef.current = { id: selected, version: selectionRef.current.version + 1 }
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
  const [stopResult, setStopResult] = useState(null)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState(null)
  const [copiedId, setCopiedId] = useState('')
  const [atBottom, setAtBottom] = useState(true)
  const [openWork, setOpenWork] = useState({})
  const [readError, setReadError] = useState(null)
  const [listError, setListError] = useState(null)
  const [teamFailed, setTeamFailed] = useState([])
  const [models, setModels] = useState(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [modelSaving, setModelSaving] = useState(false)
  const [modelError, setModelError] = useState('')
  const [modelSaved, setModelSaved] = useState('')
  const [effortOpen, setEffortOpen] = useState(false)
  const [harnessRows, setHarnessRows] = useState([])
  const [effortSaving, setEffortSaving] = useState(false)
  const [effortError, setEffortError] = useState('')
  const [effortSaved, setEffortSaved] = useState('')
  const [modeOpen, setModeOpen] = useState(false)
  const [modeConfirm, setModeConfirm] = useState(null)
  const [modeSaving, setModeSaving] = useState(false)
  const [modeError, setModeError] = useState('')
  const [modeSaved, setModeSaved] = useState('')
  const [answering, setAnswering] = useState({})
  const [approvalError, setApprovalError] = useState({})
  const [compactOpen, setCompactOpen] = useState(false)
  const [compactKeep, setCompactKeep] = useState('')
  const [compacting, setCompacting] = useState(false)
  const [commands, setCommands] = useState([])
  const [commandError, setCommandError] = useState('')
  const [slashOpen, setSlashOpen] = useState(() => clampDraft(initialDraft).startsWith('/'))
  const [slashIndex, setSlashIndex] = useState(0)

  const inputId = useId()
  const logRef = useRef(null)
  const inputRef = useRef(null)
  const readChatRef = useRef(null)
  const readListRef = useRef(null)
  const readCommandsRef = useRef(null)
  const chatTicketsRef = useRef({})
  const teamTicketRef = useRef(0)
  const focusAtRef = useRef(0)
  const confirmRef = useRef(null)
  const modeConfirmRef = useRef(null)
  const prevSelectedRef = useRef(selected)
  const modeSavedTimer = useRef(null)
  const copyTimer = useRef(null)
  const compactRef = useRef(null)

  useDialogFocus(Boolean(confirm), { containerRef: confirmRef })
  useDialogFocus(Boolean(modeConfirm), { containerRef: modeConfirmRef })
  useDialogFocus(compactOpen, { containerRef: compactRef })

  const subs = list.filter((entry) => entry.id !== 'orchestrator')
  const teamSelected = selected === TEAM_TAB
  const current = list.find((entry) => entry.id === selected) ?? null
  const chat = chats[selected] ?? normalizeChat(null)
  const loaded = Boolean(loadedIds[selected])
  const state = loaded ? chat.state : current?.state ?? chat.state
  const status = teamSelected ? "Every orchestrator's messages" : state === 'working' ? 'Working' : state === 'paused' ? 'Paused' : 'Waiting for you'
  const tone = teamSelected || state === 'idle' ? 'waiting' : statusTone(state)
  const count = charCount(draft)
  const slashQuery = slashOpen ? commandQuery(draft) : null
  const slashItems = slashQuery === null ? [] : filterCommands(commands, slashQuery)
  const slashVisible = slashQuery !== null
  const slashNote = commandError
    ? commandError
    : commands.length === 0
      ? 'Reading commands.'
      : slashItems.length === 0
        ? 'No commands found.'
        : ''
  const working = state === 'working'
  const model = teamSelected ? '' : chat.model || (typeof current?.model === 'string' ? current.model : '')
  const harness = typeof current?.harness === 'string' ? current.harness : ''
  const shownEffort = effortSaved || effortLabel(orchestratorEffort(list, selected), harness)
  const mode = teamSelected ? '' : chat.mode || (typeof current?.mode === 'string' ? current.mode : '')
  const modeList = teamSelected
    ? []
    : chat.modes.length > 0
      ? chat.modes
      : normalizeModes(current?.modes)
  const shownMode = modeLabel(modeList, mode) || 'not reported'
  const canSetMode =
    modeList.length >= 2 && typeof client?.setOrchestratorMode === 'function'
  const frameClass = modeClass(mode)
  const approvals = teamSelected
    ? []
    : loaded
      ? chat.approvals
      : normalizeApprovals(current?.approvals)
  const canAnswerApprovals = typeof client?.answerApproval === 'function'
  const staticModels = modelChoices(models, harness)
  const modelRefresh = useHarnessModels({
    client,
    harness,
    open: open && !teamSelected,
    fallback: staticModels,
    value: modelSaved || model,
  })
  const modelList = modelRefresh.choices
  const effortChoices = effortMenuLevels(harness, harnessRows.length > 0 ? harnessRows : current?.harnesses)
  const context = contextLine({
    context: { tokens: current?.contextTokens, window: current?.contextWindow },
  }).replace(/^Context size (?=\d)/, 'Context ')
  const canSetEffort = typeof client?.setOrchestratorEffort === 'function'
  const project = teamSelected ? chats.orchestrator?.project ?? '' : chat.project
  const projectLabel = projectBaseName(project)
  const availableLanes = runnableLanes(lanesData)
  const laneRecipient = availableLanes.find((lane) => lane.key === laneChoice)
  const toRecipient = selected
  const lines = teamSelected
    ? []
    : chatLines(chat, ORCH_MAX_LINES, {
        id: selected,
        showAgentMessages,
        lanes: lanesData,
      })

  function toggleAgentMessages(val) {
    const next = typeof val === 'boolean' ? val : !showAgentMessages
    setShowAgentMessages(next)
    try {
      localStorage.setItem('machineroom:show-agent-messages', String(next))
    } catch {}
  }
  const workKey = lines
    .filter((line) => line.work)
    .map((line) => `${line.id}|${line.work.state}|${line.work.steps.length}|${line.work.seconds}`)
    .join(';')
  const teamKey = subs.map((entry) => entry.id).join('\n')
  const teamEntries = [
    { id: 'orchestrator', name: 'Main', chat: chats.orchestrator },
    ...subs.map((entry) => ({
      id: entry.id,
      name: entry.name || entry.id,
      chat: chats[entry.id],
    })),
  ]
  const teamRows = teamSelected ? teamLines(teamEntries) : []
  const teamReady = Boolean(loadedIds.orchestrator) && subs.every((entry) => loadedIds[entry.id])
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
    { id: TEAM_TAB, label: 'Team' },
  ]
  const startText =
    selected === 'orchestrator'
      ? startConfirmText(project, harness, mode, modeList)
      : `${current?.name || selected} runs on this project${startModeText(mode, modeList) || '.'} It plans for its lanes, works in its scope and reports to the main orchestrator.`

  useEffect(() => {
    if (!open) return undefined
    if (!client || typeof client.orchestrator !== 'function') {
      setUnavailable(true)
      return undefined
    }
    setUnavailable(false)
    if (Array.isArray(orchestrators)) {
      setListError(null)
      return undefined
    }
    let stopped = false

    async function readList() {
      if (typeof client.orchestrators !== 'function') return
      try {
        const answer = await client.orchestrators()
        const items = Array.isArray(answer) ? answer : Array.isArray(answer?.orchestrators) ? answer.orchestrators : []
        if (stopped) return
        setListError(null)
        if (items.length === 0) return
        setList(items.filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id))
      } catch (failure) {
        if (stopped) return
        setListError(errorText(failure, 'Could not read the orchestrator list.'))
      }
    }

    readListRef.current = readList
    readList()
    const timer = setInterval(readList, ORCH_REFRESH_MS)

    return () => {
      stopped = true
      clearInterval(timer)
      readListRef.current = null
    }
  }, [open, client, orchestrators])

  useEffect(() => {
    if (!Array.isArray(orchestrators)) return
    setList(initialList(orchestrators))
  }, [orchestrators])

  useEffect(() => {
    if (suppliedLanes !== null && laneChoice && !laneRecipient) setLaneChoice('')
  }, [suppliedLanes, laneChoice, laneRecipient, setLaneChoice])

  useEffect(() => {
    if (!open || typeof client?.harnesses !== 'function') return undefined
    let stopped = false
    client
      .harnesses()
      .then((answer) => {
        if (stopped) return
        const items = Array.isArray(answer) ? answer : Array.isArray(answer?.harnesses) ? answer.harnesses : []
        if (items.length > 0) setHarnessRows(items)
      })
      .catch(() => {})
    return () => {
      stopped = true
    }
  }, [open, client, effortOpen])

  useEffect(() => {
    const ids = list.map((entry) => entry.id)
    setChats((current) => pruneOrchestratorRecord(current, ids))
    setLoadedIds((current) => pruneOrchestratorRecord(current, ids))
    setStartedIds((current) => pruneOrchestratorRecord(current, ids))
    chatTicketsRef.current = pruneOrchestratorRecord(chatTicketsRef.current, ids)
  }, [list])

  useEffect(() => {
    if (!open || teamSelected) return undefined
    if (typeof client?.orchestratorCommands !== 'function') {
      setCommands([])
      setCommandError('Commands are not available here.')
      return undefined
    }
    let stopped = false

    async function readCommands() {
      try {
        const answer = await client.orchestratorCommands(selected === 'orchestrator' ? undefined : selected)
        if (stopped) return
        setCommands(Array.isArray(answer) ? answer : [])
        setCommandError('')
      } catch (failure) {
        if (stopped) return
        setCommands([])
        setCommandError(errorText(failure, 'Commands are not available.'))
      }
    }

    readCommandsRef.current = readCommands
    readCommands()

    return () => {
      stopped = true
      readCommandsRef.current = null
    }
  }, [open, client, selected, harness, teamSelected])

  useEffect(() => {
    if (!open || selected === TEAM_TAB) return undefined
    if (!client || typeof client.orchestrator !== 'function') {
      setUnavailable(true)
      return undefined
    }
    setUnavailable(false)
    let stopped = false
    const id = selected

    async function readChat() {
      const ticket = (chatTicketsRef.current[id] ?? 0) + 1
      chatTicketsRef.current[id] = ticket
      const newest = () => chatTicketsRef.current[id] === ticket
      try {
        const answer = await client.orchestrator(id === 'orchestrator' ? undefined : id)
        if (stopped || !newest()) return
        const next = normalizeChat(answer)
        setChats((currentChats) => ({ ...currentChats, [id]: next }))
        setLoadedIds((currentLoaded) => (currentLoaded[id] ? currentLoaded : { ...currentLoaded, [id]: true }))
        setReadError(null)
        setList((currentList) =>
          currentList.map((entry) => (entry.id === id ? { ...entry, state: next.state } : entry))
        )
      } catch (failure) {
        if (stopped || !newest()) return
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
    if (!open || !teamSelected) return undefined
    if (!client || typeof client.orchestrator !== 'function') {
      setUnavailable(true)
      return undefined
    }
    setUnavailable(false)
    let stopped = false
    const ids = ['orchestrator', ...teamKey.split('\n').filter(Boolean)]

    async function readTeam() {
      const ticket = teamTicketRef.current + 1
      teamTicketRef.current = ticket
      const newest = () => teamTicketRef.current === ticket
      try {
        const answers = await Promise.allSettled(
          ids.map((id) => client.orchestrator(id === 'orchestrator' ? undefined : id))
        )
        if (stopped || !newest()) return
        const nextChats = {}
        const nextLoaded = {}
        const failed = []
        ids.forEach((id, index) => {
          const answer = answers[index]
          if (answer.status === 'fulfilled') {
            nextChats[id] = normalizeChat(answer.value)
            nextLoaded[id] = true
          } else {
            failed.push(id)
          }
        })
        setChats((currentChats) => ({ ...currentChats, ...nextChats }))
        setLoadedIds((currentLoaded) => ({ ...currentLoaded, ...nextLoaded }))
        setList((currentList) =>
          currentList.map((entry) =>
            nextChats[entry.id] ? { ...entry, state: nextChats[entry.id].state } : entry
          )
        )
        setTeamFailed(failed)
        setReadError(
          failed.length > 0
            ? `Could not read ${failed.map((id) => teamName(id)).join(', ')}.`
            : null
        )
      } catch (failure) {
        if (stopped || !newest()) return
        setTeamFailed([...ids])
        setReadError(errorText(failure, 'Could not read the team.'))
      }
    }

    readTeam()
    const timer = setInterval(readTeam, ORCH_REFRESH_MS)
    let unsubscribe = null
    if (typeof client.subscribe === 'function') {
      unsubscribe = client.subscribe((notice) => {
        if (notice && notice.topic === 'orchestrator') readTeam()
      })
    }

    return () => {
      stopped = true
      clearInterval(timer)
      unsubscribe?.()
    }
  }, [open, client, teamKey, teamSelected])

  useEffect(() => {
    if (!open || inline) return undefined
    const timer = setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(timer)
  }, [open, inline])

  useEffect(() => {
    if (!open) return
    const next = Number(focusRequest) || 0
    if (next === focusAtRef.current) return
    focusAtRef.current = next
    if (!laneRecipient) inputRef.current?.focus({ preventScroll: true })
  }, [open, focusRequest, laneRecipient])

  useEffect(() => {
    setAtBottom(true)
  }, [selected])

  useEffect(() => {
    if (prevSelectedRef.current !== selected) {
      prevSelectedRef.current = selected
      closeConfirm()
    }
    setStopping(false)
    setEffortOpen(false)
    setCompactOpen(false)
    setModelError('')
    setEffortError('')
    setModelSaving(false)
    setEffortSaving(false)
    setModelSaved('')
    setEffortSaved('')
    setModeOpen(false)
    setModeConfirm(null)
    setModeError('')
    setModeSaved('')
    setAnswering({})
    setApprovalError({})
    setCopiedId('')
    if (copyTimer.current) {
      clearTimeout(copyTimer.current)
      copyTimer.current = null
    }
  }, [selected])

  useEffect(() => {
    setModelSaved('')
  }, [current?.model])

  useEffect(() => {
    setEffortSaved('')
  }, [current?.effort])

  useEffect(
    () => () => {
      if (modeSavedTimer.current) clearTimeout(modeSavedTimer.current)
      modeSavedTimer.current = null
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = null
    },
    []
  )

  useEffect(() => {
    if (!open || !atBottom) return
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [open, selected, lines.length, workKey, teamRows.length, atBottom])

  useEffect(() => {
    if (!modeConfirm && !compactOpen) return undefined
    function onKey(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (modeSaving) return
      if (modeConfirm) {
        setModeConfirm(null)
        setModeError('')
        return
      }
      setCompactOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [modeConfirm, compactOpen, modeSaving])

  useEffect(() => {
    if (!open) return undefined
    function onKey(event) {
      if (event.key !== 'Escape') return
      if (effortOpen) {
        setEffortOpen(false)
        return
      }
      if (modeOpen) {
        setModeOpen(false)
        return
      }
      if (modeConfirm) {
        setModeConfirm(null)
        setModeError('')
        return
      }
      if (compactOpen) {
        setCompactOpen(false)
        return
      }
      if (slashOpen) {
        setSlashOpen(false)
        return
      }
      if (confirm) {
        if (confirm === 'stop' && stopping) return
        closeConfirm()
        return
      }
      onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    open,
    confirm,
    stopping,
    onClose,
    effortOpen,
    modeOpen,
    modeConfirm,
    compactOpen,
    slashOpen,
  ])

  useEffect(() => {
    function onOpenChat(event) {
      const id = event && event.detail ? event.detail.id : ''
      if (typeof id !== 'string' || !id) return
      selectTab(id)
    }
    window.addEventListener(OPEN_CHAT_EVENT, onOpenChat)
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpenChat)
  }, [selected, onSelect, setLaneChoice])

  useEffect(() => {
    if (list.length === 0) return
    if (selected === TEAM_TAB) {
      if (!list.some((entry) => entry.id !== 'orchestrator')) changeSelected('orchestrator')
      return
    }
    if (selected === 'orchestrator') return
    if (!list.some((entry) => entry.id === selected)) changeSelected('orchestrator')
  }, [list, selected])

  function changeSelected(id) {
    setSlashOpen(false)
    setSlashIndex(0)
    setCompactKeep('')
    if (controlled) onSelect?.(id)
    else setOwnSelected(id)
  }

  function onLogScroll() {
    setAtBottom(nearChatBottom(logRef.current))
  }

  function jumpToNewest() {
    setAtBottom(true)
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }

  function toggleWork(id) {
    setOpenWork((current) => ({ ...current, [id]: !current[id] }))
  }

  function teamName(id) {
    if (id === 'orchestrator') return 'Main'
    const entry = list.find((item) => item.id === id)
    return entry?.name || id
  }

  async function sendToLane(text, id) {
    if (!client || typeof client.sendOrchestrator !== 'function') {
      return { ok: false, error: 'The orchestrator is not connected.' }
    }
    try {
      await client.sendOrchestrator(text, { id, worktree: separateWorktree })
      return { ok: true }
    } catch (failure) {
      return { ok: false, error: errorText(failure, 'Could not send the message.') }
    }
  }

  async function deliver(text, id = toRecipient) {
    if (!client) {
      setError('The orchestrator is not connected.')
      return
    }
    setSending(true)
    setError(null)
    setConfirm(null)
    const result = await sendChatMessage(client, text, id)
    setSending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setStartedIds((currentStarted) => ({ ...currentStarted, [id]: true }))
    setDraft((currentDraft) => (currentDraft.trim() === text ? '' : currentDraft))
    jumpToNewest()
    if (id === selected || id === 'orchestrator' || !list.some((item) => item.id === id)) await readChatRef.current?.()
    await readListRef.current?.()
  }

  async function copyMessage(line) {
    if (!(await copyChatText(line.text))) return
    if (copyTimer.current) clearTimeout(copyTimer.current)
    setCopiedId(line.id)
    copyTimer.current = setTimeout(() => {
      copyTimer.current = null
      setCopiedId('')
    }, 2000)
  }

  async function retryMessage(target) {
    if (working) {
      setError('Wait for the turn to end, or stop it.')
      return
    }
    if (!target || sending) return
    await deliver(target.text, selected)
  }

  async function branchMessage(line, index) {
    if (typeof client?.branchOrchestratorSession !== 'function') {
      setError('The bridge cannot start a branch.')
      return
    }
    if (sending) return
    setSending(true)
    setError(null)
    try {
      await client.branchOrchestratorSession({ id: selected, index: line.index + 1, confirmed: true })
      if (lines.slice(0, index + 1).some((entry) => entry.from === 'owner')) {
        setStartedIds((currentStarted) => ({ ...currentStarted, [selected]: true }))
      }
      setDraft('')
      setSlashOpen(false)
      setConfirm(null)
      await readChatRef.current?.()
      await readListRef.current?.()
    } catch (failure) {
      setError(errorText(failure, 'Could not branch the conversation.'))
    } finally {
      setSending(false)
    }
  }

  function requestSend() {
    const text = draft.trim()
    if (sending || unavailable) return
    const command = parseRoomCommand(text)
    if (command) {
      runRoomCommand(command)
      return
    }
    if (!canSend(text)) return
    if (!startedIds[selected] && needsStartConfirm(chat) && toRecipient === 'orchestrator') {
      setConfirm('start')
      return
    }
    deliver(text, toRecipient)
  }

  function onDraftChange(event) {
    const next = clampDraft(event.target.value)
    setDraft(next)
    setSlashIndex(0)
    setSlashOpen(next.startsWith('/'))
    if (next.startsWith('/') && commands.length === 0) readCommandsRef.current?.()
  }

  function pickCommand(entry) {
    if (!entry) return
    const text = commandPickText(entry.name)
    if (!text) return
    setDraft(text)
    setSlashOpen(false)
    setSlashIndex(0)
    inputRef.current?.focus()
  }

  async function startConversation() {
    if (typeof client?.newOrchestratorSession !== 'function') {
      setError('The bridge cannot start a new conversation.')
      return
    }
    setSending(true)
    setError(null)
    try {
      await client.newOrchestratorSession({ id: selected })
      setDraft('')
      setSlashOpen(false)
      setConfirm(null)
      await readChatRef.current?.()
      await readListRef.current?.()
    } catch (failure) {
      setError(errorText(failure, 'Could not start a new conversation.'))
    } finally {
      setSending(false)
    }
  }

  function runRoomCommand(command) {
    if (command.kind === 'help') {
      setDraft('/')
      setSlashIndex(0)
      setSlashOpen(true)
      if (commands.length === 0) readCommandsRef.current?.()
      return
    }
    if (command.kind === 'compact') {
      setCompactKeep(command.keep)
      setError(null)
      setConfirm('compact')
      return
    }
    if (command.kind === 'stop') {
      setDraft('')
      setSlashOpen(false)
      openStopConfirm()
      return
    }
    setDraft('')
    setSlashOpen(false)
    startConversation()
  }

  async function compactConfirmed() {
    if (typeof client?.compactOrchestrator !== 'function') {
      setError('The bridge cannot compact the conversation.')
      return
    }
    setCompacting(true)
    setError(null)
    try {
      await client.compactOrchestrator({ id: selected, keep: compactKeep })
      setConfirm(null)
      setCompactKeep('')
      setDraft('')
      setSlashOpen(false)
      await readChatRef.current?.()
    } catch (failure) {
      setError(errorText(failure, 'Could not compact the conversation.'))
    } finally {
      setCompacting(false)
    }
  }

  function startConfirmed() {
    const text = draft.trim()
    setConfirm(null)
    if (canSend(text)) deliver(text, toRecipient)
  }

  function openStopConfirm() {
    setStopResult(null)
    setError(null)
    setConfirm('stop')
  }

  function closeConfirm() {
    setConfirm(null)
    setStopResult(null)
  }

  async function confirmStop(tree = false) {
    if (stopping) return
    const method = tree ? 'stopTree' : 'stopOrchestrator'
    if (!client || typeof client[method] !== 'function') {
      setError('The orchestrator is not connected.')
      return
    }
    const version = selectionRef.current.version
    setStopping(true)
    setError(null)
    const options = selected === 'orchestrator' ? { confirmed: true } : { confirmed: true, id: selected }
    try {
      const answer = await client[method](options)
      if (selectionRef.current.version !== version) return
      if (tree) {
        const stoppedLanes = Array.isArray(answer?.stoppedLanes)
          ? answer.stoppedLanes.filter((lane) => typeof lane === 'string' && lane.trim() !== '')
          : []
        const stillRunning = Array.isArray(answer?.stillRunning)
          ? answer.stillRunning
              .map((lane) => (typeof lane === 'string' ? visibleChatText(lane.trim()) : ''))
              .filter(Boolean)
          : []
        setStopResult({ stoppedCount: stoppedLanes.length, stillRunning })
      } else {
        closeConfirm()
      }
      await readChatRef.current?.()
      await readListRef.current?.()
      onOrchestratorChange()
    } catch (failure) {
      if (selectionRef.current.version === version) {
        setError(errorText(failure, 'Could not stop the orchestrator.'))
      }
    } finally {
      setStopping(false)
    }
  }

  function stopConfirmed() {
    return confirmStop(false)
  }

  function stopTreeConfirmed() {
    return confirmStop(true)
  }

  function handleSubmit(event) {
    event.preventDefault()
    requestSend()
  }

  function handleKeyDown(event) {
    if (sending) return
    if (slashVisible && slashItems.length > 0) {
      const action = commandKeyAction(event, { items: slashItems, index: slashIndex, draft })
      if (action.type === 'close') {
        event.preventDefault()
        event.stopPropagation()
        setSlashOpen(false)
        return
      }
      if (action.type === 'move') {
        event.preventDefault()
        setSlashIndex(action.index)
        return
      }
      if (action.type === 'pick') {
        event.preventDefault()
        pickCommand(slashItems[action.index])
        return
      }
      if (action.type === 'send') {
        event.preventDefault()
        requestSend()
        return
      }
    }
    if (!isSendKey(event)) return
    event.preventDefault()
    requestSend()
  }

  function closePickers() {
    setEffortOpen(false)
    setModeOpen(false)
    setCompactOpen(false)
    setModeConfirm(null)
    setModelError('')
    setEffortError('')
    setModeError('')
  }

  function messageOf(failure, fallback) {
    return errorText(failure, fallback)
  }

  useEffect(() => {
    if (!open || models !== null || typeof client?.models !== 'function') return undefined
    let active = true
    setModelsLoading(true)
    setModelsError('')
    client.models().then((answer) => {
      if (active) {
        setModelsLoading(false)
        setModels(answer)
      }
    }).catch((failure) => {
      if (active) setModelsError(messageOf(failure, 'Models are not available.'))
    }).finally(() => {
      if (active) setModelsLoading(false)
    })
    return () => { active = false }
  }, [open, client, models])

  async function saveModel(value) {
    if (value === (modelSaved || model) || modelSaving) return
    if (typeof client?.setOrchestratorModel !== 'function') {
      setModelError('The bridge cannot set a model.')
      return
    }
    const version = selectionRef.current.version
    setModelSaving(true)
    setModelError('')
    try {
      await client.setOrchestratorModel({ id: selected, model: value, confirmed: true })
      if (selectionRef.current.version !== version) return
      setModelSaved(value)
      onOrchestratorChange()
    } catch (failure) {
      if (selectionRef.current.version === version) setModelError(messageOf(failure, 'The bridge refused the model.'))
    } finally {
      if (selectionRef.current.version === version) setModelSaving(false)
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

  async function saveEffort(value) {
    setEffortOpen(false)
    if (value === shownEffort || effortSaving) return
    if (typeof client?.setOrchestratorEffort !== 'function') {
      setEffortError('The bridge cannot set an effort.')
      return
    }
    const version = selectionRef.current.version
    setEffortSaving(true)
    setEffortError('')
    try {
      await client.setOrchestratorEffort({
        id: selected,
        effort: value,
        confirmed: true,
      })
      if (selectionRef.current.version !== version) return
      setEffortSaved(value)
      onOrchestratorChange()
    } catch (failure) {
      if (selectionRef.current.version === version) setEffortError(messageOf(failure, 'The bridge refused the effort.'))
    } finally {
      if (selectionRef.current.version === version) setEffortSaving(false)
    }
  }

  function toggleMode() {
    if (modeOpen) {
      setModeOpen(false)
      return
    }
    closePickers()
    setModeOpen(true)
  }

  function noteModeSaved() {
    if (modeSavedTimer.current) clearTimeout(modeSavedTimer.current)
    setModeSaved('Applies from the next turn.')
    modeSavedTimer.current = setTimeout(() => {
      modeSavedTimer.current = null
      setModeSaved('')
    }, 4000)
  }

  async function saveMode(next) {
    if (!next || modeSaving) return
    if (typeof client?.setOrchestratorMode !== 'function') {
      setModeError('The bridge cannot set a mode.')
      return
    }
    setModeSaving(true)
    setModeError('')
    try {
      await client.setOrchestratorMode({
        id: selected,
        mode: next.id,
        confirmed: true,
      })
      setChats((currentChats) => {
        const prior = currentChats[selected] ?? normalizeChat(null)
        return {
          ...currentChats,
          [selected]: {
            ...prior,
            mode: next.id,
            modes: prior.modes.length > 0 ? prior.modes : modeList,
          },
        }
      })
      setList((currentList) =>
        currentList.map((entry) => (entry.id === selected ? { ...entry, mode: next.id } : entry))
      )
      setModeConfirm(null)
      noteModeSaved()
      onOrchestratorChange()
    } catch (failure) {
      setModeError(messageOf(failure, 'The bridge refused the mode.'))
    } finally {
      setModeSaving(false)
    }
  }

  function pickMode(entry) {
    if (!entry || modeSaving) return
    setModeOpen(false)
    setModeError('')
    if (entry.id === 'bypass') {
      setModeConfirm(entry)
      return
    }
    saveMode(entry)
  }

  async function answerApprovalCard(approval, allow) {
    const approvalId = approval.approvalId
    if (!approvalId || answering[approvalId]) return
    if (typeof client?.answerApproval !== 'function') {
      setApprovalError((current) => ({
        ...current,
        [approvalId]: 'The bridge cannot answer approvals.',
      }))
      return
    }
    setAnswering((current) => ({ ...current, [approvalId]: true }))
    setApprovalError((current) => ({ ...current, [approvalId]: '' }))
    try {
      await client.answerApproval({ id: selected, approvalId, allow, confirmed: true })
      setChats((currentChats) => {
        const prior = currentChats[selected]
        if (!prior) return currentChats
        return {
          ...currentChats,
          [selected]: {
            ...prior,
            approvals: prior.approvals.filter((entry) => entry.approvalId !== approvalId),
          },
        }
      })
    } catch (failure) {
      setApprovalError((current) => ({
        ...current,
        [approvalId]: messageOf(failure, 'Could not answer the approval.'),
      }))
    } finally {
      setAnswering((current) => {
        const next = { ...current }
        delete next[approvalId]
        return next
      })
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
    setLaneChoice('')
    setTeamFailed([])
    if (id !== selected) changeSelected(id)
    closeConfirm()
    setError(null)
    setReadError(null)
  }

  function changeRecipient(id) {
    if (availableLanes.some((lane) => lane.key === id)) setLaneChoice(id)
    else selectTab(id)
  }

  function renderMessageActions(line, index) {
    const retry = retryTarget(lines, index)
    return (
      <div className="mr-orch-line-actions">
        <button
          type="button"
          className="mr-orch-line-action"
          onClick={() => copyMessage(line)}
        >
          {copiedId === line.id ? 'Copied' : 'Copy'}
        </button>
        {retry ? (
          <button
            type="button"
            className="mr-orch-line-action"
            onClick={() => retryMessage(retry)}
          >
            Retry
          </button>
        ) : null}
        <button
          type="button"
          className="mr-orch-line-action"
          onClick={() => branchMessage(line, index)}
        >
          Branch
        </button>
      </div>
    )
  }

  function renderSlashList() {
    if (!slashVisible) return null
    return (
      <div className="mr-orch-slash" role="listbox" aria-label="Slash commands">
        {slashItems.length === 0 ? (
          <p className="mr-orch-slash-note mono">{slashNote}</p>
        ) : (
          slashItems.map((entry, index) => (
            <button
              key={entry.name}
              type="button"
              role="option"
              aria-selected={index === slashIndex}
              className={`mr-orch-slash-row${index === slashIndex ? ' is-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pickCommand(entry)}
            >
              <span className="mr-orch-slash-name mono">/{entry.name}</span>
              <span className={`mr-orch-slash-source mono is-${entry.source}`}>{entry.source}</span>
              {entry.description ? <span className="mr-orch-slash-desc">{entry.description}</span> : null}
            </button>
          ))
        )}
      </div>
    )
  }

  if (!open) return null
  if (laneRecipient) {
    const lane = laneRecipient
    return <LaneConversation key={lane.key} client={client} lane={lane.key} laneName={lane.name || lane.key} project={project} lanes={lanesData}
      agentColors={colors} focusRequest={focusRequest}
      liveRuns={liveRuns} tick={tick} inline={inline} recipientOptions={availableLanes} recipients={subs}
      onRecipientChange={changeRecipient} onBack={() => setLaneChoice('')}
      onRecipientSend={(text) => sendToLane(text, lane.key)}
      worktreeChoice={<Switch label="Worktree" checked={separateWorktree} onChange={(checked) => setSeparateWorktree(checked)} />} />
  }

  return (
    <aside
      id={inline ? undefined : 'hud-orchestrator-chat'}
      className={`mr-orch${inline ? ' is-inline' : ''}${frameClass ? ` ${frameClass}` : ''}`}
      aria-label="Orchestrator chat"
    >
      {!inline ? (
        <header className="mr-orch-head">
          <span className="mr-orch-title">Orchestrator</span>
          {model ? <span className="mr-orch-model mono" title={model}>{model}</span> : null}
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
            const active = tab.id === TEAM_TAB ? teamSelected : selected === tab.id && !teamSelected
            return (
              <div key={tab.id} className={`mr-orch-tab-wrap${active ? ' is-active' : ''}`}>
                <button
                  type="button"
                  className={`mr-orch-tab${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => selectTab(tab.id)}
                >
                  {tab.id === TEAM_TAB ? null : (
                    <span className={`mr-orch-tab-dot is-${statusTone(tab.state)}`} aria-hidden="true" />
                  )}
                  <span>{tab.label}</span>
                </button>
              </div>
            )
          })}
        </div>
      ) : null}

      {problem || listError ? (
        <div className="mr-orch-error" role="alert">
          {problem ? <p>{problem}</p> : null}
          {listError ? <p>{listError}</p> : null}
        </div>
      ) : null}

      {teamSelected ? (
        <div className="mr-orch-log is-team" aria-label="Every orchestrator chat" role="log" aria-live="polite" ref={logRef}>
          {teamRows.length === 0 ? (
            <p className="mr-orch-empty">
              {teamFailed.length > 0
                ? readError || 'Could not read the team.'
                : teamReady
                  ? 'Nothing said yet.'
                  : 'Reading the team.'}
            </p>
          ) : (
            teamRows.map((line) => (
              <div
                key={line.id}
                className={`mr-orch-team-row is-${line.from}`}
                title={line.at ? `${line.where} at ${line.at}` : line.where}
                onClick={(event) => {
                  if (!event.target.closest?.('a')) selectTab(line.chatId)
                }}
              >
                <button type="button" className="mr-orch-team-meta mono">
                  <span className="mr-orch-team-where">{line.where}</span>
                  <span className="mr-orch-team-who">{line.who}</span>
                </button>
                <div className="mr-orch-team-text">
                  {line.from === 'owner' ? line.text : <Markdown text={line.text} />}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="mr-orch-log" role="log" aria-live="polite" ref={logRef} onScroll={onLogScroll}>
            {lines.length === 0 ? (
              <p className="mr-orch-empty">
                {loaded ? 'Tell the orchestrator what you want built.' : 'Reading the chat.'}
              </p>
            ) : (
              lines.map((line, index) => {
                if (line.from === 'agent') {
                  const parts = line.text.split('\n')
                  const isLong = parts.length > 3
                  const unfolded = Boolean(openAgentAll[line.id])
                  const displayed = isLong && !unfolded ? parts.slice(0, 3).join('\n') : line.text
                  const senderKey = line.agent?.from || (line.text.startsWith('Orchestrator') ? 'orchestrator' : line.text.split(' to ')[0].trim())
                  return (
                    <div key={line.id} className="mr-orch-line is-agent mono">
                      <div className="mr-orch-blocks">
                        <span className="mr-agent-dot" aria-hidden="true" style={{ background: agentColor(senderKey, colors) }} />
                        <Markdown text={displayed} />
                      </div>
                      {isLong ? (
                        <Chip
                          className="mr-orch-show-all"
                          label={unfolded ? 'Show less' : 'Show all'}
                          open={unfolded}
                          onClick={() => setOpenAgentAll((prev) => ({ ...prev, [line.id]: !prev[line.id] }))}
                        />
                      ) : null}
                      {renderMessageActions(line, index)}
                    </div>
                  )
                }
                const notice = line.from === 'room' ? roomNoticeSummary(line.text, line.firstCommit) : null
                if (notice) {
                  const expanded = Boolean(openRoomDetails[line.id])
                  const tone = notice.status === 'succeeded' ? 'succeeded' : ['failed', 'stopped'].includes(notice.status) ? 'failed' : 'other'
                  return (
                    <div key={line.id} className="mr-orch-line is-room is-run-notice">
                      <div className="mr-orch-run-summary mono">
                        <span>
                          <span className="mr-agent-dot" aria-hidden="true" style={{ background: agentColor(notice.lane, colors) }} />
                          {notice.lane}
                        </span>
                        {notice.briefs && <span>{notice.briefs}</span>}
                        <span className={`mr-orch-run-status is-${tone}`}>{notice.status}</span>
                        {notice.subject && <span className="mr-orch-run-subject" title={notice.subject}>{notice.subject}</span>}
                        <button type="button" className="mr-orch-line-action" aria-expanded={expanded} onClick={() => setOpenRoomDetails((prev) => ({ ...prev, [line.id]: !prev[line.id] }))}>Details</button>
                      </div>
                      {expanded && <div className="mr-orch-blocks is-room"><Markdown text={line.text} /></div>}
                      {expanded && renderMessageActions(line, index)}
                    </div>
                  )
                }
                return (
                  <div key={line.id} className={`mr-orch-line is-${line.from}`}>
                    {line.from === 'room' ? <span className="mr-orch-who mono">room</span> : null}
                    {line.fromMain ? <span className="mr-orch-who mono">from main</span> : null}
                    {line.from === 'lane' ? (
                      <span className="mr-orch-who mono">
                        <span className="mr-agent-dot" aria-hidden="true" style={{ background: agentColor(line.lane, colors) }} />
                        {line.laneName || line.lane}
                      </span>
                    ) : null}
                    {line.from === 'owner' ? (
                      <span className="mr-orch-text">{line.text}</span>
                    ) : (
                      <div className={`mr-orch-blocks is-${line.from}`}>
                        <Markdown text={line.text} />
                      </div>
                    )}
                    {line.work && (line.work.state !== 'working' || line.work.steps.length > 0) ? (
                      <div className={`mr-orch-work${line.work.state === 'working' ? ' is-working' : ''}`}>
                        <button
                          type="button"
                          className="mr-orch-work-line mono"
                          aria-expanded={openWork[line.id] === true}
                          onClick={() => toggleWork(line.id)}
                          disabled={line.work.steps.length === 0}
                        >
                          {line.work.state === 'working' ? workStepText(line.work.steps.at(-1)) : workText(line.work)}
                        </button>
                        {openWork[line.id] === true && line.work.steps.length > 0 ? (
                          <ol className="mr-orch-work-steps mono">
                            {workRows(line.work).map((row, stepIndex) => (
                              <li key={`${line.id}-${stepIndex}`}>{row.text}</li>
                            ))}
                          </ol>
                        ) : null}
                      </div>
                    ) : null}
                    {renderMessageActions(line, index)}
                  </div>
                )
              })
            )}
          </div>

          {!atBottom ? (
            <div className="mr-orch-jump-row">
              <Chip className="mr-orch-jump" label="Jump to newest" onClick={jumpToNewest} />
            </div>
          ) : null}

          {confirm === 'start' ? (
            <section ref={confirmRef} className="mr-orch-confirm" aria-label="Start the orchestrator">
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
            <section ref={confirmRef} className="mr-orch-confirm is-stop" aria-label="Stop the orchestrator">
              {stopResult ? (
                <>
                  <p className="mr-orch-confirm-text">
                    {stopResult.stoppedCount === 1
                      ? 'Stopped 1 lane.'
                      : `Stopped ${stopResult.stoppedCount} lanes.`}
                  </p>
                  {stopResult.stillRunning.length > 0 ? (
                    <p className="mr-orch-confirm-text">
                      {`Still running: ${stopResult.stillRunning.join(', ')}.`}
                    </p>
                  ) : null}
                  <div className="mr-orch-confirm-actions">
                    <button
                      type="button"
                      className="mr-orch-confirm-btn is-cancel"
                      onClick={closeConfirm}
                    >
                      Close
                    </button>
                  </div>
                </>
              ) : (
                <>
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
                      className="mr-orch-confirm-btn is-stop"
                      onClick={stopTreeConfirmed}
                      disabled={stopping}
                    >
                      {selected === 'orchestrator' ? 'Stop everything' : 'Stop with its lanes'}
                    </button>
                    <button
                      type="button"
                      className="mr-orch-confirm-btn is-cancel"
                      onClick={closeConfirm}
                      disabled={stopping}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </section>
          ) : null}

          {confirm === 'compact' ? (
            <section ref={confirmRef} className="mr-orch-confirm" aria-label="Compact the conversation">
              <p className="mr-orch-confirm-text">
                {compactKeep
                  ? `Compact the conversation and keep: ${compactKeep}`
                  : 'Compact the conversation? The next turn starts a new session with the summary.'}
              </p>
              <div className="mr-orch-confirm-actions">
                <button
                  type="button"
                  className="mr-orch-confirm-btn is-start"
                  onClick={compactConfirmed}
                  disabled={compacting}
                >
                  Compact
                </button>
                <button
                  type="button"
                  className="mr-orch-confirm-btn is-cancel"
                  onClick={() => {
                    setConfirm(null)
                    setCompactKeep('')
                  }}
                  disabled={compacting}
                >
                  Cancel
                </button>
              </div>
            </section>
          ) : null}

          {approvals.length > 0 ? (
            <div className="mr-orch-approvals">
              {approvals.map((approval) => {
                const approvalId = approval.approvalId
                const busy = Boolean(answering[approvalId])
                const note = approvalError[approvalId]
                return (
                  <section
                    key={approvalId}
                    className="mr-orch-approval"
                    aria-label={`Approval for ${approval.tool}`}
                  >
                    <p className="mr-orch-approval-title mono">
                      {approvalTitle(current?.name || 'Orchestrator', approval.tool)}
                    </p>
                    <pre className="mr-orch-approval-input mono">{approvalInputText(approval.input)}</pre>
                    {note ? <p className="strip-note is-error">{note}</p> : null}
                    <div className="mr-orch-approval-actions">
                      <button
                        type="button"
                        className="mr-orch-confirm-btn is-start"
                        onClick={() => answerApprovalCard(approval, true)}
                        disabled={busy || !canAnswerApprovals}
                      >
                        Allow
                      </button>
                      <button
                        type="button"
                        className="mr-orch-confirm-btn is-stop"
                        onClick={() => answerApprovalCard(approval, false)}
                        disabled={busy || !canAnswerApprovals}
                      >
                        Deny
                      </button>
                    </div>
                  </section>
                )
              })}
            </div>
          ) : null}

          <Composer
            input={{
              id: inputId,
              ref: inputRef,
              value: draft,
              maxLength: ORCH_MAX_CHARS,
              placeholder: inline ? 'Ask the orchestrator anything' : 'What should be built?',
              'aria-label': 'Message to the orchestrator',
              onChange: onDraftChange,
              onKeyDown: handleKeyDown,
            }}
            onSubmit={handleSubmit}
            sending={sending}
            sendDisabled={!canSend(draft) || sending || unavailable}
            status={status}
            tone={tone}
            context={context}
            stop={working ? { onClick: openStopConfirm, disabled: stopping } : null}
            toolbar={
              <>
                <RecipientChip value={toRecipient} onChange={changeRecipient} recipients={subs} lanes={availableLanes} />
                <ModelPicker
                  key={selected}
                  inline
                  ariaLabel={`Models for ${current?.name || 'the orchestrator'}`}
                  value={modelSaved || model}
                  choices={modelList}
                  client={client}
                  onChange={saveModel}
                  onRefresh={modelRefresh.refresh}
                  loading={modelsLoading || modelRefresh.loading}
                  canRefresh={modelRefresh.canRefresh}
                  disabled={modelSaving}
                  placeholder="Harness default"
                  error={modelError || modelRefresh.error || modelsError}
                />
                {effortChoices.length > 0 && (
                  <Chip label="Effort" value={shownEffort} className="hud-strip-effort" open={effortOpen}
                    aria-label={`Effort for ${current?.name || 'the orchestrator'}`} title={shownEffort} onClick={openEffort} />
                )}
                {canSetMode && (
                  <Chip label="Mode" value={shownMode} className="hud-strip-mode" open={modeOpen}
                    aria-label={`Mode for ${current?.name || 'the orchestrator'}`} title={shownMode} onClick={toggleMode} />
                )}
                <span className="hud-strip-compact">
                  <Menu label="Composer options" items={[
                    { label: 'Compact…', onSelect: toggleCompact },
                    { label: 'Show agent messages', checked: showAgentMessages, onSelect: () => toggleAgentMessages() },
                  ]} />
                </span>
              </>
            }
          >
            {renderSlashList()}
            {canSetMode && modeError && <p className="mr-mode-error mono" role="alert">{modeError}</p>}
            {canSetMode && modeSaved && <p className="mr-mode-note mono" role="status">{modeSaved}</p>}
            {effortError && <p className="strip-note is-error" role="alert">{effortError}</p>}
            {count && <span className="mr-orch-count mono">{count}</span>}
            {modeOpen ? (
              <div className="strip-pop is-modes" aria-label="Modes">
                {modeList.map((entry) => (
                  <button
                    type="button"
                    className={`strip-model-choice mr-mode-choice${entry.id === mode ? ' is-current' : ''}`}
                    key={entry.id}
                    onClick={() => pickMode(entry)}
                    disabled={modeSaving}
                  >
                    <span className="mr-mode-choice-label">{entry.label || entry.id}</span>
                    {entry.line ? <><span aria-hidden="true"> - </span><span className="mr-mode-choice-line">{entry.line}</span></> : null}
                  </button>
                ))}
              </div>
            ) : null}

            {modeConfirm ? (
              <div className="strip-pop is-confirm">
                <section ref={modeConfirmRef} className="mr-orch-confirm is-stop" aria-label="Set the mode">
                  <p className="mr-orch-confirm-text">
                    {`Let ${(current?.name || 'the orchestrator').toUpperCase()} run any command and edit any file without asking?`}
                  </p>
                  {modeError ? <p className="strip-note is-error">{modeError}</p> : null}
                  <div className="mr-orch-confirm-actions">
                    <button
                      type="button"
                      className="mr-orch-confirm-btn is-cancel"
                      onClick={() => {
                        setModeConfirm(null)
                        setModeError('')
                      }}
                      disabled={modeSaving}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="mr-orch-confirm-btn is-stop"
                      onClick={() => saveMode(modeConfirm)}
                      disabled={modeSaving}
                    >
                      Use Bypass
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
                      onClick={() => saveEffort(level)}
                      disabled={effortSaving}
                    >
                      {level}
                    </button>
                  ))
                )}
                {!canSetEffort && <p className="strip-note">Read only here.</p>}
              </div>
            ) : null}

            {compactOpen ? (
              <div ref={compactRef} className="strip-pop is-compact">
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
          </Composer>
        </>
      )}

      {unavailable ? <p className="mr-orch-note mono">The orchestrator is not connected.</p> : null}
    </aside>
  )
}
