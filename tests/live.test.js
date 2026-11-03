import { describe, expect, it } from 'vitest'
import { createLivePlayer } from '../src/live/livePlayer.js'
import { diffRoster, loadAgents, parserFor, toAgents } from '../src/live/source.js'
import { makeTree } from '../src/model/paths.js'
import { RUN_IDLE_MS, SEEN_LIMIT, buildActivities, createPipeline } from '../src/model/pipeline.js'
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

  it('marks the two session readers, and only them', () => {
    const agents = toAgents([
      { id: 'a', name: 'OpenCode', adapterType: 'opencode_local', key: 'opencode' },
      { id: 'b', name: 'Claude Code session', adapterType: 'claude_local', key: 'claude-session' },
      { id: 'c', name: 'OpenCode session', adapterType: 'opencode_local', key: 'opencode-session' },
    ])
    expect(Object.fromEntries(agents.map((agent) => [agent.key, agent.sessionReader]))).toEqual({
      'claude-session': true,
      'opencode-session': true,
      opencode: false,
    })
  })
})

describe('reading the agent list again', () => {
  it('asks the bridge for /api/agents and reads the roster', async () => {
    const calls = []
    const fetchImpl = async (url) => {
      calls.push(url)
      return {
        ok: true,
        json: async () => [
          { id: 'a', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local' },
          { id: 'b', key: 'claude-session', name: 'Claude Code session', adapterType: 'claude_local' },
        ],
      }
    }
    const agents = await loadAgents('http://127.0.0.1:3100', fetchImpl)
    expect(calls).toEqual(['http://127.0.0.1:3100/api/agents'])
    expect(agents.map((agent) => [agent.key, agent.sessionReader])).toEqual([
      ['claude-session', true],
      ['opencode', false],
    ])
  })

  it('fails when the bridge does not answer', async () => {
    await expect(loadAgents('http://127.0.0.1:3100', async () => ({ ok: false, status: 500 }))).rejects.toThrow('500')
  })
})

describe('the roster diff', () => {
  const lane = (key) => ({ key, name: key })

  it('finds a new and a gone agent and leaves the rest alone', () => {
    const diff = diffRoster([lane('opencode'), lane('claude')], [lane('opencode'), lane('hermes')])
    expect(diff.added.map((agent) => agent.key)).toEqual(['hermes'])
    expect(diff.removed.map((agent) => agent.key)).toEqual(['claude'])
    expect(diff.reordered).toBe(false)
    expect(diff.changed).toBe(true)
  })

  it('reports no change for the same roster', () => {
    const roster = [lane('opencode'), lane('claude')]
    const diff = diffRoster(roster, roster.map((agent) => ({ ...agent })))
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
    expect(diff.reordered).toBe(false)
    expect(diff.changed).toBe(false)
  })

  it('reports a reorder of the same agents, since the slots follow the roster order', () => {
    const diff = diffRoster([lane('opencode'), lane('claude')], [lane('claude'), lane('opencode')])
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
    expect(diff.reordered).toBe(true)
    expect(diff.changed).toBe(true)
  })

  it('copes with a missing or empty list', () => {
    expect(diffRoster(null, [lane('opencode')])).toMatchObject({ changed: true })
    expect(diffRoster([lane('opencode')], null)).toMatchObject({ changed: true })
    expect(diffRoster([], [])).toMatchObject({ changed: false })
  })
})

describe('incremental pipeline', () => {
  it('gives the same activities as the batch pipeline', () => {
    const pipeline = createPipeline({ agents: recording.agents, tree: recording.tree })
    const live = [...recording.frames.flatMap((frame) => pipeline.push(frame)), ...pipeline.flush()]
    const batch = buildActivities(recording.frames, { agents: recording.agents, tree: recording.tree })
    expect(live).toEqual(batch)
  })

  it('reads one orchestrator message frame as one agent.message activity', () => {
    const pipeline = createPipeline({ agents: recording.agents, tree: recording.tree })
    const at = '2026-10-20T00:00:00.000Z'
    const frame = {
      id: 'message-1',
      companyId: 'company-orchestrator',
      type: 'orchestrator.message',
      createdAt: at,
      payload: { from: 'orchestrator', to: 'sub-front', kind: 'order', ts: at },
    }
    const activities = pipeline.push(frame)
    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({
      type: 'agent.message',
      agent: 'orchestrator',
      to: 'sub-front',
      kind: 'order',
      runId: null,
      time: Date.parse(at),
    })
    expect(Number.isInteger(activities[0].order)).toBe(true)
    expect(pipeline.push(frame)).toEqual([])
    expect(pipeline.push({ ...frame, id: 'message-2', payload: { ...frame.payload, kind: 'talk' } })).toEqual([])
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

  it('forgets a run after 30 minutes without a frame and starts a new parser for it', () => {
    const pipeline = createPipeline({ agents: recording.agents, tree: recording.tree })
    const agent = recording.agents.find((entry) => entry.key === 'claude')
    const base = Date.parse('2026-10-20T00:00:00Z')
    const at = (ms) => new Date(base + ms).toISOString()
    const read = (id) => `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: 'src/math.js' } }] } })}\n`
    const frame = (id, type, ms, payload) => ({
      id,
      type,
      createdAt: at(ms),
      payload: { agentId: agent.id, ...payload },
    })

    pipeline.push(frame('s1', 'heartbeat.run.status', 0, { runId: 'idle-run', status: 'running' }))
    pipeline.push(frame('l1', 'heartbeat.run.log', 1000, { runId: 'idle-run', stream: 'stdout', seq: 1, ts: at(1000), chunk: read('old-call') }))
    expect(pipeline.remembered()).toMatchObject({ runs: 1, parsers: 1 })

    pipeline.push(frame('s2', 'heartbeat.run.status', RUN_IDLE_MS, { runId: 'other-run', status: 'running' }))
    expect(pipeline.remembered()).toMatchObject({ runs: 2, parsers: 1 })

    pipeline.push(frame('s3', 'heartbeat.run.status', RUN_IDLE_MS + 1001, { runId: 'other-run', status: 'succeeded' }))
    expect(pipeline.remembered()).toMatchObject({ runs: 0, parsers: 0 })

    const out = pipeline.push(
      frame('l2', 'heartbeat.run.log', RUN_IDLE_MS + 2000, { runId: 'idle-run', stream: 'stdout', seq: 2, ts: at(RUN_IDLE_MS + 2000), chunk: read('new-call') })
    )
    expect(out.filter((activity) => activity.type === 'tool.start').map((activity) => activity.id)).toEqual(['new-call'])
    expect(pipeline.remembered()).toMatchObject({ runs: 1, parsers: 1 })
  })

  it('drops a half line held by a run parser that went idle', () => {
    const pipeline = createPipeline({ agents: recording.agents, tree: recording.tree })
    const agent = recording.agents.find((entry) => entry.key === 'claude')
    const base = Date.parse('2026-10-20T00:00:00Z')
    const at = (ms) => new Date(base + ms).toISOString()
    const full = `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'half', name: 'Read', input: { file_path: 'src/math.js' } }] } })}\n`
    const frame = (id, ms, seq, chunk) => ({
      id,
      type: 'heartbeat.run.log',
      createdAt: at(ms),
      payload: { agentId: agent.id, runId: 'half-run', stream: 'stdout', seq, ts: at(ms), chunk },
    })

    expect(pipeline.push(frame('h1', 0, 1, full.slice(0, 30)))).toEqual([])
    pipeline.push({
      id: 'h2',
      type: 'heartbeat.run.status',
      createdAt: at(RUN_IDLE_MS + 1),
      payload: { agentId: agent.id, runId: 'other-run', status: 'running' },
    })
    expect(pipeline.remembered()).toMatchObject({ runs: 1, parsers: 0 })
    expect(pipeline.push(frame('h3', RUN_IDLE_MS + 1000, 2, full.slice(30)))).toEqual([])
    expect(pipeline.flush().filter((activity) => activity.type === 'tool.start')).toEqual([])
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
