import { closeSync, openSync, readFileSync, readdirSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { pathInside } from '../src/briefs/run.js'

const READ_CHUNK = 64 * 1024
const MAX_PARTIAL = 1024 * 1024
const HELD_LIMIT = 200
const FULL_READ_MS = 60 * 1000
const PATH_KEYS = ['Path', 'AbsolutePath', 'TargetFile']
const TRANSCRIPT = join('.system_generated', 'logs', 'transcript.jsonl')
const COLUMNS = 'conversation_id, parent_conversation_id, agent_name, status, nesting_depth, last_modified_time'
const LINE_TYPES = new Set(['USER_INPUT', 'PLANNER_RESPONSE', 'GENERIC'])

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

function sizeOf(path) {
  try {
    return statSync(path).size
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
  const now = options.now ?? Date.now
  const emit = typeof options.emit === 'function' ? options.emit : () => {}
  const listFolder = typeof options.listFolder === 'function' ? options.listFolder : (dir) => readdirSync(dir, { withFileTypes: true })
  const conversations = new Map()
  const metaFiles = new Map()
  let metaNames = null
  let metaFolderStamp = null
  let db = null
  let allStmt = null
  let sinceStmt = null
  let highWater = null
  let lastFullReadAt = null
  let primed = false
  let stopped = false
  let ticking = false

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
    sinceStmt = db.prepare(`SELECT ${COLUMNS} FROM conversation_summaries WHERE last_modified_time > ?`)
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
    const skipped = new Set()
    if (!runsFolder) return skipped
    const stamp = runsFolderStamp()
    if (metaNames === null || stamp === null || stamp !== metaFolderStamp) {
      metaNames = listMetaNames()
      metaFolderStamp = stamp
    }
    const seen = new Set(metaNames)
    for (const name of metaNames) {
      const path = join(runsFolder, name)
      let mtimeMs
      try {
        mtimeMs = statSync(path).mtimeMs
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
    return skipped
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

  function takeRows(rows, skipped) {
    for (const row of rows) {
      const id = typeof row?.conversation_id === 'string' ? row.conversation_id : ''
      if (!id) continue
      const parentId = typeof row.parent_conversation_id === 'string' ? row.parent_conversation_id : ''
      const status = typeof row.status === 'string' ? row.status : ''
      const depth = Number.isFinite(row.nesting_depth) ? row.nesting_depth : parentId ? 1 : 0
      let entry = conversations.get(id)
      if (!entry) {
        const path = transcriptPath(id)
        const offset = primed ? 0 : sizeOf(path)
        entry = {
          id,
          parentId,
          depth,
          status,
          path,
          stream: newStream(path, offset),
          held: [],
          decision: 'unknown',
          lines: 0,
          skipped: skipped.has(id),
        }
        conversations.set(id, entry)
      } else {
        if (parentId) entry.parentId = parentId
        if (status !== entry.status) entry.status = status
        if (depth !== entry.depth) entry.depth = depth
        if (skipped.has(id)) entry.skipped = true
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

  function decide(root, json) {
    if (json.type !== 'PLANNER_RESPONSE') return false
    const calls = Array.isArray(json.tool_calls) ? json.tool_calls : []
    for (const call of calls) {
      const parameters = parseArgs(call?.args)
      for (const key of PATH_KEYS) {
        const path = absolutePath(parameters[key])
        if (!path) continue
        root.decision = pathInside(path, projectRoot) ? 'inside' : 'outside'
        return true
      }
    }
    return false
  }

  function hold(entry, json) {
    if (entry.held.length >= HELD_LIMIT) entry.held.shift()
    entry.held.push(json)
  }

  function dropHeld(root) {
    for (const entry of treeOf(root)) entry.held = []
  }

  function flushTree(root) {
    for (const entry of treeOf(root)) {
      if (entry.held.length === 0) continue
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
      if (entry !== root || !decide(root, json)) {
        hold(entry, json)
        return
      }
      if (root.decision !== 'inside') {
        dropHeld(root)
        return
      }
      hold(entry, json)
      flushTree(root)
      return
    }
    if (root.decision !== 'inside') {
      dropHeld(root)
      return
    }
    apply(entry, root, json)
  }

  function apply(entry, root, json) {
    entry.lines += 1
  }

  function readStream(stream, onLine) {
    let size
    try {
      size = statSync(stream.path).size
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
      fd = openSync(stream.path, 'r')
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

  function tick() {
    if (stopped || ticking) return
    ticking = true
    try {
      const skipped = skippedSessions()
      takeRows(readRows(), skipped)
      for (const entry of conversations.values()) {
        if (skipped.has(entry.id)) entry.skipped = true
      }
      for (const entry of conversations.values()) {
        const root = rootOf(entry)
        if (root?.decision === 'outside') dropHeld(root)
      }
      for (const entry of [...conversations.values()].sort(byDepth)) {
        if (entry.skipped) continue
        const root = rootOf(entry)
        if (!root || root.skipped || root.decision === 'outside') continue
        readStream(entry.stream, (line) => handleLine(entry, line))
      }
      primed = true
    } catch {
    } finally {
      ticking = false
    }
  }

  function stop() {
    stopped = true
    conversations.clear()
    metaFiles.clear()
    metaNames = null
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

  return { tick, stop, projectRoot, sessions: () => conversations, metaFiles: () => metaFiles, emit }
}
