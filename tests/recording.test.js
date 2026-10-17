import { describe, expect, it } from 'vitest'
import { buildActivities, createPipeline } from '../src/model/pipeline.js'
import { createPlayer } from '../src/model/player.js'
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
