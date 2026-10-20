import { execFileSync } from 'node:child_process'
import { readdirSync, watch } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createUnreadableCounter } from '../src/model/parsers/unreadable.js'
import { createAssistantApi } from './assistant.js'
import { createBriefsApi } from './briefs.js'
import { changeEvents, createControlApi } from './control.js'
import { createDecideApi } from './decide.js'
import { createReviewsApi } from './reviews.js'
import { createRunsApi } from './runs.js'
import { createStaticHandler } from './static.js'
import { compareSurface } from './surface.js'

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i
const BODY_LIMIT = 64 * 1024
const SURFACE_TIMEOUT_MS = 10000
const SURFACE_EVERY_MS = 15 * 60 * 1000
const BACKUP_READ_TIMEOUT_MS = 10000
const BACKUP_RUN_TIMEOUT_MS = 120000

function isAllowed(origin) {
  return LOCAL_ORIGIN.test(origin)
}

export function isAllowedHost(host) {
  return typeof host === 'string' && LOCAL_HOST.test(host)
}

const HISTORY_LIMIT = 500
const LIVE_CHUNK_LIMIT = 8192
const LOG_RUNS_KEPT = 8
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist'])
const IGNORED_WATCH = /(^|[/\\])(\.git|node_modules)([/\\]|$)/
const PARSER_BY_ADAPTER = {
  claude_local: 'claude',
  hermes_local: 'hermes',
  opencode_local: 'opencode',
}
const RUN_END_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out'])
const AGENT_FETCH_EVERY_MS = 30000

export function slugify(value) {
  return (
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  )
}

export function mapAgent(raw, taken = new Set()) {
  const id = raw?.id ?? ''
  const name = raw?.name ?? raw?.key ?? id
  const adapterType = raw?.adapterType ?? raw?.adapter_type ?? ''
  const role = typeof raw?.role === 'string' && raw.role !== '' ? raw.role : null
  const adapterParser = PARSER_BY_ADAPTER[adapterType]
  const parser = adapterParser ?? (adapterType === 'process' && slugify(name) === 'agy' ? 'agy' : null)
  let key = adapterParser ?? slugify(name)
  if (taken.has(key)) {
    key = slugify(name)
    for (let n = 2; taken.has(key); n += 1) key = `${slugify(name)}-${n}`
  }
  taken.add(key)
  return { id, key, name, adapterType, role, parser }
}

function walkFiles(rootDir, currentDir = rootDir, out = []) {
  const entries = readdirSync(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walkFiles(rootDir, join(currentDir, entry.name), out)
    } else if (entry.isFile()) {
      const full = join(currentDir, entry.name)
      const rel = full.slice(rootDir.length + 1).replace(/\\/g, '/')
      out.push(rel)
    }
  }
  return out
}

export function readTree(projectRoot) {
  if (!projectRoot) return { root: '', files: [], created: [] }
  const resolved = resolve(projectRoot)
  const root = basename(resolved)
  try {
    const output = execFileSync('git', ['-C', resolved, 'ls-files', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(resolved) },
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const files = output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.replace(/\\/g, '/'))
      .sort()
    return { root, files, created: [] }
  } catch {
    const files = walkFiles(resolved).sort()
    return { root, files, created: [] }
  }
}

function toWsUrl(paperclipUrl, companyId) {
  const base = String(paperclipUrl).replace(/\/+$/, '').replace(/^http/i, 'ws')
  return `${base}/api/companies/${encodeURIComponent(companyId)}/events/ws`
}

function corsHeaders(req) {
  const origin = req.headers.origin
  if (origin && !isAllowed(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin ?? 'http://localhost:5173',
    Vary: 'Origin',
  }
}

function sendJson(req, res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    ...corsHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readJsonBody(req, res, limit = BODY_LIMIT) {
  return new Promise((resolveBody) => {
    const type = String(req.headers['content-type'] ?? '')
    if (!type.toLowerCase().includes('application/json')) {
      sendJson(req, res, 415, { error: 'Send JSON.' })
      resolveBody(null)
      return
    }
    let size = 0
    let done = false
    const chunks = []
    const stop = (value) => {
      if (done) return
      done = true
      resolveBody(value)
    }
    req.on('data', (chunk) => {
      if (done) return
      size += chunk.length
      if (size > limit) {
        sendJson(req, res, 413, { error: 'That request is too large.' })
        stop(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (done) return
      let parsed
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch {
        sendJson(req, res, 400, { error: 'That body is not valid JSON.' })
        stop(null)
        return
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        sendJson(req, res, 400, { error: 'Send a JSON object.' })
        stop(null)
        return
      }
      stop(parsed)
    })
    req.on('error', () => stop(null))
  })
}

function backupWarningCodes(block) {
  const warnings = Array.isArray(block?.warnings) ? block.warnings : []
  return warnings
    .map((warning) => warning?.code)
    .filter((code) => typeof code === 'string' && code !== '')
}

function backupStatusAnswer(block) {
  const checkedAt = new Date().toISOString()
  if (!block || typeof block !== 'object') {
    return { enabled: false, status: null, latestAt: null, ageHours: null, warnings: [], checkedAt }
  }
  const latest = block.latestBackup && typeof block.latestBackup === 'object' ? block.latestBackup : null
  return {
    enabled: block.enabled === true,
    status: typeof block.status === 'string' && block.status ? block.status : null,
    latestAt: typeof latest?.mtime === 'string' && latest.mtime ? latest.mtime : null,
    ageHours: Number.isFinite(latest?.ageHours) ? latest.ageHours : null,
    warnings: backupWarningCodes(block),
    checkedAt,
  }
}

function backupFileName(path) {
  const text = typeof path === 'string' ? path.replace(/\\/g, '/') : ''
  const name = basename(text)
  return name && name !== '.' ? name : null
}

export function createBridge(options = {}) {
  const paperclipUrl = (options.paperclipUrl ?? process.env.PAPERCLIP_URL ?? 'http://127.0.0.1:3100').replace(/\/+$/, '')
  const companyId = options.companyId ?? process.env.PAPERCLIP_COMPANY_ID ?? ''
  const projectId = options.projectId ?? process.env.PAPERCLIP_PROJECT_ID ?? ''
  const projectWorkspaceId = options.projectWorkspaceId ?? process.env.PAPERCLIP_WORKSPACE_ID ?? ''
  const projectRoot = options.projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd()
  const port = Number(options.port ?? process.env.PORT ?? 5174)
  const reconnectMinMs = Number(options.reconnectMinMs ?? 1000)
  const reconnectMaxMs = Number(options.reconnectMaxMs ?? 15000)
  const heartbeatMs = Number(options.heartbeatMs ?? 15000)
  const debounceMs = Number(options.debounceMs ?? 300)
  const logRetries = Number(options.logRetries ?? 3)
  const logRetryMs = Number(options.logRetryMs ?? 150)
  const logTimeoutMs = Number(options.logTimeoutMs ?? 1500)
  const surfaceEveryMs = Number(options.surfaceEveryMs ?? SURFACE_EVERY_MS)
  const env = options.env ?? process.env

  const briefs = createBriefsApi({
    projectRoot,
    briefsDir: options.briefsDir ?? process.env.BRIEFS_DIR,
    sendJson,
  })
  const runs = createRunsApi({
    projectRoot,
    briefsDir: options.briefsDir ?? process.env.BRIEFS_DIR,
    runnerCommand: options.runnerCommand,
    sendJson,
    readJsonBody,
    notify: (event) => {
      for (const client of clients) writeSseChange(client, event)
    },
  })
  const reviews = createReviewsApi({
    projectRoot,
    briefsDir: options.briefsDir ?? process.env.BRIEFS_DIR,
    patchLimit: options.patchLimit,
    sendJson,
  })
  const control = createControlApi({
    paperclipUrl,
    companyId,
    projectId,
    projectWorkspaceId,
    sendJson,
    readJsonBody,
  })
  const assistant = createAssistantApi({
    sendJson,
    readJsonBody,
    runner: options.assistantRunner,
    model: options.assistantModel,
    settingsFile: options.settingsFile ?? process.env.MACHINEROOM_SETTINGS_FILE,
    env,
  })
  const decideApi = createDecideApi({
    sendJson,
    readJsonBody,
    env,
    decideUrl: options.decideUrl,
    timeoutMs: options.decideTimeoutMs,
  })
  const serveStatic = createStaticHandler({ staticDir: options.staticDir })

  const clients = new Set()
  const history = []
  let nextId = 0
  let socket = null
  let paperclipOpen = false
  let stopped = false
  let reconnectTimer = null
  let reconnectDelay = reconnectMinMs
  let watcher = null
  let watchTimer = null
  let lastFiles = []
  let surfaceTimer = null
  let surfaceChecking = false
  let surfacePending = false
  let paperclipVersion = null
  let surface = { ok: null, checkedAt: null, error: 'not checked yet' }
  const logs = new Map()
  const waiting = []
  let resolving = false
  const unreadable = createUnreadableCounter()
  const unparsedSince = new Date().toISOString()
  let parserByAgentId = new Map()
  let agentFetchAt = 0

  function writeSseFrame(res, entry) {
    res.write(`id: ${entry.id}\nevent: frame\ndata: ${entry.data}\n\n`)
  }

  function writeSseTree(res, tree) {
    const data = JSON.stringify({ root: tree.root, files: tree.files })
    res.write(`event: tree\ndata: ${data}\n\n`)
  }

  function writeSseChange(res, event) {
    res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`)
  }

  function checkTreeChange() {
    if (stopped) return
    const current = readTree(projectRoot)
    const changed =
      current.files.length !== lastFiles.length ||
      current.files.some((file, index) => file !== lastFiles[index])
    if (!changed) return
    lastFiles = current.files
    for (const client of clients) {
      writeSseTree(client, current)
    }
  }

  function startWatcher() {
    if (!projectRoot || stopped) return
    lastFiles = readTree(projectRoot).files
    try {
      watcher = watch(resolve(projectRoot), { recursive: true }, (_eventType, filename) => {
        if (stopped) return
        if (filename && IGNORED_WATCH.test(String(filename))) return
        if (watchTimer) clearTimeout(watchTimer)
        watchTimer = setTimeout(() => {
          watchTimer = null
          checkTreeChange()
        }, debounceMs)
      })
      watcher.on('error', () => {})
    } catch {}
  }

  function agentListOf(raw) {
    return Array.isArray(raw) ? raw : Array.isArray(raw?.agents) ? raw.agents : Array.isArray(raw?.data) ? raw.data : []
  }

  function rememberAgents(list) {
    const taken = new Set()
    const agents = list.map((entry) => mapAgent(entry, taken))
    const parsers = new Map()
    for (const agent of agents) {
      if (agent.id !== '') parsers.set(String(agent.id), agent.parser)
    }
    parserByAgentId = parsers
    return agents
  }

  function loadAgents() {
    fetch(`${paperclipUrl}/api/companies/${encodeURIComponent(companyId)}/agents`)
      .then(async (upstream) => {
        if (!upstream.ok) return
        rememberAgents(agentListOf(await upstream.json()))
      })
      .catch(() => {})
  }

  function countUnreadable(parsed) {
    const payload = parsed.payload
    if (parsed.type === 'heartbeat.run.log' && payload?.stream === 'stdout') {
      const agentId = String(payload.agentId ?? '')
      if (!parserByAgentId.has(agentId)) {
        const now = Date.now()
        if (now - agentFetchAt >= AGENT_FETCH_EVERY_MS) {
          agentFetchAt = now
          loadAgents()
        }
        return
      }
      unreadable.push(parserByAgentId.get(agentId), payload.runId, payload.chunk)
      return
    }
    if (parsed.type === 'heartbeat.run.status' && RUN_END_STATUSES.has(payload?.status)) {
      unreadable.end(payload.runId)
    }
  }

  function accept(parsed) {
    countUnreadable(parsed)
    if (typeof parsed.id === 'number' && parsed.id > nextId) {
      nextId = parsed.id
    } else {
      nextId += 1
    }
    const id = String(parsed.id ?? nextId)
    const data = JSON.stringify(parsed)
    const entry = { id, data }
    history.push(entry)
    if (history.length > HISTORY_LIMIT) history.shift()
    const notices = changeEvents(parsed)
    for (const client of clients) {
      writeSseFrame(client, entry)
      for (const notice of notices) writeSseChange(client, notice)
    }
  }

  async function pullLog(state, runId) {
    const response = await fetch(`${paperclipUrl}/api/heartbeat-runs/${encodeURIComponent(runId)}/log?offset=${state.offset}`, {
      signal: AbortSignal.timeout(logTimeoutMs),
    })
    if (!response.ok) return
    const body = await response.json()
    const end = typeof body?.content === 'string' ? body.content.lastIndexOf('\n') : -1
    if (end === -1) return
    const complete = body.content.slice(0, end + 1)
    for (const line of complete.split('\n')) {
      if (!line) continue
      try {
        const entry = JSON.parse(line)
        if (typeof entry.seq === 'number' && typeof entry.chunk === 'string' && entry.chunk.length > LIVE_CHUNK_LIMIT) {
          state.chunks.set(entry.seq, entry.chunk)
        }
      } catch {}
    }
    state.offset += Buffer.byteLength(complete, 'utf8')
  }

  async function fullChunk(payload) {
    let state = logs.get(payload.runId)
    if (!state) {
      state = { offset: 0, chunks: new Map() }
      logs.set(payload.runId, state)
      if (logs.size > LOG_RUNS_KEPT) logs.delete(logs.keys().next().value)
    }
    for (let attempt = 0; attempt < logRetries && !stopped; attempt += 1) {
      if (state.chunks.has(payload.seq)) break
      try {
        await pullLog(state, payload.runId)
      } catch {}
      if (state.chunks.has(payload.seq)) break
      await new Promise((resolveWait) => setTimeout(resolveWait, logRetryMs))
    }
    return state.chunks.get(payload.seq) ?? null
  }

  async function restore(parsed) {
    let frame = parsed
    try {
      const chunk = await fullChunk(parsed.payload)
      if (chunk) frame = { ...parsed, payload: { ...parsed.payload, chunk, truncated: false } }
    } catch {}
    if (!stopped) accept(frame)
  }

  function drain() {
    resolving = false
    while (waiting.length > 0 && !resolving && !stopped) dispatch(waiting.shift())
  }

  function dispatch(parsed) {
    const payload = parsed.payload
    const cut =
      parsed.type === 'heartbeat.run.log' &&
      payload?.truncated === true &&
      typeof payload.runId === 'string' &&
      typeof payload.seq === 'number'
    if (!cut) {
      accept(parsed)
      return
    }
    resolving = true
    restore(parsed).finally(drain)
  }

  function recordFrame(rawData) {
    const text = typeof rawData === 'string' ? rawData : Buffer.from(rawData).toString('utf8')
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object') return
    if (companyId && parsed.companyId && parsed.companyId !== companyId) return
    if (resolving) {
      waiting.push(parsed)
      return
    }
    dispatch(parsed)
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return
    const wait = reconnectDelay
    reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaxMs)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connectUpstream()
    }, wait)
  }

  function surfaceError(message) {
    paperclipVersion = null
    surface = { ok: null, checkedAt: new Date().toISOString(), error: message }
  }

  async function readPaperclipVersion() {
    try {
      const response = await fetch(`${paperclipUrl}/api/health`, { signal: AbortSignal.timeout(SURFACE_TIMEOUT_MS) })
      const body = await response.json()
      return typeof body?.version === 'string' && body.version ? body.version : null
    } catch {
      return null
    }
  }

  async function checkSurface() {
    if (stopped) return
    if (surfaceChecking) {
      surfacePending = true
      return
    }
    surfaceChecking = true
    try {
      let response
      try {
        response = await fetch(`${paperclipUrl}/api/openapi.json`, { signal: AbortSignal.timeout(SURFACE_TIMEOUT_MS) })
      } catch {
        surfaceError('Could not read the Paperclip spec: Paperclip is not reachable.')
        return
      }
      if (!response.ok) {
        surfaceError(`Paperclip answered ${response.status} when asked for its spec.`)
        return
      }
      let spec
      try {
        spec = await response.json()
      } catch {
        surfaceError('Paperclip answered something that is not a spec.')
        return
      }
      if (!spec || typeof spec !== 'object' || !spec.paths || typeof spec.paths !== 'object') {
        surfaceError('Paperclip answered a document with no routes. That is not a spec.')
        return
      }
      const result = compareSurface(spec)
      paperclipVersion = await readPaperclipVersion()
      const checkedAt = new Date().toISOString()
      surface = result.ok
        ? { ok: true, checkedAt }
        : {
            ok: false,
            checkedAt,
            missing: result.missing.map(({ method, path }) => ({ method, path })),
            changed: result.changed.map(({ method, path, answerFields, bodyFields }) => ({
              method,
              path,
              answerFields,
              bodyFields,
            })),
          }
    } catch {
      surfaceError('The Paperclip spec could not be read.')
    } finally {
      surfaceChecking = false
      if (surfacePending && !stopped) {
        surfacePending = false
        checkSurface().catch(() => {})
      }
    }
  }

  function startSurfaceTimer() {
    if (!(surfaceEveryMs > 0)) return
    surfaceTimer = setInterval(() => {
      checkSurface().catch(() => {})
    }, surfaceEveryMs)
    surfaceTimer.unref?.()
  }

  function connectUpstream() {
    if (stopped) return
    let ws
    try {
      ws = new WebSocket(toWsUrl(paperclipUrl, companyId))
    } catch {
      paperclipOpen = false
      scheduleReconnect()
      return
    }
    socket = ws
    ws.addEventListener('open', () => {
      if (socket !== ws) return
      paperclipOpen = true
      reconnectDelay = reconnectMinMs
      checkSurface().catch(() => {})
      loadAgents()
    })
    ws.addEventListener('message', (event) => {
      if (socket !== ws) return
      recordFrame(event.data)
    })
    ws.addEventListener('error', () => {
      if (socket !== ws) return
      paperclipOpen = false
    })
    ws.addEventListener('close', () => {
      if (socket !== ws) return
      paperclipOpen = false
      socket = null
      scheduleReconnect()
    })
  }

  const heartbeatTimer = setInterval(() => {
    for (const client of clients) {
      client.write(': keepalive\n\n')
    }
  }, heartbeatMs)
  heartbeatTimer.unref?.()

  async function handleRequest(req, res) {
    if (!isAllowedHost(req.headers.host)) {
      res.writeHead(403)
      res.end()
      return
    }
    if (req.headers.origin && !isAllowed(req.headers.origin)) {
      res.writeHead(403)
      res.end()
      return
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders(req),
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Last-Event-ID, Content-Type',
      })
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (await briefs.handle(req, res, url)) return
    if (await runs.handle(req, res, url)) return
    if (await reviews.handle(req, res, url)) return
    if (await control.handle(req, res, url)) return
    if (await assistant.handle(req, res, url)) return
    if (await decideApi.handle(req, res, url)) return

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(req, res, 200, {
        ok: true,
        paperclip: paperclipOpen,
        paperclipVersion,
        surface,
        unparsed: { ...unreadable.counts(), since: unparsedSince },
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/backup') {
      let upstream
      try {
        upstream = await fetch(`${paperclipUrl}/api/health`, { signal: AbortSignal.timeout(BACKUP_READ_TIMEOUT_MS) })
      } catch {
        sendJson(req, res, 502, { error: 'Paperclip did not answer.' })
        return
      }
      if (!upstream.ok) {
        sendJson(req, res, 502, { error: 'Paperclip did not answer.' })
        return
      }
      let health
      try {
        health = await upstream.json()
      } catch {
        sendJson(req, res, 502, { error: 'Paperclip did not answer.' })
        return
      }
      sendJson(req, res, 200, backupStatusAnswer(health?.databaseBackup))
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/backup') {
      const body = await readJsonBody(req, res)
      if (body === null) return
      if (body.confirmed !== true) {
        sendJson(req, res, 400, { error: 'Confirm the backup first.' })
        return
      }
      let upstream
      try {
        upstream = await fetch(`${paperclipUrl}/api/instance/database-backups`, {
          method: 'POST',
          signal: AbortSignal.timeout(BACKUP_RUN_TIMEOUT_MS),
        })
      } catch {
        sendJson(req, res, 502, { error: 'Paperclip could not make a backup.' })
        return
      }
      if (upstream.status === 409) {
        sendJson(req, res, 409, { error: 'A backup is already running.' })
        return
      }
      if (upstream.status === 403) {
        sendJson(req, res, 403, { error: 'Paperclip refused the backup.' })
        return
      }
      if (!upstream.ok) {
        sendJson(req, res, 502, { error: 'Paperclip could not make a backup.' })
        return
      }
      let answer
      try {
        answer = await upstream.json()
      } catch {
        answer = null
      }
      const name = backupFileName(answer?.backupFile)
      if (!name) {
        sendJson(req, res, 502, { error: 'Paperclip could not make a backup.' })
        return
      }
      sendJson(req, res, 200, {
        ok: true,
        name,
        sizeBytes: Number.isFinite(answer?.sizeBytes) ? answer.sizeBytes : null,
        prunedCount: Number.isFinite(answer?.prunedCount) ? answer.prunedCount : null,
        finishedAt: typeof answer?.finishedAt === 'string' && answer.finishedAt ? answer.finishedAt : null,
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/agents') {
      try {
        const upstream = await fetch(`${paperclipUrl}/api/companies/${encodeURIComponent(companyId)}/agents`)
        if (!upstream.ok) {
          sendJson(req, res, 502, { error: `upstream answered ${upstream.status}` })
          return
        }
        const raw = await upstream.json()
        sendJson(req, res, 200, rememberAgents(agentListOf(raw)))
      } catch {
        sendJson(req, res, 502, { error: 'upstream unreachable' })
      }
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/tree') {
      sendJson(req, res, 200, readTree(projectRoot))
      return
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        ...corsHeaders(req),
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.flushHeaders()

      const lastEventId = req.headers['last-event-id'] !== undefined ? String(req.headers['last-event-id']).trim() : ''
      const wantsHistory = url.searchParams.get('history') === '1'
      if (lastEventId) {
        const index = history.findIndex((item) => item.id === lastEventId)
        let replay = []
        if (index !== -1) {
          replay = history.slice(index + 1)
        } else if (/^\d+$/.test(lastEventId)) {
          const threshold = Number(lastEventId)
          replay = history.filter((item) => /^\d+$/.test(item.id) && Number(item.id) > threshold)
        }
        for (const entry of replay) {
          writeSseFrame(res, entry)
        }
      } else if (wantsHistory) {
        for (const entry of history) {
          writeSseFrame(res, entry)
        }
      }

      clients.add(res)
      req.on('close', () => {
        clients.delete(res)
      })
      return
    }

    if (await serveStatic(req, res, url)) return

    sendJson(req, res, 404, { error: 'not found' })
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'The bridge could not answer that.' }))
    })
  })

  function start() {
    startWatcher()
    startSurfaceTimer()
    checkSurface().catch(() => {})
    loadAgents()
    connectUpstream()
    return new Promise((resolveStart, rejectStart) => {
      server.once('error', rejectStart)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', rejectStart)
        const address = server.address()
        resolveStart({
          port: typeof address === 'object' && address ? address.port : port,
          url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`,
        })
      })
    })
  }

  function stop() {
    stopped = true
    waiting.length = 0
    runs.stopAll()
    clearInterval(heartbeatTimer)
    if (surfaceTimer) {
      clearInterval(surfaceTimer)
      surfaceTimer = null
    }
    surfacePending = false
    if (watchTimer) {
      clearTimeout(watchTimer)
      watchTimer = null
    }
    if (watcher) {
      try {
        watcher.close()
      } catch {}
      watcher = null
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (socket) {
      const current = socket
      socket = null
      paperclipOpen = false
      try {
        current.close()
      } catch {}
    }
    for (const client of clients) {
      try {
        client.end()
      } catch {}
    }
    clients.clear()
    return new Promise((resolveStop) => {
      if (!server.listening) {
        resolveStop()
        return
      }
      server.close(() => resolveStop())
    })
  }

  return { server, start, stop }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const bridge = createBridge()
  bridge.start().then(({ url }) => {
    console.log(`bridge listening on ${url}`)
  })
  const shutdown = () => {
    bridge.stop().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
