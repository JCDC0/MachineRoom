import { cachedRunRecords, runsFile } from './runs.js'

export { cachedRunRecords }

function monthStart(time) {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

function nextMonth(start) {
  const date = new Date(start)
  return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime()
}

function dayStart(time) {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function recordCost(record) {
  return typeof record?.costUsd === 'number' && Number.isFinite(record.costUsd) ? record.costUsd : null
}

function recordFailedOrStopped(record) {
  if (record?.killed === true || record?.startFailed === true) return true
  return Number.isInteger(record?.exitCode) && record.exitCode !== 0
}

function recordTokens(record, name) {
  const value = record?.[name]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function quotaWindows(quota) {
  if (!quota || typeof quota !== 'object' || !Array.isArray(quota.windows)) return []
  const windows = []
  for (const window of quota.windows) {
    if (!window || typeof window !== 'object' || Array.isArray(window)) continue
    const label = typeof window.label === 'string' && window.label.trim() !== '' ? window.label.trim() : null
    const usedPercent = typeof window.usedPercent === 'number' && Number.isFinite(window.usedPercent) ? window.usedPercent : null
    if (label === null || usedPercent === null) continue
    const reset = typeof window.resetsAt === 'string' && window.resetsAt.trim() !== '' ? Date.parse(window.resetsAt) : NaN
    windows.push({
      label,
      usedPercent,
      resetsAt: Number.isFinite(reset) ? new Date(reset).toISOString() : null,
    })
  }
  return windows
}

function quotaRows(records, now) {
  let newest = null
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') continue
    const windows = quotaWindows(record.quota)
    if (windows.length === 0) continue
    const at = Date.parse(record.quota?.at ?? record.startedAt)
    if (!Number.isFinite(at)) continue
    if (!newest || at >= newest.at) newest = { at, windows }
  }
  if (!newest) return []
  const windows = newest.windows.filter((window) => {
    const reset = window.resetsAt === null ? NaN : Date.parse(window.resetsAt)
    return !Number.isFinite(reset) || reset > now
  })
  if (windows.length === 0) return []
  return [{ provider: 'codex', windows, at: new Date(newest.at).toISOString() }]
}

const TOKEN_TOTAL_KEYS = [
  ['input', 'hasInput'],
  ['output', 'hasOutput'],
  ['cacheRead', 'hasCacheRead'],
  ['cacheWrite', 'hasCacheWrite'],
  ['cacheInput', 'hasCacheInput'],
]

function emptyTotals() {
  return {
    cost: 0,
    today: 0,
    hasCost: false,
    failed: 0,
    missingCostRuns: 0,
    runs: 0,
    input: 0,
    output: 0,
    hasInput: false,
    hasOutput: false,
    cacheRead: 0,
    cacheWrite: 0,
    cacheInput: 0,
    hasCacheRead: false,
    hasCacheWrite: false,
    hasCacheInput: false,
    cacheKnownRuns: 0,
  }
}

function cacheFields(total) {
  return {
    cacheReadTokens: total && total.hasCacheRead ? Math.round(total.cacheRead) : null,
    cacheWriteTokens: total && total.hasCacheWrite ? Math.round(total.cacheWrite) : null,
    cacheInputTokens: total && total.hasCacheInput ? Math.round(total.cacheInput) : null,
    cacheKnownRuns: total ? total.cacheKnownRuns : 0,
    runs: total ? total.runs : 0,
  }
}

export function laneCosts({ records = [], agents = [], now = Date.now() } = {}) {
  const from = monthStart(now)
  const to = nextMonth(from)
  const today = dayStart(now)
  const totals = new Map()

  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') continue
    const lane = typeof record.lane === 'string' ? record.lane : ''
    if (!lane) continue
    const started = Date.parse(record.startedAt)
    if (!Number.isFinite(started) || started < from || started >= to) continue
    let total = totals.get(lane)
    if (!total) {
      total = emptyTotals()
      totals.set(lane, total)
    }
    total.runs += 1
    const cost = recordCost(record)
    if (cost !== null) {
      total.cost += cost
      total.hasCost = true
      if (started >= today) total.today += cost
      if (recordFailedOrStopped(record)) total.failed += cost
    } else {
      total.missingCostRuns += 1
    }
    const input = recordTokens(record, 'inputTokens')
    if (input !== null) {
      total.input += input
      total.hasInput = true
    }
    const output = recordTokens(record, 'outputTokens')
    if (output !== null) {
      total.output += output
      total.hasOutput = true
    }
    const cacheRead = recordTokens(record, 'cacheReadTokens')
    const cacheWrite = recordTokens(record, 'cacheWriteTokens')
    if (cacheRead !== null) {
      total.cacheRead += cacheRead
      total.hasCacheRead = true
      if (input !== null) {
        total.cacheInput += input
        total.hasCacheInput = true
      }
    }
    if (cacheWrite !== null) {
      total.cacheWrite += cacheWrite
      total.hasCacheWrite = true
    }
    if (cacheRead !== null || cacheWrite !== null) {
      total.cacheKnownRuns += 1
    }
  }

  const roster = []
  const rosterKeys = new Set()
  for (const agent of Array.isArray(agents) ? agents : []) {
    if (!agent || typeof agent !== 'object') continue
    const agentId = String(agent.id ?? '')
    if (!agentId) continue
    const key = String(agent.key ?? '')
    if (key) rosterKeys.add(key)
    roster.push({ agentId, key, name: String(agent.name ?? key ?? agentId) })
  }

  const byAgent = roster.map((agent) => {
    const total = agent.key ? totals.get(agent.key) : null
    return {
      agentId: agent.agentId,
      agentName: agent.name,
      costCents: total ? (total.hasCost ? Math.round(total.cost * 100) : null) : 0,
      todayCents: total ? (total.hasCost ? Math.round(total.today * 100) : null) : 0,
      inputTokens: total ? (total.hasInput ? total.input : null) : 0,
      outputTokens: total ? (total.hasOutput ? total.output : null) : 0,
      ...cacheFields(total),
      missingCostRuns: total ? total.missingCostRuns : 0,
      failedCost: total ? Math.round(total.failed * 100) : 0,
    }
  })

  let removed = null
  for (const [lane, total] of totals) {
    if (rosterKeys.has(lane)) continue
    if (!removed) {
      removed = { ...emptyTotals(), costCents: 0, todayCents: 0, failedCost: 0 }
    }
    if (total.hasCost) removed.hasCost = true
    removed.costCents += Math.round(total.cost * 100)
    removed.todayCents += Math.round(total.today * 100)
    removed.failedCost += Math.round(total.failed * 100)
    removed.missingCostRuns += total.missingCostRuns
    removed.runs += total.runs
    removed.cacheKnownRuns += total.cacheKnownRuns
    for (const [sumKey, hasKey] of TOKEN_TOTAL_KEYS) {
      if (total[hasKey]) {
        removed[sumKey] += total[sumKey]
        removed[hasKey] = true
      }
    }
  }
  if (removed && (removed.costCents > 0 || removed.missingCostRuns > 0 || removed.hasInput || removed.hasOutput || removed.cacheKnownRuns > 0)) {
    byAgent.push({
      agentId: 'removed-lanes',
      agentName: 'Removed lanes',
      costCents: removed.hasCost ? removed.costCents : null,
      todayCents: removed.hasCost ? removed.todayCents : null,
      inputTokens: removed.hasInput ? removed.input : null,
      outputTokens: removed.hasOutput ? removed.output : null,
      ...cacheFields(removed),
      missingCostRuns: removed.missingCostRuns,
      failedCost: removed.failedCost,
    })
  }

  const spendCents = byAgent.reduce((sum, row) => sum + (row.costCents ?? 0), 0)
  const partial = byAgent.some((row) => row.missingCostRuns > 0)
  return {
    summary: { spendCents, budgetCents: 0, utilizationPercent: null, ...(partial ? { partial: true } : {}) },
    byAgent,
    quota: quotaRows(records, now),
  }
}

export function readLaneCosts({ agents = [], file = runsFile(), now = Date.now(), records = null } = {}) {
  const runRecords = records ?? cachedRunRecords(file)
  return laneCosts({ records: runRecords, agents, now })
}
