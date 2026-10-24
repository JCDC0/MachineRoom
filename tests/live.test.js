import { describe, expect, it } from 'vitest'
import { createLivePlayer } from '../src/live/livePlayer.js'
import { openStream, parserFor, socketUrl, toAgents } from '../src/live/source.js'
import { makeTree } from '../src/model/paths.js'
import { SEEN_LIMIT, buildActivities, createPipeline } from '../src/model/pipeline.js'
import { createPlayer } from '../src/model/player.js'
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

  it('carries the role or null', () => {
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

  it('keeps the harness and model the bridge reports', () => {
    const [agent] = toAgents([
      {
        id: 'a',
        name: 'OpenCode',
        adapterType: 'opencode_local',
        harness: 'opencode',
        model: 'opencode-go/deepseek-v4.1-flash',
      },
    ])
    expect(agent).toMatchObject({ harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' })
  })

  it('keeps the key and the sub orchestrator flag the bridge sends', () => {
    const agents = toAgents([
      { id: 'lane', name: 'Claude Code', adapterType: 'claude_local', key: 'claude' },
      { id: 'sub', name: 'Frontend', adapterType: 'claude_local', key: 'sub-frontend', subOrchestrator: true },
    ])
    expect(Object.fromEntries(agents.map((agent) => [agent.id, agent.key]))).toEqual({
      lane: 'claude',
      sub: 'sub-frontend',
    })
    expect(Object.fromEntries(agents.map((agent) => [agent.id, agent.subOrchestrator]))).toEqual({
      lane: false,
      sub: true,
    })
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

  const KEY = 'sk-' + 'q'.repeat(40)

  function logFrame(id, chunk, { runId = 'run-1', stream = 'stdout', seq = id } = {}) {
    return {
      id,
      type: 'heartbeat.run.log',
      createdAt: '2026-10-22T10:00:00.000Z',
      payload: { runId, agentId: 'agent-1', seq, stream, chunk },
    }
  }

  function statusFrame(id) {
    return {
      id,
      type: 'heartbeat.run.status',
      createdAt: '2026-10-22T10:00:01.000Z',
      payload: { runId: 'run-1', status: 'running' },
    }
  }

  function maskingHarness() {
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
    let clock = 0
    let nextId = 1
    const timers = new Map()
    const frames = []
    const statuses = []
    const link = openStream({
      url: 'ws://x',
      onFrame: (frame) => frames.push(frame),
      onStatus: (status) => statuses.push(status),
      WebSocketImpl: FakeSocket,
      setTimer: (fn, ms) => {
        const id = nextId
        nextId += 1
        timers.set(id, { fn, at: clock + ms, ms })
        return id
      },
      clearTimer: (id) => {
        timers.delete(id)
      },
      now: () => clock,
    })
    function advance(ms) {
      clock += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at > clock) continue
        timers.delete(id)
        timer.fn()
      }
    }
    return { sockets, timers, frames, statuses, link, advance }
  }

  it('masks a whole key in one chunk before onFrame sees it', () => {
    const { sockets, frames, timers } = maskingHarness()
    sockets[0].onmessage({ data: JSON.stringify(logFrame(1, `reading ${KEY} now`)) })
    expect(frames.map((frame) => frame.payload.chunk)).toEqual(['reading [key] now'])
    expect(JSON.stringify(frames)).not.toContain(KEY.slice(-20))
    expect(timers.size).toBe(0)
  })

  it('masks a key split across two chunks of one run and stream', () => {
    const { sockets, frames, timers } = maskingHarness()
    sockets[0].onmessage({ data: JSON.stringify(logFrame(1, `reading ${KEY.slice(0, 12)}`)) })
    expect(frames).toEqual([])
    expect(timers.size).toBe(1)
    sockets[0].onmessage({ data: JSON.stringify(logFrame(2, `${KEY.slice(12)} now`)) })
    expect(frames.map((frame) => frame.id)).toEqual([1, 2])
    expect(frames.map((frame) => frame.payload.chunk)).toEqual(['reading [key]', ' now'])
    expect(JSON.stringify(frames)).not.toContain(KEY.slice(-20))
    expect(timers.size).toBe(0)
  })

  it('releases a held frame on the timer after one second with no second chunk', () => {
    const { sockets, frames, timers, advance } = maskingHarness()
    sockets[0].onmessage({ data: JSON.stringify(logFrame(1, `reading ${KEY}`)) })
    expect(frames).toEqual([])
    expect([...timers.values()].map((timer) => timer.ms)).toEqual([1000])
    advance(999)
    expect(frames).toEqual([])
    advance(1)
    expect(frames.map((frame) => frame.payload.chunk)).toEqual(['reading [key]'])
    expect(timers.size).toBe(0)
  })

  it('keeps a status frame behind a held chunk in its place', () => {
    const { sockets, frames } = maskingHarness()
    sockets[0].onmessage({ data: JSON.stringify(logFrame(1, `reading ${KEY.slice(0, 12)}`)) })
    sockets[0].onmessage({ data: JSON.stringify(statusFrame(2)) })
    expect(frames).toEqual([])
    sockets[0].onmessage({ data: JSON.stringify(logFrame(3, `${KEY.slice(12)} now`, { seq: 2 })) })
    expect(frames.map((frame) => frame.id)).toEqual([1, 2, 3])
    expect(frames[0].payload.chunk).toBe('reading [key]')
  })

  it('passes a frame with no key through unchanged and at once', () => {
    const { sockets, frames, timers } = maskingHarness()
    const frame = statusFrame(1)
    sockets[0].onmessage({ data: JSON.stringify(frame) })
    expect(frames).toEqual([frame])
    expect(timers.size).toBe(0)
  })

  it('leaves no timer after close and drops the held frame', () => {
    const { sockets, frames, timers, link } = maskingHarness()
    sockets[0].onmessage({ data: JSON.stringify(logFrame(1, `reading ${KEY}`)) })
    expect(frames).toEqual([])
    expect(timers.size).toBe(1)
    link.close()
    expect(sockets[0].closed).toBe(true)
    expect(timers.size).toBe(0)
    expect(frames).toEqual([])
  })

  it('flushes a held frame before the new socket opens', () => {
    const { sockets, timers, frames } = maskingHarness()
    sockets[0].onmessage({ data: JSON.stringify(logFrame(1, `reading ${KEY}`)) })
    expect(frames).toEqual([])
    sockets[0].onclose()
    expect(frames.map((frame) => frame.payload.chunk)).toEqual(['reading [key]'])
    const reconnect = [...timers.values()][0]
    expect(reconnect.ms).toBe(1000)
    reconnect.fn()
    expect(sockets).toHaveLength(2)
    sockets[1].onmessage({ data: JSON.stringify(statusFrame(2)) })
    expect(frames.map((frame) => frame.id)).toEqual([1, 2])
  })

  it('starts a new line on the new socket, so a key at the start of its first chunk is masked', () => {
    const { sockets, timers, frames } = maskingHarness()
    sockets[0].onmessage({ data: JSON.stringify(logFrame(1, 'progress 40')) })
    expect(frames.map((frame) => frame.payload.chunk)).toEqual(['progress 40'])
    sockets[0].onclose()
    const reconnect = [...timers.values()][0]
    reconnect.fn()
    sockets[1].onmessage({ data: JSON.stringify(logFrame(2, `${KEY} printed`)) })
    expect(frames.map((frame) => frame.payload.chunk)).toEqual(['progress 40', '[key] printed'])
    expect(JSON.stringify(frames)).not.toContain(KEY.slice(3))
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

  it('opens a run again when a running status follows its end, and reads its later lines', () => {
    const line = recording.frames.find((frame, index) => {
      if (frame.type !== 'heartbeat.run.log') return false
      const probe = createPipeline({ agents: recording.agents, tree: recording.tree })
      return [...probe.push({ ...frame, payload: { ...frame.payload, runId: `probe${index}` } }), ...probe.flush()].some((activity) => activity.type.startsWith('tool.'))
    })
    const agent = recording.agents.find((item) => item.id === line.payload.agentId)
    const pipeline = createPipeline({ agents: recording.agents, tree: recording.tree })
    const status = (status, at) => ({ type: 'heartbeat.run.status', createdAt: at, payload: { agentId: agent.id, runId: 'r1', status } })
    const out = [
      ...pipeline.push(status('running', '2026-01-01T00:00:00Z')),
      ...pipeline.push(status('failed', '2026-01-01T00:10:00Z')),
      ...pipeline.push(status('running', '2026-01-01T00:11:00Z')),
      ...pipeline.push({ ...line, createdAt: '2026-01-01T00:11:01Z', payload: { ...line.payload, runId: 'r1', seq: 7, ts: '2026-01-01T00:11:01Z' } }),
      ...pipeline.push(status('succeeded', '2026-01-01T00:12:00Z')),
      ...pipeline.flush(),
    ].filter((activity) => activity.runId === 'r1')
    const types = out.map((activity) => activity.type)
    expect(types.filter((type) => type === 'run.start')).toHaveLength(2)
    expect(types.some((type) => type.startsWith('tool.'))).toBe(true)
    expect(out.filter((activity) => activity.type === 'run.end').map((activity) => activity.ok)).toEqual([false, true])
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

  it('drops a log chunk that comes after the run ended instead of opening the run again', () => {
    const pipeline = createPipeline({ agents: recording.agents, tree: recording.tree })
    const agent = recording.agents.find((entry) => entry.key === 'opencode')
    const at = (n) => new Date(Date.parse('2026-10-20T00:00:00Z') + n).toISOString()
    const read = `${JSON.stringify({ type: 'tool_use', part: { id: 'late', tool: 'read', state: { status: 'completed', input: { path: 'C:\\Temp\\agent-sandbox\\src\\math.js' }, output: 'x' } } })}\n`
    for (let run = 0; run < 50; run += 1) {
      const runId = `run-${run}`
      const base = { agentId: agent.id, runId }
      pipeline.push({ id: `q${run}`, type: 'heartbeat.run.queued', createdAt: at(run * 10), payload: base })
      pipeline.push({ id: `r${run}`, type: 'heartbeat.run.status', createdAt: at(run * 10 + 1), payload: { ...base, status: 'running' } })
      const live = pipeline.push({ id: `l${run}`, type: 'heartbeat.run.log', createdAt: at(run * 10 + 2), payload: { ...base, stream: 'stdout', seq: 1, chunk: read } })
      expect(live.map((activity) => activity.type)).toContain('tool.start')
      pipeline.push({ id: `s${run}`, type: 'heartbeat.run.status', createdAt: at(run * 10 + 3), payload: { ...base, status: 'succeeded' } })
      const late = pipeline.push({ id: `x${run}`, type: 'heartbeat.run.log', createdAt: at(run * 10 + 4), payload: { ...base, stream: 'stdout', seq: 2, chunk: read } })
      expect(late).toEqual([])
    }
    expect(pipeline.remembered()).toMatchObject({ runs: 0, parsers: 0 })
    expect(pipeline.flush()).toEqual([])
  })

  it('still reads the log of a run it joined after the start', () => {
    const pipeline = createPipeline({ agents: recording.agents, tree: recording.tree })
    const agent = recording.agents.find((entry) => entry.key === 'opencode')
    const read = `${JSON.stringify({ type: 'tool_use', part: { id: 'mid', tool: 'read', state: { status: 'completed', input: { path: 'C:\\Temp\\agent-sandbox\\src\\math.js' }, output: 'x' } } })}\n`
    const out = pipeline.push({ id: 'm1', type: 'heartbeat.run.log', createdAt: '2026-10-20T00:00:00Z', payload: { agentId: agent.id, runId: 'joined', stream: 'stdout', seq: 40, chunk: read } })
    expect(out.find((activity) => activity.type === 'tool.start').touches).toEqual([{ path: 'src/math.js', mode: 'read', kind: 'file' }])
    expect(pipeline.remembered()).toMatchObject({ runs: 1, parsers: 1 })
  })

  it('shows an error event that comes after the run ended without keeping the run open', () => {
    const pipeline = createPipeline({ agents: recording.agents, tree: recording.tree })
    const agent = recording.agents[0]
    const at = (n) => new Date(Date.parse('2026-10-20T00:00:00Z') + n).toISOString()
    for (let run = 0; run < 50; run += 1) {
      const runId = `run-${run}`
      pipeline.push({ id: `q${run}`, type: 'heartbeat.run.queued', createdAt: at(run * 10), payload: { agentId: agent.id, runId } })
      pipeline.push({ id: `f${run}`, type: 'heartbeat.run.status', createdAt: at(run * 10 + 1), payload: { agentId: agent.id, runId, status: 'failed' } })
      const late = pipeline.push({
        id: `x${run}`,
        type: 'heartbeat.run.event',
        createdAt: at(run * 10 + 2),
        payload: { agentId: agent.id, runId, seq: 1, level: 'error', message: 'spawn failed' },
      })
      expect(late).toEqual([expect.objectContaining({ type: 'error', agent: agent.key, text: 'spawn failed' })])
    }
    expect(pipeline.remembered().runs).toBe(0)
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
