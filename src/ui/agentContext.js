import { agentTasks } from '../model/liveTasks.js'
import { visibleText } from '../model/paths.js'
import { isOrchestratorAgent } from './agentList.js'

export const DOCK_LOG_LIMIT = 12
export const NOT_REPORTED = 'not reported'
export const NONE = 'none'

const STATUS_WORDS = {
  active: 'idle',
  idle: 'idle',
  queued: 'queued',
  working: 'working',
  running: 'working',
  paused: 'paused',
  error: 'failed',
  failed: 'failed',
  done: 'finished',
  finished: 'finished',
  succeeded: 'finished',
  cancelled: 'failed',
  timed_out: 'failed',
  pending_approval: 'pending approval',
  terminated: 'failed',
}

const TONES = new Set(['normal', 'dim', 'error', 'done'])

function clean(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value !== 'string') return ''
  return visibleText(value).trim()
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function statusWord(value) {
  const raw = clean(value).toLowerCase()
  if (!raw) return 'idle'
  if (Object.hasOwn(STATUS_WORDS, raw)) return STATUS_WORDS[raw]
  return raw.replace(/_/g, ' ')
}

function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`
}

function formatTokens(count) {
  if (count == null || !Number.isFinite(count)) return '?'
  if (count < 1000) return String(Math.floor(count))
  return `${(count / 1000).toFixed(1)}k`
}

function sameAgent(agent, key, id) {
  const agentKey = clean(agent?.key).toLowerCase()
  const agentId = clean(agent?.id)
  return Boolean((key && agentKey === key.toLowerCase()) || (id && agentId === id))
}

function resolveAgent(agent, roster) {
  if (isObject(agent)) {
    const key = clean(agent.key)
    const id = clean(agent.id)
    const found = roster.find((item) => sameAgent(item, key, id))
    return found ? { ...found, ...agent } : agent
  }
  const wanted = clean(agent)
  if (wanted) {
    const found = roster.find((item) => sameAgent(item, wanted, wanted))
    if (found) return found
  }
  const orchestrator = roster.find(isOrchestratorAgent)
  if (orchestrator) return orchestrator
  return { key: 'orchestrator', name: 'Orchestrator', orchestrator: true }
}

function matchingRuns(liveRuns, selected) {
  const runs = Array.isArray(liveRuns) ? liveRuns.filter(isObject) : []
  const id = clean(selected?.id)
  const key = clean(selected?.key).toLowerCase()
  const name = clean(selected?.name).toLowerCase()
  return runs.filter((run) => {
    const runId = clean(run.agentId)
    const runKey = clean(run.agentKey).toLowerCase()
    const runName = clean(run.agentName).toLowerCase()
    return Boolean((id && runId === id) || (key && runKey === key) || (name && runName === name))
  })
}

function currentRun(liveRuns, selected) {
  const runs = matchingRuns(liveRuns, selected)
  return (
    runs.find((run) => run.status === 'running') ??
    runs.find((run) => run.status === 'queued') ??
    runs[0] ??
    null
  )
}

function ownedBy(entry, key, name) {
  const owner = clean(entry.key) || clean(entry.agentKey) || clean(entry.agent)
  if (!owner) return true
  const ownerLower = owner.toLowerCase()
  return Boolean((key && ownerLower === key.toLowerCase()) || (name && ownerLower === name.toLowerCase()))
}

function dockLog(log, key, name) {
  if (!Array.isArray(log)) return []
  const entries = []
  for (const item of log) {
    if (typeof item === 'string') {
      const text = clean(item)
      if (text) entries.push({ text, tone: 'normal' })
      continue
    }
    if (!isObject(item) || !ownedBy(item, key, name)) continue
    const raw = item.text ?? item.line ?? item.message
    const text = clean(raw)
    if (!text) continue
    entries.push({ text, tone: TONES.has(item.tone) ? item.tone : 'normal' })
  }
  return entries
}

function commandFromLog(entries) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.tone === 'normal' || entry.tone === 'error') return entry.text
  }
  return ''
}

function costRows(costs) {
  if (Array.isArray(costs)) return costs
  if (isObject(costs) && Array.isArray(costs.rows)) return costs.rows
  return []
}

function costRowFor(costs, selected) {
  const key = clean(selected?.key).toLowerCase()
  const id = clean(selected?.id)
  return (
    costRows(costs).find((row) => {
      if (!isObject(row)) return false
      const rowKey = clean(row.key).toLowerCase()
      const rowId = clean(row.agentId)
      return Boolean((key && rowKey === key) || (id && rowId === id))
    }) ?? null
  )
}

function controlAgentId(selected, costs, liveRuns) {
  const own = clean(selected?.id)
  if (own) return own
  const rowId = clean(costRowFor(costs, selected)?.agentId)
  if (rowId) return rowId
  const run = matchingRuns(liveRuns, selected).find((item) => clean(item.agentId))
  return clean(run?.agentId)
}

function taskRosterFor(roster, selected, id) {
  if (!id) return roster
  const key = clean(selected?.key)
  if (!key) return roster
  const found = roster.some((item) => sameAgent(item, key, ''))
  if (found) return roster.map((item) => (sameAgent(item, key, '') ? { ...item, id } : item))
  return [...roster, { ...selected, id }]
}

function readContext(selected, run) {
  for (const source of [selected, run]) {
    if (!isObject(source)) continue
    const tokens = numberOrNull(source.contextTokens)
    const window = numberOrNull(source.contextWindow)
    if (tokens === null || tokens < 0 || window === null || window <= 0) continue
    const share = Math.min(1, tokens / window)
    const percent = Math.round(share * 100)
    return { tokens, window, share, percent, label: `${percent}%` }
  }
  return null
}

function withOrchestratorData(selected, orchestrator) {
  if (!isObject(orchestrator)) return selected
  const next = { ...selected }
  for (const key of ['contextTokens', 'contextWindow']) {
    const value = numberOrNull(orchestrator[key])
    if (value !== null) next[key] = value
  }
  if (typeof orchestrator.autocompact === 'boolean') next.autocompact = orchestrator.autocompact
  return next
}

export function agentContext({ agent = null, lanes = null, costs = null, liveRuns = null, tasks = null, log = null, orchestrator = null } = {}) {
  const roster = Array.isArray(lanes) ? lanes.filter(isObject) : []
  const selected = resolveAgent(agent, roster)
  const isOrchestrator = agent === null || agent === undefined || isOrchestratorAgent(selected)
  const source = isOrchestrator ? withOrchestratorData(selected, orchestrator) : selected
  const key = clean(source?.key) || clean(source?.id)
  const name = clean(source?.name) || key || 'Agent'
  const harness = clean(source?.harness) || clean(source?.adapterType) || NOT_REPORTED
  const model = clean(source?.model) || NOT_REPORTED
  const run = currentRun(liveRuns, source)

  const taskRoster = taskRosterFor(roster, selected, controlAgentId(selected, costs, liveRuns))
  const taskMap = agentTasks(Array.isArray(liveRuns) ? liveRuns : [], Array.isArray(tasks) ? tasks : [], taskRoster)
  const task = clean(taskMap.get(key)) || NONE

  const entries = dockLog(log, key, name)
  const status = run && run.status === 'running'
    ? 'working'
    : run && run.status === 'queued'
      ? 'queued'
      : statusWord(source?.status)
  const liveCommand = status === 'working' || status === 'queued' ? clean(source?.label) : ''
  const command =
    clean(source?.command) ||
    liveCommand ||
    clean(run?.command) ||
    clean(run?.label) ||
    commandFromLog(entries) ||
    NONE

  const row = costRowFor(costs, selected)
  const costCents = numberOrNull(row?.costCents)
  const reported = Boolean(row) && row.reported !== false && costCents !== null
  const inputTokens = reported ? numberOrNull(row.inputTokens) : null
  const outputTokens = reported ? numberOrNull(row.outputTokens) : null
  const tokensReported = reported && (inputTokens !== null || outputTokens !== null)
  const cost = reported ? formatCents(costCents) : NOT_REPORTED
  const tokens = tokensReported
    ? `${formatTokens(inputTokens)} in / ${formatTokens(outputTokens)} out`
    : NOT_REPORTED

  return {
    isOrchestrator,
    key,
    name,
    harness,
    model,
    status,
    task,
    command,
    cost,
    costCents: reported ? costCents : null,
    tokens,
    inputTokens,
    outputTokens,
    log: entries.slice(-DOCK_LOG_LIMIT),
    context: isOrchestrator ? readContext(source, run) : null,
    autocompact: isOrchestrator && typeof source?.autocompact === 'boolean' ? source.autocompact : null,
  }
}
