import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

const READ_CHUNK = 64 * 1024
const MAX_PARTIAL = 1024 * 1024
const FULL_READ_MS = 60 * 1000
const TRANSCRIPT = join('.system_generated', 'logs', 'transcript.jsonl')
const COLUMNS = 'conversation_id, parent_conversation_id, agent_name, status, nesting_depth, last_modified_time'
const LINE_TYPES = new Set(['USER_INPUT', 'PLANNER_RESPONSE', 'GENERIC'])

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
  const dbPath = options.dbPath ? resolve(String(options.dbPath)) : join(home, '.gemini', 'antigravity', 'conversation_summaries.db')
  const brainRoot = options.brainRoot ? resolve(String(options.brainRoot)) : join(home, '.gemini', 'antigravity', 'brain')
  const now = options.now ?? Date.now
  const conversations = new Map()
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

  function takeRows(rows) {
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
        entry = { id, parentId, depth, status, path, stream: newStream(path, offset), lines: 0 }
        conversations.set(id, entry)
      } else {
        if (parentId) entry.parentId = parentId
        if (status !== entry.status) entry.status = status
        if (depth !== entry.depth) entry.depth = depth
      }
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
      takeRows(readRows())
      for (const entry of conversations.values()) readStream(entry.stream, (line) => handleLine(entry, line))
      primed = true
    } catch {
    } finally {
      ticking = false
    }
  }

  function stop() {
    stopped = true
    conversations.clear()
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

  return { tick, stop, projectRoot, sessions: () => conversations }
}
