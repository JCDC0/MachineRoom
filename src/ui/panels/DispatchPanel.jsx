import { useEffect, useRef, useState } from 'react'
import {
  briefTarget,
  chooseAssignee,
  formatBriefTitle,
  groupBriefsByOwner,
  ownerToLane,
  runLaneFor,
  VALID_LANES,
} from './briefs.js'
import { modelsFor, resetModel } from './dispatchModels.js'
import { subscribeToNotices } from './notices.js'
import { agentForLane, routeFields } from './route.js'
import { PROJECT_QUEUE_TEXT_LIMIT, projectRunConfirm, projectRunLabel, projectRunLanes, projectTaskProblem, recordLine, resultWord, splitTasks, timeSinceStart } from './runs.js'
import { profileFromBrief } from '../../policy/profile.js'

export default function DispatchPanel({
  client,
  onCreated,
  targetBriefId,
  initialAgents,
  initialModels,
  initialAssigneeAgentId,
  initialModel,
  initialBriefs,
  initialSelectedBriefId,
  initialRouteAnswer,
  initialRouteLoading,
  initialRouteError,
  initialRouteNote,
}) {
  const [targetDismissed, setTargetDismissed] = useState(false)
  const pickedTargetRef = useRef(false)
  const [agents, setAgents] = useState(() => (Array.isArray(initialAgents) ? initialAgents : []))
  const [models, setModels] = useState(() => (Array.isArray(initialModels) ? initialModels : []))
  const [loading, setLoading] = useState(
    () => !(Array.isArray(initialAgents) && Array.isArray(initialModels))
  )
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

  const [routeLoading, setRouteLoading] = useState(() => Boolean(initialRouteLoading))
  const [routeError, setRouteError] = useState(() => initialRouteError || null)
  const [routeAnswer, setRouteAnswer] = useState(() => initialRouteAnswer || null)
  const [routeNote, setRouteNote] = useState(() => initialRouteNote || null)

  const [runsState, setRunsState] = useState({ running: [], recent: [] })
  const [runsLoading, setRunsLoading] = useState(() => typeof client?.runs === 'function')
  const [runsError, setRunsError] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [lanesMode, setLanesMode] = useState(false)
  const [projectLane, setProjectLane] = useState('')
  const [projectTask, setProjectTask] = useState('')
  const [projectAllowDirty, setProjectAllowDirty] = useState(false)
  const [projectShowConfirm, setProjectShowConfirm] = useState(false)
  const [projectStarting, setProjectStarting] = useState(false)
  const [projectError, setProjectError] = useState(null)

  const promptReqRef = useRef(0)
  const promptBoxRef = useRef(null)
  const routeReqRef = useRef(0)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeAgentId, setAssigneeAgentId] = useState(() => initialAssigneeAgentId || '')
  const [model, setModel] = useState(() => initialModel || '')
  const [priority, setPriority] = useState('')
  const [maxTurnsPerRun, setMaxTurnsPerRun] = useState('')
  const [timeoutSec, setTimeoutSec] = useState('')
  const [subagentsAllowed, setSubagentsAllowed] = useState(false)

  const [fieldErrors, setFieldErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [createdIdentifier, setCreatedIdentifier] = useState(null)

  const hasBriefs = typeof client?.briefs === 'function'
  const hasRuns = typeof client?.runs === 'function'

  const selectedBrief = briefs.find((item) => item.id === selectedBriefId)
  const runLane = selectedBrief ? runLaneFor(selectedBrief, runsState.running, VALID_LANES) : null
  const canRunBrief = typeof client?.startRun === 'function' && Boolean(runLane)

  async function loadData() {
    if (!client || (Array.isArray(initialAgents) && Array.isArray(initialModels))) return
    setLoading(true)
    setLoadError(null)
    try {
      const [agentList, modelList] = await Promise.all([
        client.agents(),
        client.models(),
      ])
      setAgents(agentList)
      setModels(modelList)
    } catch (err) {
      setLoadError(err.message || 'Could not load options.')
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
      setProjectName(typeof data?.project === 'string' ? data.project : '')
    } catch (err) {
      setRunsError(err.message || 'Could not load runs.')
    } finally {
      setRunsLoading(false)
    }
  }

  async function refreshAgents() {
    try {
      const agentList = await client.agents()
      setAgents(agentList)
    } catch {
      return
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
      if (typeof client?.health !== 'function') {
        if (alive) setLanesMode(false)
        return
      }
      try {
        const health = await client.health()
        if (alive) setLanesMode(health?.lanes === true)
      } catch {
        if (alive) setLanesMode(false)
      }
    }
    loadHealth()
    return () => {
      alive = false
    }
  }, [client])

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
    if (loading || !model) return
    const currentAgent = agents.find((item) => item.id === assigneeAgentId) || null
    const nextModel = resetModel(currentAgent, model, models)
    if (nextModel !== model) {
      setModel(nextModel)
    }
  }, [loading, assigneeAgentId, agents, models, model])

  async function loadPromptForBrief(briefId, briefObj) {
    const brief = briefObj ?? briefs.find((item) => item.id === briefId)
    if (!brief) return
    const lane = ownerToLane(brief)
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

  async function loadRouteForBrief(brief) {
    if (!brief) return
    const reqId = ++routeReqRef.current
    setRouteLoading(true)
    setRouteError(null)
    setRouteAnswer(null)
    setRouteNote(null)

    if (typeof client?.suggestRoute !== 'function') {
      setRouteLoading(false)
      setRouteError('Could not suggest route.')
      return
    }

    try {
      const profile = profileFromBrief(brief)
      const result = await client.suggestRoute(profile)
      if (routeReqRef.current !== reqId) return
      setRouteAnswer(result)
    } catch (err) {
      if (routeReqRef.current !== reqId) return
      setRouteError(err.message || 'Could not suggest route.')
    } finally {
      if (routeReqRef.current === reqId) {
        setRouteLoading(false)
      }
    }
  }

  function handleUseRoute() {
    if (!routeAnswer?.choice) return
    const { agentId, model: nextModel, note } = routeFields(routeAnswer.choice, agents, models)
    if (agentId) {
      setAssigneeAgentId(agentId)
      if (fieldErrors.agent) {
        setFieldErrors((prev) => ({ ...prev, agent: null }))
      }
    }
    if (nextModel !== null && nextModel !== undefined) {
      setModel(nextModel)
    }
    setRouteNote(note || null)
  }

  function pickBrief(id) {
    setSelectedBriefId(id)
    setCopyStatus(null)
    setShowConfirm(false)
    setRunError(null)
    setStartingRun(false)
    setRouteNote(null)

    if (!id) {
      promptReqRef.current += 1
      routeReqRef.current += 1
      setNotForAgent(false)
      setPromptLoading(false)
      setPromptError(null)
      setPromptText('')
      setPromptModel('')
      setRouteLoading(false)
      setRouteError(null)
      setRouteAnswer(null)
      return
    }

    const brief = briefs.find((item) => item.id === id)
    if (!brief) return

    const nextTitle = formatBriefTitle(brief)
    setTitle(nextTitle)
    if (nextTitle && fieldErrors.title) {
      setFieldErrors((prev) => ({ ...prev, title: null }))
    }

    const matchedAssignee = chooseAssignee(brief, agents)
    setAssigneeAgentId(matchedAssignee)
    if (matchedAssignee && fieldErrors.agent) {
      setFieldErrors((prev) => ({ ...prev, agent: null }))
    }
    const nextAgent = agents.find((item) => item.id === matchedAssignee) || null
    setModel((prevModel) => resetModel(nextAgent, prevModel, models))

    loadPromptForBrief(id, brief)
    loadRouteForBrief(brief)
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
  })

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

  function openProjectConfirm() {
    const tasks = splitTasks(projectTask)
    if (!projectLane || projectTaskProblem(tasks)) return
    setProjectShowConfirm(true)
    setProjectError(null)
  }

  async function handleConfirmProjectRun() {
    const tasks = splitTasks(projectTask)
    const problem = projectTaskProblem(tasks)
    if (!projectLane || problem || typeof client?.startRun !== 'function') {
      if (problem) setProjectError(problem)
      return
    }
    setProjectStarting(true)
    setProjectError(null)
    try {
      if (tasks.length > 1) {
        await client.startRun(projectLane, { tasks })
      } else {
        await client.startRun(projectLane, { task: projectTask, allowDirty: projectAllowDirty })
      }
      setProjectShowConfirm(false)
      setProjectTask('')
      setProjectAllowDirty(false)
      loadRuns()
    } catch (err) {
      setProjectError(err.message || 'Could not start run.')
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

  function handleUseAsDescription() {
    if (!promptText) return
    setDescription(promptText)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitError(null)
    setCreatedIdentifier(null)

    const errors = {}
    if (!title.trim()) {
      errors.title = 'A title is required.'
    }
    if (!assigneeAgentId) {
      errors.agent = 'Choose an agent for this task.'
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setSubmitError('Please complete all required fields.')
      return
    }
    setFieldErrors({})

    setSubmitting(true)
    try {
      const draft = {
        title: title.trim(),
        assigneeAgentId,
      }
      if (description.trim()) draft.description = description.trim()
      if (priority) draft.priority = priority
      if (model) draft.model = model
      if (maxTurnsPerRun !== '') {
        const turns = parseInt(maxTurnsPerRun, 10)
        if (!Number.isNaN(turns) && turns > 0) draft.maxTurnsPerRun = turns
      }
      if (timeoutSec !== '') {
        const timeout = parseInt(timeoutSec, 10)
        if (!Number.isNaN(timeout) && timeout > 0) draft.timeoutSec = timeout
      }
      if (subagentsAllowed) {
        draft.subagentsAllowed = true
      }

      const created = await client.createIssue(draft)
      setCreatedIdentifier(created.identifier)
      setSelectedBriefId('')
      setPromptText('')
      setPromptModel('')
      setShowConfirm(false)
      setRunError(null)
      setStartingRun(false)
      setPromptError(null)
      setPromptLoading(false)
      setNotForAgent(false)
      setCopyStatus(null)
      setRouteLoading(false)
      setRouteError(null)
      setRouteAnswer(null)
      setRouteNote(null)
      routeReqRef.current += 1
      setTitle('')
      setDescription('')
      setAssigneeAgentId('')
      setModel('')
      setPriority('')
      setMaxTurnsPerRun('')
      setTimeoutSec('')
      setSubagentsAllowed(false)
      setFieldErrors({})
      onCreated?.(created)
    } catch (err) {
      const message = err.message || 'Could not start task.'
      setSubmitError(message)
      if (/title/i.test(message)) {
        setFieldErrors((prev) => ({ ...prev, title: message }))
      } else if (/agent/i.test(message)) {
        setFieldErrors((prev) => ({ ...prev, agent: message }))
      }
    } finally {
      setSubmitting(false)
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

  if (agents.length === 0) {
    return <div className="panel-state">No agents available to assign.</div>
  }

  const briefGroups = hasBriefs ? groupBriefsByOwner(briefs) : []
  const selectedAgent = agents.find((item) => item.id === assigneeAgentId) || null
  const offeredModels = modelsFor(selectedAgent, models)
  const defaultOption = offeredModels[0]
  const availableModels = offeredModels.slice(1)
  const smallModels = availableModels.filter((item) => item.tier === 'small')
  const mediumModels = availableModels.filter((item) => item.tier === 'medium')
  const largeModels = availableModels.filter((item) => item.tier === 'large')
  const otherModels = availableModels.filter(
    (item) => !item.tier || !['small', 'medium', 'large'].includes(item.tier)
  )
  const projectLanes = projectRunLanes(agents)
  const projectTasks = splitTasks(projectTask)
  const projectQueue = projectTasks.length > 1
  const projectConfirm = projectRunConfirm({
    lane: projectLane,
    project: projectName,
    task: projectTask,
    tasks: projectTasks,
  })
  const projectProblem = projectTaskProblem(projectTasks)
  const canStartProject = typeof client?.startRun === 'function' && Boolean(projectLane) && !projectProblem

  return (
    <form className="dispatch-form" onSubmit={handleSubmit} noValidate>
      {createdIdentifier && (
        <div className="panel-banner is-success" role="status">
          Created task {createdIdentifier}.
        </div>
      )}

      {submitError && (
        <div className="panel-banner is-error" role="alert">
          {submitError}
        </div>
      )}

      {lanesMode && projectLanes.length > 0 && (
        <div className="panel-field project-run-section">
          <div className="panel-field-head">
            <label>Run on this project</label>
          </div>

          <div className="panel-field">
            <label htmlFor="project-run-lane">Lane</label>
            <select
              id="project-run-lane"
              value={projectLane}
              onChange={(event) => {
                setProjectLane(event.target.value)
                setProjectShowConfirm(false)
                setProjectError(null)
              }}
            >
              <option value="">Select a lane</option>
              {projectLanes.map((lane) => (
                <option key={lane.key} value={lane.key}>
                  {lane.name}
                </option>
              ))}
            </select>
          </div>

          <div className="panel-field">
            <label htmlFor="project-run-task">Task</label>
            <textarea
              id="project-run-task"
              rows={4}
              value={projectTask}
              maxLength={PROJECT_QUEUE_TEXT_LIMIT}
              placeholder="What should the agent do in this project? Separate tasks with a line of ---"
              onChange={(event) => {
                setProjectTask(event.target.value)
                setProjectShowConfirm(false)
                setProjectError(null)
              }}
            />
          </div>

          <div className="panel-checkbox-field">
            <label>
              <input
                type="checkbox"
                checked={projectQueue ? false : projectAllowDirty}
                disabled={projectQueue}
                onChange={(event) => {
                  setProjectAllowDirty(event.target.checked)
                  setProjectShowConfirm(false)
                  setProjectError(null)
                }}
              />
              <span>Allow uncommitted changes</span>
            </label>
            {projectQueue && (
              <div className="brief-state is-dim mono">A queue needs a clean project</div>
            )}
          </div>

          <div className="panel-actions">
            <button
              type="button"
              className="brief-run-btn"
              disabled={!canStartProject}
              onClick={openProjectConfirm}
            >
              {projectRunLabel(projectTasks.length)}
            </button>
          </div>

          {projectShowConfirm && (
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
              {projectQueue && (
                <div className="brief-confirm-warning">
                  The tasks run one after another on a new branch in the project, each committed when the
                  project's tests pass, stopping at the first failure, never on main and never pushed.
                </div>
              )}
              <div className="brief-confirm-warning">
                This starts the agent on this computer and spends money.
              </div>
              <div className="brief-confirm-actions">
                <button
                  type="button"
                  className="brief-confirm-btn"
                  disabled={projectStarting}
                  onClick={handleConfirmProjectRun}
                >
                  {projectStarting ? 'Starting' : 'Confirm'}
                </button>
                <button
                  type="button"
                  className="brief-cancel-btn"
                  disabled={projectStarting}
                  onClick={() => {
                    setProjectShowConfirm(false)
                    setProjectError(null)
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
                <button type="button" onClick={handleUseAsDescription}>
                  Use as description
                </button>
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
              {runsState.running.map((entry, index) => (
                <div
                  key={`running-${entry.lane}-${entry.startedAt || index}`}
                  className="runs-entry is-running"
                >
                  <div className="runs-entry-head mono">
                    <span className="runs-entry-lane">{entry.lane}</span>
                    <span className="runs-entry-briefs">
                      {entry.queue
                        ? `${entry.tasks} task${entry.tasks === 1 ? '' : 's'} in order`
                        : Array.isArray(entry.briefs) && entry.briefs.length > 0
                          ? entry.briefs.join(' ')
                          : 'none'}
                    </span>
                    <span className="runs-entry-time">{timeSinceStart(entry.startedAt)}</span>
                  </div>
                  {Array.isArray(entry.lastLines) && entry.lastLines.length > 0 && (
                    <pre className="runs-entry-lines mono is-dim">
                      {entry.lastLines.join('\n')}
                    </pre>
                  )}
                </div>
              ))}
              {runsState.recent.map((record, index) => (
                <div
                  key={`recent-${record.lane}-${record.startedAt || index}`}
                  className={`runs-entry is-recent mono is-${resultWord(record)}`}
                >
                  {recordLine(record)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="panel-field">
        <div className="panel-field-head">
          <label htmlFor="dispatch-title">Title</label>
          {fieldErrors.title && (
            <span className="field-error mono">{fieldErrors.title}</span>
          )}
        </div>
        <input
          id="dispatch-title"
          type="text"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            if (fieldErrors.title) {
              setFieldErrors((prev) => ({ ...prev, title: null }))
            }
          }}
          placeholder="Brief task summary"
          aria-invalid={Boolean(fieldErrors.title)}
          required
        />
      </div>

      <div className="panel-field">
        <label htmlFor="dispatch-description">Description</label>
        <textarea
          id="dispatch-description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Detailed task instructions"
        />
      </div>

      <div className="panel-field">
        <div className="panel-field-head">
          <label htmlFor="dispatch-agent">Agent</label>
          {fieldErrors.agent && (
            <span className="field-error mono">{fieldErrors.agent}</span>
          )}
        </div>
        <select
          id="dispatch-agent"
          value={assigneeAgentId}
          onChange={(event) => {
            const nextAgentId = event.target.value
            setAssigneeAgentId(nextAgentId)
            if (fieldErrors.agent) {
              setFieldErrors((prev) => ({ ...prev, agent: null }))
            }
            const nextAgent = agents.find((item) => item.id === nextAgentId) || null
            setModel((prevModel) => resetModel(nextAgent, prevModel, models))
          }}
          aria-invalid={Boolean(fieldErrors.agent)}
          required
        >
          <option value="">Select an agent</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name} ({agent.role})
            </option>
          ))}
        </select>
      </div>

      {selectedBriefId && (
        <div className="panel-field dispatch-route-row">
          <label>Route</label>
          {routeLoading || (!routeError && !routeAnswer) ? (
            <div className="dispatch-route-state mono" role="status">
              Reading the policy.
            </div>
          ) : routeError ? (
            <div className="dispatch-route-error mono" role="alert">
              {routeError}
            </div>
          ) : !routeAnswer?.choice ? (
            <div className="dispatch-route-error mono" role="alert">
              {routeAnswer?.reason}
            </div>
          ) : routeAnswer.choice.lane === 'owner' ? (
            <div className="dispatch-route-card">
              <span className="dispatch-route-reason mono">{routeAnswer.reason}</span>
            </div>
          ) : (
            <div className="dispatch-route-card">
              <div className="dispatch-route-main">
                <span className="dispatch-route-reason mono">{routeAnswer.reason}</span>
                <button
                  type="button"
                  className="dispatch-route-use-btn"
                  onClick={handleUseRoute}
                >
                  Use
                </button>
              </div>
              {routeNote && (
                <div className="dispatch-route-note mono" role="status">
                  {routeNote}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="panel-field">
        <label htmlFor="dispatch-model">Model</label>
        <select
          id="dispatch-model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
        >
          <option value="">{defaultOption?.label || 'Default model'}</option>
          {smallModels.length > 0 && (
            <optgroup label="Small">
              {smallModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.free && !item.label.toLowerCase().includes('free') ? ' (free)' : ''}
                </option>
              ))}
            </optgroup>
          )}
          {mediumModels.length > 0 && (
            <optgroup label="Medium">
              {mediumModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.free && !item.label.toLowerCase().includes('free') ? ' (free)' : ''}
                </option>
              ))}
            </optgroup>
          )}
          {largeModels.length > 0 && (
            <optgroup label="Large">
              {largeModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.free && !item.label.toLowerCase().includes('free') ? ' (free)' : ''}
                </option>
              ))}
            </optgroup>
          )}
          {otherModels.length > 0 &&
            (smallModels.length > 0 || mediumModels.length > 0 || largeModels.length > 0 ? (
              <optgroup label="Other">
                {otherModels.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                    {item.free && !item.label.toLowerCase().includes('free') ? ' (free)' : ''}
                  </option>
                ))}
              </optgroup>
            ) : (
              otherModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.free && !item.label.toLowerCase().includes('free') ? ' (free)' : ''}
                </option>
              ))
            ))}
        </select>
      </div>

      <div className="panel-field">
        <label htmlFor="dispatch-priority">Priority</label>
        <select
          id="dispatch-priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
        >
          <option value="">Default (medium)</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      <details className="panel-limits">
        <summary>Limits</summary>
        <div className="panel-limits-fields">
          <div className="panel-field">
            <label htmlFor="dispatch-turns">Max turns</label>
            <input
              id="dispatch-turns"
              type="number"
              min="1"
              value={maxTurnsPerRun}
              onChange={(event) => setMaxTurnsPerRun(event.target.value)}
              placeholder="Default"
            />
          </div>
          <div className="panel-field">
            <label htmlFor="dispatch-timeout">Timeout (seconds)</label>
            <input
              id="dispatch-timeout"
              type="number"
              min="1"
              value={timeoutSec}
              onChange={(event) => setTimeoutSec(event.target.value)}
              placeholder="Default"
            />
          </div>
          <div className="panel-checkbox-field">
            <label>
              <input
                type="checkbox"
                checked={subagentsAllowed}
                onChange={(event) => setSubagentsAllowed(event.target.checked)}
              />
              <span>Subagents allowed</span>
            </label>
          </div>
        </div>
      </details>

      <div className="panel-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? 'Starting task...' : 'Start task'}
        </button>
      </div>
    </form>
  )
}
