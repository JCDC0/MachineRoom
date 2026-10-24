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
export const PROJECT_CONFIRM_LIMIT = 120

const PROJECT_RUN_ADAPTERS = new Set(['opencode_local', 'claude_local', 'process'])

export function projectRunLanes(agents) {
  const list = Array.isArray(agents) ? agents : []
  const seen = new Set()
  const lanes = []
  for (const agent of list) {
    if (!agent || typeof agent !== 'object') continue
    if (agent.role !== null && agent.role !== undefined) continue
    if (!PROJECT_RUN_ADAPTERS.has(agent.adapterType)) continue
    const key = typeof agent.key === 'string' ? agent.key.trim() : ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    const name = typeof agent.name === 'string' && agent.name.trim() ? agent.name.trim() : key
    lanes.push({ key, name })
  }
  return lanes
}

export function projectTaskProblem(task) {
  if (typeof task !== 'string' || task.trim().length < 1 || task.length > PROJECT_TASK_LIMIT) {
    return 'Write the task in 1 to 4000 characters.'
  }
  return null
}

export function projectRunConfirm({ lane, project, task } = {}) {
  const taskText = typeof task === 'string' ? task.trim() : ''
  return {
    lane: typeof lane === 'string' ? lane.trim() : '',
    project: typeof project === 'string' && project.trim() ? project.trim() : 'this project',
    task: taskText.slice(0, PROJECT_CONFIRM_LIMIT),
  }
}
