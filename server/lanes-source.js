import { execFileSync } from 'node:child_process'
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, rmSync, renameSync, statSync, watch } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { isHolderAlive } from '../scripts/lane-lock.mjs'
import { agentsFile, createRunLineReader, failureText } from '../src/briefs/recording.js'
import { laneLockPids } from '../src/briefs/run.js'
import { activeLanesFileFor, readActiveLanesChoice } from './active-lanes.js'
import { readAllLanes } from './agents-config.js'
import { listProcesses } from './processTree.js'
import { gitPath } from './programPath.js'

export { readAllLanes }

const DEFAULT_QUIET_MS = 10 * 60 * 1000
const DEFAULT_POLL_MS = 200
const DEFAULT_PRIME_MS = 60 * 1000
const DEFAULT_SCAN_MS = 2000
const DEFAULT_FULL_LIST_MS = 60 * 1000
const DEFAULT_LAGGING_DROP_MS = 60 * 60 * 1000
const READ_CHUNK = 64 * 1024
const MAX_PARTIAL = 8 * 1024 * 1024
const QUIET_KEPT = 50
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')

export function lanesFolder(env = process.env) {
  const given = env.MACHINEROOM_LANES_DIR
  return given ? resolve(given) : join(REPO_ROOT, 'config')
}

function tempFolder(env) {
  return env.TEMP || tmpdir()
}

function defaultRunsFolder(env, platform) {
  const local = typeof env.LOCALAPPDATA === 'string' ? env.LOCALAPPDATA.trim() : ''
  if (platform === 'win32' && local) return join(resolve(local), 'MachineRoom', 'runs')
  if (platform !== 'win32') {
    const state = typeof env.XDG_STATE_HOME === 'string' ? env.XDG_STATE_HOME.trim() : ''
    if (state) return join(resolve(state), 'machineroom', 'runs')
    const home = typeof env.HOME === 'string' ? env.HOME.trim() : ''
    if (home) return join(resolve(home), '.local', 'state', 'machineroom', 'runs')
  }
  return join(tempFolder(env), 'machineroom-runs')
}

function oldRunsLabel() {
  return '%TEMP%\\machineroom-runs'
}

function newRunsLabel(env, platform) {
  if (platform === 'win32') return '%LOCALAPPDATA%\\MachineRoom\\runs'
  const state = typeof env.XDG_STATE_HOME === 'string' ? env.XDG_STATE_HOME.trim() : ''
  if (state) return '$XDG_STATE_HOME/machineroom/runs'
  return '~/.local/state/machineroom/runs'
}

export function migrateRunsFolder(env = process.env, platform = process.platform, print = console.log) {
  if (env.MACHINEROOM_RUNS) return null
  const folder = defaultRunsFolder(env, platform)
  const old = join(tempFolder(env), 'machineroom-runs')
  if (resolve(folder) === resolve(old) || existsSync(folder) || !existsSync(old)) return null
  const staging = `${folder}.moving-${process.pid}`
  try {
    mkdirSync(dirname(folder), { recursive: true })
    rmSync(staging, { recursive: true, force: true })
    cpSync(old, staging, { recursive: true })
    if (existsSync(folder)) {
      rmSync(staging, { recursive: true, force: true })
      return null
    }
    renameSync(staging, folder)
  } catch {
    try {
      rmSync(staging, { recursive: true, force: true })
    } catch {}
    return null
  }
  print(`Moved the runs folder from ${oldRunsLabel()} to ${newRunsLabel(env, platform)}.`)
  return { from: old, to: folder }
}

export function runsFolder(env = process.env, platform = process.platform) {
  const given = env.MACHINEROOM_RUNS
  if (given) return resolve(given)
  const folder = defaultRunsFolder(env, platform)
  migrateRunsFolder(env, platform)
  return folder
}

export function readLanes(folder = lanesFolder()) {
  try {
    return JSON.parse(readFileSync(join(folder, 'lanes.json'), 'utf8'))
  } catch {
    return {}
  }
}

export function laneAgents(lanes) {
  const agents = []
  for (const [lane, entry] of Object.entries(lanes ?? {})) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    if (entry.retired === true) continue
    if (!entry.cli || typeof entry.cli !== 'object') continue
    try {
      const file = agentsFile(lane, lanes)
      const agent = file.agents[0]
      if (agent) {
        const harness = entry.cli.harness
        const model = entry.cli.model
        agents.push({
          ...agent,
          key: lane,
          role: null,
          harness: typeof harness === 'string' && harness ? harness : agent.parser,
          model: typeof model === 'string' && model ? model : null,
        })
      }
    } catch {}
  }
  return agents
}

function subModel(sub, harness, lanes) {
  const own = typeof sub?.model === 'string' ? sub.model.trim() : ''
  if (own) return own
  for (const entry of [lanes?.orchestrator, ...Object.values(lanes ?? {})]) {
    if (!entry || typeof entry !== 'object' || entry.retired === true) continue
    if (!entry.cli || entry.cli.harness !== harness) continue
    const model = typeof entry.cli.model === 'string' ? entry.cli.model.trim() : ''
    if (model) return model
  }
  return null
}

export function subOrchestratorAgent(sub, lanes = {}) {
  const id = typeof sub?.id === 'string' ? sub.id.trim() : ''
  if (!id) return null
  const key = `sub-${id}`
  const name = typeof sub?.name === 'string' && sub.name.trim() ? sub.name.trim() : id
  const harness = String(sub?.harness ?? '') === 'opencode' ? 'opencode' : 'claude'
  const model = subModel(sub, harness, lanes)
  try {
    const agent = agentsFile(key, { [key]: { name, cli: { harness } } }).agents[0]
    if (agent) return { ...agent, key, role: null, harness, model, subOrchestrator: true }
  } catch {}
  return { id: `agent-${key}`, key, name, adapterType: null, parser: harness, role: null, harness, model, subOrchestrator: true }
}

function pathKey(path) {
  try {
    const resolved = resolve(String(path ?? ''))
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  } catch {
    return ''
  }
}

export function mainCheckoutOf(folder) {
  try {
    const common = execFileSync(gitPath(), ['rev-parse', '--git-common-dir'], {
      cwd: folder,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!common) return ''
    return dirname(resolve(folder, common))
  } catch {
    return ''
  }
}

function onceList(list) {
  let loaded = false
  let cached = null
  return (options) => {
    if (!loaded) {
      loaded = true
      cached = list(options)
    }
    return cached
  }
}

function checkLaneLock(folder, lane, options) {
  if (!folder || !lane) return false
  const path = join(folder, `${lane}.lock`)
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return false
  }
  const holder = laneLockPids(text)
  return isHolderAlive(holder.pid, path, options) || isHolderAlive(holder.child, path, options)
}

export function laneLockAlive(folder, lane, { platform = process.platform, list = listProcesses, stat = statSync } = {}) {
  return checkLaneLock(folder, lane, { platform, list: onceList(list), stat })
}

export function createLaneLockCheck({ platform = process.platform, list = listProcesses, stat = statSync } = {}) {
  const options = { platform, list: onceList(list), stat }
  return (folder, lane) => checkLaneLock(folder, lane, options)
}

export function createRecordsCache(file, folder = dirname(file)) {
  let size = -1
  let mtimeMs = -1
  let tail = ''
  let decoder = new StringDecoder('utf8')
  let records = new Map()
  let reads = 0

  function restart() {
    records = new Map()
    tail = ''
    decoder = new StringDecoder('utf8')
  }

  function apply(text) {
    const parts = (tail + text).split(/\r?\n/)
    tail = parts.pop() ?? ''
    for (const line of parts) {
      if (!line.trim()) continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (record && typeof record.log === 'string') {
        const fullLog = isAbsolute(record.log) ? record.log : resolve(folder, record.log)
        records.set(pathKey(fullLog), record)
      }
    }
  }

  function read() {
    let stat
    try {
      stat = statSync(file)
    } catch {
      restart()
      size = -1
      mtimeMs = -1
      return records
    }
    if (stat.size === size && stat.mtimeMs === mtimeMs) return records
    reads += 1
    if (size < 0 || stat.size <= size) {
      restart()
      try {
        apply(readFileSync(file, 'utf8'))
      } catch {
        return records
      }
      size = stat.size
      mtimeMs = stat.mtimeMs
      return records
    }
    let fd
    try {
      fd = openSync(file, 'r')
    } catch {
      return records
    }
    let got = 0
    try {
      const length = stat.size - size
      const buffer = Buffer.alloc(length)
      got = readSync(fd, buffer, 0, length, size)
      apply(decoder.write(buffer.subarray(0, got)))
    } catch {
      return records
    } finally {
      closeSync(fd)
    }
    size += got
    mtimeMs = stat.mtimeMs
    return records
  }

  return {
    read,
    get reads() {
      return reads
    },
  }
}

function startedByOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const harness = typeof value.harness === 'string' ? value.harness.trim() : ''
  const session = typeof value.session === 'string' ? value.session.trim() : ''
  return harness && session ? { harness, session } : null
}

function metaFor(logPath) {
  try {
    const meta = JSON.parse(readFileSync(String(logPath).replace(/\.log$/i, '.meta.json'), 'utf8'))
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
    const project = typeof meta.project === 'string' ? meta.project.trim() : ''
    const startedBy = startedByOf(meta.startedBy)
    if (!project && !startedBy) return null
    return { ...meta, project, ...(startedBy ? { startedBy } : {}) }
  } catch {
    return null
  }
}

function iso(ms) {
  const value = Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? ms : Date.now()
  return new Date(value).toISOString()
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function rewriter(worktree, roomRoot) {
  const from = String(worktree ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const to = String(roomRoot ?? '').replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return (line) => line
  const pattern = new RegExp(from.split('/').map(escapeRegExp).join('[\\\\/]+'), 'gi')
  return (line) => line.replace(pattern, to)
}

function laneOf(name, lanes) {
  const keys = Object.keys(lanes ?? {}).sort((a, b) => b.length - a.length)
  return keys.find((key) => name.startsWith(`${key}-`)) ?? null
}

function subOf(name) {
  const match = /^(sub-[a-z0-9-]{1,24})-chat-\d{8}-/.exec(name)
  return match ? match[1] : null
}

export function createLanesSource(options = {}) {
  const folder = resolve(options.folder ?? runsFolder())
  const recordsFile = resolve(options.recordsFile ?? join(folder, 'runs.jsonl'))
  const repoRoot = resolve(options.repoRoot ?? REPO_ROOT)
  const roomRoot = options.projectRoot ? resolve(options.projectRoot) : ''
  const readAllLanesFn = typeof options.readAllLanes === 'function' ? options.readAllLanes : readAllLanes
  let lanesCache = null
  let agentsCache = null
  function laneFileStamp(file) {
    try {
      const stat = statSync(file)
      return `${stat.size}:${stat.mtimeMs}`
    } catch {
      return '-'
    }
  }
  function currentLanes() {
    if (typeof options.lanes === 'function') return options.lanes()
    if (options.lanes) return options.lanes
    const stamp = `${laneFileStamp(join(lanesFolder(), 'lanes.json'))}|${laneFileStamp(join(folder, 'agents.json'))}`
    if (lanesCache && lanesCache.stamp === stamp) return lanesCache.lanes
    const lanes = readAllLanesFn({ folder: repoRoot, runsFolder: folder })
    lanesCache = { stamp, lanes }
    return lanes
  }
  const subOrchestrators = typeof options.subOrchestrators === 'function' ? options.subOrchestrators : () => []
  const worktreeRoots = new Set([pathKey(repoRoot)])
  const mainCheckout = mainCheckoutOf(repoRoot)
  if (mainCheckout) worktreeRoots.add(pathKey(mainCheckout))
  const worktreeRunsShown = !roomRoot || worktreeRoots.has(pathKey(roomRoot))
  const roomCheckout = roomRoot ? mainCheckoutOf(roomRoot) : ''
  const sameRepo = new Map()
  const quietMs = Number(options.quietMs ?? DEFAULT_QUIET_MS)
  const pollMs = Number(options.pollMs ?? DEFAULT_POLL_MS)
  const scanMs = Number(options.scanMs ?? DEFAULT_SCAN_MS)
  const fullListMs = Number(options.fullListMs ?? DEFAULT_FULL_LIST_MS)
  const laggingDropMs = Number(options.laggingDropMs ?? DEFAULT_LAGGING_DROP_MS)
  const primeMs = Number(options.primeMs ?? DEFAULT_PRIME_MS)
  const laggingPollMs = Number(options.laggingPollMs ?? 10000)
  const now = options.now ?? Date.now
  const onFrame = options.onFrame ?? (() => {})
  const listFolder = typeof options.listFolder === 'function' ? options.listFolder : (dir) => readdirSync(dir, { withFileTypes: true })
  const watchFolder = typeof options.watchFolder === 'function' ? options.watchFolder : watch
  const statFile = typeof options.statFile === 'function' ? options.statFile : statSync
  const statFolder = typeof options.statFolder === 'function' ? options.statFolder : statSync
  const lockPlatform = options.platform ?? process.platform
  const listRunningProcesses = typeof options.list === 'function' ? options.list : listProcesses
  const statLock = typeof options.stat === 'function' ? options.stat : statSync
  const active = new Map()
  const quiet = new Map()
  const seen = new Set()
  const lagging = new Map()
  const dropped = new Map()
  const pendingChecks = new Set()
  const recordsCache = createRecordsCache(recordsFile)
  let watcher = null
  let timer = null
  let scanTimer = null
  let lastScanAt = 0
  let lastListAt = 0
  let lastFolderStamp = null
  let hasListed = false
  let scanWanted = false
  let listWanted = false
  let stopped = false
  let ticking = false
  let primed = false

  function emit(frame) {
    try {
      onFrame(frame)
    } catch {}
  }

  function allAgents() {
    const lanes = currentLanes()
    let subs = []
    try {
      subs = subOrchestrators() ?? []
    } catch {
      subs = []
    }
    const list = Array.isArray(subs) ? subs : []
    const key = list.map((sub) => `${sub?.id ?? ''}:${sub?.name ?? ''}:${sub?.harness ?? ''}:${sub?.model ?? ''}`).join('|')
    if (agentsCache && agentsCache.lanes === lanes && agentsCache.key === key) return agentsCache.agents
    const agents = laneAgents(lanes)
    for (const sub of list) {
      const agent = subOrchestratorAgent(sub, lanes)
      if (agent && !agents.some((item) => item.key === agent.key)) agents.push(agent)
    }
    agentsCache = { lanes, key, agents }
    return agents
  }

  function agentsNow() {
    const list = allAgents()
    const choiceFile = activeLanesFileFor(roomRoot, folder)
    if (readActiveLanesChoice(choiceFile) === null) {
      const running = new Set([...active.values()].map((run) => run.agent.key))
      return list.filter((agent) => agent.key === 'orchestrator' || String(agent.key ?? '').startsWith('sub-') || running.has(agent.key))
    }
    return list
  }

  function agentFor(name, map) {
    const sub = subOf(name)
    if (sub) return map.get(sub) ?? null
    const lane = laneOf(name, currentLanes())
    return lane ? map.get(lane) ?? null : null
  }

  function inRoomRepo(project) {
    if (!roomCheckout) return false
    const key = pathKey(project)
    if (!sameRepo.has(key)) sameRepo.set(key, pathKey(mainCheckoutOf(project) || '') === pathKey(roomCheckout))
    return sameRepo.get(key)
  }

  function beginRun(name, path, agent, keepPaths = false, project = '', startedBy = null) {
    const startedAt = now()
    const run = {
      name,
      path,
      key: pathKey(path),
      agent,
      project,
      startedBy,
      base: { runId: `run-${name}`, agentId: agent.id, issueId: `issue-${name}`, ...(startedBy ? { startedBy } : {}) },
      companyId: `company-${name}`,
      seq: 0,
      offset: 0,
      buffer: '',
      decoder: new StringDecoder('utf8'),
      skipLine: false,
      feed: createRunLineReader(agent.parser),
      rewrite: keepPaths ? (line) => line : rewriter(project || currentLanes()[agent.key]?.worktree, roomRoot),
      readLines: 0,
      plainLines: [],
      startedAt,
      lastGrowth: startedAt,
    }
    active.set(run.key, run)
    emit({ type: 'heartbeat.run.queued', companyId: run.companyId, createdAt: iso(startedAt), payload: { ...run.base } })
    emit({
      type: 'heartbeat.run.status',
      companyId: run.companyId,
      createdAt: iso(startedAt),
      payload: { ...run.base, status: 'running', error: null, errorCode: null, startedAt: iso(startedAt), finishedAt: null },
    })
    readNew(run)
  }

  function runsFolderStamp() {
    try {
      const stat = statFolder(folder, { bigint: true })
      return String(stat.mtimeNs ?? stat.mtimeMs)
    } catch {
      return null
    }
  }

  function adoptLog(name, path, getAgentMap) {
    const key = pathKey(path)
    if (seen.has(key)) return
    const agent = agentFor(name, getAgentMap())
    if (!agent) {
      seen.add(key)
      return
    }
    const meta = metaFor(path)
    const metaProject = meta?.project ?? ''
    const ownProject = metaProject !== '' && pathKey(metaProject) === pathKey(roomRoot)
    if (metaProject !== '' && !ownProject && !inRoomRepo(metaProject)) {
      seen.add(key)
      return
    }
    if (metaProject === '' && !worktreeRunsShown) {
      seen.add(key)
      return
    }
    seen.add(key)
    beginRun(name.slice(0, -4), path, agent, Boolean(ownProject), metaProject, meta?.startedBy ?? null)
  }

  function scan() {
    const current = now()
    const stamp = runsFolderStamp()
    if (hasListed && !listWanted && stamp !== null && stamp === lastFolderStamp && current - lastListAt < fullListMs) return
    let entries
    try {
      entries = listFolder(folder)
    } catch {
      return
    }
    listWanted = false
    lastFolderStamp = stamp
    lastListAt = current
    hasListed = true
    const present = new Set()
    let agentMap = null
    const getAgentMap = () => (agentMap ??= new Map(allAgents().map((agent) => [agent.key, agent])))
    let records = null
    const getRecords = () => (records ??= recordsCache.read())
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.log')) continue
      const path = join(folder, entry.name)
      const key = pathKey(path)
      present.add(key)
      if (lagging.has(key)) continue
      if (dropped.has(key)) {
        const info = dropped.get(key)
        let size
        try {
          size = statFile(path).size
        } catch {
          dropped.delete(key)
          continue
        }
        if (size <= info.size) continue
        dropped.delete(key)
      } else {
        if (seen.has(key)) continue
        if (!primed) {
          try {
            const stat = statSync(path)
            if (current - stat.mtimeMs > primeMs) {
              if (current - stat.mtimeMs >= laggingDropMs && getRecords().has(key)) {
                dropped.set(key, { size: stat.size })
              } else {
                lagging.set(key, {
                  name: entry.name,
                  path,
                  size: stat.size,
                  lastGrowth: stat.mtimeMs,
                  checkedAt: current,
                })
              }
              continue
            }
          } catch {
            continue
          }
        }
      }
      adoptLog(entry.name, path, getAgentMap)
    }
    for (const key of dropped.keys()) {
      if (!present.has(key)) dropped.delete(key)
    }
    for (const key of lagging.keys()) {
      if (!present.has(key)) lagging.delete(key)
    }
  }

  function checkLagging() {
    if (lagging.size === 0) return
    const current = now()
    let agentMap = null
    const getAgentMap = () => (agentMap ??= new Map(allAgents().map((agent) => [agent.key, agent])))
    let records = null
    const getRecords = () => (records ??= recordsCache.read())
    for (const [key, info] of [...lagging.entries()]) {
      const isNamed = pendingChecks.has(key)
      const isTime = current - info.checkedAt >= laggingPollMs
      if (!isNamed && !isTime) continue
      pendingChecks.delete(key)
      info.checkedAt = current
      let size
      try {
        size = statFile(info.path).size
      } catch {
        lagging.delete(key)
        continue
      }
      if (size > info.size) {
        lagging.delete(key)
        adoptLog(info.name, info.path, getAgentMap)
        continue
      }
      if (current - info.lastGrowth >= laggingDropMs && getRecords().has(key)) {
        lagging.delete(key)
        dropped.set(key, { size })
      }
    }
  }

  function reset(run) {
    run.offset = 0
    run.buffer = ''
    run.skipLine = false
    run.decoder = new StringDecoder('utf8')
    run.feed = createRunLineReader(run.agent.parser)
    run.readLines = 0
    run.plainLines = []
  }

  function readNew(run) {
    let size
    try {
      size = statSync(run.path).size
    } catch {
      return
    }
    if (size < run.offset) reset(run)
    if (size === run.offset) return
    let fd
    try {
      fd = openSync(run.path, 'r')
    } catch {
      return
    }
    try {
      const buffer = Buffer.alloc(READ_CHUNK)
      while (run.offset < size) {
        const wanted = Math.min(READ_CHUNK, size - run.offset)
        const read = readSync(fd, buffer, 0, wanted, run.offset)
        if (read <= 0) break
        run.offset += read
        run.buffer += run.decoder.write(buffer.subarray(0, read))
        if (run.buffer.length > MAX_PARTIAL) emitLines(run)
      }
    } finally {
      closeSync(fd)
    }
    run.lastGrowth = now()
    emitLines(run)
  }

  function emitLines(run, final = false) {
    if (run.skipLine) {
      const cut = run.buffer.indexOf('\n')
      if (cut === -1) {
        run.buffer = ''
        return
      }
      run.buffer = run.buffer.slice(cut + 1)
      run.skipLine = false
    }
    const parts = run.buffer.split(/\r?\n/)
    run.buffer = final ? '' : parts.pop() ?? ''
    for (const line of parts) {
      if (!line.trim()) continue
      const entry = run.feed(run.rewrite(line))
      if (!entry || entry.read !== true) {
        // A plain line can be megabytes long, and only its start helps the error text.
        run.plainLines.push(line.slice(0, 500))
        if (run.plainLines.length > 20) run.plainLines.shift()
        continue
      }
      run.readLines += 1
      run.seq += 1
      const at = Number.isFinite(entry.at) ? entry.at : now()
      emit({
        type: 'heartbeat.run.log',
        companyId: run.companyId,
        createdAt: iso(now()),
        payload: {
          ...run.base,
          ts: iso(at),
          seq: run.seq,
          stream: 'stdout',
          chunk: entry.chunk,
          truncated: false,
        },
      })
    }
    if (run.buffer.length > MAX_PARTIAL) {
      run.buffer = ''
      run.skipLine = true
    }
  }

  function flushRun(run) {
    run.buffer += run.decoder.end()
    emitLines(run, true)
    run.decoder = new StringDecoder('utf8')
  }

  function finish(run, status, error, { reopen = false } = {}) {
    if (!active.has(run.key)) return
    flushRun(run)
    active.delete(run.key)
    const at = now()
    if (status === 'failed' && run.readLines === 0 && run.plainLines.length > 0) {
      run.seq += 1
      emit({
        type: 'heartbeat.run.event',
        companyId: run.companyId,
        createdAt: iso(at),
        payload: {
          ...run.base,
          seq: run.seq,
          level: 'error',
          message: run.plainLines.join('\n'),
        },
      })
    }
    emit({
      type: 'heartbeat.run.status',
      companyId: run.companyId,
      createdAt: iso(at),
      payload: {
        ...run.base,
        status,
        error,
        errorCode: null,
        startedAt: iso(run.startedAt),
        finishedAt: iso(at),
      },
    })
    if (reopen) {
      quiet.set(run.key, run)
      while (quiet.size > QUIET_KEPT) quiet.delete(quiet.keys().next().value)
    }
  }

  function reopenRun(run) {
    quiet.delete(run.key)
    active.set(run.key, run)
    run.lastGrowth = now()
    emit({
      type: 'heartbeat.run.status',
      companyId: run.companyId,
      createdAt: iso(run.lastGrowth),
      payload: {
        ...run.base,
        status: 'running',
        error: null,
        errorCode: null,
        startedAt: iso(run.startedAt),
        finishedAt: null,
      },
    })
    readNew(run)
  }

  function finishRecord(run, record) {
    const ok = record.exitCode === 0 && record.killed !== true
    finish(run, ok ? 'succeeded' : 'failed', ok ? null : failureText(record))
  }

  function scanDue() {
    if (scanWanted) return true
    if (lastScanAt === 0) return true
    return now() - lastScanAt >= scanMs
  }

  function checkQuietRun(run) {
    let size
    try {
      size = statFile(run.path).size
    } catch {
      return
    }
    if (size > run.offset) reopenRun(run)
  }

  function tick() {
    if (stopped || ticking) return
    ticking = true
    try {
      const scanning = scanDue()
      if (scanning) {
        scan()
        lastScanAt = now()
        scanWanted = false
      }
      checkLagging()
      for (const run of [...quiet.values()]) {
        const named = pendingChecks.has(run.key)
        if (!scanning && !named) continue
        pendingChecks.delete(run.key)
        checkQuietRun(run)
      }
      pendingChecks.clear()
      if (active.size === 0) return
      const records = recordsCache.read()
      let checkLock = null
      for (const run of [...active.values()]) {
        readNew(run)
        const record = records.get(run.key)
        if (record) {
          finishRecord(run, record)
          continue
        }
        if (now() - run.lastGrowth >= quietMs) {
          checkLock ??= createLaneLockCheck({ platform: lockPlatform, list: listRunningProcesses, stat: statLock })
          if (!checkLock(folder, run.agent.key)) {
            finish(run, 'failed', 'no record', { reopen: true })
          }
        }
      }
    } finally {
      ticking = false
    }
  }

  function start() {
    if (stopped) return
    try {
      mkdirSync(folder, { recursive: true })
    } catch {}
    scan()
    primed = true
    lastScanAt = now()
    scanWanted = false
    listWanted = false
    try {
      watcher = watchFolder(folder, (eventType, filename) => {
        scanWanted = true
        if (filename) {
          const file = String(filename)
          const key = pathKey(join(folder, file))
          pendingChecks.add(key)
          if (eventType === 'rename' && file.endsWith('.log') && !seen.has(key) && !lagging.has(key) && !dropped.has(key)) {
            listWanted = true
          }
        } else if (eventType === 'rename') {
          listWanted = true
        }
        tick()
      })
      watcher.on('error', () => {
        try {
          watcher?.close()
        } catch {}
        watcher = null
      })
    } catch {
      watcher = null
    }
    scanTimer = setInterval(() => {
      scanWanted = true
      tick()
    }, scanMs)
    timer = setInterval(tick, pollMs)
  }

  function stop() {
    stopped = true
    active.clear()
    quiet.clear()
    lagging.clear()
    dropped.clear()
    seen.clear()
    sameRepo.clear()
    pendingChecks.clear()
    lastFolderStamp = null
    lastListAt = 0
    hasListed = false
    listWanted = false
    if (scanTimer) {
      clearInterval(scanTimer)
      scanTimer = null
    }
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (watcher) {
      try {
        watcher.close()
      } catch {}
      watcher = null
    }
  }

  function openRuns() {
    return [...active.values()].map((run) => ({
      name: run.name,
      lane: run.agent.key,
      startedAt: iso(run.startedAt),
      project: run.project || null,
      ...(run.startedBy ? { startedBy: run.startedBy } : {}),
    }))
  }

  return {
    get agents() {
      return agentsNow()
    },
    openRuns,
    start,
    stop,
    tick,
  }
}
