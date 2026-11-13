import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readdirSync, statSync, watch } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { gzip as gzipCallback } from 'node:zlib'
import { createSplitMasker } from '../src/briefs/audit.js'
import { createUnreadableCounter } from '../src/model/parsers/unreadable.js'
import { createActiveLanesApi } from './active-lanes.js'
import { createAgentsConfigApi, moveRemovedLanesToProject } from './agents-config.js'
import { createAssistantApi } from './assistant.js'
import { createBriefsApi } from './briefs.js'
import { changeEvents, createControlApi } from './control.js'
import { createDecideApi } from './decide.js'
import { createFamilyApi } from './family.js'
import { createAgentDepthApi } from './agent-depth.js'
import { createEndpointsApi, createModelPinsApi } from './endpoints.js'
import { createFilesApi } from './files.js'
import { createGitApi } from './git.js'
import { createHarnessModelsApi } from './harness-models.js'
import { createLanesSource, readLanes, runsFolder } from './lanes-source.js'
import { createMcpApi } from './mcp.js'
import { createMusicApi } from './music.js'
import { createNetworkApi } from './network.js'
import { createOrchestrators } from './orchestrators.js'
import { createPlansApi } from './plans.js'
import { createPolicyApi } from './policy.js'
import { createProjectsApi } from './projects.js'
import { createReviewsApi } from './reviews.js'
import { createRunsApi, isGitCheckout } from './runs.js'
import { createTeamsApi } from './teams.js'
import { createSearchApi } from './search.js'
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
const WATCH_BURST_QUIET_MS = 300
const QUIET_FULL_READ_MS = 30000
const TREE_LAST_FILE_BUDGET_MS = 3000
const POLL_READ_GAP = 3
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.worktrees'])
const TREE_MAX_BUFFER = 64 * 1024 * 1024
const TREE_TIMEOUT_MS = 20000
const PARTIAL_NAME_LIMIT = 50
const PARTIAL_FULL_EVERY = 10
const IGNORED_WATCH = /(^|[/\\])(\.git|node_modules|\.worktrees)([/\\]|$)/
const RUN_END_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out'])
const AGENT_MESSAGE_KINDS = new Set(['order', 'report', 'dispatch', 'wake'])
const PLAIN_TREE = Symbol('plainTree')
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

function walkTree(projectRoot, listDir = readdirSync) {
  const resolved = resolve(projectRoot)
  return { root: basename(resolved), files: walkFiles(listDir, resolved).sort(), created: [] }
}

function runGitPaths(resolved, args) {
  return new Promise((resolveList) => {
    execFile(
      gitPath(),
      ['-C', resolved, ...args],
      {
        encoding: 'utf8',
        env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(resolved) },
        maxBuffer: TREE_MAX_BUFFER,
        timeout: TREE_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          resolveList(null)
          return
        }
        resolveList(
          stdout
            .split('\0')
            .filter(Boolean)
            .map((line) => line.replace(/\\/g, '/'))
        )
      }
    )
  })
}

function gitListPaths(resolved, args) {
  return runGitPaths(resolved, ['ls-files', '-z', ...args])
}

export function deletedDiffArgs(names) {
  const args = [
    '-c',
    'core.longpaths=true',
    'diff-files',
    '--name-only',
    '-z',
    '--diff-filter=D',
    '--no-ext-diff',
    '--no-textconv',
    '--relative',
  ]
  if (names !== null && names !== undefined) args.push('--', ...names)
  return args
}

function gitDeletedPaths(resolved, names) {
  return runGitPaths(resolved, deletedDiffArgs(names))
}

function dropDeleted(files, deleted) {
  if (deleted === null) return files
  const gone = new Set(deleted)
  return files.filter((file) => !gone.has(file))
}

export async function readTree(projectRoot, { listDir = readdirSync, gitList = gitListPaths, gitDeleted = gitDeletedPaths } = {}) {
  if (!projectRoot) return { root: '', files: [], created: [] }
  const resolved = resolve(projectRoot)
  const root = basename(resolved)
  const listedPromise = gitList(resolved, ['--cached', '--others', '--exclude-standard'])
  const deletedPromise = gitDeleted(resolved)
  const listed = await listedPromise
  if (listed === null) return { ...walkTree(resolved, listDir), [PLAIN_TREE]: true }
  const deleted = await deletedPromise
  return { root, files: dropDeleted(listed, deleted).sort(), created: [] }
}

export async function readTreePartial(projectRoot, names, { gitList = gitListPaths, gitDeleted = gitDeletedPaths } = {}) {
  const wanted = Array.isArray(names) ? names.filter((name) => typeof name === 'string' && name !== '') : []
  if (!projectRoot || wanted.length === 0) return null
  const resolved = resolve(projectRoot)
  const root = basename(resolved)
  const listed = await gitList(resolved, ['--cached', '--others', '--exclude-standard', '--', ...wanted])
  if (listed === null) return null
  const deleted = await gitDeleted(resolved, wanted)
  return { root, files: dropDeleted(listed, deleted).sort(), created: [] }
}

export function mergeNamedFiles(current, names, listed) {
  const base = current && Array.isArray(current.files) ? current.files : []
  const root = current && typeof current.root === 'string' ? current.root : ''
  const clean = []
  for (const name of names) {
    if (typeof name !== 'string') continue
    const path = name.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
    if (!path || path === '..' || path.startsWith('../') || path.startsWith('/') || /^[A-Za-z]:\//.test(path)) continue
    clean.push(path)
  }
  const seen = new Set()
  const wanted = []
  for (const file of Array.isArray(listed) ? listed : []) {
    if (typeof file !== 'string' || seen.has(file)) continue
    seen.add(file)
    wanted.push(file)
  }
  wanted.sort()
  const covered = (file) => clean.some((name) => file === name || file.startsWith(`${name}/`))
  const kept = []
  for (const file of base) {
    if (!covered(file)) kept.push(file)
  }
  const files = []
  let held = 0
  let add = 0
  while (held < kept.length && add < wanted.length) {
    if (kept[held] < wanted[add]) files.push(kept[held++])
    else if (kept[held] > wanted[add]) files.push(wanted[add++])
    else {
      files.push(kept[held++])
      add += 1
    }
  }
  while (held < kept.length) files.push(kept[held++])
  while (add < wanted.length) files.push(wanted[add++])
  return { root, files, created: Array.isArray(current?.created) ? current.created : [] }
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

export function treeEvent(tree, sent = null, shape = null, version = null, start = null) {
  const stamped = (body) => {
    const withVersion = Number.isInteger(version) && version >= 0 ? { ...body, version } : body
    return typeof start === 'string' && start !== '' ? { ...withVersion, start } : withVersion
  }
  if (!sent) {
    const body = shape === FOLDER_SHAPE ? { ...packTree(tree), full: true } : { root: tree.root, files: tree.files, full: true }
    return `event: tree\ndata: ${JSON.stringify(stamped(body))}\n\n`
  }
  const known = new Set(sent)
  const files = tree.files.filter((file) => !known.has(file))
  if (files.length === 0) return ''
  return `event: tree\ndata: ${JSON.stringify(stamped({ root: tree.root, files }))}\n\n`
}

function pathChanges(previous, next) {
  const added = []
  const removed = []
  let before = 0
  let after = 0
  while (before < previous.length || after < next.length) {
    if (after >= next.length || (before < previous.length && previous[before] < next[after])) {
      removed.push(previous[before])
      before += 1
    } else if (before >= previous.length || next[after] < previous[before]) {
      added.push(next[after])
      after += 1
    } else {
      before += 1
      after += 1
    }
  }
  return { added, removed }
}

function treeDeltaEvent(root, files, removed = [], version = null, start = null) {
  const body = { root, files, removed }
  if (Number.isInteger(version) && version >= 0) body.version = version
  if (typeof start === 'string' && start !== '') body.start = start
  return `event: tree\ndata: ${JSON.stringify(body)}\n\n`
}

function treeSinceVersion(text, start) {
  const value = String(text ?? '')
  if (/^\d+$/.test(value)) return Number(value)
  const match = /^([0-9a-f]+):(\d+)$/.exec(value)
  if (!match || match[1] !== start) return null
  return Number(match[2])
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

export function treeReadDue({ now, lastReadEndAt, lastReadMs, lastReadChanged, lastTreeAt, quietMs, pollMs, budgetMs }) {
  if (lastReadChanged) {
    const gap = Math.max(pollMs, budgetMs - lastReadMs)
    return now - lastReadEndAt >= gap
  }
  return now - lastTreeAt >= quietMs
}

export const RUN_PIN_TIMEOUT_MS = 2 * 60 * 60 * 1000

export function readEventCursor(text, start) {
  const match = /^([0-9a-f]+):(\d+)$/.exec(String(text ?? ''))
  if (!match || match[1] !== start) return null
  return Number(match[2])
}

export function eventResetNeeded(history, lastEventId, start, latestSeq) {
  const seq = readEventCursor(lastEventId, start)
  if (seq === null) return true
  if (seq > latestSeq) return true
  let expected = seq + 1
  for (const item of history) {
    if (item.seq <= seq) continue
    if (item.seq !== expected) return true
    expected += 1
  }
  return expected <= latestSeq
}

export const SSE_PENDING_LIMIT = 8 * 1024 * 1024

export function createSseWriter({ limit = SSE_PENDING_LIMIT, onDrop = null } = {}) {
  const dropped = new WeakSet()
  const allowances = new WeakMap()

  function drop(res) {
    if (!res || dropped.has(res)) return
    dropped.add(res)
    if (typeof onDrop === 'function') onDrop(res)
    try {
      res.destroy()
    } catch {}
  }

  function write(res, text, { connect = false } = {}) {
    if (!res || dropped.has(res)) return false
    if (!connect && (res.writableLength ?? 0) > (allowances.get(res) ?? limit)) {
      drop(res)
      return false
    }
    let ok = true
    try {
      ok = res.write(text) !== false
    } catch {
      drop(res)
      return false
    }
    return ok
  }

  function allowBacklog(res) {
    if (!res || dropped.has(res)) return
    allowances.set(res, (res.writableLength ?? 0) + limit)
  }

  return { write, allowBacklog, drop, isDropped: (res) => !res || dropped.has(res) }
}

export function trimHistory(history, now = Date.now) {
  const currentTime = typeof now === 'function' ? now() : Number(now ?? Date.now())
  const lastFrameAt = new Map()
  for (const item of history) {
    if (item.runId && typeof item.at === 'number') {
      const prev = lastFrameAt.get(item.runId)
      if (prev === undefined || item.at > prev) lastFrameAt.set(item.runId, item.at)
    }
  }
  const expired = new Set()
  for (const [runId, latest] of lastFrameAt) {
    if (currentTime - latest >= RUN_PIN_TIMEOUT_MS) expired.add(runId)
  }
  if (expired.size > 0) {
    for (const item of history) {
      if (item.runId && expired.has(item.runId)) item.pinned = false
    }
  }
  while (history.length > HISTORY_LIMIT) {
    const index = history.findIndex((item) => !item.pinned)
    if (index === -1) break
    history.splice(index, 1)
  }
  if (history.length > HISTORY_LIMIT) {
    history.splice(0, history.length - HISTORY_LIMIT)
  }
}

export function createBridge(options = {}) {
  const projectRoot = options.projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd()
  const treeReader = options.readTree ?? readTree
  const partialTreeReader = options.readTreePartial ?? readTreePartial
  const watchProject = options.watchProject ?? watch
  const packFolderTree = options.packTree ?? packTree
  const port = Number(options.port ?? process.env.PORT ?? 5174)
  const heartbeatMs = Number(options.heartbeatMs ?? 15000)
  const debounceMs = Number(options.debounceMs ?? 300)
  const pollMs = Number(options.pollMs ?? Math.min(debounceMs, 200))
  const quietMs = Number(options.quietMs ?? WATCH_QUIET_MS)
  const quietFullMs = Number(options.quietFullMs ?? QUIET_FULL_READ_MS)
  const treeBudgetMs = Number(options.treeBudgetMs ?? TREE_LAST_FILE_BUDGET_MS)
  const now = typeof options.now === 'function' ? options.now : Date.now
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
  let activeLanes = null

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
    activeLanes: () => activeLanes,
    onMessage: sendAgentMessage,
    notify: (event) => {
      for (const client of clients) writeSseChange(client, event)
    },
  })
  const lanesSourceOption = options.lanesSource
  const lanesSourceOn =
    lanesSourceOption === true || (lanesSourceOption !== null && typeof lanesSourceOption === 'object') || env.MACHINEROOM_LANES === '1'
  const lanesSourceObject = lanesSourceOption !== null && typeof lanesSourceOption === 'object' ? lanesSourceOption : {}
  const reviews = createReviewsApi({
    projectRoot,
    briefsDir: options.briefsDir ?? process.env.BRIEFS_DIR,
    patchLimit: options.patchLimit,
    runsFolder: options.runsFolder ?? options.orchestratorFolder ?? lanesSourceObject.folder ?? '',
    sendJson,
    readJsonBody,
    orchestrators: () => orchestrators,
    notify: (event) => {
      for (const client of clients) writeSseChange(client, event)
    },
  })
  const control = createControlApi({
    sendJson,
    readJsonBody,
    lanes: () => lanesSource,
  })
  const policy = createPolicyApi({
    projectRoot,
    briefsDir: options.briefsDir ?? process.env.BRIEFS_DIR,
    runsFolder: options.runsFolder ?? options.orchestratorFolder ?? (options.lanesSource && typeof options.lanesSource === 'object' ? options.lanesSource.folder : null),
    lanesFile: options.lanesFile,
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
  const music = createMusicApi({
    folder: options.musicFolder,
    env,
    sendJson,
    readJsonBody,
    corsHeaders: (req) => corsHeaders(req, isAllowed),
    platform: options.musicPlatform,
    check: options.musicProgramCheck,
    spawn: options.musicSpawn,
    openFolder: options.musicOpenFolder,
  })
  const serveStatic = createStaticHandler({ staticDir: options.staticDir })
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
  activeLanes = createActiveLanesApi({
    projectRoot,
    runsFolder: resolve(options.runsFolder ?? options.orchestratorFolder ?? lanesSourceObject.folder ?? runsFolder()),
    lanesFile: options.lanesFile,
    lanes: () => (lanesSourceOn ? lanesConfig : readLanes()),
    isWorking: (key) => {
      const fromSource = lanesSource ? lanesSource.openRuns().some((r) => r.lane === key) : false
      const fromRuns = runs && typeof runs.isRunning === 'function' ? runs.isRunning(key) : false
      return fromSource || fromRuns
    },
    notify: (event) => {
      for (const client of clients) writeSseChange(client, event)
    },
    sendJson,
    readJsonBody,
  })
  const agentsConfig = createAgentsConfigApi({
    runsFolder: resolve(options.runsFolder ?? options.orchestratorFolder ?? lanesSourceObject.folder ?? runsFolder()),
    projectRoot,
    lanes: () => (lanesSourceOn ? lanesConfig : readLanes()),
    activeLanes: () => activeLanes,
    isWorking: (key) => {
      const fromSource = lanesSource ? lanesSource.openRuns().some((r) => r.lane === key) : false
      const fromRuns = runs && typeof runs.isRunning === 'function' ? runs.isRunning(key) : false
      return fromSource || fromRuns
    },
    notify: (event) => {
      for (const client of clients) writeSseChange(client, event)
    },
    sendJson,
    readJsonBody,
    env,
  })
  const endpoints = createEndpointsApi({
    runsFolder: resolve(options.runsFolder ?? options.orchestratorFolder ?? lanesSourceObject.folder ?? runsFolder()),
    sendJson,
    readJsonBody,
    notify: notifyHeard,
  })
  const modelPins = createModelPinsApi({
    runsFolder: resolve(options.runsFolder ?? options.orchestratorFolder ?? lanesSourceObject.folder ?? runsFolder()),
    sendJson,
    readJsonBody,
  })
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
      onMessage: sendAgentMessage,
      sendJson,
      readJsonBody,
      isWorking: (key) => {
        const fromSource = lanesSource ? lanesSource.openRuns().some((r) => r.lane === key) : false
        const fromRuns = runs && typeof runs.isRunning === 'function' ? runs.isRunning(key) : false
        return fromSource || fromRuns
      },
      startLaneTask: async (lane, taskText) => {
        if (!runs || typeof runs.startProjectTask !== 'function') throw new Error('The runner is not available.')
        return runs.startProjectTask({
          lane,
          task: taskText,
          worktree: await isGitCheckout(projectRoot),
          allowDirty: false,
          startedBy: 'orchestrator',
        })
      },
    })
  }
  const bridgeRunsFolder = resolve(options.runsFolder ?? options.orchestratorFolder ?? lanesSourceObject.folder ?? runsFolder())
  const harnessModelsApi = createHarnessModelsApi({
    projectRoot,
    runsFolder: bridgeRunsFolder,
    lanes: () => (lanesSourceOn ? lanesConfig : readLanes()),
    sendJson,
    env,
  })
  const search = createSearchApi({
    runsFolder: bridgeRunsFolder,
    sendJson,
    readJsonBody,
  })
  const mcp = createMcpApi({
    runsFolder: bridgeRunsFolder,
    sendJson,
    readJsonBody,
    notify: notifyHeard,
  })
  const projects = createProjectsApi({
    projectRoot,
    runsFolder: bridgeRunsFolder,
    onOpenProject: options.onOpenProject,
    orchestrators: () => orchestrators,
    runs: () => runs,
    lanesSource: () => lanesSource,
    sendJson,
    readJsonBody,
    now: options.now,
  })
  const familyApi = createFamilyApi({
    projectRoot,
    runsFolder: bridgeRunsFolder,
    lanes: () => (lanesSourceOn ? lanesConfig : readLanes()),
    activeLanes: () => activeLanes,
    orchestrators: () => orchestrators,
    isWorking: (key) => {
      const fromSource = lanesSource ? lanesSource.openRuns().some((r) => r.lane === key) : false
      const fromRuns = runs && typeof runs.isRunning === 'function' ? runs.isRunning(key) : false
      return fromSource || fromRuns
    },
    notify: (event) => {
      for (const client of clients) writeSseChange(client, event)
    },
    sendJson,
    readJsonBody,
    env,
  })
  const teamsApi = createTeamsApi({
    projectRoot,
    runsFolder: bridgeRunsFolder,
    lanes: () => (lanesSourceOn ? lanesConfig : readLanes()),
    activeLanes: () => activeLanes,
    orchestrators: () => orchestrators,
    lanesSource: () => lanesSource,
    runs: () => runs,
    sendJson,
    readJsonBody,
    notify: (event) => {
      for (const client of clients) writeSseChange(client, event)
    },
  })
  const agentDepthApi = createAgentDepthApi({
    runsFolder: bridgeRunsFolder,
    sendJson,
    readJsonBody,
    notify: (event) => {
      for (const client of clients) writeSseChange(client, event)
    },
  })
  const gitApi = createGitApi({
    projectRoot,
    sendJson,
    readJsonBody,
    orchestrators: options.orchestrators ?? (() => orchestrators),
    lanesSource: options.lanesSourceApi ?? (() => lanesSource),
    notify: (event) => {
      for (const client of clients) writeSseChange(client, event)
    },
    gitRunner: options.gitRunner,
    ttlMs: options.gitTtlMs,
  })
  const filesApi = createFilesApi({ projectRoot, sendJson })
  const networkApi = createNetworkApi({
    sendJson,
    connector: options.networkConnector,
    now: options.networkNow ?? options.now,
    intervalMs: options.networkIntervalMs,
    activeMs: options.networkActiveMs,
    timeoutMs: options.networkTimeoutMs,
    onNotice: (event) => {
      for (const client of clients) writeSseChange(client, event)
    },
  })
  const treeClientVersion = new WeakMap()
  const folderClients = new WeakSet()
  const treeClients = new WeakSet()
  const sseWriter = createSseWriter({
    onDrop: (res) => {
      clients.delete(res)
      treeClients.delete(res)
      folderClients.delete(res)
    },
  })
  const history = []
  let nextId = 0
  let stopped = false
  let watcher = null
  let pollTimer = null
  let pendingNames = new Set()
  let pendingAllNamed = true
  let pendingOverflow = false
  let partialStreak = 0
  let lastFiles = []
  let lastTree = null
  let lastTreeAt = 0
  let lastTreeError = ''
  let treeChangedAt = 0
  let lastReadMs = 0
  let lastReadEndAt = 0
  let lastReadChanged = false
  let watchFallback = false
  let treeNotGit = false
  let treePrimed = false
  const treeStart = randomBytes(8).toString('hex')
  let treeVersion = 0
  const treeVersions = new Map()
  let treeReading = null
  let treeDirty = false
  let quietReadTimer = null
  let quietFullDue = false
  let folderAnswer = null
  let folderBuild = null
  const unreadable = createUnreadableCounter()
  const unparsedSince = new Date().toISOString()
  const masker = createSplitMasker()
  let maskTimer = null
  let parserByAgentId = new Map()

  function writeSseFrame(res, entry, options) {
    sseWriter.write(res, `id: ${entry.id}\nevent: frame\ndata: ${entry.data}\n\n`, options)
  }

  function writeSseChange(res, event) {
    sseWriter.write(res, `event: change\ndata: ${JSON.stringify(event)}\n\n`)
  }

  function notifyHeard(event) {
    if (event?.topic === 'endpoints' || event?.topic === 'mcp') return
    for (const client of clients) writeSseChange(client, event)
  }

  function rememberTreeVersion(added, removed) {
    treeVersion += 1
    treeVersions.set(treeVersion, { added, removed })
    while (treeVersions.size > TREE_VERSIONS_KEPT) {
      treeVersions.delete(treeVersions.keys().next().value)
    }
    folderAnswer = null
  }

  function treeFilesSince(sinceVersion) {
    if (sinceVersion === treeVersion) return { added: [], removed: [] }
    if (sinceVersion > treeVersion || sinceVersion < 1) return null
    if (treeVersions.size > 0) {
      const oldest = treeVersions.keys().next().value
      if (sinceVersion < oldest - 1) return null
    }
    const last = new Map()
    for (const [version, change] of treeVersions) {
      if (version <= sinceVersion) continue
      for (const file of change.added) last.set(file, 'add')
      for (const file of change.removed) last.set(file, 'remove')
    }
    const added = []
    const removed = []
    for (const [file, kind] of last) {
      if (kind === 'add') added.push(file)
      else removed.push(file)
    }
    return { added, removed }
  }

  function folderAnswerFor(tree) {
    const version = treeVersion
    if (folderAnswer && folderAnswer.version === version) return Promise.resolve(folderAnswer)
    if (folderBuild && folderBuild.version === version) return folderBuild.promise
    const build = (async () => {
      const body = { ...packFolderTree(tree), created: tree.created, version, start: treeStart }
      const payload = Buffer.from(JSON.stringify(body), 'utf8')
      const gzipped = await gzipAsync(payload)
      const answer = { version, body, payload, gzipped }
      if (!stopped && answer.version === treeVersion) folderAnswer = answer
      return answer
    })()
    const entry = { version, promise: build }
    folderBuild = entry
    const clear = () => {
      if (folderBuild === entry) folderBuild = null
    }
    build.then(clear, clear)
    return build
  }

  function writeWholeTree(client, tree) {
    sseWriter.write(client, treeEvent(tree, null, folderClients.has(client) ? FOLDER_SHAPE : null, treeVersion, treeStart))
    treeClientVersion.set(client, treeVersion)
  }

  function publishTree(current) {
    if (stopped) return false
    lastTree = current
    lastTreeAt = Date.now()
    if (!treePrimed) {
      treePrimed = true
      treeVersion = 1
      treeChangedAt = lastTreeAt
      lastFiles = current.files
      for (const client of clients) {
        if (treeClients.has(client)) writeWholeTree(client, current)
      }
      return false
    }
    const changes = pathChanges(lastFiles, current.files)
    const changed = changes.added.length > 0 || changes.removed.length > 0 || current.files.length !== lastFiles.length
    if (!changed) return false
    treeChangedAt = lastTreeAt
    lastFiles = current.files
    rememberTreeVersion(changes.added, changes.removed)
    for (const client of clients) {
      if (!treeClients.has(client)) continue
      const known = treeClientVersion.get(client)
      const changesSince = known === undefined ? null : treeFilesSince(known)
      if (changesSince === null) {
        writeWholeTree(client, current)
        continue
      }
      treeClientVersion.set(client, treeVersion)
      if (changesSince.added.length > 0 || changesSince.removed.length > 0) {
        sseWriter.write(client, treeDeltaEvent(current.root, changesSince.added, changesSince.removed, treeVersion, treeStart))
      }
    }
    return true
  }

  async function readWholeTree() {
    let tree
    try {
      if (treeNotGit) {
        tree = walkTree(projectRoot)
      } else {
        tree = await treeReader(projectRoot)
        if (tree?.[PLAIN_TREE]) treeNotGit = true
      }
      lastTreeError = ''
    } catch (error) {
      lastTreeError = error instanceof Error ? error.message : String(error)
      tree = { root: '', files: [], created: [] }
    }
    if (!tree || !Array.isArray(tree.files)) {
      if (!lastTreeError) lastTreeError = 'The tree read returned no file list.'
      tree = { root: '', files: [], created: [] }
    }
    return tree
  }

  function clearQuietRead() {
    if (quietReadTimer) {
      clearTimeout(quietReadTimer)
      quietReadTimer = null
    }
  }

  function scheduleQuietRead() {
    if (stopped || watchFallback) return
    clearQuietRead()
    quietReadTimer = setTimeout(() => {
      quietReadTimer = null
      if (stopped || watchFallback) return
      quietFullDue = true
      if (!treeReading) startTreeRead().catch(() => {})
    }, quietFullMs)
  }

  function startTreeRead() {
    if (stopped) return Promise.resolve(null)
    if (treeReading) return treeReading
    clearQuietRead()
    let changed = false
    let usedPartial = false
    const read = (async () => {
      const forceFull = quietFullDue
      quietFullDue = false
      if (pendingNames.size > 0 || !pendingAllNamed) {
        await new Promise((resolveTurn) => setImmediate(resolveTurn))
      }
      const names = [...pendingNames]
      const allNamed = pendingAllNamed && !pendingOverflow
      pendingNames = new Set()
      pendingAllNamed = true
      pendingOverflow = false
      let tree = null
      if (
        !forceFull &&
        !treeNotGit &&
        names.length > 0 &&
        allNamed &&
        names.length <= PARTIAL_NAME_LIMIT &&
        partialStreak < PARTIAL_FULL_EVERY &&
        !watchFallback
      ) {
        let listed = null
        try {
          listed = await partialTreeReader(projectRoot, names)
        } catch {
          listed = null
        }
        if (listed && Array.isArray(listed.files)) tree = mergeNamedFiles(lastTree, names, listed.files)
      }
      if (tree) {
        lastTreeError = ''
        partialStreak += 1
        usedPartial = true
      } else {
        partialStreak = 0
        tree = await readWholeTree()
      }
      if (stopped) return tree
      changed = publishTree(tree)
      return tree
    })()
    treeReading = read
    const began = Date.now()
    const done = () => {
      lastReadMs = Date.now() - began
      lastReadEndAt = Date.now()
      lastReadChanged = changed
      if (treeReading === read) treeReading = null
      if (!treeDirty && watcher && pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      if (treeDirty && watchFallback && !stopped) {
        treeDirty = false
        startTreeRead().catch(() => {})
      }
      if (treeDirty && !pollTimer && !watchFallback) beginPolling(false)
      if (usedPartial) scheduleQuietRead()
      else clearQuietRead()
      if (quietFullDue && !stopped) startTreeRead().catch(() => {})
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

  function adoptInitialTree(tree) {
    if (!tree || !Array.isArray(tree.files)) return false
    const root = typeof tree.root === 'string' && tree.root ? tree.root : basename(resolve(projectRoot))
    publishTree({
      root,
      files: tree.files,
      created: Array.isArray(tree.created) ? tree.created : [],
    })
    return true
  }

  function startWatcher() {
    if (!projectRoot || stopped) {
      treePrimed = true
      return
    }
    if (!adoptInitialTree(options.initialTree)) startTreeRead().catch(() => {})
    if (!armWatcher()) beginPolling(false)
  }

  function noteWatchName(filename) {
    const name = filename ? String(filename).replace(/\\/g, '/') : ''
    if (!name) {
      pendingAllNamed = false
      return
    }
    if (pendingOverflow || pendingNames.has(name)) return
    if (pendingNames.size >= PARTIAL_NAME_LIMIT) {
      pendingOverflow = true
      pendingNames.clear()
      return
    }
    pendingNames.add(name)
  }

  function armWatcher() {
    if (stopped || !projectRoot) return false
    if (watcher) return true
    try {
      if (!statSync(resolve(projectRoot)).isDirectory()) return false
      const current = watchProject(resolve(projectRoot), { recursive: true }, (_eventType, filename) => {
        if (stopped) return
        if (filename && IGNORED_WATCH.test(String(filename))) return
        noteWatchName(filename)
        beginPolling()
      })
      current.on('error', () => {
        if (watcher !== current) return
        try {
          current.close()
        } catch {}
        watcher = null
        watchFallback = true
        clearQuietRead()
        beginPolling(false)
      })
      watcher = current
      watchFallback = false
      return true
    } catch {
      watcher = null
      watchFallback = true
      clearQuietRead()
      return false
    }
  }

  function beginPolling(readNow = true) {
    if (stopped) return
    clearQuietRead()
    if (watcher) {
      try {
        watcher.close()
      } catch {}
      watcher = null
    }
    if (pollTimer) return
    if (readNow) checkTreeChange()
    pollTimer = setInterval(pollTreeChange, pollMs)
  }

  function pollTreeChange() {
    if (stopped) return
    if (treeReading) return
    const at = Date.now()
    if (!watchFallback) {
      const due = treeReadDue({
        now: at,
        lastReadEndAt,
        lastReadMs,
        lastReadChanged,
        lastTreeAt,
        quietMs: WATCH_BURST_QUIET_MS,
        pollMs,
        budgetMs: treeBudgetMs,
      })
      if (!due) return
      if (!lastReadChanged && armWatcher()) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      treeDirty = false
      startTreeRead().catch(() => {})
      return
    }
    if (at - treeChangedAt >= quietMs && armWatcher()) {
      clearInterval(pollTimer)
      pollTimer = null
      startTreeRead().catch(() => {})
      return
    }
    if (at - lastTreeAt < Math.max(pollMs, lastReadMs * POLL_READ_GAP)) return
    checkTreeChange()
  }

  function rememberParsers() {
    const next = new Map()
    if (lanesSource) {
      for (const agent of lanesSource.agents) {
        if (agent.id !== '') next.set(String(agent.id), agent.parser)
      }
    }
    if (sessionsSource) {
      for (const agent of sessionsSource.agents) {
        if (agent.id !== '') next.set(String(agent.id), agent.parser)
      }
    }
    parserByAgentId = next
  }

  function rememberLaneParsers() {
    rememberParsers()
  }

  function rememberSessionsParsers() {
    rememberParsers()
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

  function emit(parsed) {
    nextId += 1
    const seq = nextId
    const id = `${treeStart}:${seq}`
    const data = JSON.stringify(parsed)
    const runId = parsed?.payload?.runId
    const endsRun = parsed?.type === 'heartbeat.run.status' && RUN_END_STATUSES.has(parsed.payload?.status)
    const at = typeof now === 'function' ? now() : Date.now()
    const entry = { id, seq, data, runId, pinned: holdsRunStart(parsed), at }
    history.push(entry)
    if (runId !== undefined && runId !== null && endsRun) {
      for (const item of history) {
        if (item.runId === runId) item.pinned = false
      }
    }
    trimHistory(history, at)
    if (endsRun) gitApi.invalidateCache()
    const notices = changeEvents(parsed)
    if (endsRun) notices.push({ topic: 'git' })
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

  function sendAgentMessage(first, second, third, fourth) {
    let from = ''
    let to = ''
    let kind = ''
    let text = ''
    if (first && typeof first === 'object') {
      from = typeof first.from === 'string' ? first.from.trim() : ''
      to = typeof first.to === 'string' ? first.to.trim() : ''
      kind = first.kind
      text = typeof first.text === 'string' && first.text.trim()
        ? first.text.trim()
        : typeof second === 'string'
          ? second.trim()
          : ''
    } else {
      from = typeof first === 'string' ? first.trim() : ''
      to = typeof second === 'string' ? second.trim() : ''
      kind = third
      text = typeof fourth === 'string' ? fourth.trim() : ''
    }
    if (!from || !to || !AGENT_MESSAGE_KINDS.has(kind)) return
    const ts = new Date().toISOString()
    accept({
      type: 'orchestrator.message',
      companyId: 'company-orchestrator',
      createdAt: ts,
      payload: { from, to, kind, ts },
    })
    orchestrators?.recordAgentMessage?.({ from, to, kind, text })
  }

  const heartbeatTimer = setInterval(() => {
    for (const client of clients) {
      sseWriter.write(client, ': keepalive\n\n')
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
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Last-Event-ID, Content-Type, X-MachineRoom-Orchestrator',
      })
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (await briefs.handle(req, res, url)) return
    if (await harnessModelsApi.handle(req, res, url)) return
    if (await agentsConfig.handle(req, res, url)) return
    if (await endpoints.handle(req, res, url)) return
    if (await modelPins.handle(req, res, url)) return
    if (await mcp.handle(req, res, url)) return
    if (await activeLanes.handle(req, res, url)) return
    if (await runs.handle(req, res, url)) return
    if (await reviews.handle(req, res, url)) return
    if (await policy.handle(req, res, url)) return
    if (await plans.handle(req, res, url)) return
    if (await control.handle(req, res, url)) return
    if (await search.handle(req, res, url)) return
    if (await assistant.handle(req, res, url)) return
    if (await decideApi.handle(req, res, url)) return
    if (await music.handle(req, res, url)) return

    if (orchestrators && (await orchestrators.handle(req, res, url))) return
    if (await projects.handle(req, res, url)) return
    if (await agentDepthApi.handle(req, res, url)) return
    if (await familyApi.handle(req, res, url)) return
    if (await teamsApi.handle(req, res, url)) return
    if (await gitApi.handle(req, res, url)) return
    if (await filesApi.handle(req, res, url)) return
    if (await networkApi.handle(req, res, url)) return

    if (req.method === 'GET' && url.pathname === '/api/health') {
      const problems = []
      const folder = resolve(projectRoot)
      let folderOk = false
      try {
        folderOk = statSync(folder).isDirectory()
      } catch {}
      if (!folderOk) problems.push(`The project folder ${folder} does not exist or is not a folder.`)
      if (options.staticDir) {
        const index = join(resolve(options.staticDir), 'index.html')
        let indexOk = false
        try {
          indexOk = statSync(index).isFile()
        } catch {}
        if (!indexOk) problems.push(`The built viewer is missing ${index}. Run npm run build.`)
      }
      // The page shows ok: false as a dead room, so only a room that cannot work sets it.
      const fatal = problems.length
      if (lastTreeError) problems.push(`The last tree read failed: ${lastTreeError}`)
      if (sessionsSource && typeof sessionsSource.problems === 'function') {
        for (const problem of sessionsSource.problems()) {
          problems.push(`The ${problem.name} source stopped: ${problem.message}`)
        }
      }
      sendJson(req, res, 200, {
        ok: fatal === 0,
        problems,
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
      const allLaneAgents = lanesSource ? [...lanesSource.agents] : []
      const visibleLaneAgents = allLaneAgents.filter(
        (agent) =>
          agent.key === 'orchestrator' ||
          String(agent.key ?? '').startsWith('sub-') ||
          !activeLanes.isLaneHidden(agent.key)
      )
      const laneAgents = activeLanes.isChosen()
        ? visibleLaneAgents.filter(
            (agent) => agent.key === 'orchestrator' || String(agent.key ?? '').startsWith('sub-') || activeLanes.isLaneActive(agent.key)
          )
        : visibleLaneAgents
      const sessionAgents = sessionsSource ? [...sessionsSource.agents] : []
      sendJson(req, res, 200, [...laneAgents, ...sessionAgents])
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/tree') {
      const wantsFolders = String(req.headers.accept ?? '').includes(`shape=${FOLDER_SHAPE}`)
      let tree
      if (wantsFolders) {
        tree = lastTree ?? (await startTreeRead())
      } else {
        const recent = lastTree && Date.now() - lastTreeAt <= TREE_REUSE_MS
        tree = recent ? lastTree : await startTreeRead()
      }
      if (stopped || !tree) {
        res.destroy()
        return
      }
      if (!wantsFolders) {
        sendJson(req, res, 200, { ...tree, start: treeStart })
        return
      }
      const answer = await folderAnswerFor(tree)
      if (stopped) {
        res.destroy()
        return
      }
      const wantsGzip = /(^|,)\s*gzip\b/i.test(String(req.headers['accept-encoding'] ?? ''))
      if (!wantsGzip) {
        res.writeHead(200, {
          ...corsHeaders(req, isAllowed),
          'Content-Type': 'application/json; charset=utf-8',
          Vary: 'Origin',
          'Content-Length': answer.payload.length,
        })
        res.end(answer.payload)
        return
      }
      res.writeHead(200, {
        ...corsHeaders(req, isAllowed),
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Encoding': 'gzip',
        Vary: 'Origin, Accept-Encoding',
        'Content-Length': answer.gzipped.length,
      })
      res.end(answer.gzipped)
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

      const lastEventId =
        req.headers['last-event-id'] !== undefined
          ? String(req.headers['last-event-id']).trim()
          : String(url.searchParams.get('after') ?? '').trim()
      const wantsHistory = url.searchParams.get('history') === '1'
      if (lastEventId) {
        if (eventResetNeeded(history, lastEventId, treeStart, nextId)) {
          sseWriter.write(res, `event: reset\ndata: ${JSON.stringify({ start: treeStart })}\n\n`, { connect: true })
          for (const entry of history) writeSseFrame(res, entry, { connect: true })
        } else {
          const seq = readEventCursor(lastEventId, treeStart)
          for (const entry of history) {
            if (entry.seq > seq) writeSseFrame(res, entry, { connect: true })
          }
        }
      } else if (wantsHistory) {
        for (const entry of history) {
          writeSseFrame(res, entry, { connect: true })
        }
      }

      if (sseWriter.isDropped(res)) return

      clients.add(res)
      if (url.searchParams.has('tree')) {
        treeClients.add(res)
        if (url.searchParams.get('tree') === FOLDER_SHAPE) folderClients.add(res)
        const sinceText = url.searchParams.get('since')
        if (sinceText !== null) {
          const sinceVersion = treeSinceVersion(sinceText, treeStart)
          if (sinceVersion !== null) {
            const changes = treeFilesSince(sinceVersion)
            if (changes !== null) {
              treeClientVersion.set(res, treeVersion)
              if ((changes.added.length > 0 || changes.removed.length > 0) && lastTree) {
                sseWriter.write(res, treeDeltaEvent(lastTree.root, changes.added, changes.removed, treeVersion, treeStart), { connect: true })
              }
            } else if (lastTree) {
              sseWriter.write(res, treeEvent(lastTree, null, folderClients.has(res) ? FOLDER_SHAPE : null, treeVersion, treeStart), { connect: true })
              treeClientVersion.set(res, treeVersion)
            }
          } else if (lastTree) {
            sseWriter.write(res, treeEvent(lastTree, null, folderClients.has(res) ? FOLDER_SHAPE : null, treeVersion, treeStart), { connect: true })
            treeClientVersion.set(res, treeVersion)
          }
        }
      }
      req.on('close', () => {
        clients.delete(res)
        treeClients.delete(res)
        folderClients.delete(res)
      })
      sseWriter.allowBacklog(res)
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
    try {
      moveRemovedLanesToProject({ projectRoot, runsFolder: bridgeRunsFolder })
    } catch (error) {
      console.log(`Could not move the old removed lanes: ${error?.message ?? error}`)
    }
    rememberLaneParsers()
    rememberSessionsParsers()
    lanesSource?.start()
    sessionsSource?.start()
    startWatcher()
    projects.recordCurrent()
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
    networkApi.stop()
    lanesSource?.stop()
    sessionsSource?.stop()
    clearInterval(heartbeatTimer)
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    clearQuietRead()
    quietFullDue = false
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
