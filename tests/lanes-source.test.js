import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { createLanesSource, createRecordsCache, laneAgents, mainCheckoutOf, readLanes, subOrchestratorAgent } from '../server/lanes-source.js'
import { gitPath } from '../server/programPath.js'
import { buildActivities } from '../src/model/pipeline.js'
import { makeTree } from '../src/model/paths.js'
import { readFrames, waitFor } from './helpers/bridge.js'
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
  const lanes = { ...realLanes, agy: { ...realLanes.agy, retired: false } }
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

function sleep(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

function git(cwd, args) {
  return execFileSync(gitPath(), ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  }).trim()
}

describe('lane agents', () => {
  it('lists one agent per lane with a command line and leaves retired lanes out', () => {
    const agents = laneAgents(realLanes)
    expect(agents.map((agent) => agent.key)).toEqual(['orchestrator', 'opencode', 'opencode2', 'opencode3', 'opencode4', 'opencode5', 'opencode6', 'opencode7', 'opencode8', 'opencode9', 'opencode10', 'claude'])
    expect(agents.filter((agent) => agent.key !== 'agy' && agent.key !== 'claude' && agent.key !== 'orchestrator').every((agent) => agent.parser === 'opencode' && agent.adapterType === 'opencode_local')).toBe(true)
    expect(agents.find((agent) => agent.key === 'opencode2').name).toBe('OpenCode 2')
    expect(agents.find((agent) => agent.key === 'claude')).toMatchObject({ name: 'Claude Code', parser: 'claude', adapterType: 'claude_local' })
    expect(agents.find((agent) => agent.key === 'orchestrator')).toMatchObject({ harness: 'claude', model: 'opus' })
    expect(agents.find((agent) => agent.key === 'opencode')).toMatchObject({
      harness: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
    })
    expect(agents.some((agent) => agent.key === 'hermes' || agent.key === 'agy')).toBe(false)
  })

  it('names each agent its harness and model from a lane file', () => {
    const folder = tempDir('mr-lane-file-')
    mkdirSync(join(folder, 'docs', 'agents'), { recursive: true })
    writeFileSync(
      join(folder, 'docs', 'agents', 'lanes.json'),
      JSON.stringify({
        orchestrator: { name: 'Orchestrator', cli: { harness: 'claude', model: 'opus' } },
        opencode: { name: 'OpenCode', cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
      })
    )

    const agents = laneAgents(readLanes(folder))
    expect(agents).toEqual([
      expect.objectContaining({ key: 'orchestrator', harness: 'claude', model: 'opus' }),
      expect.objectContaining({ key: 'opencode', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' }),
    ])
  })

  it('lists AGY once its lane has a command line, with the process adapter', () => {
    expect(laneAgents({ ...realLanes, agy: { ...realLanes.agy, retired: false } }).find((agent) => agent.key === 'agy')).toMatchObject({
      id: 'agent-agy',
      key: 'agy',
      name: 'agy',
      adapterType: 'process',
      parser: 'agy',
    })
  })

  it('gives a sub orchestrator agent its harness and the model of its harness', () => {
    const lanes = {
      orchestrator: { name: 'Orchestrator', cli: { harness: 'claude', model: 'opus' } },
      opencode: { name: 'OpenCode', cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
    }
    expect(subOrchestratorAgent({ id: 'frontend', name: 'Frontend', harness: 'claude' }, lanes)).toMatchObject({
      id: 'agent-sub-frontend',
      key: 'sub-frontend',
      harness: 'claude',
      model: 'opus',
      subOrchestrator: true,
    })
    expect(subOrchestratorAgent({ id: 'backend', name: 'Backend', harness: 'opencode' }, lanes)).toMatchObject({
      key: 'sub-backend',
      harness: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
    })
    expect(subOrchestratorAgent({ id: 'ui', name: 'UI', harness: 'opencode', model: 'opencode-go/other' }, lanes)).toMatchObject({
      key: 'sub-ui',
      harness: 'opencode',
      model: 'opencode-go/other',
    })
  })
})

describe('the live lane source', () => {
  it('lists a sub orchestrator agent with its harness and model', () => {
    const runs = tempDir()
    const lanes = {
      orchestrator: { name: 'Orchestrator', cli: { harness: 'claude', model: 'opus' } },
      opencode: { name: 'OpenCode', cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
    }
    const source = createLanesSource({
      folder: runs,
      lanes,
      subOrchestrators: () => [{ id: 'frontend', name: 'Frontend', harness: 'claude' }],
      quietMs: 60000,
      pollMs: 20,
    })
    cleanups.push(() => source.stop())
    expect(source.agents.find((agent) => agent.key === 'sub-frontend')).toMatchObject({
      harness: 'claude',
      model: 'opus',
      subOrchestrator: true,
    })
  })

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
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })
})

describe('the V5 audit fixes in the lane source', () => {
  it('adopts a log skipped at start for its age once the log grows (X3)', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    const worktree = join(base, 'MachineRoom-opencode3')
    const lanes = lanesFor({ opencode: worktree })
    const logPath = join(runs, 'opencode-S6a-20261024-130000.log')
    writeFileSync(logPath, `${toolLine(`${worktree}\\src\\old.js`, { id: 'old' })}\n`)
    const past = new Date(Date.now() - 120000)
    utimesSync(logPath, past, past)

    const { frames } = startSource({ runs, lanes })
    await sleep(150)
    expect(frames).toEqual([])

    appendFileSync(logPath, `${toolLine(`${worktree}\\src\\new.js`, { id: 'new' })}\n`)
    await waitFor(() => logFrames(frames).length === 2, { what: 'the log adopted after growth' })
    const paths = logFrames(frames).map((frame) =>
      JSON.parse(frame.payload.chunk).part.state.input.path.replace(/\\/g, '/')
    )
    expect(paths).toEqual([`${worktree.replace(/\\/g, '/')}/src/old.js`, `${worktree.replace(/\\/g, '/')}/src/new.js`])
  })

  it('reopens a run ended for quiet when its log grows again, with the same runId (X4)', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    const worktree = join(base, 'MachineRoom-opencode3')
    const lanes = lanesFor({ opencode: worktree })
    const { frames } = startSource({ runs, lanes, quietMs: 120 })
    const logPath = join(runs, 'opencode-S6a-20261024-130500.log')
    writeFileSync(logPath, `${toolLine(`${worktree}\\src\\one.js`, { id: 'one' })}\n`)

    const ended = await waitFor(() => endFrame(frames), { what: 'the quiet end' })
    expect(ended.payload).toMatchObject({ status: 'failed', error: 'no record' })

    appendFileSync(logPath, `${toolLine(`${worktree}\\src\\two.js`, { id: 'two' })}\n`)
    const reopened = await waitFor(
      () =>
        frames
          .filter((frame) => frame.type === 'heartbeat.run.status' && frame.payload.status === 'running')
          .slice(1)[0],
      { what: 'the reopened running status' }
    )
    expect(reopened.payload.runId).toBe(ended.payload.runId)
    await waitFor(() => logFrames(frames).length === 2, { what: 'the later line' })
    expect(logFrames(frames)[1].payload.seq).toBe(2)
  })

  it('waits for the lane lock before a quiet end (X4)', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    const worktree = join(base, 'MachineRoom-opencode3')
    const lanes = lanesFor({ opencode: worktree })
    const { frames } = startSource({ runs, lanes, quietMs: 120 })
    writeFileSync(join(runs, 'opencode.lock'), String(process.pid))
    writeFileSync(join(runs, 'opencode-S6a-20261024-131000.log'), `${toolLine(`${worktree}\\src\\a.js`)}\n`)

    await sleep(400)
    expect(endFrame(frames)).toBeUndefined()

    rmSync(join(runs, 'opencode.lock'), { force: true })
    const ended = await waitFor(() => endFrame(frames), { what: 'the quiet end after the lock' })
    expect(ended.payload).toMatchObject({ status: 'failed', error: 'no record' })
  })

  it('emits the held last line before the run ends (X5)', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    const worktree = join(base, 'MachineRoom-opencode3')
    const lanes = lanesFor({ opencode: worktree })
    const { frames } = startSource({ runs, lanes })
    const logPath = join(runs, 'opencode-S6a-20261024-131500.log')
    const first = toolLine(`${worktree}\\src\\a.js`, { id: 'first' })
    const second = toolLine(`${worktree}\\src\\b.js`, { id: 'second' })
    writeFileSync(logPath, `${first}\n${second}`)

    await waitFor(() => logFrames(frames).length === 1, { what: 'the first line' })
    appendFileSync(join(runs, 'runs.jsonl'), `${JSON.stringify({ log: logPath, exitCode: 0, killed: false })}\n`)
    const ended = await waitFor(() => endFrame(frames), { what: 'the end' })
    expect(ended.payload.status).toBe('succeeded')
    const logs = logFrames(frames)
    expect(logs).toHaveLength(2)
    expect(logs[1].payload.chunk).toBe(`${second}\n`)
  })

  it('sends a log frame only for a line the reader marks read (X6)', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    const worktree = join(base, 'MachineRoom-opencode3')
    const lanes = lanesFor({ opencode: worktree })
    const { frames } = startSource({ runs, lanes })
    const logPath = join(runs, 'opencode-S6a-20261024-132000.log')
    writeFileSync(logPath, `{"type":"text","part":{"text":"thinking"}}\n${toolLine(`${worktree}\\src\\a.js`)}\n`)

    await waitFor(() => logFrames(frames).length === 1, { what: 'the tool line' })
    await sleep(100)
    expect(logFrames(frames)).toHaveLength(1)
    expect(logFrames(frames)[0].payload.seq).toBe(1)
  })

  it('keeps an open run queued and running frames in the bridge history (X6)', async () => {
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
    const lines = []
    for (let index = 0; index < 505; index += 1) {
      lines.push(toolLine(`${worktree}\\src\\f${index}.js`, { id: `call-${index}` }))
    }
    writeFileSync(join(runs, 'opencode-S6a-20261024-132500.log'), `${lines.join('\n')}\n`)

    const frames = await readFrames(url, (list) => list.length >= 500, { timeoutMs: 20000 })
    expect(frames[0].type).toBe('heartbeat.run.queued')
    expect(frames[1].type).toBe('heartbeat.run.status')
    expect(frames[1].payload).toMatchObject({ status: 'running' })
    expect(frames.filter((frame) => frame.type === 'heartbeat.run.log')).toHaveLength(498)
  })

  it('reads the run records again only after the file changed, and only the appended bytes (X13)', () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    const file = join(runs, 'runs.jsonl')
    const firstLog = join(runs, 'a.log')
    const secondLog = join(runs, 'b.log')
    writeFileSync(file, `${JSON.stringify({ log: firstLog, exitCode: 0 })}\n`)
    const cache = createRecordsCache(file)
    const first = cache.read()
    expect([...first.values()].map((record) => record.exitCode)).toEqual([0])
    expect(cache.reads).toBe(1)
    expect(cache.read()).toBe(first)
    expect(cache.reads).toBe(1)

    appendFileSync(file, `${JSON.stringify({ log: secondLog, exitCode: 1 })}\n`)
    const second = cache.read()
    expect(cache.reads).toBe(2)
    expect([...second.values()].map((record) => record.exitCode).sort((left, right) => left - right)).toEqual([0, 1])

    const thirdRecord = JSON.stringify({ log: firstLog, exitCode: 2 })
    appendFileSync(file, thirdRecord.slice(0, 10))
    const partial = cache.read()
    expect(cache.reads).toBe(3)
    expect(partial.size).toBe(2)
    appendFileSync(file, `${thirdRecord.slice(10)}\n`)
    const third = cache.read()
    expect(cache.reads).toBe(4)
    expect([...third.values()].map((record) => record.exitCode).sort((left, right) => left - right)).toEqual([1, 2])

    const before = statSync(file)
    writeFileSync(file, readFileSync(file, 'utf8').replace('"exitCode":2', '"exitCode":3'))
    utimesSync(file, before.atime, new Date(before.mtimeMs + 2000))
    const rewritten = cache.read()
    expect([...rewritten.values()].map((record) => record.exitCode).sort((left, right) => left - right)).toEqual([1, 3])
  })

  it('drops a held partial line past 1 MB and reads on from the next newline (X14)', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    const worktree = join(base, 'MachineRoom-opencode3')
    const lanes = lanesFor({ opencode: worktree })
    const { frames } = startSource({ runs, lanes })
    const logPath = join(runs, 'opencode-S6a-20261024-133000.log')
    writeFileSync(logPath, 'x'.repeat(1024 * 1024 + 2048))

    await sleep(200)
    expect(logFrames(frames)).toHaveLength(0)

    const line = toolLine(`${worktree}\\src\\a.js`)
    appendFileSync(logPath, `\n${line}\n`)
    await waitFor(() => logFrames(frames).length === 1, { what: 'the line after the huge one' })
    expect(logFrames(frames)[0].payload.chunk).toBe(`${line}\n`)
  })

  it('shows a worktree run when the room root is the repository main checkout (X15)', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    const main = join(base, 'MachineRoom')
    mkdirSync(main, { recursive: true })
    git(main, ['init'])
    git(main, ['commit', '--allow-empty', '-m', 'base'])
    const worktree = join(base, 'MachineRoom-opencode3')
    git(main, ['worktree', 'add', '--detach', worktree])
    expect(resolve(mainCheckoutOf(worktree)).toLowerCase()).toBe(resolve(main).toLowerCase())

    const lanes = lanesFor({ opencode: worktree })
    const { frames } = startSource({ runs, projectRoot: main, repoRoot: worktree, lanes })
    writeFileSync(join(runs, 'opencode-S6a-20261024-133500.log'), `${toolLine(`${worktree}\\src\\a.js`)}\n`)
    await waitFor(() => logFrames(frames).length === 1, { what: 'the worktree run' })
    expect(JSON.parse(logFrames(frames)[0].payload.chunk).part.state.input.path.replace(/\\/g, '/')).toBe(
      `${main.replace(/\\/g, '/')}/src/a.js`
    )
  })

  it('shows a project run in another worktree of the room root repository, on the root paths (S9)', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    const main = join(base, 'Game')
    mkdirSync(main, { recursive: true })
    git(main, ['init'])
    git(main, ['commit', '--allow-empty', '-m', 'base'])
    const worktree = join(base, 'Game-opencode')
    git(main, ['worktree', 'add', '--detach', worktree])
    const other = join(base, 'Elsewhere')
    mkdirSync(other, { recursive: true })
    git(other, ['init'])

    const { frames } = startSource({ runs, projectRoot: main, repoRoot: join(base, 'MachineRoom'), lanes: lanesFor({ opencode: join(base, 'MachineRoom-opencode') }) })
    writeFileSync(join(runs, 'opencode-elsewhere-20261024-140000.meta.json'), JSON.stringify({ project: other }))
    writeFileSync(join(runs, 'opencode-elsewhere-20261024-140000.log'), `${toolLine(`${other}\\src\\b.js`)}\n`)
    writeFileSync(join(runs, 'opencode-queue-20261024-140001.meta.json'), JSON.stringify({ project: worktree }))
    writeFileSync(join(runs, 'opencode-queue-20261024-140001.log'), `${toolLine(`${worktree}\\src\\a.js`)}\n`)
    await waitFor(() => logFrames(frames).length === 1, { what: 'the worktree project run' })
    expect(JSON.parse(logFrames(frames)[0].payload.chunk).part.state.input.path.replace(/\\/g, '/')).toBe(
      `${main.replace(/\\/g, '/')}/src/a.js`
    )
    expect(frames.some((frame) => frame.payload?.runId === 'run-opencode-elsewhere-20261024-140000')).toBe(false)
  })

  it('registers the lane parsers at bridge start without asking a Paperclip for agents (X16)', async () => {
    const base = tempDir()
    const runs = join(base, 'runs')
    const projectRoot = join(base, 'MachineRoom')
    mkdirSync(projectRoot, { recursive: true })
    const worktree = join(base, 'MachineRoom-opencode3')
    const lanes = lanesFor({ opencode: worktree })
    const requests = []
    const upstream = createServer((req, res) => {
      requests.push(req.url ?? '')
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end('{}')
    })
    cleanups.push(
      () =>
        new Promise((resolveClose) => {
          upstream.closeAllConnections()
          upstream.close(() => resolveClose())
        })
    )
    await new Promise((resolveListen) => upstream.listen(0, '127.0.0.1', resolveListen))
    const bridge = createBridge({
      paperclipUrl: `http://127.0.0.1:${upstream.address().port}`,
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

    const agents = await fetch(`${url}/api/agents`).then((response) => response.json())
    expect(agents.some((agent) => agent.key === 'opencode')).toBe(true)
    expect(requests.filter((path) => path.endsWith('/agents'))).toEqual([])

    writeFileSync(join(runs, 'opencode-S6a-20261024-134000.log'), `${toolLine(`${worktree}\\src\\a.js`)}\n`)
    const frames = await readFrames(url, (list) => list.some((frame) => frame.type === 'heartbeat.run.log'))
    expect(frames).toHaveLength(3)
    await sleep(300)
    expect(requests).toEqual([])
  })
})
