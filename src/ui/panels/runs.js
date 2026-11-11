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

export function recordLine(record) {
  if (!record || typeof record !== 'object') return ''
  const lane = record.lane || 'unknown'
  const briefs = Array.isArray(record.briefs) && record.briefs.length > 0
    ? record.briefs.join(' ')
    : 'none'
  const result = resultWord(record)
  const cost = formatCost(record.costUsd)
  const minutes = Number.isFinite(record.minutes) ? `${record.minutes} min` : '0 min'
  const start = record.startedAt || 'time unknown'
  return `${lane} | ${briefs} | ${result} | ${cost} | ${minutes} | ${start}`
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

export async function startSplitRun({ client, pairs, delay = PROJECT_SPLIT_DELAY } = {}) {
  if (splitRun.active) return false
  const list = (Array.isArray(pairs) ? pairs : []).filter(
    (pair) => pair && typeof pair === 'object' && typeof pair.lane === 'string' && typeof pair.task === 'string'
  )
  if (list.length === 0) return false
  if (typeof client?.startRun !== 'function') return false
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
      const answer = await client.startRun(pair.lane, { tasks: [pair.task], worktree: true })
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

export function projectRunBody({ task, tasks, allowDirty, worktree } = {}) {
  const list = Array.isArray(tasks) ? tasks : []
  if (list.length > 1) {
    return { tasks: list, ...(worktree === true ? { worktree: true } : {}) }
  }
  const text = typeof task === 'string' ? task : ''
  // A single task in its own worktree runs as a queue of one, so it ends committed on a branch.
  if (worktree === true) return { tasks: [text], worktree: true }
  return { task: text, allowDirty: allowDirty === true }
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
