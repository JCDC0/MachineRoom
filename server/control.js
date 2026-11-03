import { EFFORTS } from '../src/control/agents.js'
import { readLaneCosts } from './lane-costs.js'
import { LANE_TASK_REFUSAL, laneTaskState, readLaneBriefs, readRecentLaneRecords } from './lane-tasks.js'
import { laneAgents, readLanes } from './lanes-source.js'
import { MODELS } from './models.js'
import { runsFile } from './runs.js'

const AGENT_STATUS = {
  active: 'idle',
  idle: 'idle',
  running: 'running',
  paused: 'paused',
  error: 'error',
  pending_approval: 'pending_approval',
  terminated: 'error',
}

const EFFORT_KEYS = {
  claude_local: 'effort',
  codex_local: 'modelReasoningEffort',
  grok_local: 'reasoningEffort',
  kimi_local: 'effort',
  opencode_local: 'variant',
  pi_local: 'thinking',
}

const RUN_NOTICES = new Set(['heartbeat.run.queued', 'heartbeat.run.status'])
const DECISION_ROUTES = { approve: 'approve', reject: 'reject', 'request-revision': 'request-revision' }
export const AGENT_REFUSAL = 'Agents come from docs/agents/lanes.json.'

function plainId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function decodedId(text) {
  try {
    return decodeURIComponent(text)
  } catch {
    return null
  }
}

function money(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0
}

function slugKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function keyOf(raw) {
  return String(raw?.urlKey ?? raw?.key ?? '').trim() || slugKey(raw?.name ?? raw?.id) || 'agent'
}

function setting(raw, name) {
  const value = raw?.adapterConfig?.[name]
  return Number.isInteger(value) ? value : null
}

function effortOf(raw) {
  const key = EFFORT_KEYS[String(raw?.adapterType ?? '')]
  const fromConfig = key ? raw?.adapterConfig?.[key] : undefined
  if (EFFORTS.includes(fromConfig)) return fromConfig
  const fromMeta = raw?.metadata?.reasoningEffort
  return EFFORTS.includes(fromMeta) ? fromMeta : null
}

function subagentsOf(raw) {
  const saved = raw?.metadata?.subagents && typeof raw.metadata.subagents === 'object' ? raw.metadata.subagents : {}
  const allowed = saved.allowed === true
  const depth = Number.isInteger(saved.depth) && saved.depth >= 1 && saved.depth <= 3 ? saved.depth : allowed ? 1 : 0
  return { subagentsAllowed: allowed, subagentDepth: allowed ? depth : 0 }
}

export function changeEvents(frame) {
  const type = frame?.type
  const payload = frame?.payload ?? {}
  if (type === 'agent.status') return [{ topic: 'agents' }]
  if (RUN_NOTICES.has(type)) {
    const costs = type === 'heartbeat.run.status' && ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(payload.status) ? [{ topic: 'costs' }] : []
    return [{ topic: 'agents' }, { topic: 'issues' }, ...costs, { topic: 'liveRuns' }, { topic: 'runs' }]
  }
  if (type !== 'activity.logged') return []
  const action = String(payload.action ?? '')
  const entity = String(payload.entityType ?? '')
  if (entity === 'issue') {
    if (action === 'issue.comment_added' || action === 'issue.comment.created') {
      return [{ topic: 'comments', id: payload.entityId }]
    }
    return [{ topic: 'issues' }]
  }
  if (entity === 'agent') {
    const changed = Array.isArray(payload.details?.changedTopLevelKeys) ? payload.details.changedTopLevelKeys : []
    const budget = action.includes('budget') || changed.includes('budgetMonthlyCents')
    return budget ? [{ topic: 'agents' }, { topic: 'costs' }] : [{ topic: 'agents' }]
  }
  if (entity === 'approval') return [{ topic: 'approvals' }]
  if (entity === 'cost_event' || entity === 'finance_event' || entity === 'budget_policy' || entity === 'budget_incident') {
    return [{ topic: 'costs' }]
  }
  if (entity === 'company' && action.includes('budget')) return [{ topic: 'costs' }]
  return []
}

export function mapAgent(raw, spendCents) {
  const name = String(raw?.name ?? raw?.id ?? 'agent')
  return {
    id: String(raw?.id ?? ''),
    key: keyOf(raw),
    name,
    adapterType: String(raw?.adapterType ?? ''),
    role: String(raw?.role ?? 'general'),
    status: AGENT_STATUS[raw?.status] ?? 'idle',
    model: (typeof raw?.adapterConfig?.model === 'string' && raw.adapterConfig.model) || (typeof raw?.model === 'string' && raw.model) || null,
    reasoningEffort: effortOf(raw),
    maxTurnsPerRun: setting(raw, 'maxTurnsPerRun'),
    timeoutSec: setting(raw, 'timeoutSec'),
    ...subagentsOf(raw),
    instructions: '',
    reportsToAgentId: plainId(raw?.reportsTo) || null,
    budgetMonthlyCents: money(raw?.budgetMonthlyCents),
    spentMonthlyCents: Number.isInteger(spendCents) ? spendCents : money(raw?.spentMonthlyCents),
  }
}

export function mapCosts(costs) {
  return {
    summary: {
      spendCents: money(costs?.summary?.spendCents),
      budgetCents: money(costs?.summary?.budgetCents),
      utilizationPercent: Number.isFinite(costs?.summary?.utilizationPercent) ? costs.summary.utilizationPercent : null,
    },
    byAgent: (Array.isArray(costs?.byAgent) ? costs.byAgent : []).map((row) => ({
      agentId: String(row?.agentId ?? ''),
      agentName: String(row?.agentName ?? ''),
      costCents: money(row?.costCents),
      inputTokens: Number.isInteger(row?.inputTokens) && row.inputTokens >= 0 ? row.inputTokens : null,
      outputTokens: Number.isInteger(row?.outputTokens) && row.outputTokens >= 0 ? row.outputTokens : null,
    })),
    quota: [],
  }
}

export function createControlApi(options) {
  const { sendJson, readJsonBody } = options
  const lanes = typeof options.lanes === 'function' ? options.lanes : () => null

  function laneNow() {
    try {
      const source = lanes()
      return source && typeof source.openRuns === 'function' ? source : null
    } catch {
      return null
    }
  }

  function laneAgentList() {
    try {
      const source = lanes()
      if (source && Array.isArray(source.agents)) return source.agents
    } catch {}
    return laneAgents(readLanes())
  }

  function laneCosts(agents = laneAgentList()) {
    try {
      return readLaneCosts({ agents })
    } catch {
      return readLaneCosts({ agents: [] })
    }
  }

  function laneState() {
    const source = laneNow()
    let openRuns = []
    if (source) {
      try {
        openRuns = source.openRuns()
      } catch {
        openRuns = []
      }
    }
    return laneTaskState({
      openRuns,
      agents: laneAgentList(),
      records: readRecentLaneRecords(runsFile()),
      briefs: readLaneBriefs(),
    })
  }

  function fail(req, res, status, message) {
    sendJson(req, res, status, { error: message })
  }

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'

    if (method === 'GET' && path === '/api/control/models') {
      sendJson(req, res, 200, MODELS)
      return true
    }

    if (method === 'GET' && path === '/api/control/agents') {
      const agents = laneAgentList()
      const costs = laneCosts(agents)
      const cents = new Map(costs.byAgent.map((row) => [row.agentId, row.costCents]))
      sendJson(
        req,
        res,
        200,
        agents.map((agent) => ({ ...mapAgent(agent, cents.get(agent.id)), role: null }))
      )
      return true
    }

    if (method === 'POST' && path === '/api/control/agents') {
      const body = await readJsonBody(req, res)
      if (body === null) return true
      fail(req, res, 409, AGENT_REFUSAL)
      return true
    }

    const updateAgent = /^\/api\/control\/agents\/([^/]+)$/.exec(path)
    if (method === 'PATCH' && updateAgent) {
      const id = decodedId(updateAgent[1])
      if (id === null) {
        fail(req, res, 404, 'That agent no longer exists.')
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      fail(req, res, 409, AGENT_REFUSAL)
      return true
    }

    if (method === 'GET' && path === '/api/control/issues') {
      const status = url.searchParams.get('status')
      const issues = laneState().issues
      sendJson(req, res, 200, status ? issues.filter((issue) => issue.status === status) : issues)
      return true
    }

    if (method === 'GET' && path === '/api/control/live-runs') {
      sendJson(req, res, 200, { runs: laneState().liveRuns })
      return true
    }

    if (method === 'POST' && path === '/api/control/issues') {
      const body = await readJsonBody(req, res)
      if (body === null) return true
      fail(req, res, 409, LANE_TASK_REFUSAL)
      return true
    }

    if (method === 'GET' && path === '/api/control/comments') {
      sendJson(req, res, 200, [])
      return true
    }

    if (method === 'POST' && path === '/api/control/comments') {
      const body = await readJsonBody(req, res)
      if (body === null) return true
      fail(req, res, 409, LANE_TASK_REFUSAL)
      return true
    }

    if (method === 'GET' && path === '/api/control/approvals') {
      sendJson(req, res, 200, [])
      return true
    }

    const decide = /^\/api\/control\/approvals\/([^/]+)\/decide$/.exec(path)
    if (method === 'POST' && decide) {
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const decision = typeof body?.decision === 'string' ? body.decision : ''
      if (!Object.hasOwn(DECISION_ROUTES, decision)) {
        sendJson(req, res, 400, { error: `Unknown decision: ${decision}` })
        return true
      }
      sendJson(req, res, 404, { error: 'That approval no longer exists.' })
      return true
    }

    const budget = /^\/api\/control\/agents\/([^/]+)\/budget$/.exec(path)
    if (method === 'POST' && budget) {
      if (decodedId(budget[1]) === null) {
        sendJson(req, res, 404, { error: 'That agent no longer exists.' })
        return true
      }
      const body = await readJsonBody(req, res)
      if (body === null) return true
      fail(req, res, 409, AGENT_REFUSAL)
      return true
    }

    if (method === 'GET' && path === '/api/control/costs') {
      sendJson(req, res, 200, mapCosts(laneCosts()))
      return true
    }

    if (path.startsWith('/api/control/')) {
      sendJson(req, res, 404, { error: 'not found' })
      return true
    }
    return false
  }

  return { handle }
}
