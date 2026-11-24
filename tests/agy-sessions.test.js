import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createAgySessionsReader } from '../server/agy-sessions.js'

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    try {
      cleanups.pop()()
    } catch {}
  }
})

function tempDir() {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'machineroom-tests', 'mr-agy-sessions-')))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function setup() {
  const base = tempDir()
  const projectRoot = join(base, 'project')
  const home = join(base, 'home')
  mkdirSync(projectRoot, { recursive: true })
  mkdirSync(join(home, '.gemini', 'antigravity'), { recursive: true })
  const dbPath = join(home, '.gemini', 'antigravity', 'conversation_summaries.db')
  const db = new DatabaseSync(dbPath)
  db.exec(
    'CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, preview TEXT, step_count INTEGER, last_modified_time datetime, workspace_uris TEXT, status TEXT, source TEXT, project_id TEXT, agent_name TEXT, parent_conversation_id TEXT, nesting_depth INTEGER, not_fully_idle numeric)'
  )
  db.close()
  return { base, projectRoot, home, dbPath }
}

function withDb(dbPath, fn) {
  const db = new DatabaseSync(dbPath)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

let clock = Date.UTC(2026, 10, 24, 12, 0, 0)
function stamp() {
  clock += 1000
  const date = new Date(clock)
  const pad = (value, size = 2) => String(value).padStart(size, '0')
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.` +
    `${pad(date.getUTCMilliseconds())}0000+00:00`
  )
}

function addConversation(dbPath, { id, parent = '', agent = '', status = 'CASCADE_RUN_STATUS_RUNNING', depth = 0 }) {
  const at = stamp()
  withDb(dbPath, (db) => {
    db.prepare(
      'INSERT OR REPLACE INTO conversation_summaries (conversation_id, parent_conversation_id, agent_name, status, nesting_depth, not_fully_idle, last_modified_time) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, parent, agent, status, depth, 0, at)
  })
  return at
}

function setStatus(dbPath, id, status) {
  const at = stamp()
  withDb(dbPath, (db) => {
    db.prepare('UPDATE conversation_summaries SET status = ?, last_modified_time = ? WHERE conversation_id = ?').run(status, at, id)
  })
  return at
}

function transcript(home, id) {
  return join(home, '.gemini', 'antigravity', 'brain', id, '.system_generated', 'logs', 'transcript.jsonl')
}

function writeTranscript(home, id, items) {
  const path = transcript(home, id)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, items.map((item) => `${JSON.stringify(item)}\n`).join(''))
  return path
}

function appendTranscript(home, id, items) {
  const path = transcript(home, id)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, items.map((item) => `${JSON.stringify(item)}\n`).join(''))
  return path
}

function userInput(stepIndex, content = 'Go.') {
  return { step_index: stepIndex, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: stamp(), content }
}

function planner(stepIndex, calls) {
  return {
    step_index: stepIndex,
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    created_at: stamp(),
    model: 'gemini-4-carbon-medium',
    tool_calls: calls,
  }
}

function generic(stepIndex, content) {
  return { step_index: stepIndex, source: 'MODEL', type: 'GENERIC', status: 'DONE', created_at: stamp(), content }
}

function readCall(path) {
  return { name: 'read_file', args: { Path: JSON.stringify(path), StartLine: '1', EndLine: '10' } }
}

function makeReader({ projectRoot, home, dbPath, runsFolder, frames, now, quietMs, listFolder }) {
  const reader = createAgySessionsReader({ projectRoot, home, dbPath, runsFolder, now, quietMs, listFolder, emit: (frame) => frames.push(frame) })
  cleanups.push(() => reader.stop())
  return reader
}

describe('the Antigravity session reader, reading the summaries and the transcripts', () => {
  it('reads a conversation row and keeps its transcript by byte offset', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: 'conv-in' })
    writeTranscript(home, 'conv-in', [userInput(0), planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]), generic(2, 'words')])
    reader.tick()

    const entry = reader.sessions().get('conv-in')
    expect(entry).toMatchObject({ id: 'conv-in', parentId: '', status: 'CASCADE_RUN_STATUS_RUNNING', depth: 0, lines: 3 })
    expect(entry.stream.offset).toBeGreaterThan(0)
    expect(frames).toEqual([])

    appendTranscript(home, 'conv-in', [generic(4, 'more words')])
    reader.tick()
    expect(reader.sessions().get('conv-in').lines).toBe(4)
  })

  it('reads a transcript that exists when it starts from its end', () => {
    const { projectRoot, home, dbPath } = setup()
    addConversation(dbPath, { id: 'conv-old' })
    writeTranscript(home, 'conv-old', [userInput(0), planner(1, [readCall(join(projectRoot, 'src', 'old.js'))]), generic(2, 'old')])

    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()
    expect(reader.sessions().get('conv-old').lines).toBe(0)

    appendTranscript(home, 'conv-old', [planner(3, [readCall(join(projectRoot, 'src', 'new.js'))]), generic(4, 'new')])
    reader.tick()
    expect(reader.sessions().get('conv-old').lines).toBe(2)
    expect(reader.sessions().get('conv-old').decision).toBe('inside')
  })

  it('reads a conversation first seen after the first tick from its first byte', () => {
    const { projectRoot, home, dbPath } = setup()
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'conv-new' })
    writeTranscript(home, 'conv-new', [userInput(0), planner(1, [readCall(join(projectRoot, 'src', 'math.js'))])])
    reader.tick()

    expect(reader.sessions().get('conv-new').lines).toBe(2)
  })

  it('holds a partial last line until the rest arrives', () => {
    const { projectRoot, home, dbPath } = setup()
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'conv-part' })
    const first = JSON.stringify(planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]))
    const second = `${JSON.stringify(generic(2, 'split words'))}\n`
    const path = transcript(home, 'conv-part')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${first}\n${second.slice(0, 20)}`)
    reader.tick()
    expect(reader.sessions().get('conv-part').lines).toBe(1)

    appendFileSync(path, second.slice(20))
    reader.tick()
    expect(reader.sessions().get('conv-part').lines).toBe(2)
  })

  it('asks only for the rows changed since the last read, and reads them all once a minute', () => {
    const { projectRoot, home, dbPath } = setup()
    let time = 1000000
    const reader = makeReader({ projectRoot, home, dbPath, frames: [], now: () => time })
    addConversation(dbPath, { id: 'conv-a' })
    reader.tick()
    expect(reader.sessions().has('conv-a')).toBe(true)

    setStatus(dbPath, 'conv-a', 'CASCADE_RUN_STATUS_IDLE')
    time += 500
    reader.tick()
    expect(reader.sessions().get('conv-a').status).toBe('CASCADE_RUN_STATUS_IDLE')

    time += 60 * 1000
    reader.tick()
    expect(reader.sessions().get('conv-a').status).toBe('CASCADE_RUN_STATUS_IDLE')
  })

  it('skips a missing database quietly until it appears', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath: join(home, 'missing.db'), frames })
    expect(() => reader.tick()).not.toThrow()
    expect(reader.sessions().size).toBe(0)
    expect(frames).toEqual([])

    rmSync(dbPath)
    expect(() => reader.tick()).not.toThrow()
    expect(reader.sessions().size).toBe(0)
  })

  it('keeps one entry per conversation across ticks', () => {
    const { projectRoot, home, dbPath } = setup()
    addConversation(dbPath, { id: 'conv-a' })
    addConversation(dbPath, { id: 'conv-b', parent: 'conv-a', agent: 'ui-worker', depth: 1 })
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()
    reader.tick()

    expect([...reader.sessions().keys()].sort()).toEqual(['conv-a', 'conv-b'])
    expect(reader.sessions().get('conv-b')).toMatchObject({ parentId: 'conv-a', depth: 1 })
  })

  it('lists a folder it was given for the runs meta', () => {
    const { projectRoot, home, dbPath, base } = setup()
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    writeFileSync(join(runs, 'agy-a.meta.json'), `${JSON.stringify({ sessionId: 'conv-a' })}\n`)
    let lists = 0
    const reader = makeReader({
      projectRoot,
      home,
      dbPath,
      frames: [],
      runsFolder: runs,
      listFolder: (dir) => {
        lists += 1
        return readdirSync(dir, { withFileTypes: true })
      },
    })
    reader.tick()
    expect(lists).toBe(1)
    reader.tick()
    reader.tick()
    expect(lists).toBe(1)
    expect(reader.metaFiles().get('agy-a.meta.json')).toMatchObject({ sessionId: 'conv-a' })
  })
})

describe('the Antigravity session reader around the project', () => {
  it('keeps a conversation once a tool path resolves inside the project', () => {
    const { projectRoot, home, dbPath } = setup()
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'conv-in' })
    writeTranscript(home, 'conv-in', [userInput(0), planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]), generic(2, 'inside words')])
    reader.tick()

    expect(reader.sessions().get('conv-in').decision).toBe('inside')
    expect(reader.sessions().get('conv-in').lines).toBe(3)
  })

  it('reads a subfolder of the project as inside', () => {
    const { projectRoot, home, dbPath } = setup()
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'conv-sub' })
    writeTranscript(home, 'conv-sub', [
      planner(1, [{ name: 'write_to_file', args: { TargetFile: JSON.stringify(join(projectRoot, 'packages', 'web', 'page.ts')) } }]),
    ])
    reader.tick()

    expect(reader.sessions().get('conv-sub').decision).toBe('inside')
  })

  it('keeps no line of a conversation that names another project first', () => {
    const { base, projectRoot, home, dbPath } = setup()
    const outside = join(base, 'other')
    mkdirSync(outside, { recursive: true })
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: 'conv-out' })
    writeTranscript(home, 'conv-out', [userInput(0), planner(1, [readCall(join(outside, 'x.js'))]), generic(2, { note: 'outside words' })])
    reader.tick()

    expect(reader.sessions().get('conv-out').decision).toBe('outside')
    expect(reader.sessions().get('conv-out').lines).toBe(0)
    expect(frames).toEqual([])
  })

  it('holds the lines of a conversation with no path yet, up to 200', () => {
    const { projectRoot, home, dbPath } = setup()
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'conv-held' })
    const items = []
    for (let i = 0; i < 260; i += 1) items.push(userInput(i))
    items.push(planner(260, [readCall(join(projectRoot, 'src', 'math.js'))]))
    writeTranscript(home, 'conv-held', items)
    reader.tick()

    const entry = reader.sessions().get('conv-held')
    expect(entry.decision).toBe('inside')
    expect(entry.lines).toBe(200)
    expect(entry.held).toEqual([])
  })

  it('follows a child conversation on its parent decision', () => {
    const { projectRoot, home, dbPath } = setup()
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'conv-parent' })
    addConversation(dbPath, { id: 'conv-child', parent: 'conv-parent', agent: 'ui-worker', depth: 1 })
    writeTranscript(home, 'conv-child', [planner(1, [readCall(join(projectRoot, 'src', 'child.js'))])])
    reader.tick()
    expect(reader.sessions().get('conv-parent')).toBeDefined()
    expect(reader.sessions().get('conv-child').lines).toBe(0)

    writeTranscript(home, 'conv-parent', [planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]), generic(2, 'parent words')])
    reader.tick()
    expect(reader.sessions().get('conv-parent').decision).toBe('inside')
    expect(reader.sessions().get('conv-child').lines).toBe(1)
  })

  it('drops the held lines of a child whose parent names another project', () => {
    const { base, projectRoot, home, dbPath } = setup()
    const outside = join(base, 'other')
    mkdirSync(outside, { recursive: true })
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'conv-parent-out' })
    addConversation(dbPath, { id: 'conv-child-out', parent: 'conv-parent-out', agent: 'ui-worker', depth: 1 })
    writeTranscript(home, 'conv-parent-out', [planner(1, [readCall(join(outside, 'x.js'))])])
    writeTranscript(home, 'conv-child-out', [planner(1, [readCall(join(projectRoot, 'src', 'child.js'))])])
    reader.tick()
    reader.tick()

    expect(reader.sessions().get('conv-parent-out').decision).toBe('outside')
    expect(reader.sessions().get('conv-child-out').lines).toBe(0)
  })

  it('skips a conversation that run-lane wrote, named in the runs folder meta', () => {
    const { projectRoot, home, dbPath, base } = setup()
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    writeFileSync(join(runs, 'agy-test.meta.json'), `${JSON.stringify({ lane: 'agy', project: projectRoot, sessionId: 'conv-lane' })}\n`)
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, runsFolder: runs, frames })
    reader.tick()

    addConversation(dbPath, { id: 'conv-lane' })
    writeTranscript(home, 'conv-lane', [userInput(0), planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]), generic(2, 'lane words')])
    reader.tick()
    reader.tick()

    expect(reader.sessions().get('conv-lane').skipped).toBe(true)
    expect(reader.sessions().get('conv-lane').lines).toBe(0)
    expect(frames).toEqual([])
  })

  it('notices a lane meta file written after the conversation was registered', () => {
    const { projectRoot, home, dbPath, base } = setup()
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    const reader = makeReader({ projectRoot, home, dbPath, runsFolder: runs, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'conv-late' })
    writeTranscript(home, 'conv-late', [planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]), generic(2, 'first')])
    reader.tick()
    expect(reader.sessions().get('conv-late').lines).toBe(2)

    writeFileSync(join(runs, 'agy-lane.meta.json'), `${JSON.stringify({ lane: 'agy', project: projectRoot, sessionId: 'conv-late' })}\n`)
    const later = new Date(Date.now() + 60000)
    utimesSync(runs, later, later)
    appendTranscript(home, 'conv-late', [planner(3, [readCall(join(projectRoot, 'src', 'app.js'))]), generic(4, 'second')])
    reader.tick()

    expect(reader.sessions().get('conv-late').skipped).toBe(true)
    expect(reader.sessions().get('conv-late').lines).toBe(2)
  })

  it('forgets a removed meta file', () => {
    const { projectRoot, home, dbPath, base } = setup()
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    const meta = join(runs, 'agy-gone.meta.json')
    writeFileSync(meta, `${JSON.stringify({ sessionId: 'conv-a' })}\n`)
    const reader = makeReader({ projectRoot, home, dbPath, runsFolder: runs, frames: [] })
    reader.tick()
    expect(reader.metaFiles().has('agy-gone.meta.json')).toBe(true)

    rmSync(meta)
    const later = new Date(Date.now() + 60000)
    utimesSync(runs, later, later)
    reader.tick()
    expect(reader.metaFiles().has('agy-gone.meta.json')).toBe(false)
  })
})
