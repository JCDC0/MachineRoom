import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  briefTarget,
  formatBriefTitle,
  groupBriefsByOwner,
  ownerToLane,
  runLaneFor,
} from './briefs.js'
import { subscribeToNotices } from './notices.js'
import { laneNeedsNetwork } from '../../model/online.js'
import { TIERS } from '../../policy/route.js'
import { PROJECT_CONFIRM_LIMIT, PROJECT_QUEUE_TEXT_LIMIT, cancelSplitRun, clearProjectDraft, clearSplitRun, planLaneTasks, projectCheckLine, projectDraftKey, projectFormNotice, projectRunBody, projectRunConfirm, projectRunLabel, projectRunLanes, projectSplitLabel, projectSplitWorktreeLine, projectTaskProblem, projectWorktreeLine, queueRecoveryAvailable, queueRecoveryMessage, queueRecoveryPlan, readProjectDraft, recordLine, resultWord, splitRunProgress, splitRunSnapshot, splitTasks, startSplitRun, subscribeSplitRun, timeSinceStart, writeProjectDraft } from './runs.js'
import { formatTime } from '../inspector.js'

function projectKey(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/[\\/]+$/, '').toLowerCase()
}

function runWorkText(entry) {
  if (entry?.queue) {
    return entry.tasks === 1 && typeof entry?.task === 'string' && entry.task.trim()
      ? entry.task.trim()
      : `${entry.tasks} task${entry.tasks === 1 ? '' : 's'} in order`
  }
  if (typeof entry?.task === 'string' && entry.task.trim()) return entry.task.trim()
  if (Array.isArray(entry?.briefs) && entry.briefs.length > 0) return entry.briefs.join(' ')
  return 'none'
}

function stopStartedLabel(startedAt) {
  if (!startedAt) return 'not reported'
  const formatted = formatTime(startedAt, '')
  return formatted && formatted !== startedAt ? `${formatted} (${startedAt})` : startedAt
}

export default function DispatchPanel({
  client,
  targetBriefId,
  initialAgents,
  initialBriefs,
  initialSelectedBriefId,
}) {
  const [targetDismissed, setTargetDismissed] = useState(false)
  const pickedTargetRef = useRef(false)
  const [agents, setAgents] = useState(() => (Array.isArray(initialAgents) ? initialAgents : []))
  const [loading, setLoading] = useState(() => !Array.isArray(initialAgents))
  const [loadError, setLoadError] = useState(null)

  const [briefs, setBriefs] = useState(() => (Array.isArray(initialBriefs) ? initialBriefs : []))
  const [briefsLoading, setBriefsLoading] = useState(
    () => !Array.isArray(initialBriefs) && typeof client?.briefs === 'function'
  )
  const [briefsError, setBriefsError] = useState(null)
  const [selectedBriefId, setSelectedBriefId] = useState(() => initialSelectedBriefId || '')
  const [promptText, setPromptText] = useState('')
  const [promptModel, setPromptModel] = useState('')
  const [promptLoading, setPromptLoading] = useState(false)
  const [promptError, setPromptError] = useState(null)
  const [notForAgent, setNotForAgent] = useState(false)
  const [copyStatus, setCopyStatus] = useState(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [startingRun, setStartingRun] = useState(false)
  const [runError, setRunError] = useState(null)

  const [runsState, setRunsState] = useState({ running: [], recent: [] })
  const [runsLoading, setRunsLoading] = useState(() => typeof client?.runs === 'function')
  const [runsError, setRunsError] = useState(null)
  const [stopTarget, setStopTarget] = useState(null)
  const [stoppingRun, setStoppingRun] = useState(false)
  const [stopError, setStopError] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [lanesMode, setLanesMode] = useState(false)
  const [lanesKnown, setLanesKnown] = useState(false)
  const [projectLane, setProjectLane] = useState(() => (typeof client?.routeLane === 'function' ? 'auto' : ''))
  const [autoRoute, setAutoRoute] = useState({ text: '', answer: null, error: null })
  const [projectTask, setProjectTask] = useState('')
  const [projectCheckCommand, setProjectCheckCommand] = useState('')
  const [projectHasTestScript, setProjectHasTestScript] = useState(false)
  const [projectOwnWorktree, setProjectOwnWorktree] = useState(true)
  const [projectOneLanePerTask, setProjectOneLanePerTask] = useState(false)
  const [projectAllowDirty, setProjectAllowDirty] = useState(false)
  const [projectShowConfirm, setProjectShowConfirm] = useState(false)
  const [projectSplitPlan, setProjectSplitPlan] = useState(null)
  const [projectConfirmLane, setProjectConfirmLane] = useState('')
  const [projectNeedsPreview, setProjectNeedsPreview] = useState(false)
  const [projectStarting, setProjectStarting] = useState(false)
  const [projectError, setProjectError] = useState(null)
  const [projectDiscardConfirm, setProjectDiscardConfirm] = useState(false)
  const [projectDraftPresent, setProjectDraftPresent] = useState(false)
  const [networkOnline, setNetworkOnline] = useState(true)
  const [projectGitState, setProjectGitState] = useState(null)
  const [routeNonce, setRouteNonce] = useState(0)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [recoverySending, setRecoverySending] = useState(false)
  const [recoveryStatus, setRecoveryStatus] = useState({})

  const splitRun = useSyncExternalStore(subscribeSplitRun, splitRunSnapshot, splitRunSnapshot)
  const splitAnswers = splitRun.answers
  const splitActive = splitRun.active
  const mountedRef = useRef(true)
  const splitDoneRef = useRef(false)
  const splitProjectRef = useRef('')
  const loadedProjectRef = useRef('')
  const promptReqRef = useRef(0)
  const routeReqRef = useRef(0)
  const gitReqRef = useRef(0)
  const promptBoxRef = useRef(null)

  const hasBriefs = typeof client?.briefs === 'function'
  const hasRuns = typeof client?.runs === 'function'
  const hasProjectSettings = typeof client?.projectSettings === 'function' && typeof client?.saveProjectSettings === 'function'
  const hasRouteLane = typeof client?.routeLane === 'function'
  const hasOrchestrator = typeof client?.sendOrchestrator === 'function'
  const canStopRun = typeof client?.stopRun === 'function'

  const selectedBrief = briefs.find((item) => item.id === selectedBriefId)
  const runLane = selectedBrief ? runLaneFor(selectedBrief, runsState.running, agents) : null
  const canRunBrief = typeof client?.startRun === 'function' && Boolean(runLane)
  const projectLanes = projectRunLanes(agents, runsState.running)
  const projectFormLine = lanesKnown && !loading ? projectFormNotice({ lanesMode, lanes: projectLanes }) : ''
  const routeTasks = splitTasks(projectTask).map((task) => task.trim()).filter((task) => task !== '')
  const routeText = routeTasks.join('\n---\n')
  const routeAnswer = hasRouteLane && projectLane === 'auto' && autoRoute.text === routeText ? autoRoute.answer : null
  const routeError = hasRouteLane && projectLane === 'auto' && autoRoute.text === routeText ? autoRoute.error : null
  const effectiveLane = projectLane === 'auto' ? routeAnswer?.lane ?? '' : projectLane
  const projectLaneRunning = projectLanes.some((lane) => lane.key === effectiveLane && lane.running)

  async function loadData() {
    if (!client || Array.isArray(initialAgents)) return
    setLoading(true)
    setLoadError(null)
    try {
      const agentList = await client.agents()
      setAgents(Array.isArray(agentList) ? agentList : [])
    } catch (err) {
      setLoadError(err.message || 'Could not load lanes.')
    } finally {
      setLoading(false)
    }
  }

  async function loadBriefs() {
    if (typeof client?.briefs !== 'function') return
    setBriefsLoading(true)
    setBriefsError(null)
    try {
      const list = await client.briefs()
      setBriefs(Array.isArray(list) ? list : [])
    } catch (err) {
      setBriefsError(err.message || 'Could not load briefs.')
    } finally {
      setBriefsLoading(false)
    }
  }

  async function loadRuns() {
    if (typeof client?.runs !== 'function') return
    setRunsError(null)
    try {
      const data = await client.runs()
      setRunsState({
        running: Array.isArray(data?.running) ? data.running : [],
        recent: Array.isArray(data?.recent) ? data.recent : [],
      })
      const nextProject = typeof data?.project === 'string' ? data.project : ''
      const startedProject = splitProjectRef.current
      if (
        splitRunSnapshot().active &&
        startedProject &&
        nextProject &&
        projectKey(startedProject) !== projectKey(nextProject)
      ) {
        cancelSplitRun()
      }
      setProjectName(nextProject)
    } catch (err) {
      setRunsError(err.message || 'Could not load runs.')
    } finally {
      setRunsLoading(false)
    }
  }

  async function sendQueueRecovery(record, key) {
    if (typeof client?.sendOrchestrator !== 'function') return
    setRecoverySending(true)
    setRecoveryStatus((current) => {
      if (!Object.hasOwn(current, key)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    try {
      await client.sendOrchestrator(queueRecoveryMessage(record, { project: projectName }))
      setRecoveryStatus((current) => ({ ...current, [key]: { ok: true, message: 'Sent to Main.' } }))
      setRecoveryKey('')
    } catch (err) {
      setRecoveryStatus((current) => ({
        ...current,
        [key]: { ok: false, message: err?.message || 'Could not send the message.' },
      }))
    } finally {
      setRecoverySending(false)
    }
  }

  function openQueueRecovery(key) {
    setRecoveryKey(key)
    setRecoveryStatus((current) => {
      if (!Object.hasOwn(current, key)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  useEffect(() => {
    if (!stopTarget) return
    const stillRunning = runsState.running.some(
      (entry) => entry.lane === stopTarget.lane && entry.startedAt === stopTarget.startedAt
    )
    if (!stillRunning) {
      setStopTarget(null)
      setStopError(null)
    }
  }, [runsState.running, stopTarget])

  function openStopConfirm(entry) {
    setStopTarget({ lane: entry.lane, startedAt: entry.startedAt })
    setStopError(null)
  }

  async function handleConfirmStop(entry) {
    if (typeof client?.stopRun !== 'function') return
    setStoppingRun(true)
    setStopError(null)
    try {
      await client.stopRun({
        lane: entry.lane,
        startedAt: entry.startedAt,
        confirmed: true,
      })
      if (!mountedRef.current) return
      setStopTarget(null)
      await loadRuns()
    } catch (err) {
      if (!mountedRef.current) return
      setStopError(err.message || 'Could not stop the run.')
    } finally {
      if (mountedRef.current) setStoppingRun(false)
    }
  }

  async function refreshAgents() {
    try {
      const agentList = await client.agents()
      setAgents(Array.isArray(agentList) ? agentList : [])
    } catch {
      return
    }
  }

  async function loadProjectGitState() {
    if (typeof client?.gitState !== 'function') {
      setProjectGitState(null)
      return
    }
    const reqId = ++gitReqRef.current
    try {
      const answer = await client.gitState()
      if (!mountedRef.current || gitReqRef.current !== reqId) return
      setProjectGitState(answer && typeof answer === 'object' ? answer : null)
    } catch {
      if (!mountedRef.current || gitReqRef.current !== reqId) return
      setProjectGitState(null)
    }
  }

  useEffect(() => {
    loadData()
    if (typeof client?.briefs === 'function') {
      loadBriefs()
    } else {
      setBriefs([])
      setBriefsLoading(false)
      setBriefsError(null)
    }
    if (typeof client?.runs === 'function') {
      setRunsLoading(true)
      loadRuns()
    } else {
      setRunsState({ running: [], recent: [] })
      setRunsLoading(false)
      setRunsError(null)
      setProjectName('')
    }
  }, [client])

  useEffect(() => {
    let alive = true
    async function loadHealth() {
      function settle(lanes) {
        if (!alive) return
        setLanesMode(lanes)
        setLanesKnown(true)
      }
      if (typeof client?.health !== 'function') {
        settle(false)
        return
      }
      try {
        const health = await client.health()
        settle(health?.lanes === true)
      } catch {
        settle(false)
      }
    }
    loadHealth()
    return () => {
      alive = false
    }
  }, [client])

  useEffect(() => {
    if (!hasProjectSettings) {
      setProjectCheckCommand('')
      setProjectHasTestScript(false)
      return undefined
    }
    let alive = true
    async function loadProjectSettings() {
      try {
        const answer = await client.projectSettings()
        if (!alive) return
        const draft = readProjectDraft(projectName)
        if (!draft || typeof draft.checkCommand !== 'string') {
          setProjectCheckCommand(typeof answer?.checkCommand === 'string' ? answer.checkCommand : '')
        }
        setProjectHasTestScript(answer?.hasTestScript === true)
      } catch {}
    }
    loadProjectSettings()
    return () => {
      alive = false
    }
  }, [client, hasProjectSettings, projectName])

  useEffect(() => {
    const key = projectDraftKey(projectName)
    if (!key || key === loadedProjectRef.current) return
    loadedProjectRef.current = key
    const draft = readProjectDraft(projectName)
    const fallbackLane = hasRouteLane ? 'auto' : ''
    setProjectTask(draft && typeof draft.task === 'string' ? draft.task : '')
    setProjectLane(draft && typeof draft.lane === 'string' ? draft.lane : fallbackLane)
    setProjectCheckCommand(draft && typeof draft.checkCommand === 'string' ? draft.checkCommand : '')
    setProjectAllowDirty(false)
    setProjectDiscardConfirm(false)
    setProjectDraftPresent(Boolean(draft))
    dismissProjectConfirm()
  }, [projectName, hasRouteLane])

  useEffect(() => {
    return subscribeToNotices(client, 'agents', () => {
      refreshAgents()
    })
  }, [client])

  useEffect(() => {
    return subscribeToNotices(client, 'runs', () => {
      loadRuns()
    })
  }, [client])

  useEffect(() => {
    loadProjectGitState()
    const unsubscribe = subscribeToNotices(client, 'git', () => {
      loadProjectGitState()
    })
    return () => {
      gitReqRef.current += 1
      unsubscribe()
    }
  }, [client])

  useEffect(() => {
    if (!hasRouteLane || projectLane !== 'auto') return
    const tasks = splitTasks(projectTask).map((task) => task.trim()).filter((task) => task !== '')
    const text = tasks.join('\n---\n')
    if (text === '') {
      routeReqRef.current += 1
      setAutoRoute({ text: '', answer: null, error: null })
      return
    }
    const reqId = ++routeReqRef.current
    const timer = setTimeout(async () => {
      try {
        const answers = await Promise.all(tasks.map((task) => client.routeLane({ task })))
        if (routeReqRef.current !== reqId) return
        let answer = answers[0] ?? null
        let rank = -1
        for (const item of answers) {
          const next = TIERS.indexOf(item?.tier)
          if (next > rank) {
            answer = item
            rank = next
          }
        }
        setAutoRoute({ text, answer, error: null })
      } catch (err) {
        if (routeReqRef.current !== reqId) return
        setAutoRoute({ text, answer: null, error: err.message || 'Could not route the task.' })
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [client, hasRouteLane, projectLane, projectTask, routeNonce])

  useEffect(() => {
    let alive = true
    async function readNetwork() {
      if (typeof client?.network !== 'function') return
      try {
        const answer = await client.network()
        if (alive && typeof answer?.online === 'boolean') setNetworkOnline(answer.online)
      } catch {}
    }
    function onOnline() {
      setNetworkOnline(true)
    }
    function onOffline() {
      setNetworkOnline(false)
    }
    readNetwork()
    const timer = setInterval(readNetwork, 30000)
    const unsubscribe = subscribeToNotices(client, 'network', readNetwork)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      alive = false
      clearInterval(timer)
      unsubscribe()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [client])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (splitRun.done && !splitDoneRef.current) {
      splitDoneRef.current = true
      if (mountedRef.current) {
        if (!splitRun.failed) {
          setProjectTask('')
          setProjectAllowDirty(false)
        }
        loadRuns()
      }
    } else if (!splitRun.done) {
      splitDoneRef.current = false
    }
  }, [splitRun.done, splitRun.failed])

  async function loadPromptForBrief(briefId, briefObj) {
    const brief = briefObj ?? briefs.find((item) => item.id === briefId)
    if (!brief) return
    const lane = ownerToLane(brief, agents)
    if (!lane) {
      promptReqRef.current += 1
      setNotForAgent(true)
      setPromptLoading(false)
      setPromptError(null)
      setPromptText('')
      setPromptModel('')
      setCopyStatus(null)
      setShowConfirm(false)
      setRunError(null)
      return
    }

    setNotForAgent(false)
    if (typeof client?.briefPrompt !== 'function') {
      setPromptError('Could not load prompt.')
      return
    }

    const reqId = ++promptReqRef.current
    setPromptLoading(true)
    setPromptError(null)
    setPromptText('')
    setPromptModel('')
    setCopyStatus(null)
    setShowConfirm(false)
    setRunError(null)

    try {
      const result = await client.briefPrompt([brief.id], lane)
      if (promptReqRef.current !== reqId) return
      setPromptText(typeof result?.prompt === 'string' ? result.prompt : '')
      setPromptModel(typeof result?.model === 'string' ? result.model : '')
    } catch (err) {
      if (promptReqRef.current !== reqId) return
      setPromptError(err.message || 'Could not load prompt.')
    } finally {
      if (promptReqRef.current === reqId) {
        setPromptLoading(false)
      }
    }
  }

  function pickBrief(id) {
    setSelectedBriefId(id)
    setCopyStatus(null)
    setShowConfirm(false)
    setRunError(null)
    setStartingRun(false)

    if (!id) {
      promptReqRef.current += 1
      setNotForAgent(false)
      setPromptLoading(false)
      setPromptError(null)
      setPromptText('')
      setPromptModel('')
      return
    }

    const brief = briefs.find((item) => item.id === id)
    if (!brief) return

    loadPromptForBrief(id, brief)
  }

  function handleBriefChange(event) {
    setTargetDismissed(true)
    pickBrief(event.target.value)
  }

  const targetResult =
    typeof targetBriefId === 'string' && targetBriefId.trim() && !briefsLoading && !briefsError
      ? briefTarget(briefs, targetBriefId)
      : null

  useEffect(() => {
    if (!targetResult?.brief || loading || loadError || pickedTargetRef.current) return
    pickedTargetRef.current = true
    pickBrief(targetResult.brief.id)
  }, [targetResult?.brief?.id, loading, loadError])

  async function handleConfirmRun() {
    if (!selectedBriefId || !runLane || typeof client?.startRun !== 'function') return
    setStartingRun(true)
    setRunError(null)
    try {
      await client.startRun(runLane, [selectedBriefId])
      setShowConfirm(false)
      loadRuns()
    } catch (err) {
      setRunError(err.message || 'Could not start run.')
    } finally {
      setStartingRun(false)
    }
  }

  function dismissProjectConfirm() {
    setProjectShowConfirm(false)
    setProjectSplitPlan(null)
    setProjectConfirmLane('')
    setProjectNeedsPreview(false)
    if (!splitActive) clearSplitRun()
    setProjectError(null)
  }

  function rememberProjectDraft(patch) {
    if (writeProjectDraft(projectName, patch)) setProjectDraftPresent(true)
  }

  function discardProjectDraft() {
    clearProjectDraft(projectName)
    setProjectTask('')
    setProjectLane(hasRouteLane ? 'auto' : '')
    setProjectCheckCommand('')
    setProjectAllowDirty(false)
    setProjectDiscardConfirm(false)
    setProjectDraftPresent(false)
    dismissProjectConfirm()
  }

  function openProjectConfirm() {
    if (splitActive) return
    const tasks = splitTasks(projectTask)
    if (projectTaskProblem(tasks)) return
    const split = projectOneLanePerTask && tasks.length > 1
    if (!split && (!effectiveLane || projectLaneRunning)) return
    const plan = split ? planLaneTasks(tasks, projectLanes, routeAnswer) : null
    clearSplitRun()
    setProjectSplitPlan(plan)
    setProjectConfirmLane(split ? '' : effectiveLane)
    setProjectNeedsPreview(false)
    setProjectShowConfirm(true)
    setProjectError(null)
    loadProjectGitState()
  }

  async function saveProjectCheckCommand() {
    if (!hasProjectSettings) return true
    try {
      const answer = await client.saveProjectSettings({ checkCommand: projectCheckCommand.trim() })
      if (typeof answer?.checkCommand === 'string') setProjectCheckCommand(answer.checkCommand)
      if (typeof answer?.hasTestScript === 'boolean') setProjectHasTestScript(answer.hasTestScript)
      return true
    } catch (err) {
      setProjectError(err?.message || 'Could not save the check command.')
      return false
    }
  }

  async function handleConfirmProjectRun() {
    if (projectSplitPlan) {
      if (projectSplitPlan.problem || projectSplitPlan.pairs.length === 0) {
        setProjectError(projectSplitPlan.problem || 'Could not plan these tasks.')
        return
      }
      if (typeof client?.startRun !== 'function') return
      setProjectError(null)
      if (!(await saveProjectCheckCommand())) return
      splitProjectRef.current = projectName
      const started = await startSplitRun({ client, pairs: projectSplitPlan.pairs, checkCommand: projectCheckCommand })
      if (!started) {
        splitProjectRef.current = ''
        setProjectError('The split run is already starting.')
        return
      }
      if (!splitRunSnapshot().failed) {
        clearProjectDraft(projectName)
        if (mountedRef.current) setProjectDraftPresent(false)
      }
      return
    }

    const tasks = splitTasks(projectTask)
    const problem = projectTaskProblem(tasks)
    const lane = projectConfirmLane
    const laneRunning = projectLanes.some((item) => item.key === lane && item.running)
    if (projectNeedsPreview) return
    if (laneRunning) {
      if (projectLane === 'auto') {
        setProjectError('That lane is already running. Preview the route again.')
        setAutoRoute({ text: '', answer: null, error: null })
        setProjectNeedsPreview(true)
      } else {
        setProjectError('That lane is already running.')
      }
      return
    }
    if (!lane || problem || typeof client?.startRun !== 'function') {
      if (problem) setProjectError(problem)
      return
    }
    setProjectStarting(true)
    setProjectError(null)
    try {
      if (!(await saveProjectCheckCommand())) return
      const run = projectRunBody({
        task: projectTask,
        tasks,
        allowDirty: projectAllowDirty,
        worktree: projectOwnWorktree,
        checkCommand: projectCheckCommand,
      })
      await client.startRun(lane, run)
      clearProjectDraft(projectName)
      setProjectDraftPresent(false)
      setProjectShowConfirm(false)
      setProjectConfirmLane('')
      setProjectNeedsPreview(false)
      setProjectTask('')
      setProjectAllowDirty(false)
      loadRuns()
    } catch (err) {
      const message = err.message || 'Could not start run.'
      if (message === 'That lane is already running.' && projectLane === 'auto') {
        setProjectError(`${message} Preview the route again.`)
        setAutoRoute({ text: '', answer: null, error: null })
        setProjectNeedsPreview(true)
      } else {
        setProjectError(message)
      }
    } finally {
      setProjectStarting(false)
    }
  }

  async function handleCopyPrompt() {
    if (!promptText) return
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error('Clipboard unavailable')
      }
      await navigator.clipboard.writeText(promptText)
      setCopyStatus({ ok: true, message: 'Copied' })
    } catch {
      if (promptBoxRef.current) {
        promptBoxRef.current.focus()
        promptBoxRef.current.select()
        if (typeof promptBoxRef.current.setSelectionRange === 'function') {
          promptBoxRef.current.setSelectionRange(0, promptText.length)
        }
      }
      setCopyStatus({ ok: false, message: 'Copy failed. Text is selected.' })
    }
  }

  if (loading) {
    return <div className="panel-state mono">Loading dispatch options...</div>
  }

  if (loadError) {
    return (
      <div className="panel-state">
        <div className="panel-error-message">{loadError}</div>
        <button type="button" onClick={loadData}>Retry</button>
      </div>
    )
  }

  const briefGroups = hasBriefs ? groupBriefsByOwner(briefs) : []
  const projectTasks = splitTasks(projectTask)
  const projectQueue = projectTasks.length > 1
  const projectConfirm = projectRunConfirm({
    lane: projectConfirmLane,
    project: projectName,
    task: projectTask,
    tasks: projectTasks,
  })
  const projectProblem = projectTaskProblem(projectTasks)
  const projectSplitRun = projectOneLanePerTask && projectTasks.length > 1
  const projectSplitTaskCount = projectSplitPlan?.pairs.length || projectTasks.length
  const laneAgent = (key) => agents.find((agent) => agent && agent.key === key) ?? null
  const offlineFor = (key) => networkOnline === false && laneNeedsNetwork(laneAgent(key))
  const projectOffline = offlineFor(projectConfirm.lane)
  const splitOffline = Boolean(projectSplitPlan?.pairs?.some((pair) => offlineFor(pair.lane)))
  const briefOffline = offlineFor(runLane)
  const canStartProject =
    typeof client?.startRun === 'function' &&
    !projectProblem &&
    !splitActive &&
    (projectSplitRun || (Boolean(effectiveLane) && !projectLaneRunning))
  const splitProgress = splitRun.pairs.length === 0 ? '' : splitRunProgress(splitRun)
  const splitStopped = splitRun.done && splitRun.cancelled

  return (
    <div className="dispatch-form">
      {!lanesKnown || loading ? null : projectFormLine ? (
        <div className="panel-field project-run-section">
          <div className="brief-state is-dim mono" role="status">{projectFormLine}</div>
        </div>
      ) : (
        <div className="panel-field project-run-section">
          <div className="panel-field-head">
            <label>Run on this project</label>
          </div>

          <div className="panel-field">
            <label htmlFor="project-run-lane">Lane</label>
            <select
              id="project-run-lane"
              value={projectLane}
              disabled={projectSplitRun}
              onChange={(event) => {
                setProjectLane(event.target.value)
                rememberProjectDraft({ lane: event.target.value })
                setProjectDiscardConfirm(false)
                dismissProjectConfirm()
              }}
            >
              {hasRouteLane && <option value="auto">Auto</option>}
              <option value="">Select a lane</option>
              {projectLanes.map((lane) => (
                <option key={lane.key} value={lane.key} disabled={lane.running}>
                  {lane.running ? `${lane.name} running` : lane.name}
                </option>
              ))}
            </select>
            {projectLane === 'auto' && routeAnswer && (
              <div className="brief-state is-dim mono" role="status">
                {`Auto: ${routeAnswer.lane ?? 'no lane'}. ${routeAnswer.reason}`}
              </div>
            )}
            {projectLane === 'auto' && routeError && (
              <div className="brief-state is-dim mono" role="status">
                {`Auto: ${routeError}`}
              </div>
            )}
            {projectLaneRunning && !projectSplitRun && (
              <div className="brief-state is-dim mono">That lane is already running.</div>
            )}
            {projectSplitRun && (
              <div className="brief-state is-dim mono">
                Each task takes the next idle lane, in this order.
              </div>
            )}
          </div>

          <div className="panel-field">
            <div className="panel-field-head">
              <label htmlFor="project-run-task">Task</label>
              {projectDraftPresent && !projectDiscardConfirm && (
                <button
                  type="button"
                  className="brief-cancel-btn"
                  onClick={() => setProjectDiscardConfirm(true)}
                >
                  Discard draft
                </button>
              )}
            </div>
            <textarea
              id="project-run-task"
              rows={4}
              value={projectTask}
              maxLength={PROJECT_QUEUE_TEXT_LIMIT}
              placeholder="What should the agent do in this project? Separate tasks with a line of ---"
              onChange={(event) => {
                const value = event.target.value
                setProjectTask(value)
                rememberProjectDraft({ task: value })
                setProjectDiscardConfirm(false)
                dismissProjectConfirm()
              }}
            />
            {projectDiscardConfirm && (
              <div className="brief-confirm-actions">
                <button type="button" className="brief-cancel-btn" onClick={discardProjectDraft}>
                  Confirm discard
                </button>
                <button
                  type="button"
                  className="brief-cancel-btn"
                  onClick={() => setProjectDiscardConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {hasProjectSettings && (
            <div className="panel-field">
              <label htmlFor="project-run-check">Check command</label>
              <input
                id="project-run-check"
                type="text"
                value={projectCheckCommand}
                maxLength={500}
                placeholder="Empty uses npm test when package.json has one"
                onChange={(event) => {
                  setProjectCheckCommand(event.target.value)
                  rememberProjectDraft({ checkCommand: event.target.value })
                  setProjectDiscardConfirm(false)
                  dismissProjectConfirm()
                }}
              />
              <div className="brief-state is-dim mono">
                Runs after each task; the task is committed only when it passes. Empty uses npm test when package.json has one.
              </div>
            </div>
          )}

          <div className="panel-checkbox-field">
            <label>
              <input
                type="checkbox"
                checked={projectOwnWorktree}
                disabled={projectOneLanePerTask}
                onChange={(event) => {
                  const on = event.target.checked
                  setProjectOwnWorktree(on)
                  if (on) setProjectAllowDirty(false)
                  dismissProjectConfirm()
                }}
              />
              <span>Own worktree</span>
            </label>
          </div>

          <div className="panel-checkbox-field">
            <label>
              <input
                type="checkbox"
                checked={projectOneLanePerTask}
                onChange={(event) => {
                  const on = event.target.checked
                  setProjectOneLanePerTask(on)
                  if (on) {
                    setProjectOwnWorktree(true)
                    setProjectAllowDirty(false)
                  }
                  dismissProjectConfirm()
                }}
              />
              <span>One lane per task</span>
            </label>
          </div>

          {!projectOwnWorktree && (
            <div className="panel-checkbox-field">
              <label>
                <input
                  type="checkbox"
                  checked={projectQueue ? false : projectAllowDirty}
                  disabled={projectQueue}
                  onChange={(event) => {
                    setProjectAllowDirty(event.target.checked)
                    dismissProjectConfirm()
                  }}
                />
                <span>Allow uncommitted changes</span>
              </label>
              {projectQueue && (
                <div className="brief-state is-dim mono">A queue needs a clean project</div>
              )}
            </div>
          )}

          <div className="panel-actions">
            <button
              type="button"
              className="brief-run-btn"
              disabled={!canStartProject}
              onClick={openProjectConfirm}
            >
              {splitActive
                ? 'Starting'
                : projectSplitRun
                  ? projectSplitLabel(projectTasks.length)
                  : projectRunLabel(projectTasks.length)}
            </button>
          </div>

          {splitProgress && (
            <div className="brief-state is-dim mono" role="status">
              {splitProgress}
            </div>
          )}

          {splitActive && !projectShowConfirm && (
            <div className="panel-actions">
              <button
                type="button"
                className="brief-cancel-btn"
                disabled={splitRun.cancelled}
                onClick={cancelSplitRun}
              >
                {splitRun.cancelled ? 'Stopping' : 'Stop'}
              </button>
            </div>
          )}

          {projectShowConfirm && projectSplitPlan && (
            <div className="brief-confirm-card" role="region" aria-label="Confirm project runs">
              <div className="brief-confirm-meta mono">
                <span className="brief-confirm-project">Project: {projectConfirm.project}</span>
                <span className="brief-confirm-tasks">
                  {projectSplitPlan.problem
                    ? `Tasks: ${projectSplitTaskCount}`
                    : `Tasks: ${projectSplitTaskCount} on ${projectSplitTaskCount} lanes`}
                </span>
              </div>
              {projectSplitPlan.problem ? (
                <div className="brief-confirm-error mono" role="alert">
                  {projectSplitPlan.problem}
                </div>
              ) : (
                <div className="runs-list">
                  {projectSplitPlan.pairs.map((pair, index) => {
                    const answer = splitAnswers[index]
                    return (
                      <div
                        key={`split-${pair.lane}-${index}`}
                        className={`runs-entry mono ${answer ? `is-recent ${answer.ok ? 'is-finished' : 'is-failed'}` : 'is-running'}`}
                      >
                        <div className="runs-entry-head mono">
                          <span className="runs-entry-lane">{pair.name}</span>
                          <span className="runs-entry-briefs">
                            {pair.task.slice(0, PROJECT_CONFIRM_LIMIT)}
                          </span>
                        </div>
                        {answer && (
                          <div
                            className="runs-entry-lines mono is-dim"
                            role={answer.ok ? 'status' : 'alert'}
                          >
                            {answer.message}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {!projectSplitPlan.problem && (
                <>
                  <div className="brief-confirm-warning">
                    {projectCheckLine({ checkCommand: projectCheckCommand, hasTestScript: projectHasTestScript })}
                  </div>
                  <div className="brief-confirm-warning">
                    {projectSplitWorktreeLine(projectGitState)}
                  </div>
                  <div className="brief-confirm-warning">
                    This starts {projectSplitTaskCount} agents on this computer three seconds apart and spends money.
                  </div>
                  {splitOffline && (
                    <div className="brief-confirm-warning" role="status">
                      There is no connection, so this agent will likely fail.
                    </div>
                  )}
                </>
              )}
              <div className="brief-confirm-actions">
                {splitActive && (
                  <button
                    type="button"
                    className="brief-cancel-btn"
                    disabled={splitRun.cancelled}
                    onClick={cancelSplitRun}
                  >
                    {splitRun.cancelled ? 'Stopping' : 'Stop'}
                  </button>
                )}
                <button
                  type="button"
                  className="brief-confirm-btn"
                  disabled={
                    splitActive ||
                    splitStopped ||
                    Boolean(projectSplitPlan.problem) ||
                    splitAnswers.length >= projectSplitPlan.pairs.length
                  }
                  onClick={handleConfirmProjectRun}
                >
                  {splitActive
                    ? 'Starting'
                    : splitStopped
                      ? 'Stopped'
                      : splitAnswers.length >= projectSplitPlan.pairs.length &&
                          projectSplitPlan.pairs.length > 0
                        ? 'Done'
                        : 'Confirm'}
                </button>
                <button
                  type="button"
                  className="brief-cancel-btn"
                  disabled={splitActive}
                  onClick={dismissProjectConfirm}
                >
                  {splitAnswers.length > 0 ? 'Close' : 'Cancel'}
                </button>
              </div>
              {projectError && (
                <div className="brief-confirm-error mono" role="alert">
                  {projectError}
                </div>
              )}
            </div>
          )}

          {projectShowConfirm && !projectSplitPlan && (
            <div className="brief-confirm-card" role="region" aria-label="Confirm project run">
              <div className="brief-confirm-meta mono">
                <span className="brief-confirm-lane">Lane: {projectConfirm.lane}</span>
                <span className="brief-confirm-project">Project: {projectConfirm.project}</span>
                {projectQueue ? (
                  <span className="brief-confirm-tasks">Tasks: {projectConfirm.count} in order</span>
                ) : (
                  <span className="brief-confirm-task">Task: {projectConfirm.task}</span>
                )}
              </div>
              {projectLane === 'auto' && routeAnswer && (
                <div className="brief-confirm-warning">
                  {`Picked by the routing policy: ${routeAnswer.reason}`}
                </div>
              )}
              <div className="brief-confirm-warning">
                {projectCheckLine({ checkCommand: projectCheckCommand, hasTestScript: projectHasTestScript })}
              </div>
              {projectOwnWorktree && (
                <div className="brief-confirm-warning">
                  {projectWorktreeLine({ lane: projectConfirm.lane, gitState: projectGitState })}
                </div>
              )}
              {projectQueue && (
                <div className="brief-confirm-warning">
                  The tasks run one after another on a new branch
                  {projectOwnWorktree ? ' in its own worktree' : ' in the project'}, each committed when the
                  project's tests pass, stopping at the first failure, and never pushed.
                </div>
              )}
              <div className="brief-confirm-warning">
                This starts the agent on this computer and spends money.
              </div>
              {projectOffline && (
                <div className="brief-confirm-warning" role="status">
                  There is no connection, so this agent will likely fail.
                </div>
              )}
              <div className="brief-confirm-actions">
                <button
                  type="button"
                  className="brief-confirm-btn"
                  disabled={projectStarting || projectNeedsPreview}
                  onClick={handleConfirmProjectRun}
                >
                  {projectStarting ? 'Starting' : 'Confirm'}
                </button>
                {projectNeedsPreview && (
                  <button
                    type="button"
                    className="brief-cancel-btn"
                    onClick={() => {
                      dismissProjectConfirm()
                      setRouteNonce((count) => count + 1)
                    }}
                  >
                    Preview again
                  </button>
                )}
                <button
                  type="button"
                  className="brief-cancel-btn"
                  disabled={projectStarting}
                  onClick={() => {
                    const refresh = projectNeedsPreview
                    dismissProjectConfirm()
                    if (refresh) setRouteNonce((count) => count + 1)
                  }}
                >
                  Cancel
                </button>
              </div>
              {projectError && (
                <div className="brief-confirm-error mono" role="alert">
                  {projectError}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {hasBriefs && (
        <div className="panel-field brief-section">
          <label htmlFor="dispatch-brief">Brief</label>
          {briefsLoading ? (
            <div className="brief-state mono" role="status">Loading briefs...</div>
          ) : briefsError ? (
            <div className="brief-error-row" role="alert">
              <span className="panel-error-message">{briefsError}</span>
              <button type="button" onClick={loadBriefs}>Retry</button>
            </div>
          ) : briefGroups.length === 0 ? (
            <div className="brief-state is-dim mono">No open briefs.</div>
          ) : (
            <select
              id="dispatch-brief"
              value={selectedBriefId}
              onChange={handleBriefChange}
            >
              <option value="">Select a brief</option>
              {briefGroups.map((group) => (
                <optgroup key={group.owner} label={group.label}>
                  {group.briefs.map((brief) => (
                    <option key={brief.id} value={brief.id}>
                      {formatBriefTitle(brief)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}

          {targetResult?.problem && !targetDismissed && (
            <div className="brief-target-problem mono" role="alert">
              {targetResult.problem}
            </div>
          )}

          {notForAgent && (
            <div className="brief-state is-dim mono" role="status">
              This brief is not for an agent
            </div>
          )}

          {promptLoading && (
            <div className="brief-state mono" role="status">
              Loading prompt...
            </div>
          )}

          {promptError && (
            <div className="brief-error-row" role="alert">
              <span className="panel-error-message">{promptError}</span>
              {selectedBriefId && (
                <button type="button" onClick={() => loadPromptForBrief(selectedBriefId)}>
                  Retry
                </button>
              )}
            </div>
          )}

          {!promptLoading && !promptError && !notForAgent && selectedBriefId && !promptText && (
            <div className="brief-state is-dim mono">No prompt available.</div>
          )}

          {!promptLoading && !promptError && !notForAgent && promptText && (
            <div className="brief-prompt-area">
              <textarea
                ref={promptBoxRef}
                id="dispatch-brief-prompt"
                className="brief-prompt-box mono"
                rows={5}
                value={promptText}
                readOnly
                aria-label="Brief prompt"
              />
              <div className="brief-prompt-actions">
                <button type="button" onClick={handleCopyPrompt}>
                  Copy prompt
                </button>
                {canRunBrief && (
                  <button
                    type="button"
                    className="brief-run-btn"
                    onClick={() => {
                      setShowConfirm(true)
                      setRunError(null)
                    }}
                  >
                    Run now
                  </button>
                )}
                {copyStatus && (
                  <span
                    className={`brief-copy-status mono ${copyStatus.ok ? 'is-ok' : 'is-error'}`}
                    role="status"
                  >
                    {copyStatus.message}
                  </span>
                )}
              </div>
              {showConfirm && (
                <div className="brief-confirm-card" role="region" aria-label="Confirm run">
                  <div className="brief-confirm-meta mono">
                    <span className="brief-confirm-lane">Lane: {runLane}</span>
                    <span className="brief-confirm-model">Model: {promptModel || 'Default model'}</span>
                    <span className="brief-confirm-id">Brief: {selectedBriefId}</span>
                  </div>
                  <div className="brief-confirm-warning">
                    This starts the agent on this computer and spends money.
                  </div>
                  {briefOffline && (
                    <div className="brief-confirm-warning" role="status">
                      There is no connection, so this agent will likely fail.
                    </div>
                  )}
                  <div className="brief-confirm-actions">
                    <button
                      type="button"
                      className="brief-confirm-btn"
                      disabled={startingRun}
                      onClick={handleConfirmRun}
                    >
                      {startingRun ? 'Starting' : 'Confirm'}
                    </button>
                    <button
                      type="button"
                      className="brief-cancel-btn"
                      disabled={startingRun}
                      onClick={() => {
                        setShowConfirm(false)
                        setRunError(null)
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  {runError && (
                    <div className="brief-confirm-error mono" role="alert">
                      {runError}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {hasRuns && (
        <div className="panel-field runs-section">
          <div className="panel-field-head">
            <label>Runs</label>
            <button
              type="button"
              className="runs-refresh-btn"
              onClick={loadRuns}
            >
              Refresh
            </button>
          </div>

          {runsLoading ? (
            <div className="runs-state mono" role="status">Loading runs...</div>
          ) : runsError ? (
            <div className="runs-error-row" role="alert">
              <span className="panel-error-message">{runsError}</span>
              <button type="button" onClick={loadRuns}>Retry</button>
            </div>
          ) : runsState.running.length === 0 && runsState.recent.length === 0 ? (
            <div className="runs-state is-dim mono">No runs yet.</div>
          ) : (
            <div className="runs-list">
              {runsState.running.map((entry, index) => {
                const rowConfirmOpen =
                  stopTarget &&
                  stopTarget.lane === entry.lane &&
                  stopTarget.startedAt === entry.startedAt
                const rowWork = runWorkText(entry)
                const workField =
                  Array.isArray(entry.briefs) && entry.briefs.length > 0 ? 'Briefs' : 'Task'
                return (
                  <div
                    key={`running-${entry.lane}-${entry.startedAt || index}`}
                    className="runs-entry is-running"
                  >
                    <div className="runs-entry-head mono">
                      <span className="runs-entry-lane">{entry.lane}</span>
                      <span className="runs-entry-briefs">{rowWork}</span>
                      <span className="runs-entry-time">{timeSinceStart(entry.startedAt)}</span>
                      {canStopRun && entry.startedAt && (
                        <button
                          type="button"
                          className="brief-cancel-btn"
                          disabled={stoppingRun || rowConfirmOpen}
                          onClick={() => openStopConfirm(entry)}
                        >
                          Stop
                        </button>
                      )}
                    </div>
                    {rowConfirmOpen && (
                      <div
                        className="brief-confirm-card"
                        role="region"
                        aria-label={`Confirm stop ${entry.lane}`}
                      >
                        <div className="brief-confirm-meta mono">
                          <span className="brief-confirm-lane">Lane: {entry.lane}</span>
                          <span className="brief-confirm-model">{workField}: {rowWork}</span>
                          <span className="brief-confirm-id">Started: {stopStartedLabel(entry.startedAt)}</span>
                        </div>
                        <div className="brief-confirm-warning">
                          This stops the running lane and tells its orchestrator.
                        </div>
                        <div className="brief-confirm-actions">
                          <button
                            type="button"
                            className="brief-confirm-btn"
                            disabled={stoppingRun}
                            onClick={() => handleConfirmStop(entry)}
                          >
                            {stoppingRun ? 'Stopping' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            className="brief-cancel-btn"
                            disabled={stoppingRun}
                            onClick={() => {
                              setStopTarget(null)
                              setStopError(null)
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                        {stopError && (
                          <div className="brief-confirm-error mono" role="alert">
                            {stopError}
                          </div>
                        )}
                      </div>
                    )}
                    {Array.isArray(entry.lastLines) && entry.lastLines.length > 0 && (
                      <pre className="runs-entry-lines mono is-dim">
                        {entry.lastLines.join('\n')}
                      </pre>
                    )}
                  </div>
                )
              })}
              {runsState.recent.map((record, index) => {
                const key = `recent-${record.lane}-${record.startedAt || index}`
                const canRecover = hasOrchestrator && queueRecoveryAvailable(record)
                const plan = canRecover ? queueRecoveryPlan(record, { project: projectName }) : null
                const status = recoveryStatus[key]
                const failedLine = plan
                  ? (plan.number !== null
                    ? `Task ${plan.number}: ${plan.firstLine || 'the record does not hold the failed task.'}`
                    : `Failed task: ${plan.firstLine || 'the record does not hold it.'}`)
                  : ''
                const remainingLine = plan
                  ? (plan.remainingCount !== null
                    ? `${plan.remainingCount} task${plan.remainingCount === 1 ? '' : 's'} did not run.`
                    : 'The record does not say which tasks did not run.')
                  : ''
                return (
                  <div
                    key={key}
                    className={`runs-entry is-recent mono is-${resultWord(record)}`}
                  >
                    {recordLine(record)}
                    {canRecover && (
                      <div className="brief-confirm-actions">
                        <button
                          type="button"
                          className="brief-run-btn"
                          onClick={() => openQueueRecovery(key)}
                        >
                          Ask for recovery
                        </button>
                      </div>
                    )}
                    {canRecover && recoveryKey === key && (
                      <div className="brief-confirm-card" role="region" aria-label="Confirm recovery message">
                        <div className="brief-confirm-meta mono">
                          <span className="brief-confirm-lane">Lane: {plan.lane}</span>
                          <span className="brief-confirm-model">Project: {plan.project}</span>
                          <span className="brief-confirm-id">Queue branch: {plan.branch || 'not in the record'}</span>
                        </div>
                        <div className="brief-confirm-warning">{failedLine}</div>
                        <div className="brief-confirm-warning">{remainingLine}</div>
                        {plan.missing.length > 0 && (
                          <div className="brief-confirm-warning" role="status">
                            Missing from the record: {plan.missing.join(', ')}.
                          </div>
                        )}
                        <div className="brief-confirm-warning">
                          This sends one message to Main. It does not discard changes or rerun the queue.
                        </div>
                        <div className="brief-confirm-actions">
                          <button
                            type="button"
                            className="brief-confirm-btn"
                            disabled={recoverySending}
                            onClick={() => sendQueueRecovery(record, key)}
                          >
                            {recoverySending ? 'Sending' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            className="brief-cancel-btn"
                            disabled={recoverySending}
                            onClick={() => setRecoveryKey('')}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {status && (
                      <div
                        className={`brief-copy-status mono ${status.ok ? 'is-ok' : 'is-error'}`}
                        role={status.ok ? 'status' : 'alert'}
                      >
                        {status.message}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
