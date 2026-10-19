import { EFFORTS, cleanAgentDraft, cleanAgentPatch } from '../src/control/agents.js'
import { MODELS } from './models.js'

const AGENT_STATUS = {
  active: 'idle',
  idle: 'idle',
  running: 'running',
  paused: 'paused',
  error: 'error',
  pending_approval: 'pending_approval',
  terminated: 'error',
}

const OVERRIDE_KEYS = ['model', 'maxTurnsPerRun', 'timeoutSec', 'subagentsAllowed']
const CONFIG_SETTING_KEYS = ['model', 'maxTurnsPerRun', 'timeoutSec']
const EFFORT_KEYS = {
  claude_local: 'effort',
  codex_local: 'modelReasoningEffort',
  grok_local: 'reasoningEffort',
  kimi_local: 'effort',
  opencode_local: 'variant',
  paperclip_runner: 'modelReasoningEffort',
  pi_local: 'thinking',
}
const TERMINAL_RUN = new Set(['succeeded', 'failed', 'cancelled', 'timed_out'])
const DECISION_ROUTES = { approve: 'approve', reject: 'reject', 'request-revision': 'request-revision' }

function plainId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
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
  return String(raw?.urlKey ?? '').trim() || slugKey(raw?.name ?? raw?.id) || 'agent'
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

function metadataOf(raw) {
  return raw?.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? { ...raw.metadata } : {}
}

function mergedSubagents(changes, raw) {
  const before = subagentsOf(raw)
  const allowed = 'subagentsAllowed' in changes ? changes.subagentsAllowed : before.subagentsAllowed
  let depth = 'subagentDepth' in changes ? changes.subagentDepth : before.subagentDepth
  if ('subagentsAllowed' in changes) {
    if (!allowed) depth = 0
    else if (!('subagentDepth' in changes) && depth === 0) depth = 1
  }
  return { allowed, depth }
}

export function changeEvents(frame) {
  const type = frame?.type
  const payload = frame?.payload ?? {}
  if (type === 'agent.status' || type === 'heartbeat.run.queued') return [{ topic: 'agents' }]
  if (type === 'heartbeat.run.status') {
    return TERMINAL_RUN.has(payload.status) ? [{ topic: 'agents' }, { topic: 'costs' }] : [{ topic: 'agents' }]
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
    model: typeof raw?.adapterConfig?.model === 'string' && raw.adapterConfig.model ? raw.adapterConfig.model : null,
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

export function mapOverrides(overrides) {
  const config = overrides?.adapterConfig
  if (!config || typeof config !== 'object') return null
  const out = {}
  for (const key of OVERRIDE_KEYS) {
    if (config[key] !== undefined && config[key] !== null && config[key] !== '') out[key] = config[key]
  }
  return Object.keys(out).length ? out : null
}

export function mapIssue(raw) {
  return {
    id: String(raw?.id ?? ''),
    identifier: String(raw?.identifier ?? ''),
    title: String(raw?.title ?? ''),
    description: String(raw?.description ?? ''),
    status: String(raw?.status ?? 'todo'),
    priority: String(raw?.priority ?? 'medium'),
    assigneeAgentId: plainId(raw?.assigneeAgentId) || null,
    parentId: plainId(raw?.parentId) || null,
    overrides: mapOverrides(raw?.assigneeAdapterOverrides),
    createdAt: String(raw?.createdAt ?? ''),
    updatedAt: String(raw?.updatedAt ?? ''),
  }
}

export function mapComment(raw, agentNames = new Map()) {
  const authorAgentId = plainId(raw?.authorAgentId) || null
  const name =
    typeof raw?.authorName === 'string' && raw.authorName
      ? raw.authorName
      : authorAgentId
        ? agentNames.get(authorAgentId) ?? 'Agent'
        : 'You'
  return {
    id: String(raw?.id ?? ''),
    issueId: String(raw?.issueId ?? ''),
    authorAgentId,
    authorName: name,
    body: String(raw?.body ?? ''),
    createdAt: String(raw?.createdAt ?? ''),
  }
}

export function mapApproval(raw, decisionNote) {
  const payload = raw?.payload && typeof raw.payload === 'object' ? raw.payload : {}
  const note = raw?.decisionNote ?? raw?.decision?.note ?? payload.decisionNote ?? decisionNote
  const approval = {
    id: String(raw?.id ?? ''),
    type: String(raw?.type ?? ''),
    status: String(raw?.status ?? 'pending'),
    summary: String(raw?.summary ?? payload.summary ?? payload.title ?? ''),
    requestedByAgentId: plainId(raw?.requestedByAgentId) || null,
    createdAt: String(raw?.createdAt ?? ''),
  }
  const agentId = plainId(raw?.agentId) || plainId(payload.agentId)
  if (agentId) approval.agentId = agentId
  if (note) approval.decisionNote = String(note)
  return approval
}

export function mapCosts({ summary, rows, quota }) {
  return {
    summary: {
      spendCents: money(summary?.spendCents),
      budgetCents: money(summary?.budgetCents),
      utilizationPercent: Number.isFinite(summary?.utilizationPercent) ? summary.utilizationPercent : 0,
    },
    byAgent: (Array.isArray(rows) ? rows : []).map((row) => ({
      agentId: String(row?.agentId ?? ''),
      agentName: String(row?.agentName ?? ''),
      costCents: money(row?.costCents),
      inputTokens: money(row?.inputTokens),
      outputTokens: money(row?.outputTokens),
    })),
    quota: (Array.isArray(quota) ? quota : []).map((entry) => {
      const item = {
        provider: String(entry?.provider ?? ''),
        ok: entry?.ok !== false,
        windows: (Array.isArray(entry?.windows) ? entry.windows : []).map((window) => ({
          label: String(window?.label ?? ''),
          usedPercent: Number.isFinite(window?.usedPercent) ? window.usedPercent : null,
          resetsAt: typeof window?.resetsAt === 'string' && window.resetsAt ? window.resetsAt : null,
          detail: typeof window?.detail === 'string' && window.detail ? window.detail : null,
        })),
      }
      if (entry?.error) item.error = String(entry.error)
      return item
    }),
  }
}

export function buildCreateIssueBody(draft, overrides, project = {}) {
  const body = {
    title: String(draft.title).trim(),
    description: String(draft.description ?? ''),
    assigneeAgentId: draft.assigneeAgentId,
    priority: draft.priority ?? 'medium',
    status: 'todo',
  }
  if (project.projectId) body.projectId = project.projectId
  if (project.projectWorkspaceId) body.projectWorkspaceId = project.projectWorkspaceId
  if (overrides) body.assigneeAdapterOverrides = { adapterConfig: overrides }
  return body
}

export function issueOverrides(draft) {
  if (!draft || typeof draft !== 'object') return null
  const out = {}
  for (const key of OVERRIDE_KEYS) {
    if (draft[key] !== undefined && draft[key] !== null && draft[key] !== '') out[key] = draft[key]
  }
  return Object.keys(out).length ? out : null
}

export function buildHireBody(clean) {
  const adapterConfig = {}
  for (const key of CONFIG_SETTING_KEYS) {
    if (clean[key] !== null) adapterConfig[key] = clean[key]
  }
  const effortKey = EFFORT_KEYS[clean.adapterType]
  if (effortKey && clean.reasoningEffort !== null) adapterConfig[effortKey] = clean.reasoningEffort
  const metadata = { subagents: { allowed: clean.subagentsAllowed, depth: clean.subagentDepth } }
  if (!effortKey && clean.reasoningEffort !== null) metadata.reasoningEffort = clean.reasoningEffort
  const body = {
    name: clean.name,
    role: clean.role,
    adapterType: clean.adapterType,
    adapterConfig,
    metadata,
    budgetMonthlyCents: clean.budgetMonthlyCents,
  }
  if (clean.reportsToAgentId !== null) body.reportsTo = clean.reportsToAgentId
  if (clean.instructions) {
    body.instructionsBundle = { entryFile: 'AGENTS.md', files: { 'AGENTS.md': clean.instructions } }
  }
  return body
}

export function buildUpdateBody(clean, raw) {
  const changes = { ...clean }
  const budgetMonthlyCents = 'budgetMonthlyCents' in changes ? changes.budgetMonthlyCents : undefined
  delete changes.budgetMonthlyCents
  const status = changes.status
  delete changes.status
  const patch = {}
  if ('name' in changes) patch.name = changes.name
  if ('role' in changes) patch.role = changes.role
  if ('reportsToAgentId' in changes) patch.reportsTo = changes.reportsToAgentId
  const adapterConfig = {}
  for (const key of CONFIG_SETTING_KEYS) {
    if (key in changes) adapterConfig[key] = changes[key]
  }
  const effortKey = EFFORT_KEYS[String(raw?.adapterType ?? '')]
  if ('reasoningEffort' in changes && effortKey) adapterConfig[effortKey] = changes.reasoningEffort
  if (Object.keys(adapterConfig).length) patch.adapterConfig = adapterConfig
  const metadata = metadataOf(raw)
  let metadataChanged = false
  if ('reasoningEffort' in changes && !effortKey) {
    metadataChanged = true
    if (changes.reasoningEffort === null) delete metadata.reasoningEffort
    else metadata.reasoningEffort = changes.reasoningEffort
  }
  if ('subagentsAllowed' in changes || 'subagentDepth' in changes) {
    metadataChanged = true
    metadata.subagents = mergedSubagents(changes, raw)
  }
  if (metadataChanged) patch.metadata = metadata
  if (status !== undefined) patch.status = status === 'paused' ? 'paused' : 'idle'
  return { patch, budgetMonthlyCents }
}

export function createControlApi(options) {
  const { paperclipUrl, companyId, projectId, projectWorkspaceId, sendJson, readJsonBody } = options
  const base = String(paperclipUrl).replace(/\/+$/, '')

  async function upstream(method, path, body) {
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      let json = null
      try {
        json = await response.json()
      } catch {
        json = null
      }
      return { status: response.status, json }
    } catch {
      return { status: 0, json: null }
    }
  }

  function fail(req, res, status, message) {
    sendJson(req, res, status, { error: message })
  }

  function upstreamFailure(answer, missing, generic) {
    if (answer.status === 0) return [502, 'Paperclip is not reachable.']
    if (answer.status === 404) return [404, missing]
    if (answer.status >= 500) return [502, 'Paperclip could not complete that.']
    return [400, generic]
  }

  async function sendAgent(req, res, agentId) {
    const spend = await upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/costs/by-agent`)
    const agents = await upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/agents`)
    if (agents.status !== 200) {
      const [status, message] = upstreamFailure(agents, 'That agent no longer exists.', 'Paperclip could not read the agents.')
      fail(req, res, status, message)
      return
    }
    const rows = Array.isArray(spend.json) ? spend.json : []
    const list = Array.isArray(agents.json) ? agents.json : []
    const found = list.find((agent) => agent?.id === agentId)
    if (!found) {
      fail(req, res, 404, 'That agent no longer exists.')
      return
    }
    const row = rows.find((item) => item?.agentId === agentId)
    sendJson(req, res, 200, mapAgent(found, Number.isInteger(row?.costCents) ? row.costCents : undefined))
  }

  async function readAgents(req, res) {
    const answer = await upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/agents`)
    if (answer.status !== 200) {
      const [code, message] = upstreamFailure(answer, 'That agent no longer exists.', 'Paperclip could not read the agents.')
      fail(req, res, code, message)
      return null
    }
    return Array.isArray(answer.json) ? answer.json : []
  }

  async function hireApproval(rawAgent, fromAnswer) {
    const company = await upstream('GET', `/api/companies/${encodeURIComponent(companyId)}`)
    const flagged = company.json?.requireBoardApprovalForNewAgents === true
    const waiting = rawAgent?.status === 'pending_approval'
    if (!flagged && !waiting) return null
    const listed = await upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/approvals`)
    const rows = Array.isArray(listed.json) ? listed.json : []
    const ofAgent = (row) => row?.type === 'hire_agent' && plainId(row?.payload?.agentId ?? row?.agentId) === plainId(rawAgent?.id)
    const match = rows.find((row) => ofAgent(row) && row?.status === 'pending') ?? rows.find(ofAgent)
    if (match) return mapApproval(match)
    return fromAnswer && typeof fromAnswer === 'object' ? mapApproval(fromAnswer) : null
  }

  async function handle(req, res, url) {
    const path = url.pathname
    const method = req.method ?? 'GET'

    if (method === 'GET' && path === '/api/control/models') {
      sendJson(req, res, 200, MODELS)
      return true
    }

    if (method === 'GET' && path === '/api/control/agents') {
      const [agents, spend] = await Promise.all([
        upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/agents`),
        upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/costs/by-agent`),
      ])
      if (agents.status !== 200 || spend.status !== 200) {
        const [status, message] = upstreamFailure(agents.status !== 200 ? agents : spend, 'That agent no longer exists.', 'Paperclip could not read the agents.')
        sendJson(req, res, status, { error: message })
        return true
      }
      const rows = Array.isArray(spend.json) ? spend.json : []
      const list = Array.isArray(agents.json) ? agents.json : []
      const out = list.map((agent) => {
        const row = rows.find((item) => item?.agentId === agent?.id)
        return mapAgent(agent, Number.isInteger(row?.costCents) ? row.costCents : undefined)
      })
      sendJson(req, res, 200, out)
      return true
    }

    if (method === 'POST' && path === '/api/control/agents') {
      const body = await readJsonBody(req, res)
      if (body === null) return true
      let clean
      try {
        clean = cleanAgentDraft(body)
      } catch (error) {
        fail(req, res, 400, error.message)
        return true
      }
      const key = slugKey(clean.name)
      if (!key) {
        fail(req, res, 400, 'The name needs letters or numbers.')
        return true
      }
      const list = await readAgents(req, res)
      if (list === null) return true
      if (list.some((agent) => keyOf(agent) === key)) {
        fail(req, res, 400, 'An agent with that name already exists.')
        return true
      }
      if (clean.reportsToAgentId && !list.some((agent) => agent?.id === clean.reportsToAgentId)) {
        fail(req, res, 400, 'The agent it reports to no longer exists.')
        return true
      }
      const hired = await upstream('POST', `/api/companies/${encodeURIComponent(companyId)}/agent-hires`, buildHireBody(clean))
      if (hired.status >= 300 || !hired.json) {
        const [code, message] = upstreamFailure(hired, 'Paperclip did not accept that agent.', 'Paperclip did not accept that agent.')
        fail(req, res, code, message)
        return true
      }
      const rawAgent = hired.json.agent ?? hired.json
      const approval = await hireApproval(rawAgent, hired.json.approval)
      sendJson(req, res, 201, { agent: mapAgent(rawAgent), approval })
      return true
    }

    const updateAgent = /^\/api\/control\/agents\/([^/]+)$/.exec(path)
    if (method === 'PATCH' && updateAgent) {
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const id = decodeURIComponent(updateAgent[1])
      const list = await readAgents(req, res)
      if (list === null) return true
      const raw = list.find((agent) => agent?.id === id)
      if (!raw) {
        fail(req, res, 404, 'That agent no longer exists.')
        return true
      }
      if (raw.status === 'terminated') {
        fail(req, res, 400, 'That agent was terminated.')
        return true
      }
      if (raw.status === 'pending_approval') {
        fail(req, res, 400, 'Approve the hire first.')
        return true
      }
      let clean
      try {
        clean = cleanAgentPatch(body)
      } catch (error) {
        fail(req, res, 400, error.message)
        return true
      }
      if ('instructions' in clean) {
        fail(req, res, 400, 'The instructions cannot be changed here yet.')
        return true
      }
      if (clean.reportsToAgentId === raw.id) {
        fail(req, res, 400, 'An agent cannot report to itself.')
        return true
      }
      if (clean.reportsToAgentId && !list.some((agent) => agent?.id === clean.reportsToAgentId)) {
        fail(req, res, 400, 'The agent it reports to no longer exists.')
        return true
      }
      if ('name' in clean && list.some((agent) => agent?.id !== raw.id && keyOf(agent) === slugKey(clean.name))) {
        fail(req, res, 400, 'An agent with that name already exists.')
        return true
      }
      const allowed = 'subagentsAllowed' in clean ? clean.subagentsAllowed : subagentsOf(raw).subagentsAllowed
      if ('subagentDepth' in clean && !allowed) {
        fail(req, res, 400, 'Turn subagents on to set a depth.')
        return true
      }
      const { patch, budgetMonthlyCents } = buildUpdateBody(clean, raw)
      if (Object.keys(patch).length > 0) {
        const patched = await upstream('PATCH', `/api/agents/${encodeURIComponent(id)}`, patch)
        if (patched.status >= 300) {
          const [code, message] = upstreamFailure(patched, 'That agent no longer exists.', 'Paperclip did not accept that update.')
          fail(req, res, code, message)
          return true
        }
      }
      if (budgetMonthlyCents !== undefined) {
        const budgeted = await upstream('PATCH', `/api/agents/${encodeURIComponent(id)}/budgets`, { budgetMonthlyCents })
        if (budgeted.status >= 300) {
          const [code, message] = upstreamFailure(budgeted, 'That agent no longer exists.', 'Paperclip did not accept that budget.')
          fail(req, res, code, message)
          return true
        }
      }
      await sendAgent(req, res, id)
      return true
    }

    if (method === 'GET' && path === '/api/control/issues') {
      const status = url.searchParams.get('status')
      const query = status ? `?status=${encodeURIComponent(status)}` : ''
      const answer = await upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/issues${query}`)
      if (answer.status !== 200) {
        const [code, message] = upstreamFailure(answer, 'That task no longer exists.', 'Paperclip could not read the tasks.')
        sendJson(req, res, code, { error: message })
        return true
      }
      const list = (Array.isArray(answer.json) ? answer.json : []).map(mapIssue)
      list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      sendJson(req, res, 200, list)
      return true
    }

    if (method === 'POST' && path === '/api/control/issues') {
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const draft = body
      const title = typeof draft?.title === 'string' ? draft.title.trim() : ''
      if (!title) {
        sendJson(req, res, 400, { error: 'A title is required.' })
        return true
      }
      const assigneeAgentId = plainId(draft?.assigneeAgentId)
      const known = assigneeAgentId
        ? await upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/agents`)
        : { status: 0, json: null }
      const list = Array.isArray(known.json) ? known.json : []
      if (known.status !== 200 || !list.some((agent) => agent?.id === assigneeAgentId)) {
        sendJson(req, res, 400, { error: 'Choose an agent for this task.' })
        return true
      }
      const overrides = issueOverrides(draft)
      const created = await upstream(
        'POST',
        `/api/companies/${encodeURIComponent(companyId)}/issues`,
        buildCreateIssueBody({ ...draft, title }, overrides, { projectId, projectWorkspaceId })
      )
      if (created.status >= 300 || !created.json) {
        const [code, message] = upstreamFailure(created, 'Paperclip did not accept that task.', 'Paperclip did not accept that task.')
        sendJson(req, res, code, { error: message })
        return true
      }
      sendJson(req, res, 201, mapIssue(created.json))
      return true
    }

    if (method === 'GET' && path === '/api/control/comments') {
      const issueId = plainId(url.searchParams.get('issueId'))
      const [comments, agents] = await Promise.all([
        upstream('GET', `/api/issues/${encodeURIComponent(issueId)}/comments`),
        upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/agents`),
      ])
      if (comments.status === 404) {
        sendJson(req, res, 200, [])
        return true
      }
      if (comments.status !== 200) {
        const [code, message] = upstreamFailure(comments, 'That task no longer exists.', 'Paperclip could not read the thread.')
        sendJson(req, res, code, { error: message })
        return true
      }
      const names = new Map()
      if (Array.isArray(agents.json)) {
        for (const agent of agents.json) names.set(agent?.id, String(agent?.name ?? 'Agent'))
      }
      const list = (Array.isArray(comments.json) ? comments.json : []).map((entry) => mapComment(entry, names))
      list.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      sendJson(req, res, 200, list)
      return true
    }

    if (method === 'POST' && path === '/api/control/comments') {
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const issueId = plainId(body?.issueId)
      const text = typeof body?.body === 'string' ? body.body.trim() : ''
      if (!text) {
        sendJson(req, res, 400, { error: 'Write a comment first.' })
        return true
      }
      const posted = await upstream('POST', `/api/issues/${encodeURIComponent(issueId)}/comments`, { body: text })
      if (posted.status === 404) {
        sendJson(req, res, 404, { error: 'That task no longer exists.' })
        return true
      }
      if (posted.status >= 300 || !posted.json) {
        const [code, message] = upstreamFailure(posted, 'That task no longer exists.', 'Paperclip did not accept that comment.')
        sendJson(req, res, code, { error: message })
        return true
      }
      if (posted.json.id) {
        sendJson(req, res, 201, mapComment(posted.json))
        return true
      }
      const thread = await upstream('GET', `/api/issues/${encodeURIComponent(issueId)}/comments`)
      const list = Array.isArray(thread.json) ? thread.json : []
      sendJson(req, res, 201, mapComment(list[list.length - 1] ?? { issueId, body: text }))
      return true
    }

    if (method === 'GET' && path === '/api/control/approvals') {
      const answer = await upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/approvals`)
      if (answer.status !== 200) {
        const [code, message] = upstreamFailure(answer, 'That approval no longer exists.', 'Paperclip could not read the approvals.')
        sendJson(req, res, code, { error: message })
        return true
      }
      const list = (Array.isArray(answer.json) ? answer.json : []).map((entry) => mapApproval(entry))
      list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      sendJson(req, res, 200, list)
      return true
    }

    const decide = /^\/api\/control\/approvals\/([^/]+)\/decide$/.exec(path)
    if (method === 'POST' && decide) {
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const decision = typeof body?.decision === 'string' ? body.decision : ''
      if (!DECISION_ROUTES[decision]) {
        sendJson(req, res, 400, { error: `Unknown decision: ${decision}` })
        return true
      }
      const id = decodeURIComponent(decide[1])
      const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : undefined
      const posted = await upstream('POST', `/api/approvals/${encodeURIComponent(id)}/${DECISION_ROUTES[decision]}`, note ? { decisionNote: note } : {})
      if (posted.status >= 300) {
        const already = typeof posted.json?.error === 'string' && /only pending|already/i.test(posted.json.error)
        const [code, message] = already
          ? [400, 'That approval is already decided.']
          : upstreamFailure(posted, 'That approval no longer exists.', 'Paperclip did not accept that decision.')
        sendJson(req, res, code, { error: message })
        return true
      }
      const read = await upstream('GET', `/api/approvals/${encodeURIComponent(id)}`)
      const record = read.status === 200 ? read.json : posted.json
      sendJson(req, res, 200, mapApproval(record, note))
      return true
    }

    const budget = /^\/api\/control\/agents\/([^/]+)\/budget$/.exec(path)
    if (method === 'POST' && budget) {
      const body = await readJsonBody(req, res)
      if (body === null) return true
      const cents = body?.budgetMonthlyCents
      if (!Number.isInteger(cents) || cents < 0) {
        sendJson(req, res, 400, { error: 'The budget must be a whole number of cents, zero or more.' })
        return true
      }
      const id = decodeURIComponent(budget[1])
      const patched = await upstream('PATCH', `/api/agents/${encodeURIComponent(id)}/budgets`, { budgetMonthlyCents: cents })
      if (patched.status >= 300) {
        const [code, message] = upstreamFailure(patched, 'That agent no longer exists.', 'Paperclip did not accept that budget.')
        sendJson(req, res, code, { error: message })
        return true
      }
      await sendAgent(req, res, id)
      return true
    }

    if (method === 'GET' && path === '/api/control/costs') {
      const [summary, rows, quota] = await Promise.all([
        upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/costs/summary`),
        upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/costs/by-agent`),
        upstream('GET', `/api/companies/${encodeURIComponent(companyId)}/costs/quota-windows`),
      ])
      for (const answer of [summary, rows, quota]) {
        if (answer.status !== 200) {
          const [code, message] = upstreamFailure(answer, 'That company no longer exists.', 'Paperclip could not read the costs.')
          sendJson(req, res, code, { error: message })
          return true
        }
      }
      sendJson(req, res, 200, mapCosts({ summary: summary.json, rows: rows.json, quota: quota.json }))
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
