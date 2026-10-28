import { execFileSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync, watch } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { agentsFile, createRunLineReader, failureText } from '../src/briefs/recording.js'
import { laneLockPids } from '../src/briefs/run.js'
import { readAllLanes } from './agents-config.js'
import { gitPath } from './programPath.js'

export { readAllLanes }

const DEFAULT_QUIET_MS = 10 * 60 * 1000
const DEFAULT_POLL_MS = 200
const DEFAULT_PRIME_MS = 60 * 1000
const READ_CHUNK = 64 * 1024
const MAX_PARTIAL = 1024 * 1024
const QUIET_KEPT = 50
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')

export function runsFolder() {
  return join(process.env.TEMP || tmpdir(), 'machineroom-runs')
}

export function readLanes(folder = REPO_ROOT) {
  try {
    return JSON.parse(readFileSync(join(folder, 'docs', 'agents', 'lanes.json'), 'utf8'))
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

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function laneLockAlive(folder, lane) {
  try {
    return processAlive(laneLockPids(readFileSync(join(folder, `${lane}.lock`), 'utf8')).pid)
  } catch {
    return false
  }
}

export function createRecordsCache(file) {
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
      if (record && typeof record.log === 'string') records.set(pathKey(record.log), record)
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

function metaFor(logPath) {
  try {
    const meta = JSON.parse(readFileSync(String(logPath).replace(/\.log$/i, '.meta.json'), 'utf8'))
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
    if (typeof meta.project !== 'string' || meta.project.trim() === '') return null
    return meta
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
  function currentLanes() {
    if (typeof options.lanes === 'function') return options.lanes()
    if (options.lanes) return options.lanes
    return readAllLanes({ folder: repoRoot, runsFolder: folder })
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
  const primeMs = Number(options.primeMs ?? DEFAULT_PRIME_MS)
  const now = options.now ?? Date.now
  const onFrame = options.onFrame ?? (() => {})
  const active = new Map()
  const quiet = new Map()
  const seen = new Set()
  const lagging = new Map()
  const recordsCache = createRecordsCache(recordsFile)
  let watcher = null
  let timer = null
  let stopped = false
  let ticking = false
  let primed = false

  function emit(frame) {
    try {
      onFrame(frame)
    } catch {}
  }

  function agentsNow() {
    const list = laneAgents(currentLanes())
    let subs = []
    try {
      subs = subOrchestrators() ?? []
    } catch {
      subs = []
    }
    for (const sub of Array.isArray(subs) ? subs : []) {
      const agent = subOrchestratorAgent(sub, currentLanes())
      if (agent && !list.some((item) => item.key === agent.key)) list.push(agent)
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

  function beginRun(name, path, agent, keepPaths = false, project = '') {
    const startedAt = now()
    const run = {
      name,
      path,
      key: pathKey(path),
      agent,
      project,
      base: { runId: `run-${name}`, agentId: agent.id, issueId: `issue-${name}` },
      companyId: `company-${name}`,
      seq: 0,
      offset: 0,
      buffer: '',
      decoder: new StringDecoder('utf8'),
      skipLine: false,
      feed: createRunLineReader(agent.parser),
      rewrite: keepPaths ? (line) => line : rewriter(project || currentLanes()[agent.key]?.worktree, roomRoot),
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

  function scan() {
    let entries
    try {
      entries = readdirSync(folder, { withFileTypes: true })
    } catch {
      return
    }
    const map = new Map(agentsNow().map((agent) => [agent.key, agent]))
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.log')) continue
      const path = join(folder, entry.name)
      const key = pathKey(path)
      if (lagging.has(key)) {
        let size
        try {
          size = statSync(path).size
        } catch {
          lagging.delete(key)
          continue
        }
        if (size <= lagging.get(key)) continue
        lagging.delete(key)
      } else {
        if (seen.has(key)) continue
        if (!primed) {
          try {
            const stat = statSync(path)
            if (now() - stat.mtimeMs > primeMs) {
              lagging.set(key, stat.size)
              continue
            }
          } catch {
            continue
          }
        }
      }
      const agent = agentFor(entry.name, map)
      if (!agent) {
        seen.add(key)
        continue
      }
      const meta = metaFor(path)
      const ownProject = meta && pathKey(meta.project) === pathKey(roomRoot)
      if (meta && !ownProject && !inRoomRepo(meta.project)) {
        seen.add(key)
        continue
      }
      if (!meta && !worktreeRunsShown) {
        seen.add(key)
        continue
      }
      seen.add(key)
      beginRun(entry.name.slice(0, -4), path, agent, Boolean(ownProject), meta?.project ?? '')
    }
  }

  function reset(run) {
    run.offset = 0
    run.buffer = ''
    run.skipLine = false
    run.decoder = new StringDecoder('utf8')
    run.feed = createRunLineReader(run.agent.parser)
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
      if (!entry || entry.read !== true) continue
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

  function tick() {
    if (stopped || ticking) return
    ticking = true
    try {
      scan()
      for (const run of [...quiet.values()]) {
        let size
        try {
          size = statSync(run.path).size
        } catch {
          continue
        }
        if (size > run.offset) reopenRun(run)
      }
      if (active.size === 0) return
      const records = recordsCache.read()
      for (const run of [...active.values()]) {
        readNew(run)
        const record = records.get(run.key)
        if (record) {
          finishRecord(run, record)
          continue
        }
        if (now() - run.lastGrowth >= quietMs && !laneLockAlive(folder, run.agent.key)) {
          finish(run, 'failed', 'no record', { reopen: true })
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
    try {
      watcher = watch(folder, () => tick())
      watcher.on('error', () => {
        try {
          watcher?.close()
        } catch {}
        watcher = null
      })
    } catch {
      watcher = null
    }
    timer = setInterval(tick, pollMs)
  }

  function stop() {
    stopped = true
    active.clear()
    quiet.clear()
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
