import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
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

  it('decides a running top from its existing transcript and shows it from its next line', () => {
    const { projectRoot, home, dbPath } = setup()
    addConversation(dbPath, { id: 'conv-before' })
    writeTranscript(home, 'conv-before', [userInput(0), planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]), generic(2, 'old words')])

    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    expect(reader.sessions().get('conv-before').decision).toBe('inside')
    expect(reader.sessions().get('conv-before').lines).toBe(0)
    expect(frames).toEqual([])

    appendTranscript(home, 'conv-before', [planner(3, [readCall(join(projectRoot, 'src', 'app.js'))]), generic(4, 'new words')])
    reader.tick()

    expect(reader.sessions().get('conv-before').lines).toBe(2)
    expect(stepsOf(frames).map((step) => step.step_index)).toEqual(['3.0', '3.0'])
  })

  it('reads the last 512 KB of an existing transcript only', () => {
    const { projectRoot, home, dbPath } = setup()
    addConversation(dbPath, { id: 'conv-far' })
    const path = transcript(home, 'conv-far')
    mkdirSync(dirname(path), { recursive: true })
    const pad = `${JSON.stringify(generic(1, 'x'.repeat(2000)))}\n`
    let text = ''
    while (text.length < 600 * 1024) text += pad
    writeFileSync(path, `${JSON.stringify(planner(0, [readCall(join(projectRoot, 'src', 'old.js'))]))}\n${text}`)

    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    expect(reader.sessions().get('conv-far').decision).toBe('unknown')
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

  it('passes over the screenshots Antigravity keeps in its own brain folder when it picks the project', () => {
    const { base, projectRoot, home, dbPath } = setup()
    const outside = join(base, 'other')
    mkdirSync(outside, { recursive: true })
    const own = (name) => join(home, '.gemini', 'antigravity', 'brain', 'conv-brain', '.system_generated', 'browser_evidence', name)
    const reader = makeReader({ projectRoot, home, dbPath, frames: [] })
    reader.tick()

    addConversation(dbPath, { id: 'conv-brain' })
    writeTranscript(home, 'conv-brain', [
      planner(1, [readCall(own('final_step_14.png'))]),
      planner(2, [readCall(join(projectRoot, 'src', 'math.js'))]),
      generic(3, 'ok'),
    ])
    addConversation(dbPath, { id: 'conv-brain-out' })
    writeTranscript(home, 'conv-brain-out', [planner(1, [readCall(own('page.png'))]), planner(2, [readCall(join(outside, 'x.js'))])])
    reader.tick()

    expect(reader.sessions().get('conv-brain').decision).toBe('inside')
    expect(reader.sessions().get('conv-brain').lines).toBe(3)
    expect(reader.sessions().get('conv-brain-out').decision).toBe('unknown')
    expect(reader.sessions().get('conv-brain-out').lines).toBe(0)
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

  it('keeps no frame for a conversation that names another repository first, and joins it when a project path follows', () => {
    const { base, projectRoot, home, dbPath } = setup()
    const outside = join(base, 'other')
    mkdirSync(outside, { recursive: true })
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: 'conv-out' })
    writeTranscript(home, 'conv-out', [userInput(0), planner(1, [readCall(join(outside, 'x.js'))]), generic(2, { note: 'outside words' })])
    reader.tick()

    expect(reader.sessions().get('conv-out').decision).toBe('unknown')
    expect(reader.sessions().get('conv-out').lines).toBe(0)
    expect(frames).toEqual([])

    appendTranscript(home, 'conv-out', [planner(3, [readCall(join(projectRoot, 'src', 'math.js'))]), generic(4, 'inside words')])
    reader.tick()

    expect(reader.sessions().get('conv-out').decision).toBe('inside')
    expect(reader.sessions().get('conv-out').lines).toBe(5)
    expect(frames.length).toBeGreaterThan(0)
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

  it('lets a child conversation decide for the top', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: 'conv-parent' })
    addConversation(dbPath, { id: 'conv-child', parent: 'conv-parent', agent: 'ui-worker', depth: 1 })
    appendTranscript(home, 'conv-parent', [
      userInput(0),
      planner(1, [swarmAdd('ui-worker')]),
      planner(2, [swarmAdd('reviewer')]),
    ])
    writeTranscript(home, 'conv-child', [planner(1, [readCall(join(projectRoot, 'src', 'child.js'))]), generic(2, 'child words')])
    reader.tick()
    reader.tick()

    expect(reader.sessions().get('conv-child').decision).toBe('unknown')
    expect(reader.sessions().get('conv-parent').decision).toBe('inside')
    expect(reader.sessions().get('conv-parent').lines).toBe(3)
    expect(reader.sessions().get('conv-child').lines).toBe(2)
    expect(stepsOf(frames).some((step) => step.conversation_id === 'conv-child')).toBe(true)
  })

  it('joins a tree whose child names a project file after its parent named another repository', () => {
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

    expect(reader.sessions().get('conv-parent-out').decision).toBe('inside')
    expect(reader.sessions().get('conv-child-out').lines).toBe(1)
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

    addConversation(dbPath, { id: 'conv-steps' })
    writeTranscript(home, 'conv-steps', [
      userInput(0),
      planner(1, [readCall(join(projectRoot, 'src', 'math.js')), { name: 'run_command', args: { CommandLine: JSON.stringify('node -v') } }]),
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
    expect(sent[0].conversation_id).toBe('conv-steps')
    expect(sent[0].step_type).toBe('tool')
    expect(sent[0].tool_info.parameters).toEqual({ Path: join(projectRoot, 'src', 'math.js'), StartLine: 1, EndLine: 10 })
    expect(sent[1].tool_info.parameters).toEqual({ CommandLine: 'node -v' })
    expect(sent[2].tool_info.output).toBe('file words')
    expect(sent[3].tool_info.output).toBe('v24')
  })

  it('marks an ERROR result as an error step with its text', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: 'conv-error' })
    writeTranscript(home, 'conv-error', [
      planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]),
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

    addConversation(dbPath, { id: 'conv-long' })
    writeTranscript(home, 'conv-long', [planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]), generic(2, 'x'.repeat(2500))])
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
    addConversation(dbPath, { id: 'conv-parent' })
    appendTranscript(home, 'conv-parent', [userInput(0), planner(1, [readCall(inside)]), generic(2, 'ok')])
    reader.tick()

    appendTranscript(home, 'conv-parent', [
      planner(3, [invokeCall('reviewer'), swarmAdd('ui-designer'), swarmAdd('stage-closeup')]),
      generic(4, 'child one'),
      generic(5, 'child two'),
      generic(6, 'child three'),
    ])
    addConversation(dbPath, { id: 'conv-reviewer', parent: 'conv-parent', agent: 'reviewer', depth: 1 })
    addConversation(dbPath, { id: 'conv-ui', parent: 'conv-parent', agent: 'ui-designer', depth: 1 })
    addConversation(dbPath, { id: 'conv-stage', parent: 'conv-parent', agent: 'stage-closeup', depth: 1 })
    appendTranscript(home, 'conv-reviewer', [planner(1, [readCall(join(projectRoot, 'docs', 'a.md'))]), generic(2, 'reviewer words')])
    appendTranscript(home, 'conv-ui', [planner(1, [readCall(join(projectRoot, 'src', 'ui.js'))]), generic(2, 'ui words')])
    appendTranscript(home, 'conv-stage', [planner(1, [readCall(join(projectRoot, 'src', 'stage.js'))]), generic(2, 'stage words')])
    reader.tick()

    setStatus(dbPath, 'conv-reviewer', 'CASCADE_RUN_STATUS_IDLE')
    setStatus(dbPath, 'conv-ui', 'CASCADE_RUN_STATUS_IDLE')
    setStatus(dbPath, 'conv-stage', 'CASCADE_RUN_STATUS_IDLE')
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
})

describe('the Antigravity session reader and its subagents', () => {
  it('makes every child from the summaries and ends it when it goes idle', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    const inside = join(projectRoot, 'src', 'math.js')
    addConversation(dbPath, { id: 'conv-parent' })
    appendTranscript(home, 'conv-parent', [userInput(0), planner(1, [readCall(inside)]), generic(2, 'ok')])
    reader.tick()

    appendTranscript(home, 'conv-parent', [
      planner(3, [invokeCall('reviewer'), swarmAdd('ui-designer'), swarmAdd('stage-closeup')]),
      generic(4, 'child one'),
      generic(5, 'child two'),
      generic(6, 'child three'),
    ])
    addConversation(dbPath, { id: 'conv-reviewer', parent: 'conv-parent', agent: 'reviewer', depth: 1 })
    addConversation(dbPath, { id: 'conv-ui', parent: 'conv-parent', agent: 'ui-designer', depth: 1 })
    addConversation(dbPath, { id: 'conv-stage', parent: 'conv-parent', agent: 'stage-closeup', depth: 1 })
    appendTranscript(home, 'conv-reviewer', [planner(1, [readCall(inside)]), generic(2, 'reviewer words')])
    appendTranscript(home, 'conv-ui', [planner(1, [readCall(inside)]), generic(2, 'ui words')])
    appendTranscript(home, 'conv-stage', [planner(1, [readCall(inside)]), generic(2, 'stage words')])
    reader.tick()

    const sent = stepsOf(frames)
    const links = sent.filter((step) => step.step_index.startsWith('link.'))
    expect(links).toHaveLength(6)
    expect(links.filter((step) => step.state === 'DONE').map((step) => step.subagent_info.subagents[0]).sort((a, b) => (a.role < b.role ? -1 : 1))).toEqual([
      { role: 'reviewer', conversation_id: 'conv-reviewer' },
      { role: 'stage-closeup', conversation_id: 'conv-stage' },
      { role: 'ui-designer', conversation_id: 'conv-ui' },
    ])
    expect(links.every((step) => step.step_type === 'subagent' && step.tool_name === 'invoke_subagent')).toBe(true)
    expect(links.every((step) => step.conversation_id === 'conv-parent')).toBe(true)

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
    setStatus(dbPath, 'conv-ui', 'CASCADE_RUN_STATUS_IDLE')
    reader.tick()
    const ended = stepsOf(frames.slice(before)).filter((step) => step.tool_name === 'manage_subagents')
    expect(ended).toHaveLength(1)
    expect(ended[0].conversation_id).toBe('conv-parent')
    expect(JSON.parse(ended[0].tool_info.output)).toEqual([{ conversationId: 'conv-ui', state: 'idle' }])

    reader.tick()
    expect(stepsOf(frames.slice(before)).filter((step) => step.tool_name === 'manage_subagents')).toHaveLength(1)
  })

  it('does not link the same child twice across ticks', () => {
    const { projectRoot, home, dbPath } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames })
    reader.tick()

    addConversation(dbPath, { id: 'conv-parent' })
    addConversation(dbPath, { id: 'conv-child', parent: 'conv-parent', agent: 'ui-worker', depth: 1 })
    appendTranscript(home, 'conv-parent', [planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]), generic(2, 'ok')])
    appendTranscript(home, 'conv-child', [planner(1, [readCall(join(projectRoot, 'src', 'child.js'))]), generic(2, 'child words')])
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

    addConversation(dbPath, { id: 'conv-top' })
    addConversation(dbPath, { id: 'conv-mid', parent: 'conv-top', agent: 'coordinator', depth: 1 })
    addConversation(dbPath, { id: 'conv-deep', parent: 'conv-mid', agent: 'browser', depth: 2 })
    appendTranscript(home, 'conv-top', [planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]), generic(2, 'ok')])
    reader.tick()

    const links = stepsOf(frames).filter((step) => step.step_index.startsWith('link.'))
    expect(links.filter((step) => step.state === 'DONE').map((step) => [step.conversation_id, step.subagent_info.subagents[0].role])).toEqual([
      ['conv-top', 'coordinator'],
      ['conv-mid', 'browser'],
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

    addConversation(dbPath, { id: 'conv-run' })
    appendTranscript(home, 'conv-run', [planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]), generic(2, 'ok')])
    reader.tick()

    expect(frames.map((frame) => frame.type)).toEqual([
      'heartbeat.run.queued',
      'heartbeat.run.status',
      'heartbeat.run.log',
      'heartbeat.run.log',
    ])
    const run = frames[0].payload
    expect(frames[0].payload.runId).toMatch(/^conv-run:[0-9a-f]{8}:1$/)
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
    setStatus(dbPath, 'conv-run', 'CASCADE_RUN_STATUS_IDLE')
    reader.tick()

    const statuses = frames.filter((frame) => frame.type === 'heartbeat.run.status').map((frame) => frame.payload.status)
    expect(statuses).toEqual(['running', 'succeeded'])
    expect(frames.filter((frame) => frame.type === 'heartbeat.run.status')[1].payload.runId).toBe(run.runId)
  })

  it('ends a run that stops growing after the quiet time', () => {
    const { projectRoot, home, dbPath } = setup()
    let time = 1000000
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames, now: () => time, quietMs: 1000 })
    reader.tick()

    addConversation(dbPath, { id: 'conv-quiet' })
    appendTranscript(home, 'conv-quiet', [planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]), generic(2, 'ok')])
    reader.tick()

    time += 1000
    reader.tick()
    expect(frames.filter((frame) => frame.type === 'heartbeat.run.status').map((frame) => frame.payload.status)).toEqual([
      'running',
      'succeeded',
    ])
  })

  it('does not end a run while a call is still open', () => {
    const { projectRoot, home, dbPath } = setup()
    let time = 1000000
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames, now: () => time, quietMs: 60000 })
    reader.tick()

    addConversation(dbPath, { id: 'conv-open' })
    appendTranscript(home, 'conv-open', [planner(1, [readCall(join(projectRoot, 'src', 'math.js'))])])
    reader.tick()
    setStatus(dbPath, 'conv-open', 'CASCADE_RUN_STATUS_IDLE')
    reader.tick()

    expect(frames.filter((frame) => frame.type === 'heartbeat.run.status').map((frame) => frame.payload.status)).toEqual(['running'])
    expect(reader.open().has('conv-open')).toBe(true)
  })

  it('opens a second run when a user input line starts another turn', () => {
    const { projectRoot, home, dbPath } = setup()
    let time = 1000000
    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, frames, now: () => time, quietMs: 1000 })
    reader.tick()

    addConversation(dbPath, { id: 'conv-input' })
    appendTranscript(home, 'conv-input', [planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]), generic(2, 'ok')])
    reader.tick()

    time += 60000
    reader.tick()
    expect(frames.filter((frame) => frame.type === 'heartbeat.run.status').map((frame) => frame.payload.status)).toEqual([
      'running',
      'succeeded',
    ])

    appendTranscript(home, 'conv-input', [userInput(3, 'One more thing.')])
    reader.tick()
    const runs = frames.filter((frame) => frame.type === 'heartbeat.run.queued')
    expect(runs).toHaveLength(2)
    expect(runs[1].payload.runId).toBe('conv-input:' + runs[0].payload.runId.split(':')[1] + ':2')
  })

  it('gives two reader lifetimes over one database different run ids', () => {
    const { projectRoot, home, dbPath } = setup()
    addConversation(dbPath, { id: 'conv-token' })
    writeTranscript(home, 'conv-token', [planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]), generic(2, 'ok')])

    const first = []
    const firstReader = makeReader({ projectRoot, home, dbPath, frames: first })
    firstReader.tick()
    appendTranscript(home, 'conv-token', [planner(3, [readCall(join(projectRoot, 'src', 'app.js'))]), generic(4, 'ok')])
    firstReader.tick()
    firstReader.stop()

    const second = []
    const secondReader = makeReader({ projectRoot, home, dbPath, frames: second })
    secondReader.tick()
    appendTranscript(home, 'conv-token', [planner(5, [readCall(join(projectRoot, 'src', 'more.js'))]), generic(6, 'ok')])
    secondReader.tick()

    expect(first[0].payload.runId).toMatch(/^conv-token:[0-9a-f]{8}:1$/)
    expect(second[0].payload.runId).toMatch(/^conv-token:[0-9a-f]{8}:1$/)
    expect(first[0].payload.runId).not.toBe(second[0].payload.runId)
  })

  it('sends no frame for a conversation outside the project and none for a lane run', () => {
    const { base, projectRoot, home, dbPath } = setup()
    const outside = join(base, 'other')
    const runs = join(base, 'runs')
    mkdirSync(outside, { recursive: true })
    mkdirSync(runs, { recursive: true })
    writeFileSync(join(runs, 'agy-lane.meta.json'), `${JSON.stringify({ sessionId: 'conv-lane' })}
`)

    const frames = []
    const reader = makeReader({ projectRoot, home, dbPath, runsFolder: runs, frames })
    reader.tick()

    addConversation(dbPath, { id: 'conv-out' })
    appendTranscript(home, 'conv-out', [planner(1, [readCall(join(outside, 'x.js'))]), generic(2, 'outside words')])
    addConversation(dbPath, { id: 'conv-lane' })
    appendTranscript(home, 'conv-lane', [planner(1, [readCall(join(projectRoot, 'src', 'math.js'))]), generic(2, 'lane words')])
    reader.tick()

    expect(frames).toEqual([])
    expect(reader.open().size).toBe(0)
  })
})
