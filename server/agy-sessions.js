import { randomBytes } from 'node:crypto'
import { closeSync, openSync, readFileSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { pathInside } from '../src/briefs/run.js'

const READ_CHUNK = 64 * 1024
const MAX_PARTIAL = 1024 * 1024
const LOOKBACK_BYTES = 512 * 1024
const LOOKBACK_CHILDREN = 5
const RESULT_LIMIT = 2000
const HELD_LIMIT = 200
const FULL_READ_MS = 60 * 1000
const DEFAULT_QUIET_MS = 30000
const RUNNING_QUIET_MS = 30 * 60 * 1000
const IDLE_STATUS = 'CASCADE_RUN_STATUS_IDLE'
const CONVERSATION_ID = /^[0-9a-f-]{8,64}$/i
const PATH_KEYS = ['Path', 'AbsolutePath', 'TargetFile']
const TRANSCRIPT = join('.system_generated', 'logs', 'transcript.jsonl')
const COLUMNS = 'conversation_id, parent_conversation_id, agent_name, status, nesting_depth, last_modified_time'
const LINE_TYPES = new Set(['USER_INPUT', 'PLANNER_RESPONSE', 'GENERIC'])

export const ANTIGRAVITY_SESSION_AGENT = {
  id: 'agent-antigravity-session',
  key: 'antigravity-session',
  name: 'Antigravity session',
  adapterType: 'process',
  parser: 'agy',
  role: null,
}

function iso(ms) {
  const value = Number.isFinite(ms) ? ms : Date.now()
  return new Date(value).toISOString()
}

function absolutePath(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (!/^[a-zA-Z]:[\\/]/.test(text) && !text.startsWith('/')) return ''
  try {
    return resolve(text)
  } catch {
    return ''
  }
}

function parseArgs(args) {
  if (!args || typeof args !== 'object') return {}
  const out = {}
  for (const [key, raw] of Object.entries(args)) {
    if (typeof raw !== 'string') {
      out[key] = raw
      continue
    }
    try {
      out[key] = JSON.parse(raw)
    } catch {
      out[key] = raw.replace(/^"|"$/g, '')
    }
  }
  return out
}

function sizeOf(stat, path) {
  try {
    return stat(path).size
  } catch {
    return 0
  }
}

function newStream(path, offset) {
  return { path, offset, buffer: '', decoder: new StringDecoder('utf8'), skipLine: false }
}

export function createAgySessionsReader(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? process.cwd())
  const home = options.home ?? homedir()
  const runsFolder = options.runsFolder ? resolve(options.runsFolder) : ''
  const dbPath = options.dbPath ? resolve(String(options.dbPath)) : join(home, '.gemini', 'antigravity', 'conversation_summaries.db')
  const brainRoot = options.brainRoot ? resolve(String(options.brainRoot)) : join(home, '.gemini', 'antigravity', 'brain')
  const token = randomBytes(4).toString('hex')
  const now = options.now ?? Date.now
  const quietMs = Number.isFinite(Number(options.quietMs)) ? Number(options.quietMs) : DEFAULT_QUIET_MS
  const emit = typeof options.emit === 'function' ? options.emit : () => {}
  const listFolder = typeof options.listFolder === 'function' ? options.listFolder : (dir) => readdirSync(dir, { withFileTypes: true })
  const statFile = typeof options.statFile === 'function' ? options.statFile : (path) => statSync(path)
  const conversations = new Map()
  const pending = new Map()
  const metaFiles = new Map()
  let skippedIds = new Set()
  let metaFolderStamp = null
  let db = null
  let allStmt = null
  let sinceStmt = null
  let highWater = null
  let lastFullReadAt = null
  let endNumber = 0
  let primed = false
  let stopped = false
  let ticking = false

  function safeEmit(frame) {
    try {
      emit(frame)
    } catch {}
  }

  function openDatabase() {
    if (db) return db
    try {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
      db = new DatabaseSync(dbPath, { readOnly: true })
    } catch {
      db = null
    }
    return db
  }

  function prepare() {
    if (!db || allStmt) return
    allStmt = db.prepare(`SELECT ${COLUMNS} FROM conversation_summaries`)
    sinceStmt = db.prepare(
      `SELECT ${COLUMNS} FROM conversation_summaries WHERE last_modified_time > ? OR status != '${IDLE_STATUS}'`
    )
  }

  function runsFolderStamp() {
    try {
      const stat = statSync(runsFolder, { bigint: true })
      return String(stat.mtimeNs ?? stat.mtimeMs)
    } catch {
      return null
    }
  }

  function listMetaNames() {
    let entries
    try {
      entries = listFolder(runsFolder)
    } catch {
      return []
    }
    const names = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.meta.json')) continue
      names.push(entry.name)
    }
    return names
  }

  function skippedSessions() {
    if (!runsFolder) return skippedIds
    const stamp = runsFolderStamp()
    if (stamp === metaFolderStamp) return skippedIds
    const metaNames = listMetaNames()
    const skipped = new Set()
    const seen = new Set(metaNames)
    for (const name of metaNames) {
      const path = join(runsFolder, name)
      let mtimeMs
      try {
        mtimeMs = statFile(path).mtimeMs
      } catch {
        metaFiles.delete(name)
        continue
      }
      const cached = metaFiles.get(name)
      if (cached && cached.mtimeMs === mtimeMs) {
        if (cached.sessionId) skipped.add(cached.sessionId)
        continue
      }
      try {
        const meta = JSON.parse(readFileSync(path, 'utf8'))
        const sessionId = typeof meta?.sessionId === 'string' && meta.sessionId !== '' ? meta.sessionId : null
        metaFiles.set(name, { mtimeMs, sessionId })
        if (sessionId) skipped.add(sessionId)
      } catch {
        metaFiles.delete(name)
      }
    }
    for (const name of metaFiles.keys()) {
      if (!seen.has(name)) metaFiles.delete(name)
    }
    metaFolderStamp = stamp
    skippedIds = skipped
    return skippedIds
  }

  function readRows() {
    if (!openDatabase()) return []
    prepare()
    if (!allStmt) return []
    const at = now()
    const full = highWater === null || lastFullReadAt === null || at - lastFullReadAt >= FULL_READ_MS
    const rows = full ? allStmt.all() : sinceStmt.all(highWater)
    let highest = highWater ?? ''
    for (const row of rows) {
      const stamp = typeof row?.last_modified_time === 'string' ? row.last_modified_time : ''
      if (stamp > highest) highest = stamp
    }
    highWater = highest
    if (full) lastFullReadAt = at
    return rows
  }

  function transcriptPath(id) {
    return join(brainRoot, id, TRANSCRIPT)
  }

  function confinedTranscript(path) {
    try {
      const root = join(realpathSync.native(dirname(brainRoot)), basename(brainRoot))
      const target = realpathSync.native(path)
      const within = relative(root, target)
      if (within && within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within)) return target
    } catch {}
    return ''
  }

  function takeRows(rows, skipped) {
    for (const row of rows) {
      const id = typeof row?.conversation_id === 'string' ? row.conversation_id : ''
      if (!CONVERSATION_ID.test(id)) continue
      const parentId = typeof row.parent_conversation_id === 'string' ? row.parent_conversation_id : ''
      if (parentId && !CONVERSATION_ID.test(parentId)) continue
      const agentName = typeof row.agent_name === 'string' ? row.agent_name : ''
      const status = typeof row.status === 'string' ? row.status : ''
      const stamp = typeof row.last_modified_time === 'string' ? row.last_modified_time : ''
      const depth = Number.isFinite(row.nesting_depth) ? row.nesting_depth : parentId ? 1 : 0
      let entry = conversations.get(id)
      if (!entry) {
        const path = transcriptPath(id)
        const existing = primed || skipped.has(id) ? '' : confinedTranscript(path)
        const offset = existing ? sizeOf(statFile, existing) : 0
        entry = {
          id,
          parentId,
          agentName,
          depth,
          status,
          path,
          stream: newStream(path, offset),
          held: [],
          linked: false,
          ended: false,
          decision: 'unknown',
          pathCount: 0,
          projectPaths: 0,
          lines: 0,
          openCalls: 0,
          run: null,
          number: 0,
          skipped: skipped.has(id),
          lastModified: stamp,
          changed: true,
        }
        conversations.set(id, entry)
      } else {
        if (parentId) entry.parentId = parentId
        if (agentName) entry.agentName = agentName
        if (status !== entry.status) {
          entry.status = status
          if (status !== IDLE_STATUS) entry.ended = false
        }
        if (depth !== entry.depth) entry.depth = depth
        if (skipped.has(id)) entry.skipped = true
        if (stamp !== '' && stamp !== entry.lastModified) {
          entry.lastModified = stamp
          entry.changed = true
        }
      }
    }
  }

  function rootOf(entry) {
    let current = entry
    const seen = new Set()
    while (current) {
      if (!current.parentId) return current
      if (seen.has(current.id)) return null
      seen.add(current.id)
      current = conversations.get(current.parentId)
    }
    return null
  }

  function byDepth(a, b) {
    const one = a.parentId ? a.depth : 0
    const two = b.parentId ? b.depth : 0
    if (one !== two) return one - two
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }

  function treeOf(root) {
    const rest = []
    for (const entry of conversations.values()) {
      if (entry === root) continue
      if (rootOf(entry) === root) rest.push(entry)
    }
    rest.sort(byDepth)
    return [root].concat(rest)
  }

  function basePayload(run) {
    return { runId: run.runId, agentId: ANTIGRAVITY_SESSION_AGENT.id, issueId: run.issueId }
  }

  function startRun(root) {
    if (root.run?.open) endRun(root, 'succeeded')
    root.number += 1
    const at = now()
    const run = {
      runId: `${root.id}:${token}:${root.number}`,
      rootId: root.id,
      seq: 0,
      startedAt: at,
      lastGrowth: at,
      openCalls: 0,
      open: true,
    }
    root.run = run
    safeEmit({ type: 'heartbeat.run.queued', companyId: `company-${root.id}`, createdAt: iso(at), payload: basePayload(run) })
    safeEmit({
      type: 'heartbeat.run.status',
      companyId: `company-${root.id}`,
      createdAt: iso(at),
      payload: { ...basePayload(run), status: 'running', error: null, errorCode: null, startedAt: iso(at), finishedAt: null },
    })
    return run
  }

  function ensureRun(root) {
    return root.run?.open ? root.run : startRun(root)
  }

  function endRun(root, status) {
    const run = root.run
    if (!run?.open) return
    run.open = false
    const at = now()
    safeEmit({
      type: 'heartbeat.run.status',
      companyId: `company-${root.id}`,
      createdAt: iso(at),
      payload: { ...basePayload(run), status, error: null, errorCode: null, startedAt: iso(run.startedAt), finishedAt: iso(at) },
    })
  }

  function sendStep(run, step) {
    const own = conversations.get(step.conversation_id)
    step.root_conversation_id = run.rootId
    if (own?.parentId && own.agentName) step.name = own.agentName
    run.seq += 1
    const at = now()
    safeEmit({
      type: 'heartbeat.run.log',
      companyId: `company-${run.rootId}`,
      createdAt: iso(at),
      payload: {
        ...basePayload(run),
        ts: iso(at),
        seq: run.seq,
        stream: 'stdout',
        chunk: `${JSON.stringify({ event: 'step_update', step_update: step })}\n`,
        truncated: false,
      },
    })
  }

  function pendingOf(id) {
    let list = pending.get(id)
    if (!list) {
      list = []
      pending.set(id, list)
    }
    return list
  }

  function countPaths(root, json) {
    if (json.type !== 'PLANNER_RESPONSE') return
    const calls = Array.isArray(json.tool_calls) ? json.tool_calls : []
    for (const call of calls) {
      const parameters = parseArgs(call?.args)
      for (const key of PATH_KEYS) {
        const path = absolutePath(parameters[key])
        if (!path) continue
        if (pathInside(path, brainRoot)) continue
        root.pathCount += 1
        if (pathInside(path, projectRoot)) root.projectPaths += 1
      }
    }
  }

  function hasProjectMajority(root) {
    return root.projectPaths >= 2 && root.projectPaths * 2 > root.pathCount
  }

  function countTailPaths(root, stream) {
    const size = stream.offset
    if (size <= 0) return
    const path = confinedTranscript(stream.path)
    if (!path) return
    const start = Math.max(0, size - LOOKBACK_BYTES)
    let fd
    try {
      fd = openSync(path, 'r')
    } catch {
      return
    }
    let text = ''
    try {
      const buffer = Buffer.alloc(size - start)
      const read = readSync(fd, buffer, 0, buffer.length, start)
      if (read > 0) text = buffer.subarray(0, read).toString('utf8')
    } catch {
      text = ''
    } finally {
      closeSync(fd)
    }
    if (!text) return
    const lines = text.split(/\r?\n/)
    if (start > 0) lines.shift()
    for (const line of lines) {
      if (!line.trim()) continue
      let json
      try {
        json = JSON.parse(line)
      } catch {
        continue
      }
      if (!json || typeof json !== 'object') continue
      countPaths(root, json)
    }
  }

  function lookBack(entries) {
    const byRoot = new Map()
    for (const entry of entries) {
      if (entry.skipped) continue
      const root = rootOf(entry)
      if (!root || root.skipped) continue
      if (!byRoot.has(root)) byRoot.set(root, [])
      if (entry !== root && entry.stream.offset > 0) byRoot.get(root).push(entry)
    }
    for (const [root, children] of byRoot) {
      if (root.status !== IDLE_STATUS) {
        countTailPaths(root, root.stream)
        children.sort((a, b) => b.lastModified.localeCompare(a.lastModified))
        for (const child of children.slice(0, LOOKBACK_CHILDREN)) countTailPaths(root, child.stream)
      } else {
        for (const child of children) {
          if (child.status !== IDLE_STATUS) countTailPaths(root, child.stream)
        }
      }
      if (hasProjectMajority(root)) root.decision = 'inside'
    }
  }

  function hold(entry, json) {
    if (entry.held.length >= HELD_LIMIT) entry.held.shift()
    entry.held.push(json)
  }

  function flushTree(root) {
    for (const entry of treeOf(root)) {
      if (entry.held.length === 0) continue
      if (entry !== root && (!entry.parentId || !entry.linked)) continue
      const queued = entry.held
      entry.held = []
      for (const json of queued) apply(entry, root, json)
    }
  }

  function handleLine(entry, line) {
    let json
    try {
      json = JSON.parse(line)
    } catch {
      return
    }
    if (!json || typeof json !== 'object') return
    if (!LINE_TYPES.has(json.type)) return
    const root = rootOf(entry)
    if (!root) return
    if (root.decision === 'unknown') {
      countPaths(root, json)
      hold(entry, json)
      if (hasProjectMajority(root)) {
        root.decision = 'inside'
        flushTree(root)
      }
      return
    }
    if (entry.parentId && !entry.linked) {
      hold(entry, json)
      return
    }
    apply(entry, root, json)
  }

  function apply(entry, root, json) {
    entry.lines += 1
    if (json.type === 'USER_INPUT') {
      ensureRun(root)
      return
    }
    if (json.type === 'PLANNER_RESPONSE') {
      const calls = Array.isArray(json.tool_calls) ? json.tool_calls : []
      if (calls.length === 0) return
      const run = ensureRun(root)
      const base = Number.isFinite(json.step_index) ? json.step_index : 0
      calls.forEach((call, index) => {
        const name = typeof call?.name === 'string' && call.name !== '' ? call.name : 'other'
        const parameters = parseArgs(call?.args)
        const toolName = name === 'invoke_subagent' ? 'subagent_call' : name
        const stepIndex = `${base}.${index}`
        sendStep(run, {
          conversation_id: entry.id,
          step_index: stepIndex,
          state: 'ACTIVE',
          step_type: 'tool',
          tool_name: toolName,
          tool_info: { name: toolName, parameters },
        })
        entry.openCalls += 1
        run.openCalls += 1
        pendingOf(entry.id).push({ stepIndex, toolName, parameters })
      })
      return
    }
    if (json.type !== 'GENERIC') return
    const list = pending.get(entry.id)
    const call = list?.shift()
    if (!call) return
    const run = root.run
    if (!run?.open) return
    const state = json.status === 'ERROR' ? 'ERROR' : 'DONE'
    const output = typeof json.content === 'string' ? json.content.slice(0, RESULT_LIMIT) : ''
    const error = typeof json.error === 'string' && json.error.trim() !== '' ? json.error.trim() : ''
    sendStep(run, {
      conversation_id: entry.id,
      step_index: call.stepIndex,
      state,
      step_type: 'tool',
      tool_name: call.toolName,
      tool_info: { name: call.toolName, parameters: call.parameters, output, ...(error ? { error } : {}) },
    })
    entry.openCalls = Math.max(0, entry.openCalls - 1)
    run.openCalls = Math.max(0, run.openCalls - 1)
  }

  function linkChildren() {
    const children = [...conversations.values()].filter((entry) => entry.parentId).sort(byDepth)
    for (const entry of children) {
      if (entry.linked || entry.skipped) continue
      const parent = conversations.get(entry.parentId)
      if (!parent || parent.skipped) continue
      const root = rootOf(entry)
      if (!root || root.skipped || root.decision !== 'inside') continue
      const run = ensureRun(root)
      entry.linked = true
      const name = entry.agentName || 'subagent'
      const parameters = { Role: name, TypeName: name }
      const stepIndex = `link.${entry.id}`
      sendStep(run, {
        conversation_id: parent.id,
        step_index: stepIndex,
        state: 'ACTIVE',
        step_type: 'subagent',
        tool_name: 'invoke_subagent',
        tool_info: { name: 'invoke_subagent', parameters },
      })
      sendStep(run, {
        conversation_id: parent.id,
        step_index: stepIndex,
        state: 'DONE',
        step_type: 'subagent',
        tool_name: 'invoke_subagent',
        tool_info: { name: 'invoke_subagent', parameters },
        subagent_info: { subagents: [{ role: name, conversation_id: entry.id }] },
      })
    }
  }

  function endIdleChildren() {
    for (const entry of conversations.values()) {
      if (!entry.parentId || entry.skipped || !entry.linked || entry.ended) continue
      if (entry.status !== IDLE_STATUS) continue
      if (entry.openCalls > 0) continue
      const root = rootOf(entry)
      if (!root || !root.run?.open) continue
      const parent = conversations.get(entry.parentId)
      if (!parent) continue
      entry.ended = true
      endNumber += 1
      sendStep(root.run, {
        conversation_id: parent.id,
        step_index: `end.${endNumber}`,
        state: 'DONE',
        step_type: 'tool',
        tool_name: 'manage_subagents',
        tool_info: {
          name: 'manage_subagents',
          parameters: { Action: 'list' },
          output: JSON.stringify([{ conversationId: entry.id, state: 'idle' }]),
        },
      })
    }
  }

  function readStream(stream, onLine) {
    const path = confinedTranscript(stream.path)
    if (!path) return false
    let size
    try {
      size = statFile(path).size
    } catch {
      return false
    }
    if (size < stream.offset) {
      stream.offset = 0
      stream.buffer = ''
      stream.skipLine = false
      stream.decoder = new StringDecoder('utf8')
    }
    if (size === stream.offset) return false
    let fd
    try {
      fd = openSync(path, 'r')
    } catch {
      return false
    }
    try {
      const buffer = Buffer.alloc(READ_CHUNK)
      while (stream.offset < size) {
        const wanted = Math.min(READ_CHUNK, size - stream.offset)
        const read = readSync(fd, buffer, 0, wanted, stream.offset)
        if (read <= 0) break
        stream.offset += read
        stream.buffer += stream.decoder.write(buffer.subarray(0, read))
        if (stream.buffer.length > MAX_PARTIAL) readLines(stream, onLine)
      }
    } finally {
      closeSync(fd)
    }
    readLines(stream, onLine)
    return true
  }

  function readLines(stream, onLine) {
    if (stream.skipLine) {
      const cut = stream.buffer.indexOf('\n')
      if (cut === -1) {
        stream.buffer = ''
        return
      }
      stream.buffer = stream.buffer.slice(cut + 1)
      stream.skipLine = false
    }
    const parts = stream.buffer.split(/\r?\n/)
    stream.buffer = parts.pop() ?? ''
    for (const line of parts) {
      if (line.trim()) onLine(line)
    }
    if (stream.buffer.length > MAX_PARTIAL) {
      stream.buffer = ''
      stream.skipLine = true
    }
  }

  function drainHeld() {
    for (const entry of [...conversations.values()].sort(byDepth)) {
      if (entry.held.length === 0) continue
      if (entry.parentId && !entry.linked) continue
      const root = rootOf(entry)
      if (!root || root.skipped || root.decision !== 'inside') continue
      const queued = entry.held
      entry.held = []
      for (const json of queued) apply(entry, root, json)
    }
  }

  function treeIdle(root) {
    for (const entry of treeOf(root)) {
      if (entry.skipped) continue
      if (entry.status !== IDLE_STATUS) return false
    }
    return true
  }

  function endRuns() {
    for (const entry of conversations.values()) {
      if (entry.parentId) continue
      const run = entry.run
      if (!run?.open) continue
      const idle = treeIdle(entry)
      if (run.openCalls === 0 && entry.decision === 'inside' && idle) {
        endRun(entry, 'succeeded')
        continue
      }
      if (now() - run.lastGrowth >= (idle ? quietMs : RUNNING_QUIET_MS)) endRun(entry, 'succeeded')
    }
  }

  function tick() {
    if (stopped || ticking) return
    ticking = true
    try {
      const skipped = skippedSessions()
      takeRows(readRows(), skipped)
      for (const entry of conversations.values()) {
        if (skipped.has(entry.id)) entry.skipped = true
      }
      const entries = [...conversations.values()].sort(byDepth)
      if (!primed) lookBack(entries)
      for (const entry of entries) {
        if (entry.skipped) continue
        const root = rootOf(entry)
        if (!root || root.skipped) continue
        if (!entry.changed && entry.status === IDLE_STATUS) continue
        if (readStream(entry.stream, (line) => handleLine(entry, line))) {
          if (root.run?.open) root.run.lastGrowth = now()
        }
      }
      for (const entry of conversations.values()) entry.changed = false
      linkChildren()
      drainHeld()
      endIdleChildren()
      endRuns()
      primed = true
    } catch {
    } finally {
      ticking = false
    }
  }

  function stop() {
    stopped = true
    conversations.clear()
    pending.clear()
    metaFiles.clear()
    skippedIds.clear()
    metaFolderStamp = null
    highWater = null
    lastFullReadAt = null
    if (db) {
      try {
        db.close()
      } catch {}
      db = null
    }
    allStmt = null
    sinceStmt = null
  }

  return {
    agent: { ...ANTIGRAVITY_SESSION_AGENT },
    agents: [{ ...ANTIGRAVITY_SESSION_AGENT }],
    tick,
    stop,
    projectRoot,
    sessions: () => conversations,
    metaFiles: () => metaFiles,
    open: () => new Map([...conversations.values()].filter((entry) => entry.run?.open).map((entry) => [entry.id, entry.run])),
    emit,
  }
}
