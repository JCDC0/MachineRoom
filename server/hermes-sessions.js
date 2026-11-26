import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path'
import { pathInside } from '../src/briefs/run.js'
import { looksFailed } from '../src/model/parsers/common.js'
import { lanesFromShell, runsFolder as defaultRunsFolder } from './lanes-source.js'

const DEFAULT_QUIET_MS = 30000
const OPEN_CALL_QUIET_MS = 30 * 60 * 1000
const READ_LIMIT = 200
const SESSION_COLUMNS = 'id, source, model, parent_session_id, started_at, ended_at, cwd, git_repo_root, last_activity_at, title'
const MESSAGE_COLUMNS = 'id, session_id, role, content, tool_calls, tool_call_id, tool_name, timestamp'

export const HERMES_SESSION_AGENT = {
  id: 'agent-hermes-session',
  key: 'hermes-session',
  name: 'Hermes session',
  adapterType: 'hermes_local',
  parser: 'hermes',
  role: null,
}

export function hermesHome({ home, env = process.env, platform = process.platform } = {}) {
  const paths = platform === 'win32' ? win32 : posix
  const joinFor = paths.join
  const given = String(env?.HERMES_HOME ?? '').trim()
  if (given !== '') return paths.resolve(given)
  const local = platform === 'win32' ? String(env?.LOCALAPPDATA ?? '').trim() : ''
  if (local !== '') return joinFor(local, 'hermes')
  return joinFor(home ?? homedir(), '.hermes')
}

function iso(ms) {
  const value = Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? ms : Date.now()
  return new Date(value).toISOString()
}

function timeMs(value) {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value) < 1e11 ? value * 1000 : value
  const text = String(value).trim()
  if (text === '') return 0
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const number = Number(text)
    return number < 1e11 ? number * 1000 : number
  }
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : 0
}

function textOf(value) {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

function callList(raw) {
  let list = raw
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list)
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const fn = item.function && typeof item.function === 'object' ? item.function : item
    const name = typeof fn.name === 'string' ? fn.name : ''
    if (name === '') continue
    let args = fn.arguments ?? {}
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args)
      } catch {
        args = {}
      }
    }
    out.push({ id: typeof item.id === 'string' ? item.id : '', name, args })
  }
  return out
}

export function createHermesSessionsReader(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? process.cwd())
  const runsFolder = resolve(String(options.runsFolder || defaultRunsFolder()))
  const token = randomBytes(4).toString('hex')
  const home = options.home ?? homedir()
  const dbPath = options.dbPath
    ? resolve(String(options.dbPath))
    : resolve(hermesHome({ home, env: options.env ?? process.env, platform: options.platform ?? process.platform }), 'state.db')
  const stateHome = dirname(dbPath)
  const now = typeof options.now === 'function' ? options.now : Date.now
  const quietMs = Number.isFinite(Number(options.quietMs)) ? Number(options.quietMs) : DEFAULT_QUIET_MS
  const emit = typeof options.emit === 'function' ? options.emit : () => {}
  const listFolder = typeof options.listFolder === 'function' ? options.listFolder : (dir) => readdirSync(dir, { withFileTypes: true })
  const statFile = options.statFile ?? statSync
  const startupAt = now()
  const sessions = new Map()
  const metaFiles = new Map()
  let skippedIds = new Set()
  let metaFolderStamp = null
  let db = null
  let sessionStmt = null
  let startupId = null
  let rowStmt = null
  let stopped = false
  let lastError = ''

  function safeEmit(frame) {
    try {
      emit(frame)
    } catch {}
  }

  function openDatabase() {
    if (db) return db
    if (!dbPath || !existsSync(dbPath)) return null
    try {
      const root = realpathSync.native(stateHome)
      const target = realpathSync.native(dbPath)
      const within = relative(root, target)
      if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
        lastError = 'The Hermes sessions database is outside the Hermes home.'
        return null
      }
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
      db = new DatabaseSync(target, { readOnly: true })
    } catch {
      lastError = 'The Hermes sessions database could not be opened for reading.'
      db = null
    }
    return db
  }

  function prepare() {
    if (!db || rowStmt) return
    if (startupId === null) startupId = db.prepare('SELECT max(id) AS top FROM messages').get()?.top ?? 0
    sessionStmt = db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions`)
    rowStmt = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT ${READ_LIMIT}`)
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

  function insideProject(folder) {
    if (typeof folder !== 'string' || folder.trim() === '') return false
    let resolved
    try {
      resolved = resolve(folder)
    } catch {
      return false
    }
    return pathInside(resolved, projectRoot)
  }

  function qualifies(row) {
    if (!row || typeof row.id !== 'string' || row.id === '') return false
    if (textOf(row.parent_session_id) !== '') return false
    if (!insideProject(row.cwd) && !insideProject(row.git_repo_root)) return false
    return (timeMs(row.last_activity_at) || timeMs(row.started_at)) > startupAt
  }

  function basePayload(run) {
    return { runId: run.runId, agentId: HERMES_SESSION_AGENT.id, issueId: `issue-${run.runId}`, session: run.rootId }
  }

  function startRun(root) {
    if (root.run?.open) endRun(root, 'succeeded')
    root.number += 1
    const at = now()
    const run = { runId: `${root.id}:${token}:${root.number}`, rootId: root.id, seq: 0, startedAt: at, lastGrowth: at, open: true }
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

  function sendLine(root, line, at) {
    const run = root.run
    if (!run?.open) return
    run.seq += 1
    const stamp = now()
    run.lastGrowth = stamp
    safeEmit({
      type: 'heartbeat.run.log',
      companyId: `company-${root.id}`,
      createdAt: iso(stamp),
      payload: { ...basePayload(run), ts: iso(at), seq: run.seq, stream: 'stdout', chunk: `${JSON.stringify(line)}\n`, truncated: false },
    })
  }

  function childName(row) {
    const title = textOf(row?.title).trim()
    if (title !== '') return title
    const source = textOf(row?.source).trim()
    return source === 'subagent' || source === '' ? 'subagent' : source
  }

  function addSession(row, parent) {
    const info = {
      id: row.id,
      parentId: parent ? parent.id : '',
      name: childName(row),
      lastId: startupId,
      endedAt: timeMs(row.ended_at),
      lastGrowth: null,
      open: new Set(),
      root: null,
      number: 0,
      run: null,
      row,
    }
    info.root = parent ? parent.root : info
    sessions.set(info.id, info)
    return info
  }

  function dropSession(info) {
    const root = info.root
    if (root !== info) {
      sessions.delete(info.id)
      return
    }
    if (root?.run?.open) endRun(root, 'succeeded')
    for (const child of [...sessions.values()]) {
      if (child !== info && child.root === info) dropSession(child)
    }
    sessions.delete(info.id)
  }

  function follow(rows, skipped) {
    const present = new Map()
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || row.id === '') continue
      present.set(row.id, row)
    }
    for (const info of [...sessions.values()]) {
      const row = present.get(info.id)
      if (!row || skipped.has(info.id)) {
        dropSession(info)
        continue
      }
      info.endedAt = timeMs(row.ended_at)
      info.name = info.parentId === '' ? info.name : childName(row)
      info.row = row
    }
    for (const row of present.values()) {
      if (skipped.has(row.id) || sessions.has(row.id)) continue
      if (!qualifies(row)) continue
      addSession(row, null)
    }
    let added = true
    while (added) {
      added = false
      for (const row of present.values()) {
        if (skipped.has(row.id) || sessions.has(row.id)) continue
        const parent = sessions.get(textOf(row.parent_session_id))
        if (!parent) continue
        addSession(row, parent)
        added = true
      }
    }
  }

  function handleRow(info, row) {
    const root = info.root
    const calledAt = timeMs(row.timestamp)
    const at = calledAt || now()
    if (row.role === 'user') {
      if (info === root) {
        root.open.clear()
        startRun(root)
      } else ensureRun(root)
      return
    }
    if (row.role === 'assistant') {
      const calls = callList(row.tool_calls)
      if (calls.length === 0) return
      ensureRun(root)
      calls.forEach((call, index) => {
        const id = call.id || `${info.id}:${row.id}:${index}`
        if (typeof options.onLaneCommand === 'function' && call.name === 'terminal' && calledAt) {
          for (const lane of lanesFromShell(call.args?.command)) {
            options.onLaneCommand({ harness: 'hermes', session: root.id, lane, at: calledAt })
          }
        }
        sendLine(root, {
          hermes: 'call',
          id,
          name: call.name,
          args: call.args,
          ...(info.parentId === '' ? {} : { agent: info.id, agentName: info.name }),
        }, at)
        info.open.add(id)
      })
      return
    }
    if (row.role !== 'tool') return
    const id = textOf(row.tool_call_id)
    if (id === '') return
    const failed = textOf(row.tool_name) === 'terminal' && looksFailed(row.content)
    sendLine(root, { hermes: 'result', id, ok: !failed }, at)
    info.open.delete(id)
  }

  function readSession(info) {
    for (;;) {
      const rows = rowStmt.all(info.id, info.lastId)
      for (const row of rows) {
        if (Number.isFinite(row.id)) info.lastId = row.id
        info.lastGrowth = now()
        if (info.root.run?.open) info.root.run.lastGrowth = info.lastGrowth
        handleRow(info, row)
      }
      if (rows.length < READ_LIMIT) break
    }
  }

  function endRuns() {
    const at = now()
    const activeChildRoots = new Set()
    for (const info of sessions.values()) {
      if (info === info.root) continue
      if (info.open.size || (info.lastGrowth !== null && at - info.lastGrowth < quietMs)) activeChildRoots.add(info.root)
    }
    for (const info of sessions.values()) {
      if (info.parentId !== '') continue
      const run = info.run
      if (!run?.open || activeChildRoots.has(info)) continue
      if (info.endedAt > 0 && info.open.size === 0) {
        endRun(info, 'succeeded')
        continue
      }
      if (at - run.lastGrowth >= (info.open.size > 0 ? OPEN_CALL_QUIET_MS : quietMs)) endRun(info, 'succeeded')
    }
  }

  function tick() {
    if (stopped) return
    if (!openDatabase()) return
    try {
      prepare()
      if (!sessionStmt) return
      const skipped = skippedSessions()
      follow(sessionStmt.all(), skipped)
      const ordered = [...sessions.values()].sort((one, two) => (one.id < two.id ? -1 : one.id > two.id ? 1 : 0))
      for (const info of ordered) readSession(info)
      endRuns()
      lastError = ''
    } catch {
      lastError = 'The Hermes sessions tables could not be read.'
    }
  }

  function stop() {
    stopped = true
    sessions.clear()
    metaFiles.clear()
    skippedIds.clear()
    metaFolderStamp = null
    if (db) {
      try {
        db.close()
      } catch {}
      db = null
    }
    sessionStmt = null
    rowStmt = null
  }

  if (!existsSync(dbPath)) startupId = 0
  if (openDatabase()) {
    try {
      prepare()
    } catch {
      lastError = 'The Hermes sessions tables could not be read.'
    }
  }

  return {
    agent: { ...HERMES_SESSION_AGENT },
    agents: [{ ...HERMES_SESSION_AGENT }],
    tick,
    stop,
    projectRoot,
    dbPath,
    sessions: () => sessions,
    metaFiles: () => metaFiles,
    open: () => new Map([...sessions.values()].filter((info) => info.root?.run?.open).map((info) => [info.root.id, info.root.run])),
    problem: () => lastError,
  }
}
