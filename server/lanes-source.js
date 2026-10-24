import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync, watch } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { agentsFile, createRunLineReader, failureText } from '../src/briefs/recording.js'

const DEFAULT_QUIET_MS = 10 * 60 * 1000
const DEFAULT_POLL_MS = 200
const DEFAULT_PRIME_MS = 60 * 1000
const READ_CHUNK = 64 * 1024
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
      if (agent) agents.push({ ...agent, key: lane, role: null })
    } catch {}
  }
  return agents
}

function pathKey(path) {
  try {
    const resolved = resolve(String(path ?? ''))
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  } catch {
    return ''
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

export function createLanesSource(options = {}) {
  const folder = resolve(options.folder ?? runsFolder())
  const recordsFile = resolve(options.recordsFile ?? join(folder, 'runs.jsonl'))
  const lanes = options.lanes ?? readLanes()
  const agents = laneAgents(lanes)
  const byLane = new Map(agents.map((agent) => [agent.key, agent]))
  const roomRoot = options.projectRoot ? resolve(options.projectRoot) : ''
  const quietMs = Number(options.quietMs ?? DEFAULT_QUIET_MS)
  const pollMs = Number(options.pollMs ?? DEFAULT_POLL_MS)
  const primeMs = Number(options.primeMs ?? DEFAULT_PRIME_MS)
  const now = options.now ?? Date.now
  const onFrame = options.onFrame ?? (() => {})
  const active = new Map()
  const seen = new Set()
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

  function beginRun(name, path, agent, keepPaths = false) {
    const startedAt = now()
    const run = {
      name,
      path,
      key: pathKey(path),
      agent,
      base: { runId: `run-${name}`, agentId: agent.id, issueId: `issue-${name}` },
      companyId: `company-${name}`,
      seq: 0,
      offset: 0,
      buffer: '',
      decoder: new StringDecoder('utf8'),
      feed: createRunLineReader(agent.parser),
      rewrite: keepPaths ? (line) => line : rewriter(lanes[agent.key]?.worktree, roomRoot),
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
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.log')) continue
      const path = join(folder, entry.name)
      const key = pathKey(path)
      if (seen.has(key)) continue
      seen.add(key)
      if (!primed) {
        try {
          if (now() - statSync(path).mtimeMs > primeMs) continue
        } catch {
          continue
        }
      }
      const lane = laneOf(entry.name, lanes)
      if (!lane) continue
      const agent = byLane.get(lane)
      if (!agent) continue
      const meta = metaFor(path)
      if (meta && pathKey(meta.project) !== pathKey(roomRoot)) continue
      beginRun(entry.name.slice(0, -4), path, agent, Boolean(meta))
    }
  }

  function reset(run) {
    run.offset = 0
    run.buffer = ''
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
      }
    } finally {
      closeSync(fd)
    }
    run.lastGrowth = now()
    emitLines(run)
  }

  function emitLines(run) {
    const parts = run.buffer.split(/\r?\n/)
    run.buffer = parts.pop() ?? ''
    for (const line of parts) {
      if (!line.trim()) continue
      const entry = run.feed(run.rewrite(line))
      if (!entry) continue
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
  }

  function finish(run, status, error) {
    if (!active.has(run.key)) return
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
  }

  function finishRecord(run, record) {
    const ok = record.exitCode === 0 && record.killed !== true
    finish(run, ok ? 'succeeded' : 'failed', ok ? null : failureText(record))
  }

  function recordsByLog() {
    const records = new Map()
    let text
    try {
      text = readFileSync(recordsFile, 'utf8')
    } catch {
      return records
    }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (record && typeof record.log === 'string') records.set(pathKey(record.log), record)
    }
    return records
  }

  function tick() {
    if (stopped || ticking) return
    ticking = true
    try {
      scan()
      if (active.size === 0) return
      const records = recordsByLog()
      for (const run of [...active.values()]) {
        readNew(run)
        const record = records.get(run.key)
        if (record) {
          finishRecord(run, record)
          continue
        }
        if (now() - run.lastGrowth >= quietMs) finish(run, 'failed', 'no record')
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

  return { agents, start, stop, tick }
}
