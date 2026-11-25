import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { ANTIGRAVITY_SESSION_AGENT, createAgySessionsReader } from '../server/agy-sessions.js'
import { createPipeline } from '../src/model/pipeline.js'

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

function projectRead(path) {
  const call = readCall(path)
  call.args.AbsolutePath = JSON.stringify(dirname(path))
  return call
}

function makeReader({ projectRoot, home, dbPath, runsFolder, frames, now, quietMs, listFolder, statFile }) {
  const reader = createAgySessionsReader({
    projectRoot,
    home,
    dbPath,
    runsFolder,
    now,
    quietMs,
    listFolder,
    statFile,
    emit: (frame) => frames.push(frame),
  })
  cleanups.push(() => reader.stop())
  return reader
}

describe('the Antigravity session reader, reading the summaries and the transcripts', () => {
  it('reads a conversation row and keeps its transcript by byte offset', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00000' })
    writeTranscript(home, 'a6c00000', [userInput(0), planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))]), generic(2, 'words')])
    reader.tick()

    const entry = reader.sessions().get('a6c00000')
    expect(entry).toMatchObject({ id: 'a6c00000', parentId: '', status: 'CASCADE_RUN_STATUS_RUNNING', depth: 0, lines: 3 })
    expect(entry.stream.offset).toBeGreaterThan(0)

    appendTranscript(home, 'a6c00000', [generic(4, 'more words')])
    reader.tick()
    expect(reader.sessions().get('a6c00000').lines).toBe(4)
  })

  it('reads a transcript that exists when it starts from its end', () => {
    const { projectRoot, home, dbPath } = setup()
    addConversation(dbPath, { id: 'a6c00001' })
    writeTranscript(home, 'a6c00001', [userInput(0), planner(1, [projectRead(join(projectRoot, 'src', 'old.js'))]), generic(2, 'old')])

    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()
    expect(reader.sessions().get('a6c00001').lines).toBe(0)

    appendTranscript(home, 'a6c00001', [planner(3, [projectRead(join(projectRoot, 'src', 'new.js'))]), generic(4, 'new')])
    reader.tick()
    expect(reader.sessions().get('a6c00001').lines).toBe(2)
    expect(reader.sessions().get('a6c00001').decision).toBe('inside')
  })

  it('reads a conversation first seen after the first tick from its first byte', () => {
    const { projectRoot, home, dbPath } = setup()
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00002' })
    writeTranscript(home, 'a6c00002', [userInput(0), planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))])])
    reader.tick()

    expect(reader.sessions().get('a6c00002').lines).toBe(2)
  })

  it('decides a running top from its existing transcript and shows it from its next line', () => {
    const { projectRoot, home, dbPath } = setup()
    addConversation(dbPath, { id: 'a6c00003' })
    writeTranscript(home, 'a6c00003', [userInput(0), planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))]), generic(2, 'old words')])

    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    expect(reader.sessions().get('a6c00003').decision).toBe('inside')
    expect(reader.sessions().get('a6c00003').lines).toBe(0)
    expect(frames).toEqual([])

    appendTranscript(home, 'a6c00003', [planner(3, [projectRead(join(projectRoot, 'src', 'app.js'))]), generic(4, 'new words')])
    reader.tick()

    expect(reader.sessions().get('a6c00003').lines).toBe(2)
    expect(stepsOf(frames).map((step) => step.step_index)).toEqual(['3.0', '3.0'])
  })

  it('reads the last 512 KB of an existing transcript only', () => {
    const { projectRoot, home, dbPath } = setup()
    addConversation(dbPath, { id: 'a6c00004' })
    const path = transcript(home, 'a6c00004')
    mkdirSync(dirname(path), { recursive: true })
    const pad = `${JSON.stringify(generic(1, 'x'.repeat(2000)))}\n`
    let text = ''
    while (text.length < 600 * 1024) text += pad
    writeFileSync(path, `${JSON.stringify(planner(0, [projectRead(join(projectRoot, 'src', 'old.js'))]))}\n${text}`)

    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    expect(reader.sessions().get('a6c00004').decision).toBe('unknown')
  })

  it('shows a running top from one of its five most recently modified workers on first sight', () => {
    const { base, projectRoot, home, dbPath } = setup()
    const top = 'a6c01000'
    const outside = join(base, 'other')
    addConversation(dbPath, { id: top })
    for (let i = 1; i <= 6; i += 1) {
      const id = `a6c0100${i}`
      addConversation(dbPath, { id, parent: top, status: 'CASCADE_RUN_STATUS_IDLE' })
      const items = i === 1
        ? [planner(1, [readCall(join(outside, 'a.js')), readCall(join(outside, 'b.js'))])]
        : i === 2 ? [planner(1, [readCall(join(projectRoot, 'a.js')), readCall(join(projectRoot, 'b.js'))])] : [userInput(0)]
      writeTranscript(home, id, items)
    }
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    expect(reader.sessions().get(top).decision).toBe('inside')
    expect(reader.open().has(top)).toBe(true)
    expect(stepsOf(frames).some((step) => step.tool_name === 'read_file')).toBe(false)
  })

  it('holds a partial last line until the rest arrives', () => {
    const { projectRoot, home, dbPath } = setup()
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00005' })
    const first = JSON.stringify(planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))]))
    const second = `${JSON.stringify(generic(2, 'split words'))}\n`
    const path = transcript(home, 'a6c00005')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${first}\n${second.slice(0, 20)}`)
    reader.tick()
    expect(reader.sessions().get('a6c00005').lines).toBe(1)

    appendFileSync(path, second.slice(20))
    reader.tick()
    expect(reader.sessions().get('a6c00005').lines).toBe(2)
  })

  it('asks only for the rows changed since the last read, and reads them all once a minute', () => {
    const { projectRoot, home, dbPath } = setup()
    let time = 1000000
    const reader = makeReader({ projectRoot, home, dbPath, frames: [], now: () => time })
    addConversation(dbPath, { id: 'a6c00006' })
    reader.tick()
    expect(reader.sessions().has('a6c00006')).toBe(true)

    setStatus(dbPath, 'a6c00006', 'CASCADE_RUN_STATUS_IDLE')
    time += 500
    reader.tick()
    expect(reader.sessions().get('a6c00006').status).toBe('CASCADE_RUN_STATUS_IDLE')

    time += 60 * 1000
    reader.tick()
    expect(reader.sessions().get('a6c00006').status).toBe('CASCADE_RUN_STATUS_IDLE')
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

  it('stats no transcript of 300 idle conversations on a tick', () => {
    const { projectRoot, home, dbPath } = setup()
    addConversation(dbPath, { id: 'a6c00007', status: 'CASCADE_RUN_STATUS_RUNNING' })
    writeTranscript(home, 'a6c00007', [planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))])])
    let stats = 0
    const reader = makeReader({
      projectRoot,
      home,
      dbPath,
      frames: [],
      statFile: (path) => {
        stats += 1
        return statSync(path)
      },
    })
    reader.tick()
    for (let i = 0; i < 300; i += 1) addConversation(dbPath, { id: `1d1e-${i.toString(16).padStart(4, '0')}`, status: 'CASCADE_RUN_STATUS_IDLE' })
    setStatus(dbPath, 'a6c00007', 'CASCADE_RUN_STATUS_IDLE')
    reader.tick()
    reader.tick()
    expect(reader.sessions().size).toBe(301)
    expect(reader.sessions().get('1d1e-0096').decision).toBe('unknown')
    expect(reader.open().size).toBe(0)

    stats = 0
    reader.tick()
    expect(stats).toBe(0)
  })

  it('stats no unchanged idle child transcript while its top has an open run', () => {
    const { projectRoot, home, dbPath } = setup()
    const top = 'a6c01020'
    const files = []
    const reader = makeReader({
      projectRoot, home, dbPath, frames: [],
      statFile: (path) => {
        files.push(path)
        return statSync(path)
      },
    })
    reader.tick()

    addConversation(dbPath, { id: top, status: 'CASCADE_RUN_STATUS_IDLE' })
    writeTranscript(home, top, [planner(1, [projectRead(join(projectRoot, 'math.js'))])])
    for (let i = 0; i < 100; i += 1) {
      const id = `a6c02${i.toString(16).padStart(3, '0')}`
      addConversation(dbPath, { id, parent: top, status: 'CASCADE_RUN_STATUS_IDLE' })
      writeTranscript(home, id, [userInput(0)])
    }
    reader.tick()
    expect(reader.open().has(top)).toBe(true)
    expect(files).toHaveLength(101)
    files.length = 0

    reader.tick()
    expect(reader.open().has(top)).toBe(true)
    expect(files).toEqual([])

    setStatus(dbPath, 'a6c02000', 'CASCADE_RUN_STATUS_IDLE')
    reader.tick()
    expect(files).toEqual([transcript(home, 'a6c02000')])
  })

  it('finds a new child at once even when its modified time is still zero', () => {
    const { projectRoot, home, dbPath } = setup()
    let time = 1000000
    const reader = makeReader({ projectRoot, home, dbPath, frames: [], now: () => time })
    addConversation(dbPath, { id: 'a6c00008' })
    reader.tick()

    withDb(dbPath, (db) => {
      db.prepare(
        'INSERT OR REPLACE INTO conversation_summaries (conversation_id, parent_conversation_id, agent_name, status, nesting_depth, not_fully_idle, last_modified_time) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run('a6c00009', 'a6c00008', 'ui-worker', 'CASCADE_RUN_STATUS_RUNNING', 1, 0, '0001-01-01 00:00:00')
    })
    time += 500
    reader.tick()
    expect(reader.sessions().has('a6c00009')).toBe(true)
    expect(reader.sessions().get('a6c00009').status).toBe('CASCADE_RUN_STATUS_RUNNING')
  })

  it('keeps one entry per conversation across ticks', () => {
    const { projectRoot, home, dbPath } = setup()
    addConversation(dbPath, { id: 'a6c00006' })
    addConversation(dbPath, { id: 'a6c0000a', parent: 'a6c00006', agent: 'ui-worker', depth: 1 })
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()
    reader.tick()

    expect([...reader.sessions().keys()].sort()).toEqual(['a6c00006', 'a6c0000a'])
    expect(reader.sessions().get('a6c0000a')).toMatchObject({ parentId: 'a6c00006', depth: 1 })
  })

  it('ignores a conversation id with a path part even when it points inside the brain', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: 'a6c03000/../a6c03001' })
    writeTranscript(home, 'a6c03001', [planner(1, [projectRead(join(projectRoot, 'math.js'))])])
    reader.tick()

    expect(reader.sessions().size).toBe(0)
    expect(frames).toEqual([])
  })

  it('does not read a conversation folder linked outside the brain', () => {
    const { base, projectRoot, home, dbPath } = setup()
    const id = 'a6c03002'
    const brain = join(home, '.gemini', 'antigravity', 'brain')
    const outside = join(base, 'outside')
    const linked = join(outside, '.gemini', 'antigravity', 'brain', id)
    const items = [planner(1, [projectRead(join(projectRoot, 'math.js'))])]
    writeTranscript(outside, id, items)
    mkdirSync(brain, { recursive: true })
    symlinkSync(linked, join(brain, id), 'junction')
    addConversation(dbPath, { id })

    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()
    appendTranscript(outside, id, items)
    reader.tick()

    expect(reader.sessions().get(id).stream.offset).toBe(0)
    expect(frames).toEqual([])
  })

  it('lists the runs folder and stats its meta files only when the folder changes', () => {
    const { projectRoot, home, dbPath, base } = setup()
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    writeFileSync(join(runs, 'agy-a.meta.json'), `${JSON.stringify({ sessionId: 'a6c00006' })}\n`)
    let lists = 0
    const stats = []
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
      statFile: (path) => {
        stats.push(path)
        return statSync(path)
      },
    })
    reader.tick()
    expect(lists).toBe(1)
    reader.tick()
    reader.tick()
    expect(stats).toEqual([join(runs, 'agy-a.meta.json')])
    expect(lists).toBe(1)
    expect(reader.metaFiles().get('agy-a.meta.json')).toMatchObject({ sessionId: 'a6c00006' })
  })
})

describe('the Antigravity session reader around the project', () => {
  it('keeps a conversation once two tool paths resolve inside the project', () => {
    const { projectRoot, home, dbPath } = setup()
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00000' })
    writeTranscript(home, 'a6c00000', [userInput(0), planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))]), generic(2, 'inside words')])
    reader.tick()

    expect(reader.sessions().get('a6c00000').decision).toBe('inside')
    expect(reader.sessions().get('a6c00000').lines).toBe(3)
  })

  it('passes over the screenshots Antigravity keeps in its own brain folder when it picks the project', () => {
    const { base, projectRoot, home, dbPath } = setup()
    const outside = join(base, 'other')
    mkdirSync(outside, { recursive: true })
    const own = (name) => join(home, '.gemini', 'antigravity', 'brain', 'a6c0000b', '.system_generated', 'browser_evidence', name)
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'a6c0000b' })
    writeTranscript(home, 'a6c0000b', [
      planner(1, [readCall(own('final_step_14.png'))]),
      planner(2, [projectRead(join(projectRoot, 'src', 'math.js'))]),
      generic(3, 'ok'),
    ])
    addConversation(dbPath, { id: 'a6c0000c' })
    writeTranscript(home, 'a6c0000c', [planner(1, [readCall(own('page.png'))]), planner(2, [readCall(join(outside, 'x.js'))])])
    reader.tick()

    expect(reader.sessions().get('a6c0000b').decision).toBe('inside')
    expect(reader.sessions().get('a6c0000b').lines).toBe(3)
    expect(reader.sessions().get('a6c0000c').decision).toBe('unknown')
    expect(reader.sessions().get('a6c0000c').lines).toBe(0)
  })

  it('reads a subfolder of the project as inside', () => {
    const { projectRoot, home, dbPath } = setup()
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'a6c0000d' })
    writeTranscript(home, 'a6c0000d', [
      planner(1, ['page.ts', 'route.ts'].map((name) => ({
        name: 'write_to_file', args: { TargetFile: JSON.stringify(join(projectRoot, 'packages', 'web', name)) },
      }))),
    ])
    reader.tick()

    expect(reader.sessions().get('a6c0000d').decision).toBe('inside')
  })

  it('joins a conversation only after its project paths outnumber its other paths', () => {
    const { base, projectRoot, home, dbPath } = setup()
    const outside = join(base, 'other')
    mkdirSync(outside, { recursive: true })
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: 'a6c0000e' })
    writeTranscript(home, 'a6c0000e', [userInput(0), planner(1, [readCall(join(outside, 'a.js')), readCall(join(outside, 'b.js'))]), generic(2, { note: 'outside words' })])
    reader.tick()

    expect(reader.sessions().get('a6c0000e').decision).toBe('unknown')
    expect(reader.sessions().get('a6c0000e').lines).toBe(0)
    expect(frames).toEqual([])

    appendTranscript(home, 'a6c0000e', [planner(3, [projectRead(join(projectRoot, 'src', 'math.js'))]), generic(4, 'inside words')])
    reader.tick()

    expect(reader.sessions().get('a6c0000e').decision).toBe('unknown')
    expect(frames).toEqual([])

    appendTranscript(home, 'a6c0000e', [planner(5, [readCall(join(projectRoot, 'src', 'more.js'))])])
    reader.tick()

    expect(reader.sessions().get('a6c0000e').decision).toBe('inside')
    expect(reader.sessions().get('a6c0000e').lines).toBe(6)
    expect(frames.length).toBeGreaterThan(0)
  })

  it('keeps a tree outside the room when its worker reads one project reference', () => {
    const { base, projectRoot, home, dbPath } = setup()
    const outside = join(base, 'other')
    const top = 'a6c01010'
    const worker = 'a6c01011'
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: top })
    addConversation(dbPath, { id: worker, parent: top })
    writeTranscript(home, top, [planner(1, [readCall(join(outside, 'a.js')), readCall(join(outside, 'b.js'))])])
    writeTranscript(home, worker, [planner(1, [readCall(join(projectRoot, 'reference.js'))])])
    reader.tick()

    expect(reader.sessions().get(top).decision).toBe('unknown')
    expect(frames).toEqual([])
  })

  it('holds the lines of a conversation with no path yet, up to 200', () => {
    const { projectRoot, home, dbPath } = setup()
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'a6c0000f' })
    const items = []
    for (let i = 0; i < 260; i += 1) items.push(userInput(i))
    items.push(planner(260, [projectRead(join(projectRoot, 'src', 'math.js'))]))
    writeTranscript(home, 'a6c0000f', items)
    reader.tick()

    const entry = reader.sessions().get('a6c0000f')
    expect(entry.decision).toBe('inside')
    expect(entry.lines).toBe(200)
    expect(entry.held).toEqual([])
  })

  it('lets a child conversation decide for the top', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00010' })
    addConversation(dbPath, { id: 'a6c00009', parent: 'a6c00010', agent: 'ui-worker', depth: 1 })
    appendTranscript(home, 'a6c00010', [
      userInput(0),
      planner(1, [swarmAdd('ui-worker')]),
      planner(2, [swarmAdd('reviewer')]),
    ])
    writeTranscript(home, 'a6c00009', [planner(1, [projectRead(join(projectRoot, 'src', 'child.js'))]), generic(2, 'child words')])
    reader.tick()
    reader.tick()

    expect(reader.sessions().get('a6c00009').decision).toBe('unknown')
    expect(reader.sessions().get('a6c00010').decision).toBe('inside')
    expect(reader.sessions().get('a6c00010').lines).toBe(3)
    expect(reader.sessions().get('a6c00009').lines).toBe(2)
    expect(stepsOf(frames).some((step) => step.conversation_id === 'a6c00009')).toBe(true)
  })

  it('joins a tree whose child names enough project paths after its parent named another repository', () => {
    const { base, projectRoot, home, dbPath } = setup()
    const outside = join(base, 'other')
    mkdirSync(outside, { recursive: true })
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00011' })
    addConversation(dbPath, { id: 'a6c00012', parent: 'a6c00011', agent: 'ui-worker', depth: 1 })
    writeTranscript(home, 'a6c00011', [planner(1, [readCall(join(outside, 'x.js'))])])
    writeTranscript(home, 'a6c00012', [planner(1, [projectRead(join(projectRoot, 'src', 'child.js'))])])
    reader.tick()
    reader.tick()

    expect(reader.sessions().get('a6c00011').decision).toBe('inside')
    expect(reader.sessions().get('a6c00012').lines).toBe(1)
  })

  it('skips a conversation that run-lane wrote, named in the runs folder meta', () => {
    const { projectRoot, home, dbPath, base } = setup()
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    writeFileSync(join(runs, 'agy-test.meta.json'), `${JSON.stringify({ lane: 'agy', project: projectRoot, sessionId: 'a6c00013' })}\n`)
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, runsFolder: runs, frames })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00013' })
    writeTranscript(home, 'a6c00013', [userInput(0), planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))]), generic(2, 'lane words')])
    reader.tick()
    reader.tick()

    expect(reader.sessions().get('a6c00013').skipped).toBe(true)
    expect(reader.sessions().get('a6c00013').lines).toBe(0)
    expect(frames).toEqual([])
  })

  it('notices a lane meta file written after the conversation was registered', () => {
    const { projectRoot, home, dbPath, base } = setup()
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    const reader = makeReader({ projectRoot, home, dbPath, runsFolder: runs, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00014' })
    writeTranscript(home, 'a6c00014', [planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))]), generic(2, 'first')])
    reader.tick()
    expect(reader.sessions().get('a6c00014').lines).toBe(2)

    writeFileSync(join(runs, 'agy-lane.meta.json'), `${JSON.stringify({ lane: 'agy', project: projectRoot, sessionId: 'a6c00014' })}\n`)
    const later = new Date(Date.now() + 60000)
    utimesSync(runs, later, later)
    appendTranscript(home, 'a6c00014', [planner(3, [projectRead(join(projectRoot, 'src', 'app.js'))]), generic(4, 'second')])
    reader.tick()

    expect(reader.sessions().get('a6c00014').skipped).toBe(true)
    expect(reader.sessions().get('a6c00014').lines).toBe(2)
  })

  it('forgets a removed meta file', () => {
    const { projectRoot, home, dbPath, base } = setup()
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    const meta = join(runs, 'agy-gone.meta.json')
    writeFileSync(meta, `${JSON.stringify({ sessionId: 'a6c00006' })}\n`)
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

function stepsOf(frames) {
  return frames
    .filter((frame) => frame.type === 'heartbeat.run.log')
    .map((frame) => JSON.parse(frame.payload.chunk).step_update)
}

function invokeCall(role, prompt = 'Read it.') {
  return {
    name: 'invoke_subagent',
    args: {
      Model: JSON.stringify('flash'),
      Role: JSON.stringify(role),
      TypeName: JSON.stringify(role),
      Prompt: JSON.stringify(prompt),
    },
  }
}

function swarmAdd(name) {
  return { name: 'swarm', args: { action: JSON.stringify('add'), name: JSON.stringify(name) } }
}

describe('the Antigravity session reader turning lines into steps', () => {
  it('sends an ACTIVE step per call and its result as the DONE step, with the quotes parsed', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00015' })
    writeTranscript(home, 'a6c00015', [
      userInput(0),
      planner(1, [projectRead(join(projectRoot, 'src', 'math.js')), { name: 'run_command', args: { CommandLine: JSON.stringify('node -v') } }]),
      generic(2, 'file words'),
      generic(3, 'v24'),
    ])
    reader.tick()

    const sent = stepsOf(frames)
    expect(sent.map((step) => [step.state, step.step_index])).toEqual([
      ['ACTIVE', '1.0'],
      ['ACTIVE', '1.1'],
      ['DONE', '1.0'],
      ['DONE', '1.1'],
    ])
    expect(sent[0].conversation_id).toBe('a6c00015')
    expect(sent[0].step_type).toBe('tool')
    expect(sent[0].tool_info.parameters).toEqual({ Path: join(projectRoot, 'src', 'math.js'), StartLine: 1, EndLine: 10, AbsolutePath: join(projectRoot, 'src') })
    expect(sent[1].tool_info.parameters).toEqual({ CommandLine: 'node -v' })
    expect(sent[2].tool_info.output).toBe('file words')
    expect(sent[3].tool_info.output).toBe('v24')
  })

  it('marks an ERROR result as an error step with its text', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00016' })
    writeTranscript(home, 'a6c00016', [
      planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))]),
      { ...generic(2, 'Encountered error in step execution: file does not exist'), status: 'ERROR', error: 'file does not exist' },
    ])
    reader.tick()

    const done = stepsOf(frames).find((step) => step.state !== 'ACTIVE')
    expect(done.state).toBe('ERROR')
    expect(done.tool_info.error).toBe('file does not exist')
    expect(done.tool_info.output).toContain('file does not exist')
  })

  it('cuts a result to its first 2000 characters', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00017' })
    writeTranscript(home, 'a6c00017', [planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))]), generic(2, 'x'.repeat(2500))])
    reader.tick()

    expect(stepsOf(frames)[1].tool_info.output).toHaveLength(2000)
  })
})

describe('the Antigravity session reader through the room pipeline', () => {
  it('shows three child agents under the parent, each with its own calls, none twice', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    const inside = join(projectRoot, 'src', 'math.js')
    addConversation(dbPath, { id: 'a6c00010' })
    appendTranscript(home, 'a6c00010', [userInput(0), planner(1, [projectRead(inside)]), generic(2, 'ok')])
    reader.tick()

    appendTranscript(home, 'a6c00010', [
      planner(3, [invokeCall('reviewer'), swarmAdd('ui-designer'), swarmAdd('stage-closeup')]),
      generic(4, 'child one'),
      generic(5, 'child two'),
      generic(6, 'child three'),
    ])
    addConversation(dbPath, { id: 'a6c00018', parent: 'a6c00010', agent: 'reviewer', depth: 1 })
    addConversation(dbPath, { id: 'a6c00019', parent: 'a6c00010', agent: 'ui-designer', depth: 1 })
    addConversation(dbPath, { id: 'a6c0001a', parent: 'a6c00010', agent: 'stage-closeup', depth: 1 })
    appendTranscript(home, 'a6c00018', [planner(1, [projectRead(join(projectRoot, 'docs', 'a.md'))]), generic(2, 'reviewer words')])
    appendTranscript(home, 'a6c00019', [planner(1, [projectRead(join(projectRoot, 'src', 'ui.js'))]), generic(2, 'ui words')])
    appendTranscript(home, 'a6c0001a', [planner(1, [projectRead(join(projectRoot, 'src', 'stage.js'))]), generic(2, 'stage words')])
    reader.tick()

    setStatus(dbPath, 'a6c00018', 'CASCADE_RUN_STATUS_IDLE')
    setStatus(dbPath, 'a6c00019', 'CASCADE_RUN_STATUS_IDLE')
    setStatus(dbPath, 'a6c0001a', 'CASCADE_RUN_STATUS_IDLE')
    reader.tick()

    const tree = { rootName: 'project', rootPath: projectRoot, files: ['src/math.js', 'docs/a.md', 'src/ui.js', 'src/stage.js'], dirs: ['src', 'docs'] }
    const pipeline = createPipeline({ agents: [ANTIGRAVITY_SESSION_AGENT], tree })
    const activities = []
    for (const frame of frames) activities.push(...pipeline.push(frame))
    activities.push(...pipeline.flush())

    const spawns = activities.filter((activity) => activity.type === 'agent.spawn')
    expect(spawns.map((activity) => activity.name).sort()).toEqual(['reviewer', 'stage-closeup', 'ui-designer'])
    expect(new Set(spawns.map((activity) => activity.child)).size).toBe(3)

    const childStarts = activities.filter((activity) => activity.type === 'tool.start' && activity.agent !== 'antigravity-session')
    expect(childStarts.map((activity) => activity.touches[0].path).sort()).toEqual(['docs/a.md', 'src/stage.js', 'src/ui.js'])
    expect(childStarts.every((activity) => activity.tool === 'read')).toBe(true)

    const ends = activities.filter((activity) => activity.type === 'agent.end')
    expect(ends.map((activity) => activity.agent).sort()).toEqual(spawns.map((activity) => activity.child).sort())
    expect(ends.every((activity) => activity.ok)).toBe(true)
  })

  it('names each child and keeps the top for a page that joins after the link steps', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    const inside = join(projectRoot, 'src', 'math.js')
    addConversation(dbPath, { id: 'a6c00010' })
    appendTranscript(home, 'a6c00010', [userInput(0), planner(1, [projectRead(inside)]), generic(2, 'ok')])
    reader.tick()
    addConversation(dbPath, { id: 'a6c00019', parent: 'a6c00010', agent: 'ui-designer', depth: 1 })
    reader.tick()
    appendTranscript(home, 'a6c00019', [planner(1, [projectRead(join(projectRoot, 'src', 'ui.js'))]), generic(2, 'ui words')])
    reader.tick()
    appendTranscript(home, 'a6c00010', [planner(3, [projectRead(join(projectRoot, 'docs', 'a.md'))]), generic(4, 'parent words')])
    reader.tick()

    const isChildStep = (frame) => frame.type === 'heartbeat.run.log' && JSON.parse(frame.payload.chunk).step_update.conversation_id === 'a6c00019'
    const late = frames.slice(frames.findIndex(isChildStep))
    const childSteps = late.filter(isChildStep).map((frame) => JSON.parse(frame.payload.chunk).step_update)
    expect(childSteps.every((step) => step.name === 'ui-designer' && step.root_conversation_id === 'a6c00010')).toBe(true)

    const tree = { rootName: 'project', rootPath: projectRoot, files: ['src/math.js', 'src/ui.js', 'docs/a.md'], dirs: ['src', 'docs'] }
    const pipeline = createPipeline({ agents: [ANTIGRAVITY_SESSION_AGENT], tree })
    const activities = []
    for (const frame of late) activities.push(...pipeline.push(frame))
    const spawns = activities.filter((activity) => activity.type === 'agent.spawn')
    expect(spawns.map((activity) => activity.name)).toEqual(['ui-designer'])
    const parentRead = activities.find((activity) => activity.type === 'tool.start' && activity.touches?.[0]?.path === 'docs/a.md')
    expect(parentRead.agent).toBe('antigravity-session')
  })
})

describe('the Antigravity session reader and its subagents', () => {
  it('makes every child from the summaries and ends it when it goes idle', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    const inside = join(projectRoot, 'src', 'math.js')
    addConversation(dbPath, { id: 'a6c00010' })
    appendTranscript(home, 'a6c00010', [userInput(0), planner(1, [projectRead(inside)]), generic(2, 'ok')])
    reader.tick()

    appendTranscript(home, 'a6c00010', [
      planner(3, [invokeCall('reviewer'), swarmAdd('ui-designer'), swarmAdd('stage-closeup')]),
      generic(4, 'child one'),
      generic(5, 'child two'),
      generic(6, 'child three'),
    ])
    addConversation(dbPath, { id: 'a6c00018', parent: 'a6c00010', agent: 'reviewer', depth: 1 })
    addConversation(dbPath, { id: 'a6c00019', parent: 'a6c00010', agent: 'ui-designer', depth: 1 })
    addConversation(dbPath, { id: 'a6c0001a', parent: 'a6c00010', agent: 'stage-closeup', depth: 1 })
    appendTranscript(home, 'a6c00018', [planner(1, [projectRead(inside)]), generic(2, 'reviewer words')])
    appendTranscript(home, 'a6c00019', [planner(1, [projectRead(inside)]), generic(2, 'ui words')])
    appendTranscript(home, 'a6c0001a', [planner(1, [projectRead(inside)]), generic(2, 'stage words')])
    reader.tick()

    const sent = stepsOf(frames)
    const links = sent.filter((step) => step.step_index.startsWith('link.'))
    expect(links).toHaveLength(6)
    expect(links.filter((step) => step.state === 'DONE').map((step) => step.subagent_info.subagents[0]).sort((a, b) => (a.role < b.role ? -1 : 1))).toEqual([
      { role: 'reviewer', conversation_id: 'a6c00018' },
      { role: 'stage-closeup', conversation_id: 'a6c0001a' },
      { role: 'ui-designer', conversation_id: 'a6c00019' },
    ])
    expect(links.every((step) => step.step_type === 'subagent' && step.tool_name === 'invoke_subagent')).toBe(true)
    expect(links.every((step) => step.conversation_id === 'a6c00010')).toBe(true)

    const own = sent.filter((step) => !step.step_index.startsWith('link.') && !step.step_index.startsWith('end.'))
    expect(own.filter((step) => step.tool_name === 'subagent_call')).toHaveLength(2)
    expect(own.filter((step) => step.tool_name === 'swarm')).toHaveLength(4)
    expect(own.filter((step) => step.state === 'DONE').map((step) => step.tool_info.output).sort()).toEqual([
      'child one',
      'child three',
      'child two',
      'ok',
      'reviewer words',
      'stage words',
      'ui words',
    ])
    expect(own.some((step) => step.tool_name === 'invoke_subagent')).toBe(false)

    const before = frames.length
    setStatus(dbPath, 'a6c00019', 'CASCADE_RUN_STATUS_IDLE')
    reader.tick()
    const ended = stepsOf(frames.slice(before)).filter((step) => step.tool_name === 'manage_subagents')
    expect(ended).toHaveLength(1)
    expect(ended[0].conversation_id).toBe('a6c00010')
    expect(JSON.parse(ended[0].tool_info.output)).toEqual([{ conversationId: 'a6c00019', state: 'idle' }])

    reader.tick()
    expect(stepsOf(frames.slice(before)).filter((step) => step.tool_name === 'manage_subagents')).toHaveLength(1)
  })

  it('does not link the same child twice across ticks', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00010' })
    addConversation(dbPath, { id: 'a6c00009', parent: 'a6c00010', agent: 'ui-worker', depth: 1 })
    appendTranscript(home, 'a6c00010', [planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))]), generic(2, 'ok')])
    appendTranscript(home, 'a6c00009', [planner(1, [projectRead(join(projectRoot, 'src', 'child.js'))]), generic(2, 'child words')])
    reader.tick()
    reader.tick()
    reader.tick()

    expect(stepsOf(frames).filter((step) => step.step_index.startsWith('link.'))).toHaveLength(2)
  })

  it('links a deeper child to its own parent', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00008' })
    addConversation(dbPath, { id: 'a6c0001b', parent: 'a6c00008', agent: 'coordinator', depth: 1 })
    addConversation(dbPath, { id: 'a6c0001c', parent: 'a6c0001b', agent: 'browser', depth: 2 })
    appendTranscript(home, 'a6c00008', [planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))]), generic(2, 'ok')])
    reader.tick()

    const links = stepsOf(frames).filter((step) => step.step_index.startsWith('link.'))
    expect(links.filter((step) => step.state === 'DONE').map((step) => [step.conversation_id, step.subagent_info.subagents[0].role])).toEqual([
      ['a6c00008', 'coordinator'],
      ['a6c0001b', 'browser'],
    ])
  })
})

describe('the Antigravity session reader and its runs', () => {
  it('opens one run per top conversation with the queued frame, running, the logs and the end', () => {
    const { projectRoot, home, dbPath } = setup()
    let time = 1000000
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames, now: () => time, quietMs: 60000 })
    reader.tick()

    addConversation(dbPath, { id: 'a6c0001d' })
    appendTranscript(home, 'a6c0001d', [planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))]), generic(2, 'ok')])
    reader.tick()

    expect(frames.map((frame) => frame.type)).toEqual([
      'heartbeat.run.queued',
      'heartbeat.run.status',
      'heartbeat.run.log',
      'heartbeat.run.log',
    ])
    const run = frames[0].payload
    expect(frames[0].payload.runId).toMatch(/^a6c0001d:[0-9a-f]{8}:1$/)
    expect(frames[1].payload.status).toBe('running')
    expect(frames[1].payload.runId).toBe(run.runId)
    for (const frame of frames) {
      expect(frame.payload.agentId).toBe(ANTIGRAVITY_SESSION_AGENT.id)
      expect(frame.payload.runId).toBe(run.runId)
    }
    expect(frames.slice(2).map((frame) => frame.payload.seq)).toEqual([1, 2])
    expect(frames.slice(2).every((frame) => frame.payload.stream === 'stdout')).toBe(true)
    expect(frames[2].payload.chunk.endsWith(`${String.fromCharCode(10)}`)).toBe(true)

    time += 500
    setStatus(dbPath, 'a6c0001d', 'CASCADE_RUN_STATUS_IDLE')
    reader.tick()

    const statuses = frames.filter((frame) => frame.type === 'heartbeat.run.status').map((frame) => frame.payload.status)
    expect(statuses).toEqual(['running', 'succeeded'])
    expect(frames.filter((frame) => frame.type === 'heartbeat.run.status')[1].payload.runId).toBe(run.runId)
  })

  it('ends a running run that stops growing after thirty minutes', () => {
    const { projectRoot, home, dbPath } = setup()
    let time = 1000000
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames, now: () => time, quietMs: 1000 })
    reader.tick()

    addConversation(dbPath, { id: 'a6c0001e' })
    appendTranscript(home, 'a6c0001e', [planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))]), generic(2, 'ok')])
    reader.tick()
    expect(frames.filter((frame) => frame.type === 'heartbeat.run.status').map((frame) => frame.payload.status)).toEqual(['running'])

    time += 1000
    reader.tick()
    expect(frames.filter((frame) => frame.type === 'heartbeat.run.status').map((frame) => frame.payload.status)).toEqual(['running'])

    time += 30 * 60 * 1000
    reader.tick()
    expect(frames.filter((frame) => frame.type === 'heartbeat.run.status').map((frame) => frame.payload.status)).toEqual([
      'running',
      'succeeded',
    ])
  })

  it('ends a run that stops growing after the quiet time once its tree is idle', () => {
    const { projectRoot, home, dbPath } = setup()
    let time = 1000000
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames, now: () => time, quietMs: 1000 })
    reader.tick()

    addConversation(dbPath, { id: 'a6c0001e' })
    appendTranscript(home, 'a6c0001e', [planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))])])
    reader.tick()
    setStatus(dbPath, 'a6c0001e', 'CASCADE_RUN_STATUS_IDLE')
    reader.tick()

    time += 1000
    reader.tick()
    expect(frames.filter((frame) => frame.type === 'heartbeat.run.status').map((frame) => frame.payload.status)).toEqual([
      'running',
      'succeeded',
    ])
  })

  it('keeps a run open while a child of its tree is still running', () => {
    const { projectRoot, home, dbPath } = setup()
    let time = 1000000
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames, now: () => time, quietMs: 1000 })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00008' })
    appendTranscript(home, 'a6c00008', [planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))])])
    reader.tick()
    addConversation(dbPath, { id: 'a6c0001f', parent: 'a6c00008', agent: 'ui-worker', depth: 1 })
    appendTranscript(home, 'a6c0001f', [planner(1, [projectRead(join(projectRoot, 'src', 'ui.js'))])])
    reader.tick()
    setStatus(dbPath, 'a6c00008', 'CASCADE_RUN_STATUS_IDLE')
    reader.tick()

    time += 5 * 60 * 1000
    reader.tick()
    expect(reader.open().has('a6c00008')).toBe(true)

    setStatus(dbPath, 'a6c0001f', 'CASCADE_RUN_STATUS_IDLE')
    reader.tick()
    time += 1000
    reader.tick()
    expect(reader.open().has('a6c00008')).toBe(false)
  })

  it('does not end a run while a call is still open', () => {
    const { projectRoot, home, dbPath } = setup()
    let time = 1000000
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames, now: () => time, quietMs: 60000 })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00020' })
    appendTranscript(home, 'a6c00020', [planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))])])
    reader.tick()
    setStatus(dbPath, 'a6c00020', 'CASCADE_RUN_STATUS_IDLE')
    reader.tick()

    expect(frames.filter((frame) => frame.type === 'heartbeat.run.status').map((frame) => frame.payload.status)).toEqual(['running'])
    expect(reader.open().has('a6c00020')).toBe(true)
  })

  it('opens a second run when a user input line starts another turn', () => {
    const { projectRoot, home, dbPath } = setup()
    let time = 1000000
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames, now: () => time, quietMs: 1000 })
    reader.tick()

    addConversation(dbPath, { id: 'a6c00021' })
    appendTranscript(home, 'a6c00021', [planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))]), generic(2, 'ok')])
    reader.tick()

    setStatus(dbPath, 'a6c00021', 'CASCADE_RUN_STATUS_IDLE')
    time += 60000
    reader.tick()
    expect(frames.filter((frame) => frame.type === 'heartbeat.run.status').map((frame) => frame.payload.status)).toEqual([
      'running',
      'succeeded',
    ])

    appendTranscript(home, 'a6c00021', [userInput(3, 'One more thing.')])
    setStatus(dbPath, 'a6c00021', 'CASCADE_RUN_STATUS_RUNNING')
    reader.tick()
    const runs = frames.filter((frame) => frame.type === 'heartbeat.run.queued')
    expect(runs).toHaveLength(2)
    expect(runs[1].payload.runId).toBe('a6c00021:' + runs[0].payload.runId.split(':')[1] + ':2')
  })

  it('gives two reader lifetimes over one database different run ids', () => {
    const { projectRoot, home, dbPath } = setup()
    addConversation(dbPath, { id: 'a6c00022' })
    writeTranscript(home, 'a6c00022', [planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))]), generic(2, 'ok')])

    const first = []
    const firstReader = makeReader({ projectRoot, home, dbPath, frames: first })
    firstReader.tick()
    appendTranscript(home, 'a6c00022', [planner(3, [projectRead(join(projectRoot, 'src', 'app.js'))]), generic(4, 'ok')])
    firstReader.tick()
    firstReader.stop()

    const second = []
    const secondReader = makeReader({ projectRoot, home, dbPath, frames: second })
    secondReader.tick()
    appendTranscript(home, 'a6c00022', [planner(5, [projectRead(join(projectRoot, 'src', 'more.js'))]), generic(6, 'ok')])
    secondReader.tick()

    expect(first[0].payload.runId).toMatch(/^a6c00022:[0-9a-f]{8}:1$/)
    expect(second[0].payload.runId).toMatch(/^a6c00022:[0-9a-f]{8}:1$/)
    expect(first[0].payload.runId).not.toBe(second[0].payload.runId)
  })

  it('sends no frame for a conversation outside the project and none for a lane run', () => {
    const { base, projectRoot, home, dbPath } = setup()
    const outside = join(base, 'other')
    const runs = join(base, 'runs')
    mkdirSync(outside, { recursive: true })
    mkdirSync(runs, { recursive: true })
    writeFileSync(join(runs, 'agy-lane.meta.json'), `${JSON.stringify({ sessionId: 'a6c00013' })}
`)

    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, runsFolder: runs, frames })
    reader.tick()

    addConversation(dbPath, { id: 'a6c0000e' })
    appendTranscript(home, 'a6c0000e', [planner(1, [readCall(join(outside, 'x.js'))]), generic(2, 'outside words')])
    addConversation(dbPath, { id: 'a6c00013' })
    appendTranscript(home, 'a6c00013', [planner(1, [projectRead(join(projectRoot, 'src', 'math.js'))]), generic(2, 'lane words')])
    reader.tick()

    expect(frames).toEqual([])
    expect(reader.open().size).toBe(0)
  })
})
