import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { agentsFile, createRunLineReader, framesFromRun } from '../src/briefs/recording.js'
import { buildActivities, createPipeline } from '../src/model/pipeline.js'
import { createPlayer } from '../src/model/player.js'
import { prepare } from '../src/model/source.js'
import { apply, createState } from '../src/model/state.js'
import { loadRecording } from './helpers.js'

const recording = loadRecording()
const { frames, activities, agents, tree } = recording

describe('recorded run', () => {
  it('produces the same activities when frames arrive one by one', () => {
    const pipeline = createPipeline({ agents, tree })
    const streamed = []
    for (const frame of frames) {
      streamed.push(...pipeline.push(frame))
    }
    streamed.push(...pipeline.flush())
    expect(streamed).toEqual(buildActivities(frames, { agents, tree }))
    expect(streamed).toEqual(activities)
  })

  it('keeps activity times non-decreasing when a frame arrives slightly out of order', () => {
    const pipeline = createPipeline({ agents, tree })
    const first = pipeline.push({
      id: 1,
      type: 'heartbeat.run.status',
      createdAt: '2026-10-17T12:00:05.000Z',
      payload: { runId: 'r1', agentId: agents[0].id, status: 'running' },
    })
    const second = pipeline.push({
      id: 2,
      type: 'heartbeat.run.queued',
      createdAt: '2026-10-17T12:00:04.000Z',
      payload: { runId: 'r2', agentId: agents[1].id },
    })
    expect(second[0].time).toBeGreaterThanOrEqual(first[0].time)
  })

  it('flushes buffered partial lines on flush', () => {
    const claude = agents.find((a) => a.key === 'claude')
    const pipeline = createPipeline({ agents, tree })
    const line = JSON.stringify({
      type: 'acpx.tool_call',
      name: 'Read src\\math.js',
      toolCallId: 't1',
      tag: 'tool_call_update',
    })
    expect(
      pipeline.push({
        id: 10,
        type: 'heartbeat.run.log',
        createdAt: '2026-10-17T12:00:00.000Z',
        payload: { runId: 'r-flush', agentId: claude.id, stream: 'stdout', seq: 1, ts: '2026-10-17T12:00:00.000Z', chunk: line },
      })
    ).toEqual([])
    const flushed = pipeline.flush()
    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toMatchObject({ type: 'tool.start', agent: 'claude', label: 'read src/math.js' })
  })

  it('produces activities in time order', () => {
    for (let i = 1; i < activities.length; i++) {
      expect(activities[i].time).toBeGreaterThanOrEqual(activities[i - 1].time)
    }
    expect(activities.length).toBeGreaterThan(100)
  })

  it('gives every agent at least one tool call', () => {
    for (const agent of agents) {
      expect(activities.some((a) => a.agent === agent.key && a.type === 'tool.start')).toBe(true)
    }
  })

  it('pairs every tool end with an earlier start', () => {
    const started = new Set()
    for (const a of activities) {
      if (a.type === 'tool.start') started.add(`${a.runId}:${a.id}`)
      if (a.type === 'tool.end') expect(started.has(`${a.runId}:${a.id}`)).toBe(true)
    }
  })

  it('keeps the setup failures as failed runs with a reason', () => {
    const failed = activities.filter((a) => a.type === 'run.end' && !a.ok)
    expect(failed.length).toBeGreaterThanOrEqual(4)
    failed.forEach((a) => expect(a.error).toBeTruthy())
  })
})

describe('final state of the recording', () => {
  const state = createState(tree, agents)
  activities.forEach((a) => apply(state, a))

  it('ends with every agent finished', () => {
    for (const agent of agents) expect(state.agents.get(agent.key).status).toBe('done')
  })

  it('marks the files each agent wrote as finished work', () => {
    for (const path of ['src/math.js', 'src/strings.js', 'docs/agy-report.md', 'docs/hermes-summary.md', 'test/strings.test.js']) {
      const file = state.files.get(path)
      expect(file.exists).toBe(true)
      expect(file.yellow).toBe(true)
    }
  })

  it('opens the folders the agents worked in', () => {
    for (const path of ['', 'src', 'docs', 'test']) expect(state.dirs.get(path).opened).toBe(true)
  })

  it('shows a red agent after a failed run and recovers on the next one', () => {
    const live = createState(tree, agents)
    const firstFailure = activities.findIndex((a) => a.agent === 'opencode' && a.type === 'run.end' && !a.ok)
    activities.slice(0, firstFailure + 1).forEach((a) => apply(live, a))
    expect(live.agents.get('opencode').status).toBe('error')
    const nextStart = activities.findIndex((a, i) => i > firstFailure && a.agent === 'opencode' && a.type === 'run.start')
    apply(live, activities[nextStart])
    expect(live.agents.get('opencode').status).toBe('working')
  })
})

const lanes = JSON.parse(readFileSync(new URL('../docs/agents/lanes.json', import.meta.url), 'utf8'))
const agyChunks = readFileSync(new URL('../public/fixtures/scenario-g-run.jsonl', import.meta.url), 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line))
  .filter((frame) => frame.type === 'heartbeat.run.log')
  .map((frame) => frame.payload.chunk)
const agyLines = agyChunks.map((chunk) => chunk.replace(/\r?\n$/, ''))

describe('AGY as a lane', () => {
  it('names the AGY agent with the process adapter the parser picker reads as AGY', () => {
    expect(agentsFile('agy', lanes)).toEqual({
      projectRoot: 'MachineRoom-agy',
      agents: [{ id: 'agent-agy', key: 'agy', name: 'agy', adapterType: 'process', parser: 'agy' }],
    })
  })

  it('marks the scenario-g lines that the AGY parser turns into activities as read', () => {
    const readLine = createRunLineReader('agy')
    const entries = agyLines.map((line) => readLine(line))
    const read = entries.filter((entry) => entry?.read)
    expect(read).toHaveLength(19)
    expect(read[0].chunk).toBe(`${agyLines[4]}\n`)
    expect(read[0].at).toBeNull()
    expect(read.every((entry) => entry.chunk.endsWith('\n'))).toBe(true)
    expect(entries[0]).toMatchObject({ read: false })
    expect(entries[agyLines.length - 1]).toMatchObject({ read: false })
    expect(readLine('')).toBeNull()
  })

  it('builds the frames of an AGY log after the running frame', () => {
    const log = agyLines.slice(4, 6).join('\n')
    const record = { lane: 'agy', startedAt: '2026-10-23T16:39:12.299Z', minutes: 1, exitCode: 0, killed: false }
    const frames = framesFromRun({ harness: 'agy', log, record })
    expect(frames.map((frame) => frame.type)).toEqual([
      'heartbeat.run.queued',
      'heartbeat.run.status',
      'heartbeat.run.log',
      'heartbeat.run.log',
      'heartbeat.run.status',
    ])
    expect(frames[0].payload.agentId).toBe('agent-agy')
    expect(frames[1].payload.status).toBe('running')
    expect(frames[2].payload.chunk).toBe(`${agyLines[4]}\n`)
    expect(Date.parse(frames[2].createdAt)).toBeGreaterThan(Date.parse(frames[1].createdAt))
    expect(frames[frames.length - 1].payload).toMatchObject({ status: 'succeeded', error: null })
  })
})

describe('Claude Code as a lane', () => {
  const claudeChunks = readFileSync(new URL('../public/fixtures/scenario-h-run.jsonl', import.meta.url), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line))
    .filter((frame) => frame.type === 'heartbeat.run.log')
    .map((frame) => frame.payload.chunk)
  const claudeLines = claudeChunks.map((chunk) => chunk.replace(/\r?\n$/, ''))

  it('names the Claude agent with the claude_local adapter the parser picker reads as Claude', () => {
    expect(agentsFile('claude', lanes)).toEqual({
      projectRoot: 'MachineRoom-claude',
      agents: [{ id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', parser: 'claude' }],
    })
  })

  it('marks the scenario-h lines that the Claude parser turns into activities as read', () => {
    const readLine = createRunLineReader('claude')
    const entries = claudeLines.map((line) => readLine(line))
    const read = entries.filter((entry) => entry?.read)
    expect(read).toHaveLength(28)
    expect(read[0].chunk).toBe(`${claudeLines[1]}\n`)
    expect(read[0].at).toBeNull()
    expect(read.every((entry) => entry.chunk.endsWith('\n'))).toBe(true)
    expect(entries[0]).toMatchObject({ read: false })
    expect(entries[claudeLines.length - 1]).toMatchObject({ read: false })
  })

  it('builds the frames of a Claude log', () => {
    const log = claudeLines.join('\n')
    const record = { lane: 'claude', startedAt: '2026-10-24T09:11:59.000Z', minutes: 3, exitCode: 0, killed: false }
    const frames = framesFromRun({ harness: 'claude', log, record })
    expect(frames).toHaveLength(31)
    expect(frames[0].payload.agentId).toBe('agent-claude')
    expect(frames[1].payload.status).toBe('running')
    expect(frames[2].payload.chunk).toBe(`${claudeLines[1]}\n`)
    expect(frames[frames.length - 1].payload).toMatchObject({ status: 'succeeded', error: null })

    const agents = agentsFile('claude', lanes)
    const tree = { root: 'agent-sandbox', files: ['src/math.js', 'src/strings.js', 'docs/claude-notes.md', 'docs/notes.md', 'package.json', 'test/math.test.js'] }
    const { activities } = prepare({ frames, agentsFile: agents, treeFile: tree })
    const starts = activities.filter((activity) => activity.type === 'tool.start')
    expect(starts.length).toBeGreaterThan(0)
    expect(starts.some((activity) => activity.label.startsWith('write '))).toBe(true)
  })
})

describe('player', () => {
  const span = activities[activities.length - 1].time - activities[0].time

  it('compresses long idle gaps', () => {
    const player = createPlayer({ activities, tree, agents })
    expect(player.duration).toBeLessThan(span)
  })

  it('reaches the same state by seeking as by playing', () => {
    const played = createPlayer({ activities, tree, agents })
    played.play()
    played.tick(played.duration + 1000)
    const sought = createPlayer({ activities, tree, agents })
    sought.seek(sought.duration)
    const summary = (player) => [...player.state.agents.values()].map((a) => `${a.key}:${a.status}:${a.lines.length}`)
    expect(summary(sought)).toEqual(summary(played))
  })

  it('goes back in time by rebuilding the state', () => {
    const player = createPlayer({ activities, tree, agents })
    player.seek(player.duration)
    player.seek(0)
    const statuses = [...player.state.agents.values()].map((a) => a.status)
    expect(statuses.every((status) => status === 'idle' || status === 'queued')).toBe(true)
    expect(player.position).toBe(0)
  })

  it('stops at the end', () => {
    const player = createPlayer({ activities, tree, agents })
    player.play()
    player.tick(player.duration * 2)
    expect(player.playing).toBe(false)
    expect(player.position).toBe(player.duration)
  })

  it('tells the scene about every activity once while playing', () => {
    const seen = []
    const player = createPlayer({ activities, tree, agents, onActivity: (a) => seen.push(a) })
    player.play()
    player.tick(player.duration * 2)
    expect(seen.length).toBe(activities.length)
  })
})
