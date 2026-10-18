import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { createBridge } from '../server/index.js'
import { extractReplyText } from '../server/assistant.js'

function startFakePaperclip(companyId = 'comp-1', agents = []) {
  const sockets = new Set()
  const stored = new Map()
  const logRequests = []
  let connections = 0
  let logDelayMs = 0

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === `/api/companies/${companyId}/agents`) {
      const payload = JSON.stringify(agents)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(payload)
      return
    }
    const logRoute = /^\/api\/heartbeat-runs\/([^/?]+)\/log\?offset=(\d+)$/.exec(req.url ?? '')
    if (req.method === 'GET' && logRoute) {
      logRequests.push(req.url)
      const full = Buffer.from(stored.get(decodeURIComponent(logRoute[1])) ?? '', 'utf8')
      const content = full.subarray(Number(logRoute[2])).toString('utf8')
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ runId: logRoute[1], content }))
      }, logDelayMs)
      return
    }
    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    if (req.url === `/api/companies/${companyId}/events/ws`) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        connections += 1
        sockets.add(ws)
        ws.on('close', () => sockets.delete(ws))
        wss.emit('connection', ws, req)
      })
    } else {
      socket.destroy()
    }
  })

  return new Promise((resolveFake) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolveFake({
        url: `http://127.0.0.1:${port}`,
        get connections() {
          return connections
        },
        get logRequests() {
          return logRequests
        },
        appendLog(runId, entry) {
          stored.set(runId, `${stored.get(runId) ?? ''}${JSON.stringify(entry)}\n`)
        },
        delayLogs(ms) {
          logDelayMs = ms
        },
        send(frame) {
          const text = JSON.stringify(frame)
          for (const ws of sockets) {
            if (ws.readyState === ws.OPEN) ws.send(text)
          }
        },
        dropClients() {
          for (const ws of sockets) {
            ws.close()
          }
          sockets.clear()
        },
        close() {
          for (const ws of sockets) {
            ws.terminate()
          }
          sockets.clear()
          return new Promise((resolveClose) => {
            wss.close(() => {
              server.close(() => resolveClose())
            })
          })
        },
      })
    })
  })
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

function openSse(url, headers = {}) {
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
    req = httpRequest(`${url}/events`, { headers }, (res) => {
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
        next(predicate = () => true, timeoutMs = 3000) {
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

async function waitUntil(fn, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('condition not met in time')
}

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'mr-bridge-test-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

describe('live bridge', () => {
  it('answers a viewer on any local port and refuses other sites', async () => {
    const dir = makeTempDir()
    const fake = await startFakePaperclip('comp-1', [])
    cleanups.push(() => fake.close())
    const bridge = createBridge({ paperclipUrl: fake.url, companyId: 'comp-1', projectRoot: dir, port: 0 })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    for (const origin of ['http://localhost:5180', 'http://127.0.0.1:4000', 'http://localhost']) {
      const res = await fetch(`${url}/api/health`, { headers: { Origin: origin } })
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe(origin)
    }
    for (const origin of ['http://localhost.evil.com', 'https://example.com', 'http://127.0.0.1.evil.com:5173']) {
      const res = await fetch(`${url}/api/health`, { headers: { Origin: origin } })
      expect(res.status).toBe(403)
    }
  })

  it('maps Paperclip agents to viewer keys and parsers', async () => {
    const dir = makeTempDir()
    const fake = await startFakePaperclip('comp-1', [
      { id: 'a1', name: 'Claude Code', adapterType: 'claude_local' },
      { id: 'a2', name: 'Hermes', adapterType: 'hermes_local' },
      { id: 'a3', name: 'OpenCode Go', adapterType: 'opencode_local' },
      { id: 'a4', name: 'agy', adapterType: 'process' },
      { id: 'a5', name: 'Custom Runner', adapterType: 'process' },
      { id: 'a6', name: 'Lint Bot', adapterType: 'webhook' },
    ])
    cleanups.push(() => fake.close())

    const bridge = createBridge({
      paperclipUrl: fake.url,
      companyId: 'comp-1',
      projectRoot: dir,
      port: 0,
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const res = await fetch(`${url}/api/agents`, {
      headers: { Origin: 'http://localhost:5173' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    const list = await res.json()
    expect(list).toEqual([
      { id: 'a1', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', parser: 'claude' },
      { id: 'a2', key: 'hermes', name: 'Hermes', adapterType: 'hermes_local', parser: 'hermes' },
      { id: 'a3', key: 'opencode', name: 'OpenCode Go', adapterType: 'opencode_local', parser: 'opencode' },
      { id: 'a4', key: 'agy', name: 'agy', adapterType: 'process', parser: 'agy' },
      { id: 'a5', key: 'custom-runner', name: 'Custom Runner', adapterType: 'process', parser: null },
      { id: 'a6', key: 'lint-bot', name: 'Lint Bot', adapterType: 'webhook', parser: null },
    ])

    const forbidden = await fetch(`${url}/api/health`, {
      headers: { Origin: 'http://example.com' },
    })
    expect(forbidden.status).toBe(403)
  })

  it('returns the file tree for both git repositories and plain folders', async () => {
    const gitDir = makeTempDir()
    execFileSync('git', ['init'], { cwd: gitDir, stdio: 'ignore' })
    mkdirSync(join(gitDir, 'src'), { recursive: true })
    mkdirSync(join(gitDir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(gitDir, '.gitignore'), 'node_modules/\n')
    writeFileSync(join(gitDir, 'src', 'index.js'), 'export default 1\n')
    writeFileSync(join(gitDir, 'README.md'), 'hello\n')
    writeFileSync(join(gitDir, 'node_modules', 'pkg', 'index.js'), 'ignored\n')

    const fake = await startFakePaperclip('comp-1')
    cleanups.push(() => fake.close())

    const gitBridge = createBridge({
      paperclipUrl: fake.url,
      companyId: 'comp-1',
      projectRoot: gitDir,
      port: 0,
    })
    cleanups.push(() => gitBridge.stop())
    const { url: gitUrl } = await gitBridge.start()

    const gitTree = await fetch(`${gitUrl}/api/tree`).then((r) => r.json())
    expect(gitTree.files).toEqual(['.gitignore', 'README.md', 'src/index.js'])
    expect(gitTree.created).toEqual([])

    const plainDir = makeTempDir()
    mkdirSync(join(plainDir, 'src'), { recursive: true })
    mkdirSync(join(plainDir, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(plainDir, 'dist'), { recursive: true })
    writeFileSync(join(plainDir, 'src', 'app.js'), '1\n')
    writeFileSync(join(plainDir, 'node_modules', 'pkg', 'x.js'), '2\n')
    writeFileSync(join(plainDir, 'dist', 'bundle.js'), '3\n')

    const plainBridge = createBridge({
      paperclipUrl: fake.url,
      companyId: 'comp-1',
      projectRoot: plainDir,
      port: 0,
    })
    cleanups.push(() => plainBridge.stop())
    const { url: plainUrl } = await plainBridge.start()

    const plainTree = await fetch(`${plainUrl}/api/tree`).then((r) => r.json())
    expect(plainTree.files).toEqual(['src/app.js'])
    expect(plainTree.created).toEqual([])
  })

  it('streams frames over SSE and replays missed frames after Last-Event-ID', async () => {
    const dir = makeTempDir()
    const fake = await startFakePaperclip('comp-1')
    cleanups.push(() => fake.close())

    const bridge = createBridge({
      paperclipUrl: fake.url,
      companyId: 'comp-1',
      projectRoot: dir,
      port: 0,
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    await waitUntil(async () => {
      const health = await fetch(`${url}/api/health`).then((r) => r.json())
      return health.ok && health.paperclip
    })

    const sse = await openSse(url)
    cleanups.push(() => sse.close())

    const frame1 = { id: 101, companyId: 'comp-1', type: 'heartbeat.run.queued', createdAt: '2026-10-17T12:00:00.000Z', payload: { runId: 'r1' } }
    const frame2 = { id: 102, companyId: 'comp-1', type: 'heartbeat.run.status', createdAt: '2026-10-17T12:00:01.000Z', payload: { runId: 'r1', status: 'running' } }
    const frame3 = { id: 103, companyId: 'comp-1', type: 'heartbeat.run.status', createdAt: '2026-10-17T12:00:02.000Z', payload: { runId: 'r1', status: 'succeeded' } }

    fake.send(frame1)
    const firstEvent = await sse.next((e) => e.event === 'frame')
    expect(firstEvent.id).toBe('101')
    expect(JSON.parse(firstEvent.data)).toEqual(frame1)
    sse.close()

    fake.send(frame2)
    fake.send(frame3)

    const replayed = await openSse(url, { 'Last-Event-ID': '101' })
    cleanups.push(() => replayed.close())
    const secondEvent = await replayed.next((e) => e.event === 'frame')
    const thirdEvent = await replayed.next((e) => e.event === 'frame')
    expect(secondEvent.id).toBe('102')
    expect(JSON.parse(secondEvent.data)).toEqual(frame2)
    expect(thirdEvent.id).toBe('103')
    expect(JSON.parse(thirdEvent.data)).toEqual(frame3)
  })

  it('reconnects when the upstream WebSocket closes and resumes streaming', async () => {
    const dir = makeTempDir()
    const fake = await startFakePaperclip('comp-1')
    cleanups.push(() => fake.close())

    const bridge = createBridge({
      paperclipUrl: fake.url,
      companyId: 'comp-1',
      projectRoot: dir,
      port: 0,
      reconnectMinMs: 40,
      reconnectMaxMs: 200,
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    await waitUntil(async () => {
      const health = await fetch(`${url}/api/health`).then((r) => r.json())
      return health.paperclip === true
    })
    expect(fake.connections).toBe(1)

    const sse = await openSse(url)
    cleanups.push(() => sse.close())

    fake.dropClients()

    await waitUntil(async () => {
      const health = await fetch(`${url}/api/health`).then((r) => r.json())
      return fake.connections >= 2 && health.paperclip === true
    })

    const frame = { id: 201, companyId: 'comp-1', type: 'heartbeat.run.queued', createdAt: '2026-10-17T12:05:00.000Z', payload: { runId: 'r2' } }
    fake.send(frame)
    const event = await sse.next((e) => e.event === 'frame')
    expect(event.id).toBe('201')
    expect(JSON.parse(event.data)).toEqual(frame)
  })

  it('emits a tree SSE event when the watched project file list changes', async () => {
    const dir = makeTempDir()
    writeFileSync(join(dir, 'a.js'), '1\n')

    const fake = await startFakePaperclip('comp-1')
    cleanups.push(() => fake.close())

    const bridge = createBridge({
      paperclipUrl: fake.url,
      companyId: 'comp-1',
      projectRoot: dir,
      port: 0,
      debounceMs: 50,
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const sse = await openSse(url)
    cleanups.push(() => sse.close())

    writeFileSync(join(dir, 'b.js'), '2\n')
    const treeEvent = await sse.next((e) => e.event === 'tree')
    const data = JSON.parse(treeEvent.data)
    expect(data.files).toEqual(['a.js', 'b.js'])
  })
})

describe('truncated log frames', () => {
  const big = (letter) => letter.repeat(20000)
  const logFrame = (id, seq, chunk, truncated) => ({
    id,
    companyId: 'comp-1',
    type: 'heartbeat.run.log',
    createdAt: '2026-10-17T12:00:00.000Z',
    payload: { runId: 'r1', agentId: 'a1', seq, stream: 'stdout', chunk, truncated },
  })

  async function startBridge(options = {}) {
    const dir = makeTempDir()
    const fake = await startFakePaperclip('comp-1')
    cleanups.push(() => fake.close())
    const bridge = createBridge({
      paperclipUrl: fake.url,
      companyId: 'comp-1',
      projectRoot: dir,
      port: 0,
      logRetries: 2,
      logRetryMs: 10,
      ...options,
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    await waitUntil(async () => (await fetch(`${url}/api/health`).then((r) => r.json())).paperclip)
    const sse = await openSse(url)
    cleanups.push(() => sse.close())
    return { fake, sse, url }
  }

  const frameOf = async (sse, id) => JSON.parse((await sse.next((e) => e.event === 'frame' && e.id === String(id))).data)

  it('swaps in the full chunk from the run log', async () => {
    const { fake, sse } = await startBridge()
    fake.appendLog('r1', { ts: '2026-10-17T12:00:00.000Z', stream: 'stdout', chunk: big('a'), seq: 1 })

    fake.send(logFrame(301, 1, big('a').slice(-8192), true))
    const frame = await frameOf(sse, 301)

    expect(frame.payload.chunk).toBe(big('a'))
    expect(frame.payload.truncated).toBe(false)
  })

  it('leaves a chunk that is not truncated alone and never asks for the log', async () => {
    const { fake, sse } = await startBridge()
    fake.send(logFrame(302, 1, 'short line', false))
    const frame = await frameOf(sse, 302)

    expect(frame.payload.chunk).toBe('short line')
    expect(fake.logRequests).toHaveLength(0)
  })

  it('keeps frames in order while the log is being read', async () => {
    const { fake, sse } = await startBridge()
    fake.appendLog('r1', { ts: '2026-10-17T12:00:00.000Z', stream: 'stdout', chunk: big('b'), seq: 1 })
    fake.delayLogs(150)

    fake.send(logFrame(303, 1, big('b').slice(-8192), true))
    fake.send(logFrame(304, 2, 'after', false))
    fake.send({ id: 305, companyId: 'comp-1', type: 'heartbeat.run.status', createdAt: '2026-10-17T12:00:01.000Z', payload: { runId: 'r1', status: 'succeeded' } })

    const order = []
    for (let i = 0; i < 3; i += 1) order.push((await sse.next((e) => e.event === 'frame', 4000)).id)
    expect(order).toEqual(['303', '304', '305'])
  })

  it('forwards the truncated frame as it is when the log has no such chunk', async () => {
    const { fake, sse } = await startBridge()
    const cut = big('c').slice(-8192)

    fake.send(logFrame(306, 9, cut, true))
    const frame = await frameOf(sse, 306)

    expect(frame.payload.chunk).toBe(cut)
    expect(frame.payload.truncated).toBe(true)
  })

  it('reads on from where it stopped for the next truncated chunk of a run', async () => {
    const { fake, sse } = await startBridge()
    const first = { ts: '2026-10-17T12:00:00.000Z', stream: 'stdout', chunk: big('d'), seq: 1 }
    fake.appendLog('r1', first)
    fake.send(logFrame(307, 1, big('d').slice(-8192), true))
    await frameOf(sse, 307)

    fake.appendLog('r1', { ts: '2026-10-17T12:00:05.000Z', stream: 'stdout', chunk: big('e'), seq: 2 })
    fake.send(logFrame(308, 2, big('e').slice(-8192), true))
    const frame = await frameOf(sse, 308)

    expect(frame.payload.chunk).toBe(big('e'))
    const firstBytes = Buffer.byteLength(`${JSON.stringify(first)}\n`, 'utf8')
    expect(fake.logRequests).toEqual([
      '/api/heartbeat-runs/r1/log?offset=0',
      `/api/heartbeat-runs/r1/log?offset=${firstBytes}`,
    ])
  })

  it('replays the restored chunk to a viewer that reconnects', async () => {
    const { fake, sse, url } = await startBridge()
    fake.appendLog('r1', { ts: '2026-10-17T12:00:00.000Z', stream: 'stdout', chunk: big('f'), seq: 1 })
    fake.send({ id: 309, companyId: 'comp-1', type: 'heartbeat.run.queued', createdAt: '2026-10-17T12:00:00.000Z', payload: { runId: 'r1' } })
    await sse.next((e) => e.event === 'frame')
    fake.send(logFrame(310, 1, big('f').slice(-8192), true))
    await frameOf(sse, 310)

    const again = await openSse(url, { 'Last-Event-ID': '309' })
    cleanups.push(() => again.close())
    const replayed = await frameOf(again, 310)

    expect(replayed.payload.chunk).toBe(big('f'))
    expect(replayed.payload.truncated).toBe(false)
  })
})

describe('assistant route', () => {
  async function startAssistantBridge(options = {}) {
    const dir = makeTempDir()
    const fake = await startFakePaperclip('comp-1')
    cleanups.push(() => fake.close())
    const bridge = createBridge({
      paperclipUrl: fake.url,
      companyId: 'comp-1',
      projectRoot: dir,
      port: 0,
      ...options,
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    return { url, dir }
  }

  it('calls the runner with the default model and 8s timeout and returns the text', async () => {
    const calls = []
    const { url } = await startAssistantBridge({
      env: {},
      assistantRunner: async (input) => {
        calls.push(input)
        return '{"type":"overview","say":"Going to overview."}'
      },
    })

    const res = await fetch(`${url}/api/assistant`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'show the whole room' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: '{"type":"overview","say":"Going to overview."}' })
    expect(calls).toEqual([
      {
        model: 'opencode/deepseek-v4.1-flash-free',
        prompt: 'show the whole room',
        timeoutMs: 8000,
      },
    ])
  })

  it('reads the model from ASSISTANT_MODEL or the settings file and answers 404 when no model is set', async () => {
    const dir = makeTempDir()
    const settingsPath = join(dir, 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({ assistantModel: 'opencode/glm-5.3-flash-free' }))

    const seenModels = []
    const { url: fromFileUrl } = await startAssistantBridge({
      env: {},
      settingsFile: settingsPath,
      assistantRunner: async ({ model }) => {
        seenModels.push(model)
        return 'ok'
      },
    })

    const fileRes = await fetch(`${fromFileUrl}/api/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    })
    expect(fileRes.status).toBe(200)
    expect(seenModels).toEqual(['opencode/glm-5.3-flash-free'])

    const { url: disabledUrl } = await startAssistantBridge({
      env: { ASSISTANT_MODEL: 'none' },
      assistantRunner: async () => 'should not run',
    })
    const offRes = await fetch(`${disabledUrl}/api/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    })
    expect(offRes.status).toBe(404)
    const offBody = await offRes.json()
    expect(offBody.error).toMatch(/no assistant model/i)
  })

  it('enforces local origins, POST method, 2000 character prompt limit and runner failures', async () => {
    const { url } = await startAssistantBridge({
      env: {},
      assistantRunner: async () => {
        throw new Error('timed out')
      },
    })

    const evil = await fetch(`${url}/api/assistant`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hi' }),
    })
    expect(evil.status).toBe(403)

    const getRes = await fetch(`${url}/api/assistant`)
    expect(getRes.status).toBe(405)

    const emptyRes = await fetch(`${url}/api/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '   ' }),
    })
    expect(emptyRes.status).toBe(400)

    const longRes = await fetch(`${url}/api/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a'.repeat(2001) }),
    })
    expect(longRes.status).toBe(400)
    expect((await longRes.json()).error).toMatch(/2000/)

    const failRes = await fetch(`${url}/api/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'valid prompt' }),
    })
    expect(failRes.status).toBe(502)
    expect(await failRes.json()).toEqual({ error: 'The helper model is not reachable.' })
  })

  it('extracts text from opencode JSON lines and plain JSON replies', () => {
    const jsonl = [
      '{"type":"step_start","part":{"type":"step-start"}}',
      '{"type":"text","part":{"type":"text","text":"{\\"type\\":\\"overview\\","}}',
      '{"type":"text","part":{"type":"text","text":"\\"say\\":\\"Done.\\"}"}}',
    ].join('\n')
    expect(extractReplyText(jsonl)).toBe('{"type":"overview","say":"Done."}')
    expect(extractReplyText('{"text":"hello"}')).toBe('hello')
  })
})
