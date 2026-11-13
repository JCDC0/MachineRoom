import { cachedRunRecords, clearRunsCache, runsFile } from './runs.js'

export function clearRunRecordsCache() {
  clearRunsCache()
}

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
      costCents: Math.round((total?.cost ?? 0) * 100),
      todayCents: Math.round((total?.today ?? 0) * 100),
      inputTokens: total?.hasInput ? total.input : null,
      outputTokens: total?.hasOutput ? total.output : null,
    }
  })

  let removed = null
  for (const [lane, total] of totals) {
    if (rosterKeys.has(lane)) continue
    if (!removed) {
      removed = { cost: 0, today: 0, input: 0, output: 0, hasInput: false, hasOutput: false }
    }
    removed.cost += total.cost
    removed.today += total.today
    if (total.hasInput) {
      removed.input += total.input
      removed.hasInput = true
    }
    if (total.hasOutput) {
      removed.output += total.output
      removed.hasOutput = true
    }
  }
  const removedCents = removed ? Math.round(removed.cost * 100) : 0
  if (removedCents > 0) {
    byAgent.push({
      agentId: 'removed-lanes',
      agentName: 'Removed lanes',
      costCents: removedCents,
      todayCents: Math.round(removed.today * 100),
      inputTokens: removed.hasInput ? removed.input : null,
      outputTokens: removed.hasOutput ? removed.output : null,
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
