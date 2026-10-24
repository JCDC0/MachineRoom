import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { createLanesSource, laneAgents } from '../server/lanes-source.js'
import { buildActivities } from '../src/model/pipeline.js'
import { makeTree } from '../src/model/paths.js'
import { readFrames, waitFor } from './helpers/loop.js'
import { makeTempDir } from './helpers/tempRoot.js'

const realLanes = JSON.parse(readFileSync(new URL('../docs/agents/lanes.json', import.meta.url), 'utf8'))
const DEAD_PAPERCLIP = 'http://127.0.0.1:3999'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix = 'mr-lanes-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function lanesFor(worktrees) {
  const lanes = { ...realLanes }
  for (const [lane, worktree] of Object.entries(worktrees)) lanes[lane] = { ...realLanes[lane], worktree }
  return lanes
}

function toolLine(path, { at = Date.now(), id = 'call-1', tool = 'read' } = {}) {
  return JSON.stringify({
    type: 'tool_use',
    timestamp: at,
    part: { type: 'tool', id, tool, state: { status: 'completed', input: { path }, output: '' } },
  })
}

function startSource({ runs, projectRoot = '', lanes, quietMs = 60000, pollMs = 20, repoRoot = projectRoot }) {
  const frames = []
  const source = createLanesSource({
    folder: runs,
    projectRoot,
    repoRoot,
    lanes,
    quietMs,
    pollMs,
    onFrame: (frame) => frames.push(frame),
  })
  cleanups.push(() => source.stop())
  source.start()
  return { source, frames }
}

function logFrames(frames) {
  return frames.filter((frame) => frame.type === 'heartbeat.run.log')
}

function endFrame(frames) {
  return frames.find(
    (frame) => frame.type === 'heartbeat.run.status' && ['succeeded', 'failed'].includes(frame.payload.status)
  )
}

describe('lane agents', () => {
  it('lists one agent per lane with a command line and leaves retired lanes out', () => {
    const agents = laneAgents(realLanes)
    expect(agents.map((agent) => agent.key)).toEqual(['opencode', 'opencode2', 'opencode3', 'opencode4', 'opencode5', 'agy', 'claude'])
    expect(agents.filter((agent) => agent.key !== 'agy' && agent.key !== 'claude').every((agent) => agent.parser === 'opencode' && agent.adapterType === 'opencode_local')).toBe(true)
    expect(agents.find((agent) => agent.key === 'opencode2').name).toBe('OpenCode 2')
    expect(agents.find((agent) => agent.key === 'claude')).toMatchObject({ name: 'Claude Code', parser: 'claude', adapterType: 'claude_local' })
    expect(agents.some((agent) => agent.key === 'hermes')).toBe(false)
  })

  it('lists AGY once its lane has a command line, with the process adapter', () => {
    expect(laneAgents(realLanes).find((agent) => agent.key === 'agy')).toMatchObject({
      id: 'agent-agy',
      key: 'agy',
      name: 'agy',
      adapterType: 'process',
      parser: 'agy',
    })
  })
})

describe('the live lane source', () => {
  it('sends a growing log to /events in order, under the lane key, and ends on its record', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    const projectRoot = join(base, 'MachineRoom')
    mkdirSync(projectRoot, { recursive: true })
    const worktree = join(base, 'MachineRoom-opencode3')
    const lanes = lanesFor({ opencode: worktree })
    const bridge = createBridge({
      paperclipUrl: DEAD_PAPERCLIP,
      companyId: 'comp-lanes',
      projectRoot,
      port: 0,
      env: {},
      surfaceEveryMs: 0,
      reconnectMinMs: 60000,
      reconnectMaxMs: 60000,
      lanesSource: { folder: runs, lanes, repoRoot: projectRoot, quietMs: 60000, pollMs: 20 },
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const logPath = join(runs, 'opencode-S6a-20261024-120000.log')
    const first = toolLine(`${worktree}\\src\\briefs\\recording.js`, { at: Date.now(), id: 'call-1' })
    const second = toolLine(`${worktree}\\src\\model\\pipeline.js`, { at: Date.now() + 1000, id: 'call-2' })
    writeFileSync(logPath, `${first}\n${second}\n`)
    appendFileSync(
      join(runs, 'runs.jsonl'),
      `${JSON.stringify({ lane: 'opencode', briefs: ['S6a'], log: logPath, exitCode: 0, killed: false })}\n`
    )

    const frames = await readFrames(url, (list) => Boolean(endFrame(list)))
    expect(frames.map((frame) => frame.type)).toEqual([
      'heartbeat.run.queued',
      'heartbeat.run.status',
      'heartbeat.run.log',
      'heartbeat.run.log',
      'heartbeat.run.status',
    ])
    expect(frames[1].payload.status).toBe('running')
    expect(frames[0].payload.agentId).toBe('agent-opencode')
    expect(logFrames(frames).map((frame) => frame.payload.seq)).toEqual([1, 2])
    const chunks = logFrames(frames).map((frame) => JSON.parse(frame.payload.chunk).part.state.input.path.replace(/\\/g, '/'))
    expect(chunks).toEqual([
      `${projectRoot.replace(/\\/g, '/')}/src/briefs/recording.js`,
      `${projectRoot.replace(/\\/g, '/')}/src/model/pipeline.js`,
    ])
    expect(endFrame(frames).payload).toMatchObject({ status: 'succeeded', error: null })

    const agents = await fetch(`${url}/api/agents`).then((response) => response.json())
    const lane = agents.find((agent) => agent.id === 'agent-opencode')
    expect(lane).toMatchObject({ key: 'opencode', name: 'OpenCode', parser: 'opencode' })
    expect(agents.some((agent) => agent.key === 'hermes')).toBe(false)
    expect(agents.find((agent) => agent.key === 'agy')).toMatchObject({ parser: 'agy', adapterType: 'process' })

    const tree = makeTree({ root: basename(projectRoot), files: [] })
    const activities = buildActivities(frames, { agents, tree })
    const starts = activities.filter((activity) => activity.type === 'tool.start')
    expect(starts.map((activity) => activity.agent)).toEqual(['opencode', 'opencode'])
    expect(starts.map((activity) => activity.touches)).toEqual([
      [{ path: 'src/briefs/recording.js', mode: 'read', kind: 'file' }],
      [{ path: 'src/model/pipeline.js', mode: 'read', kind: 'file' }],
    ])
  })

  it('tails a fresh log that was already there when it started', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    const lanes = lanesFor({ opencode: join(base, 'MachineRoom-opencode3') })
    const logPath = join(runs, 'opencode-S6a-20261024-120500.log')
    const line = toolLine(`${join(base, 'MachineRoom-opencode3')}\\src\\a.js`)
    writeFileSync(logPath, `${line}\n`)

    const { frames } = startSource({ runs, lanes })
    await waitFor(() => logFrames(frames).length === 1, { what: 'the fresh log' })
    expect(logFrames(frames)[0].payload.chunk).toContain('src')
  })

  it('holds a partial last line until its newline', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    const lanes = lanesFor({ opencode: join(base, 'MachineRoom-opencode3') })
    const { frames } = startSource({ runs, lanes })
    const logPath = join(runs, 'opencode-S6a-20261024-121000.log')
    const first = toolLine(`${join(base, 'MachineRoom-opencode3')}\\src\\a.js`, { id: 'call-1' })
    const second = toolLine(`${join(base, 'MachineRoom-opencode3')}\\src\\b.js`, { id: 'call-2' })

    writeFileSync(logPath, `${first}\n${second}`)
    await waitFor(() => logFrames(frames).length === 1, { what: 'the first complete line' })
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
    expect(logFrames(frames)).toHaveLength(1)

    appendFileSync(logPath, '\n')
    await waitFor(() => logFrames(frames).length === 2, { what: 'the held line' })
    expect(logFrames(frames)[1].payload.chunk).toBe(`${second}\n`)
  })

  it('ends a run when its record appears, with the record status', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    const lanes = lanesFor({ opencode: join(base, 'MachineRoom-opencode3') })
    const { frames } = startSource({ runs, lanes })
    const logPath = join(runs, 'opencode-S6a-20261024-122000.log')
    writeFileSync(logPath, `${toolLine(`${join(base, 'MachineRoom-opencode3')}\\src\\a.js`)}\n`)

    await waitFor(() => logFrames(frames).length === 1, { what: 'the log line' })
    appendFileSync(join(runs, 'runs.jsonl'), `${JSON.stringify({ lane: 'opencode', log: logPath, exitCode: 1, killed: false })}\n`)
    const ended = await waitFor(() => endFrame(frames), { what: 'the failed end' })
    expect(ended.payload).toMatchObject({ status: 'failed', error: 'exit 1' })

    const otherRuns = join(base, 'runs-killed')
    const other = startSource({ runs: otherRuns, lanes })
    const otherLog = join(otherRuns, 'opencode2-S6b-20261024-122000.log')
    writeFileSync(otherLog, `${toolLine(`${join(base, 'MachineRoom-opencode3')}\\src\\b.js`)}\n`)
    await waitFor(() => logFrames(other.frames).length === 1, { what: 'the killed log line' })
    appendFileSync(join(otherRuns, 'runs.jsonl'), `${JSON.stringify({ lane: 'opencode2', log: otherLog, exitCode: 0, killed: true })}\n`)
    const killed = await waitFor(() => endFrame(other.frames), { what: 'the killed end' })
    expect(killed.payload).toMatchObject({ status: 'failed', error: 'killed' })
  })

  it('ends a log with no record after the quiet limit', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    const lanes = lanesFor({ opencode: join(base, 'MachineRoom-opencode3') })
    const { frames } = startSource({ runs, lanes, quietMs: 150 })
    const logPath = join(runs, 'opencode-S6a-20261024-123000.log')
    writeFileSync(logPath, `${toolLine(`${join(base, 'MachineRoom-opencode3')}\\src\\a.js`)}\n`)

    const ended = await waitFor(() => endFrame(frames), { what: 'the quiet end' })
    expect(ended.payload).toMatchObject({ status: 'failed', error: 'no record' })
  })

  it('leaves out a lane worktree run when the room is on another project', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    const lanes = lanesFor({ opencode: join(base, 'MachineRoom-opencode') })
    const { source, frames } = startSource({ runs, lanes, projectRoot: join(base, 'Other'), repoRoot: join(base, 'MachineRoom') })
    writeFileSync(join(runs, 'opencode-S6a-20261024-123000.log'), `${toolLine(`${join(base, 'MachineRoom-opencode')}\\src\\a.js`)}\n`)
    source.tick()
    expect(frames).toEqual([])
  })

  it('keeps two lanes apart with their own runId and seq', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    const lanes = lanesFor({
      opencode: join(base, 'MachineRoom-opencode3'),
      opencode2: join(base, 'MachineRoom-opencode4'),
    })
    const { frames } = startSource({ runs, lanes })
    const one = join(runs, 'opencode-S6a-20261024-124000.log')
    const two = join(runs, 'opencode2-S6b-20261024-124000.log')
    writeFileSync(one, `${toolLine(`${join(base, 'MachineRoom-opencode3')}\\src\\one.js`, { id: 'one-1' })}\n${toolLine(`${join(base, 'MachineRoom-opencode3')}\\src\\one.js`, { id: 'one-2' })}\n`)
    writeFileSync(two, `${toolLine(`${join(base, 'MachineRoom-opencode4')}\\src\\two.js`, { id: 'two-1' })}\n${toolLine(`${join(base, 'MachineRoom-opencode4')}\\src\\two.js`, { id: 'two-2' })}\n`)
    appendFileSync(join(runs, 'runs.jsonl'), `${JSON.stringify({ lane: 'opencode', log: one, exitCode: 0, killed: false })}\n`)
    appendFileSync(join(runs, 'runs.jsonl'), `${JSON.stringify({ lane: 'opencode2', log: two, exitCode: 0, killed: false })}\n`)

    await waitFor(() => frames.filter((frame) => endFrame([frame])).length === 2, { what: 'both ends' })
    const logs = logFrames(frames)
    const oneFrames = logs.filter((frame) => frame.payload.agentId === 'agent-opencode')
    const twoFrames = logs.filter((frame) => frame.payload.agentId === 'agent-opencode2')
    expect(oneFrames.map((frame) => frame.payload.seq)).toEqual([1, 2])
    expect(twoFrames.map((frame) => frame.payload.seq)).toEqual([1, 2])
    expect(oneFrames[0].payload.runId).not.toBe(twoFrames[0].payload.runId)
  })

  it('lands a path inside the lane worktree on the room tree', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    const projectRoot = join(base, 'MachineRoom')
    const worktree = join(base, 'MachineRoom-opencode3')
    mkdirSync(projectRoot, { recursive: true })
    const lanes = lanesFor({ opencode: worktree })
    const { frames } = startSource({ runs, projectRoot, lanes })
    const logPath = join(runs, 'opencode-S6a-20261024-125000.log')
    const backslash = toolLine(`${worktree}\\src\\briefs\\run.js`, { id: 'backslash' })
    const forward = toolLine(`${worktree.replace(/\\/g, '/')}/src/model/paths.js`, { id: 'forward' })
    writeFileSync(logPath, `${backslash}\n${forward}\n`)

    await waitFor(() => logFrames(frames).length === 2, { what: 'both path lines' })
    const agents = laneAgents(lanes).filter((agent) => agent.key === 'opencode')
    const tree = makeTree({ root: basename(projectRoot), files: [] })
    const activities = buildActivities(frames, { agents, tree })
    const starts = activities.filter((activity) => activity.type === 'tool.start')
    expect(starts.map((activity) => activity.touches)).toEqual([
      [{ path: 'src/briefs/run.js', mode: 'read', kind: 'file' }],
      [{ path: 'src/model/paths.js', mode: 'read', kind: 'file' }],
    ])
  })

  it('adds no lane agent when the option is off', async () => {
    const projectRoot = tempDir()
    const bridge = createBridge({
      paperclipUrl: DEAD_PAPERCLIP,
      companyId: 'comp-lanes',
      projectRoot,
      port: 0,
      env: {},
      surfaceEveryMs: 0,
      reconnectMinMs: 60000,
      reconnectMaxMs: 60000,
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const response = await fetch(`${url}/api/agents`)
    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body.error).toBe('upstream unreachable')
  })
})
