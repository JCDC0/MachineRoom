import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createHermesSessionsReader, HERMES_SESSION_AGENT, hermesHome } from '../server/hermes-sessions.js'
import { createHermesParser } from '../src/model/parsers/hermes.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    try {
      cleanups.pop()()
    } catch {}
  }
})

function tempDir(prefix = 'mr-hermes-sessions-') {
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

function setup() {
  const dir = tempDir()
  const projectRoot = join(dir, 'project')
  const home = join(dir, 'home')
  const runsFolder = join(dir, 'runs')
  mkdirSync(projectRoot, { recursive: true })
  mkdirSync(home, { recursive: true })
  mkdirSync(runsFolder, { recursive: true })
  const dbPath = join(home, 'state.db')
  withDb(dbPath, (db) => {
    db.exec(
      'CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, model TEXT, parent_session_id TEXT, started_at TEXT, ended_at TEXT, cwd TEXT, git_repo_root TEXT, last_activity_at TEXT, title TEXT)'
    )
    db.exec(
      'CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT, tool_call_id TEXT, tool_name TEXT, timestamp INTEGER)'
    )
  })
  return { dir, projectRoot, home, runsFolder, dbPath }
}

function addSession(dbPath, { id, cwd = '', parent = null, source = 'cli', startedAt = 6000, endedAt = null, lastActivity = null, title = '' }) {
  withDb(dbPath, (db) => {
    db.prepare(
      'INSERT INTO sessions (id, source, model, parent_session_id, started_at, ended_at, cwd, git_repo_root, last_activity_at, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id,
      source,
      'deepseek-v4.1-flash',
      parent,
      new Date(startedAt).toISOString(),
      endedAt === null ? null : new Date(endedAt).toISOString(),
      cwd,
      '',
      lastActivity === null ? null : new Date(lastActivity).toISOString(),
      title
    )
  })
}

function addMessage(dbPath, { sessionId, role, content = '', calls = null, toolCallId = null, toolName = null, timestamp = 6000 }) {
  withDb(dbPath, (db) => {
    db.prepare(
      'INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, tool_name, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(sessionId, role, content, calls === null ? null : JSON.stringify(calls), toolCallId, toolName, timestamp)
  })
}

function call(name, args, id) {
  return { id, function: { name, arguments: JSON.stringify(args) } }
}

function touchSession(dbPath, id, at, endedAt = null) {
  withDb(dbPath, (db) => {
    db.prepare('UPDATE sessions SET last_activity_at = ?, ended_at = ? WHERE id = ?').run(
      new Date(at).toISOString(),
      endedAt === null ? null : new Date(endedAt).toISOString(),
      id
    )
  })
}

function startReader({ dbPath, projectRoot, runsFolder, clock = { value: 5000 }, quietMs = 30000 }) {
  const frames = []
  const reader = createHermesSessionsReader({
    projectRoot,
    runsFolder,
    dbPath,
    quietMs,
    now: () => clock.value,
    emit: (frame) => frames.push(frame),
  })
  cleanups.push(() => reader.stop())
  return { reader, frames, clock }
}

function logFrames(frames) {
  return frames.filter((frame) => frame.type === 'heartbeat.run.log')
}

function lines(frames) {
  return logFrames(frames).map((frame) => JSON.parse(frame.payload.chunk))
}

function statusFrames(frames) {
  return frames.filter((frame) => frame.type === 'heartbeat.run.status')
}

function endFrame(frames) {
  return statusFrames(frames).find((frame) => frame.payload.status === 'succeeded' || frame.payload.status === 'failed')
}

describe('the Hermes session reader', () => {
  it('follows a session in the project and sends its calls and results', () => {
    const { projectRoot, runsFolder, dbPath } = setup()
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder })
    reader.tick()

    addSession(dbPath, { id: 'ses-1', cwd: projectRoot })
    addMessage(dbPath, { sessionId: 'ses-1', role: 'user', content: 'Go.', timestamp: 6000 })
    addMessage(dbPath, { sessionId: 'ses-1', role: 'assistant', calls: [call('read_file', { path: 'src/math.js' }, 'c1')], timestamp: 6001 })
    addMessage(dbPath, { sessionId: 'ses-1', role: 'tool', content: 'export const x = 1', toolCallId: 'c1', toolName: 'read_file', timestamp: 6002 })
    reader.tick()

    const sent = lines(frames)
    expect(sent).toEqual([
      { hermes: 'call', id: 'c1', name: 'read_file', args: { path: 'src/math.js' } },
      { hermes: 'result', id: 'c1', ok: true },
    ])
    expect(statusFrames(frames)[0].payload.status).toBe('running')
    expect(statusFrames(frames)[0].payload.runId).toMatch(/^ses-1:[0-9a-f]{8}:1$/)
  })

  it('reads only the rows above the last one seen', () => {
    const { projectRoot, runsFolder, dbPath } = setup()
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder })

    addSession(dbPath, { id: 'ses-1', cwd: projectRoot, startedAt: 4000, lastActivity: 7000 })
    addMessage(dbPath, { sessionId: 'ses-1', role: 'assistant', calls: [call('read_file', { path: 'old.js' }, 'old')], timestamp: 4000 })
    reader.tick()
    expect(lines(frames)).toEqual([])

    addMessage(dbPath, { sessionId: 'ses-1', role: 'assistant', calls: [call('read_file', { path: 'new.js' }, 'new')], timestamp: 7100 })
    reader.tick()
    expect(lines(frames)).toEqual([{ hermes: 'call', id: 'new', name: 'read_file', args: { path: 'new.js' } }])
  })

  it('shows nothing for a session outside the project', () => {
    const { dir, projectRoot, runsFolder, dbPath } = setup()
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder })
    reader.tick()

    addSession(dbPath, { id: 'ses-other', cwd: join(dir, 'elsewhere') })
    addMessage(dbPath, { sessionId: 'ses-other', role: 'assistant', calls: [call('read_file', { path: 'src/math.js' }, 'c1')], timestamp: 6001 })
    reader.tick()

    expect(frames).toEqual([])
    expect(reader.sessions().size).toBe(0)
  })

  it('follows a session whose git repo root is inside the project', () => {
    const { projectRoot, runsFolder, dbPath } = setup()
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder })
    reader.tick()

    withDb(dbPath, (db) => {
      db.prepare(
        'INSERT INTO sessions (id, source, model, parent_session_id, started_at, ended_at, cwd, git_repo_root, last_activity_at, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('ses-git', 'cli', 'm', null, new Date(6000).toISOString(), null, '', join(projectRoot, 'src'), null, '')
    })
    addMessage(dbPath, { sessionId: 'ses-git', role: 'assistant', calls: [call('read_file', { path: 'src/math.js' }, 'c1')], timestamp: 6001 })
    reader.tick()

    expect(lines(frames)).toEqual([{ hermes: 'call', id: 'c1', name: 'read_file', args: { path: 'src/math.js' } }])
  })

  it('skips a session a runs folder meta file names', () => {
    const { projectRoot, runsFolder, dbPath } = setup()
    writeFileSync(join(runsFolder, 'lane-1.meta.json'), JSON.stringify({ sessionId: 'ses-lane' }))
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder })
    reader.tick()

    addSession(dbPath, { id: 'ses-lane', cwd: projectRoot })
    addMessage(dbPath, { sessionId: 'ses-lane', role: 'assistant', calls: [call('read_file', { path: 'src/math.js' }, 'c1')], timestamp: 6001 })
    reader.tick()

    expect(frames).toEqual([])
    expect(reader.metaFiles().get('lane-1.meta.json').sessionId).toBe('ses-lane')
  })

  it('ignores a session whose last activity is before the bridge start', () => {
    const { projectRoot, runsFolder, dbPath } = setup()
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder, clock: { value: 9000 } })

    addSession(dbPath, { id: 'ses-old', cwd: projectRoot, startedAt: 6000, lastActivity: 7000 })
    addMessage(dbPath, { sessionId: 'ses-old', role: 'user', content: 'old work', timestamp: 7000 })
    reader.tick()

    expect(frames).toEqual([])
    expect(reader.sessions().size).toBe(0)
  })

  it('puts a child session calls under the parent run as a child agent', () => {
    const { projectRoot, runsFolder, dbPath } = setup()
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder })
    reader.tick()

    addSession(dbPath, { id: 'ses-parent', cwd: projectRoot })
    addMessage(dbPath, { sessionId: 'ses-parent', role: 'assistant', calls: [call('read_file', { path: 'src/math.js' }, 'p1')], timestamp: 6001 })
    reader.tick()

    addSession(dbPath, { id: 'sub-1', cwd: join(projectRoot, 'src'), parent: 'ses-parent', source: 'subagent', title: 'worker' })
    addMessage(dbPath, { sessionId: 'sub-1', role: 'assistant', calls: [call('write_file', { path: 'src/ui.js' }, 'w1')], timestamp: 6100 })
    reader.tick()

    const child = lines(frames).filter((line) => line.hermes === 'call' && line.agent === 'sub-1')
    expect(child).toEqual([{ hermes: 'call', id: 'w1', name: 'write_file', args: { path: 'src/ui.js' }, agent: 'sub-1', agentName: 'worker' }])
    expect(logFrames(frames).every((frame) => frame.payload.runId === statusFrames(frames)[0].payload.runId)).toBe(true)
  })

  it('marks a terminal call failed when its content looks failed', () => {
    const { projectRoot, runsFolder, dbPath } = setup()
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder })
    reader.tick()

    addSession(dbPath, { id: 'ses-1', cwd: projectRoot })
    addMessage(dbPath, { sessionId: 'ses-1', role: 'assistant', calls: [call('terminal', { command: 'npm test' }, 't1')], timestamp: 6001 })
    addMessage(dbPath, { sessionId: 'ses-1', role: 'tool', content: '\u2716 add sums two numbers', toolCallId: 't1', toolName: 'terminal', timestamp: 6002 })
    reader.tick()

    expect(lines(frames)).toEqual([
      { hermes: 'call', id: 't1', name: 'terminal', args: { command: 'npm test' } },
      { hermes: 'result', id: 't1', ok: false },
    ])
  })

  it('ends the run when the session has ended with no call open', () => {
    const { projectRoot, runsFolder, dbPath } = setup()
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder })
    reader.tick()

    addSession(dbPath, { id: 'ses-1', cwd: projectRoot, endedAt: 6100 })
    addMessage(dbPath, { sessionId: 'ses-1', role: 'assistant', calls: [call('read_file', { path: 'src/math.js' }, 'c1')], timestamp: 6001 })
    addMessage(dbPath, { sessionId: 'ses-1', role: 'tool', content: 'ok', toolCallId: 'c1', toolName: 'read_file', timestamp: 6002 })
    reader.tick()

    expect(endFrame(frames).payload.runId).toBe(statusFrames(frames)[0].payload.runId)
  })

  it('ends the run after the quiet time with no new rows', () => {
    const { projectRoot, runsFolder, dbPath } = setup()
    const clock = { value: 5000 }
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder, clock, quietMs: 30000 })
    reader.tick()

    addSession(dbPath, { id: 'ses-1', cwd: projectRoot })
    addMessage(dbPath, { sessionId: 'ses-1', role: 'assistant', calls: [call('read_file', { path: 'src/math.js' }, 'c1')], timestamp: 6001 })
    reader.tick()
    expect(endFrame(frames)).toBeUndefined()

    clock.value += 30000
    reader.tick()
    expect(endFrame(frames).payload.status).toBe('succeeded')
  })

  it('opens a run at a user row with no call', () => {
    const { projectRoot, runsFolder, dbPath } = setup()
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder })
    reader.tick()

    addSession(dbPath, { id: 'ses-1', cwd: projectRoot })
    addMessage(dbPath, { sessionId: 'ses-1', role: 'user', content: 'Plan the change.', timestamp: 6001 })
    reader.tick()

    expect(statusFrames(frames).map((frame) => frame.payload.status)).toEqual(['running'])
    expect(reader.open().size).toBe(1)
  })

  it('reads no key file and stays quiet when state.db is missing', () => {
    const { dir, projectRoot, runsFolder } = setup()
    const { reader, frames } = startReader({ dbPath: join(dir, 'home', 'missing.db'), projectRoot, runsFolder })
    expect(() => reader.tick()).not.toThrow()
    expect(frames).toEqual([])
    expect(reader.problem()).toBe('')
  })

  it('names the Hermes home from HERMES_HOME, then LOCALAPPDATA, then the home folder', () => {
    expect(hermesHome({ home: 'C:\\Users\\<name>', env: { HERMES_HOME: 'D:\\hermes' }, platform: 'win32' })).toBe('D:\\hermes')
    expect(hermesHome({ home: 'C:\\Users\\<name>', env: { LOCALAPPDATA: 'C:\\Users\\<name>\\AppData\\Local' }, platform: 'win32' })).toBe(
      'C:\\Users\\<name>\\AppData\\Local\\hermes'
    )
    expect(hermesHome({ home: '/home/user', env: {}, platform: 'linux' })).toBe('/home/user/.hermes')
  })

  it('sends frames the Hermes parser reads as calls with their files', () => {
    const { projectRoot, runsFolder, dbPath } = setup()
    const { reader, frames } = startReader({ dbPath, projectRoot, runsFolder })
    reader.tick()

    addSession(dbPath, { id: 'ses-1', cwd: projectRoot })
    addMessage(dbPath, { sessionId: 'ses-1', role: 'assistant', calls: [call('patch', { path: 'src/math.js' }, 'c1')], timestamp: 6001 })
    addMessage(dbPath, { sessionId: 'ses-1', role: 'tool', content: 'ok', toolCallId: 'c1', toolName: 'patch', timestamp: 6002 })
    reader.tick()

    const parser = createHermesParser({ rootName: 'project', rootPath: projectRoot, files: ['src/math.js'], dirs: ['src'], agentKey: 'hermes-session' })
    const activities = []
    for (const frame of frames) activities.push(...parser.push(frame.payload.chunk, Date.parse(frame.payload.ts)))
    activities.push(...parser.flush(20000))
    expect(activities.filter((activity) => activity.type === 'tool.start')[0]).toMatchObject({
      tool: 'edit',
      label: 'edit src/math.js',
      touches: [{ path: 'src/math.js', mode: 'write', kind: 'file' }],
    })
    expect(activities.filter((activity) => activity.type === 'tool.end')).toEqual([{ time: Date.parse(frames[frames.length - 1].payload.ts), type: 'tool.end', id: 'c1', ok: true }])
  })

  it('gives two reader lifetimes over one database different run ids', () => {
    const { projectRoot, runsFolder, dbPath } = setup()
    const clock = { value: 5000 }
    addSession(dbPath, { id: 'ses-1', cwd: projectRoot, startedAt: 4000, lastActivity: 5500 })

    const first = startReader({ dbPath, projectRoot, runsFolder, clock })
    first.reader.tick()
    addMessage(dbPath, { sessionId: 'ses-1', role: 'user', content: 'Go.', timestamp: 5500 })
    first.reader.tick()
    const firstRun = statusFrames(first.frames)[0].payload.runId

    clock.value += 1000
    touchSession(dbPath, 'ses-1', 6500)
    const second = startReader({ dbPath, projectRoot, runsFolder, clock })
    second.reader.tick()
    addMessage(dbPath, { sessionId: 'ses-1', role: 'user', content: 'Go again.', timestamp: 6500 })
    second.reader.tick()
    const secondRun = statusFrames(second.frames)[0].payload.runId

    expect(firstRun).toMatch(/^ses-1:[0-9a-f]{8}:1$/)
    expect(secondRun).toMatch(/^ses-1:[0-9a-f]{8}:1$/)
    expect(firstRun).not.toBe(secondRun)
  })

  it('names the agent row the room shows', () => {
    expect(HERMES_SESSION_AGENT).toEqual({
      id: 'agent-hermes-session',
      key: 'hermes-session',
      name: 'Hermes session',
      adapterType: 'hermes_local',
      parser: 'hermes',
      role: null,
    })
    const { projectRoot, runsFolder, dbPath } = setup()
    const { reader } = startReader({ dbPath, projectRoot, runsFolder })
    expect(reader.agents).toEqual([HERMES_SESSION_AGENT])
  })

  it('registers the reader as the Hermes harness half', async () => {
    const { harnessByKey } = await import('../server/harnesses/index.js')
    expect(harnessByKey.hermes.createSessionsReader).toBe(createHermesSessionsReader)
    const { SESSION_HARNESSES } = await import('../server/harnesses/index.js')
    expect(SESSION_HARNESSES.some((harness) => harness.key === 'hermes')).toBe(true)
  })
})
