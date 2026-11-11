import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createOpencodeSessionsReader, OPENCODE_SESSION_AGENT } from '../server/opencode-sessions.js'
import { createOpencodeParser } from '../src/model/parsers/opencode.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    try {
      cleanups.pop()()
    } catch {}
  }
})

function tempDir(prefix = 'mr-opencode-sessions-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function withDb(path, fn) {
  const db = new DatabaseSync(path)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

function createTables(db) {
  db.exec(
    'CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, title TEXT, time_updated INTEGER)'
  )
  db.exec(
    'CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, time_updated INTEGER, data TEXT)'
  )
}

function makeDatabase() {
  const dir = tempDir()
  const dbPath = join(dir, 'opencode.db')
  withDb(dbPath, createTables)
  return { dir, dbPath }
}

function addSession(dbPath, { id, parent = null, directory, title = 'Work', time = 1000 }) {
  withDb(dbPath, (db) => {
    db.prepare('INSERT INTO session_v2 (id, parent_id, directory, title, time_updated) VALUES (?, ?, ?, ?, ?)').run(
      id,
      parent,
      directory,
      title,
      time
    )
  })
}

function addMessage(dbPath, { id, sessionId, type, seq, data = {}, time }) {
  withDb(dbPath, (db) => {
    db.prepare(
      'INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, sessionId, type, seq, time, time, JSON.stringify(data))
  })
}

function updateMessage(dbPath, id, time, data) {
  withDb(dbPath, (db) => {
    db.prepare('UPDATE session_message SET time_updated = ?, data = ? WHERE id = ?').run(time, JSON.stringify(data), id)
  })
}

function startReader({ dbPath, projectRoot, runsFolder, quietMs = 30000, retentionMs, clock = { value: 5000 }, idleSessionPollMs = 0, sessionPollMs = 0 }) {
  const frames = []
  const queries = []
  const reader = createOpencodeSessionsReader({
    projectRoot,
    runsFolder,
    dbPath,
    quietMs,
    retentionMs,
    idleSessionPollMs,
    sessionPollMs,
    now: () => clock.value,
    emit: (frame) => frames.push(frame),
    onQuery: (entry) => queries.push(entry),
  })
  cleanups.push(() => reader.stop())
  return { reader, frames, clock, queries }
}

function toolItem({ id, name, status = 'completed', input = {}, text = '', content }) {
  return {
    type: 'tool',
    id,
    name,
    state: {
      status,
      input,
      content: content ?? (text ? [{ type: 'text', text }] : []),
      metadata: {},
    },
  }
}

function logFrames(frames) {
  return frames.filter((frame) => frame.type === 'heartbeat.run.log')
}

function statusFrames(frames) {
  return frames.filter((frame) => frame.type === 'heartbeat.run.status')
}

function endFrame(frames) {
  return statusFrames(frames).find((frame) => frame.payload.status === 'succeeded' || frame.payload.status === 'failed')
}

function chunkOf(frame) {
  return JSON.parse(frame.payload.chunk)
}

describe('the OpenCode session reader', () => {
  it('forgets a finished session after an hour without replaying it, and still reads what comes later', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const clock = { value: 5000 }
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder: join(dir, 'runs'), clock })
    reader.tick()
    addSession(dbPath, { id: 'ses-1', directory: projectRoot })
    addMessage(dbPath, { id: 'm-user', sessionId: 'ses-1', type: 'user', seq: 1, time: 2000 })
    addMessage(dbPath, {
      id: 'm-assistant',
      sessionId: 'ses-1',
      type: 'assistant',
      seq: 2,
      time: 2001,
      data: { content: [toolItem({ id: 'call-1', name: 'read', input: { filePath: 'a.txt' } })] },
    })
    addMessage(dbPath, { id: 'm-idle', sessionId: 'ses-1', type: 'idle', seq: 3, time: 2002, data: { outcome: 'succeeded' } })
    reader.tick()
    const before = frames.length
    expect(logFrames(frames)).toHaveLength(1)

    clock.value += 60 * 60 * 1000
    reader.tick()
    expect(reader.sessions().has('ses-1')).toBe(false)
    expect(reader.forgotten().has('ses-1')).toBe(true)
    reader.tick()
    expect(frames).toHaveLength(before)
    expect(reader.sessions().has('ses-1')).toBe(false)

    addMessage(dbPath, { id: 'm-user-2', sessionId: 'ses-1', type: 'user', seq: 4, time: 9000 })
    withDb(dbPath, (db) => {
      db.prepare('UPDATE session_v2 SET time_updated = ? WHERE id = ?').run(9000, 'ses-1')
    })
    clock.value += 10000
    reader.tick()
    expect(frames.length).toBeGreaterThan(before)
    expect(frames[before].payload.runId).toBe('ses-1:4')
    expect(reader.sessions().has('ses-1')).toBe(true)
    expect(reader.forgotten().has('ses-1')).toBe(false)
  })

  it('caps the forgotten map at 200 entries and reads a dropped session reopened later (S39)', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const clock = { value: 5000 }
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder: join(dir, 'runs'), clock })
    reader.tick()

    withDb(dbPath, (db) => {
      const sessStmt = db.prepare('INSERT INTO session_v2 (id, parent_id, directory, title, time_updated) VALUES (?, ?, ?, ?, ?)')
      const msgStmt = db.prepare('INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
      db.exec('BEGIN')
      for (let i = 1; i <= 201; i++) {
        const id = `ses-${i}`
        sessStmt.run(id, null, projectRoot, 'Work', 2000 + i)
        msgStmt.run(`m-user-${i}`, id, 'user', 1, 2000 + i, 2000 + i, '{}')
        msgStmt.run(`m-idle-${i}`, id, 'idle', 2, 2000 + i, 2000 + i, JSON.stringify({ outcome: 'succeeded' }))
      }
      db.exec('COMMIT')
    })
    reader.tick()
    expect(reader.sessions().size).toBe(201)

    clock.value += 60 * 60 * 1000
    reader.tick()

    expect(reader.sessions().size).toBe(0)
    expect(reader.forgotten().size).toBe(200)
    expect(reader.forgotten().has('ses-1')).toBe(false)
    expect(reader.forgotten().has('ses-2')).toBe(true)
    expect(reader.forgotten().has('ses-201')).toBe(true)

    const before = frames.length
    addMessage(dbPath, { id: 'm-user-reopened', sessionId: 'ses-1', type: 'user', seq: 3, time: 9000 })
    addMessage(dbPath, {
      id: 'm-assistant-reopened',
      sessionId: 'ses-1',
      type: 'assistant',
      seq: 4,
      time: 9001,
      data: { content: [toolItem({ id: 'call-reopen', name: 'read', input: { filePath: 'x.txt' } })] },
    })
    withDb(dbPath, (db) => {
      db.prepare('UPDATE session_v2 SET time_updated = ? WHERE id = ?').run(9001, 'ses-1')
    })
    clock.value += 10000
    reader.tick()

    expect(frames.length).toBeGreaterThan(before)
    expect(reader.sessions().has('ses-1')).toBe(true)
    expect(reader.forgotten().has('ses-1')).toBe(false)
    const logs = logFrames(frames)
    expect(logs.some((f) => chunkOf(f).part?.id === 'call-reopen')).toBe(true)
    expect(statusFrames(frames).at(-1).payload.runId).toBe('ses-1:3')
  })

  it('reads a turn with a read and an edit, then ends it on idle', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const runsFolder = join(dir, 'runs')
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder })
    expect(reader.agent).toEqual(OPENCODE_SESSION_AGENT)

    reader.tick()
    expect(frames).toEqual([])

    addSession(dbPath, { id: 'ses-1', directory: projectRoot })
    addMessage(dbPath, { id: 'm-user', sessionId: 'ses-1', type: 'user', seq: 1, time: 2000 })
    addMessage(dbPath, {
      id: 'm-assistant',
      sessionId: 'ses-1',
      type: 'assistant',
      seq: 2,
      time: 2001,
      data: {
        content: [
          toolItem({ id: 'call-read', name: 'read', input: { path: 'src/a.js' }, text: 'read ok' }),
          toolItem({ id: 'call-edit', name: 'edit', input: { path: 'src/b.js' }, text: 'edited' }),
        ],
      },
    })
    reader.tick()

    expect(frames.map((frame) => frame.type)).toEqual([
      'heartbeat.run.queued',
      'heartbeat.run.status',
      'heartbeat.run.log',
      'heartbeat.run.log',
    ])
    expect(statusFrames(frames)[0].payload).toMatchObject({
      runId: 'ses-1:1',
      agentId: 'agent-opencode-session',
      status: 'running',
      error: null,
    })
    const logs = logFrames(frames)
    expect(logs.map((frame) => frame.payload.runId)).toEqual(['ses-1:1', 'ses-1:1'])
    expect(logs.map((frame) => frame.payload.seq)).toEqual([1, 2])
    expect(chunkOf(logs[0])).toMatchObject({
      type: 'tool_use',
      sessionID: 'ses-1',
      part: {
        id: 'call-read',
        tool: 'read',
        state: { status: 'completed', input: { path: 'src/a.js' }, output: 'read ok' },
      },
    })
    expect(chunkOf(logs[1]).part).toMatchObject({
      id: 'call-edit',
      tool: 'edit',
      state: { input: { path: 'src/b.js' }, output: 'edited' },
    })

    addMessage(dbPath, { id: 'm-idle', sessionId: 'ses-1', type: 'idle', seq: 3, time: 2002, data: { outcome: 'succeeded' } })
    reader.tick()
    expect(endFrame(frames).payload).toMatchObject({ runId: 'ses-1:1', status: 'succeeded', error: null })
  })

  it('sends an item once when its row updates across ticks', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder: join(dir, 'runs') })

    reader.tick()
    addSession(dbPath, { id: 'ses-1', directory: projectRoot })
    addMessage(dbPath, { id: 'm-user', sessionId: 'ses-1', type: 'user', seq: 1, time: 2000 })
    reader.tick()
    expect(frames.map((frame) => frame.type)).toEqual(['heartbeat.run.queued', 'heartbeat.run.status'])

    const streaming = {
      content: [toolItem({ id: 'call-read', name: 'read', status: 'running', input: { path: 'src/a.js' } })],
    }
    addMessage(dbPath, {
      id: 'm-assistant',
      sessionId: 'ses-1',
      type: 'assistant',
      seq: 2,
      time: 2001,
      data: streaming,
    })
    reader.tick()
    expect(logFrames(frames)).toEqual([])

    updateMessage(dbPath, 'm-assistant', 2002, {
      content: [toolItem({ id: 'call-read', name: 'read', input: { path: 'src/a.js' }, text: 'read ok' })],
    })
    reader.tick()
    expect(logFrames(frames).map((frame) => chunkOf(frame).part.id)).toEqual(['call-read'])

    updateMessage(dbPath, 'm-assistant', 2003, {
      content: [
        toolItem({ id: 'call-read', name: 'read', input: { path: 'src/a.js' }, text: 'read ok' }),
        toolItem({ id: 'call-edit', name: 'edit', input: { path: 'src/b.js' }, text: 'edited' }),
      ],
    })
    reader.tick()
    expect(logFrames(frames).map((frame) => chunkOf(frame).part.id)).toEqual(['call-read', 'call-edit'])

    updateMessage(dbPath, 'm-assistant', 2004, {
      content: [
        toolItem({ id: 'call-read', name: 'read', input: { path: 'src/a.js' }, text: 'read ok' }),
        toolItem({ id: 'call-edit', name: 'edit', input: { path: 'src/b.js' }, text: 'edited' }),
      ],
    })
    reader.tick()
    expect(logFrames(frames).map((frame) => chunkOf(frame).part.id)).toEqual(['call-read', 'call-edit'])
  })

  it('sends an error item and the parser reads it as a failed call', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder: join(dir, 'runs') })

    reader.tick()
    addSession(dbPath, { id: 'ses-1', directory: projectRoot })
    addMessage(dbPath, { id: 'm-user', sessionId: 'ses-1', type: 'user', seq: 1, time: 2000 })
    addMessage(dbPath, {
      id: 'm-assistant',
      sessionId: 'ses-1',
      type: 'assistant',
      seq: 2,
      time: 2001,
      data: {
        content: [
          toolItem({ id: 'call-read', name: 'read', status: 'error', input: { path: 'src/a.js' }, text: 'boom' }),
        ],
      },
    })
    reader.tick()

    const [log] = logFrames(frames)
    expect(chunkOf(log).part.state).toMatchObject({ status: 'error', input: { path: 'src/a.js' }, output: 'boom' })
    const parser = createOpencodeParser({ rootName: 'project', files: [], dirs: [] })
    const activities = parser.push(log.payload.chunk, 0)
    expect(activities).toContainEqual(expect.objectContaining({ type: 'tool.end', ok: false }))
  })

  it('puts a child session tool into the parent session run', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder: join(dir, 'runs') })

    reader.tick()
    addSession(dbPath, { id: 'ses-root', directory: projectRoot })
    addSession(dbPath, { id: 'ses-child', parent: 'ses-root', directory: projectRoot, title: 'Explore' })
    addMessage(dbPath, { id: 'm-user', sessionId: 'ses-root', type: 'user', seq: 1, time: 2000 })
    reader.tick()
    expect(statusFrames(frames)[0].payload.runId).toBe('ses-root:1')

    addMessage(dbPath, {
      id: 'm-child',
      sessionId: 'ses-child',
      type: 'assistant',
      seq: 7,
      time: 2001,
      data: {
        content: [toolItem({ id: 'call-child-read', name: 'read', input: { path: 'src/a.js' }, text: 'child read' })],
      },
    })
    reader.tick()

    const [log] = logFrames(frames)
    expect(log.payload.runId).toBe('ses-root:1')
    expect(chunkOf(log).sessionID).toBe('ses-child')
    expect(chunkOf(log).part.id).toBe('call-child-read')
    expect(statusFrames(frames)).toHaveLength(1)
  })

  it('sees a child session written in the same millisecond as the highest row it saw', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const { reader, frames, queries } = startReader({ dbPath, projectRoot, runsFolder: join(dir, 'runs') })

    reader.tick()
    addSession(dbPath, { id: 'ses-root', directory: projectRoot, time: 1000 })
    addMessage(dbPath, { id: 'm-user', sessionId: 'ses-root', type: 'user', seq: 1, time: 1000 })
    reader.tick()
    expect(statusFrames(frames)[0].payload.runId).toBe('ses-root:1')

    addSession(dbPath, { id: 'ses-child', parent: 'ses-root', directory: projectRoot, title: 'Explore', time: 1000 })
    addMessage(dbPath, {
      id: 'm-child',
      sessionId: 'ses-child',
      type: 'assistant',
      seq: 1,
      time: 1001,
      data: { content: [toolItem({ id: 'call-child', name: 'read', input: { path: 'src/a.js' } })] },
    })
    reader.tick()

    expect(queries.at(-1)).toMatchObject({ rows: 2, since: 1000 })
    const logs = logFrames(frames)
    expect(logs).toHaveLength(1)
    expect(chunkOf(logs[0]).sessionID).toBe('ses-child')
    expect(chunkOf(logs[0]).part.id).toBe('call-child')
  })

  it('skips a session whose title names a run-lane log', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const runsFolder = join(dir, 'runs')
    mkdirSync(runsFolder, { recursive: true })
    writeFileSync(join(runsFolder, 'opencode-T2-20261024-120000.log'), '')
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder })

    reader.tick()
    addSession(dbPath, { id: 'ses-run', directory: projectRoot, title: 'opencode-T2-20261024-120000' })
    addSession(dbPath, { id: 'ses-child', parent: 'ses-run', directory: projectRoot, title: 'Explore' })
    addMessage(dbPath, { id: 'm-user', sessionId: 'ses-run', type: 'user', seq: 1, time: 2000 })
    addMessage(dbPath, {
      id: 'm-assistant',
      sessionId: 'ses-run',
      type: 'assistant',
      seq: 2,
      time: 2001,
      data: { content: [toolItem({ id: 'call-read', name: 'read', input: { path: 'src/a.js' } })] },
    })
    addMessage(dbPath, {
      id: 'm-child',
      sessionId: 'ses-child',
      type: 'assistant',
      seq: 1,
      time: 2002,
      data: { content: [toolItem({ id: 'call-child', name: 'read', input: { path: 'src/b.js' } })] },
    })
    reader.tick()

    expect(frames).toEqual([])
  })

  it('ignores a session in another folder', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder: join(dir, 'runs') })

    reader.tick()
    addSession(dbPath, { id: 'ses-other', directory: join(dir, 'other') })
    addMessage(dbPath, { id: 'm-user', sessionId: 'ses-other', type: 'user', seq: 1, time: 2000 })
    addMessage(dbPath, {
      id: 'm-assistant',
      sessionId: 'ses-other',
      type: 'assistant',
      seq: 2,
      time: 2001,
      data: { content: [toolItem({ id: 'call-read', name: 'read', input: { path: 'src/a.js' } })] },
    })
    reader.tick()

    expect(frames).toEqual([])
  })

  it('does not replay an existing session', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    addSession(dbPath, { id: 'ses-1', directory: projectRoot })
    addMessage(dbPath, { id: 'm-user', sessionId: 'ses-1', type: 'user', seq: 1, time: 2000 })
    addMessage(dbPath, {
      id: 'm-assistant',
      sessionId: 'ses-1',
      type: 'assistant',
      seq: 2,
      time: 2001,
      data: { content: [toolItem({ id: 'call-old', name: 'read', input: { path: 'src/a.js' } })] },
    })
    addMessage(dbPath, { id: 'm-idle', sessionId: 'ses-1', type: 'idle', seq: 3, time: 2002, data: { outcome: 'succeeded' } })
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder: join(dir, 'runs') })

    reader.tick()
    expect(frames).toEqual([])

    addMessage(dbPath, { id: 'm-user-2', sessionId: 'ses-1', type: 'user', seq: 4, time: 3000 })
    reader.tick()
    expect(frames.map((frame) => frame.type)).toEqual(['heartbeat.run.queued', 'heartbeat.run.status'])
    expect(statusFrames(frames)[0].payload.runId).toBe('ses-1:4')
  })

  it('sends nothing and does not throw when there is no database', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'missing', 'opencode.db')
    const { reader, frames } = startReader({ dbPath, projectRoot: join(dir, 'project'), runsFolder: join(dir, 'runs') })

    expect(() => reader.tick()).not.toThrow()
    expect(frames).toEqual([])
    expect(existsSync(dbPath)).toBe(false)
  })

  it('keeps the last tick error and clears it after a good tick', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'opencode.db')
    withDb(dbPath, (db) => db.exec('CREATE TABLE wrong (id TEXT)'))
    const { reader } = startReader({ dbPath, projectRoot: dir, runsFolder: join(dir, 'runs') })

    reader.tick()
    expect(reader.problem()).toContain('no such table: session_v2')

    withDb(dbPath, createTables)
    reader.tick()
    expect(reader.problem()).toBe('')
  })

  it('reads the database under XDG_DATA_HOME when dbPath is not given', () => {
    const base = tempDir()
    const xdg = join(base, 'xdg')
    const dbPath = join(xdg, 'opencode', 'opencode.db')
    mkdirSync(join(xdg, 'opencode'), { recursive: true })
    withDb(dbPath, createTables)
    const projectRoot = join(base, 'project')
    const saved = process.env.XDG_DATA_HOME
    process.env.XDG_DATA_HOME = xdg
    try {
      const frames = []
      const reader = createOpencodeSessionsReader({
        projectRoot,
        runsFolder: join(base, 'runs'),
        idleSessionPollMs: 0,
        now: () => 5000,
        emit: (frame) => frames.push(frame),
      })
      cleanups.push(() => reader.stop())
      reader.tick()
      addSession(dbPath, { id: 'ses-1', directory: projectRoot })
      addMessage(dbPath, { id: 'm-user', sessionId: 'ses-1', type: 'user', seq: 1, time: 2000 })
      reader.tick()
      expect(frames.map((frame) => frame.type)).toEqual(['heartbeat.run.queued', 'heartbeat.run.status'])
    } finally {
      if (saved === undefined) delete process.env.XDG_DATA_HOME
      else process.env.XDG_DATA_HOME = saved
    }
  })

  it('ends a run after quietMs with no new rows', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const clock = { value: 10000 }
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder: join(dir, 'runs'), quietMs: 30000, clock })

    reader.tick()
    addSession(dbPath, { id: 'ses-1', directory: projectRoot })
    addMessage(dbPath, { id: 'm-user', sessionId: 'ses-1', type: 'user', seq: 1, time: 2000 })
    reader.tick()
    expect(endFrame(frames)).toBeUndefined()

    clock.value += 30000
    reader.tick()
    expect(endFrame(frames).payload).toMatchObject({ runId: 'ses-1:1', status: 'succeeded', error: null })
  })

  it('ends a run failed when idle reports another outcome', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder: join(dir, 'runs') })

    reader.tick()
    addSession(dbPath, { id: 'ses-1', directory: projectRoot })
    addMessage(dbPath, { id: 'm-user', sessionId: 'ses-1', type: 'user', seq: 1, time: 2000 })
    reader.tick()
    addMessage(dbPath, { id: 'm-idle', sessionId: 'ses-1', type: 'idle', seq: 2, time: 2001, data: { outcome: 'cancelled' } })
    reader.tick()

    expect(endFrame(frames).payload).toMatchObject({ runId: 'ses-1:1', status: 'failed', error: 'cancelled' })
  })

  it.runIf(process.platform === 'win32')('matches the project folder ignoring case on Windows', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'Project')
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder: join(dir, 'runs') })

    reader.tick()
    addSession(dbPath, { id: 'ses-1', directory: projectRoot.toUpperCase() })
    addMessage(dbPath, { id: 'm-user', sessionId: 'ses-1', type: 'user', seq: 1, time: 2000 })
    reader.tick()

    expect(statusFrames(frames)[0].payload.runId).toBe('ses-1:1')
  })

  it('stops reading after stop', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder: join(dir, 'runs') })

    reader.tick()
    addSession(dbPath, { id: 'ses-1', directory: projectRoot })
    addMessage(dbPath, { id: 'm-user', sessionId: 'ses-1', type: 'user', seq: 1, time: 2000 })
    reader.tick()
    const count = frames.length

    reader.stop()
    addMessage(dbPath, {
      id: 'm-assistant',
      sessionId: 'ses-1',
      type: 'assistant',
      seq: 2,
      time: 2001,
      data: { content: [toolItem({ id: 'call-read', name: 'read', input: { path: 'src/a.js' } })] },
    })
    reader.tick()

    expect(frames).toHaveLength(count)
  })

  it('queries a quiet session less often than an active one', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const clock = { value: 1000 }
    const { reader, frames } = startReader({
      dbPath,
      projectRoot,
      runsFolder: join(dir, 'runs'),
      clock,
      quietMs: 2000,
      quietPollMs: 10000,
    })

    reader.tick()
    addSession(dbPath, { id: 'ses-1', directory: projectRoot, time: 1000 })
    addMessage(dbPath, { id: 'm-user-1', sessionId: 'ses-1', type: 'user', seq: 1, time: 1000 })
    addMessage(dbPath, { id: 'm-idle-1', sessionId: 'ses-1', type: 'idle', seq: 2, time: 1001, data: { outcome: 'succeeded' } })
    reader.tick()

    clock.value += 3000
    reader.tick()
    const countAfterQuiet = frames.length

    addMessage(dbPath, { id: 'm-user-2', sessionId: 'ses-1', type: 'user', seq: 3, time: 4000 })
    clock.value += 1000
    reader.tick()
    expect(frames).toHaveLength(countAfterQuiet)

    clock.value += 10000
    reader.tick()
    expect(frames.length).toBeGreaterThan(countAfterQuiet)
  })

  it('queries a quiet session immediately when its time_updated moves', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const clock = { value: 1000 }
    const { reader, frames } = startReader({
      dbPath,
      projectRoot,
      runsFolder: join(dir, 'runs'),
      clock,
      quietMs: 2000,
      quietPollMs: 10000,
    })

    reader.tick()
    addSession(dbPath, { id: 'ses-1', directory: projectRoot, time: 1000 })
    addMessage(dbPath, { id: 'm-user-1', sessionId: 'ses-1', type: 'user', seq: 1, time: 1000 })
    addMessage(dbPath, { id: 'm-idle-1', sessionId: 'ses-1', type: 'idle', seq: 2, time: 1001, data: { outcome: 'succeeded' } })
    reader.tick()

    clock.value += 3000
    reader.tick()
    const countAfterQuiet = frames.length

    addMessage(dbPath, { id: 'm-user-2', sessionId: 'ses-1', type: 'user', seq: 3, time: 4000 })
    withDb(dbPath, (db) => {
      db.prepare('UPDATE session_v2 SET time_updated = ? WHERE id = ?').run(4000, 'ses-1')
    })
    clock.value += 1000
    reader.tick()
    expect(frames.length).toBeGreaterThan(countAfterQuiet)
  })

  it('drops a session that forgetFinished forgets from the scan and finds it again when reopened', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const clock = { value: 1000 }
    const { reader, frames } = startReader({
      dbPath,
      projectRoot,
      runsFolder: join(dir, 'runs'),
      clock,
      quietMs: 1000,
      retentionMs: 5000,
    })

    reader.tick()
    addSession(dbPath, { id: 'ses-drop', directory: projectRoot, time: 1000 })
    addMessage(dbPath, { id: 'm-1', sessionId: 'ses-drop', type: 'user', seq: 1, time: 1000 })
    addMessage(dbPath, { id: 'm-2', sessionId: 'ses-drop', type: 'idle', seq: 2, time: 1001, data: { outcome: 'succeeded' } })
    reader.tick()
    expect(reader.sessions().has('ses-drop')).toBe(true)

    clock.value += 6000
    reader.tick()
    expect(reader.sessions().has('ses-drop')).toBe(false)
    expect(reader.forgotten().has('ses-drop')).toBe(true)

    reader.tick()
    expect(reader.sessions().has('ses-drop')).toBe(false)

    const before = frames.length
    addMessage(dbPath, { id: 'm-3', sessionId: 'ses-drop', type: 'user', seq: 3, time: 8000 })
    withDb(dbPath, (db) => {
      db.prepare('UPDATE session_v2 SET time_updated = ? WHERE id = ?').run(8000, 'ses-drop')
    })
    clock.value += 1000
    reader.tick()

    expect(reader.sessions().has('ses-drop')).toBe(true)
    expect(reader.forgotten().has('ses-drop')).toBe(false)
    expect(frames.length).toBeGreaterThan(before)
    expect(frames[before].payload.runId).toBe('ses-drop:3')
  })

  it('asks session_v2 only for rows past the highest update time', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const clock = { value: 5000 }
    const { reader, frames, queries } = startReader({
      dbPath,
      projectRoot,
      runsFolder: join(dir, 'runs'),
      clock,
      idleSessionPollMs: 5000,
    })
    addSession(dbPath, { id: 'ses-1', directory: projectRoot, time: 1000 })
    addMessage(dbPath, { id: 'm-user-1', sessionId: 'ses-1', type: 'user', seq: 1, time: 1000 })

    reader.tick()
    expect(queries).toHaveLength(1)
    expect(queries[0]).toMatchObject({ rows: 1, since: null })
    expect(frames).toEqual([])

    clock.value += 5000
    reader.tick()
    expect(queries.at(-1)).toMatchObject({ rows: 1, since: 1000 })

    const before = frames.length
    addMessage(dbPath, { id: 'm-user-2', sessionId: 'ses-1', type: 'user', seq: 2, time: 9000 })
    withDb(dbPath, (db) => {
      db.prepare('UPDATE session_v2 SET time_updated = ? WHERE id = ?').run(9000, 'ses-1')
    })
    clock.value += 5000
    reader.tick()

    expect(queries.at(-1)).toMatchObject({ rows: 1, since: 1000 })
    expect(frames.length).toBeGreaterThan(before)
    expect(frames[before].payload.runId).toBe('ses-1:2')
  })

  it('asks every 5 seconds while no run is open and every second while one is', () => {
    const { dir, dbPath } = makeDatabase()
    const projectRoot = join(dir, 'project')
    const clock = { value: 1000 }
    const { reader, queries } = startReader({
      dbPath,
      projectRoot,
      runsFolder: join(dir, 'runs'),
      clock,
      idleSessionPollMs: 5000,
      sessionPollMs: 1000,
    })
    addSession(dbPath, { id: 'ses-1', directory: projectRoot, time: 1000 })
    addMessage(dbPath, { id: 'm-user-1', sessionId: 'ses-1', type: 'user', seq: 1, time: 1000 })
    reader.tick()
    const afterPrime = queries.length

    for (let index = 0; index < 4; index += 1) {
      clock.value += 1000
      reader.tick()
    }
    expect(queries).toHaveLength(afterPrime)

    clock.value += 1000
    reader.tick()
    expect(queries).toHaveLength(afterPrime + 1)

    addMessage(dbPath, { id: 'm-user-2', sessionId: 'ses-1', type: 'user', seq: 2, time: 11000 })
    withDb(dbPath, (db) => {
      db.prepare('UPDATE session_v2 SET time_updated = ? WHERE id = ?').run(11000, 'ses-1')
    })
    clock.value = 11000
    reader.tick()
    const afterOpen = queries.length
    expect(afterOpen).toBe(afterPrime + 2)

    for (let index = 0; index < 3; index += 1) {
      clock.value += 1000
      reader.tick()
    }
    expect(queries).toHaveLength(afterOpen + 3)
  })

  it('leaves the full query and says so when session_v2 has no time_updated column', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'opencode.db')
    withDb(dbPath, (db) => {
      db.exec('CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, title TEXT)')
      db.exec(
        'CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, time_updated INTEGER, data TEXT)'
      )
    })
    const projectRoot = join(dir, 'project')
    const clock = { value: 5000 }
    const { reader, queries } = startReader({
      dbPath,
      projectRoot,
      runsFolder: join(dir, 'runs'),
      clock,
      idleSessionPollMs: 5000,
    })

    reader.tick()
    expect(reader.note()).toContain('time_updated')
    expect(queries[0]).toMatchObject({ rows: 0, since: null })

    clock.value += 5000
    reader.tick()
    expect(queries).toHaveLength(2)
    expect(queries[1]).toMatchObject({ rows: 0, since: null })
  })
})
