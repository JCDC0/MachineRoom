import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'
import { PAPERCLIP_SURFACE } from '../server/surface.js'

export const FAKE_VERSION = '0.0.0-fake'
export const DEFAULT_PORT = 3999
export const DEFAULT_SPEED = 4
export const LIVE_CHUNK_LIMIT = 8192
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fixtures')
const SPEC_ONLY = ['/api/openapi.json']
const REPLAYED = new Set(['heartbeat.run.log', 'heartbeat.run.event', 'heartbeat.run.progress'])
const RUN_END = new Set(['succeeded', 'failed', 'cancelled', 'timed_out'])
const MAX_GAP_MS = 2000
const STEP_MS = 300
const BODY_LIMIT = 256 * 1024
const BACKUP_DIR = '/fake-paperclip/backups'
const MAX_AGE_HOURS = 26
const DECIDABLE = new Set(['pending', 'revision_requested'])
const DECISIONS = new Map([
  ['approve', 'approved'],
  ['reject', 'rejected'],
  ['request-revision', 'revision_requested'],
])
const USAGE = new Map([
  ['claude_local', { costCents: 0, inputTokens: 18000, outputTokens: 1600, subscription: true }],
  ['hermes_local', { costCents: 9, inputTokens: 22000, outputTokens: 2100, subscription: false }],
  ['opencode_local', { costCents: 4, inputTokens: 20000, outputTokens: 2000, subscription: false }],
  ['process', { costCents: 0, inputTokens: 12000, outputTokens: 900, subscription: true }],
])
const SEED_AGENTS = [
  { name: 'Claude Code', urlKey: 'claude-code', adapterType: 'claude_local', role: 'engineer', model: 'sonnet' },
  { name: 'Hermes', urlKey: 'hermes', adapterType: 'hermes_local', role: 'engineer', model: 'auto' },
  { name: 'OpenCode Go', urlKey: 'opencode-go', adapterType: 'opencode_local', role: 'engineer', model: 'opencode/fake-free' },
  { name: 'agy', urlKey: 'agy', adapterType: 'process', role: 'engineer', model: null },
  { name: 'Orchestrator', urlKey: 'orchestrator', adapterType: 'opencode_local', role: 'ceo', model: 'opencode/fake-free' },
]
const FIXTURE_AGENT_KEYS = new Map([
  ['orchestrator', 'orchestrator'],
  ['opencode', 'opencode-go'],
])
const KIND_PREFIX = new Map([
  ['company', 'c0000000'],
  ['agent', 'a0000000'],
  ['issue', '10000000'],
  ['comment', '20000000'],
  ['run', '30000000'],
  ['approval', '40000000'],
  ['wake', '50000000'],
])

const USAGE_TEXT = [
  'Usage: npm run fake-paperclip -- [--port 3999] [--speed 4] [--missing ROUTE,...] [--slow ROUTE,...] [--fail ROUTE,...]',
  '',
  'ROUTE is a path as server/surface.js writes it, such as /api/companies/{companyId}/approvals,',
  'with an optional method before it and a space: "GET /api/companies/{companyId}/approvals".',
  '  --missing   leave the route out of /api/openapi.json and answer 404 on it',
  '  --slow      never answer the route',
  '  --fail      answer the route with 500',
  '  --speed     how much faster than recorded a run plays (default 4)',
].join('\n')

export function fakeId(kind, n) {
  const prefix = KIND_PREFIX.get(kind) ?? 'f0000000'
  return `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

function segments(path) {
  return String(path).split('/').filter(Boolean)
}

function isParam(segment) {
  return /^\{[^}]+\}$/.test(segment)
}

function shapeOf(path) {
  return segments(path)
    .map((segment) => (isParam(segment) ? '{}' : segment))
    .join('/')
}

export function knownRoutes() {
  const routes = []
  for (const route of PAPERCLIP_SURFACE) routes.push({ method: route.method, path: route.path })
  for (const path of SPEC_ONLY) routes.push({ method: 'GET', path })
  return routes
}

export function parseRoute(text, flag) {
  const raw = String(text ?? '').trim()
  const match = /^(?:([A-Za-z]+)\s+)?(\/\S*)$/.exec(raw)
  if (!match) throw new Error(`${flag} needs a route such as /api/companies/{companyId}/approvals, not "${raw}".`)
  const method = match[1] ? match[1].toUpperCase() : null
  const path = match[2].replace(/\/+$/, '') || '/'
  const known = knownRoutes().some((route) => shapeOf(route.path) === shapeOf(path) && (method === null || route.method === method))
  if (!known) throw new Error(`${flag} names ${method ? `${method} ` : ''}${path}, which is not a route in server/surface.js.`)
  return { method, path }
}

function routeList(text, flag) {
  return String(text ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => parseRoute(part, flag))
}

export function parseFakeArgs(argv) {
  const options = { port: DEFAULT_PORT, speed: DEFAULT_SPEED, missing: [], slow: [], fail: [], help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--help' || flag === '-h') {
      options.help = true
      continue
    }
    if (!['--port', '--speed', '--missing', '--slow', '--fail'].includes(flag)) {
      throw new Error(`Unknown option ${flag}. Run npm run fake-paperclip -- --help.`)
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value.`)
    index += 1
    if (flag === '--port') {
      const port = Number(value)
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port needs a whole number from 0 to 65535.')
      options.port = port
    } else if (flag === '--speed') {
      const speed = Number(value)
      if (!Number.isFinite(speed) || speed <= 0) throw new Error('--speed needs a number above 0.')
      options.speed = speed
    } else if (flag === '--missing') {
      options.missing.push(...routeList(value, flag))
    } else if (flag === '--slow') {
      options.slow.push(...routeList(value, flag))
    } else {
      options.fail.push(...routeList(value, flag))
    }
  }
  return options
}

function matches(entry, method, path) {
  if (entry.method && entry.method !== method) return false
  const want = segments(entry.path)
  const got = segments(path)
  if (want.length !== got.length) return false
  return want.every((segment, index) => isParam(segment) || segment === got[index])
}

function routeIn(list, method, route) {
  return list.some((entry) => (entry.method === null || entry.method === method) && shapeOf(entry.path) === shapeOf(route))
}

function fieldsSchema(fields = []) {
  const root = { type: 'object', properties: {} }
  for (const field of fields) {
    let node = root
    for (const raw of field.split('.')) {
      const array = raw.endsWith('[]')
      const name = array ? raw.slice(0, -2) : raw
      if (!Object.hasOwn(node.properties, name)) {
        node.properties[name] = array ? { type: 'array', items: { type: 'object', properties: {} } } : { type: 'object', properties: {} }
      }
      const target = node.properties[name]
      node = array ? target.items : target
    }
  }
  return root
}

export function fakeSpec({ missing = [] } = {}) {
  const paths = {}
  for (const route of PAPERCLIP_SURFACE) {
    if (route.socket || routeIn(missing, route.method, route.path)) continue
    const code = route.method === 'POST' && /\/(issues|comments|agent-hires|database-backups)$/.test(route.path) ? '201' : '200'
    const operation = { responses: { [code]: { description: 'ok' } } }
    if (route.fields) operation.responses[code].content = { 'application/json': { schema: fieldsSchema(route.fields) } }
    if (route.body) operation.requestBody = { content: { 'application/json': { schema: fieldsSchema(route.body) } } }
    const item = Object.hasOwn(paths, route.path) ? paths[route.path] : {}
    item[route.method.toLowerCase()] = operation
    paths[route.path] = item
  }
  return { openapi: '3.0.0', info: { title: 'Fake Paperclip', version: '1.0.0' }, paths }
}

export function liveRunsQueryInt(value, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(max, Math.trunc(parsed))
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readFrames(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function scriptOf(frames, agentId) {
  const ended = frames.find(
    (frame) => frame.type === 'heartbeat.run.status' && frame.payload?.agentId === agentId && frame.payload?.status === 'succeeded'
  )
  if (!ended) return null
  const runId = ended.payload.runId
  const steps = []
  let last = null
  for (const frame of frames) {
    if (frame.payload?.runId !== runId || !REPLAYED.has(frame.type)) continue
    const at = Date.parse(frame.createdAt)
    const gap = last === null || !Number.isFinite(at) ? 0 : Math.max(0, at - last)
    if (Number.isFinite(at)) last = at
    const payload = { ...frame.payload }
    delete payload.runId
    delete payload.agentId
    delete payload.issueId
    steps.push({ type: frame.type, gapMs: Math.min(gap, MAX_GAP_MS), payload })
  }
  return steps.some((step) => step.type === 'heartbeat.run.log') ? steps : null
}

export function loadScripts(fixturesDir = FIXTURES_DIR) {
  const scripts = new Map()
  let names = []
  try {
    names = readdirSync(fixturesDir)
  } catch {
    return scripts
  }
  const runFiles = names.filter((name) => name.endsWith('-run.jsonl')).sort()
  for (const runFile of runFiles) {
    const stem = runFile.slice(0, -'-run.jsonl'.length)
    const agentsName = names.includes(`${stem}-agents.json`) ? `${stem}-agents.json` : 'agents.json'
    let agentsFile
    let frames
    try {
      agentsFile = readJsonFile(join(fixturesDir, agentsName))
      frames = readFrames(join(fixturesDir, runFile))
    } catch {
      continue
    }
    for (const agent of Array.isArray(agentsFile?.agents) ? agentsFile.agents : []) {
      const adapterType = String(agent?.adapterType ?? '')
      const fakeKey = FIXTURE_AGENT_KEYS.get(String(agent?.key ?? ''))
      if (fakeKey) {
        const steps = scriptOf(frames, agent.id)
        if (steps) scripts.set(fakeKey, { source: runFile, steps })
      }
      if (!adapterType || scripts.has(adapterType)) continue
      const steps = scriptOf(frames, agent.id)
      if (steps) scripts.set(adapterType, { source: runFile, steps })
    }
  }
  return scripts
}

export function builtInScript(issueTitle) {
  const lines = [
    '[fake] No recording fits this harness, so this is the short built-in script.',
    `[fake] Task: ${issueTitle}`,
    '[fake] Reading the project.',
    '[fake] Making the change.',
    '[fake] Done.',
  ]
  return {
    source: 'built-in',
    steps: lines.map((line, index) => ({
      type: 'heartbeat.run.log',
      gapMs: 400,
      payload: { seq: index + 1, stream: 'stdout', chunk: `${line}\n`, truncated: false },
    })),
  }
}

function pad(value, size = 2) {
  return String(value).padStart(size, '0')
}

export function backupName(at) {
  const date = new Date(at)
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `paperclip-${day}-${time}.sql.gz`
}

function slugKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function createFakeState({ now = Date.now() } = {}) {
  const counters = new Map()
  const next = (kind) => {
    const value = (counters.get(kind) ?? 0) + 1
    counters.set(kind, value)
    return fakeId(kind, value)
  }
  const stamp = new Date(now).toISOString()
  const company = {
    id: next('company'),
    name: 'Fake company',
    issuePrefix: 'MR',
    status: 'active',
    budgetMonthlyCents: 5000,
    spentMonthlyCents: 0,
    requireBoardApprovalForNewAgents: false,
    createdAt: stamp,
    updatedAt: stamp,
  }
  const agents = SEED_AGENTS.map((seed) => ({
    id: next('agent'),
    companyId: company.id,
    name: seed.name,
    urlKey: seed.urlKey,
    role: seed.role,
    title: null,
    status: 'idle',
    reportsTo: null,
    adapterType: seed.adapterType,
    adapterConfig: seed.model ? { model: seed.model, timeoutSec: 600, maxTurnsPerRun: 40 } : { command: 'agy', args: [] },
    metadata: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    lastHeartbeatAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  }))
  const usage = new Map(agents.map((agent) => [agent.id, { costCents: 0, inputTokens: 0, outputTokens: 0, apiRunCount: 0, subscriptionRunCount: 0 }]))
  const hermes = agents.find((agent) => agent.adapterType === 'hermes_local')
  const approvals = [
    {
      id: next('approval'),
      companyId: company.id,
      type: 'request_board_approval',
      requestedByAgentId: hermes.id,
      requestedByUserId: null,
      status: 'pending',
      payload: { title: 'Run the full test suite on every task', summary: 'Hermes asks to run the full test suite on every task.' },
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ]
  const seedAt = now - 2 * 3600 * 1000
  const backups = [{ name: backupName(seedAt), mtime: seedAt, sizeBytes: 48213 }]
  return { company, agents, usage, approvals, issues: [], comments: [], runs: new Map(), backups, next, issueCount: 0 }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolveBody) => {
    const chunks = []
    let size = 0
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      resolveBody(value)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        finish({ error: 'too large' })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text.trim()) {
        finish({ value: {} })
        return
      }
      try {
        const value = JSON.parse(text)
        finish(value && typeof value === 'object' && !Array.isArray(value) ? { value } : { error: 'not an object' })
      } catch {
        finish({ error: 'not json' })
      }
    })
    req.on('error', () => finish({ error: 'closed' }))
  })
}

function round(value, places) {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

export async function startFakePaperclip(options = {}) {
  const host = options.host ?? '127.0.0.1'
  const port = Number(options.port ?? DEFAULT_PORT)
  const speed = Number(options.speed ?? DEFAULT_SPEED) > 0 ? Number(options.speed ?? DEFAULT_SPEED) : DEFAULT_SPEED
  const missing = options.missing ?? []
  const slow = options.slow ?? []
  const fail = options.fail ?? []
  const scripts = options.scripts ?? loadScripts(options.fixturesDir ?? FIXTURES_DIR)
  const state = createFakeState({ now: options.now ?? Date.now() })
  const { company } = state
  const sockets = new Set()
  const timers = new Set()
  const hanging = new Set()
  const requests = []
  const queues = new Map()
  let frameId = 0
  let stopped = false

  function later(ms, fn) {
    return new Promise((resolveWait) => {
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (!stopped) fn?.()
        resolveWait(!stopped)
      }, Math.max(0, ms))
      timers.add(timer)
    })
  }

  function emit(type, payload) {
    frameId += 1
    const frame = { id: frameId, companyId: company.id, type, createdAt: new Date().toISOString(), payload }
    const text = JSON.stringify(frame)
    for (const socket of sockets) {
      if (socket.readyState === 1) socket.send(text)
    }
    return frame
  }

  function activity(action, entityType, entityId, details = {}, agentId = null, runId = null) {
    emit('activity.logged', {
      actorType: agentId ? 'agent' : 'user',
      actorId: agentId ?? 'local-board',
      action,
      entityType,
      entityId,
      agentId,
      runId,
      details,
    })
  }

  function agentById(id) {
    return state.agents.find((agent) => agent.id === id) ?? null
  }

  function touch(record) {
    record.updatedAt = new Date().toISOString()
  }

  function setAgentStatus(agent, status) {
    agent.status = status
    agent.lastHeartbeatAt = new Date().toISOString()
    touch(agent)
    emit('agent.status', { agentId: agent.id, status, lastHeartbeatAt: agent.lastHeartbeatAt })
  }

  function costRow(agent) {
    const used = state.usage.get(agent.id)
    return {
      agentId: agent.id,
      agentName: agent.name,
      agentStatus: agent.status,
      costCents: used.costCents,
      inputTokens: used.inputTokens,
      cachedInputTokens: 0,
      outputTokens: used.outputTokens,
      apiRunCount: used.apiRunCount,
      subscriptionRunCount: used.subscriptionRunCount,
      subscriptionInputTokens: 0,
      subscriptionCachedInputTokens: 0,
      subscriptionOutputTokens: 0,
    }
  }

  function spendCents() {
    let total = 0
    for (const used of state.usage.values()) total += used.costCents
    return total
  }

  function runCount() {
    let total = 0
    for (const used of state.usage.values()) total += used.apiRunCount + used.subscriptionRunCount
    return total
  }

  function bookUsage(agent) {
    const rate = USAGE.get(agent.adapterType) ?? { costCents: 1, inputTokens: 5000, outputTokens: 500, subscription: false }
    const used = state.usage.get(agent.id)
    used.costCents += rate.costCents
    used.inputTokens += rate.inputTokens
    used.outputTokens += rate.outputTokens
    if (rate.subscription) used.subscriptionRunCount += 1
    else used.apiRunCount += 1
    agent.spentMonthlyCents = used.costCents
    company.spentMonthlyCents = spendCents()
  }

  function healthBlock(now = Date.now()) {
    const latest = state.backups[state.backups.length - 1] ?? null
    const ageHours = latest ? round((now - latest.mtime) / 3600000, 1) : null
    const warnings = []
    if (!latest) warnings.push({ code: 'database_backup_missing', message: 'No database backup was found.' })
    else if (ageHours > MAX_AGE_HOURS) warnings.push({ code: 'database_backup_stale', message: 'The newest database backup is old.' })
    return {
      enabled: true,
      status: warnings.length === 0 ? 'ok' : 'warning',
      backupDir: BACKUP_DIR,
      maxAgeHours: MAX_AGE_HOURS,
      latestBackup: latest
        ? {
            name: latest.name,
            path: `${BACKUP_DIR}/${latest.name}`,
            mtime: new Date(latest.mtime).toISOString(),
            ageHours,
            sizeBytes: latest.sizeBytes,
          }
        : null,
      lastFailure: null,
      warnings,
    }
  }

  function makeBackup() {
    const started = Date.now()
    const last = state.backups[state.backups.length - 1]
    const at = last && Math.floor(last.mtime / 1000) >= Math.floor(started / 1000) ? last.mtime + 1000 : started
    const entry = { name: backupName(at), mtime: at, sizeBytes: 48213 + state.backups.length * 512 }
    state.backups.push(entry)
    const finished = Date.now()
    return {
      backupFile: `${BACKUP_DIR}/${entry.name}`,
      sizeBytes: entry.sizeBytes,
      prunedCount: 0,
      trigger: 'manual',
      backupDir: BACKUP_DIR,
      retention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 },
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
    }
  }

  function quotaWindows() {
    const used = Math.min(100, 10 + runCount() * 2)
    const resetsAt = new Date(Date.now() + 3 * 3600 * 1000).toISOString()
    return [
      {
        provider: 'anthropic',
        ok: true,
        windows: [
          { label: '5 hour', usedPercent: used, resetsAt, detail: null },
          { label: 'Weekly', usedPercent: null, resetsAt: null, detail: 'This fake has no weekly number.' },
        ],
      },
      { provider: 'openrouter', ok: false, error: 'The fake cannot read this provider.', windows: [] },
    ]
  }

  function logLine(run, step) {
    const line = JSON.stringify({ ts: step.ts, stream: step.stream, chunk: step.chunk, seq: step.seq })
    run.log += `${line}\n`
  }

  async function playRun(issue, agent) {
    const runId = state.next('run')
    const run = { id: runId, agentId: agent.id, issueId: issue.id, status: 'queued', log: '', createdAt: new Date().toISOString(), startedAt: null, finishedAt: null, lastOutputAt: null }
    state.runs.set(runId, run)
    const script = scripts.get(agent.urlKey) ?? scripts.get(agent.adapterType) ?? builtInScript(issue.title)
    emit('heartbeat.run.queued', {
      runId,
      agentId: agent.id,
      invocationSource: 'assignment',
      triggerDetail: 'system',
      wakeupRequestId: state.next('wake'),
    })
    if (!(await later(STEP_MS / speed))) return
    const startedAt = new Date().toISOString()
    run.status = 'running'
    run.startedAt = startedAt
    issue.status = 'in_progress'
    touch(issue)
    activity('issue.updated', 'issue', issue.id, { status: 'in_progress', identifier: issue.identifier })
    setAgentStatus(agent, 'running')
    emit('heartbeat.run.status', {
      runId,
      agentId: agent.id,
      status: 'running',
      invocationSource: 'assignment',
      triggerDetail: 'system',
      error: null,
      errorCode: null,
      startedAt,
      finishedAt: null,
    })
    for (const step of script.steps) {
      if (!(await later(step.gapMs / speed))) return
      const ts = new Date().toISOString()
      const payload = { runId, agentId: agent.id, issueId: issue.id, ...step.payload }
      if (step.type === 'heartbeat.run.log') {
        payload.ts = ts
        const chunk = String(step.payload.chunk ?? '')
        logLine(run, { ts, stream: payload.stream, chunk, seq: payload.seq })
        run.lastOutputAt = ts
        if (chunk.length > LIVE_CHUNK_LIMIT) {
          payload.chunk = chunk.slice(-LIVE_CHUNK_LIMIT)
          payload.truncated = true
        }
      } else if (Object.hasOwn(payload, 'lastEventAt')) {
        payload.lastEventAt = ts
      }
      emit(step.type, payload)
    }
    if (!(await later(STEP_MS / speed))) return
    const finishedAt = new Date().toISOString()
    run.status = 'succeeded'
    run.finishedAt = finishedAt
    bookUsage(agent)
    emit('heartbeat.run.status', {
      runId,
      agentId: agent.id,
      status: 'succeeded',
      invocationSource: 'assignment',
      triggerDetail: 'system',
      error: null,
      errorCode: null,
      startedAt,
      finishedAt,
    })
    setAgentStatus(agent, 'idle')
    const comment = addComment(issue, `Done: ${issue.title}. This was a scripted run from the fake Paperclip (${script.source}).`, agent.id, runId)
    activity('issue.comment_added', 'issue', issue.id, { commentId: comment.id, identifier: issue.identifier }, agent.id, runId)
    issue.status = 'done'
    touch(issue)
    activity('issue.updated', 'issue', issue.id, { status: 'done', identifier: issue.identifier }, agent.id, runId)
  }

  function queueRun(issue, agent) {
    const before = queues.get(agent.id) ?? Promise.resolve()
    const after = before.then(() => (stopped ? undefined : playRun(issue, agent))).catch(() => {})
    queues.set(agent.id, after)
    return after
  }

  function addComment(issue, body, authorAgentId = null, runId = null) {
    const stamp = new Date().toISOString()
    const comment = {
      id: state.next('comment'),
      companyId: company.id,
      issueId: issue.id,
      authorAgentId,
      authorUserId: authorAgentId ? null : 'local-board',
      runId,
      body,
      createdAt: stamp,
      updatedAt: stamp,
    }
    state.comments.push(comment)
    return comment
  }

  function decideApproval(approval, decision, note) {
    approval.status = decision
    approval.decisionNote = note ?? null
    approval.decidedByUserId = 'local-board'
    approval.decidedAt = new Date().toISOString()
    touch(approval)
    if (approval.type === 'hire_agent') {
      const agent = agentById(approval.payload?.agentId)
      if (agent && decision === 'approved') setAgentStatus(agent, 'idle')
      if (agent && decision === 'rejected') setAgentStatus(agent, 'terminated')
    }
    activity(`approval.${decision}`, 'approval', approval.id, { type: approval.type })
  }

  function liveRunRow(run) {
    const agent = agentById(run.agentId)
    return {
      id: run.id,
      companyId: company.id,
      status: run.status,
      invocationSource: 'assignment',
      triggerDetail: 'system',
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      createdAt: run.createdAt,
      agentId: run.agentId,
      agentName: agent?.name ?? null,
      adapterType: agent?.adapterType ?? null,
      issueId: run.issueId,
      lastOutputAt: run.lastOutputAt,
    }
  }

  function liveRuns(url) {
    const minCount = liveRunsQueryInt(url.searchParams.get('minCount'), 50, 0)
    const limit = liveRunsQueryInt(url.searchParams.get('limit'), 50, 50)
    const newest = [...state.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const live = newest.filter((run) => run.status === 'queued' || run.status === 'running').slice(0, limit)
    const padding = live.length < minCount ? newest.filter((run) => !live.includes(run)).slice(0, minCount - live.length) : []
    return [...live, ...padding].map(liveRunRow)
  }

  const handlers = [
    ['GET', '/api/openapi.json', (req, res) => sendJson(res, 200, fakeSpec({ missing }))],
    ['GET', '/api/health', (req, res) => sendJson(res, 200, { status: 'ok', version: FAKE_VERSION, deploymentMode: 'local_trusted', databaseBackup: healthBlock() })],
    [
      'POST',
      '/api/instance/database-backups',
      (req, res) => sendJson(res, 201, makeBackup()),
    ],
    ['GET', '/api/companies', (req, res) => sendJson(res, 200, [company])],
    ['GET', '/api/companies/{companyId}', (req, res) => sendJson(res, 200, company)],
    ['GET', '/api/companies/{companyId}/agents', (req, res) => sendJson(res, 200, state.agents)],
    [
      'POST',
      '/api/companies/{companyId}/agent-hires',
      (req, res, params, body) => {
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (!name) {
          sendJson(res, 400, { error: 'Validation error', details: { fieldErrors: { name: ['Required'] } } })
          return
        }
        const waits = company.requireBoardApprovalForNewAgents === true
        const stamp = new Date().toISOString()
        const agent = {
          id: state.next('agent'),
          companyId: company.id,
          name,
          urlKey: slugKey(name),
          role: typeof body.role === 'string' ? body.role : 'general',
          title: null,
          status: waits ? 'pending_approval' : 'idle',
          reportsTo: typeof body.reportsTo === 'string' ? body.reportsTo : null,
          adapterType: typeof body.adapterType === 'string' ? body.adapterType : 'process',
          adapterConfig: body.adapterConfig && typeof body.adapterConfig === 'object' ? { ...body.adapterConfig } : {},
          metadata: body.metadata && typeof body.metadata === 'object' ? { ...body.metadata } : {},
          budgetMonthlyCents: Number.isInteger(body.budgetMonthlyCents) ? body.budgetMonthlyCents : 0,
          spentMonthlyCents: 0,
          lastHeartbeatAt: null,
          createdAt: stamp,
          updatedAt: stamp,
        }
        state.agents.push(agent)
        state.usage.set(agent.id, { costCents: 0, inputTokens: 0, outputTokens: 0, apiRunCount: 0, subscriptionRunCount: 0 })
        let approval = null
        if (waits) {
          approval = {
            id: state.next('approval'),
            companyId: company.id,
            type: 'hire_agent',
            requestedByAgentId: null,
            requestedByUserId: 'local-board',
            status: 'pending',
            payload: { agentId: agent.id, title: `Hire ${name}`, summary: `Hire ${name} as ${agent.role}.` },
            decisionNote: null,
            decidedByUserId: null,
            decidedAt: null,
            createdAt: stamp,
            updatedAt: stamp,
          }
          state.approvals.push(approval)
          activity('approval.created', 'approval', approval.id, { type: 'hire_agent' })
        }
        activity('agent.hired', 'agent', agent.id, { name })
        sendJson(res, 201, { agent, approval })
      },
    ],
    [
      'PATCH',
      '/api/agents/{id}',
      (req, res, params, body) => {
        const agent = agentById(params.at(0))
        if (!agent) {
          sendJson(res, 404, { error: 'Agent not found' })
          return
        }
        const changed = []
        for (const field of ['name', 'role', 'reportsTo']) {
          if (Object.hasOwn(body, field)) {
            agent[field] = body[field]
            changed.push(field)
          }
        }
        if (body.adapterConfig && typeof body.adapterConfig === 'object') {
          agent.adapterConfig = { ...agent.adapterConfig, ...body.adapterConfig }
          changed.push('adapterConfig')
        }
        if (body.metadata && typeof body.metadata === 'object') {
          agent.metadata = { ...body.metadata }
          changed.push('metadata')
        }
        if (Object.hasOwn(body, 'name')) agent.urlKey = slugKey(agent.name)
        touch(agent)
        activity('agent.updated', 'agent', agent.id, { changedTopLevelKeys: changed })
        sendJson(res, 200, agent)
      },
    ],
    [
      'PATCH',
      '/api/agents/{agentId}/budgets',
      (req, res, params, body) => {
        const agent = agentById(params.at(0))
        if (!agent) {
          sendJson(res, 404, { error: 'Agent not found' })
          return
        }
        if (!Number.isInteger(body.budgetMonthlyCents) || body.budgetMonthlyCents < 0) {
          sendJson(res, 400, { error: 'Validation error', details: { fieldErrors: { budgetMonthlyCents: ['Expected a whole number'] } } })
          return
        }
        agent.budgetMonthlyCents = body.budgetMonthlyCents
        touch(agent)
        activity('agent.budget_updated', 'agent', agent.id, { changedTopLevelKeys: ['budgetMonthlyCents'] })
        sendJson(res, 200, agent)
      },
    ],
    [
      'POST',
      '/api/agents/{id}/pause',
      (req, res, params) => {
        const agent = agentById(params.at(0))
        if (!agent) {
          sendJson(res, 404, { error: 'Agent not found' })
          return
        }
        setAgentStatus(agent, 'paused')
        sendJson(res, 200, agent)
      },
    ],
    [
      'POST',
      '/api/agents/{id}/resume',
      (req, res, params) => {
        const agent = agentById(params.at(0))
        if (!agent) {
          sendJson(res, 404, { error: 'Agent not found' })
          return
        }
        setAgentStatus(agent, 'idle')
        sendJson(res, 200, agent)
      },
    ],
    [
      'GET',
      '/api/companies/{companyId}/issues',
      (req, res, params, body, url) => {
        const wanted = (url.searchParams.get('status') ?? '').split(',').filter(Boolean)
        const list = state.issues.filter((issue) => wanted.length === 0 || wanted.includes(issue.status))
        sendJson(res, 200, [...list].reverse())
      },
    ],
    [
      'POST',
      '/api/companies/{companyId}/issues',
      (req, res, params, body) => {
        const title = typeof body.title === 'string' ? body.title.trim() : ''
        if (!title) {
          sendJson(res, 400, { error: 'Validation error', details: { fieldErrors: { title: ['Required'] } } })
          return
        }
        const assignee = body.assigneeAgentId ? agentById(body.assigneeAgentId) : null
        if (body.assigneeAgentId && !assignee) {
          sendJson(res, 422, { error: 'Assignee agent not found' })
          return
        }
        state.issueCount += 1
        const stamp = new Date().toISOString()
        const issue = {
          id: state.next('issue'),
          companyId: company.id,
          identifier: `${company.issuePrefix}-${state.issueCount}`,
          title,
          description: typeof body.description === 'string' ? body.description : '',
          status: typeof body.status === 'string' ? body.status : 'backlog',
          priority: typeof body.priority === 'string' ? body.priority : 'medium',
          assigneeAgentId: assignee ? assignee.id : null,
          parentId: null,
          projectId: typeof body.projectId === 'string' ? body.projectId : null,
          projectWorkspaceId: typeof body.projectWorkspaceId === 'string' ? body.projectWorkspaceId : null,
          assigneeAdapterOverrides: body.assigneeAdapterOverrides ?? null,
          createdAt: stamp,
          updatedAt: stamp,
        }
        state.issues.push(issue)
        activity('issue.created', 'issue', issue.id, { title, identifier: issue.identifier, status: issue.status })
        sendJson(res, 201, issue)
        if (assignee && issue.status === 'todo' && ['idle', 'active', 'running', 'error'].includes(assignee.status)) {
          queueRun(issue, assignee)
        }
      },
    ],
    [
      'GET',
      '/api/issues/{id}/comments',
      (req, res, params, body, url) => {
        const issue = state.issues.find((item) => item.id === params.at(0))
        if (!issue) {
          sendJson(res, 404, { error: 'Issue not found' })
          return
        }
        const list = state.comments.filter((comment) => comment.issueId === issue.id)
        sendJson(res, 200, url.searchParams.get('order') === 'asc' ? list : [...list].reverse())
      },
    ],
    [
      'POST',
      '/api/issues/{id}/comments',
      (req, res, params, body) => {
        const issue = state.issues.find((item) => item.id === params.at(0))
        if (!issue) {
          sendJson(res, 404, { error: 'Issue not found' })
          return
        }
        const text = typeof body.body === 'string' ? body.body.trim() : ''
        if (!text) {
          sendJson(res, 400, { error: 'Validation error', details: { fieldErrors: { body: ['Required'] } } })
          return
        }
        const comment = addComment(issue, text)
        activity('issue.comment_added', 'issue', issue.id, { commentId: comment.id, identifier: issue.identifier })
        sendJson(res, 201, comment)
      },
    ],
    ['GET', '/api/companies/{companyId}/approvals', (req, res) => sendJson(res, 200, [...state.approvals].reverse())],
    [
      'GET',
      '/api/approvals/{id}',
      (req, res, params) => {
        const approval = state.approvals.find((item) => item.id === params.at(0))
        if (!approval) sendJson(res, 404, { error: 'Approval not found' })
        else sendJson(res, 200, approval)
      },
    ],
    ...[...DECISIONS.keys()].map((route) => [
      'POST',
      `/api/approvals/{id}/${route}`,
      (req, res, params, body) => {
        const approval = state.approvals.find((item) => item.id === params.at(0))
        if (!approval) {
          sendJson(res, 404, { error: 'Approval not found' })
          return
        }
        const decision = DECISIONS.get(route)
        if (approval.status === decision) {
          sendJson(res, 200, { ...approval, applied: false })
          return
        }
        if (!DECIDABLE.has(approval.status)) {
          sendJson(res, 422, { error: 'Only pending or revision requested approvals can be decided' })
          return
        }
        decideApproval(approval, decision, typeof body.decisionNote === 'string' ? body.decisionNote : null)
        sendJson(res, 200, { ...approval, applied: true })
      },
    ]),
    [
      'GET',
      '/api/companies/{companyId}/costs/summary',
      (req, res) => {
        const spend = spendCents()
        const budget = company.budgetMonthlyCents
        sendJson(res, 200, {
          companyId: company.id,
          spendCents: spend,
          budgetCents: budget,
          utilizationPercent: budget > 0 ? round((spend / budget) * 100, 2) : 0,
        })
      },
    ],
    ['GET', '/api/companies/{companyId}/live-runs', (req, res, params, body, url) => sendJson(res, 200, liveRuns(url))],
    ['GET', '/api/companies/{companyId}/costs/by-agent', (req, res) => sendJson(res, 200, state.agents.map(costRow))],
    ['GET', '/api/companies/{companyId}/costs/quota-windows', (req, res) => sendJson(res, 200, quotaWindows())],
    [
      'GET',
      '/api/heartbeat-runs/{runId}/log',
      (req, res, params, body, url) => {
        const run = state.runs.get(params.at(0))
        if (!run) {
          sendJson(res, 404, { error: 'Heartbeat run not found' })
          return
        }
        const bytes = Buffer.from(run.log, 'utf8')
        const offset = Math.min(Math.max(Number(url.searchParams.get('offset')) || 0, 0), bytes.length)
        sendJson(res, 200, {
          runId: run.id,
          store: 'local_file',
          logRef: `fake/${run.id}.ndjson`,
          content: bytes.subarray(offset).toString('utf8'),
          nextOffset: bytes.length,
        })
      },
    ],
  ]

  function findHandler(method, path) {
    for (const [want, template, handler] of handlers) {
      if (want !== method) continue
      const parts = segments(template)
      const got = segments(path)
      if (parts.length !== got.length) continue
      const params = []
      let ok = true
      parts.forEach((part, index) => {
        if (isParam(part)) params.push(decodeURIComponent(got[index]))
        else if (part !== got[index]) ok = false
      })
      if (ok) return { template, handler, params }
    }
    return null
  }

  function companyOk(template, params) {
    return !template.includes('{companyId}') || params.at(0) === company.id
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const method = req.method ?? 'GET'
    const path = url.pathname
    requests.push({ method, path, query: url.search })
    if (missing.some((entry) => matches(entry, method, path))) {
      sendJson(res, 404, { error: 'API route not found' })
      return
    }
    if (slow.some((entry) => matches(entry, method, path))) {
      hanging.add(res)
      res.on('close', () => hanging.delete(res))
      return
    }
    if (fail.some((entry) => matches(entry, method, path))) {
      sendJson(res, 500, { error: 'The fake Paperclip was told to fail this route.' })
      return
    }
    const found = findHandler(method, path)
    if (!found) {
      sendJson(res, 404, { error: 'API route not found' })
      return
    }
    if (!companyOk(found.template, found.params)) {
      sendJson(res, 404, { error: 'Company not found' })
      return
    }
    let body = {}
    if (method === 'POST' || method === 'PATCH') {
      const read = await readBody(req)
      if (read.error) {
        sendJson(res, 400, { error: 'Validation error', details: { formErrors: [read.error] } })
        return
      }
      body = read.value
    }
    found.handler(req, res, found.params, body, url)
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'The fake Paperclip broke.' })
      else res.end()
    })
  })
  const wss = new WebSocketServer({ noServer: true })
  const socketPath = `/api/companies/${company.id}/events/ws`

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const route = { method: 'GET', path: url.pathname }
    if (slow.some((entry) => matches(entry, route.method, route.path))) {
      hanging.add(socket)
      socket.on('close', () => hanging.delete(socket))
      return
    }
    const refused = missing.some((entry) => matches(entry, route.method, route.path))
      ? '404 Not Found'
      : fail.some((entry) => matches(entry, route.method, route.path))
        ? '500 Internal Server Error'
        : url.pathname !== socketPath
          ? '404 Not Found'
          : null
    if (refused) {
      socket.end(`HTTP/1.1 ${refused}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws)
      ws.on('close', () => sockets.delete(ws))
      ws.on('error', () => sockets.delete(ws))
    })
  })

  await new Promise((resolveStart, rejectStart) => {
    server.once('error', rejectStart)
    server.listen(port, host, () => {
      server.off('error', rejectStart)
      resolveStart()
    })
  })
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  const url = `http://${host}:${actualPort}`

  function stop() {
    stopped = true
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    for (const ws of sockets) {
      try {
        ws.terminate()
      } catch {}
    }
    sockets.clear()
    for (const held of hanging) {
      try {
        held.destroy()
      } catch {}
    }
    hanging.clear()
    return new Promise((resolveStop) => {
      wss.close()
      server.close(() => resolveStop())
      server.closeAllConnections()
    })
  }

  return {
    url,
    port: actualPort,
    companyId: company.id,
    agents: state.agents,
    scripts,
    state,
    runsDone: () => Promise.all([...queues.values()]),
    sendFrame: (frame) => {
      const text = JSON.stringify({ ...frame, companyId: company.id })
      for (const socket of sockets) if (socket.readyState === 1) socket.send(text)
    },
    connected: () => sockets.size,
    requests: () => [...requests],
    stop,
  }
}

function describeRoutes(list) {
  return list.map((entry) => `${entry.method ? `${entry.method} ` : ''}${entry.path}`).join(', ')
}

export function startupLines(fake, options = {}) {
  const lines = [`Fake Paperclip on ${fake.url}`, `Company: ${fake.companyId}`]
  for (const agent of fake.agents) {
    const script = fake.scripts.get(agent.urlKey) ?? fake.scripts.get(agent.adapterType)
    lines.push(`Agent: ${agent.name} (${agent.adapterType}), runs ${script ? script.source : 'the built-in script'}`)
  }
  if (options.missing?.length) lines.push(`Missing: ${describeRoutes(options.missing)}`)
  if (options.slow?.length) lines.push(`Never answers: ${describeRoutes(options.slow)}`)
  if (options.fail?.length) lines.push(`Answers 500: ${describeRoutes(options.fail)}`)
  lines.push('')
  lines.push('To see the room: npm run build, then')
  lines.push(`npm run serve -- --paperclip ${fake.url} --company ${fake.companyId}`)
  lines.push('and give an agent a task from the control drawer (C). Stop with Ctrl+C.')
  return lines
}

async function main() {
  let options
  try {
    options = parseFakeArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
    return
  }
  if (options.help) {
    console.log(USAGE_TEXT)
    return
  }
  let fake
  try {
    fake = await startFakePaperclip(options)
  } catch (error) {
    console.error(`The fake Paperclip could not start on port ${options.port} (${error.code ?? error.message}).`)
    process.exitCode = 1
    return
  }
  for (const line of startupLines(fake, options)) console.log(line)
  const shutdown = () => {
    fake.stop().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) await main()
