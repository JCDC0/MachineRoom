import { agentTasks } from '../model/liveTasks.js'
import { visibleText } from '../model/paths.js'
import { isOrchestratorAgent } from './agentList.js'

export const DOCK_LOG_LIMIT = 12
export const NOT_REPORTED = 'not reported'
export const NONE = 'none'
export const EMPTY_PROMPT = 'Pick an agent on the left to see what it is doing.'

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
    if (!key && !id && !clean(agent.name)) return null
    const found = roster.find((item) => sameAgent(item, key, id))
    return found ? { ...found, ...agent } : agent
  }
  const wanted = clean(agent)
  if (!wanted) return null
  const found = roster.find((item) => sameAgent(item, wanted, wanted))
  if (found) return found
  return { key: wanted, name: wanted }
}

function isWorking(agent) {
  const status = clean(agent?.status).toLowerCase()
  return status === 'working' || status === 'running'
}

function workingFallback(working, roster) {
  const given = resolveAgent(working, roster)
  if (given) return given
  return roster.find(isWorking) ?? null
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

function orchestratorRows(value) {
  if (Array.isArray(value)) return value.filter(isObject)
  if (isObject(value)) {
    if (Array.isArray(value.orchestrators)) return value.orchestrators.filter(isObject)
    return [value]
  }
  return []
}

function withOrchestratorData(selected, orchestrator) {
  const main = orchestratorRows(orchestrator).find((row) => clean(row.id).toLowerCase() === 'orchestrator')
  if (!main) return selected
  const next = { ...selected }
  for (const key of ['contextTokens', 'contextWindow']) {
    const value = numberOrNull(main[key])
    if (value !== null) next[key] = value
  }
  if (typeof main.autocompact === 'boolean') next.autocompact = main.autocompact
  return next
}

function subIdOf(agent) {
  for (const field of ['key', 'id']) {
    const value = clean(agent?.[field])
    if (value.toLowerCase().startsWith('sub-')) {
      const id = value.slice(4).trim()
      if (id) return id
    }
  }
  return ''
}

function orchestratorRowFor(rows, id) {
  const wanted = id.toLowerCase()
  return (
    rows.find((row) => {
      const rowId = clean(row.id).toLowerCase()
      return rowId === wanted || rowId === `sub-${wanted}`
    }) ?? null
  )
}

function isSubRow(row) {
  if (!isObject(row)) return false
  return clean(row.id).toLowerCase() !== 'orchestrator' && clean(row.key).toLowerCase() !== 'orchestrator'
}

function sectorRowFor(rows, selected) {
  const lane = clean(selected?.key).toLowerCase()
  const laneId = clean(selected?.id).toLowerCase()
  return (
    rows.find((row) => {
      if (!isSubRow(row) || !Array.isArray(row.lanes)) return false
      return row.lanes.some((entry) => {
        const value = clean(entry).toLowerCase()
        return Boolean(value) && (value === lane || value === laneId)
      })
    }) ?? null
  )
}

function lanesText(row) {
  if (!isObject(row) || !Array.isArray(row.lanes)) return NOT_REPORTED
  const lanes = row.lanes.map(clean).filter(Boolean)
  return lanes.length > 0 ? lanes.join(', ') : NONE
}

function scopeText(row) {
  if (!isObject(row) || !Array.isArray(row.scope)) return NOT_REPORTED
  const globs = row.scope.map(clean).filter(Boolean)
  return globs.length > 0 ? globs.join('\n') : 'whole project'
}

function restrictedText(value) {
  if (value === true) return 'yes'
  if (value === false) return 'no'
  return NOT_REPORTED
}

function setByText(value) {
  const word = clean(value).toLowerCase()
  if (word === 'owner' || word === 'orchestrator') return word
  return NOT_REPORTED
}

function sectorData(selected, orchestrator) {
  const rows = orchestratorRows(orchestrator)
  const subId = subIdOf(selected)
  if (subId) {
    const row = orchestratorRowFor(rows, subId)
    return {
      sector: null,
      lanes: lanesText(row),
      scope: scopeText(row),
      restricted: restrictedText(row?.restricted),
      setBy: setByText(row?.setBy),
    }
  }
  const row = sectorRowFor(rows, selected)
  if (!row) return { sector: null, lanes: null, scope: null, restricted: null, setBy: null }
  return {
    sector: clean(row.name) || clean(row.id) || NOT_REPORTED,
    lanes: null,
    scope: scopeText(row),
    restricted: restrictedText(row.restricted),
    setBy: setByText(row.setBy),
  }
}

function emptyContext() {
  return {
    empty: true,
    message: EMPTY_PROMPT,
    isOrchestrator: false,
    key: '',
    name: '',
    harness: NOT_REPORTED,
    model: NOT_REPORTED,
    status: 'idle',
    task: NONE,
    command: NONE,
    cost: NOT_REPORTED,
    costCents: null,
    tokens: NOT_REPORTED,
    inputTokens: null,
    outputTokens: null,
    sector: null,
    lanes: null,
    scope: null,
    restricted: null,
    setBy: null,
    log: [],
    context: null,
    autocompact: null,
  }
}

export function agentContext({ agent = null, working = null, lanes = null, costs = null, liveRuns = null, tasks = null, log = null, orchestrator = null } = {}) {
  const roster = Array.isArray(lanes) ? lanes.filter(isObject) : []
  const selected = resolveAgent(agent, roster)
  const chosen =
    selected ??
    workingFallback(working, roster) ??
    roster.find(isOrchestratorAgent) ??
    null
  if (!chosen) return emptyContext()
  const isOrchestrator = isOrchestratorAgent(chosen)
  const source = isOrchestrator ? withOrchestratorData(chosen, orchestrator) : chosen
  const key = clean(source?.key) || clean(source?.id)
  const name = clean(source?.name) || key || 'Agent'
  const harness = clean(source?.harness) || clean(source?.adapterType) || NOT_REPORTED
  const model = clean(source?.model) || NOT_REPORTED
  const run = currentRun(liveRuns, source)

  const taskRoster = taskRosterFor(roster, source, controlAgentId(source, costs, liveRuns))
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

  const row = costRowFor(costs, source)
  const costCents = numberOrNull(row?.costCents)
  const reported = Boolean(row) && row.reported !== false && costCents !== null
  const inputTokens = reported ? numberOrNull(row.inputTokens) : null
  const outputTokens = reported ? numberOrNull(row.outputTokens) : null
  const tokensReported = reported && (inputTokens !== null || outputTokens !== null)
  const cost = reported ? formatCents(costCents) : NOT_REPORTED
  const tokens = tokensReported
    ? `${formatTokens(inputTokens)} in / ${formatTokens(outputTokens)} out`
    : NOT_REPORTED

  const sectorInfo = sectorData(source, orchestrator)

  return {
    empty: false,
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
    sector: sectorInfo.sector,
    lanes: sectorInfo.lanes,
    scope: sectorInfo.scope,
    restricted: sectorInfo.restricted,
    setBy: sectorInfo.setBy,
    log: entries.slice(-DOCK_LOG_LIMIT),
    context: isOrchestrator ? readContext(source, run) : null,
    autocompact: isOrchestrator && typeof source?.autocompact === 'boolean' ? source.autocompact : null,
  }
}
