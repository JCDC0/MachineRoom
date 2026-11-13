import { harnessByAdapter } from '../../harnesses/index.js'

export function resultWord(record) {
  if (record?.killed) return 'stopped'
  if (record?.exitCode === 0) return 'finished'
  return 'failed'
}

export function formatCost(costUsd) {
  if (costUsd == null || typeof costUsd !== 'number' || !Number.isFinite(costUsd)) {
    return 'cost unknown'
  }
  if (costUsd === 0) return '$0.00'
  return `$${costUsd.toFixed(4)}`
}

export function timeSinceStart(startedAt, now) {
  const value = typeof startedAt === 'object' && startedAt !== null ? startedAt.startedAt : startedAt
  if (!value) return 'time unknown'
  const target = typeof value === 'number' ? value : Date.parse(value)
  if (Number.isNaN(target)) return 'time unknown'
  const current = now != null ? (typeof now === 'number' ? now : Date.parse(now)) : Date.now()
  const diffMs = current - target
  if (diffMs < 60000 || Number.isNaN(diffMs)) return 'just now'
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return `${days} d ago`
}

function singleLine(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim()
}

function firstLine(value) {
  if (typeof value !== 'string') return ''
  for (const line of value.split(/\r?\n/)) {
    const clean = singleLine(line)
    if (clean !== '') return clean
  }
  return ''
}

export function recordLine(record) {
  if (!record || typeof record !== 'object') return ''
  const lane = record.lane || 'unknown'
  const task = firstLine(record.task)
  const briefs = Array.isArray(record.briefs) && record.briefs.length > 0
    ? record.briefs.join(' ')
    : (task || 'none')
  const result = resultWord(record)
  const cost = formatCost(record.costUsd)
  const minutes = Number.isFinite(record.minutes) ? `${record.minutes} min` : '0 min'
  const start = record.startedAt || 'time unknown'
  const parts = [`${lane} | ${briefs} | ${result} | ${cost} | ${minutes} | ${start}`]
  const queueStatus = singleLine(record.queueStatus)
  if (queueStatus !== '') parts.push(queueStatus)
  const tests = singleLine(record.tests)
  if (tests !== '') parts.push(`tests ${tests}`)
  const note = result === 'failed' || record.startFailed === true ? singleLine(record.note) : ''
  if (note !== '') parts.push(note)
  return parts.join(' | ')
}

export function queueRecoveryAvailable(record) {
  if (!record || typeof record !== 'object') return false
  if (!record.queue) return false
  const status = singleLine(record.queueStatus)
  if (status === '') return false
  return /\b(failed|stopped)\b/i.test(status)
}

export function projectFolderName(value) {
  const folder = typeof value === 'string' ? value.trim().replace(/[\\/]+$/, '') : ''
  if (!folder) return ''
  const cut = Math.max(folder.lastIndexOf('/'), folder.lastIndexOf('\\'))
  const name = (cut === -1 ? folder : folder.slice(cut + 1)).trim()
  if (!name || name === '.' || name === '..' || /^[a-zA-Z]:$/.test(name)) return ''
  return name
}

function queueTaskList(record) {
  const list = Array.isArray(record?.tasks) ? record.tasks : (Array.isArray(record?.queueTasks) ? record.queueTasks : null)
  if (!list) return null
  return list
    .filter((task) => typeof task === 'string' && task.trim() !== '')
    .map((task) => task.trim())
}

export function queueRecoveryPlan(record, { project = '' } = {}) {
  const source = record && typeof record === 'object' ? record : {}
  const lane = singleLine(source.lane) || 'unknown lane'
  const folder = projectFolderName(source.project) || projectFolderName(project) || 'this project'
  const queueBranch = typeof source.queue === 'string' ? source.queue.trim() : ''
  const branch = queueBranch || (typeof source.branch === 'string' ? source.branch.trim() : '')
  const number = Number.isInteger(source.queueIndex) && source.queueIndex > 0 ? source.queueIndex : null
  const list = queueTaskList(source)
  const heldTask = typeof source.task === 'string' ? source.task.trim() : ''
  const task = list && number !== null && list[number - 1] ? list[number - 1] : heldTask
  const note = typeof source.note === 'string' ? source.note.trim() : ''
  const recorded = Array.isArray(source.queueRemaining) ? queueTaskList({ tasks: source.queueRemaining }) : null
  const remaining = recorded ?? (list && number !== null ? list.slice(number) : null)
  const count = Number.isInteger(source.queueSize) && source.queueSize > 0
    ? source.queueSize
    : Number.isInteger(source.tasks) && source.tasks > 0
    ? source.tasks
    : (list ? list.length : null)
  const remainingCount = remaining
    ? remaining.length
    : (count !== null && number !== null ? Math.max(count - number, 0) : null)
  const missing = []
  if (!branch) missing.push('the queue branch')
  if (number === null) missing.push('the failed task number')
  if (!task) missing.push('the failed task')
  if (!list && !recorded) missing.push('the queue task list')
  if (count === null) missing.push('how many tasks the queue held')
  if (!note) missing.push('the note')
  return {
    lane,
    project: folder,
    branch,
    number,
    task,
    firstLine: firstLine(task),
    remaining,
    remainingCount,
    count,
    note,
    hasTasks: list !== null || recorded !== null,
    missing,
  }
}

export function queueRecoveryMessage(record, { project = '' } = {}) {
  const plan = queueRecoveryPlan(record, { project })
  const lines = [`Recovery for the ${plan.lane} lane on ${plan.project}.`, '']
  lines.push(`Queue branch: ${plan.branch || 'not in the record'}`)
  if (plan.number === null) lines.push('Failed task: the record does not give its number.')
  else lines.push(`Failed task: task ${plan.number}.`)
  lines.push(plan.task || 'The record does not hold the failed task text.')
  lines.push('')
  if (plan.remaining) {
    const label = plan.remaining.length === 1 ? 'task did not run' : 'tasks did not run'
    lines.push(`${plan.remaining.length} ${label}:`)
    plan.remaining.forEach((task, index) => {
      lines.push(`${plan.number + index + 1}. ${task}`)
    })
  } else if (plan.remainingCount !== null) {
    lines.push(`The record does not hold the queue's task list. It says ${plan.count} tasks were queued, so ${plan.remainingCount} did not run.`)
  } else {
    const unknown = []
    if (!plan.hasTasks) unknown.push("the queue's task list")
    if (plan.number === null) unknown.push("the failed task's number")
    lines.push(`The record does not hold ${unknown.join(' or ')}, so the tasks that did not run are not known.`)
  }
  lines.push('')
  lines.push(`Note: ${plan.note || 'the record has no note.'}`)
  if (plan.missing.length > 0) lines.push(`Missing from the record: ${plan.missing.join(', ')}.`)
  lines.push('')
  lines.push("Inspect the uncommitted work in the lane's worktree first, report what you found, and propose how to continue. Do not discard changes and do not rerun the queue by itself.")
  return lines.join('\n')
}

export function runStartLine(answer) {
  if (!answer || typeof answer !== 'object') return 'The bridge sent no answer.'
  const lane = typeof answer.lane === 'string' && answer.lane.trim() ? answer.lane.trim() : 'The run'
  if (answer.queue === true && Number.isInteger(answer.tasks) && answer.tasks > 0) {
    return `${lane} started ${answer.tasks} task${answer.tasks === 1 ? '' : 's'} in order.`
  }
  return `${lane} started.`
}

export const PROJECT_TASK_LIMIT = 4000
export const PROJECT_TASK_COUNT_LIMIT = 20
export const PROJECT_QUEUE_TEXT_LIMIT = PROJECT_TASK_LIMIT * PROJECT_TASK_COUNT_LIMIT + 4000
export const PROJECT_CONFIRM_LIMIT = 120
export const PROJECT_SPLIT_DELAY = 3000

const projectDrafts = new Map()

export function projectDraftKey(project) {
  if (typeof project !== 'string') return ''
  return project.trim().replace(/[\\/]+$/, '').toLowerCase()
}

export function readProjectDraft(project) {
  const key = projectDraftKey(project)
  if (!key) return null
  const draft = projectDrafts.get(key)
  return draft ? { ...draft } : null
}

export function writeProjectDraft(project, patch) {
  const key = projectDraftKey(project)
  if (!key || !patch || typeof patch !== 'object') return false
  const next = { ...(projectDrafts.get(key) ?? {}) }
  if (typeof patch.task === 'string') next.task = patch.task
  if (typeof patch.lane === 'string') next.lane = patch.lane
  if (typeof patch.checkCommand === 'string') next.checkCommand = patch.checkCommand
  if (Object.keys(next).length === 0) return false
  projectDrafts.set(key, next)
  return true
}

export function clearProjectDraft(project) {
  const key = projectDraftKey(project)
  if (!key) return false
  return projectDrafts.delete(key)
}

const EMPTY_SPLIT_RUN = Object.freeze({ active: false, pairs: [], answers: [], failed: false, done: false, cancelled: false })
let splitRun = EMPTY_SPLIT_RUN
let splitCancelRequested = false
let splitWaitCancel = null
const splitRunListeners = new Set()

export function splitRunSnapshot() {
  return splitRun
}

export function subscribeSplitRun(listener) {
  if (typeof listener !== 'function') return () => {}
  splitRunListeners.add(listener)
  return () => {
    splitRunListeners.delete(listener)
  }
}

function publishSplitRun(next) {
  splitRun = next
  for (const listener of [...splitRunListeners]) listener()
}

export function clearSplitRun() {
  if (splitRun.active) return false
  splitCancelRequested = false
  splitWaitCancel = null
  if (splitRun === EMPTY_SPLIT_RUN) return true
  publishSplitRun(EMPTY_SPLIT_RUN)
  return true
}

export function cancelSplitRun() {
  if (!splitRun.active) return false
  splitCancelRequested = true
  const wake = splitWaitCancel
  splitWaitCancel = null
  if (wake) wake()
  publishSplitRun({ ...splitRun, cancelled: true })
  return true
}

function splitWait(ms) {
  return new Promise((resolve) => {
    let timer = null
    const done = () => {
      splitWaitCancel = null
      if (timer) clearTimeout(timer)
      resolve()
    }
    timer = setTimeout(done, ms)
    splitWaitCancel = done
  })
}

export function splitRunProgress(run) {
  const pairs = Array.isArray(run?.pairs) ? run.pairs : []
  const answers = Array.isArray(run?.answers) ? run.answers : []
  const started = answers.filter((answer) => answer?.ok).length
  if (run?.active) {
    return `${run.cancelled ? 'Stopping' : 'Starting'} ${pairs.length} tasks, ${answers.length} started.`
  }
  if (run?.cancelled) {
    return `Stopped after starting ${started} of ${pairs.length} tasks. The runs already started keep running.`
  }
  if (run?.failed) return `Started ${started} of ${pairs.length} tasks.`
  return `Started ${pairs.length} tasks.`
}

export async function startSplitRun({ client, pairs, delay = PROJECT_SPLIT_DELAY, checkCommand } = {}) {
  if (splitRun.active) return false
  const list = (Array.isArray(pairs) ? pairs : []).filter(
    (pair) => pair && typeof pair === 'object' && typeof pair.lane === 'string' && typeof pair.task === 'string'
  )
  if (list.length === 0) return false
  if (typeof client?.startRun !== 'function') return false
  const command = typeof checkCommand === 'string' ? checkCommand.trim() : ''
  splitCancelRequested = false
  splitWaitCancel = null
  publishSplitRun({ active: true, pairs: list, answers: [], failed: false, done: false, cancelled: false })
  const answers = []
  let failed = false
  let cancelled = false
  for (let index = 0; index < list.length; index += 1) {
    if (splitCancelRequested) {
      cancelled = true
      break
    }
    const pair = list[index]
    try {
      const answer = await client.startRun(pair.lane, {
        tasks: [pair.task],
        worktree: true,
        ...(command === '' ? {} : { checkCommand: command }),
      })
      answers.push({ ok: true, message: runStartLine(answer) })
    } catch (err) {
      failed = true
      answers.push({ ok: false, message: err?.message || 'Could not start run.' })
    }
    publishSplitRun({ active: true, pairs: list, answers: [...answers], failed, done: false, cancelled: splitCancelRequested })
    if (index < list.length - 1) {
      if (splitCancelRequested) {
        cancelled = true
        break
      }
      await splitWait(delay)
      if (splitCancelRequested) {
        cancelled = true
        break
      }
    }
  }
  splitCancelRequested = false
  publishSplitRun({ active: false, pairs: list, answers, failed, done: true, cancelled })
  return true
}

export const PROJECT_TASK_PROBLEM = 'Write the task in 1 to 4000 characters.'
export const PROJECT_TASKS_PROBLEM = 'Write one to twenty tasks, each 1 to 4000 characters.'
export const PROJECT_TASK_SEPARATOR_PROBLEM = 'A task cannot hold a line of only ---.'
export const NO_IDLE_LANE_PROBLEM = 'No lane is idle.'

function runsOnProject(agent) {
  const adapterType = typeof agent.adapterType === 'string' ? agent.adapterType : ''
  return Object.hasOwn(harnessByAdapter, adapterType)
}

function isSubOrchestratorAgent(agent) {
  if (agent.subOrchestrator === true) return true
  return typeof agent.key === 'string' && agent.key.trim().startsWith('sub-')
}

export function projectRunLanes(agents, running) {
  const list = Array.isArray(agents) ? agents : []
  const active = new Set(
    (Array.isArray(running) ? running : [])
      .map((entry) => (entry && typeof entry === 'object' ? entry.lane : ''))
      .filter((lane) => typeof lane === 'string' && lane.trim() !== '')
      .map((lane) => lane.trim())
  )
  const seen = new Set()
  const lanes = []
  for (const agent of list) {
    if (!agent || typeof agent !== 'object') continue
    if (isSubOrchestratorAgent(agent)) continue
    if (agent.role !== null && agent.role !== undefined) continue
    if (!runsOnProject(agent)) continue
    const key = typeof agent.key === 'string' ? agent.key.trim() : ''
    if (!key || seen.has(key)) continue
    if (key === 'orchestrator') continue
    seen.add(key)
    const name = typeof agent.name === 'string' && agent.name.trim() ? agent.name.trim() : key
    lanes.push({ key, name, running: active.has(key) })
  }
  return lanes
}

export const NO_LANES_FORM_LINE =
  'Runs start from a room opened with --lanes: npm run serve -- up --lanes.'
export const NO_CODE_LANE_FORM_LINE =
  'No code lane is set up. Add one in Agents, Build a team.'

export function projectFormNotice({ lanesMode = false, lanes = [] } = {}) {
  if (!lanesMode) return NO_LANES_FORM_LINE
  if (!Array.isArray(lanes) || lanes.length === 0) return NO_CODE_LANE_FORM_LINE
  return ''
}

function idleProjectLanes(lanes) {
  const list = Array.isArray(lanes) ? lanes : []
  const seen = new Set()
  const idle = []
  for (const lane of list) {
    if (!lane || typeof lane !== 'object') continue
    if (lane.running) continue
    const key = typeof lane.key === 'string' ? lane.key.trim() : ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    const name = typeof lane.name === 'string' && lane.name.trim() ? lane.name.trim() : key
    idle.push({ key, name })
  }
  return idle
}

export function routeLaneOrder(lanes, route) {
  const list = Array.isArray(lanes) ? lanes : []
  if (!route || typeof route !== 'object') return list
  const rank = new Map()
  const add = (key) => {
    const name = typeof key === 'string' ? key.trim() : ''
    if (name === '' || rank.has(name)) return
    rank.set(name, rank.size)
  }
  add(route.lane)
  for (const skip of Array.isArray(route.skipped) ? route.skipped : []) add(skip?.lane)
  if (rank.size === 0) return list
  return list
    .map((lane, index) => ({ lane, index, rank: rank.has(lane.key) ? rank.get(lane.key) : rank.size + index }))
    .sort((one, two) => one.rank - two.rank || one.index - two.index)
    .map((entry) => entry.lane)
}

export function planLaneTasks(tasks, lanes, route = null) {
  const list = Array.isArray(tasks) ? tasks : []
  const taskProblem = projectTaskProblem(list)
  if (taskProblem) return { pairs: [], problem: taskProblem }
  const idle = routeLaneOrder(idleProjectLanes(lanes), route)
  if (idle.length === 0) return { pairs: [], problem: NO_IDLE_LANE_PROBLEM }
  if (idle.length < list.length) {
    const lanesWord = idle.length === 1 ? 'lane is' : 'lanes are'
    return {
      pairs: [],
      problem: `${list.length} tasks need ${list.length} idle lanes. Only ${idle.length} ${lanesWord} idle.`,
    }
  }
  return {
    pairs: list.map((task, index) => ({
      task: task.trim(),
      lane: idle[index].key,
      name: idle[index].name,
    })),
    problem: null,
  }
}

export function splitTasks(text) {
  if (typeof text !== 'string') return []
  const tasks = []
  let lines = []
  const add = () => {
    const task = lines.join('\n').trim()
    if (task) tasks.push(task)
    lines = []
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '---') add()
    else lines.push(line)
  }
  add()
  return tasks
}

export function projectTaskProblem(task) {
  const list = Array.isArray(task) ? task : [task]
  if (list.length > PROJECT_TASK_COUNT_LIMIT) return PROJECT_TASKS_PROBLEM
  if (list.length === 0) return PROJECT_TASK_PROBLEM
  for (const item of list) {
    if (typeof item !== 'string') return PROJECT_TASK_PROBLEM
    const text = item.trim()
    if (text.length < 1 || text.length > PROJECT_TASK_LIMIT) return PROJECT_TASK_PROBLEM
    if (text.split(/\r?\n/).some((line) => line.trim() === '---')) {
      return PROJECT_TASK_SEPARATOR_PROBLEM
    }
  }
  return null
}

export function projectRunLabel(count) {
  return Number.isInteger(count) && count > 1 ? `Run ${count} tasks in order` : 'Run'
}

export function projectSplitLabel(count) {
  return Number.isInteger(count) && count > 1 ? `Run ${count} tasks on ${count} lanes` : projectRunLabel(count)
}

export function projectWorktreeName(project, lane) {
  const folder = typeof project === 'string' ? project.trim().replace(/[\\/]+$/, '') : ''
  const key = typeof lane === 'string' ? lane.trim() : ''
  if (!folder || !key) return ''
  const cut = Math.max(folder.lastIndexOf('/'), folder.lastIndexOf('\\'))
  const name = (cut === -1 ? folder : folder.slice(cut + 1)).trim()
  if (!name || name === '.' || name === '..' || /^[a-zA-Z]:$/.test(name)) return ''
  return `${name}/.worktrees/${key}`
}

export function projectRunBody({ task, tasks, allowDirty, worktree, checkCommand } = {}) {
  const list = Array.isArray(tasks) ? tasks : []
  const command = typeof checkCommand === 'string' ? checkCommand.trim() : ''
  const check = command === '' ? {} : { checkCommand: command }
  if (list.length > 1) {
    return { tasks: list, ...(worktree === true ? { worktree: true } : {}), ...check }
  }
  const text = typeof task === 'string' ? task : ''
  // A single task in its own worktree runs as a queue of one, so it ends committed on a branch.
  if (worktree === true) return { tasks: [text], worktree: true, ...check }
  return { task: text, allowDirty: allowDirty === true, ...check }
}

export function projectCheckLine({ checkCommand, hasTestScript } = {}) {
  const command = typeof checkCommand === 'string' ? checkCommand.trim() : ''
  if (command !== '') return `Check: ${command}`
  if (hasTestScript === true) return 'Check: npm test'
  return 'No check: this project has no npm test script.'
}

export function projectRunConfirm({ lane, project, task, tasks } = {}) {
  const list = Array.isArray(tasks) ? tasks : []
  const first = list.length > 0 && typeof list[0] === 'string' ? list[0] : ''
  const taskText = typeof task === 'string' ? task.trim() : first.trim()
  const confirm = {
    lane: typeof lane === 'string' ? lane.trim() : '',
    project: typeof project === 'string' && project.trim() ? project.trim() : 'this project',
    task: taskText.slice(0, PROJECT_CONFIRM_LIMIT),
  }
  if (list.length > 1) {
    confirm.queue = true
    confirm.count = list.length
  }
  return confirm
}
