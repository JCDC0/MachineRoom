import { harnessByAdapter } from '../../harnesses/index.js'

export function resultWord(record) {
  if (record?.killed) return 'stopped'
  if (record?.exitCode === 0) return 'finished'
  return 'failed'
}

export const runResultWord = resultWord

export function formatCost(costUsd) {
  if (costUsd == null || typeof costUsd !== 'number' || !Number.isFinite(costUsd)) {
    return 'cost unknown'
  }
  if (costUsd === 0) return '$0.00'
  return `$${costUsd.toFixed(4)}`
}

export function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) return 'minutes unknown'
  return `${minutes} min`
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

export const timeSince = timeSinceStart

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

export const formatRecordLine = recordLine

export function runningLine(entry, now) {
  if (!entry || typeof entry !== 'object') return ''
  const lane = entry.lane || 'unknown'
  const briefs = Array.isArray(entry.briefs) && entry.briefs.length > 0
    ? entry.briefs.join(' ')
    : 'none'
  const ago = timeSinceStart(entry.startedAt, now)
  return `${lane} | ${briefs} | ${ago}`
}

export const PROJECT_TASK_LIMIT = 4000
export const PROJECT_TASK_COUNT_LIMIT = 20
export const PROJECT_QUEUE_TEXT_LIMIT = PROJECT_TASK_LIMIT * PROJECT_TASK_COUNT_LIMIT + 4000
export const PROJECT_CONFIRM_LIMIT = 120
export const PROJECT_TASK_PROBLEM = 'Write the task in 1 to 4000 characters.'
export const PROJECT_TASKS_PROBLEM = 'Write one to twenty tasks, each 1 to 4000 characters.'
export const PROJECT_TASK_SEPARATOR_PROBLEM = 'A task cannot hold a line of only ---.'

function runsOnProject(agent) {
  const adapterType = typeof agent.adapterType === 'string' ? agent.adapterType : ''
  return Object.hasOwn(harnessByAdapter, adapterType)
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
    if (agent.role !== null && agent.role !== undefined) continue
    if (!runsOnProject(agent)) continue
    const key = typeof agent.key === 'string' ? agent.key.trim() : ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    const name = typeof agent.name === 'string' && agent.name.trim() ? agent.name.trim() : key
    lanes.push({ key, name, running: active.has(key) })
  }
  return lanes
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

export function projectWorktreeName(project, lane) {
  const folder = typeof project === 'string' ? project.trim().replace(/[\\/]+$/, '') : ''
  const key = typeof lane === 'string' ? lane.trim() : ''
  if (!folder || !key) return ''
  const cut = Math.max(folder.lastIndexOf('/'), folder.lastIndexOf('\\'))
  const name = (cut === -1 ? folder : folder.slice(cut + 1)).trim()
  if (!name || name === '.' || name === '..' || /^[a-zA-Z]:$/.test(name)) return ''
  return `${name}-mr-${key}`
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
