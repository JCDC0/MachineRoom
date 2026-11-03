import { harnessByAdapter } from '../harnesses/index.js'
import { agentTasks } from '../model/liveTasks.js'
import { visibleText } from '../model/paths.js'
import { INSPECT_EVENT } from './inspector.js'

export const LANE_PILL_LIMIT = 6
export const LANE_TASK_LIMIT = 16

const ACTIVE_STATUS = new Set(['queued', 'running'])
const QUEUE_STEP = /\btask\s+(\d+)\s+of\s+(\d+)\b/i

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function timeOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const ms = Date.parse(value ?? '')
  return Number.isFinite(ms) ? ms : null
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function isLaneAgent(agent) {
  if (!agent || typeof agent !== 'object') return false
  const key = text(agent.key)
  if (!key || key === 'orchestrator') return false
  if (agent.subOrchestrator === true || key.startsWith('sub-')) return false
  if (agent.sessionReader === true || key.endsWith('-session')) return false
  if (agent.role !== null && agent.role !== undefined) return false
  return Object.hasOwn(harnessByAdapter, text(agent.adapterType))
}

export function laneAgents(agents) {
  const list = Array.isArray(agents) ? agents : []
  const seen = new Set()
  const lanes = []
  for (const agent of list) {
    if (!isLaneAgent(agent)) continue
    const key = text(agent.key)
    if (seen.has(key)) continue
    seen.add(key)
    lanes.push(agent)
  }
  return lanes
}

function issueTask(issue) {
  const raw =
    text(issue?.identifier) ||
    text(issue?.name) ||
    text(issue?.title) ||
    (typeof issue?.identifier === 'number' ? String(issue.identifier) : '')
  return text(visibleText(raw)).slice(0, LANE_TASK_LIMIT)
}

function recordTask(record) {
  const briefs = Array.isArray(record?.briefs) ? record.briefs.map(text).filter(Boolean) : []
  if (briefs.length > 0) return briefs.join('+').slice(0, LANE_TASK_LIMIT)
  return text(visibleText(text(record?.task))).slice(0, LANE_TASK_LIMIT)
}

export function runFailed(record) {
  if (!record || typeof record !== 'object') return false
  if (record.killed === true) return true
  const exitCode = finiteOrNull(record.exitCode)
  return exitCode !== null && exitCode !== 0
}

export function queueStep(running, lane) {
  const list = Array.isArray(running) ? running : []
  const key = text(lane)
  if (!key) return null
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const entry = list[index]
    if (!entry || typeof entry !== 'object' || entry.queue !== true) continue
    if (text(entry.lane) !== key) continue
    const lines = Array.isArray(entry.lastLines) ? entry.lastLines : []
    for (let line = lines.length - 1; line >= 0; line -= 1) {
      const found = QUEUE_STEP.exec(String(lines[line] ?? ''))
      if (!found) continue
      const step = Number(found[1])
      const total = Number(found[2])
      if (!Number.isInteger(step) || !Number.isInteger(total)) return null
      if (step < 1 || total < 1 || step > total) return null
      return `${step}/${total}`
    }
    return null
  }
  return null
}

function liveRunFor(liveRuns, key, byAgentId) {
  let best = null
  for (const run of Array.isArray(liveRuns) ? liveRuns : []) {
    if (!run || typeof run !== 'object') continue
    if (!ACTIVE_STATUS.has(text(run.status))) continue
    if (byAgentId.get(text(run.agentId)) !== key) continue
    const started = timeOf(run.startedAt)
    if (!best) {
      best = { run, started }
      continue
    }
    const current = best.started
    if (started !== null && (current === null || started > current)) best = { run, started }
  }
  return best
}

function lastRecordFor(recent, key, byAgentId) {
  let best = null
  for (const record of Array.isArray(recent) ? recent : []) {
    if (!record || typeof record !== 'object') continue
    const agent = text(record.agentId)
    const lane = text(record.lane) || (agent ? byAgentId.get(agent) : '')
    if (lane !== key) continue
    const started = timeOf(record.startedAt)
    if (!best) {
      best = { record, started }
      continue
    }
    if (started !== null && (best.started === null || started > best.started)) best = { record, started }
  }
  return best
}

function minutesSince(started, now) {
  const current = finiteOrNull(now)
  if (started === null || current === null) return null
  const minutes = Math.floor(Math.max(0, current - started) / 60000)
  return Number.isFinite(minutes) ? minutes : null
}

function pillLabel(agent, labels, key) {
  const found = labels && typeof labels.get === 'function' ? labels.get(key) : null
  return text(found) || text(agent?.name) || key
}

export function lanePills({
  agents = [],
  liveRuns = [],
  issues = [],
  records = null,
  labels = null,
  now = Date.now(),
  limit = LANE_PILL_LIMIT,
} = {}) {
  const roster = Array.isArray(agents) ? agents : []
  const lanes = laneAgents(roster)
  const size = Number.isInteger(limit) && limit >= 0 ? limit : LANE_PILL_LIMIT
  const byAgentId = new Map()
  for (const agent of roster) {
    const id = text(agent?.id)
    const key = text(agent?.key)
    if (id && key) byAgentId.set(id, key)
  }
  const tasks = agentTasks(liveRuns, issues, roster)
  const issueIndex = new Map()
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (issue && typeof issue === 'object' && issue.id != null) issueIndex.set(String(issue.id), issue)
  }
  const running = Array.isArray(records?.running) ? records.running : []

  const active = []
  const failed = []
  for (const agent of lanes) {
    const key = text(agent.key)
    const label = pillLabel(agent, labels, key)
    const live = liveRunFor(liveRuns, key, byAgentId)
    if (live) {
      const task =
        tasks.get(key) ||
        issueTask(issueIndex.get(String(live.run.issueId ?? ''))) ||
        text(live.run.issueId).slice(0, LANE_TASK_LIMIT)
      active.push({
        key,
        label,
        task,
        state: text(live.run.status) === 'queued' ? 'queued' : 'working',
        tone: 'working',
        minutes: minutesSince(live.started, now),
        startedAt: live.started,
        step: queueStep(running, key),
      })
      continue
    }
    const last = lastRecordFor(records?.last ?? records?.recent, key, byAgentId)
    if (!last || !runFailed(last.record)) continue
    failed.push({
      key,
      label,
      task: recordTask(last.record),
      state: 'failed',
      tone: 'failed',
      minutes: minutesSince(last.started, now),
      startedAt: last.started,
      step: null,
    })
  }

  active.sort((left, right) => {
    if (left.startedAt !== right.startedAt) {
      if (left.startedAt === null) return 1
      if (right.startedAt === null) return -1
      return left.startedAt - right.startedAt
    }
    return left.key.localeCompare(right.key)
  })
  failed.sort((left, right) => {
    if (left.startedAt !== right.startedAt) {
      if (right.startedAt === null) return 1
      if (left.startedAt === null) return -1
      return right.startedAt - left.startedAt
    }
    return left.key.localeCompare(right.key)
  })

  const all = [...active, ...failed]
  const shown = all.slice(0, size)
  return { pills: shown, more: all.length - shown.length }
}

export function lanePillTitle(pill) {
  if (!pill || typeof pill !== 'object') return ''
  const parts = [text(pill.label) || text(pill.key)]
  if (text(pill.task)) parts.push(text(pill.task))
  parts.push(text(pill.state) || 'idle')
  if (pill.minutes !== null && pill.minutes !== undefined) parts.push(`${pill.minutes} min`)
  if (text(pill.step)) parts.push(`task ${text(pill.step)}`)
  return parts.filter(Boolean).join(' · ')
}

export function inspectLane(key, target = typeof window === 'undefined' ? null : window) {
  const id = text(key)
  if (!id || !target || typeof target.dispatchEvent !== 'function') return false
  if (typeof target.CustomEvent !== 'function') return false
  target.dispatchEvent(new target.CustomEvent(INSPECT_EVENT, { detail: { kind: 'agent', id } }))
  return true
}
