import { closeSync, openSync, readFileSync, readdirSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { pathInside } from '../src/briefs/run.js'

const AGENT = {
  id: 'agent-claude-session',
  key: 'claude-session',
  name: 'Claude Code session',
  adapterType: 'claude_local',
  parser: 'claude',
  role: null,
}
const DEFAULT_QUIET_MS = 30000
const DEFAULT_IDLE_MS = 30 * 60 * 1000
const DEFAULT_IDLE_POLL_MS = 30 * 1000
const READ_CHUNK = 64 * 1024
const MAX_PARTIAL = 1024 * 1024
const RESULT_TEXT_LIMIT = 2000
const MAX_EVICTED = 200

export function claudeProjectSlug(folder) {
  return String(folder ?? '').replace(/[^A-Za-z0-9]/g, '-')
}

function iso(ms) {
  const value = Number.isFinite(ms) ? ms : Date.now()
  return new Date(value).toISOString()
}

function cutResult(item) {
  const content = item.content
  if (typeof content === 'string') {
    if (content.length <= RESULT_TEXT_LIMIT) return item
    return { ...item, content: content.slice(0, RESULT_TEXT_LIMIT) }
  }
  if (!Array.isArray(content)) return item
  let changed = false
  const next = content.map((part) => {
    if (!part || typeof part !== 'object' || typeof part.text !== 'string') return part
    if (part.text.length <= RESULT_TEXT_LIMIT) return part
    changed = true
    return { ...part, text: part.text.slice(0, RESULT_TEXT_LIMIT) }
  })
  return changed ? { ...item, content: next } : item
}

function keptContent(content) {
  if (!Array.isArray(content)) return []
  const kept = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    if (item.type === 'tool_use') kept.push(item)
    else if (item.type === 'tool_result') kept.push(cutResult(item))
  }
  return kept
}

function hasToolItem(content) {
  return Array.isArray(content) && content.some((item) => item && typeof item === 'object' && (item.type === 'tool_use' || item.type === 'tool_result'))
}

function isPrompt(content) {
  if (typeof content === 'string') return content.trim() !== ''
  if (!Array.isArray(content) || content.length === 0) return false
  let text = false
  for (const item of content) {
    if (!item || typeof item !== 'object') return false
    if (item.type === 'tool_result') return false
    if (item.type === 'text' && typeof item.text === 'string' && item.text.trim() !== '') text = true
  }
  return text
}

function newStream(path, offset) {
  return {
    path,
    offset,
    buffer: '',
    decoder: new StringDecoder('utf8'),
    skipLine: false,
  }
}

export function createClaudeSessionsReader(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? process.cwd())
  const home = options.home ?? homedir()
  const runsFolder = options.runsFolder ? resolve(options.runsFolder) : ''
  const now = options.now ?? Date.now
  const quietMs = Number.isFinite(Number(options.quietMs)) ? Number(options.quietMs) : DEFAULT_QUIET_MS
  const idleMs = Number.isFinite(Number(options.idleMs)) ? Number(options.idleMs) : DEFAULT_IDLE_MS
  const idlePollMs = Number.isFinite(Number(options.idlePollMs)) ? Number(options.idlePollMs) : Math.min(idleMs, DEFAULT_IDLE_POLL_MS)
  const emit = options.emit ?? (() => {})
  const projectsFolder = join(home, '.claude', 'projects', claudeProjectSlug(projectRoot))
  const sessions = new Map()
  const evicted = new Map()
  const metaFiles = new Map()
  let lastEvictedCheck = 0
  let primed = false
  let stopped = false
  let ticking = false

  function skippedSessions() {
    const skipped = new Set()
    if (!runsFolder) return skipped
    let entries
    try {
      entries = readdirSync(runsFolder, { withFileTypes: true })
    } catch {
      return skipped
    }
    const seen = new Set()
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.meta.json')) continue
      seen.add(entry.name)
      const path = join(runsFolder, entry.name)
      let mtimeMs
      try {
        mtimeMs = statSync(path).mtimeMs
      } catch {
        metaFiles.delete(entry.name)
        continue
      }
      const cached = metaFiles.get(entry.name)
      if (cached && cached.mtimeMs === mtimeMs) {
        if (cached.sessionId) skipped.add(cached.sessionId)
        continue
      }
      try {
        const meta = JSON.parse(readFileSync(path, 'utf8'))
        const sessionId = typeof meta?.sessionId === 'string' && meta.sessionId !== '' ? meta.sessionId : null
        metaFiles.set(entry.name, { mtimeMs, sessionId })
        if (sessionId) skipped.add(sessionId)
      } catch {
        metaFiles.delete(entry.name)
      }
    }
    for (const name of metaFiles.keys()) {
      if (!seen.has(name)) metaFiles.delete(name)
    }
    return skipped
  }

  function insideProject(cwd) {
    if (typeof cwd !== 'string' || cwd.trim() === '') return false
    let folder
    try {
      folder = resolve(cwd)
    } catch {
      return false
    }
    return pathInside(folder, projectRoot)
  }

  function baseOf(run) {
    return { runId: run.runId, agentId: AGENT.id, issueId: `issue-${run.runId}` }
  }

  function send(type, session, payload) {
    emit({ type, companyId: `company-${session.id}`, createdAt: iso(now()), payload })
  }

  function startRun(session) {
    if (session.run?.open) endRun(session, 'succeeded')
    const at = now()
    session.number += 1
    const run = { runId: `${session.id}:${session.number}`, seq: 0, startedAt: at, lastGrowth: at, open: true }
    session.run = run
    send('heartbeat.run.queued', session, baseOf(run))
    send('heartbeat.run.status', session, {
      ...baseOf(run),
      status: 'running',
      error: null,
      errorCode: null,
      startedAt: iso(at),
      finishedAt: null,
    })
    return run
  }

  function endRun(session, status) {
    const run = session.run
    if (!run?.open) return
    run.open = false
    session.children.clear()
    const at = now()
    send('heartbeat.run.status', session, {
      ...baseOf(run),
      status,
      error: null,
      errorCode: null,
      startedAt: iso(run.startedAt),
      finishedAt: iso(at),
    })
  }

  function sendLine(session, run, type, content, callId) {
    run.seq += 1
    const line = { type, message: { content } }
    if (typeof callId === 'string' && callId !== '') line.parent_tool_use_id = callId
    const at = now()
    emit({
      type: 'heartbeat.run.log',
      companyId: `company-${session.id}`,
      createdAt: iso(at),
      payload: {
        ...baseOf(run),
        ts: iso(at),
        seq: run.seq,
        stream: 'stdout',
        chunk: `${JSON.stringify(line)}\n`,
        truncated: false,
      },
    })
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

  function childCallId(json) {
    const content = json.message?.content
    if (!Array.isArray(content)) return ''
    for (const item of content) {
      if (item && typeof item === 'object' && item.type === 'tool_result' && typeof item.tool_use_id === 'string') return item.tool_use_id
    }
    return ''
  }

  function readChild(session, child) {
    if (child.finished) return
    const run = session.run
    if (!run?.open) return
    const grew = readStream(child.stream, (line) => handleLine(session, line, child.callId))
    if (grew) {
      session.lastGrowth = now()
      run.lastGrowth = now()
    }
  }

  function registerChild(session, json) {
    const agentId = typeof json.toolUseResult?.agentId === 'string' ? json.toolUseResult.agentId.trim() : ''
    if (!agentId) return
    const callId = childCallId(json)
    if (!callId) return
    if (session.children.has(agentId)) return
    const stream = newStream(join(projectsFolder, session.id, 'subagents', `agent-${agentId}.jsonl`), 0)
    const child = { agentId, callId, stream, finished: false }
    session.children.set(agentId, child)
    readChild(session, child)
    child.finished = true
    if (child.stream) child.stream.buffer = ''
  }

  function handleLine(session, line, callId) {
    let json
    try {
      json = JSON.parse(line)
    } catch {
      return
    }
    if (!json || typeof json !== 'object') return
    if (json.type !== 'assistant' && json.type !== 'user') return
    if (!insideProject(json.cwd)) return
    const child = typeof callId === 'string' && callId !== ''
    const content = json.message?.content
    const toolLine = hasToolItem(content)
    if (!child) {
      if (json.type === 'user' && isPrompt(content)) {
        startRun(session)
      } else if (toolLine && !session.run?.open) {
        startRun(session)
      }
      if (json.type === 'user' && json.toolUseResult) registerChild(session, json)
    }
    session.lastGrowth = now()
    const run = session.run
    if (!run?.open) return
    run.lastGrowth = now()
    const kept = keptContent(content)
    if (kept.length > 0) sendLine(session, run, json.type, kept, child ? callId : '')
    if (!child && json.type === 'assistant' && json.message?.stop_reason === 'end_turn') endRun(session, 'succeeded')
  }

  function scan(skippedIds) {
    let entries
    try {
      entries = readdirSync(projectsFolder, { withFileTypes: true })
    } catch {
      return
    }
    const skipped = skippedIds ?? skippedSessions()
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const id = entry.name.slice(0, -6)
      if (sessions.has(id) || evicted.has(id)) continue
      const path = join(projectsFolder, entry.name)
      if (skipped.has(id)) {
        sessions.set(id, { id, path, skipped: true, stream: null, children: new Map(), number: 0, run: null, lastGrowth: now() })
        continue
      }
      let size = 0
      if (!primed) {
        try {
          size = statSync(path).size
        } catch {
          size = 0
        }
      }
      sessions.set(id, { id, path, skipped: false, stream: newStream(path, size), children: new Map(), number: 0, run: null, lastGrowth: now() })
    }
  }

  function evictSession(id, session) {
    sessions.delete(id)
    if (session.children) session.children.clear()
    evicted.delete(id)
    evicted.set(id, {
      id,
      path: session.path,
      offset: session.stream ? session.stream.offset : 0,
      number: session.number ?? 0,
      skipped: Boolean(session.skipped),
    })
    while (evicted.size > MAX_EVICTED) {
      const oldest = evicted.keys().next().value
      evicted.delete(oldest)
    }
  }

  function scanEvicted() {
    if (evicted.size === 0) return
    const current = now()
    if (current - lastEvictedCheck < idlePollMs) return
    lastEvictedCheck = current
    for (const [id, entry] of evicted.entries()) {
      if (entry.skipped) continue
      let size
      try {
        size = statSync(entry.path).size
      } catch {
        continue
      }
      if (size !== entry.offset) {
        evicted.delete(id)
        sessions.set(id, {
          id,
          path: entry.path,
          skipped: false,
          stream: newStream(entry.path, entry.offset),
          children: new Map(),
          number: entry.number ?? 0,
          run: null,
          lastGrowth: current,
        })
      }
    }
  }

  function tick() {
    if (stopped || ticking) return
    ticking = true
    try {
      const skippedIds = skippedSessions()
      for (const [id, session] of sessions.entries()) {
        if (!session.skipped && skippedIds.has(id)) {
          session.skipped = true
          if (session.run?.open) endRun(session, 'succeeded')
        }
      }
      for (const [id, entry] of evicted.entries()) {
        if (!entry.skipped && skippedIds.has(id)) {
          entry.skipped = true
        }
      }
      scan(skippedIds)
      scanEvicted()
      primed = true
      for (const [id, session] of [...sessions.entries()]) {
        if (session.skipped) continue
        if (readStream(session.stream, (line) => handleLine(session, line, ''))) {
          session.lastGrowth = now()
          if (session.run?.open) session.run.lastGrowth = now()
        }
        for (const child of session.children.values()) readChild(session, child)
        const run = session.run
        if (run?.open && now() - run.lastGrowth >= quietMs) endRun(session, 'succeeded')
        if (!run?.open && now() - session.lastGrowth >= idleMs) {
          evictSession(id, session)
        }
      }
    } finally {
      ticking = false
    }
  }

  function stop() {
    stopped = true
    sessions.clear()
    evicted.clear()
    metaFiles.clear()
  }

  return { agent: AGENT, agents: [AGENT], tick, stop, sessions: () => sessions, evicted: () => evicted, metaFiles: () => metaFiles }
}
