import { appendFileSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claudeProjectSlug, createClaudeSessionsReader } from '../server/claude-sessions.js'
import { SESSION_HARNESSES, harnessByAdapter, harnessByKey } from '../server/harnesses/index.js'
import { createBridge } from '../server/index.js'
import { createSessionsSource } from '../server/sessions-source.js'
import { buildActivities, createPipeline } from '../src/model/pipeline.js'
import { waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const AGENT = {
  id: 'agent-claude-session',
  key: 'claude-session',
  name: 'Claude Code session',
  adapterType: 'claude_local',
  parser: 'claude',
  role: null,
}

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix = 'mr-claude-session-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function sleep(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

function setup() {
  const base = tempDir()
  const projectRoot = join(base, 'work', 'app')
  const home = join(base, 'home')
  const runs = join(base, 'runs')
  mkdirSync(projectRoot, { recursive: true })
  mkdirSync(home, { recursive: true })
  mkdirSync(runs, { recursive: true })
  const sessionsFolder = join(home, '.claude', 'projects', claudeProjectSlug(projectRoot))
  mkdirSync(sessionsFolder, { recursive: true })
  return { base, projectRoot, home, runs, sessionsFolder }
}

let clock = Date.UTC(2026, 9, 24, 12, 0, 0)
function stamp() {
  clock += 1000
  return new Date(clock).toISOString()
}

function sessionLine(type, message, { cwd, sessionId = 'sess-1', ...extra } = {}, projectRoot) {
  return {
    type,
    message,
    cwd: cwd ?? projectRoot,
    sessionId,
    timestamp: stamp(),
    ...extra,
  }
}

function jsonLines(items) {
  return items.map((item) => `${JSON.stringify(item)}\n`).join('')
}

function makeReader({ projectRoot, home, runs, frames, now, quietMs, idleMs, idlePollMs, listFolder, listProjects }) {
  const reader = createClaudeSessionsReader({
    projectRoot,
    home,
    runsFolder: runs,
    now,
    quietMs,
    idleMs,
    idlePollMs,
    listFolder,
    listProjects,
    emit: (frame) => frames.push(frame),
  })
  cleanups.push(() => reader.stop())
  return reader
}

function logFrames(frames) {
  return frames.filter((frame) => frame.type === 'heartbeat.run.log')
}

function chunks(frames) {
  return logFrames(frames).map((frame) => JSON.parse(frame.payload.chunk))
}

function statusFrames(frames) {
  return frames.filter((frame) => frame.type === 'heartbeat.run.status')
}

function readUse(id, path) {
  return { type: 'tool_use', id, name: 'Read', input: { file_path: path } }
}

function editUse(id, path) {
  return { type: 'tool_use', id, name: 'Edit', input: { file_path: path } }
}

function result(id, content = '', isError = false) {
  return { type: 'tool_result', tool_use_id: id, is_error: isError, content }
}

function runIdPattern(sessionId, number) {
  return new RegExp(`^${sessionId}:[0-9a-f]{8}:${number}$`)
}

describe('claude sessions reader', () => {
  it('builds the project folder slug from every character that is not a letter or a digit', () => {
    const folder = join('scratch', 'work', 'my app', 'v2')
    expect(claudeProjectSlug(folder)).toBe(folder.replace(/[^A-Za-z0-9]/g, '-'))
    expect(claudeProjectSlug(folder)).toContain('my-app')
    expect(claudeProjectSlug(folder)).not.toContain(' ')
  })

  it('reads a turn with a Read and an Edit, sends no prompt line and ends it at end_turn', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames })
    reader.tick()

    const read = join(projectRoot, 'src', 'math.js')
    const items = [
      sessionLine('user', { role: 'user', content: 'Fix the failing test.' }, {}, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [readUse('t1', read)] }, {}, projectRoot),
      sessionLine('user', { role: 'user', content: [result('t1', 'file words')] }, {}, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [editUse('t2', read)] }, { cwd: join(projectRoot, 'src') }, projectRoot),
      sessionLine('user', { role: 'user', content: [result('t2', 'written')] }, {}, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' }, {}, projectRoot),
    ]
    writeFileSync(join(sessionsFolder, 'sess-1.jsonl'), jsonLines(items))
    reader.tick()

    expect(frames.map((frame) => frame.type)).toEqual([
      'heartbeat.run.queued',
      'heartbeat.run.status',
      'heartbeat.run.log',
      'heartbeat.run.log',
      'heartbeat.run.log',
      'heartbeat.run.log',
      'heartbeat.run.status',
    ])
    expect(frames[1].payload).toMatchObject({ status: 'running', agentId: AGENT.id })
    expect(frames[0].payload.session).toBe('sess-1')
    expect(logFrames(frames).every((frame) => frame.payload.session === 'sess-1')).toBe(true)
    expect(frames.at(-1).payload).toMatchObject({ status: 'succeeded', error: null })
    const runIds = frames.map((frame) => frame.payload.runId)
    expect(runIds).toHaveLength(7)
    expect(new Set(runIds).size).toBe(1)
    expect(runIds[0]).toMatch(runIdPattern('sess-1', 1))
    expect(logFrames(frames).map((frame) => frame.payload.seq)).toEqual([1, 2, 3, 4])

    const sent = chunks(frames)
    expect(sent).toHaveLength(4)
    expect(sent[0]).toEqual({ type: 'assistant', message: { content: [readUse('t1', read)] } })
    expect(sent[1]).toEqual({ type: 'user', message: { content: [result('t1', 'file words')] } })
    expect(sent[2]).toEqual({ type: 'assistant', message: { content: [editUse('t2', read)] } })
    expect(sent[3]).toEqual({ type: 'user', message: { content: [result('t2', 'written')] } })
    for (const chunk of sent) {
      expect(Object.keys(chunk)).toEqual(['type', 'message'])
      expect(chunk).not.toHaveProperty('cwd')
      expect(chunk).not.toHaveProperty('timestamp')
    }
    expect(JSON.stringify(sent)).not.toContain('Fix the failing test.')
  })

  it('gives two readers over one session file different run ids', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    const file = join(sessionsFolder, 'sess-1.jsonl')
    writeFileSync(file, '')

    function lifetime(id) {
      const frames = []
      const reader = makeReader({ projectRoot, home, runs, frames })
      reader.tick()
      appendFileSync(file, jsonLines([
        sessionLine('user', { role: 'user', content: 'Go.' }, {}, projectRoot),
        sessionLine('assistant', { role: 'assistant', content: [readUse(id, join(projectRoot, 'src', 'math.js'))] }, {}, projectRoot),
      ]))
      reader.tick()
      return frames
    }

    const first = lifetime('t1')
    const second = lifetime('t2')
    expect(logFrames(first)).toHaveLength(1)
    expect(logFrames(second)).toHaveLength(1)
    const firstRun = first[0].payload.runId
    const secondRun = second[0].payload.runId
    expect(firstRun).toMatch(runIdPattern('sess-1', 1))
    expect(secondRun).toMatch(runIdPattern('sess-1', 1))
    expect(firstRun).not.toBe(secondRun)
  })

  it('cuts a tool result text to its first 2000 characters and keeps other items out', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames })
    reader.tick()

    const long = 'x'.repeat(2500)
    const items = [
      sessionLine('user', { role: 'user', content: 'Go.' }, {}, projectRoot),
      sessionLine('assistant', {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will read the file.' },
          readUse('t1', join(projectRoot, 'src', 'math.js')),
          { type: 'thinking', thinking: 'hidden' },
        ],
      }, {}, projectRoot),
      sessionLine('user', { role: 'user', content: [result('t1', long)] }, {}, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' }, {}, projectRoot),
    ]
    writeFileSync(join(sessionsFolder, 'sess-1.jsonl'), jsonLines(items))
    reader.tick()

    const sent = chunks(frames)
    expect(sent).toHaveLength(2)
    expect(sent[0].message.content).toHaveLength(1)
    expect(sent[1].message.content[0].content).toHaveLength(2000)
  })

  it('reads a file that exists when it starts from its current end', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    const file = join(sessionsFolder, 'sess-1.jsonl')
    const old = [
      sessionLine('user', { role: 'user', content: 'An older turn.' }, {}, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [readUse('old-1', join(projectRoot, 'src', 'old.js'))] }, {}, projectRoot),
    ]
    writeFileSync(file, jsonLines(old))

    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames })
    reader.tick()
    expect(frames).toEqual([])

    const next = [
      sessionLine('user', { role: 'user', content: 'A new turn.' }, {}, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [readUse('new-1', join(projectRoot, 'src', 'new.js'))] }, {}, projectRoot),
    ]
    appendFileSync(file, jsonLines(next))
    reader.tick()

    expect(logFrames(frames)).toHaveLength(1)
    expect(chunks(frames)[0].message.content[0].id).toBe('new-1')
    expect(JSON.stringify(chunks(frames))).not.toContain('old-1')
  })

  it('holds a line that arrives in two pieces', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames })
    reader.tick()

    const file = join(sessionsFolder, 'sess-1.jsonl')
    const prompt = JSON.stringify(sessionLine('user', { role: 'user', content: 'Go.' }, {}, projectRoot))
    const read = JSON.stringify(sessionLine('assistant', { role: 'assistant', content: [readUse('t1', join(projectRoot, 'src', 'math.js'))] }, {}, projectRoot))
    writeFileSync(file, `${prompt}\n${read.slice(0, 30)}`)
    reader.tick()
    expect(logFrames(frames)).toEqual([])
    expect(statusFrames(frames).map((frame) => frame.payload.status)).toEqual(['running'])

    appendFileSync(file, `${read.slice(30)}\n`)
    reader.tick()
    expect(logFrames(frames)).toHaveLength(1)
    expect(chunks(frames)[0].message.content[0].id).toBe('t1')
  })

  it('reads a child file and sends its lines in the parent run under the Agent call', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames })
    reader.tick()

    const read = join(projectRoot, 'src', 'math.js')
    const childItems = [
      sessionLine('assistant', { role: 'assistant', content: [readUse('c1', read)] }, { sessionId: 'sess-child' }, projectRoot),
      sessionLine('user', { role: 'user', content: [result('c1', 'child words')] }, { sessionId: 'sess-child' }, projectRoot),
    ]
    const childFolder = join(sessionsFolder, 'sess-child', 'subagents')
    mkdirSync(childFolder, { recursive: true })
    writeFileSync(join(childFolder, 'agent-kid.jsonl'), jsonLines(childItems))

    const agentUse = { type: 'tool_use', id: 'task-1', name: 'Agent', input: { description: 'Read the notes', subagent_type: 'Explore' } }
    const items = [
      sessionLine('user', { role: 'user', content: 'Go.' }, {}, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [agentUse] }, {}, projectRoot),
      sessionLine('user', { role: 'user', content: [result('task-1', 'child done')] }, { toolUseResult: { agentId: 'kid' } }, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' }, {}, projectRoot),
    ]
    writeFileSync(join(sessionsFolder, 'sess-child.jsonl'), jsonLines(items))
    reader.tick()

    const sent = chunks(frames)
    expect(sent.map((chunk) => chunk.parent_tool_use_id ?? null)).toEqual([null, 'task-1', 'task-1', null])
    expect(sent[1]).toEqual({ type: 'assistant', message: { content: [readUse('c1', read)] }, parent_tool_use_id: 'task-1' })
    expect(sent[2]).toEqual({ type: 'user', message: { content: [result('c1', 'child words')] }, parent_tool_use_id: 'task-1' })

    const activities = buildActivities(frames, { agents: [AGENT], tree: { rootName: 'app', files: [], dirs: [] } })
    const child = activities.find((activity) => activity.type === 'tool.start' && activity.id === 'c1')
    expect(child).toMatchObject({ agent: 'claude-session~1', tool: 'read', touches: [{ path: 'src/math.js', mode: 'read', kind: 'file' }] })
    expect(activities.filter((activity) => activity.type === 'agent.end')).toEqual([
      expect.objectContaining({ agent: 'claude-session~1', ok: true }),
    ])
    expect(statusFrames(frames).at(-1).payload.status).toBe('succeeded')
  })

  it('skips a session that run-lane wrote, named in the runs folder meta', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    writeFileSync(join(runs, 'claude-S7a-20261024-120000.meta.json'), `${JSON.stringify({ lane: 'claude', project: projectRoot, sessionId: 'sess-skip' })}\n`)

    const file = join(sessionsFolder, 'sess-skip.jsonl')
    writeFileSync(file, jsonLines([
      sessionLine('user', { role: 'user', content: 'Go.' }, { sessionId: 'sess-skip' }, projectRoot),
    ]))

    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames })
    reader.tick()
    appendFileSync(file, jsonLines([
      sessionLine('assistant', { role: 'assistant', content: [readUse('t1', join(projectRoot, 'src', 'math.js'))] }, { sessionId: 'sess-skip' }, projectRoot),
    ]))
    reader.tick()

    expect(frames).toEqual([])
  })

  it('notices a lane meta file written after the session file was registered', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames })
    reader.tick()

    const file = join(sessionsFolder, 'sess-registered-first.jsonl')
    writeFileSync(file, jsonLines([
      sessionLine('user', { role: 'user', content: 'Turn 1.' }, { sessionId: 'sess-registered-first' }, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [readUse('call-1', join(projectRoot, 'src', 'math.js'))] }, { sessionId: 'sess-registered-first' }, projectRoot),
    ]))
    reader.tick()
    expect(frames.length).toBeGreaterThan(0)
    const countBefore = frames.length

    writeFileSync(join(runs, 'claude-lane-1.meta.json'), `${JSON.stringify({ lane: 'claude', project: projectRoot, sessionId: 'sess-registered-first' })}\n`)
    const later = new Date(Date.now() + 60000)
    utimesSync(runs, later, later)

    appendFileSync(file, jsonLines([
      sessionLine('assistant', { role: 'assistant', content: [readUse('call-2', join(projectRoot, 'src', 'app.js'))] }, { sessionId: 'sess-registered-first' }, projectRoot),
    ]))
    reader.tick()

    const logFramesAfter = frames.slice(countBefore).filter((f) => f.type === 'heartbeat.run.log')
    expect(logFramesAfter).toEqual([])
    expect(reader.sessions().get('sess-registered-first').skipped).toBe(true)
  })

  it('reads the runs meta again when a later session file appears', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    writeFileSync(join(sessionsFolder, 'sess-old.jsonl'), jsonLines([
      sessionLine('user', { role: 'user', content: 'An older turn.' }, { sessionId: 'sess-old' }, projectRoot),
    ]))
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames })
    reader.tick()

    writeFileSync(join(runs, 'claude-S7a-20261024-130000.meta.json'), `${JSON.stringify({ lane: 'claude', project: projectRoot, sessionId: 'sess-late' })}\n`)
    const later = new Date(Date.now() + 60000)
    utimesSync(runs, later, later)
    writeFileSync(join(sessionsFolder, 'sess-late.jsonl'), jsonLines([
      sessionLine('user', { role: 'user', content: 'A new turn.' }, { sessionId: 'sess-late' }, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [readUse('late-1', join(projectRoot, 'src', 'math.js'))] }, { sessionId: 'sess-late' }, projectRoot),
    ]))
    reader.tick()

    expect(frames).toEqual([])
  })

  it('caches meta file reads by mtime and forgets removed meta files', () => {
    const { projectRoot, home, runs } = setup()
    const metaPath = join(runs, 'claude-test.meta.json')
    writeFileSync(metaPath, `${JSON.stringify({ sessionId: 'sess-a' })}\n`)

    const reader = makeReader({ projectRoot, home, runs, frames: [] })
    reader.tick()

    expect(reader.metaFiles().get('claude-test.meta.json')).toEqual(expect.objectContaining({ sessionId: 'sess-a' }))
    const cachedMtime = reader.metaFiles().get('claude-test.meta.json').mtimeMs

    writeFileSync(metaPath, `${JSON.stringify({ sessionId: 'sess-b' })}\n`)
    const future = new Date(Date.now() + 2000)
    utimesSync(metaPath, future, future)
    reader.tick()

    expect(reader.metaFiles().get('claude-test.meta.json')).toEqual(expect.objectContaining({ sessionId: 'sess-b' }))
    expect(reader.metaFiles().get('claude-test.meta.json').mtimeMs).not.toBe(cachedMtime)

    rmSync(metaPath)
    reader.tick()

    expect(reader.metaFiles().has('claude-test.meta.json')).toBe(false)
  })

  it('lists the runs folder only when its change time moves', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    writeFileSync(join(runs, 'claude-a.meta.json'), `${JSON.stringify({ sessionId: 'sess-a' })}\n`)
    let lists = 0
    const reader = makeReader({
      projectRoot,
      home,
      runs,
      frames: [],
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

    writeFileSync(join(runs, 'claude-b.meta.json'), `${JSON.stringify({ sessionId: 'sess-b' })}\n`)
    const later = new Date(Date.now() + 60000)
    utimesSync(runs, later, later)
    reader.tick()
    expect(lists).toBe(2)

    writeFileSync(
      join(sessionsFolder, 'sess-b.jsonl'),
      jsonLines([sessionLine('user', { role: 'user', content: 'Go.' }, { sessionId: 'sess-b' }, projectRoot)])
    )
    reader.tick()
    expect(reader.sessions().get('sess-b')?.skipped).toBe(true)
  })

  it('reads only the lines whose cwd is the project or inside it', () => {
    const { base, projectRoot, home, runs, sessionsFolder } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames })
    reader.tick()

    const outside = join(base, 'other')
    mkdirSync(outside, { recursive: true })
    const items = [
      sessionLine('user', { role: 'user', content: 'Outside.' }, { cwd: outside }, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [readUse('out-1', join(outside, 'x.js'))] }, { cwd: outside }, projectRoot),
      sessionLine('user', { role: 'user', content: 'Inside.' }, {}, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [readUse('in-1', join(projectRoot, 'src', 'math.js'))] }, {}, projectRoot),
    ]
    writeFileSync(join(sessionsFolder, 'sess-1.jsonl'), jsonLines(items))
    reader.tick()

    expect(frames.map((frame) => frame.type)).toEqual([
      'heartbeat.run.queued',
      'heartbeat.run.status',
      'heartbeat.run.log',
    ])
    expect(chunks(frames)[0].message.content[0].id).toBe('in-1')
  })

  it('reads a session started in a subfolder of the project', () => {
    const { projectRoot, home, runs } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames })
    reader.tick()

    const packageFolder = join(projectRoot, 'packages', 'web')
    mkdirSync(packageFolder, { recursive: true })
    const packageSessions = join(home, '.claude', 'projects', claudeProjectSlug(packageFolder))
    mkdirSync(packageSessions, { recursive: true })
    writeFileSync(join(packageSessions, 'sess-sub.jsonl'), jsonLines([
      sessionLine('user', { role: 'user', content: 'Build the page.' }, { cwd: packageFolder, sessionId: 'sess-sub' }, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [readUse('sub-1', join(packageFolder, 'src', 'page.js'))] }, { cwd: packageFolder, sessionId: 'sess-sub' }, projectRoot),
    ]))
    reader.tick()

    expect(logFrames(frames)).toHaveLength(1)
    expect(chunks(frames)[0].message.content[0].id).toBe('sub-1')
    expect(statusFrames(frames)[0].payload.session).toBe('sess-sub')
    expect(reader.sessions().get('sess-sub')).toMatchObject({ skipped: false })
  })

  it('shows the root session and not a sibling whose slug starts with the root slug', () => {
    const { base, projectRoot, home, runs, sessionsFolder } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames })
    reader.tick()

    const siblingRoot = join(base, 'work', 'app-old')
    const siblingSessions = join(home, '.claude', 'projects', claudeProjectSlug(siblingRoot))
    mkdirSync(siblingSessions, { recursive: true })
    writeFileSync(join(siblingSessions, 'sess-sibling.jsonl'), jsonLines([
      sessionLine('user', { role: 'user', content: 'Sibling work.' }, { cwd: siblingRoot, sessionId: 'sess-sibling' }, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [readUse('sib-1', join(siblingRoot, 'src', 'old.js'))] }, { cwd: siblingRoot, sessionId: 'sess-sibling' }, projectRoot),
    ]))
    writeFileSync(join(sessionsFolder, 'sess-root.jsonl'), jsonLines([
      sessionLine('user', { role: 'user', content: 'Root work.' }, { sessionId: 'sess-root' }, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [readUse('root-1', join(projectRoot, 'src', 'app.js'))] }, { sessionId: 'sess-root' }, projectRoot),
    ]))
    const later = new Date(Date.now() + 60000)
    utimesSync(join(home, '.claude', 'projects'), later, later)
    reader.tick()

    expect(reader.sessions().has('sess-sibling')).toBe(true)
    expect(reader.sessions().get('sess-sibling').run).toBeNull()
    expect(chunks(frames).map((chunk) => chunk.message.content[0].id)).toEqual(['root-1'])
    expect(JSON.stringify(frames)).not.toContain('sess-sibling')
  })

  it('lists the project folders only when the projects folder change time moves', () => {
    const { projectRoot, home, runs } = setup()
    const projectsRoot = join(home, '.claude', 'projects')
    let lists = 0
    const reader = makeReader({
      projectRoot,
      home,
      runs,
      frames: [],
      listProjects: (dir) => {
        lists += 1
        return readdirSync(dir, { withFileTypes: true })
      },
    })

    reader.tick()
    expect(lists).toBe(1)
    reader.tick()
    reader.tick()
    expect(lists).toBe(1)

    mkdirSync(join(projectsRoot, `${claudeProjectSlug(projectRoot)}-later`), { recursive: true })
    const later = new Date(Date.now() + 60000)
    utimesSync(projectsRoot, later, later)
    reader.tick()
    expect(lists).toBe(2)
  })

  it('ends a run that stops growing after the quiet time', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    let time = 1000000
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames, now: () => time, quietMs: 1000 })
    reader.tick()

    writeFileSync(join(sessionsFolder, 'sess-1.jsonl'), jsonLines([
      sessionLine('user', { role: 'user', content: 'Go.' }, {}, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [readUse('t1', join(projectRoot, 'src', 'math.js'))] }, {}, projectRoot),
    ]))
    reader.tick()
    expect(statusFrames(frames).map((frame) => frame.payload.status)).toEqual(['running'])

    time += 1000
    reader.tick()
    expect(statusFrames(frames).map((frame) => frame.payload.status)).toEqual(['running', 'succeeded'])
  })

  it('opens a run from a tool line with no prompt before it', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames })
    reader.tick()

    writeFileSync(join(sessionsFolder, 'sess-1.jsonl'), jsonLines([
      sessionLine('user', { role: 'user', content: [result('old', 'ok')] }, {}, projectRoot),
    ]))
    reader.tick()

    expect(frames.map((frame) => frame.type)).toEqual([
      'heartbeat.run.queued',
      'heartbeat.run.status',
      'heartbeat.run.log',
    ])
    expect(logFrames(frames)[0].payload.runId).toMatch(runIdPattern('sess-1', 1))
  })
})

describe('sessions source', () => {
  function agentFor(key) {
    return { id: `agent-${key}`, key, name: key, adapterType: 'claude_local', parser: 'claude', role: null }
  }

  it('builds the Claude and OpenCode readers by default and exposes their agents', () => {
    const { projectRoot, runs } = setup()
    const source = createSessionsSource({ projectRoot, runsFolder: runs })
    cleanups.push(() => source.stop())
    expect(source.agents.map((agent) => agent.key)).toEqual(['claude-session', 'opencode-session'])
    expect(source.agents[0]).toEqual(AGENT)
    expect(source.readers).toHaveLength(2)
  })

  it('registers one session reader per harness that has one', () => {
    expect(SESSION_HARNESSES.map((harness) => harness.key)).toEqual(['claude', 'opencode'])
    expect(harnessByKey.claude.createSessionsReader).toBe(createClaudeSessionsReader)
    expect(typeof harnessByKey.opencode.createSessionsReader).toBe('function')
    expect(harnessByAdapter.claude_local).toBe(harnessByKey.claude)
    expect(harnessByAdapter.opencode_local).toBe(harnessByKey.opencode)
    expect(harnessByKey.hermes.createSessionsReader).toBeUndefined()
    expect(harnessByKey.agy.createSessionsReader).toBeUndefined()
  })

  it('ticks one reader at a time, in order, and keeps going after an error', () => {
    const calls = []
    const one = { agent: agentFor('one'), tick: () => calls.push('one') }
    const two = {
      agent: agentFor('two'),
      tick: () => {
        calls.push('two')
        throw new Error('boom')
      },
    }
    const three = { agent: agentFor('three'), tick: () => calls.push('three') }
    const source = createSessionsSource({ projectRoot: '', runsFolder: '', readers: [one, two, three] })
    cleanups.push(() => source.stop())

    expect(() => source.tick()).not.toThrow()
    expect(calls).toEqual(['one', 'two', 'three'])
    expect(source.agents.map((agent) => agent.key)).toEqual(['one', 'two', 'three'])
  })

  it('never starts a second tick while one is running', () => {
    let source
    let calls = 0
    source = createSessionsSource({
      projectRoot: '',
      runsFolder: '',
      readers: [{
        agent: agentFor('one'),
        tick: () => {
          calls += 1
          source.tick()
        },
      }],
    })
    cleanups.push(() => source.stop())
    source.tick()
    expect(calls).toBe(1)
  })

  it('starts on a timer and stops it', async () => {
    let calls = 0
    const source = createSessionsSource({
      projectRoot: '',
      runsFolder: '',
      pollMs: 5,
      readers: [{ agent: agentFor('one'), tick: () => { calls += 1 } }],
    })
    cleanups.push(() => source.stop())
    source.start()
    await waitFor(() => calls > 1, { what: 'the session timer to tick twice' })
    const seen = calls
    expect(seen).toBeGreaterThan(1)
    source.stop()
    await sleep(30)
    expect(calls).toBe(seen)
  })

  it('adds the session agents to the bridge answer and sets the health field', async () => {
    const { projectRoot, runs } = setup()
    const frames = []
    const reader = {
      agent: AGENT,
      tick: () => {
        frames.push('tick')
      },
    }
    const bridge = createBridge({
      projectRoot,
      port: 0,
      env: {},
      sessionsSource: { projectRoot, runsFolder: runs, readers: [reader], pollMs: 20 },
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    await waitFor(() => frames.length > 0, { what: 'the first session tick' })
    expect(frames.length).toBeGreaterThan(0)

    const health = await fetch(`${url}/api/health`).then((response) => response.json())
    expect(health).toMatchObject({ ok: true, lanes: false, sessions: true })

    const agents = await fetch(`${url}/api/agents`).then((response) => response.json())
    expect(agents).toEqual([AGENT])
  })

  it('evicts idle session after 30 minutes with no growth and picks it up when it grows again', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    let currentTime = 1000000
    const now = () => currentTime
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames, now, idleMs: 30 * 60 * 1000, idlePollMs: 1000 })
    reader.tick()

    const read = join(projectRoot, 'src', 'math.js')
    const initialItems = [
      sessionLine('user', { role: 'user', content: 'Turn 1' }, {}, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [readUse('t1', read)], stop_reason: 'end_turn' }, {}, projectRoot),
    ]
    const file = join(sessionsFolder, 'sess-idle.jsonl')
    writeFileSync(file, jsonLines(initialItems))
    reader.tick()

    expect(reader.sessions().has('sess-idle')).toBe(true)
    expect(reader.evicted().has('sess-idle')).toBe(false)

    currentTime += 30 * 60 * 1000
    reader.tick()

    expect(reader.sessions().has('sess-idle')).toBe(false)
    expect(reader.evicted().has('sess-idle')).toBe(true)
    const evictedEntry = reader.evicted().get('sess-idle')
    expect(evictedEntry).toMatchObject({ id: 'sess-idle', path: file })
    expect(typeof evictedEntry.offset).toBe('number')
    expect(evictedEntry.children).toBeUndefined()
    expect(evictedEntry.stream).toBeUndefined()

    reader.tick()
    expect(reader.sessions().has('sess-idle')).toBe(false)

    currentTime += 1000
    const moreItems = [
      sessionLine('user', { role: 'user', content: 'Turn 2' }, {}, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [readUse('t2', read)], stop_reason: 'end_turn' }, {}, projectRoot),
    ]
    appendFileSync(file, jsonLines(moreItems))

    reader.tick()

    expect(reader.sessions().has('sess-idle')).toBe(true)
    expect(reader.evicted().has('sess-idle')).toBe(false)
    const logs = logFrames(frames)
    expect(logs.length).toBe(2)
  })

  it('caps the evicted map at 200 entries dropping the oldest', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    let currentTime = 1000000
    const now = () => currentTime
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames, now, idleMs: 1000, idlePollMs: 1000 })
    reader.tick()

    const read = join(projectRoot, 'src', 'math.js')
    for (let i = 1; i <= 205; i++) {
      const pad = String(i).padStart(4, '0')
      const file = join(sessionsFolder, `sess-cap-${pad}.jsonl`)
      writeFileSync(file, jsonLines([
        sessionLine('user', { role: 'user', content: 'Turn 1' }, {}, projectRoot),
        sessionLine('assistant', { role: 'assistant', content: [readUse(`t-${i}`, read)], stop_reason: 'end_turn' }, {}, projectRoot),
      ]))
    }
    reader.tick()
    expect(reader.sessions().size).toBe(205)

    currentTime += 2000
    reader.tick()

    expect(reader.sessions().size).toBe(0)
    expect(reader.evicted().size).toBe(200)
    expect(reader.evicted().has('sess-cap-0001')).toBe(false)
    expect(reader.evicted().has('sess-cap-0005')).toBe(false)
    expect(reader.evicted().has('sess-cap-0006')).toBe(true)
    expect(reader.evicted().has('sess-cap-0205')).toBe(true)
  })

  it('reads no old tool call from 201 idle files through several eviction cycles', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    let currentTime = 1000000
    const now = () => currentTime
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames, now, idleMs: 1000, idlePollMs: 1000 })
    reader.tick()

    const read = join(projectRoot, 'src', 'math.js')
    function writeFiles(prefix, count) {
      const ids = []
      for (let i = 1; i <= count; i += 1) {
        const id = `${prefix}-${String(i).padStart(4, '0')}`
        writeFileSync(join(sessionsFolder, `${id}.jsonl`), jsonLines([
          sessionLine('user', { role: 'user', content: 'Turn.' }, { sessionId: id }, projectRoot),
          sessionLine('assistant', { role: 'assistant', content: [readUse(`call-${id}`, read)], stop_reason: 'end_turn' }, { sessionId: id }, projectRoot),
        ]))
        ids.push(id)
      }
      return ids
    }

    const idleIds = writeFiles('sess-bulk', 201)
    reader.tick()
    expect(logFrames(frames)).toHaveLength(201)

    currentTime += 2000
    reader.tick()
    expect(reader.sessions().size).toBe(0)
    expect(reader.evicted().size).toBe(200)
    expect(idleIds.some((id) => !reader.evicted().has(id))).toBe(true)

    const afterFirstRead = frames.length
    for (let cycle = 0; cycle < 4; cycle += 1) {
      writeFiles(`sess-cycle-${cycle}`, 5)
      reader.tick()
      currentTime += 2000
      reader.tick()
      expect(reader.sessions().size).toBe(0)
      const later = JSON.stringify(frames.slice(afterFirstRead))
      for (const id of idleIds) expect(later).not.toContain(`call-${id}`)
    }
  })

  it('reads only the new tool call when a forgotten file grows, through the live pipeline', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    let currentTime = 1000000
    const now = () => currentTime
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames, now, idleMs: 1000, idlePollMs: 1000 })
    const pipeline = createPipeline({ agents: [AGENT], tree: { rootName: 'app', files: [], dirs: [] } })
    const activities = []
    function feed(list) {
      for (const frame of list) activities.push(...pipeline.push(frame))
    }
    reader.tick()

    const read = join(projectRoot, 'src', 'math.js')
    const idleIds = []
    for (let i = 1; i <= 201; i += 1) {
      const id = `sess-grow-${String(i).padStart(4, '0')}`
      writeFileSync(join(sessionsFolder, `${id}.jsonl`), jsonLines([
        sessionLine('user', { role: 'user', content: 'Turn.' }, { sessionId: id }, projectRoot),
        sessionLine('assistant', { role: 'assistant', content: [readUse(`call-${id}`, read)], stop_reason: 'end_turn' }, { sessionId: id }, projectRoot),
      ]))
      idleIds.push(id)
    }
    reader.tick()
    feed(frames)
    expect(logFrames(frames)).toHaveLength(201)
    expect(activities.filter((activity) => activity.type === 'tool.start')).toHaveLength(201)

    currentTime += 2000
    reader.tick()
    expect(reader.sessions().size).toBe(0)
    const forgottenId = idleIds.find((id) => !reader.evicted().has(id))
    expect(forgottenId).toBeDefined()
    expect(activities.some((activity) => activity.type === 'tool.start' && activity.id === `call-${forgottenId}`)).toBe(true)

    const before = frames.length
    const activityCount = activities.length
    appendFileSync(join(sessionsFolder, `${forgottenId}.jsonl`), jsonLines([
      sessionLine('user', { role: 'user', content: 'A new turn.' }, { sessionId: forgottenId }, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [readUse('fresh-1', join(projectRoot, 'src', 'fresh.js'))], stop_reason: 'end_turn' }, { sessionId: forgottenId }, projectRoot),
    ]))
    reader.tick()
    feed(frames.slice(before))

    const sent = chunks(frames.slice(before))
    expect(sent).toHaveLength(1)
    expect(sent[0].message.content[0].id).toBe('fresh-1')
    expect(JSON.stringify(frames.slice(before))).not.toContain('call-sess-grow')

    const fresh = activities.slice(activityCount).filter((activity) => activity.type === 'tool.start')
    expect(fresh).toHaveLength(1)
    expect(fresh[0]).toMatchObject({ id: 'fresh-1' })
    expect(fresh[0].runId).toMatch(runIdPattern(forgottenId, 2))
  })

  it('drops finished subagent buffers from session.children once result is read', () => {
    const { projectRoot, home, runs, sessionsFolder } = setup()
    const frames = []
    const reader = makeReader({ projectRoot, home, runs, frames })
    reader.tick()

    const read = join(projectRoot, 'src', 'math.js')
    const childItems = [
      sessionLine('assistant', { role: 'assistant', content: [readUse('c1', read)] }, { sessionId: 'sess-buf' }, projectRoot),
      sessionLine('user', { role: 'user', content: [result('c1', 'child words')] }, { sessionId: 'sess-buf' }, projectRoot),
    ]
    const childFolder = join(sessionsFolder, 'sess-buf', 'subagents')
    mkdirSync(childFolder, { recursive: true })
    writeFileSync(join(childFolder, 'agent-kid.jsonl'), jsonLines(childItems))

    const agentUse = { type: 'tool_use', id: 'task-1', name: 'Agent', input: { description: 'Read notes', subagent_type: 'Explore' } }
    const items = [
      sessionLine('user', { role: 'user', content: 'Go.' }, {}, projectRoot),
      sessionLine('assistant', { role: 'assistant', content: [agentUse] }, {}, projectRoot),
      sessionLine('user', { role: 'user', content: [result('task-1', 'child done')] }, { toolUseResult: { agentId: 'kid' } }, projectRoot),
    ]
    writeFileSync(join(sessionsFolder, 'sess-buf.jsonl'), jsonLines(items))
    reader.tick()

    const session = reader.sessions().get('sess-buf')
    expect(session).toBeDefined()
    const child = session.children.get('kid')
    expect(child).toBeDefined()
    expect(child.finished).toBe(true)
    expect(child.stream.buffer).toBe('')
  })
})
