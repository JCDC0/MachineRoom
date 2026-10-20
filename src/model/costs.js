const NOT_AVAILABLE = 'Not available.'
const NOT_REPORTED = [null, 0]

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function countOrNull(value) {
  const number = finiteOrNull(value)
  return number === null || number < 0 ? null : number
}

function textOrNull(value) {
  return typeof value === 'string' && value !== '' ? value : null
}

function roundTo(value, places) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function readSummary(summary) {
  const source = isPlainObject(summary) ? summary : {}
  const spendCents = finiteOrNull(source.spendCents) ?? 0
  const budgetCents = finiteOrNull(source.budgetCents) ?? 0
  const utilization = finiteOrNull(source.utilizationPercent)
  let percent = null
  if (utilization !== null) percent = utilization
  else if (budgetCents > 0) percent = roundTo((spendCents / budgetCents) * 100, 1)
  return { spendCents, budgetCents, percent, over: budgetCents > 0 && spendCents > budgetCents }
}

function readRoster(roster) {
  if (!Array.isArray(roster)) return []
  const seen = new Set()
  const agents = []
  for (const item of roster) {
    if (!isPlainObject(item)) continue
    const id = textOrNull(item.id)
    if (id !== null && seen.has(id)) continue
    if (id !== null) seen.add(id)
    agents.push({ id, key: textOrNull(item.key), name: textOrNull(item.name) })
  }
  return agents
}

function readByAgent(byAgent) {
  const index = new Map()
  if (!Array.isArray(byAgent)) return index
  for (const item of byAgent) {
    if (!isPlainObject(item)) continue
    const agentId = textOrNull(item.agentId)
    if (index.has(agentId)) continue
    index.set(agentId, item)
  }
  return index
}

function rowFor(agent, source) {
  const costCents = countOrNull(source?.costCents)
  const inputTokens = countOrNull(source?.inputTokens)
  const outputTokens = countOrNull(source?.outputTokens)
  const numbers = [costCents, inputTokens, outputTokens]
  const reported = Boolean(source) && !numbers.every((value) => NOT_REPORTED.includes(value))
  const name = agent.name ?? textOrNull(source?.agentName) ?? agent.id ?? textOrNull(source?.agentId)
  return {
    key: agent.key,
    agentId: agent.id ?? textOrNull(source?.agentId),
    name: name ?? null,
    costCents: reported ? costCents : null,
    inputTokens: reported ? inputTokens : null,
    outputTokens: reported ? outputTokens : null,
    reported,
    share: null,
  }
}

function compareRows(left, right) {
  const leftCost = left.costCents ?? 0
  const rightCost = right.costCents ?? 0
  if (leftCost !== rightCost) return rightCost - leftCost
  const leftName = left.name ?? ''
  const rightName = right.name ?? ''
  if (leftName === rightName) return 0
  return leftName < rightName ? -1 : 1
}

function readQuota(quota) {
  if (!Array.isArray(quota)) return []
  const rows = []
  for (const provider of quota) {
    if (!isPlainObject(provider)) continue
    const name = textOrNull(provider.provider)
    if (provider.ok === false) {
      rows.push({ provider: name, label: null, usedPercent: null, resetsAt: null, error: textOrNull(provider.error) ?? NOT_AVAILABLE })
      continue
    }
    const windows = Array.isArray(provider.windows) ? provider.windows : []
    for (const window of windows) {
      if (!isPlainObject(window)) continue
      rows.push({
        provider: name,
        label: textOrNull(window.label),
        usedPercent: finiteOrNull(window.usedPercent),
        resetsAt: textOrNull(window.resetsAt),
        error: null,
      })
    }
  }
  return rows
}

export function costBoard(costs, roster) {
  const source = isPlainObject(costs) ? costs : {}
  const summary = readSummary(source.summary)
  const index = readByAgent(source.byAgent)
  const agents = readRoster(roster)
  const matched = new Set()
  const rows = []
  for (const agent of agents) {
    const entry = index.get(agent.id)
    if (entry) matched.add(agent.id)
    rows.push(rowFor(agent, entry))
  }
  const rest = []
  for (const [agentId, entry] of index) {
    if (matched.has(agentId)) continue
    rest.push(rowFor({ id: agentId, key: null, name: null }, entry))
  }
  rest.sort(compareRows)
  rows.push(...rest)
  const reportedTotal = rows.reduce((total, row) => (row.reported ? total + (row.costCents ?? 0) : total), 0)
  for (const row of rows) {
    if (!row.reported || reportedTotal <= 0) continue
    row.share = roundTo((row.costCents ?? 0) / reportedTotal, 3)
  }
  return { summary, rows, quota: readQuota(source.quota) }
}
