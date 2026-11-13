import { appendFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildActivities, createPipeline } from '../src/model/pipeline.js'
import { apply, createState } from '../src/model/state.js'
import { resetRunState } from '../src/Stage.jsx'
import { getJson, readFrames, startLaneBridge, waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const KEY = 'sk-or-v1-' + '0123456789abcdef'.repeat(4)
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    try {
      await cleanup()
    } catch {}
  }
})

function tempDir(prefix = 'mr-bridge-stream-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function toolLine(path, { id = 'call-1', output = '' } = {}) {
  return JSON.stringify({
    type: 'tool_use',
    timestamp: Date.now(),
    part: { type: 'tool', id, tool: 'read', state: { status: 'completed', input: { path }, output } },
  })
}

function runRecord(lane, log, exitCode = 0) {
  return {
    lane,
    briefs: ['Y1c'],
    model: null,
    reasoning: null,
    startedAt: new Date(Date.now() - 30000).toISOString(),
    minutes: 0.5,
    exitCode,
    killed: false,
    costUsd: null,
    log,
    branch: '',
    commits: [],
  }
}

function writeRun(runsDir, name, lines, { exitCode = 0, lane = 'opencode', newline = true } = {}) {
  const log = join(runsDir, `${name}.log`)
  writeFileSync(log, lines.map((line) => `${line}${newline ? '\n' : ''}`).join(''))
  writeFileSync(join(runsDir, 'runs.jsonl'), `${JSON.stringify(runRecord(lane, log, exitCode))}\n`)
  return log
}

async function laneBridge(options = {}) {
  const started = await startLaneBridge({ ...options, lanesSource: { quietMs: 250, pollMs: 20, ...options.lanesSource } })
  cleanups.push(() => started.stop())
  return started
}

function parseSseBlock(block) {
  const out = { id: null, event: 'message', data: '' }
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('id:')) out.id = line.slice(3).trim()
    else if (line.startsWith('event:')) out.event = line.slice(6).trim()
    else if (line.startsWith('data:')) out.data += line.slice(5).trim()
  }
  return out
}

function openSse(url, headers = {}, query = '') {
  const events = []
  const waiters = []
  let buffer = ''
  let req = null

  function pushEvent(evt) {
    const waiter = waiters.shift()
    if (waiter && waiter.predicate(evt)) {
      clearTimeout(waiter.timer)
      waiter.resolve(evt)
    } else {
      if (waiter) waiters.unshift(waiter)
      events.push(evt)
    }
  }

  return new Promise((resolveOpen, rejectOpen) => {
    req = httpRequest(`${url}/events${query}`, { headers }, (res) => {
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        buffer += chunk
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          const trimmed = part.trim()
          if (!trimmed || trimmed.startsWith(':')) continue
          pushEvent(parseSseBlock(trimmed))
        }
      })
      resolveOpen({
        next(predicate = () => true, timeoutMs = 5000) {
          const existingIndex = events.findIndex(predicate)
          if (existingIndex !== -1) {
            const [found] = events.splice(existingIndex, 1)
            return Promise.resolve(found)
          }
          return new Promise((resolveWait, rejectWait) => {
            const timer = setTimeout(() => {
              const idx = waiters.indexOf(entry)
              if (idx !== -1) waiters.splice(idx, 1)
              rejectWait(new Error('timed out waiting for SSE event'))
            }, timeoutMs)
            const entry = { predicate, resolve: resolveWait, timer }
            waiters.push(entry)
          })
        },
        close() {
          req.destroy()
        },
      })
    })
    req.on('error', rejectOpen)
    req.end()
  })
}

async function sleep(ms) {
  await new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

const frameOf = (event) => JSON.parse(event.data)
const seqOf = (id) => Number(String(id).split(':').pop())

const SESSION_AGENT = { id: 'agent-session', key: 'session', name: 'Session', adapterType: 'claude_local', parser: 'claude' }
const OPENCODE_SESSION = { id: 'agent-session', key: 'session', name: 'Session', adapterType: 'opencode_local', parser: 'opencode' }

function frameSource(agent = SESSION_AGENT) {
  const state = { emit: () => {} }
  const reader = { agents: [agent], tick() {}, stop() {} }
  const make = ({ emit }) => {
    state.emit = emit
    return reader
  }
  return { state, make }
}

let nextFrameId = 1

function sessionFrame(type, payload) {
  return { id: nextFrameId++, companyId: 'company-session', type, createdAt: new Date().toISOString(), payload: { agentId: SESSION_AGENT.id, ...payload } }
}

function sessionLog(runId, seq, chunk) {
  return sessionFrame('heartbeat.run.log', { runId, seq, stream: 'stdout', chunk, truncated: false })
}

async function sourceBridge(agent = SESSION_AGENT) {
  const source = frameSource(agent)
  const started = await laneBridge({ bridge: { sessionsSource: { readers: [source.make], pollMs: 20 } } })
  return { ...started, send: (frame) => source.state.emit(frame) }
}

describe('frames over SSE', () => {
  it('streams frames over SSE and replays missed frames after Last-Event-ID', async () => {
    const runs = tempDir()
    const name = 'opencode-Y1c-20261024-130000'
    const { url } = await laneBridge({ runsDir: runs })
    const sse = await openSse(url)
    cleanups.push(() => sse.close())
    const log = join(runs, `${name}.log`)

    writeFileSync(log, `${toolLine('docs/a.md', { id: 'call-1' })}\n`)
    const first = await sse.next((event) => event.event === 'frame' && frameOf(event).type === 'heartbeat.run.log')
    expect(frameOf(first).payload.chunk).toContain('docs/a.md')
    sse.close()

    appendFileSync(log, `${toolLine('docs/b.md', { id: 'call-2' })}\n`)
    appendFileSync(log, `${toolLine('docs/c.md', { id: 'call-3' })}\n`)

    const replayed = await openSse(url, { 'Last-Event-ID': first.id })
    cleanups.push(() => replayed.close())
    const second = await replayed.next((event) => event.event === 'frame')
    const third = await replayed.next((event) => event.event === 'frame')
    expect(seqOf(second.id)).toBeGreaterThan(seqOf(first.id))
    expect(frameOf(second).payload.chunk).toContain('docs/b.md')
    expect(frameOf(third).payload.chunk).toContain('docs/c.md')
  })

  it('sends the kept history to a late join that asks with history=1', async () => {
    const runs = tempDir()
    const name = 'opencode-Y1c-20261024-130100'
    writeRun(runs, name, [toolLine('docs/a.md', { id: 'call-1' }), toolLine('docs/b.js', { id: 'call-2' })])
    const { url } = await laneBridge({ runsDir: runs })

    const late = await openSse(url, {}, '?history=1')
    cleanups.push(() => late.close())
    const history = []
    for (;;) {
      const event = await late.next((item) => item.event === 'frame')
      history.push(event)
      if (frameOf(event).payload?.status === 'succeeded') break
    }
    const logs = history.filter((event) => frameOf(event).type === 'heartbeat.run.log')
    expect(logs).toHaveLength(2)
    expect(frameOf(logs[0]).payload.chunk).toContain('docs/a.md')
    expect(frameOf(logs[1]).payload.chunk).toContain('docs/b.js')
  })

  it('sends no history to a client that does not ask', async () => {
    const runs = tempDir()
    const name = 'opencode-Y1c-20261024-130200'
    writeRun(runs, name, [toolLine('docs/a.md', { id: 'call-1' })])
    const { url } = await laneBridge({ runsDir: runs })
    await readFrames(url, (frames) => frames.some((frame) => frame.payload?.status === 'succeeded'))

    const late = await openSse(url)
    cleanups.push(() => late.close())
    await expect(late.next((event) => event.event === 'frame', 300)).rejects.toThrow('timed out waiting for SSE event')
  })

  it('resumes after Last-Event-ID on a reconnect and does not repeat the history', async () => {
    const runs = tempDir()
    const name = 'opencode-Y1c-20261024-130300'
    writeRun(runs, name, [toolLine('docs/a.md', { id: 'call-1' }), toolLine('docs/b.js', { id: 'call-2' })])
    const { url } = await laneBridge({ runsDir: runs })
    const history = []
    const stream = await openSse(url, {}, '?history=1')
    cleanups.push(() => stream.close())
    for (;;) {
      const event = await stream.next((item) => item.event === 'frame')
      history.push(event)
      if (frameOf(event).payload?.status === 'succeeded') break
    }
    const logs = history.filter((event) => frameOf(event).type === 'heartbeat.run.log')
    expect(logs.length).toBeGreaterThanOrEqual(2)

    const again = await openSse(url, { 'Last-Event-ID': logs[0].id }, '?history=1')
    cleanups.push(() => again.close())
    const first = await again.next((item) => item.event === 'reset' || item.event === 'frame')
    expect(first.event).toBe('frame')
    expect(first.id).toBe(logs[1].id)
    expect(frameOf(first)).toEqual(frameOf(logs[1]))
  })

  it('sends a reset and the current state of a live run to a cursor from another bridge', async () => {
    const { url, send } = await sourceBridge()
    const first = await openSse(url)
    cleanups.push(() => first.close())
    send(sessionFrame('heartbeat.run.queued', { runId: 'r1' }))
    await first.next((event) => event.event === 'frame' && frameOf(event).type === 'heartbeat.run.queued')
    send(sessionFrame('heartbeat.run.status', { runId: 'r1', status: 'running' }))
    const running = await first.next((event) => event.event === 'frame' && frameOf(event).payload?.status === 'running')
    first.close()

    const again = await openSse(url, { 'Last-Event-ID': 'ffffffffffffffff:1' })
    cleanups.push(() => again.close())
    const reset = await again.next((event) => event.event === 'reset' || event.event === 'frame')
    expect(reset.event).toBe('reset')
    const data = JSON.parse(reset.data)
    expect(data.start).toMatch(/^[0-9a-f]{16}$/)
    expect(data.start).not.toBe('ffffffffffffffff')
    expect(running.id.startsWith(`${data.start}:`)).toBe(true)
    const snapshot = frameOf(await again.next((event) => event.event === 'frame'))
    expect(snapshot).toMatchObject({ type: 'heartbeat.run.status', payload: { runId: 'r1', status: 'running' } })
  })

  it('resets a reconnect when the run finish fell out of the kept frames', async () => {
    const { url, send } = await sourceBridge()
    const first = await openSse(url)
    cleanups.push(() => first.close())
    send(sessionFrame('heartbeat.run.queued', { runId: 'r1' }))
    const queued = await first.next((event) => event.event === 'frame' && frameOf(event).type === 'heartbeat.run.queued')
    send(sessionFrame('heartbeat.run.status', { runId: 'r1', status: 'running' }))
    const running = await first.next((event) => event.event === 'frame' && frameOf(event).payload?.status === 'running')
    first.close()

    const agents = [{ id: SESSION_AGENT.id, key: SESSION_AGENT.key, name: SESSION_AGENT.name, parser: 'claude' }]
    const pipeline = createPipeline({ agents, tree: { rootName: 'p', files: [], dirs: [] } })
    const state = createState({ files: [], dirs: [], created: [] }, agents)
    for (const event of [queued, running]) {
      for (const activity of pipeline.push(frameOf(event))) apply(state, activity)
    }
    expect(state.agents.get(SESSION_AGENT.key).status).toBe('working')

    send(sessionFrame('heartbeat.run.status', { runId: 'r1', status: 'succeeded' }))
    for (let seq = 1; seq <= 510; seq += 1) send(sessionLog('filler', seq, ''))

    const again = await openSse(url, { 'Last-Event-ID': running.id })
    cleanups.push(() => again.close())
    const reset = await again.next((event) => event.event === 'reset' || event.event === 'frame')
    expect(reset.event).toBe('reset')
    pipeline.reset()
    resetRunState(state)
    expect(state.agents.get(SESSION_AGENT.key).status).toBe('idle')

    let replayed = 0
    for (let index = 0; index < 600; index += 1) {
      const event = await again.next((item) => item.event === 'frame')
      const frame = frameOf(event)
      replayed += 1
      for (const activity of pipeline.push(frame)) apply(state, activity)
      if (frame.payload?.runId === 'filler' && frame.payload?.seq === 510) break
    }
    expect(replayed).toBeGreaterThan(0)
    expect(state.agents.get(SESSION_AGENT.key).status).not.toBe('working')
  })

  it('leaves no timer behind after stop', async () => {
    let reads = 0
    const projectRoot = tempDir()
    const runs = tempDir()
    const { bridge } = await laneBridge({
      projectRoot,
      runsDir: runs,
      bridge: {
        readTree: async () => {
          reads += 1
          return { root: 'project', files: ['a.js'], created: [] }
        },
      },
    })
    await waitFor(() => reads > 0, { what: 'the first tree read' })
    await bridge.stop()
    await sleep(200)
    const count = reads
    await sleep(150)
    expect(reads).toBe(count)
  })
})

describe('masked keys', () => {
  it('masks a key before it reaches the stream, the history and a Last-Event-ID replay', async () => {
    const runs = tempDir()
    const name = 'opencode-Y1c-20261024-131000'
    const { url } = await laneBridge({ runsDir: runs })
    const health = () => getJson(`${url}/api/health`).then((answer) => answer.body)
    const before = await health()
    expect(before.masked.total).toBe(0)
    expect(Number.isNaN(Date.parse(before.masked.since))).toBe(false)

    const sse = await openSse(url)
    cleanups.push(() => sse.close())
    const log = join(runs, `${name}.log`)
    writeFileSync(log, `${toolLine('docs/notes.md', { id: 'call-1', output: `read with ${KEY}` })}\n`)

    const queued = await sse.next((event) => event.event === 'frame' && frameOf(event).type === 'heartbeat.run.queued')
    const live = await sse.next((event) => event.event === 'frame' && frameOf(event).type === 'heartbeat.run.log')
    const masked = frameOf(live)
    expect(masked.payload.chunk).toContain('[key]')
    expect(masked.payload.chunk).not.toContain(KEY)

    const agents = (await getJson(`${url}/api/agents`)).body
    const activities = buildActivities([masked], { agents, tree: { rootName: 'agent-sandbox', files: [], dirs: [] } })
    const start = activities.find((activity) => activity.type === 'tool.start')
    expect(start).toMatchObject({ tool: 'read' })
    expect(start.touches).toEqual([{ path: 'docs/notes.md', mode: 'read', kind: 'file' }])

    await waitFor(async () => (await health()).masked.total === 1, { what: 'the masked count' })
    expect((await health()).masked).toMatchObject({ total: 1 })

    const history = await openSse(url, {}, '?history=1')
    cleanups.push(() => history.close())
    const fromHistory = await history.next((event) => event.event === 'frame' && event.id === live.id)
    expect(fromHistory.data).toBe(live.data)

    const replay = await openSse(url, { 'Last-Event-ID': queued.id })
    cleanups.push(() => replay.close())
    const fromReplay = await replay.next((event) => event.event === 'frame' && event.id === live.id)
    expect(fromReplay.data).toBe(live.data)
  })

  it('masks a key in an error message and a run error', async () => {
    const { url, send } = await sourceBridge()
    const health = () => getJson(`${url}/api/health`).then((answer) => answer.body)
    const sse = await openSse(url)
    cleanups.push(() => sse.close())

    send(sessionFrame('heartbeat.run.event', { runId: 'r1', seq: 1, level: 'error', message: `failed ${KEY}` }))
    const messageEvent = frameOf(await sse.next((event) => event.event === 'frame' && frameOf(event).type === 'heartbeat.run.event'))
    expect(messageEvent.payload.message).toBe('failed [key]')

    send(sessionFrame('heartbeat.run.status', { runId: 'r1', status: 'failed', error: `boom ${KEY}` }))
    const statusEvent = frameOf(
      await sse.next(
        (event) => event.event === 'frame' && frameOf(event).type === 'heartbeat.run.status' && frameOf(event).payload.status === 'failed'
      )
    )
    expect(statusEvent.payload.error).toBe('boom [key]')

    await waitFor(async () => (await health()).masked.total === 2, { what: 'the masked count' })
    expect((await health()).masked.total).toBe(2)
  })

  it('masks a key that the source splits across two chunks on the stream and in the history', async () => {
    const { url, send } = await sourceBridge()
    const sse = await openSse(url)
    cleanups.push(() => sse.close())

    send(sessionLog('r1', 1, `reading ${KEY.slice(0, 12)}`))
    send(sessionLog('r1', 2, `${KEY.slice(12)} done\n`))
    const first = frameOf(await sse.next((event) => event.event === 'frame' && frameOf(event).type === 'heartbeat.run.log'))
    const second = frameOf(await sse.next((event) => event.event === 'frame' && frameOf(event).type === 'heartbeat.run.log'))
    expect(first.payload).toMatchObject({ seq: 1, chunk: 'reading [key]' })
    expect(second.payload).toMatchObject({ seq: 2, chunk: ' done\n' })
    await waitFor(async () => (await getJson(`${url}/api/health`)).body.masked.total === 1, { what: 'the masked count' })

    const history = await openSse(url, {}, '?history=1')
    cleanups.push(() => history.close())
    const seen = []
    for (const seq of [1, 2]) {
      const event = await history.next((item) => item.event === 'frame' && frameOf(item).payload?.seq === seq)
      seen.push(frameOf(event).payload.chunk)
    }
    expect(seen.join('')).toContain('[key]')
    expect(seen.join('')).not.toContain(KEY)
  })

  it('releases a held tail unchanged within a second when no chunk follows', async () => {
    const { url, send } = await sourceBridge()
    const sse = await openSse(url)
    cleanups.push(() => sse.close())

    const sent = Date.now()
    send(sessionLog('r1', 1, 'export sk-ab'))
    send(sessionFrame('heartbeat.run.status', { runId: 'r1', status: 'running' }))
    const held = frameOf(await sse.next((event) => event.event === 'frame' && frameOf(event).type === 'heartbeat.run.log'))
    const after = await sse.next((event) => event.event === 'frame' && frameOf(event).type === 'heartbeat.run.status')
    expect(held.payload.chunk).toBe('export sk-ab')
    expect(Date.now() - sent).toBeLessThan(2000)
    expect(frameOf(after).payload.status).toBe('running')
  })
})

function flaggedClaudeLine(id = 'call-1') {
  return JSON.stringify({
    type: 'assistant',
    'acpx.tool_call': true,
    message: {
      content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: 'docs/notes.md' } }],
    },
  })
}

const ZERO = { claude: 0, hermes: 0, opencode: 0, agy: 0 }
const OPENCODE_BROKEN = '{"type":"tool_use","part":{"id":"p13","tool":"shell","state":{"input":{"command":"cat docs/notes.md"'

describe('the unreadable counter', () => {
  const healthOf = (url) => getJson(`${url}/api/health`).then((answer) => answer.body)

  it('starts at zero with a since time and counts a broken OpenCode line split over two frames once', async () => {
    const { url, send } = await sourceBridge(OPENCODE_SESSION)
    const first = (await healthOf(url)).unparsed
    expect(first.total).toBe(0)
    expect(first.byParser).toEqual(ZERO)
    expect(Number.isNaN(Date.parse(first.since))).toBe(false)

    const half = Math.floor(OPENCODE_BROKEN.length / 2)
    send(sessionLog('r1', 1, OPENCODE_BROKEN.slice(0, half)))
    send(sessionLog('r1', 2, `${OPENCODE_BROKEN.slice(half)}\n`))

    await waitFor(async () => (await healthOf(url)).unparsed.total === 1, { what: 'the unreadable count' })
    expect((await healthOf(url)).unparsed).toMatchObject({ total: 1, byParser: { ...ZERO, opencode: 1 } })
  })

  it('counts a broken line that a lane frame carries once', async () => {
    const runs = tempDir()
    const { url } = await laneBridge({ runsDir: runs })
    writeRun(runs, 'claude-Y1c-20261024-132000', [flaggedClaudeLine()], { lane: 'claude' })
    await waitFor(async () => (await healthOf(url)).unparsed.total === 1, { what: 'the unreadable count' })
    expect((await healthOf(url)).unparsed).toMatchObject({ total: 1, byParser: { ...ZERO, claude: 1 } })
  })

  it('counts a well formed OpenCode line as nothing', async () => {
    const runs = tempDir()
    const { url } = await laneBridge({ runsDir: runs })
    writeRun(runs, 'opencode-Y1c-20261024-132100', [toolLine('docs/notes.md')])
    await readFrames(url, (frames) => frames.some((frame) => frame.payload?.status === 'succeeded'))
    expect((await healthOf(url)).unparsed).toMatchObject({ total: 0, byParser: ZERO })
  })

  it('counts a Hermes preparing line as nothing', async () => {
    const runs = tempDir()
    const { url } = await laneBridge({ runsDir: runs })
    writeRun(runs, 'hermes-Y1c-20261024-132200', ['  \u250a \ud83d\udcbb preparing terminal\u2026'], { lane: 'hermes' })
    writeRun(runs, 'claude-Y1c-20261024-132201', [flaggedClaudeLine()], { lane: 'claude' })
    await waitFor(async () => (await healthOf(url)).unparsed.total === 1, { what: 'the unreadable count' })
    expect((await healthOf(url)).unparsed.byParser).toMatchObject({ ...ZERO, hermes: 0, claude: 1 })
  })

  it('counts nothing for a lane that is not in the agent list', async () => {
    const runs = tempDir()
    const { url } = await laneBridge({ runsDir: runs, lanes: { opencode: { name: 'OpenCode', cli: { harness: 'opencode' }, worktree: 'C:\\work\\opencode' } } })
    writeRun(runs, 'hermes-Y1c-20261024-132300', [flaggedClaudeLine()], { lane: 'hermes' })
    await sleep(200)
    expect((await healthOf(url)).unparsed).toMatchObject({ total: 0, byParser: ZERO })
  })

  it('drops agents that left the roster from the parser index (S37)', async () => {
    let currentLanes = {
      opencode: { name: 'OpenCode', cli: { harness: 'opencode' }, worktree: 'C:\\work\\opencode' },
      claude: { name: 'Claude', cli: { harness: 'claude' }, worktree: 'C:\\work\\claude' },
    }
    const runs = tempDir()
    const { url } = await laneBridge({ runsDir: runs, lanes: () => currentLanes })
    await fetch(`${url}/api/agents`)

    currentLanes = {
      opencode: { name: 'OpenCode', cli: { harness: 'opencode' }, worktree: 'C:\\work\\opencode' },
    }
    await fetch(`${url}/api/agents`)

    writeRun(runs, 'claude-left-20261024-132300', [flaggedClaudeLine()], { lane: 'claude' })
    await sleep(200)
    expect((await healthOf(url)).unparsed.total).toBe(0)
  })

  it('counts nothing from a stderr frame', async () => {
    const { url, send } = await sourceBridge()
    send(sessionFrame('heartbeat.run.log', { runId: 'r1', seq: 1, stream: 'stderr', chunk: `${flaggedClaudeLine()}\n`, truncated: false }))
    send(sessionLog('r1', 2, `${flaggedClaudeLine('call-2')}\n`))
    await waitFor(async () => (await healthOf(url)).unparsed.total === 1, { what: 'the unreadable count' })
    expect((await healthOf(url)).unparsed).toMatchObject({ total: 1, byParser: { ...ZERO, claude: 1 } })
  })

  it('counts a broken tail when the run ends', async () => {
    const { url, send } = await sourceBridge(OPENCODE_SESSION)
    send(sessionLog('r1', 1, OPENCODE_BROKEN))
    send(sessionFrame('heartbeat.run.status', { runId: 'r1', status: 'succeeded' }))
    await waitFor(async () => (await healthOf(url)).unparsed.total === 1, { what: 'the unreadable count' })
    expect((await healthOf(url)).unparsed).toMatchObject({ total: 1, byParser: { ...ZERO, opencode: 1 } })
  })

  it('counts a line at the end of a lane log with no trailing newline', async () => {
    const runs = tempDir()
    const name = 'claude-Y1c-20261024-132400'
    writeRun(runs, name, [flaggedClaudeLine()], { lane: 'claude', newline: false })
    const { url } = await laneBridge({ runsDir: runs })
    await readFrames(url, (frames) => frames.some((frame) => frame.payload?.status === 'succeeded'))
    await waitFor(async () => (await healthOf(url)).unparsed.total === 1, { what: 'the unreadable count' })
    expect((await healthOf(url)).unparsed).toMatchObject({ total: 1, byParser: { ...ZERO, claude: 1 } })
  })
})
