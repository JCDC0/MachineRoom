import { readAllRunRecords, runsFile } from './runs.js'

function monthStart(time) {
  const date = new Date(time)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

function nextMonth(start) {
  const date = new Date(start)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
}

function recordCost(record) {
  return typeof record?.costUsd === 'number' && Number.isFinite(record.costUsd) ? record.costUsd : null
}

export function laneCosts({ records = [], agents = [], now = Date.now() } = {}) {
  const from = monthStart(now)
  const to = nextMonth(from)
  const totals = new Map()

  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') continue
    const lane = typeof record.lane === 'string' ? record.lane : ''
    if (!lane) continue
    const started = Date.parse(record.startedAt)
    if (!Number.isFinite(started) || started < from || started >= to) continue
    const cost = recordCost(record)
    if (cost === null) continue
    totals.set(lane, (totals.get(lane) ?? 0) + cost)
  }

  const byAgent = []
  for (const agent of Array.isArray(agents) ? agents : []) {
    if (!agent || typeof agent !== 'object') continue
    const agentId = String(agent.id ?? '')
    if (!agentId) continue
    const key = String(agent.key ?? '')
    const total = key ? totals.get(key) ?? 0 : 0
    byAgent.push({
      agentId,
      agentName: String(agent.name ?? key ?? agentId),
      costCents: Math.round(total * 100),
      inputTokens: null,
      outputTokens: null,
    })
  }

  const spendCents = byAgent.reduce((sum, row) => sum + row.costCents, 0)
  return {
    summary: { spendCents, budgetCents: 0, utilizationPercent: null },
    byAgent,
    quota: [],
  }
}

export function readLaneCosts({ agents = [], file = runsFile(), now = Date.now() } = {}) {
  return laneCosts({ records: readAllRunRecords(file), agents, now })
}
