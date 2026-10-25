import { execFile } from 'node:child_process'
import { readdirSync, statSync, watch } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { gzip as gzipCallback } from 'node:zlib'
import { createSplitMasker } from '../src/briefs/audit.js'
import { createUnreadableCounter } from '../src/model/parsers/unreadable.js'
import { createAssistantApi } from './assistant.js'
import { createBriefsApi } from './briefs.js'
import { changeEvents, createControlApi } from './control.js'
import { createDecideApi } from './decide.js'
import { createLanesSource, readLanes, runsFolder } from './lanes-source.js'
import { createOrchestrators } from './orchestrators.js'
import { createPlansApi } from './plans.js'
import { createPolicyApi } from './policy.js'
import { createReviewsApi } from './reviews.js'
import { createRunsApi } from './runs.js'
import { createSessionsSource } from './sessions-source.js'
import { gitPath } from './programPath.js'
import { createStaticHandler } from './static.js'

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):(\d+)$/
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i
const VITE_PORT = 5173
const BODY_LIMIT = 64 * 1024

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
const TREE_VERSIONS_KEPT = 4
const TREE_REUSE_MS = 1000
const WATCH_QUIET_MS = 2000
const POLL_READ_GAP = 3
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.worktrees'])
const TREE_MAX_BUFFER = 64 * 1024 * 1024
const TREE_TIMEOUT_MS = 20000
const IGNORED_WATCH = /(^|[/\\])(\.git|node_modules|\.worktrees)([/\\]|$)/
const RUN_END_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out'])
const gzipAsync = promisify(gzipCallback)

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

export function createBridge(options = {}) {
  const projectRoot = options.projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd()
  const treeReader = options.readTree ?? readTree
  const port = Number(options.port ?? process.env.PORT ?? 5174)
  const heartbeatMs = Number(options.heartbeatMs ?? 15000)
  const debounceMs = Number(options.debounceMs ?? 300)
  const pollMs = Number(options.pollMs ?? Math.min(debounceMs, 200))
  const quietMs = Number(options.quietMs ?? WATCH_QUIET_MS)
  const env = options.env ?? process.env
  const origins = namedOrigins(env.MACHINEROOM_ORIGINS)
  for (const entry of origins.skipped) {
    console.log(`MACHINEROOM_ORIGINS: skipped ${entry}.`)
  }
  let servingPort = port
  const viteOrigin = !options.staticDir
  const isAllowed = (origin) => {
    const parsed = localOrigin(origin)
    if (!parsed) return false
    return parsed.port === servingPort || (viteOrigin && parsed.port === VITE_PORT) || origins.origins.has(parsed.text)
  }
  const sendJson = createSendJson(isAllowed)
  const readJsonBody = createReadJsonBody(sendJson)
  let orchestrators = null

  const briefs = createBriefsApi({
    projectRoot,
    briefsDir: options.briefsDir ?? process.env.BRIEFS_DIR,
    sendJson,
  })
  const runs = createRunsApi({
    projectRoot,
    briefsDir: options.briefsDir ?? process.env.BRIEFS_DIR,
    runnerCommand: options.runnerCommand,
    lanesFile: options.lanesFile,
    runsFolder: options.runsFolder ?? options.orchestratorFolder,
    sendJson,
    readJsonBody,
    orchestrators: () => orchestrators,
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
  const control = createControlApi({
    sendJson,
    readJsonBody,
    lanes: () => lanesSource,
  })
  const policy = createPolicyApi({
    projectRoot,
    briefsDir: options.briefsDir ?? process.env.BRIEFS_DIR,
    sendJson,
    readJsonBody,
    lanes: () => lanesSource,
  })
  const plans = createPlansApi({
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
  const lanesSourceOption = options.lanesSource
  const lanesSourceOn =
    lanesSourceOption === true || (lanesSourceOption !== null && typeof lanesSourceOption === 'object') || env.MACHINEROOM_LANES === '1'
  const lanesSourceObject = lanesSourceOption !== null && typeof lanesSourceOption === 'object' ? lanesSourceOption : {}
  const lanesConfig = lanesSourceOn ? lanesSourceObject.lanes ?? readLanes() : {}
  const lanesSource = lanesSourceOn
    ? createLanesSource({
        ...lanesSourceObject,
        projectRoot,
        subOrchestrators: () => (orchestrators ? orchestrators.subs() : []),
        onFrame: (frame) => {
          if (orchestrators) orchestrators.onFrame(frame)
          accept(frame)
        },
      })
    : null
  const sessionsSourceOption = options.sessionsSource
  const sessionsSourceOn =
    sessionsSourceOption === true || (sessionsSourceOption !== null && typeof sessionsSourceOption === 'object') || env.MACHINEROOM_SESSIONS === '1'
  const sessionsSource = sessionsSourceOn
    ? createSessionsSource({
        ...(sessionsSourceOption !== null && typeof sessionsSourceOption === 'object' ? sessionsSourceOption : {}),
        projectRoot,
        onFrame: (frame) => accept(frame),
      })
    : null

  const clients = new Set()
  const maskedSince = new Date().toISOString()
  let maskedTotal = 0
  if (lanesSourceOn) {
    orchestrators = createOrchestrators({
      projectRoot,
      runsFolder: resolve(options.orchestratorFolder ?? lanesSourceObject.folder ?? runsFolder()),
      lanes: lanesConfig,
      spawn: options.orchestratorSpawn,
      now: options.now,
      promptFile: options.orchestratorPrompt,
      bridgeUrl: () => (servingPort ? `http://127.0.0.1:${servingPort}` : ''),
      onNotice: (event) => {
        for (const client of clients) writeSseChange(client, event)
      },
      onMasked: (count) => {
        maskedTotal += count
      },
      sendJson,
      readJsonBody,
    })
  }
  const treeSent = new WeakMap()
  const folderClients = new WeakSet()
  const treeClients = new WeakSet()
  const history = []
  let nextId = 0
  let stopped = false
  let watcher = null
  let pollTimer = null
  let lastFiles = []
  let lastTree = null
  let lastTreeAt = 0
  let treeChangedAt = 0
  let lastReadMs = 0
  let treePrimed = false
  let treeVersion = 0
  const treeVersions = new Map()
  let treeReading = null
  let treeDirty = false
  const unreadable = createUnreadableCounter()
  const unparsedSince = new Date().toISOString()
  const masker = createSplitMasker()
  let maskTimer = null
  let parserByAgentId = new Map()

  function writeSseFrame(res, entry) {
    res.write(`id: ${entry.id}\nevent: frame\ndata: ${entry.data}\n\n`)
  }

  function writeSseChange(res, event) {
    res.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`)
  }

  function rememberTreeVersion(files) {
    treeVersion += 1
    treeVersions.set(treeVersion, files)
    while (treeVersions.size > TREE_VERSIONS_KEPT) {
      treeVersions.delete(treeVersions.keys().next().value)
    }
  }

  function publishTree(current) {
    if (stopped) return
    lastTree = current
    lastTreeAt = Date.now()
    if (!treePrimed) {
      treePrimed = true
      treeChangedAt = lastTreeAt
      lastFiles = current.files
      rememberTreeVersion(current.files)
      return
    }
    const changed =
      current.files.length !== lastFiles.length ||
      current.files.some((file, index) => file !== lastFiles[index])
    if (!changed) return
    treeChangedAt = lastTreeAt
    lastFiles = current.files
    rememberTreeVersion(current.files)
    const events = new Map()
    for (const client of clients) {
      if (!treeClients.has(client)) continue
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
    const began = Date.now()
    const done = () => {
      lastReadMs = Date.now() - began
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
    if (!armWatcher()) beginPolling(false)
    return read
  }

  function armWatcher() {
    if (stopped || !projectRoot) return false
    if (watcher) return true
    try {
      if (!statSync(resolve(projectRoot)).isDirectory()) return false
      const current = watch(resolve(projectRoot), { recursive: true }, (_eventType, filename) => {
        if (stopped) return
        if (filename && IGNORED_WATCH.test(String(filename))) return
        beginPolling()
      })
      current.on('error', () => {
        if (watcher === current) beginPolling(false)
      })
      watcher = current
      return true
    } catch {
      watcher = null
      return false
    }
  }

  function beginPolling(readNow = true) {
    if (stopped) return
    if (watcher) {
      try {
        watcher.close()
      } catch {}
      watcher = null
    }
    if (pollTimer) return
    if (readNow) checkTreeChange()
    pollTimer = setInterval(() => {
      if (stopped) return
      if (treeReading) return
      if (Date.now() - treeChangedAt >= quietMs && armWatcher()) {
        clearInterval(pollTimer)
        pollTimer = null
        startTreeRead().catch(() => {})
        return
      }
      if (Date.now() - lastTreeAt < Math.max(pollMs, lastReadMs * POLL_READ_GAP)) return
      checkTreeChange()
    }, pollMs)
  }

  function rememberLaneParsers() {
    if (!lanesSource) return
    for (const agent of lanesSource.agents) {
      if (agent.id !== '') parserByAgentId.set(String(agent.id), agent.parser)
    }
  }

  function rememberSessionsParsers() {
    if (!sessionsSource) return
    for (const agent of sessionsSource.agents) {
      if (agent.id !== '') parserByAgentId.set(String(agent.id), agent.parser)
    }
  }

  function countUnreadable(parsed) {
    const payload = parsed.payload
    if (parsed.type === 'heartbeat.run.log' && payload?.stream === 'stdout') {
      const agentId = String(payload.agentId ?? '')
      if (!parserByAgentId.has(agentId)) return
      unreadable.push(parserByAgentId.get(agentId), payload.runId, payload.chunk)
      return
    }
    if (parsed.type === 'heartbeat.run.status' && RUN_END_STATUSES.has(payload?.status)) {
      unreadable.end(payload.runId)
    }
  }

  function holdsRunStart(parsed) {
    return (
      parsed?.type === 'heartbeat.run.queued' ||
      (parsed?.type === 'heartbeat.run.status' && parsed.payload?.status === 'running')
    )
  }

  function trimHistory() {
    while (history.length > HISTORY_LIMIT) {
      const index = history.findIndex((item) => !item.pinned)
      if (index === -1) return
      history.splice(index, 1)
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
    const runId = parsed?.payload?.runId
    const endsRun = parsed?.type === 'heartbeat.run.status' && RUN_END_STATUSES.has(parsed.payload?.status)
    const entry = { id, data, runId, pinned: holdsRunStart(parsed) }
    history.push(entry)
    if (runId !== undefined && runId !== null && endsRun) {
      for (const item of history) {
        if (item.runId === runId) item.pinned = false
      }
    }
    trimHistory()
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
        'Access-Control-Allow-Headers': 'Last-Event-ID, Content-Type, X-MachineRoom-Orchestrator',
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

    if (orchestrators && (await orchestrators.handle(req, res, url))) return

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(req, res, 200, {
        ok: true,
        lanes: lanesSource !== null,
        sessions: sessionsSource !== null,
        ...(orchestrators ? { orchestrator: true } : {}),
        unparsed: { ...unreadable.counts(), since: unparsedSince },
        masked: { total: maskedTotal, since: maskedSince },
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/agents') {
      rememberLaneParsers()
      rememberSessionsParsers()
      const laneAgents = lanesSource ? [...lanesSource.agents] : []
      const sessionAgents = sessionsSource ? [...sessionsSource.agents] : []
      sendJson(req, res, 200, [...laneAgents, ...sessionAgents])
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/tree') {
      const wantsFolders = String(req.headers.accept ?? '').includes(`shape=${FOLDER_SHAPE}`)
      const recent = lastTree && Date.now() - lastTreeAt <= TREE_REUSE_MS
      const tree = wantsFolders && recent ? lastTree : await startTreeRead()
      if (stopped || !tree) {
        res.destroy()
        return
      }
      const body = wantsFolders ? { ...packTree(tree), created: tree.created, version: treeVersion } : tree
      const payload = Buffer.from(JSON.stringify(body), 'utf8')
      const wantsGzip = /(^|,)\s*gzip\b/i.test(String(req.headers['accept-encoding'] ?? ''))
      if (!wantsGzip) {
        sendJson(req, res, 200, body)
        return
      }
      const compressed = await gzipAsync(payload)
      if (stopped) {
        res.destroy()
        return
      }
      res.writeHead(200, {
        ...corsHeaders(req, isAllowed),
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
        Vary: 'Origin, Accept-Encoding',
        'Content-Length': compressed.length,
      })
      res.end(compressed)
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
      if (url.searchParams.has('tree')) {
        treeClients.add(res)
        if (url.searchParams.get('tree') === FOLDER_SHAPE) folderClients.add(res)
        const sinceText = url.searchParams.get('since')
        const sinceVersion = sinceText && /^\d+$/.test(sinceText) ? Number(sinceText) : null
        const sinceFiles = sinceVersion === null ? null : treeVersions.get(sinceVersion)
        if (sinceFiles) treeSent.set(res, sinceFiles)
      }
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
    rememberLaneParsers()
    rememberSessionsParsers()
    lanesSource?.start()
    sessionsSource?.start()
    await startWatcher()
    if (stopped) throw new Error('The bridge stopped before it started.')
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
    if (maskTimer) {
      clearTimeout(maskTimer)
      maskTimer = null
    }
    runs.stopAll()
    orchestrators?.close()
    lanesSource?.stop()
    sessionsSource?.stop()
    clearInterval(heartbeatTimer)
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    if (watcher) {
      try {
        watcher.close()
      } catch {}
      watcher = null
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

  return { server, start, stop, orchestrators: () => orchestrators }
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
