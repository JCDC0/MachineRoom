import { execFile } from 'node:child_process'
import { readdirSync, watch } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createSplitMasker } from '../src/briefs/audit.js'
import { createUnreadableCounter } from '../src/model/parsers/unreadable.js'
import { createAssistantApi } from './assistant.js'
import { createBriefsApi } from './briefs.js'
import { changeEvents, createControlApi } from './control.js'
import { createDecideApi } from './decide.js'
import { createPlansApi } from './plans.js'
import { createPolicyApi } from './policy.js'
import { createReviewsApi } from './reviews.js'
import { createRunsApi } from './runs.js'
import { gitPath } from './programPath.js'
import { createStaticHandler } from './static.js'
import { compareSurface, surfaceFeatures } from './surface.js'

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):(\d+)$/
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i
const VITE_PORT = 5173
const BODY_LIMIT = 64 * 1024
const SURFACE_TIMEOUT_MS = 10000
const SURFACE_EVERY_MS = 15 * 60 * 1000
const SURFACE_PAIR_TRIES = 3
const BACKUP_READ_TIMEOUT_MS = 10000
const BACKUP_RUN_TIMEOUT_MS = 120000
const AGENTS_TIMEOUT_MS = 15000

function localOrigin(origin) {
  const match = LOCAL_ORIGIN.exec(String(origin ?? ''))
  if (!match) return null
  const port = Number(match[2])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { port, text: `http://${match[1]}:${port}` }
}

function namedOrigins(value) {
  const origins = new Set()
  const skipped = []
  for (const raw of String(value ?? '').split(',')) {
    const entry = raw.trim()
    if (!entry) continue
    const origin = localOrigin(entry)
    if (origin) origins.add(origin.text)
    else skipped.push(entry)
  }
  return { origins, skipped }
}

export function isAllowedHost(host) {
  return typeof host === 'string' && LOCAL_HOST.test(host)
}

const HISTORY_LIMIT = 500
const LIVE_CHUNK_LIMIT = 8192
const LOG_RUNS_KEPT = 8
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist'])
const TREE_MAX_BUFFER = 64 * 1024 * 1024
const TREE_TIMEOUT_MS = 20000
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

function walkFiles(listDir, currentDir, prefix = '', out = []) {
  let entries
  try {
    entries = listDir(currentDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walkFiles(listDir, join(currentDir, entry.name), `${prefix}${entry.name}/`, out)
    } else if (entry.isFile()) {
      out.push(`${prefix}${entry.name}`)
    }
  }
  return out
}

export function readTree(projectRoot, { listDir = readdirSync } = {}) {
  if (!projectRoot) return Promise.resolve({ root: '', files: [], created: [] })
  const resolved = resolve(projectRoot)
  const root = basename(resolved)
  return new Promise((resolveTree) => {
    execFile(
      gitPath(),
      ['-C', resolved, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        encoding: 'utf8',
        env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(resolved) },
        maxBuffer: TREE_MAX_BUFFER,
        timeout: TREE_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          const files = walkFiles(listDir, resolved).sort()
          resolveTree({ root, files, created: [] })
          return
        }
        const files = stdout
          .split('\0')
          .filter(Boolean)
          .map((line) => line.replace(/\\/g, '/'))
          .sort()
        resolveTree({ root, files, created: [] })
      }
    )
  })
}

export const FOLDER_SHAPE = 'folders'

function joinPath(folder, name) {
  return folder === '' ? name : `${folder}/${name}`
}

function splitPath(path) {
  const at = path.lastIndexOf('/')
  return { folder: at === -1 ? '' : path.slice(0, at), name: path.slice(at + 1) }
}

export function packTree(tree) {
  const paths = { root: tree.root, files: tree.files }
  const ids = new Map([['', 0]])
  const folders = []
  const runs = []
  const folderId = (path) => {
    if (ids.has(path)) return ids.get(path)
    const { folder, name } = splitPath(path)
    const parent = folderId(folder)
    if (parent === null || joinPath(folder, name) !== path) return null
    folders.push([parent, name])
    ids.set(path, folders.length)
    return folders.length
  }
  for (const file of tree.files) {
    if (typeof file !== 'string') return paths
    const { folder, name } = splitPath(file)
    const id = folderId(folder)
    if (id === null || joinPath(folder, name) !== file) return paths
    const last = runs.at(-1)
    if (last && last[0] === id) last.push(name)
    else runs.push([id, name])
  }
  return { root: tree.root, shape: FOLDER_SHAPE, folders, files: runs }
}

export function treeEvent(tree, sent = null, shape = null) {
  if (!sent) {
    const body = shape === FOLDER_SHAPE ? packTree(tree) : { root: tree.root, files: tree.files }
    return `event: tree\ndata: ${JSON.stringify(body)}\n\n`
  }
  const known = new Set(sent)
  const files = tree.files.filter((file) => !known.has(file))
  if (files.length === 0) return ''
  return `event: tree\ndata: ${JSON.stringify({ root: tree.root, files })}\n\n`
}

function toWsUrl(paperclipUrl, companyId) {
  const base = String(paperclipUrl).replace(/\/+$/, '').replace(/^http/i, 'ws')
  return `${base}/api/companies/${encodeURIComponent(companyId)}/events/ws`
}

function corsHeaders(req, isAllowed) {
  const origin = req.headers.origin
  if (origin && !isAllowed(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin ?? 'http://localhost:5173',
    Vary: 'Origin',
  }
}

function createSendJson(isAllowed) {
  return function sendJson(req, res, status, body) {
    const payload = JSON.stringify(body)
    res.writeHead(status, {
      ...corsHeaders(req, isAllowed),
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    })
    res.end(payload)
  }
}

function createReadJsonBody(sendJson) {
  return function readJsonBody(req, res, limit = BODY_LIMIT) {
    return new Promise((resolveBody) => {
      const type = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
      if (type !== 'application/json') {
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
          res.once('finish', () => req.destroy())
          res.setHeader('Connection', 'close')
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
  const treeReader = options.readTree ?? readTree
  const port = Number(options.port ?? process.env.PORT ?? 5174)
  const reconnectMinMs = Number(options.reconnectMinMs ?? 1000)
  const reconnectMaxMs = Number(options.reconnectMaxMs ?? 15000)
  const heartbeatMs = Number(options.heartbeatMs ?? 15000)
  const debounceMs = Number(options.debounceMs ?? 300)
  const logRetries = Number(options.logRetries ?? 3)
  const logRetryMs = Number(options.logRetryMs ?? 150)
  const logTimeoutMs = Number(options.logTimeoutMs ?? 1500)
  const surfaceEveryMs = Number(options.surfaceEveryMs ?? SURFACE_EVERY_MS)
  const upstreamTimeoutMs = Number(options.upstreamTimeoutMs ?? AGENTS_TIMEOUT_MS)
  const env = options.env ?? process.env
  const origins = namedOrigins(env.MACHINEROOM_ORIGINS)
  for (const entry of origins.skipped) {
    console.log(`MACHINEROOM_ORIGINS: skipped ${entry}.`)
  }
  let servingPort = port
  const isAllowed = (origin) => {
    const parsed = localOrigin(origin)
    if (!parsed) return false
    return parsed.port === servingPort || parsed.port === VITE_PORT || origins.origins.has(parsed.text)
  }
  const sendJson = createSendJson(isAllowed)
  const readJsonBody = createReadJsonBody(sendJson)

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
    readJsonBody,
  })
  let surface = { ok: null, checkedAt: null, error: 'not checked yet' }
  const featureIsOff = (feature) => surfaceFeatures(surface)[feature] === false
  const control = createControlApi({
    paperclipUrl,
    companyId,
    projectId,
    projectWorkspaceId,
    sendJson,
    readJsonBody,
    featureOn: (feature) => !featureIsOff(feature),
    timeoutMs: upstreamTimeoutMs,
  })
  const policy = createPolicyApi({
    paperclipUrl,
    companyId,
    projectRoot,
    briefsDir: options.briefsDir ?? process.env.BRIEFS_DIR,
    sendJson,
    readJsonBody,
    featureOn: (feature) => !featureIsOff(feature),
    timeoutMs: upstreamTimeoutMs,
  })
  const plans = createPlansApi({
    paperclipUrl,
    companyId,
    projectId,
    projectWorkspaceId,
    projectRoot,
    briefsDir: options.briefsDir ?? process.env.BRIEFS_DIR,
    sendJson,
    readJsonBody,
    featureOn: (feature) => !featureIsOff(feature),
    timeoutMs: upstreamTimeoutMs,
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
  const treeSent = new WeakMap()
  const folderClients = new WeakSet()
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
  let treePrimed = false
  let treeReading = null
  let treeDirty = false
  let surfaceTimer = null
  let surfaceChecking = false
  let surfacePending = false
  let paperclipVersion = null
  const logs = new Map()
  const waiting = []
  let resolving = false
  const unreadable = createUnreadableCounter()
  const unparsedSince = new Date().toISOString()
  const maskedSince = new Date().toISOString()
  let maskedTotal = 0
  const masker = createSplitMasker()
  let maskTimer = null
  let parserByAgentId = new Map()
  let agentFetchAt = 0

  function writeSseFrame(res, entry) {
    res.write(`id: ${entry.id}\nevent: frame\ndata: ${entry.data}\n\n`)
  }

  function writeSseChange(res, event) {
    res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`)
  }

  function publishTree(current) {
    if (stopped) return
    if (!treePrimed) {
      treePrimed = true
      lastFiles = current.files
      return
    }
    const changed =
      current.files.length !== lastFiles.length ||
      current.files.some((file, index) => file !== lastFiles[index])
    if (!changed) return
    lastFiles = current.files
    const events = new Map()
    for (const client of clients) {
      const sent = treeSent.get(client) ?? null
      const shape = folderClients.has(client) ? FOLDER_SHAPE : null
      const key = sent ?? shape
      if (!events.has(key)) events.set(key, treeEvent(current, sent, shape))
      treeSent.set(client, current.files)
      if (events.get(key)) client.write(events.get(key))
    }
  }

  function startTreeRead() {
    if (stopped) return Promise.resolve(null)
    if (treeReading) return treeReading
    const read = (async () => {
      let tree
      try {
        tree = await treeReader(projectRoot)
      } catch {
        tree = { root: '', files: [], created: [] }
      }
      if (!tree || !Array.isArray(tree.files)) tree = { root: '', files: [], created: [] }
      if (stopped) return tree
      publishTree(tree)
      return tree
    })()
    treeReading = read
    const done = () => {
      if (treeReading === read) treeReading = null
      if (treeDirty && !stopped) {
        treeDirty = false
        startTreeRead().catch(() => {})
      }
    }
    read.then(done, done)
    return read
  }

  function checkTreeChange() {
    if (stopped) return
    if (treeReading) {
      treeDirty = true
      return
    }
    startTreeRead().catch(() => {})
  }

  function startWatcher() {
    if (!projectRoot) {
      treePrimed = true
      return
    }
    if (stopped) return
    const read = startTreeRead().catch(() => {})
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
    return read
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
    fetch(`${paperclipUrl}/api/companies/${encodeURIComponent(companyId)}/agents`, { signal: AbortSignal.timeout(upstreamTimeoutMs) })
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

  function emit(parsed) {
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

  function release(out) {
    maskedTotal += out.count
    for (const frame of out.frames) emit(frame)
    if (maskTimer) {
      clearTimeout(maskTimer)
      maskTimer = null
    }
    const at = masker.nextDue()
    if (at === null || stopped) return
    maskTimer = setTimeout(() => {
      maskTimer = null
      if (!stopped) release(masker.due(Date.now()))
    }, Math.max(0, at - Date.now()))
  }

  function accept(parsed) {
    countUnreadable(parsed)
    release(masker.push(parsed, Date.now()))
  }

  async function pullLog(state, runId) {
    const response = await fetch(`${paperclipUrl}/api/heartbeat-runs/${encodeURIComponent(runId)}/log?offset=${state.offset}`, {
      signal: AbortSignal.timeout(logTimeoutMs),
    })
    if (!response.ok) return response.status
    const body = await response.json()
    const end = typeof body?.content === 'string' ? body.content.lastIndexOf('\n') : -1
    if (end === -1) return response.status
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
    return response.status
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
      let status = 0
      try {
        status = await pullLog(state, payload.runId)
      } catch {}
      if (state.chunks.has(payload.seq) || status === 404) break
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

  async function readSurfaceSpec() {
    let response
    try {
      response = await fetch(`${paperclipUrl}/api/openapi.json`, { signal: AbortSignal.timeout(SURFACE_TIMEOUT_MS) })
    } catch {
      return { error: 'Could not read the Paperclip spec: Paperclip is not reachable.' }
    }
    if (!response.ok) return { error: `Paperclip answered ${response.status} when asked for its spec.` }
    let spec
    try {
      spec = await response.json()
    } catch {
      return { error: 'Paperclip answered something that is not a spec.' }
    }
    if (!spec || typeof spec !== 'object' || !spec.paths || typeof spec.paths !== 'object') {
      return { error: 'Paperclip answered a document with no routes. That is not a spec.' }
    }
    return { spec }
  }

  async function readSurfacePair() {
    for (let attempt = 0; attempt < SURFACE_PAIR_TRIES; attempt += 1) {
      const before = await readPaperclipVersion()
      const read = await readSurfaceSpec()
      if (read.error) return read
      const after = await readPaperclipVersion()
      if (before === after) return { spec: read.spec, version: after }
    }
    return { error: 'Paperclip changed while the bridge read its spec. The bridge checks again when its socket opens.' }
  }

  async function checkSurface() {
    if (stopped) return
    if (surfaceChecking) {
      surfacePending = true
      return
    }
    surfaceChecking = true
    try {
      const pair = await readSurfacePair()
      if (pair.error) {
        surfaceError(pair.error)
        return
      }
      const result = compareSurface(pair.spec)
      paperclipVersion = pair.version
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
        ...corsHeaders(req, isAllowed),
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
    if (await policy.handle(req, res, url)) return
    if (await plans.handle(req, res, url)) return
    if (await control.handle(req, res, url)) return
    if (await assistant.handle(req, res, url)) return
    if (await decideApi.handle(req, res, url)) return

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(req, res, 200, {
        ok: true,
        paperclip: paperclipOpen,
        paperclipVersion,
        surface,
        features: surfaceFeatures(surface),
        unparsed: { ...unreadable.counts(), since: unparsedSince },
        masked: { total: maskedTotal, since: maskedSince },
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/backup') {
      if (featureIsOff('backup')) {
        sendJson(req, res, 503, { error: 'Paperclip changed: backup is off. Run npm run doctor to see which routes.' })
        return
      }
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
      if (featureIsOff('backup')) {
        sendJson(req, res, 503, { error: 'Paperclip changed: backup is off. Run npm run doctor to see which routes.' })
        return
      }
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
        const upstream = await fetch(`${paperclipUrl}/api/companies/${encodeURIComponent(companyId)}/agents`, {
          signal: AbortSignal.timeout(upstreamTimeoutMs),
        })
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
      const tree = await startTreeRead()
      if (stopped || !tree) {
        res.destroy()
        return
      }
      const wantsFolders = String(req.headers.accept ?? '').includes(`shape=${FOLDER_SHAPE}`)
      sendJson(req, res, 200, wantsFolders ? { ...packTree(tree), created: tree.created } : tree)
      return
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        ...corsHeaders(req, isAllowed),
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
      if (url.searchParams.get('tree') === FOLDER_SHAPE) folderClients.add(res)
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
      if (res.headersSent) {
        res.end()
        return
      }
      sendJson(req, res, 500, { error: 'The bridge could not answer that.' })
    })
  })

  async function start() {
    await startWatcher()
    if (stopped) throw new Error('The bridge stopped before it started.')
    startSurfaceTimer()
    checkSurface().catch(() => {})
    loadAgents()
    connectUpstream()
    return new Promise((resolveStart, rejectStart) => {
      server.once('error', rejectStart)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', rejectStart)
        const address = server.address()
        const actualPort = typeof address === 'object' && address ? address.port : port
        servingPort = actualPort
        resolveStart({
          port: actualPort,
          url: `http://127.0.0.1:${actualPort}`,
        })
      })
    })
  }

  function stop() {
    stopped = true
    waiting.length = 0
    if (maskTimer) {
      clearTimeout(maskTimer)
      maskTimer = null
    }
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
