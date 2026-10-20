import { describe, expect, it } from 'vitest'
import { treeFromState } from '../src/engine/layout.js'
import { createLivePlayer } from '../src/live/livePlayer.js'
import { discover, openStream, parserFor, rootNameOf, socketUrl, toAgents } from '../src/live/source.js'
import { makeTree } from '../src/model/paths.js'
import { SEEN_LIMIT, buildActivities, createPipeline } from '../src/model/pipeline.js'
import { createPlayer } from '../src/model/player.js'
import { createState } from '../src/model/state.js'
import { loadRecording } from './helpers.js'

const recording = loadRecording()

describe('agent discovery', () => {
  const raw = [
    { id: 'a', name: 'agy', adapterType: 'process', adapterConfig: { cwd: 'C:\\Temp\\agent-sandbox' } },
    { id: 'b', name: 'Claude Code', adapterType: 'claude_local', adapterConfig: {} },
    { id: 'c', name: 'Some Bot', adapterType: 'http', adapterConfig: {} },
  ]

  it('picks a parser from the adapter type or the agy name', () => {
    expect(parserFor(raw[0])).toBe('agy')
    expect(parserFor(raw[1])).toBe('claude')
    expect(parserFor(raw[2])).toBeNull()
  })

  it('orders known agents first and gives every agent its own key', () => {
    expect(toAgents(raw).map((agent) => agent.key)).toEqual(['claude', 'agy', 'some-bot'])
  })

  it('keeps two agents with the same parser apart', () => {
    const twins = [
      { id: '1', name: 'Orchestrator', adapterType: 'claude_local', role: 'ceo' },
      { id: '2', name: 'Claude Code', adapterType: 'claude_local', role: 'engineer' },
      { id: '3', name: 'Claude Code', adapterType: 'claude_local' },
    ]
    const agents = toAgents(twins)
    expect(new Set(agents.map((agent) => agent.key)).size).toBe(3)
    expect(Object.fromEntries(agents.map((agent) => [agent.id, agent.key]))).toEqual({
      1: 'claude',
      2: 'claude-code',
      3: 'claude-code-2',
    })
    expect(agents.every((agent) => agent.parser === 'claude')).toBe(true)
  })

  it('carries the Paperclip role or null', () => {
    const withRoles = [
      { id: '1', name: 'Claude Code', adapterType: 'claude_local', role: 'engineer' },
      { id: '2', name: 'Orchestrator', adapterType: 'claude_local', role: 'ceo' },
      { id: '3', name: 'Some Bot', adapterType: 'http' },
    ]
    expect(Object.fromEntries(toAgents(withRoles).map((agent) => [agent.id, agent.role]))).toEqual({
      1: 'engineer',
      2: 'ceo',
      3: null,
    })
  })

  it('takes the project name from the first agent folder', () => {
    expect(rootNameOf(raw)).toBe('agent-sandbox')
    expect(rootNameOf(raw, 'other')).toBe('other')
    expect(rootNameOf([])).toBe('project')
  })

  it('finds the first company when none is given', async () => {
    const calls = []
    const fetchImpl = async (url) => {
      calls.push(url)
      const body = url.endsWith('/api/companies') ? [{ id: 'c1' }] : raw
      return { ok: true, json: async () => body }
    }
    const found = await discover({ base: '/paperclip', fetchImpl })
    expect(found.companyId).toBe('c1')
    expect(found.rootName).toBe('agent-sandbox')
    expect(calls).toEqual(['/paperclip/api/companies', '/paperclip/api/companies/c1/agents'])
  })

  it('fails with a clear message when a request fails', async () => {
    const fetchImpl = async () => ({ ok: false, status: 502 })
    await expect(discover({ base: '/p', companyId: 'x', fetchImpl })).rejects.toThrow('answered 502')
  })
})

describe('socket url', () => {
  it('turns an http base into a websocket address', () => {
    expect(socketUrl('http://127.0.0.1:3100', 'c1')).toBe('ws://127.0.0.1:3100/api/companies/c1/events/ws')
    expect(socketUrl('https://host', 'c1')).toBe('wss://host/api/companies/c1/events/ws')
  })
})

describe('openStream', () => {
  function harness() {
    const sockets = []
    class FakeSocket {
      constructor(url) {
        this.url = url
        sockets.push(this)
      }
      close() {
        this.closed = true
        this.onclose?.()
      }
    }
    const timers = []
    const statuses = []
    const frames = []
    const link = openStream({
      url: 'ws://x',
      onFrame: (frame) => frames.push(frame),
      onStatus: (status) => statuses.push(status),
      WebSocketImpl: FakeSocket,
      setTimer: (fn, ms) => {
        timers.push({ fn, ms })
        return timers.length
      },
      clearTimer: () => {},
    })
    return { sockets, timers, statuses, frames, link }
  }

  it('reports live after the socket opens and passes frames on', () => {
    const { sockets, statuses, frames } = harness()
    sockets[0].onopen()
    sockets[0].onmessage({ data: JSON.stringify({ type: 'agent.status' }) })
    sockets[0].onmessage({ data: 'not json' })
    expect(statuses).toEqual(['connecting', 'live'])
    expect(frames).toEqual([{ type: 'agent.status' }])
  })

  it('reconnects with a growing delay and resets after a good connection', () => {
    const { sockets, timers, statuses } = harness()
    sockets[0].onclose()
    expect(statuses[statuses.length - 1]).toBe('reconnecting')
    expect(timers[0].ms).toBe(1000)
    timers[0].fn()
    sockets[1].onclose()
    expect(timers[1].ms).toBe(2000)
    timers[1].fn()
    sockets[2].onopen()
    sockets[2].onclose()
    expect(timers[2].ms).toBe(1000)
  })

  it('stops reconnecting once closed', () => {
    const { sockets, timers, link } = harness()
    link.close()
    expect(sockets[0].closed).toBe(true)
    expect(timers).toHaveLength(0)
  })
})

describe('incremental pipeline', () => {
  it('gives the same activities as the batch pipeline', () => {
    const pipeline = createPipeline({ agents: recording.agents, tree: recording.tree })
    const live = [...recording.frames.flatMap((frame) => pipeline.push(frame)), ...pipeline.flush()]
    const batch = buildActivities(recording.frames, { agents: recording.agents, tree: recording.tree })
    expect(live).toEqual(batch)
  })

  it('gives a frame with a time that does not parse the time before it, so the replay keeps going', () => {
    const frames = recording.frames.map((frame) => ({ ...frame, payload: { ...frame.payload } }))
    const bad = frames.findIndex((frame, index) => index > 0 && frame.type === 'heartbeat.run.status' && frame.payload.status === 'running')
    frames[bad].createdAt = 'not a date'
    const activities = buildActivities(frames, { agents: recording.agents, tree: recording.tree })
    expect(activities.every((activity) => Number.isFinite(activity.time))).toBe(true)
    const player = createPlayer({ activities, tree: recording.tree, agents: recording.agents })
    expect(Number.isFinite(player.duration)).toBe(true)
    player.seek(player.duration)
    const clean = createPlayer({ activities: recording.activities, tree: recording.tree, agents: recording.agents })
    clean.seek(clean.duration)
    expect(player.snapshot().agents.map((agent) => agent.status)).toEqual(clean.snapshot().agents.map((agent) => agent.status))
  })

  it('ignores frames from agents it does not know', () => {
    const pipeline = createPipeline({ agents: recording.agents, tree: recording.tree })
    expect(pipeline.push({ type: 'heartbeat.run.queued', createdAt: '2026-01-01T00:00:00Z', payload: { agentId: 'nobody' } })).toEqual([])
  })

  it('lets commands touch a file it has just learned', () => {
    const tree = makeTree({ root: 'agent-sandbox', files: [], created: [] })
    const pipeline = createPipeline({ agents: recording.agents, tree })
    pipeline.learn(['src/math.js'])
    expect(pipeline.context.files).toEqual(['src/math.js'])
    expect(pipeline.context.dirs).toEqual(['', 'src'])
  })

  it('keeps a bounded memory of the frames it has seen over a long session', () => {
    const pipeline = createPipeline({ agents: recording.agents, tree: recording.tree })
    const agentId = recording.agents[0].id
    const at = (n) => new Date(Date.parse('2026-10-20T00:00:00Z') + n).toISOString()
    for (let run = 0; run < 300; run += 1) {
      const runId = `run-${run}`
      pipeline.push({ id: `s${run}`, type: 'heartbeat.run.status', createdAt: at(run * 100), payload: { agentId, runId, status: 'running' } })
      for (let seq = 0; seq < 100; seq += 1) {
        pipeline.push({ id: `l${run}-${seq}`, type: 'heartbeat.run.log', createdAt: at(run * 100 + seq), payload: { agentId, runId, stream: 'stdout', seq, chunk: 'thinking\n' } })
      }
      pipeline.push({ id: `e${run}`, type: 'heartbeat.run.status', createdAt: at(run * 100 + 99), payload: { agentId, runId, status: 'succeeded' } })
    }
    expect(pipeline.remembered().keys).toBeLessThanOrEqual(SEEN_LIMIT)
    expect(pipeline.remembered().runs).toBe(0)
    const late = { id: 'e299', type: 'heartbeat.run.status', createdAt: at(29999), payload: { agentId, runId: 'run-299', status: 'succeeded' } }
    expect(pipeline.push(late)).toEqual([])
  })

  it('learns a large project again and again without slowing the page', () => {
    const files = Array.from({ length: 40000 }, (_, index) => `pkg${index % 200}/lib/file${index}.js`)
    const tree = makeTree({ root: 'big', files, created: [] })
    const pipeline = createPipeline({ agents: recording.agents, tree })
    const started = performance.now()
    for (let round = 0; round < 4; round += 1) pipeline.learn([...files, `new/file${round}.js`])
    expect(performance.now() - started).toBeLessThan(1000)
    expect(pipeline.context.files).toHaveLength(40004)
    expect(new Set(pipeline.context.files).size).toBe(40004)
    expect(pipeline.context.dirs.filter((dir) => dir === 'new')).toEqual(['new'])
  })
})

describe('live player', () => {
  const empty = makeTree({ root: 'agent-sandbox', files: [], created: [] })

  it('builds the room from a tree that starts empty', () => {
    const player = createLivePlayer({ tree: empty, agents: recording.agents })
    const pipeline = createPipeline({ agents: recording.agents, tree: empty })
    for (const frame of recording.frames) {
      player.push(pipeline.push(frame))
      pipeline.learn([...player.state.files.keys()])
    }
    for (const path of ['src/math.js', 'docs/agy-report.md', 'test/strings.test.js']) {
      expect(player.state.files.has(path)).toBe(true)
    }
    expect(player.state.dirs.get('src').opened).toBe(true)
  })

  it('reports a live snapshot with the link status', () => {
    const player = createLivePlayer({ tree: empty, agents: recording.agents })
    expect(player.snapshot()).toMatchObject({ live: true, playing: true, status: 'connecting' })
    player.setStatus('live')
    expect(player.snapshot().status).toBe('live')
  })

  it('tells the scene about every activity and the listeners about each push', () => {
    const seen = []
    let notified = 0
    const player = createLivePlayer({ tree: empty, agents: recording.agents, onActivity: (a) => seen.push(a.type) })
    player.subscribe(() => (notified += 1))
    player.push([{ type: 'run.start', agent: 'claude', runId: 'r1', time: 1 }])
    player.push([])
    expect(seen).toEqual(['run.start'])
    expect(notified).toBe(1)
    expect(player.state.agents.get('claude').status).toBe('working')
  })

  it('adds files that a bridge reports', () => {
    const player = createLivePlayer({ tree: empty, agents: recording.agents })
    player.addFiles(['a/b.js'])
    expect(player.state.files.get('a/b.js').exists).toBe(true)
    expect(player.state.dirs.has('a')).toBe(true)
  })

  it('ignores seek and pause', () => {
    const player = createLivePlayer({ tree: empty, agents: recording.agents })
    player.pause()
    player.seek(0)
    expect(player.playing).toBe(true)
  })
})

describe('treeFromState', () => {
  it('lists the files and folders the state knows, sorted', () => {
    const state = createState(makeTree({ root: 'r', files: ['b.js', 'a/c.js'], created: [] }), recording.agents)
    expect(treeFromState(state, 'r')).toEqual({ rootName: 'r', files: ['a/c.js', 'b.js'], dirs: ['', 'a'], created: [] })
  })
})
