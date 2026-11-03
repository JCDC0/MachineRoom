import { statSync } from 'node:fs'
import { readAllRunRecords, runsFile } from './runs.js'

const recordCaches = new Map()

export function clearRunRecordsCache() {
  recordCaches.clear()
}

export function cachedRunRecords(file = runsFile()) {
  let stat
  try {
    stat = statSync(file)
  } catch {
    recordCaches.delete(file)
    return []
  }
  const cached = recordCaches.get(file)
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.records
  }
  const records = readAllRunRecords(file)
  recordCaches.set(file, {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    records,
  })
  return records
}

function monthStart(time) {
  const date = new Date(time)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

function nextMonth(start) {
  const date = new Date(start)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
}

function dayStart(time) {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function recordCost(record) {
  return typeof record?.costUsd === 'number' && Number.isFinite(record.costUsd) ? record.costUsd : null
}

function recordTokens(record, name) {
  const value = record?.[name]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
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
      total = { cost: 0, today: 0, input: 0, output: 0, hasInput: false, hasOutput: false }
      totals.set(lane, total)
    }
    const cost = recordCost(record)
    if (cost !== null) {
      total.cost += cost
      if (started >= today) total.today += cost
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
  }

  const byAgent = []
  for (const agent of Array.isArray(agents) ? agents : []) {
    if (!agent || typeof agent !== 'object') continue
    const agentId = String(agent.id ?? '')
    if (!agentId) continue
    const key = String(agent.key ?? '')
    const total = key ? totals.get(key) : null
    byAgent.push({
      agentId,
      agentName: String(agent.name ?? key ?? agentId),
      costCents: Math.round((total?.cost ?? 0) * 100),
      todayCents: Math.round((total?.today ?? 0) * 100),
      inputTokens: total?.hasInput ? total.input : null,
      outputTokens: total?.hasOutput ? total.output : null,
    })
  }

  const spendCents = byAgent.reduce((sum, row) => sum + row.costCents, 0)
  return {
    summary: { spendCents, budgetCents: 0, utilizationPercent: null },
    byAgent,
    quota: [],
  }
}

export function readLaneCosts({ agents = [], file = runsFile(), now = Date.now(), records = null } = {}) {
  const runRecords = records ?? cachedRunRecords(file)
  return laneCosts({ records: runRecords, agents, now })
}
