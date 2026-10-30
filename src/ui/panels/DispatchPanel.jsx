import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  briefTarget,
  formatBriefTitle,
  groupBriefsByOwner,
  ownerToLane,
  runLaneFor,
  VALID_LANES,
} from './briefs.js'
import { subscribeToNotices } from './notices.js'
import { PROJECT_CONFIRM_LIMIT, PROJECT_QUEUE_TEXT_LIMIT, clearSplitRun, planLaneTasks, projectRunBody, projectRunConfirm, projectRunLabel, projectRunLanes, projectSplitLabel, projectTaskProblem, projectWorktreeName, recordLine, resultWord, splitRunSnapshot, splitTasks, startSplitRun, subscribeSplitRun, timeSinceStart } from './runs.js'

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
  const [projectName, setProjectName] = useState('')
  const [lanesMode, setLanesMode] = useState(false)
  const [projectLane, setProjectLane] = useState('')
  const [projectTask, setProjectTask] = useState('')
  const [projectOwnWorktree, setProjectOwnWorktree] = useState(true)
  const [projectOneLanePerTask, setProjectOneLanePerTask] = useState(false)
  const [projectAllowDirty, setProjectAllowDirty] = useState(false)
  const [projectShowConfirm, setProjectShowConfirm] = useState(false)
  const [projectSplitPlan, setProjectSplitPlan] = useState(null)
  const [projectStarting, setProjectStarting] = useState(false)
  const [projectError, setProjectError] = useState(null)

  const splitRun = useSyncExternalStore(subscribeSplitRun, splitRunSnapshot, splitRunSnapshot)
  const splitAnswers = splitRun.answers
  const splitActive = splitRun.active
  const mountedRef = useRef(true)
  const splitDoneRef = useRef(false)
  const promptReqRef = useRef(0)
  const promptBoxRef = useRef(null)

  const hasBriefs = typeof client?.briefs === 'function'
  const hasRuns = typeof client?.runs === 'function'

  const selectedBrief = briefs.find((item) => item.id === selectedBriefId)
  const runLane = selectedBrief ? runLaneFor(selectedBrief, runsState.running, VALID_LANES) : null
  const canRunBrief = typeof client?.startRun === 'function' && Boolean(runLane)
  const projectLanes = projectRunLanes(agents, runsState.running)
  const projectLaneRunning = projectLanes.some((lane) => lane.key === projectLane && lane.running)

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
      setAgents(Array.isArray(agentList) ? agentList : [])
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

  function dismissProjectConfirm() {
    setProjectShowConfirm(false)
    setProjectSplitPlan(null)
    if (!splitActive) clearSplitRun()
    setProjectError(null)
  }

  function openProjectConfirm() {
    if (splitActive) return
    const tasks = splitTasks(projectTask)
    if (projectTaskProblem(tasks)) return
    const split = projectOneLanePerTask && tasks.length > 1
    if (!split && (!projectLane || projectLaneRunning)) return
    const plan = split ? planLaneTasks(tasks, projectLanes) : null
    clearSplitRun()
    setProjectSplitPlan(plan)
    setProjectShowConfirm(true)
    setProjectError(null)
  }

  async function handleConfirmProjectRun() {
    if (projectSplitPlan) {
      if (projectSplitPlan.problem || projectSplitPlan.pairs.length === 0) {
        setProjectError(projectSplitPlan.problem || 'Could not plan these tasks.')
        return
      }
      if (typeof client?.startRun !== 'function') return
      setProjectError(null)
      const started = await startSplitRun({ client, pairs: projectSplitPlan.pairs })
      if (!started) {
        setProjectError('The split run is already starting.')
      }
      return
    }

    const tasks = splitTasks(projectTask)
    const problem = projectTaskProblem(tasks)
    if (projectLaneRunning) {
      setProjectError('That lane is already running.')
      return
    }
    if (!projectLane || problem || typeof client?.startRun !== 'function') {
      if (problem) setProjectError(problem)
      return
    }
    setProjectStarting(true)
    setProjectError(null)
    try {
      const run = projectRunBody({
        task: projectTask,
        tasks,
        allowDirty: projectAllowDirty,
        worktree: projectOwnWorktree,
      })
      await client.startRun(projectLane, run)
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
    lane: projectLane,
    project: projectName,
    task: projectTask,
    tasks: projectTasks,
  })
  const ownWorktreeName = projectOwnWorktree ? projectWorktreeName(projectName, projectLane) : ''
  const projectProblem = projectTaskProblem(projectTasks)
  const projectSplitRun = projectOneLanePerTask && projectTasks.length > 1
  const projectSplitTaskCount = projectSplitPlan?.pairs.length || projectTasks.length
  const canStartProject =
    typeof client?.startRun === 'function' &&
    !projectProblem &&
    !splitActive &&
    (projectSplitRun || (Boolean(projectLane) && !projectLaneRunning))
  const splitStarted = splitAnswers.filter((answer) => answer.ok).length
  const splitProgress = splitRun.pairs.length === 0
    ? ''
    : splitActive
      ? `Starting ${splitRun.pairs.length} tasks, ${splitAnswers.length} started.`
      : splitRun.failed
        ? `Started ${splitStarted} of ${splitRun.pairs.length} tasks.`
        : `Started ${splitRun.pairs.length} tasks.`

  return (
    <div className="dispatch-form">
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
              disabled={projectSplitRun}
              onChange={(event) => {
                setProjectLane(event.target.value)
                dismissProjectConfirm()
              }}
            >
              <option value="">Select a lane</option>
              {projectLanes.map((lane) => (
                <option key={lane.key} value={lane.key} disabled={lane.running}>
                  {lane.running ? `${lane.name} running` : lane.name}
                </option>
              ))}
            </select>
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
            <label htmlFor="project-run-task">Task</label>
            <textarea
              id="project-run-task"
              rows={4}
              value={projectTask}
              maxLength={PROJECT_QUEUE_TEXT_LIMIT}
              placeholder="What should the agent do in this project? Separate tasks with a line of ---"
              onChange={(event) => {
                setProjectTask(event.target.value)
                dismissProjectConfirm()
              }}
            />
          </div>

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
                    Each task runs in its own worktree beside the project, on its own branch, never on main.
                  </div>
                  <div className="brief-confirm-warning">
                    This starts {projectSplitTaskCount} agents on this computer three seconds apart and spends money.
                  </div>
                </>
              )}
              <div className="brief-confirm-actions">
                <button
                  type="button"
                  className="brief-confirm-btn"
                  disabled={
                    splitActive ||
                    Boolean(projectSplitPlan.problem) ||
                    splitAnswers.length >= projectSplitPlan.pairs.length
                  }
                  onClick={handleConfirmProjectRun}
                >
                  {splitActive
                    ? 'Starting'
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
              {projectOwnWorktree && (
                <div className="brief-confirm-warning">
                  {ownWorktreeName
                    ? `The lane works in ${ownWorktreeName} beside the project, on its own branch, never on main.`
                    : 'The lane works in its own worktree beside the project, on its own branch, never on main.'}
                </div>
              )}
              {projectQueue && (
                <div className="brief-confirm-warning">
                  The tasks run one after another on a new branch
                  {projectOwnWorktree ? ' in its own worktree' : ' in the project'}, each committed when the
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
    </div>
  )
}
