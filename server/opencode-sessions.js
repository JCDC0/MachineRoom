import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { runsFolder as defaultRunsFolder } from './lanes-source.js'

const DEFAULT_QUIET_MS = 30000
const DEFAULT_QUIET_POLL_MS = 10000
const TEXT_LIMIT = 2000

export const OPENCODE_SESSION_AGENT = {
  id: 'agent-opencode-session',
  key: 'opencode-session',
  name: 'OpenCode session',
  adapterType: 'opencode_local',
  parser: 'opencode',
  role: null,
}

function defaultDbPath() {
  const xdg = String(process.env.XDG_DATA_HOME ?? '').trim()
  const base = xdg || join(homedir(), '.local', 'share')
  return join(base, 'opencode', 'opencode.db')
}

function pathKey(value) {
  if (typeof value !== 'string' || value.trim() === '') return ''
  try {
    const resolved = resolve(value)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  } catch {
    return ''
  }
}

function iso(ms) {
  const value = Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? ms : Date.now()
  return new Date(value).toISOString()
}

function parseData(value) {
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) return value
  try {
    const parsed = JSON.parse(String(value ?? ''))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function textOf(content) {
  if (typeof content === 'string') return content.slice(0, TEXT_LIMIT)
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const part of content) {
    if (typeof part === 'string') parts.push(part)
    else if (part && typeof part === 'object' && typeof part.text === 'string' && (part.type === undefined || part.type === 'text')) {
      parts.push(part.text)
    }
  }
  return parts.join('\n').slice(0, TEXT_LIMIT)
}

function namesRunLog(folder, title) {
  if (!folder || typeof title !== 'string' || title.trim() === '') return false
  if (basename(title) !== title) return false
  return existsSync(join(folder, `${title}.log`))
}

const DEFAULT_RETENTION_MS = 60 * 60 * 1000

export function createOpencodeSessionsReader(options = {}) {
  const rootKey = pathKey(options.projectRoot)
  const runs = resolve(String(options.runsFolder || defaultRunsFolder()))
  const dbPath = options.dbPath ? resolve(String(options.dbPath)) : defaultDbPath()
  const rawQuiet = Number(options.quietMs)
  const quietMs = Number.isFinite(rawQuiet) ? rawQuiet : DEFAULT_QUIET_MS
  const rawQuietPoll = Number(options.quietPollMs)
  const quietPollMs = Number.isFinite(rawQuietPoll) ? rawQuietPoll : DEFAULT_QUIET_POLL_MS
  const now = typeof options.now === 'function' ? options.now : Date.now
  const emit = typeof options.emit === 'function' ? options.emit : () => {}
  const rawRetention = Number(options.retentionMs)
  const retentionMs = Number.isFinite(rawRetention) ? rawRetention : DEFAULT_RETENTION_MS
  const sessions = new Map()
  const open = new Map()
  const sent = new Map()
  let db = null
  let sessionStmt = null
  let messageStmt = null
  let primed = false
  let stopped = false

  function safeEmit(frame) {
    try {
      emit(frame)
    } catch {}
  }

  function openDatabase() {
    if (db) return db
    if (!dbPath || !existsSync(dbPath)) return null
    try {
      // Loaded on first use, so a bridge without --sessions never loads SQLite or prints its experimental warning.
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
      db = new DatabaseSync(dbPath, { readOnly: true })
    } catch {
      db = null
    }
    return db
  }

  function prepareStatements() {
    if (!db) return
    if (!sessionStmt) {
      sessionStmt = db.prepare('SELECT id, parent_id, directory, title, time_updated FROM session_v2')
    }
    if (!messageStmt) {
      messageStmt = db.prepare(
        'SELECT id, session_id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ? AND time_updated >= ? ORDER BY time_updated ASC, seq ASC'
      )
    }
  }

  function sessionRows() {
    if (!sessionStmt) prepareStatements()
    return sessionStmt.all()
  }

  function messageRows(sessionId, since) {
    if (!messageStmt) prepareStatements()
    return messageStmt.all(sessionId, since)
  }

  function includedSessions(rows) {
    const included = new Map()
    if (!rootKey) return included
    const known = new Set()
    for (const row of rows) {
      if (row && typeof row.id === 'string') known.add(row.id)
    }
    for (const row of rows) {
      if (!row || typeof row.id !== 'string') continue
      if (row.parent_id && known.has(row.parent_id)) continue
      if (pathKey(row.directory) !== rootKey) continue
      if (namesRunLog(runs, row.title)) continue
      included.set(row.id, row.id)
    }
    let added = true
    while (added) {
      added = false
      for (const row of rows) {
        if (!row || typeof row.id !== 'string' || !row.parent_id || included.has(row.id)) continue
        const root = included.get(row.parent_id)
        if (!root) continue
        if (namesRunLog(runs, row.title)) continue
        included.set(row.id, root)
        added = true
      }
    }
    return included
  }

  function prime() {
    const rows = sessionRows()
    const included = includedSessions(rows)
    const rowMap = new Map()
    for (const row of rows) {
      if (row && typeof row.id === 'string') rowMap.set(row.id, row)
    }
    const at = now()
    for (const [id, rootId] of included) {
      const handled = new Map()
      let since = -1
      for (const row of messageRows(id, -1)) {
        handled.set(row.id, row.time_updated)
        if (Number.isFinite(row.time_updated) && row.time_updated > since) since = row.time_updated
      }
      sessions.set(id, {
        handled,
        since,
        rootId,
        lastSeen: at,
        lastPolled: at,
        lastSessionUpdated: rowMap.get(id)?.time_updated ?? null,
      })
    }
    primed = true
  }

  function basePayload(run) {
    return { runId: run.runId, agentId: OPENCODE_SESSION_AGENT.id, issueId: run.issueId }
  }

  function emitQueued(run) {
    safeEmit({
      type: 'heartbeat.run.queued',
      companyId: run.companyId,
      createdAt: iso(run.startedAt),
      payload: basePayload(run),
    })
  }

  function emitRunning(run) {
    safeEmit({
      type: 'heartbeat.run.status',
      companyId: run.companyId,
      createdAt: iso(run.startedAt),
      payload: {
        ...basePayload(run),
        status: 'running',
        error: null,
        errorCode: null,
        startedAt: iso(run.startedAt),
        finishedAt: null,
      },
    })
  }

  function createRun(rootId, row) {
    const at = now()
    const runId = `${rootId}:${row.seq ?? row.id}`
    const run = {
      runId,
      rootId,
      companyId: `company-${OPENCODE_SESSION_AGENT.key}`,
      issueId: `issue-${runId}`,
      startedAt: at,
      lastActivity: at,
      seq: 0,
    }
    open.set(rootId, run)
    emitQueued(run)
    emitRunning(run)
    return run
  }

  function ensureRun(rootId, row) {
    return open.get(rootId) ?? createRun(rootId, row)
  }

  function finishRun(rootId, status, error) {
    const run = open.get(rootId)
    if (!run) return
    open.delete(rootId)
    const at = now()
    safeEmit({
      type: 'heartbeat.run.status',
      companyId: run.companyId,
      createdAt: iso(at),
      payload: {
        ...basePayload(run),
        status,
        error,
        errorCode: null,
        startedAt: iso(run.startedAt),
        finishedAt: iso(at),
      },
    })
  }

  function timeOf(row) {
    return Number.isFinite(row.time_updated) ? row.time_updated : now()
  }

  function emitLog(run, line, at) {
    run.seq += 1
    run.lastActivity = now()
    safeEmit({
      type: 'heartbeat.run.log',
      companyId: run.companyId,
      createdAt: iso(now()),
      payload: {
        ...basePayload(run),
        ts: iso(at),
        seq: run.seq,
        stream: 'stdout',
        chunk: `${line}\n`,
        truncated: false,
      },
    })
  }

  function handleAssistant(sessionId, rootId, row, data) {
    const content = data?.content
    if (!Array.isArray(content)) return
    const at = timeOf(row)
    content.forEach((item, index) => {
      if (!item || item.type !== 'tool') return
      const state = item.state
      if (!state || typeof state !== 'object') return
      const status = state.status
      if (status !== 'completed' && status !== 'error') return
      const itemId = typeof item.id === 'string' && item.id ? item.id : `${row.id}:${index}`
      let seen = sent.get(sessionId)
      if (!seen) {
        seen = new Set()
        sent.set(sessionId, seen)
      }
      if (seen.has(itemId)) return
      const run = ensureRun(rootId, row)
      seen.add(itemId)
      const line = JSON.stringify({
        type: 'tool_use',
        timestamp: at,
        sessionID: sessionId,
        part: {
          id: itemId,
          tool: typeof item.name === 'string' && item.name ? item.name : 'other',
          state: {
            status,
            input: state.input && typeof state.input === 'object' ? state.input : {},
            output: textOf(state.content),
          },
        },
      })
      emitLog(run, line, at)
    })
  }

  function handleRow(sessionId, rootId, row) {
    const data = parseData(row.data)
    if (row.type === 'user') {
      if (sessionId !== rootId) return
      finishRun(rootId, 'succeeded', null)
      createRun(rootId, row)
      return
    }
    if (row.type === 'assistant') {
      const run = open.get(rootId)
      if (run) run.lastActivity = now()
      handleAssistant(sessionId, rootId, row, data)
      return
    }
    if (row.type === 'idle') {
      if (sessionId !== rootId) return
      const outcome = data?.outcome
      if (outcome === 'succeeded') finishRun(rootId, 'succeeded', null)
      else finishRun(rootId, 'failed', String(outcome ?? 'failed'))
    }
  }

  function processSession(sessionId, info) {
    for (const row of messageRows(sessionId, info.since)) {
      const last = info.handled.get(row.id)
      if (last !== undefined && row.time_updated <= last) continue
      info.handled.set(row.id, row.time_updated)
      info.lastSeen = now()
      if (Number.isFinite(row.time_updated) && row.time_updated > info.since) info.since = row.time_updated
      handleRow(sessionId, info.rootId, row)
    }
  }

  function isQuiet(id, rootId, sessionRow, at) {
    if (open.has(rootId)) return false
    const info = sessions.get(id)
    if (!info) return false
    if (sessionRow && sessionRow.time_updated !== info.lastSessionUpdated) return false
    if (info.lastPolled === 0) return false
    return at - info.lastSeen >= quietMs
  }

  function scan() {
    const rows = sessionRows()
    const included = includedSessions(rows)
    const rowMap = new Map()
    for (const row of rows) {
      if (row && typeof row.id === 'string') rowMap.set(row.id, row)
    }
    const at = now()
    for (const [id, rootId] of included) {
      const sessionRow = rowMap.get(id)
      let info = sessions.get(id)
      if (!info) {
        info = {
          handled: new Map(),
          since: -1,
          rootId,
          lastSeen: at,
          lastPolled: 0,
          lastSessionUpdated: sessionRow?.time_updated ?? null,
        }
        sessions.set(id, info)
      }
      info.rootId = rootId
      const quiet = isQuiet(id, rootId, sessionRow, at)
      if (quiet && at - info.lastPolled < quietPollMs) {
        continue
      }
      info.lastPolled = at
      info.lastSessionUpdated = sessionRow?.time_updated ?? null
      processSession(id, info)
    }
  }

  function quietEnds() {
    const at = now()
    for (const [rootId, run] of [...open]) {
      if (at - run.lastActivity >= quietMs) finishRun(rootId, 'succeeded', null)
    }
  }

  function forgetFinished() {
    const at = now()
    for (const [id, info] of sessions) {
      if (info.handled.size === 0 && !sent.has(id)) continue
      if (open.has(info.rootId) || at - info.lastSeen < retentionMs) continue
      info.handled.clear()
      sent.delete(id)
      // The query reads rows at or after since, so without the step the newest row would be handled again.
      info.since += 1
    }
  }

  function tick() {
    if (stopped) return
    if (!openDatabase()) return
    try {
      if (!primed) prime()
      scan()
      quietEnds()
      forgetFinished()
    } catch {}
  }

  function stop() {
    stopped = true
    open.clear()
    sessions.clear()
    sent.clear()
    if (db) {
      try {
        db.close()
      } catch {}
      db = null
    }
  }

  return { agent: { ...OPENCODE_SESSION_AGENT }, tick, stop }
}
