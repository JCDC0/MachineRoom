import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { createBridge, isAllowedHost } from '../server/index.js'
import { createClient } from '../src/control/client.js'
import { extractReplyText } from '../server/assistant.js'
import { FEATURES, PAPERCLIP_SURFACE } from '../server/surface.js'
import { choice } from '../src/decider/wire.js'
import { buildActivities } from '../src/model/pipeline.js'
import { startFakeDecisions } from './fakeDecisions.js'
import { makeTempDir as makeTempRoot } from './helpers/tempRoot.js'

function fieldsSchema(fields = []) {
  const root = { type: 'object', properties: {} }
  for (const field of fields) {
    let node = root
    for (const raw of field.split('.')) {
      const array = raw.endsWith('[]')
      const name = array ? raw.slice(0, -2) : raw
      if (!node.properties[name]) {
        node.properties[name] = array
          ? { type: 'array', items: { type: 'object', properties: {} } }
          : { type: 'object', properties: {} }
      }
      const target = node.properties[name]
      node = array ? target.items : target
    }
  }
  return root
}

function paperclipSpec({ version = '0.1.0', drop = [] } = {}) {
  const dropped = new Set(drop)
  const paths = {}
  for (const route of PAPERCLIP_SURFACE) {
    if (route.socket || dropped.has(`${route.method} ${route.path}`)) continue
    const operation = {
      responses: {
        200: { content: { 'application/json': { schema: fieldsSchema(route.fields) } } },
      },
    }
    if (route.body) {
      operation.requestBody = { content: { 'application/json': { schema: fieldsSchema(route.body) } } }
    }
    paths[route.path] = { ...(paths[route.path] ?? {}), [route.method.toLowerCase()]: operation }
  }
  return { openapi: '3.1.0', info: { version }, paths }
}

function startFakePaperclip(companyId = 'comp-1', agents = [], options = {}) {
  const sockets = new Set()
  const stored = new Map()
  const logRequests = []
  const specRequests = []
  const agentRequests = []
  const requests = []
  let spec = options.spec ?? null
  let connections = 0
  let logDelayMs = 0
  let agentsFailing = false
  const specDelayMs = Number(options.specDelayMs ?? 0)
  const healthAnswer = options.health ?? null
  const backupAnswer = options.backup ?? null
  const backupRequests = []

  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url })
    if (req.method === 'GET' && req.url === '/api/openapi.json') {
      specRequests.push(req.url)
      const answer = () => {
        if (options.specBody !== undefined) {
          res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' })
          res.end(options.specBody)
          return
        }
        if (!spec) {
          res.writeHead(404, { Connection: 'close' })
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' })
        res.end(JSON.stringify(spec))
      }
      if (specDelayMs > 0) {
        setTimeout(answer, specDelayMs)
      } else {
        answer()
      }
      return
    }
    if (req.method === 'GET' && req.url === `/api/companies/${companyId}/issues`) {
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' })
      res.end(JSON.stringify(options.issues ?? []))
      return
    }
    if (req.method === 'GET' && req.url === `/api/companies/${companyId}/agents`) {
      agentRequests.push(req.url)
      if (agentsFailing) {
        res.writeHead(500, { Connection: 'close' })
        res.end()
        return
      }
      const payload = JSON.stringify(agents)
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' })
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
    if (req.method === 'GET' && req.url === '/api/health') {
      if (healthAnswer === null && spec) {
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' })
        res.end(JSON.stringify({ status: 'ok', version: spec.info?.version }))
        return
      }
      if (healthAnswer === null) {
        res.writeHead(404, { Connection: 'close' })
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' })
      res.end(JSON.stringify(healthAnswer))
      return
    }
    if (req.method === 'POST' && req.url === '/api/instance/database-backups') {
      backupRequests.push(req.url)
      const answer = backupAnswer ?? { status: 201, body: {} }
      res.writeHead(answer.status, { 'Content-Type': 'application/json', Connection: 'close' })
      res.end(JSON.stringify(answer.body ?? {}))
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
        get specRequests() {
          return specRequests
        },
        get agentRequests() {
          return agentRequests
        },
        get requests() {
          return requests
        },
        get backupRequests() {
          return backupRequests
        },
        setAgentsFailing(next) {
          agentsFailing = next
        },
        setSpec(next) {
          spec = next
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

async function sleep(ms) {
  await new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

async function waitUntil(fn, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('condition not met in time')
}

const FAKE_KEY = 'sk-or-v1-' + '0123456789abcdef'.repeat(4)

function keyedToolChunk() {
  return `${JSON.stringify({
    type: 'tool_use',
    part: {
      id: 'p1',
      tool: 'read',
      state: { status: 'completed', input: { path: 'docs/notes.md' }, output: `read with ${FAKE_KEY}` },
    },
  })}\n`
}

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function makeTempDir() {
  const dir = makeTempRoot('mr-bridge-test-')
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

describe('live bridge', () => {
  it('allows the bridge port, Vite and the named origins, and skips a bad list entry', async () => {
    const dir = makeTempDir()
    const fake = await startFakePaperclip('comp-1', [])
    cleanups.push(() => fake.close())
    const logs = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => {
      logs.push(String(line))
    })
    cleanups.push(() => spy.mockRestore())
    const bridge = createBridge({
      paperclipUrl: fake.url,
      companyId: 'comp-1',
      projectRoot: dir,
      port: 0,
      env: { MACHINEROOM_ORIGINS: 'http://localhost:4000, https://example.com,http://127.0.0.1:4000/diff' },
    })
    cleanups.push(() => bridge.stop())
    const { url, port } = await bridge.start()

    expect(logs).toEqual([
      'MACHINEROOM_ORIGINS: skipped https://example.com.',
      'MACHINEROOM_ORIGINS: skipped http://127.0.0.1:4000/diff.',
    ])

    for (const origin of [
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4000',
    ]) {
      const res = await fetch(`${url}/api/health`, { headers: { Origin: origin } })
      expect(res.status, origin).toBe(200)
      expect(res.headers.get('access-control-allow-origin'), origin).toBe(origin)
    }
    for (const origin of [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:4000',
      'http://localhost:5180',
      'http://localhost',
      'https://localhost:5173',
      'http://localhost.evil.com',
      'https://example.com',
      'http://127.0.0.1.evil.com:5173',
    ]) {
      const res = await fetch(`${url}/api/health`, { headers: { Origin: origin } })
      expect(res.status, origin).toBe(403)
    }
  })

  it('allows localhost, 127.0.0.1 and [::1] Host headers and rejects foreign hosts', async () => {
    const dir = makeTempDir()
    const fake = await startFakePaperclip('comp-1', [])
    cleanups.push(() => fake.close())
    const bridge = createBridge({ paperclipUrl: fake.url, companyId: 'comp-1', projectRoot: dir, port: 0 })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const getWithHost = (path, host) =>
      new Promise((resolveReq, rejectReq) => {
        const headers = host === undefined ? {} : { Host: host }
        const req = httpRequest(`${url}${path}`, { headers, setHost: false }, (res) => {
          res.resume()
          resolveReq(res.statusCode)
        })
        req.on('error', rejectReq)
        req.end()
      })

    for (const host of ['localhost', 'localhost:5174', '127.0.0.1', '127.0.0.1:5174', '[::1]', '[::1]:5174']) {
      expect(isAllowedHost(host), host).toBe(true)
      expect(await getWithHost('/api/health', host), host).toBe(200)
    }
    expect(isAllowedHost('')).toBe(false)
    expect(isAllowedHost(undefined)).toBe(false)
    for (const host of ['evil.example', 'evil.example:5174', 'localhost.evil.com', '127.0.0.1.evil.com:5174', '[::2]:5174']) {
      expect(isAllowedHost(host), host).toBe(false)
      for (const path of ['/api/health', '/api/tree', '/api/control/models', '/events']) {
        expect(await getWithHost(path, host), `${host} ${path}`).toBe(403)
      }
    }
  })

  it('maps Paperclip agents to viewer keys and parsers', async () => {
    const dir = makeTempDir()
    const fake = await startFakePaperclip('comp-1', [
      { id: 'a1', name: 'Claude Code', adapterType: 'claude_local', role: 'engineer' },
      { id: 'a2', name: 'Hermes', adapterType: 'hermes_local', role: 'engineer' },
      { id: 'a3', name: 'OpenCode Go', adapterType: 'opencode_local', role: 'engineer' },
      { id: 'a4', name: 'agy', adapterType: 'process', role: 'designer' },
      { id: 'a5', name: 'Custom Runner', adapterType: 'process' },
      { id: 'a6', name: 'Lint Bot', adapterType: 'webhook', role: 'qa' },
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
      { id: 'a1', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', role: 'engineer', parser: 'claude' },
      { id: 'a2', key: 'hermes', name: 'Hermes', adapterType: 'hermes_local', role: 'engineer', parser: 'hermes' },
      { id: 'a3', key: 'opencode', name: 'OpenCode Go', adapterType: 'opencode_local', role: 'engineer', parser: 'opencode' },
      { id: 'a4', key: 'agy', name: 'agy', adapterType: 'process', role: 'designer', parser: 'agy' },
      { id: 'a5', key: 'custom-runner', name: 'Custom Runner', adapterType: 'process', role: null, parser: null },
      { id: 'a6', key: 'lint-bot', name: 'Lint Bot', adapterType: 'webhook', role: 'qa', parser: null },
    ])

    const forbidden = await fetch(`${url}/api/health`, {
      headers: { Origin: 'http://example.com' },
    })
    expect(forbidden.status).toBe(403)
  })

  it('keeps two claude_local agents apart in list order and carries each role', async () => {
    const dir = makeTempDir()
    const fake = await startFakePaperclip('comp-1', [
      { id: 'a1', name: 'Claude Code', adapterType: 'claude_local', role: 'engineer' },
      { id: 'a2', name: 'Orchestrator', adapterType: 'claude_local', role: 'ceo' },
      { id: 'a3', name: 'Orchestrator', adapterType: 'claude_local' },
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

    const list = await fetch(`${url}/api/agents`).then((r) => r.json())
    expect(list).toEqual([
      { id: 'a1', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', role: 'engineer', parser: 'claude' },
      { id: 'a2', key: 'orchestrator', name: 'Orchestrator', adapterType: 'claude_local', role: 'ceo', parser: 'claude' },
      { id: 'a3', key: 'orchestrator-2', name: 'Orchestrator', adapterType: 'claude_local', role: null, parser: 'claude' },
    ])
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

  it('sends the kept history to a late join that asks with history=1', async () => {
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

    const frame1 = { id: 401, companyId: 'comp-1', type: 'heartbeat.run.status', createdAt: '2026-10-17T12:10:00.000Z', payload: { runId: 'r4', status: 'running' } }
    const frame2 = { id: 402, companyId: 'comp-1', type: 'heartbeat.run.status', createdAt: '2026-10-17T12:10:01.000Z', payload: { runId: 'r4', status: 'succeeded' } }

    const early = await openSse(url)
    cleanups.push(() => early.close())
    fake.send(frame1)
    fake.send(frame2)
    await early.next((e) => e.id === '401' && e.event === 'frame')
    await early.next((e) => e.id === '402' && e.event === 'frame')
    early.close()

    const late = await openSse(url, {}, '?history=1')
    cleanups.push(() => late.close())
    const first = await late.next((e) => e.event === 'frame')
    const second = await late.next((e) => e.event === 'frame')
    expect(first.id).toBe('401')
    expect(JSON.parse(first.data)).toEqual(frame1)
    expect(second.id).toBe('402')
    expect(JSON.parse(second.data)).toEqual(frame2)
  })

  it('sends no history to a client that does not ask', async () => {
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

    const frame1 = { id: 501, companyId: 'comp-1', type: 'heartbeat.run.status', createdAt: '2026-10-17T12:15:00.000Z', payload: { runId: 'r5', status: 'running' } }
    const frame2 = { id: 502, companyId: 'comp-1', type: 'heartbeat.run.status', createdAt: '2026-10-17T12:15:01.000Z', payload: { runId: 'r5', status: 'succeeded' } }

    const early = await openSse(url)
    cleanups.push(() => early.close())
    fake.send(frame1)
    await early.next((e) => e.id === '501' && e.event === 'frame')
    early.close()

    const late = await openSse(url)
    cleanups.push(() => late.close())
    fake.send(frame2)
    const event = await late.next((e) => e.event === 'frame')
    expect(event.id).toBe('502')
    expect(JSON.parse(event.data)).toEqual(frame2)
  })

  it('resumes after Last-Event-ID on a reconnect and does not repeat the history', async () => {
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

    const frame1 = { id: 601, companyId: 'comp-1', type: 'heartbeat.run.status', createdAt: '2026-10-17T12:20:00.000Z', payload: { runId: 'r6', status: 'running' } }
    const frame2 = { id: 602, companyId: 'comp-1', type: 'heartbeat.run.status', createdAt: '2026-10-17T12:20:01.000Z', payload: { runId: 'r6', status: 'succeeded' } }

    const early = await openSse(url)
    cleanups.push(() => early.close())
    fake.send(frame1)
    fake.send(frame2)
    await early.next((e) => e.id === '601' && e.event === 'frame')
    await early.next((e) => e.id === '602' && e.event === 'frame')
    early.close()

    const again = await openSse(url, { 'Last-Event-ID': '601' }, '?history=1')
    cleanups.push(() => again.close())
    const event = await again.next((e) => e.event === 'frame')
    expect(event.id).toBe('602')
    expect(JSON.parse(event.data)).toEqual(frame2)
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

describe('health surface check', () => {
  async function startSurfaceBridge({ spec, specBody, specDelayMs, surfaceEveryMs, health, issues } = {}) {
    const dir = makeTempDir()
    const fake = await startFakePaperclip('comp-1', [], { spec, specBody, specDelayMs, health, issues })
    cleanups.push(() => fake.close())
    const bridge = createBridge({
      paperclipUrl: fake.url,
      companyId: 'comp-1',
      projectRoot: dir,
      port: 0,
      reconnectMinMs: 40,
      reconnectMaxMs: 100,
      ...(surfaceEveryMs === undefined ? {} : { surfaceEveryMs }),
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    return { fake, bridge, url }
  }

  const healthOf = (url) => fetch(`${url}/api/health`).then((r) => r.json())

  it('says not checked yet before the first spec answer', async () => {
    const { url } = await startSurfaceBridge({ spec: paperclipSpec(), specDelayMs: 500 })

    const health = await healthOf(url)
    expect(health.surface).toEqual({ ok: null, checkedAt: null, error: 'not checked yet' })
    expect(health.paperclipVersion).toBeNull()

    await waitUntil(async () => (await healthOf(url)).surface?.ok === true)
  })

  it('reports the Paperclip version and a matching spec', async () => {
    const { url } = await startSurfaceBridge({ spec: paperclipSpec({ version: '1.2.3' }) })
    await waitUntil(async () => {
      const health = await healthOf(url)
      return health.paperclip === true && health.surface?.ok === true
    })

    const health = await healthOf(url)
    expect(health.ok).toBe(true)
    expect(health.paperclip).toBe(true)
    expect(health.paperclipVersion).toBe('1.2.3')
    expect(health.surface.ok).toBe(true)
    expect(typeof health.surface.checkedAt).toBe('string')
    expect(Number.isNaN(Date.parse(health.surface.checkedAt))).toBe(false)
  })

  it('names the route a spec drops', async () => {
    const { url } = await startSurfaceBridge({
      spec: paperclipSpec({ version: '1.2.3', drop: ['GET /api/companies/{companyId}/issues'] }),
    })
    await waitUntil(async () => (await healthOf(url)).surface?.ok === false)

    const health = await healthOf(url)
    expect(health.paperclipVersion).toBe('1.2.3')
    expect(health.surface.ok).toBe(false)
    expect(health.surface.missing).toEqual([{ method: 'GET', path: '/api/companies/{companyId}/issues' }])
    expect(health.surface.changed).toEqual([])
    expect(typeof health.surface.checkedAt).toBe('string')
  })

  it('takes the Paperclip version from its health answer, not from the spec', async () => {
    const { url } = await startSurfaceBridge({
      spec: paperclipSpec({ version: '1.0.0' }),
      health: { status: 'ok', version: '2026.1012.0' },
    })
    await waitUntil(async () => (await healthOf(url)).surface?.ok === true)

    expect((await healthOf(url)).paperclipVersion).toBe('2026.1012.0')
  })

  it('says when the spec answer is not JSON', async () => {
    const { url } = await startSurfaceBridge({ specBody: 'not a spec' })
    await waitUntil(async () => {
      const health = await healthOf(url)
      return health.surface?.ok === null && typeof health.surface.checkedAt === 'string'
    })

    const health = await healthOf(url)
    expect(health.paperclipVersion).toBeNull()
    expect(health.surface.ok).toBeNull()
    expect(health.surface.error).toMatch(/not a spec/i)
    expect(typeof health.surface.checkedAt).toBe('string')
  })

  it('says when Paperclip is down', async () => {
    const dead = createServer((req, res) => {
      res.writeHead(500)
      res.end()
    })
    const port = await new Promise((resolvePort) => {
      dead.listen(0, '127.0.0.1', () => resolvePort(dead.address().port))
    })
    await new Promise((resolveClose) => dead.close(resolveClose))

    const bridge = createBridge({
      paperclipUrl: `http://127.0.0.1:${port}`,
      companyId: 'comp-1',
      projectRoot: makeTempDir(),
      port: 0,
      reconnectMinMs: 40,
      reconnectMaxMs: 100,
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    await waitUntil(async () => {
      const health = await healthOf(url)
      return health.surface?.ok === null && typeof health.surface.checkedAt === 'string'
    })

    const health = await healthOf(url)
    expect(health.paperclip).toBe(false)
    expect(health.paperclipVersion).toBeNull()
    expect(health.surface.ok).toBeNull()
    expect(health.surface.error).toMatch(/not reachable/i)
  })

  it('never reports a new version with the surface of the old spec', async () => {
    let spec = paperclipSpec({ version: '1.0.0' })
    const next = paperclipSpec({ version: '2.0.0', drop: ['GET /api/companies/{companyId}/approvals'] })
    let specReads = 0
    const server = createServer((req, res) => {
      if (req.url === '/api/openapi.json') {
        specReads += 1
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' })
        res.end(JSON.stringify(spec))
        spec = next
        return
      }
      if (req.url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' })
        res.end(JSON.stringify({ status: 'ok', version: spec.info.version }))
        return
      }
      res.writeHead(404, { Connection: 'close' })
      res.end()
    })
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    cleanups.push(() => new Promise((resolveClose) => server.close(resolveClose)))
    server.on('upgrade', (req, socket) => socket.destroy())
    const bridge = createBridge({
      paperclipUrl: `http://127.0.0.1:${server.address().port}`,
      companyId: 'comp-1',
      projectRoot: makeTempDir(),
      port: 0,
      reconnectMinMs: 5000,
      surfaceEveryMs: 0,
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    await waitUntil(async () => Boolean((await healthOf(url)).surface?.checkedAt))
    const health = await healthOf(url)
    expect(health.paperclipVersion).toBe('2.0.0')
    expect(health.surface.ok).toBe(false)
    expect(health.surface.missing).toEqual([{ method: 'GET', path: '/api/companies/{companyId}/approvals' }])
    expect(specReads).toBe(2)
  })

  it('gives up with a sentence when the version changes on every read', async () => {
    let healthReads = 0
    const server = createServer((req, res) => {
      if (req.url === '/api/openapi.json') {
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' })
        res.end(JSON.stringify(paperclipSpec()))
        return
      }
      if (req.url === '/api/health') {
        healthReads += 1
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' })
        res.end(JSON.stringify({ status: 'ok', version: `1.0.${healthReads}` }))
        return
      }
      res.writeHead(404, { Connection: 'close' })
      res.end()
    })
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    cleanups.push(() => new Promise((resolveClose) => server.close(resolveClose)))
    server.on('upgrade', (req, socket) => socket.destroy())
    const bridge = createBridge({
      paperclipUrl: `http://127.0.0.1:${server.address().port}`,
      companyId: 'comp-1',
      projectRoot: makeTempDir(),
      port: 0,
      reconnectMinMs: 5000,
      surfaceEveryMs: 0,
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    await waitUntil(async () => Boolean((await healthOf(url)).surface?.checkedAt))
    const health = await healthOf(url)
    expect(health.paperclipVersion).toBeNull()
    expect(health.surface).toMatchObject({ ok: null, error: 'Paperclip changed while the bridge read its spec. The bridge checks again when its socket opens.' })
    expect(healthReads).toBe(6)
  })

  it('checks the spec again when the Paperclip socket reopens', async () => {
    const { fake, url } = await startSurfaceBridge({ spec: paperclipSpec({ version: '1.0.0' }) })
    await waitUntil(async () => {
      const health = await healthOf(url)
      return health.paperclip === true && health.paperclipVersion === '1.0.0' && health.surface?.ok === true
    })

    fake.setSpec(paperclipSpec({ version: '2.0.0', drop: ['GET /api/companies/{companyId}/approvals'] }))
    fake.dropClients()

    await waitUntil(async () => {
      const health = await healthOf(url)
      return fake.connections >= 2 && health.paperclip === true && health.paperclipVersion === '2.0.0'
    }, 5000)

    const health = await healthOf(url)
    expect(health.surface.ok).toBe(false)
    expect(health.surface.missing).toEqual([{ method: 'GET', path: '/api/companies/{companyId}/approvals' }])
  })

  it('leaves no timer behind after stop', async () => {
    const { fake, bridge, url } = await startSurfaceBridge({ spec: paperclipSpec(), surfaceEveryMs: 30 })
    await waitUntil(async () => (await healthOf(url)).surface?.ok === true)

    await bridge.stop()
    await sleep(200)
    const count = fake.specRequests.length
    await sleep(150)

    expect(fake.specRequests.length).toBe(count)
  })

  describe('feature switches', () => {
    const ALL_ON = Object.fromEntries(FEATURES.map((name) => [name, true]))
    const off = (feature) => ({ ...ALL_ON, [feature]: false })
    const sentence = (feature) => `Paperclip changed: ${feature} is off. Run npm run doctor to see which routes.`

    it('keeps every feature on with a full spec', async () => {
      const { url } = await startSurfaceBridge({ spec: paperclipSpec() })
      await waitUntil(async () => (await healthOf(url)).surface?.ok === true)

      expect((await healthOf(url)).features).toEqual(ALL_ON)
    })

    it('switches off only approvals and refuses its control route before Paperclip', async () => {
      const { fake, url } = await startSurfaceBridge({
        spec: paperclipSpec({ drop: ['GET /api/companies/{companyId}/approvals'] }),
        issues: [],
      })
      await waitUntil(async () => (await healthOf(url)).surface?.ok === false)

      expect((await healthOf(url)).features).toEqual(off('approvals'))
      const denied = await fetch(`${url}/api/control/approvals`)
      expect(denied.status).toBe(503)
      expect(await denied.json()).toEqual({ error: sentence('approvals') })

      const tasks = await fetch(`${url}/api/control/issues`)
      expect(tasks.status).toBe(200)
      expect(await tasks.json()).toEqual([])
      expect(fake.requests.some((request) => request.url === '/api/companies/comp-1/approvals')).toBe(false)
    })

    it('switches off meters when a costs field changes', async () => {
      const spec = paperclipSpec()
      delete spec.paths['/api/companies/{companyId}/costs/by-agent'].get.responses[200].content['application/json'].schema
        .properties.inputTokens
      const { url } = await startSurfaceBridge({ spec })
      await waitUntil(async () => (await healthOf(url)).surface?.ok === false)

      expect((await healthOf(url)).features).toEqual(off('meters'))
      const denied = await fetch(`${url}/api/control/costs`)
      expect(denied.status).toBe(503)
      expect(await denied.json()).toEqual({ error: sentence('meters') })
    })

    it('keeps the agent list when only the hire route changed', async () => {
      const { url } = await startSurfaceBridge({
        spec: paperclipSpec({ drop: ['POST /api/companies/{companyId}/agent-hires'] }),
      })
      await waitUntil(async () => (await healthOf(url)).surface?.ok === false)

      expect((await healthOf(url)).features).toEqual(off('team'))
      expect((await fetch(`${url}/api/control/agents`)).status).not.toBe(503)
      const hire = await fetch(`${url}/api/control/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New', adapterType: 'hermes_local' }),
      })
      expect(hire.status).toBe(503)
      expect(await hire.json()).toEqual({ error: sentence('team') })
    })

    it('keeps every feature on before the spec check answers', async () => {
      const { url } = await startSurfaceBridge({ spec: paperclipSpec(), specDelayMs: 500 })

      expect((await healthOf(url)).features).toEqual(ALL_ON)
    })

    it('keeps the event stream and the agent list when room is off', async () => {
      const { fake, url } = await startSurfaceBridge({ spec: paperclipSpec({ drop: ['GET /api/companies'] }) })
      await waitUntil(async () => {
        const health = await healthOf(url)
        return fake.connections > 0 && health.features?.room === false
      })

      const sse = await openSse(url)
      cleanups.push(() => sse.close())
      const frame = {
        id: 701,
        companyId: 'comp-1',
        type: 'heartbeat.run.queued',
        createdAt: '2026-10-20T12:00:00.000Z',
        payload: { runId: 'r7' },
      }
      fake.send(frame)
      const event = await sse.next((entry) => entry.event === 'frame')
      expect(JSON.parse(event.data)).toEqual(frame)
      expect((await fetch(`${url}/api/agents`)).status).toBe(200)
      expect((await fetch(`${url}/api/tree`)).status).toBe(200)
    })
  })
})

describe('backup routes', () => {
  const BACKUP_FILE = 'C:\\Users\\owner\\.paperclip\\instances\\default\\data\\backups\\paperclip-20261020-120000.sql.gz'
  const FINISHED_AT = '2026-10-20T12:00:05.000Z'

  async function startBackupBridge(options = {}) {
    const dir = makeTempDir()
    const fake = await startFakePaperclip('comp-1', [], {
      spec: paperclipSpec(),
      health: options.health,
      backup: options.backup,
    })
    cleanups.push(() => fake.close())
    const bridge = createBridge({
      paperclipUrl: fake.url,
      companyId: 'comp-1',
      projectRoot: dir,
      port: 0,
      ...options.bridge,
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    return { fake, url }
  }

  function healthWith(block) {
    return { ok: true, paperclipVersion: '2026.1012.0', databaseBackup: block }
  }

  function healthyBlock() {
    return {
      enabled: true,
      status: 'ok',
      backupDir: 'C:\\Users\\owner\\.paperclip\\instances\\default\\data\\backups',
      maxAgeHours: 26,
      latestBackup: {
        name: 'paperclip-20261020-090000.sql.gz',
        path: 'C:\\Users\\owner\\.paperclip\\instances\\default\\data\\backups\\paperclip-20261020-090000.sql.gz',
        mtime: '2026-10-20T09:00:00.000Z',
        ageHours: 3.1,
        sizeBytes: 48123,
      },
      lastFailure: null,
      warnings: [],
    }
  }

  function goodBackup() {
    return {
      status: 201,
      body: {
        backupFile: BACKUP_FILE,
        sizeBytes: 98765,
        prunedCount: 2,
        trigger: 'manual',
        backupDir: 'C:\\Users\\owner\\.paperclip\\instances\\default\\data\\backups',
        retention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 },
        startedAt: '2026-10-20T12:00:00.000Z',
        finishedAt: FINISHED_AT,
        durationMs: 5000,
      },
    }
  }

  it('answers the age and the warning codes of the last backup from Paperclip health', async () => {
    const { url } = await startBackupBridge({ health: healthWith(healthyBlock()) })

    const res = await fetch(`${url}/api/backup`)
    expect(res.status).toBe(200)
    const answer = await res.json()
    expect(answer).toMatchObject({
      enabled: true,
      status: 'ok',
      latestAt: '2026-10-20T09:00:00.000Z',
      ageHours: 3.1,
      warnings: [],
    })
    expect(Number.isNaN(Date.parse(answer.checkedAt))).toBe(false)
  })

  it('answers disabled with null times when the health answer has no backup block', async () => {
    const { url } = await startBackupBridge({ health: { ok: true, paperclipVersion: '2026.1012.0' } })

    const res = await fetch(`${url}/api/backup`)
    expect(res.status).toBe(200)
    const answer = await res.json()
    expect(answer).toMatchObject({
      enabled: false,
      status: null,
      latestAt: null,
      ageHours: null,
      warnings: [],
    })
    expect(Object.keys(answer).sort()).toEqual(['ageHours', 'checkedAt', 'enabled', 'latestAt', 'status', 'warnings'])
    expect(Number.isNaN(Date.parse(answer.checkedAt))).toBe(false)
  })

  it('lists only the codes of a stale backup warning', async () => {
    const block = healthyBlock()
    block.status = 'warning'
    block.latestBackup.ageHours = 31.4
    block.warnings = [
      { code: 'database_backup_stale', message: 'The last backup is 31.4 hours old.' },
      { code: 'database_backup_last_failure', message: 'The last backup failed.' },
    ]
    const { url } = await startBackupBridge({ health: healthWith(block) })

    const answer = await fetch(`${url}/api/backup`).then((r) => r.json())
    expect(answer.status).toBe('warning')
    expect(answer.ageHours).toBe(31.4)
    expect(answer.warnings).toEqual(['database_backup_stale', 'database_backup_last_failure'])
  })

  it('refuses a backup without the confirm flag and calls nothing', async () => {
    const { fake, url } = await startBackupBridge({ health: healthWith(healthyBlock()), backup: goodBackup() })

    const res = await postJson(url, '/api/backup', 'POST', {})
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Confirm the backup first.' })
    expect(fake.backupRequests).toEqual([])
  })

  it('answers the file name and no folder after a good backup', async () => {
    const { fake, url } = await startBackupBridge({ health: healthWith(healthyBlock()), backup: goodBackup() })

    const res = await postJson(url, '/api/backup', 'POST', { confirmed: true })
    expect(res.status).toBe(200)
    const answer = await res.json()
    expect(answer).toEqual({
      ok: true,
      name: 'paperclip-20261020-120000.sql.gz',
      sizeBytes: 98765,
      prunedCount: 2,
      finishedAt: FINISHED_AT,
    })
    const text = JSON.stringify(answer)
    expect(text).not.toContain('C:')
    expect(text).not.toContain('backups')
    expect(fake.backupRequests).toEqual(['/api/instance/database-backups'])
  })

  it('answers 409 when Paperclip is already making a backup', async () => {
    const { url } = await startBackupBridge({
      health: healthWith(healthyBlock()),
      backup: { status: 409, body: { error: 'Database backup already in progress' } },
    })

    const res = await postJson(url, '/api/backup', 'POST', { confirmed: true })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'A backup is already running.' })
  })

  it('answers 403 when Paperclip refuses the backup', async () => {
    const { url } = await startBackupBridge({
      health: healthWith(healthyBlock()),
      backup: { status: 403, body: { error: 'Instance admin access required' } },
    })

    const res = await postJson(url, '/api/backup', 'POST', { confirmed: true })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Paperclip refused the backup.' })
  })

  it('answers 502 on both routes when Paperclip is down', async () => {
    const dead = createServer((req, res) => {
      res.writeHead(500)
      res.end()
    })
    const port = await new Promise((resolvePort) => {
      dead.listen(0, '127.0.0.1', () => resolvePort(dead.address().port))
    })
    await new Promise((resolveClose) => dead.close(resolveClose))

    const dir = makeTempDir()
    const bridge = createBridge({
      paperclipUrl: `http://127.0.0.1:${port}`,
      companyId: 'comp-1',
      projectRoot: dir,
      port: 0,
      reconnectMinMs: 40,
      reconnectMaxMs: 100,
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const read = await fetch(`${url}/api/backup`)
    expect(read.status).toBe(502)
    expect(await read.json()).toEqual({ error: 'Paperclip did not answer.' })

    const write = await postJson(url, '/api/backup', 'POST', { confirmed: true })
    expect(write.status).toBe(502)
    expect(await write.json()).toEqual({ error: 'Paperclip could not make a backup.' })
  })

  it('reads the status and makes a backup through the control client', async () => {
    const { url } = await startBackupBridge({ health: healthWith(healthyBlock()), backup: goodBackup() })
    const client = createClient({ baseUrl: url })

    const status = await client.backupStatus()
    expect(status).toMatchObject({ enabled: true, status: 'ok', ageHours: 3.1, warnings: [] })

    const backup = await client.backupNow()
    expect(backup).toEqual({
      ok: true,
      name: 'paperclip-20261020-120000.sql.gz',
      sizeBytes: 98765,
      prunedCount: 2,
      finishedAt: FINISHED_AT,
    })
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

describe('masked keys', () => {
  const AGENTS = [{ id: 'a1', key: 'opencode', parser: 'opencode' }]
  const TREE = { rootName: 'agent-sandbox', files: [], dirs: [] }

  async function startMaskedBridge() {
    const dir = makeTempDir()
    const fake = await startFakePaperclip('comp-1', [{ id: 'a1', name: 'OpenCode Go', adapterType: 'opencode_local' }])
    cleanups.push(() => fake.close())
    const bridge = createBridge({ paperclipUrl: fake.url, companyId: 'comp-1', projectRoot: dir, port: 0 })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    await waitUntil(async () => (await fetch(`${url}/api/health`).then((r) => r.json())).paperclip)
    const health = () => fetch(`${url}/api/health`).then((r) => r.json())
    return { fake, url, health }
  }

  function queuedFrame(id) {
    return { id, companyId: 'comp-1', type: 'heartbeat.run.queued', createdAt: '2026-10-20T13:00:00.000Z', payload: { runId: 'r1' } }
  }

  function logFrame(id, chunk, seq = 1, truncated = false) {
    return {
      id,
      companyId: 'comp-1',
      type: 'heartbeat.run.log',
      createdAt: '2026-10-20T13:00:01.000Z',
      payload: { runId: 'r1', agentId: 'a1', seq, stream: 'stdout', chunk, truncated },
    }
  }

  async function startRestoreBridge() {
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
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    await waitUntil(async () => (await fetch(`${url}/api/health`).then((r) => r.json())).paperclip)
    const sse = await openSse(url)
    cleanups.push(() => sse.close())
    return { fake, sse, url }
  }

  it('masks a key before it reaches the stream, the history and a Last-Event-ID replay', async () => {
    const { fake, url, health } = await startMaskedBridge()
    const before = await health()
    expect(before.masked.total).toBe(0)
    expect(Number.isNaN(Date.parse(before.masked.since))).toBe(false)

    const sse = await openSse(url)
    cleanups.push(() => sse.close())

    fake.send(queuedFrame(801))
    await sse.next((e) => e.event === 'frame' && e.id === '801')

    fake.send(logFrame(802, keyedToolChunk()))
    const live = await sse.next((e) => e.event === 'frame' && e.id === '802')
    const masked = JSON.parse(live.data)
    expect(masked.payload.chunk).toContain('[key]')
    expect(masked.payload.chunk).not.toContain(FAKE_KEY)

    const activities = buildActivities([masked], { agents: AGENTS, tree: TREE })
    const start = activities.find((activity) => activity.type === 'tool.start')
    expect(start).toMatchObject({ tool: 'read' })
    expect(start.touches).toEqual([{ path: 'docs/notes.md', mode: 'read', kind: 'file' }])

    await waitUntil(async () => (await health()).masked.total === 1)
    expect((await health()).masked).toMatchObject({ total: 1 })

    const history = await openSse(url, {}, '?history=1')
    cleanups.push(() => history.close())
    const fromHistory = await history.next((e) => e.event === 'frame' && e.id === '802')
    expect(fromHistory.data).toBe(live.data)

    const replay = await openSse(url, { 'Last-Event-ID': '801' })
    cleanups.push(() => replay.close())
    const fromReplay = await replay.next((e) => e.event === 'frame' && e.id === '802')
    expect(fromReplay.data).toBe(live.data)
  })

  it('masks a key in an error message and a run error', async () => {
    const { fake, url, health } = await startMaskedBridge()
    const sse = await openSse(url)
    cleanups.push(() => sse.close())

    fake.send({
      id: 804,
      companyId: 'comp-1',
      type: 'heartbeat.run.event',
      createdAt: '2026-10-20T13:00:02.000Z',
      payload: { runId: 'r1', agentId: 'a1', seq: 1, level: 'error', message: `failed ${FAKE_KEY}` },
    })
    const messageEvent = JSON.parse((await sse.next((e) => e.event === 'frame' && e.id === '804')).data)
    expect(messageEvent.payload.message).toBe('failed [key]')

    fake.send({
      id: 805,
      companyId: 'comp-1',
      type: 'heartbeat.run.status',
      createdAt: '2026-10-20T13:00:03.000Z',
      payload: { runId: 'r1', status: 'failed', error: `boom ${FAKE_KEY}` },
    })
    const statusEvent = JSON.parse((await sse.next((e) => e.event === 'frame' && e.id === '805')).data)
    expect(statusEvent.payload.error).toBe('boom [key]')

    await waitUntil(async () => (await health()).masked.total === 2)
  })

  it('masks a key in a restored long chunk', async () => {
    const { fake, sse, url } = await startRestoreBridge()

    const full = `${keyedToolChunk()}${'x'.repeat(9000)}\n`
    fake.appendLog('r1', { ts: '2026-10-20T13:00:00.000Z', stream: 'stdout', chunk: full, seq: 1 })
    fake.send(logFrame(803, full.slice(-8192), 1, true))

    const frame = JSON.parse((await sse.next((e) => e.event === 'frame' && e.id === '803')).data)
    expect(frame.payload.chunk).toContain('[key]')
    expect(frame.payload.chunk).not.toContain(FAKE_KEY)
    expect(frame.payload.truncated).toBe(false)

    await waitUntil(async () => (await fetch(`${url}/api/health`).then((r) => r.json())).masked.total === 1)
  })

  it('masks a key that Paperclip splits across two chunks on the stream and in the history', async () => {
    const { fake, url, health } = await startMaskedBridge()
    const sse = await openSse(url)
    cleanups.push(() => sse.close())

    fake.send(queuedFrame(811))
    fake.send(logFrame(812, `reading ${FAKE_KEY.slice(0, 12)}`, 1))
    fake.send(logFrame(813, `${FAKE_KEY.slice(12)} done\n`, 2))
    const first = JSON.parse((await sse.next((e) => e.event === 'frame' && e.id === '812')).data)
    const second = JSON.parse((await sse.next((e) => e.event === 'frame' && e.id === '813')).data)
    expect(first.payload).toMatchObject({ seq: 1, chunk: 'reading [key]' })
    expect(second.payload).toMatchObject({ seq: 2, chunk: ' done\n' })
    await waitUntil(async () => (await health()).masked.total === 1)

    const history = await openSse(url, {}, '?history=1')
    cleanups.push(() => history.close())
    const seen = []
    for (const id of ['811', '812', '813']) seen.push((await history.next((e) => e.event === 'frame' && e.id === id)).data)
    expect(seen.join('')).toContain('[key]')
    expect(seen.join('')).not.toContain(FAKE_KEY.slice(0, 12))
    expect(seen.join('')).not.toContain(FAKE_KEY.slice(12))
  })

  it('releases a held tail unchanged within a second when no chunk follows', async () => {
    const { fake, url } = await startMaskedBridge()
    const sse = await openSse(url)
    cleanups.push(() => sse.close())

    const sent = Date.now()
    fake.send(logFrame(821, 'export sk-ab', 1))
    fake.send(queuedFrame(822))
    const held = JSON.parse((await sse.next((e) => e.event === 'frame' && e.id === '821')).data)
    const after = await sse.next((e) => e.event === 'frame' && e.id === '822')
    expect(held.payload.chunk).toBe('export sk-ab')
    expect(Date.now() - sent).toBeLessThan(2000)
    expect(after.id).toBe('822')
  })

  it('masks a key split between a restored long chunk and the next chunk', async () => {
    const { fake, sse } = await startRestoreBridge()

    const full = `${'x'.repeat(9000)}\nkey ${FAKE_KEY.slice(0, 20)}`
    fake.appendLog('r1', { ts: '2026-10-20T13:00:00.000Z', stream: 'stdout', chunk: full, seq: 1 })
    fake.send(logFrame(831, full.slice(-8192), 1, true))
    fake.send(logFrame(832, `${FAKE_KEY.slice(20)}\n`, 2))

    const first = JSON.parse((await sse.next((e) => e.event === 'frame' && e.id === '831')).data)
    const second = JSON.parse((await sse.next((e) => e.event === 'frame' && e.id === '832')).data)
    expect(first.payload.truncated).toBe(false)
    expect(first.payload.chunk).toBe(`${'x'.repeat(9000)}\nkey [key]`)
    expect(second.payload.chunk).toBe('\n')
  })
})

describe('unreadable counter', () => {
  const OPENCODE_BROKEN = '{"type":"tool_use","part":{"id":"p13","tool":"shell","state":{"input":{"command":"cat docs/notes.md"'
  const OPENCODE_GOOD = JSON.stringify({
    type: 'tool_use',
    part: { id: 'p1', tool: 'read', state: { status: 'completed', input: { path: 'docs/notes.md' } } },
  })
  const HERMES_PREPARING = '  \u250a \ud83d\udcbb preparing terminal\u2026'
  const HERMES_BROKEN = '  \u250a \ud83d\udcd6 read      strings.js'
  const ZERO = { claude: 0, hermes: 0, opencode: 0, agy: 0 }

  const agents = () => [
    { id: 'a1', name: 'Claude Code', adapterType: 'claude_local' },
    { id: 'a2', name: 'Hermes', adapterType: 'hermes_local' },
    { id: 'a3', name: 'OpenCode Go', adapterType: 'opencode_local' },
  ]

  function logFrame(id, { runId = 'r1', agentId = 'a3', seq = 1, stream = 'stdout', chunk, truncated = false }) {
    return {
      id,
      companyId: 'comp-1',
      type: 'heartbeat.run.log',
      createdAt: '2026-10-20T12:00:00.000Z',
      payload: { runId, agentId, seq, stream, chunk, truncated },
    }
  }

  function statusFrame(id, status, runId = 'r1') {
    return {
      id,
      companyId: 'comp-1',
      type: 'heartbeat.run.status',
      createdAt: '2026-10-20T12:00:01.000Z',
      payload: { runId, status },
    }
  }

  async function startCounterBridge(list = agents()) {
    const dir = makeTempDir()
    const fake = await startFakePaperclip('comp-1', list)
    cleanups.push(() => fake.close())
    const bridge = createBridge({ paperclipUrl: fake.url, companyId: 'comp-1', projectRoot: dir, port: 0 })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    await fetch(`${url}/api/agents`)
    const health = () => fetch(`${url}/api/health`).then((r) => r.json())
    return { fake, url, health, list }
  }

  const unparsedOf = async (health) => (await health()).unparsed

  it('starts at zero with a since time and counts a broken OpenCode line split over two frames once', async () => {
    const { fake, health } = await startCounterBridge()
    const first = await unparsedOf(health)
    expect(first.total).toBe(0)
    expect(first.byParser).toEqual(ZERO)
    expect(Number.isNaN(Date.parse(first.since))).toBe(false)

    const half = Math.floor(OPENCODE_BROKEN.length / 2)
    fake.send(logFrame(701, { seq: 1, chunk: OPENCODE_BROKEN.slice(0, half) }))
    fake.send(logFrame(702, { seq: 2, chunk: `${OPENCODE_BROKEN.slice(half)}\n` }))

    await waitUntil(async () => (await unparsedOf(health)).total === 1)
    expect(await unparsedOf(health)).toMatchObject({ total: 1, byParser: { ...ZERO, opencode: 1 } })
  })

  it('counts a well formed OpenCode line as nothing', async () => {
    const { fake, health } = await startCounterBridge()
    fake.send(logFrame(703, { chunk: `${OPENCODE_GOOD}\n` }))
    fake.send(logFrame(704, { seq: 2, chunk: `${OPENCODE_BROKEN}\n` }))

    await waitUntil(async () => (await unparsedOf(health)).total === 1)
    expect((await unparsedOf(health)).byParser.opencode).toBe(1)
  })

  it('counts a Hermes preparing line as nothing', async () => {
    const { fake, health } = await startCounterBridge()
    fake.send(logFrame(705, { agentId: 'a2', chunk: `${HERMES_PREPARING}\n` }))
    fake.send(logFrame(706, { agentId: 'a2', seq: 2, chunk: `${HERMES_BROKEN}\n` }))

    await waitUntil(async () => (await unparsedOf(health)).total === 1)
    expect((await unparsedOf(health)).byParser.hermes).toBe(1)
  })

  it('counts nothing from a stderr frame', async () => {
    const { fake, health } = await startCounterBridge()
    fake.send(logFrame(707, { stream: 'stderr', chunk: `${OPENCODE_BROKEN}\n` }))
    fake.send(logFrame(708, { seq: 2, chunk: `${OPENCODE_BROKEN}\n` }))

    await waitUntil(async () => (await unparsedOf(health)).total === 1)
    expect((await unparsedOf(health)).byParser.opencode).toBe(1)
  })

  it('counts nothing for an unknown agent until the agent list knows it and fetches that list once', async () => {
    const list = agents().filter((agent) => agent.id !== 'a3')
    const { fake, url, health } = await startCounterBridge(list)
    await sleep(100)
    const before = fake.agentRequests.length

    fake.send(logFrame(709, { chunk: OPENCODE_BROKEN }))
    fake.send(logFrame(710, { seq: 2, chunk: `${OPENCODE_BROKEN}\n` }))
    await waitUntil(() => fake.agentRequests.length > before)
    await sleep(100)
    expect(fake.agentRequests.length).toBe(before + 1)
    expect((await unparsedOf(health)).total).toBe(0)

    list.push({ id: 'a3', name: 'OpenCode Go', adapterType: 'opencode_local' })
    await fetch(`${url}/api/agents`)
    fake.send(logFrame(711, { seq: 3, chunk: `${OPENCODE_BROKEN}\n` }))

    await waitUntil(async () => (await unparsedOf(health)).total === 1)
    expect((await unparsedOf(health)).byParser.opencode).toBe(1)
  })

  it('keeps the old agent map when a fetch fails and never throws', async () => {
    const { fake, health } = await startCounterBridge()
    await sleep(100)
    const before = fake.agentRequests.length
    fake.setAgentsFailing(true)

    fake.send(logFrame(712, { agentId: 'ghost', chunk: `${OPENCODE_BROKEN}\n` }))
    await waitUntil(() => fake.agentRequests.length > before)
    await sleep(100)
    expect((await unparsedOf(health)).total).toBe(0)

    fake.send(logFrame(713, { seq: 2, chunk: `${OPENCODE_BROKEN}\n` }))
    await waitUntil(async () => (await unparsedOf(health)).total === 1)
  })

  it('counts a truncated frame the bridge restores as the full line', async () => {
    const { fake, health } = await startCounterBridge()
    const full = `${OPENCODE_BROKEN}\n${'x'.repeat(9000)}\n`
    fake.appendLog('r1', { ts: '2026-10-20T12:00:00.000Z', stream: 'stdout', chunk: full, seq: 1 })

    fake.send(logFrame(714, { seq: 1, chunk: full.slice(-8192), truncated: true }))

    await waitUntil(async () => (await unparsedOf(health)).total === 1)
    expect((await unparsedOf(health)).byParser.opencode).toBe(1)
  })

  it('counts a broken tail when the run ends', async () => {
    const { fake, health } = await startCounterBridge()
    fake.send(logFrame(715, { chunk: OPENCODE_BROKEN }))
    fake.send(logFrame(716, { runId: 'r2', seq: 2, chunk: `${OPENCODE_BROKEN}\n` }))
    await waitUntil(async () => (await unparsedOf(health)).total === 1)

    fake.send(statusFrame(717, 'succeeded', 'r1'))

    await waitUntil(async () => (await unparsedOf(health)).total === 2)
    expect((await unparsedOf(health)).byParser.opencode).toBe(2)
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

  it('accepts application/json with a charset parameter', async () => {
    const { url } = await startAssistantBridge({
      env: {},
      assistantRunner: async () => 'ok',
    })

    const res = await fetch(`${url}/api/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ prompt: 'hello' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'ok' })
  })

  it('answers 415 when application/json appears only after the semicolon', async () => {
    const { url } = await startAssistantBridge({
      env: {},
      assistantRunner: async () => 'should not run',
    })

    const res = await fetch(`${url}/api/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; x=application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    })
    expect(res.status).toBe(415)
    expect(await res.json()).toEqual({ error: 'Send JSON.' })
  })

  it('answers 413 to a 100 KB body and closes the connection before the rest is sent', async () => {
    const { url } = await startAssistantBridge({
      env: {},
      assistantRunner: async () => 'should not run',
    })
    const target = new URL(url)
    const body = 'x'.repeat(100 * 1024)
    const first = body.slice(0, 70 * 1024)
    const rest = body.slice(70 * 1024)
    const socket = connect(Number(target.port), target.hostname)
    socket.setEncoding('utf8')
    let text = ''
    socket.on('data', (chunk) => {
      text += chunk
    })
    const closed = new Promise((resolveClose) => socket.on('close', resolveClose))
    await new Promise((resolveOpen, rejectOpen) => {
      socket.on('connect', resolveOpen)
      socket.on('error', rejectOpen)
    })
    socket.write(`POST /api/assistant HTTP/1.1\r\nHost: ${target.host}\r\nContent-Type: application/json\r\nConnection: keep-alive\r\nContent-Length: ${body.length}\r\n\r\n`)
    socket.write(first)
    await closed

    expect(rest).toHaveLength(30 * 1024)
    expect(text).toContain('HTTP/1.1 413')
    expect(text).toMatch(/connection: close/i)
    expect(text).toContain('That request is too large.')
    expect(socket.destroyed).toBe(true)
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

describe('briefs routes', () => {
  function writeBriefFixture(rootDir, briefsSubdir = join(rootDir, 'docs', 'agents')) {
    mkdirSync(briefsSubdir, { recursive: true })
    writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ name: 'sample', version: '0.1.36' }))
    writeFileSync(
      join(briefsSubdir, 'TASKS.md'),
      [
        '## Next',
        '',
        '**C3e. HUD polish (AGY).** Move the assistant window.',
        '',
        '**T1b. Briefs menu in the dispatch panel (AGY).** Add a Brief menu.',
      ].join('\n')
    )
    writeFileSync(
      join(briefsSubdir, 'HOUSE-RULES.md'),
      ['## About', 'Sample viewer.', '## Rules', '- Never push.', '## Report', 'Report in your reply.'].join('\n')
    )
    writeFileSync(
      join(briefsSubdir, 'lanes.json'),
      JSON.stringify({
        agy: {
          name: 'agy',
          harness: 'agy',
          model: 'Gemini 3.8 Flash (High)',
          models: { C3e: 'Gemini 4 Argon', T1b: 'Gemini 4 Argon' },
          worktree: 'C:\\GitHub\\MachineRoom-agy',
          role: 'You own the HUD.',
          forbidden: ['server/**'],
          notes: [],
        },
      })
    )
  }

  it('serves briefs and builds a prompt for multiple ids from the project briefs folder', async () => {
    const dir = makeTempDir()
    writeBriefFixture(dir)
    const fake = await startFakePaperclip('comp-1')
    cleanups.push(() => fake.close())
    const bridge = createBridge({ paperclipUrl: fake.url, companyId: 'comp-1', projectRoot: dir, port: 0 })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const listRes = await fetch(`${url}/api/control/briefs`)
    expect(listRes.status).toBe(200)
    const { briefs } = await listRes.json()
    expect(briefs.map((b) => b.id)).toEqual(['C3e', 'T1b'])

    const promptRes = await fetch(`${url}/api/control/brief-prompt?ids=C3e,T1b&lane=agy`)
    expect(promptRes.status).toBe(200)
    const built = await promptRes.json()
    expect(built.lane).toBe('agy')
    expect(built.model).toBe('Gemini 4 Argon')
    expect(built.branch).toBe('feat/c3e-hud-polish')
    expect(built.prompt).toContain('Task C3e: HUD polish.')
    expect(built.prompt).toContain('Task T1b: Briefs menu in the dispatch panel.')
    expect(built.prompt).toContain('with the prefix 0.1.37 and one plain sentence')
  })

  it('answers an empty list or 404 with no path when files are missing, and 400 for an unknown lane or id', async () => {
    const emptyDir = makeTempDir()
    const fake = await startFakePaperclip('comp-1')
    cleanups.push(() => fake.close())
    const emptyBridge = createBridge({ paperclipUrl: fake.url, companyId: 'comp-1', projectRoot: emptyDir, port: 0 })
    cleanups.push(() => emptyBridge.stop())
    const { url: emptyUrl } = await emptyBridge.start()

    const missingList = await fetch(`${emptyUrl}/api/control/briefs`)
    expect(missingList.status).toBe(200)
    expect(await missingList.json()).toEqual({ briefs: [] })

    const missingPrompt = await fetch(`${emptyUrl}/api/control/brief-prompt?ids=C3e&lane=agy`)
    expect(missingPrompt.status).toBe(404)
    const missingBody = await missingPrompt.json()
    expect(missingBody.error).toMatch(/missing/i)
    expect(missingBody.error).not.toContain(emptyDir)
    expect(missingBody.error).not.toMatch(/[/\\]|TASKS\.md|HOUSE-RULES|lanes\.json|package\.json/)

    const customRoot = makeTempDir()
    const customBriefs = makeTempDir()
    writeBriefFixture(customRoot, customBriefs)
    const customBridge = createBridge({
      paperclipUrl: fake.url,
      companyId: 'comp-1',
      projectRoot: customRoot,
      briefsDir: customBriefs,
      port: 0,
    })
    cleanups.push(() => customBridge.stop())
    const { url: customUrl } = await customBridge.start()

    const badId = await fetch(`${customUrl}/api/control/brief-prompt?ids=NOPE&lane=agy`)
    expect(badId.status).toBe(400)

    const badLane = await fetch(`${customUrl}/api/control/brief-prompt?ids=C3e&lane=nobody`)
    expect(badLane.status).toBe(400)

    const badMethod = await fetch(`${customUrl}/api/control/briefs`, { method: 'POST' })
    expect(badMethod.status).toBe(405)

    const badOrigin = await fetch(`${customUrl}/api/control/briefs`, { headers: { Origin: 'https://evil.example' } })
    expect(badOrigin.status).toBe(403)
  })
})

function sendJson(res, status, data) {
  const payload = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}

function startFakeAgentPaperclip(companyId = 'comp-1', { requireApproval = true } = {}) {
  const calls = []
  const agents = [
    { id: 'agent-hermes', urlKey: 'hermes', name: 'Hermes', role: 'engineer', adapterType: 'hermes_local', adapterConfig: {}, metadata: {}, reportsTo: null, budgetMonthlyCents: 0, spentMonthlyCents: 0, status: 'idle' },
    { id: 'agent-agy', urlKey: 'agy', name: 'agy', role: 'designer', adapterType: 'process', adapterConfig: {}, metadata: {}, reportsTo: null, budgetMonthlyCents: 0, spentMonthlyCents: 0, status: 'idle' },
  ]
  const approvals = []
  let approvalCounter = 0

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname
    const method = req.method ?? 'GET'
    const body = method === 'GET' ? {} : await readJson(req)
    calls.push({ method, path, body })

    if (method === 'GET' && path === `/api/companies/${companyId}/agents`) {
      sendJson(res, 200, agents)
      return
    }
    if (method === 'GET' && path === `/api/companies/${companyId}`) {
      sendJson(res, 200, { id: companyId, name: 'MachineRoom', requireBoardApprovalForNewAgents: requireApproval })
      return
    }
    if (method === 'GET' && path === `/api/companies/${companyId}/approvals`) {
      sendJson(res, 200, approvals)
      return
    }
    if (method === 'GET' && path === `/api/companies/${companyId}/costs/by-agent`) {
      sendJson(res, 200, [])
      return
    }
    if (method === 'POST' && path === `/api/companies/${companyId}/agent-hires`) {
      const key = String(body.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      const agent = {
        id: `agent-${key}`,
        urlKey: key,
        name: String(body.name ?? ''),
        role: body.role ?? 'general',
        adapterType: body.adapterType ?? '',
        adapterConfig: body.adapterConfig ?? {},
        metadata: body.metadata ?? {},
        reportsTo: body.reportsTo ?? null,
        budgetMonthlyCents: body.budgetMonthlyCents ?? 0,
        spentMonthlyCents: 0,
        status: requireApproval ? 'pending_approval' : 'idle',
      }
      agents.push(agent)
      let approval = null
      if (requireApproval) {
        approvalCounter += 1
        approval = {
          id: `approval-${approvalCounter}`,
          type: 'hire_agent',
          status: 'pending',
          payload: { summary: `Hire "${agent.name}".`, agentId: agent.id },
          requestedByAgentId: null,
          createdAt: new Date().toISOString(),
        }
        approvals.unshift(approval)
      }
      sendJson(res, 201, { agent, approval })
      return
    }
    const patchRoute = /^\/api\/agents\/([^/]+)$/.exec(path)
    if (method === 'PATCH' && patchRoute) {
      const agent = agents.find((item) => item.id === decodeURIComponent(patchRoute[1]))
      if (!agent) {
        sendJson(res, 404, { error: 'Agent not found' })
        return
      }
      if (body.adapterConfig && typeof body.adapterConfig === 'object') {
        agent.adapterConfig = { ...agent.adapterConfig, ...body.adapterConfig }
      }
      if (body.metadata && typeof body.metadata === 'object') agent.metadata = body.metadata
      if (body.name !== undefined) agent.name = body.name
      if (body.role !== undefined) agent.role = body.role
      if (body.reportsTo !== undefined) agent.reportsTo = body.reportsTo
      if (body.status !== undefined) agent.status = body.status
      sendJson(res, 200, agent)
      return
    }
    const turnRoute = /^\/api\/agents\/([^/]+)\/(pause|resume)$/.exec(path)
    if (method === 'POST' && turnRoute) {
      const agent = agents.find((item) => item.id === decodeURIComponent(turnRoute[1]))
      if (!agent) {
        sendJson(res, 404, { error: 'Agent not found' })
        return
      }
      agent.status = turnRoute[2] === 'pause' ? 'paused' : 'idle'
      sendJson(res, 200, agent)
      return
    }
    const budgetRoute = /^\/api\/agents\/([^/]+)\/budgets$/.exec(path)
    if (method === 'PATCH' && budgetRoute) {
      const agent = agents.find((item) => item.id === decodeURIComponent(budgetRoute[1]))
      if (!agent) {
        sendJson(res, 404, { error: 'Agent not found' })
        return
      }
      agent.budgetMonthlyCents = body.budgetMonthlyCents
      sendJson(res, 200, agent)
      return
    }
    sendJson(res, 404, { error: 'API route not found' })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}`,
        calls,
        agents,
        close: () =>
          new Promise((resolveClose) => {
            server.close(() => resolveClose())
          }),
      })
    })
  })
}

async function makeAgentBridge(options = {}) {
  const fake = await startFakeAgentPaperclip('comp-1', options)
  cleanups.push(() => fake.close())
  const bridge = createBridge({ paperclipUrl: fake.url, companyId: 'comp-1', projectRoot: '', port: 0 })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { fake, url }
}

function postJson(url, path, method, body) {
  return fetch(`${url}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('control agent routes', () => {
  it('puts the settings in adapterConfig on a hire and keeps the rest in metadata', async () => {
    const { fake, url } = await makeAgentBridge()
    const res = await postJson(url, '/api/control/agents', 'POST', {
      name: 'Scout',
      adapterType: 'claude_local',
      role: 'engineer',
      model: 'claude-haiku-5-5',
      reasoningEffort: 'high',
      maxTurnsPerRun: 4,
      timeoutSec: 120,
      budgetMonthlyCents: 250,
      subagentsAllowed: true,
      subagentDepth: 2,
      reportsToAgentId: 'agent-hermes',
      instructions: 'Be brief.',
    })
    expect(res.status).toBe(201)
    const answer = await res.json()
    expect(answer.agent).toMatchObject({
      id: 'agent-scout',
      name: 'Scout',
      role: 'engineer',
      status: 'pending_approval',
      model: 'claude-haiku-5-5',
      reasoningEffort: 'high',
      maxTurnsPerRun: 4,
      timeoutSec: 120,
      budgetMonthlyCents: 250,
      subagentsAllowed: true,
      subagentDepth: 2,
      reportsToAgentId: 'agent-hermes',
    })
    expect(answer.approval).toMatchObject({ type: 'hire_agent', status: 'pending', agentId: 'agent-scout' })
    const hire = fake.calls.find((call) => call.method === 'POST' && call.path.endsWith('/agent-hires'))
    expect(hire.body).toEqual({
      name: 'Scout',
      role: 'engineer',
      adapterType: 'claude_local',
      adapterConfig: { model: 'claude-haiku-5-5', maxTurnsPerRun: 4, timeoutSec: 120, effort: 'high' },
      metadata: { subagents: { allowed: true, depth: 2 } },
      budgetMonthlyCents: 250,
      reportsTo: 'agent-hermes',
      instructionsBundle: { entryFile: 'AGENTS.md', files: { 'AGENTS.md': 'Be brief.' } },
    })
  })

  it('keeps the reasoning effort in metadata where the harness has no field for it', async () => {
    const { fake, url } = await makeAgentBridge()
    await postJson(url, '/api/control/agents', 'POST', { name: 'Scribe', adapterType: 'hermes_local', reasoningEffort: 'low' })
    await postJson(url, '/api/control/agents', 'POST', { name: 'Seeker', adapterType: 'opencode_local', reasoningEffort: 'medium' })
    const [scribe, seeker] = fake.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/agent-hires')).map((call) => call.body)
    expect(scribe.adapterConfig).toEqual({})
    expect(scribe.metadata).toEqual({ subagents: { allowed: false, depth: 0 }, reasoningEffort: 'low' })
    expect(seeker.adapterConfig).toEqual({ variant: 'medium' })
    expect(seeker.metadata).toEqual({ subagents: { allowed: false, depth: 0 } })
  })

  it('answers no approval when the company does not require one', async () => {
    const { url } = await makeAgentBridge({ requireApproval: false })
    const res = await postJson(url, '/api/control/agents', 'POST', { name: 'Scout', adapterType: 'claude_local' })
    const answer = await res.json()
    expect(answer.agent.status).toBe('idle')
    expect(answer.approval).toBeNull()
  })

  it('updates an agent through the patch route and a budget through the budgets route', async () => {
    const { fake, url } = await makeAgentBridge()
    const res = await postJson(url, '/api/control/agents/agent-hermes', 'PATCH', {
      model: 'm2',
      maxTurnsPerRun: 3,
      subagentsAllowed: true,
      budgetMonthlyCents: 250,
      status: 'paused',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ model: 'm2', maxTurnsPerRun: 3, subagentsAllowed: true, subagentDepth: 1, budgetMonthlyCents: 250, status: 'paused' })
    const patch = fake.calls.find((call) => call.method === 'PATCH' && call.path === '/api/agents/agent-hermes')
    expect(patch.body).toEqual({
      adapterConfig: { model: 'm2', maxTurnsPerRun: 3 },
      metadata: { subagents: { allowed: true, depth: 1 } },
    })
    const budget = fake.calls.find((call) => call.method === 'PATCH' && call.path === '/api/agents/agent-hermes/budgets')
    expect(budget.body).toEqual({ budgetMonthlyCents: 250 })
    expect(fake.calls.some((call) => call.method === 'POST' && call.path === '/api/agents/agent-hermes/pause')).toBe(true)
  })

  it('pauses and resumes through Paperclip\'s own routes, not a status write', async () => {
    const { fake, url } = await makeAgentBridge()
    const paused = await postJson(url, '/api/control/agents/agent-hermes', 'PATCH', { status: 'paused' })
    expect((await paused.json()).status).toBe('paused')
    const resumed = await postJson(url, '/api/control/agents/agent-hermes', 'PATCH', { status: 'active' })
    expect((await resumed.json()).status).toBe('idle')
    const paths = fake.calls.filter((call) => call.method === 'POST' && /\/(pause|resume)$/.test(call.path)).map((call) => call.path)
    expect(paths).toEqual(['/api/agents/agent-hermes/pause', '/api/agents/agent-hermes/resume'])
    expect(fake.calls.some((call) => call.method === 'PATCH' && call.path === '/api/agents/agent-hermes')).toBe(false)
  })

  it('answers 404 for an agent id that is not valid percent encoding', async () => {
    const { url } = await makeAgentBridge()
    const res = await postJson(url, '/api/control/agents/%E0%A4%A', 'PATCH', { model: 'm2' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'That agent no longer exists.' })
  })

  it('refuses a bad hire and a bad update with the same sentences as the mock', async () => {
    const { url } = await makeAgentBridge()
    const missingName = await postJson(url, '/api/control/agents', 'POST', { adapterType: 'claude_local' })
    expect(missingName.status).toBe(400)
    expect(await missingName.json()).toEqual({ error: 'A name is required.' })

    const duplicate = await postJson(url, '/api/control/agents', 'POST', { name: 'Hermes', adapterType: 'hermes_local' })
    expect(await duplicate.json()).toEqual({ error: 'An agent with that name already exists.' })

    const unknown = await postJson(url, '/api/control/agents/agent-hermes', 'PATCH', { perms: {} })
    expect(await unknown.json()).toEqual({ error: 'Unknown setting: perms.' })

    const instructions = await postJson(url, '/api/control/agents/agent-hermes', 'PATCH', { instructions: 'Be brief.' })
    expect(await instructions.json()).toEqual({ error: 'The instructions cannot be changed here yet.' })

    const missing = await postJson(url, '/api/control/agents/agent-ghost', 'PATCH', { model: 'm' })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'That agent no longer exists.' })

    const depth = await postJson(url, '/api/control/agents/agent-agy', 'PATCH', { subagentDepth: 2 })
    expect(await depth.json()).toEqual({ error: 'Turn subagents on to set a depth.' })
  })
})

describe('agent change notices', () => {
  it('sends an agents notice for the Paperclip activity that creates or updates an agent', async () => {
    const fake = await startFakePaperclip('comp-1', [])
    cleanups.push(() => fake.close())
    const bridge = createBridge({ paperclipUrl: fake.url, companyId: 'comp-1', projectRoot: '', port: 0 })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    const sse = await openSse(url)
    cleanups.push(() => sse.close())
    await waitUntil(() => fake.connections > 0)

    fake.send({ id: 1, companyId: 'comp-1', type: 'activity.logged', createdAt: new Date().toISOString(), payload: { action: 'agent.hire_created', entityType: 'agent', entityId: 'agent-1', details: { name: 'Scout' } } })
    const created = await sse.next((event) => event.event === 'change')
    expect(JSON.parse(created.data)).toEqual({ topic: 'agents' })

    fake.send({ id: 2, companyId: 'comp-1', type: 'activity.logged', createdAt: new Date().toISOString(), payload: { action: 'agent.updated', entityType: 'agent', entityId: 'agent-1', details: { changedTopLevelKeys: ['name'] } } })
    const updated = await sse.next((event) => event.event === 'change')
    expect(JSON.parse(updated.data)).toEqual({ topic: 'agents' })

    fake.send({ id: 3, companyId: 'comp-1', type: 'activity.logged', createdAt: new Date().toISOString(), payload: { action: 'approval.created', entityType: 'approval', entityId: 'approval-1', details: { type: 'hire_agent' } } })
    const approval = await sse.next((event) => event.event === 'change')
    expect(JSON.parse(approval.data)).toEqual({ topic: 'approvals' })
  })
})

describe('run routes', () => {
  const TINY_RUNNER = [
    "import { appendFileSync, mkdirSync } from 'node:fs'",
    "import { tmpdir } from 'node:os'",
    "import { join } from 'node:path'",
    'const args = process.argv.slice(2)',
    "console.log('args ' + args.join(' '))",
    "for (let i = 1; i <= 7; i += 1) console.log('line ' + i)",
    'await new Promise((done) => setTimeout(done, 300))',
    "const folder = join(process.env.TEMP || tmpdir(), 'machineroom-runs')",
    "mkdirSync(folder, { recursive: true })",
    "const record = { lane: args[0], briefs: args.slice(1), model: null, reasoning: null, startedAt: new Date().toISOString(), minutes: 0, exitCode: 0, killed: false, costUsd: null, log: null, branch: '', commits: [] }",
    "appendFileSync(join(folder, 'runs.jsonl'), JSON.stringify(record) + '\\n')",
  ].join('\n')

  const TINY_SLEEPER = [
    "console.log('pid ' + process.pid)",
    "console.log('sleeping')",
    'setTimeout(() => {}, 60000)',
  ].join('\n')

  function writeRunsProject(dir) {
    const agents = join(dir, 'docs', 'agents')
    mkdirSync(agents, { recursive: true })
    writeFileSync(
      join(agents, 'TASKS.md'),
      ['**B6. Late join replay (OpenCode).** Let the event stream send history.', '', '**C3e. HUD polish (AGY).** Move the assistant window.'].join('\n')
    )
    writeFileSync(
      join(agents, 'lanes.json'),
      JSON.stringify({
        hermes: { name: 'Hermes', harness: 'Hermes', cli: { harness: 'hermes', bin: 'hermes.exe', model: 'deepseek/deepseek-v4.1-flash-1017' } },
        opencode: { name: 'OpenCode', harness: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/mimo-v2.6-pro' } },
        agy: { name: 'agy', harness: 'agy' },
      })
    )
  }

  function useRunsTemp() {
    const dir = makeTempDir()
    const previous = process.env.TEMP
    process.env.TEMP = dir
    cleanups.push(() => {
      process.env.TEMP = previous
    })
    return dir
  }

  async function startRunsBridge({ script = TINY_RUNNER, project = true } = {}) {
    const dir = makeTempDir()
    if (project) writeRunsProject(dir)
    const runnerPath = join(makeTempDir(), 'tiny-runner.mjs')
    writeFileSync(runnerPath, script)
    const fake = await startFakePaperclip('comp-1')
    cleanups.push(() => fake.close())
    const bridge = createBridge({
      paperclipUrl: fake.url,
      companyId: 'comp-1',
      projectRoot: dir,
      port: 0,
      runnerCommand: { file: process.execPath, args: [runnerPath] },
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    return { url, dir, bridge }
  }

  function statsRecord({ lane, model = 'deepseek/v4.1-flash-1017', startedAt, minutes, costUsd = null, exitCode = 0 }) {
    return JSON.stringify({ lane, model, startedAt, minutes, exitCode, killed: false, costUsd })
  }

  function writeRuns(tempDir, lines) {
    const folder = join(tempDir, 'machineroom-runs')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'runs.jsonl'), `${lines.join('\n')}\n`)
  }

  const EMPTY_STATS = {
    rows: [],
    total: {
      lane: 'all',
      model: 'all',
      runs: 0,
      finished: 0,
      killed: 0,
      failed: 0,
      minutesTotal: 0,
      minutesMedian: 0,
      costTotal: 0,
      costRuns: 0,
    },
  }

  it('answers lane totals over every record, not just the last 20', async () => {
    const tempDir = useRunsTemp()
    const { url } = await startRunsBridge()
    const lines = []
    for (let i = 1; i <= 24; i += 1) {
      lines.push(
        statsRecord({
          lane: i <= 20 ? 'hermes' : 'opencode',
          startedAt: `2026-10-${String(i).padStart(2, '0')}T12:00:00.000Z`,
          minutes: 2,
          costUsd: 0.5,
        })
      )
    }
    writeRuns(tempDir, lines)

    const res = await fetch(`${url}/api/control/runs/stats`)
    expect(res.status).toBe(200)
    const stats = await res.json()
    expect(stats.rows).toEqual([
      {
        lane: 'hermes',
        model: 'deepseek/v4.1-flash-1017',
        runs: 20,
        finished: 20,
        killed: 0,
        failed: 0,
        minutesTotal: 40,
        minutesMedian: 2,
        costTotal: 10,
        costRuns: 20,
      },
      {
        lane: 'opencode',
        model: 'deepseek/v4.1-flash-1017',
        runs: 4,
        finished: 4,
        killed: 0,
        failed: 0,
        minutesTotal: 8,
        minutesMedian: 2,
        costTotal: 2,
        costRuns: 4,
      },
    ])
    expect(stats.total).toEqual({
      lane: 'all',
      model: 'all',
      runs: 24,
      finished: 24,
      killed: 0,
      failed: 0,
      minutesTotal: 48,
      minutesMedian: 2,
      costTotal: 12,
      costRuns: 24,
    })
  })

  it('keeps the runs since a day and refuses a bad day with the runner sentence', async () => {
    const tempDir = useRunsTemp()
    const { url } = await startRunsBridge()
    writeRuns(tempDir, [
      statsRecord({ lane: 'hermes', startedAt: '2026-10-18T23:59:59.999Z', minutes: 1, costUsd: 1 }),
      statsRecord({ lane: 'hermes', startedAt: '2026-10-19T00:00:00.000Z', minutes: 2, costUsd: 2 }),
      statsRecord({ lane: 'opencode', model: 'other/model', startedAt: '2026-10-20T08:00:00.000Z', minutes: 3, costUsd: 3 }),
    ])

    const res = await fetch(`${url}/api/control/runs/stats?since=2026-10-19`)
    expect(res.status).toBe(200)
    const stats = await res.json()
    expect(stats.rows.map((row) => [row.lane, row.model, row.runs, row.costTotal])).toEqual([
      ['hermes', 'deepseek/v4.1-flash-1017', 1, 2],
      ['opencode', 'other/model', 1, 3],
    ])
    expect(stats.total).toMatchObject({ runs: 2, minutesTotal: 5, costTotal: 5 })

    const none = await fetch(`${url}/api/control/runs/stats?since=2026-10-21`).then((r) => r.json())
    expect(none).toEqual(EMPTY_STATS)

    const bad = await fetch(`${url}/api/control/runs/stats?since=2026-02-30`)
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: '--since needs a date like 2026-10-19.' })

    const wrongMethod = await fetch(`${url}/api/control/runs/stats`, { method: 'POST' })
    expect(wrongMethod.status).toBe(405)
  })

  it('answers the empty result for a missing or empty file and skips junk lines', async () => {
    const tempDir = useRunsTemp()
    const { url } = await startRunsBridge()

    const missing = await fetch(`${url}/api/control/runs/stats`)
    expect(missing.status).toBe(200)
    expect(await missing.json()).toEqual(EMPTY_STATS)

    const folder = join(tempDir, 'machineroom-runs')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'runs.jsonl'), '')
    const empty = await fetch(`${url}/api/control/runs/stats`)
    expect(empty.status).toBe(200)
    expect(await empty.json()).toEqual(EMPTY_STATS)

    writeRuns(tempDir, [
      statsRecord({ lane: 'hermes', startedAt: '2026-10-19T09:00:00.000Z', minutes: 4, costUsd: 1 }),
      'not json at all',
      '{ "lane": ',
      statsRecord({ lane: 'hermes', startedAt: '2026-10-19T10:00:00.000Z', minutes: 6, costUsd: 2 }),
      'null',
      '[]',
      JSON.stringify({ lane: '', startedAt: '2026-10-19T11:00:00.000Z', minutes: 9, costUsd: 9 }),
    ])
    const stats = await fetch(`${url}/api/control/runs/stats`).then((r) => r.json())
    expect(stats.rows).toEqual([
      {
        lane: 'hermes',
        model: 'deepseek/v4.1-flash-1017',
        runs: 2,
        finished: 2,
        killed: 0,
        failed: 0,
        minutesTotal: 10,
        minutesMedian: 5,
        costTotal: 3,
        costRuns: 2,
      },
    ])
    expect(stats.total.runs).toBe(2)
  })

  it('reads the stats through the control client', async () => {
    const tempDir = useRunsTemp()
    const { url } = await startRunsBridge()
    writeRuns(tempDir, [
      statsRecord({ lane: 'hermes', startedAt: '2026-10-18T12:00:00.000Z', minutes: 1, costUsd: 0.25 }),
      statsRecord({ lane: 'opencode', model: 'other/model', startedAt: '2026-10-19T12:00:00.000Z', minutes: 3, costUsd: 0.75 }),
    ])
    const client = createClient({ baseUrl: url })

    const all = await client.runStats()
    expect(all.total).toMatchObject({ runs: 2, minutesTotal: 4, costTotal: 1 })

    const since = await client.runStats({ since: '2026-10-19' })
    expect(since.rows).toEqual([
      {
        lane: 'opencode',
        model: 'other/model',
        runs: 1,
        finished: 1,
        killed: 0,
        failed: 0,
        minutesTotal: 3,
        minutesMedian: 3,
        costTotal: 0.75,
        costRuns: 1,
      },
    ])

    await expect(client.runStats({ since: 'yesterday' })).rejects.toThrow('--since needs a date like 2026-10-19.')
  })

  it('answers an empty recent list when the records file is missing', async () => {
    useRunsTemp()
    const { url } = await startRunsBridge()
    const res = await fetch(`${url}/api/control/runs`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ running: [], recent: [] })
  })

  it('reads the last 20 records newest first and skips lines that do not parse', async () => {
    const tempDir = useRunsTemp()
    const { url } = await startRunsBridge()
    const folder = join(tempDir, 'machineroom-runs')
    mkdirSync(folder, { recursive: true })
    const lines = []
    for (let i = 1; i <= 25; i += 1) {
      lines.push(JSON.stringify({ lane: `lane-${i}`, briefs: ['C3e'], startedAt: new Date(i * 1000).toISOString() }))
      if (i === 5) lines.push('not json at all')
      if (i === 9) lines.push('{ "lane": ')
    }
    writeFileSync(join(folder, 'runs.jsonl'), `${lines.join('\n')}\n`)

    const res = await fetch(`${url}/api/control/runs`)
    const { running, recent } = await res.json()
    expect(running).toEqual([])
    expect(recent).toHaveLength(20)
    expect(recent.map((record) => record.lane)).toEqual([
      'lane-25', 'lane-24', 'lane-23', 'lane-22', 'lane-21', 'lane-20', 'lane-19', 'lane-18', 'lane-17', 'lane-16',
      'lane-15', 'lane-14', 'lane-13', 'lane-12', 'lane-11', 'lane-10', 'lane-9', 'lane-8', 'lane-7', 'lane-6',
    ])
  })

  it('starts the runner with an argument list, keeps the last five lines and records the run when it ends', async () => {
    useRunsTemp()
    const { url } = await startRunsBridge()
    const res = await postJson(url, '/api/control/runs', 'POST', { lane: 'hermes', briefs: ['C3e', 'B6'], confirmed: true })
    expect(res.status).toBe(202)
    const entry = await res.json()
    expect(entry.lane).toBe('hermes')
    expect(entry.briefs).toEqual(['C3e', 'B6'])
    expect(typeof entry.startedAt).toBe('string')
    expect(entry.lastLines).toEqual([])

    await waitUntil(async () => {
      const { running } = await fetch(`${url}/api/control/runs`).then((r) => r.json())
      return running.length === 1 && running[0].lastLines.includes('line 7')
    })
    const runningNow = await fetch(`${url}/api/control/runs`).then((r) => r.json())
    expect(runningNow.running[0].lastLines).toEqual(['line 3', 'line 4', 'line 5', 'line 6', 'line 7'])

    await waitUntil(async () => {
      const state = await fetch(`${url}/api/control/runs`).then((r) => r.json())
      return state.running.length === 0 && state.recent.length === 1
    })
    const done = await fetch(`${url}/api/control/runs`).then((r) => r.json())
    expect(done.recent[0]).toMatchObject({ lane: 'hermes', briefs: ['C3e', 'B6'], exitCode: 0, killed: false })
  })

  it('refuses a bad lane, a bad brief and a second run on a busy lane with plain sentences', async () => {
    useRunsTemp()
    const { url } = await startRunsBridge()

    const noLane = await postJson(url, '/api/control/runs', 'POST', { briefs: ['C3e'], confirmed: true })
    expect(noLane.status).toBe(400)
    expect(await noLane.json()).toEqual({ error: 'Choose a lane from the list.' })
    const badLane = await postJson(url, '/api/control/runs', 'POST', { lane: 'nobody', briefs: ['C3e'], confirmed: true })
    expect(await badLane.json()).toEqual({ error: 'Choose a lane from the list.' })
    const noCli = await postJson(url, '/api/control/runs', 'POST', { lane: 'agy', briefs: ['C3e'], confirmed: true })
    expect(noCli.status).toBe(400)
    expect(await noCli.json()).toEqual({ error: 'That lane has no command line.' })

    const empty = await postJson(url, '/api/control/runs', 'POST', { lane: 'hermes', briefs: [], confirmed: true })
    expect(await empty.json()).toEqual({ error: 'Choose one to five briefs.' })
    const tooMany = await postJson(url, '/api/control/runs', 'POST', { lane: 'hermes', briefs: ['B6', 'C3e', 'B6', 'C3e', 'B6', 'C3e'], confirmed: true })
    expect(await tooMany.json()).toEqual({ error: 'Choose one to five briefs.' })
    const notAList = await postJson(url, '/api/control/runs', 'POST', { lane: 'hermes', briefs: 'C3e', confirmed: true })
    expect(await notAList.json()).toEqual({ error: 'Choose one to five briefs.' })

    for (const briefs of [['c3e'], ['C3e&calc'], ['Z9'], ['C3e', 42]]) {
      const badId = await postJson(url, '/api/control/runs', 'POST', { lane: 'hermes', briefs, confirmed: true })
      expect(badId.status).toBe(400)
      expect(await badId.json()).toEqual({ error: 'Choose a brief from the list.' })
    }

    const wrongMethod = await fetch(`${url}/api/control/runs`, { method: 'DELETE' })
    expect(wrongMethod.status).toBe(405)

    const started = await postJson(url, '/api/control/runs', 'POST', { lane: 'hermes', briefs: ['C3e'], confirmed: true })
    expect(started.status).toBe(202)
    const busy = await postJson(url, '/api/control/runs', 'POST', { lane: 'hermes', briefs: ['B6'], confirmed: true })
    expect(busy.status).toBe(409)
    expect(await busy.json()).toEqual({ error: 'That lane is already running.' })
    const otherLane = await postJson(url, '/api/control/runs', 'POST', { lane: 'opencode', briefs: ['B6'], confirmed: true })
    expect(otherLane.status).toBe(202)
  })

  it('refuses a run that was not confirmed', async () => {
    useRunsTemp()
    const { url } = await startRunsBridge()

    for (const confirmed of [undefined, false, 'true', 1]) {
      const body = { lane: 'hermes', briefs: ['C3e'] }
      if (confirmed !== undefined) body.confirmed = confirmed
      const res = await postJson(url, '/api/control/runs', 'POST', body)
      expect(res.status, String(confirmed)).toBe(400)
      expect(await res.json(), String(confirmed)).toEqual({ error: 'Confirm the run first.' })
    }

    const { running, recent } = await fetch(`${url}/api/control/runs`).then((r) => r.json())
    expect(running).toEqual([])
    expect(recent).toEqual([])
  })

  it('answers 404 without a path when the brief files are missing', async () => {
    useRunsTemp()
    const { url, dir } = await startRunsBridge({ project: false })
    const res = await postJson(url, '/api/control/runs', 'POST', { lane: 'hermes', briefs: ['C3e'], confirmed: true })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/missing/i)
    expect(body.error).not.toContain(dir)
    expect(body.error).not.toMatch(/[/\\]|TASKS\.md|lanes\.json/)
  })

  it('keeps the run going after the request and kills it when the bridge stops', async () => {
    useRunsTemp()
    const { url, bridge } = await startRunsBridge({ script: TINY_SLEEPER })
    const res = await postJson(url, '/api/control/runs', 'POST', { lane: 'hermes', briefs: ['C3e'], confirmed: true })
    expect(res.status).toBe(202)
    await res.arrayBuffer()

    let pid = 0
    await waitUntil(async () => {
      const { running } = await fetch(`${url}/api/control/runs`).then((r) => r.json())
      const line = running[0]?.lastLines.find((item) => item.startsWith('pid '))
      if (!line) return false
      pid = Number(line.slice('pid '.length))
      return Number.isInteger(pid) && pid > 0
    })
    expect(() => process.kill(pid, 0)).not.toThrow()

    await bridge.stop()
    await waitUntil(() => {
      try {
        process.kill(pid, 0)
        return false
      } catch {
        return true
      }
    })
  })
})

describe('decide route', () => {
  const KEY = 'test-decision-key-123456'
  const QUESTIONS = { tier: choice('Which tier?', { small: 'A small one.', large: 'A large one.' }) }
  const ANSWERS = {
    tier: { type: 'choice', choice: 'small', confidence: 0.9, probabilities: { small: 0.9, large: 0.1 } },
  }
  const RAW_USAGE = { input_tokens: 120, output_tokens: 8, cost: 0.00002 }
  const USAGE = { inputTokens: 120, outputTokens: 8, cost: 0.00002 }

  function goodAnswer(body) {
    return { body: { model: body.model, answers: ANSWERS, usage: RAW_USAGE } }
  }

  async function startDecideBridge({ env = { OPENROUTER_API_KEY: KEY }, decideUrl, decideTimeoutMs } = {}) {
    const fakePaperclip = await startFakePaperclip('comp-1')
    cleanups.push(() => fakePaperclip.close())
    const bridge = createBridge({
      paperclipUrl: fakePaperclip.url,
      companyId: 'comp-1',
      projectRoot: '',
      port: 0,
      env,
      decideUrl,
      decideTimeoutMs,
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    return { url }
  }

  async function startFakeDecisionBridge(options = {}) {
    const fake = await startFakeDecisions(options.answer ?? goodAnswer)
    cleanups.push(() => fake.close())
    const { url } = await startDecideBridge({ ...options, decideUrl: fake.url })
    return { fake, url }
  }

  function startStalledDecisions() {
    const sockets = new Set()
    const requests = []
    const server = createServer((req) => {
      requests.push(req.url)
      req.resume()
    })
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    return new Promise((resolveReady) => {
      server.listen(0, '127.0.0.1', () => {
        resolveReady({
          url: `http://127.0.0.1:${server.address().port}/decide`,
          requests,
          close: () =>
            new Promise((resolveClose) => {
              for (const socket of sockets) socket.destroy()
              server.close(() => resolveClose())
            }),
        })
      })
    })
  }

  it('answers a good call with its model, answers, usage, milliseconds and attempts', async () => {
    const { fake, url } = await startFakeDecisionBridge()
    const res = await postJson(url, '/api/decide', 'POST', { state: 'Task x', questions: QUESTIONS })
    expect(res.status).toBe(200)
    const answer = await res.json()
    expect(answer).toMatchObject({
      ok: true,
      model: 'typesafe/jev-1.14',
      answers: ANSWERS,
      usage: USAGE,
      attempts: 1,
    })
    expect(typeof answer.ms).toBe('number')
    expect(fake.seen).toHaveLength(1)
    expect(fake.seen[0].authorization).toBe(`Bearer ${KEY}`)
    expect(fake.seen[0].body).toEqual({ model: 'typesafe/jev-1.14', state: 'Task x', questions: QUESTIONS })
  })

  it('takes the model from the body, then DECISION_MODEL, then the default', async () => {
    const fake = await startFakeDecisions(goodAnswer)
    cleanups.push(() => fake.close())
    const fromEnv = await startDecideBridge({
      env: { OPENROUTER_API_KEY: KEY, DECISION_MODEL: 'env/model' },
      decideUrl: fake.url,
    })
    const plain = await startDecideBridge({ decideUrl: fake.url })

    const body = await postJson(fromEnv.url, '/api/decide', 'POST', {
      state: 'Task x',
      questions: QUESTIONS,
      model: 'body/model',
    }).then((res) => res.json())
    expect(body.model).toBe('body/model')

    const fromEnvironment = await postJson(fromEnv.url, '/api/decide', 'POST', {
      state: 'Task x',
      questions: QUESTIONS,
    }).then((res) => res.json())
    expect(fromEnvironment.model).toBe('env/model')

    const fallback = await postJson(plain.url, '/api/decide', 'POST', {
      state: 'Task x',
      questions: QUESTIONS,
    }).then((res) => res.json())
    expect(fallback.model).toBe('typesafe/jev-1.14')

    expect(fake.seen.map((request) => request.body.model)).toEqual(['body/model', 'env/model', 'typesafe/jev-1.14'])
  })

  it('answers 404 when no key is set and calls nothing', async () => {
    const { fake, url } = await startFakeDecisionBridge({ env: {} })
    const res = await postJson(url, '/api/decide', 'POST', { state: 'Task x', questions: QUESTIONS })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No key is set for the decision model.' })
    expect(fake.seen).toHaveLength(0)
  })

  it('answers 413 for a body over 32 KB', async () => {
    const { fake, url } = await startFakeDecisionBridge()
    const res = await postJson(url, '/api/decide', 'POST', { state: 'x'.repeat(33 * 1024), questions: QUESTIONS })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'That request is too large.' })
    expect(fake.seen).toHaveLength(0)
  })

  it('answers 400 without a state or a question', async () => {
    const { fake, url } = await startFakeDecisionBridge()

    const noState = await postJson(url, '/api/decide', 'POST', { questions: QUESTIONS })
    expect(noState.status).toBe(400)
    expect(await noState.json()).toEqual({ error: 'Send a state as text or an object.' })

    const badState = await postJson(url, '/api/decide', 'POST', { state: 42, questions: QUESTIONS })
    expect(badState.status).toBe(400)
    expect(await badState.json()).toEqual({ error: 'Send a state as text or an object.' })

    const noQuestions = await postJson(url, '/api/decide', 'POST', { state: 'Task x', questions: {} })
    expect(noQuestions.status).toBe(400)
    expect(await noQuestions.json()).toEqual({ error: 'Send at least one question.' })

    const listQuestions = await postJson(url, '/api/decide', 'POST', { state: 'Task x', questions: [] })
    expect(listQuestions.status).toBe(400)
    expect(await listQuestions.json()).toEqual({ error: 'Send at least one question.' })
    expect(fake.seen).toHaveLength(0)
  })

  it('answers 400 for a model or a question name that could not be a name, before the model is called', async () => {
    const { fake, url } = await startFakeDecisionBridge()
    for (const model of ['jev\ndecide fake ok 1ms', ' ', '-m', 'x'.repeat(121)]) {
      const res = await postJson(url, '/api/decide', 'POST', { state: 'Task x', questions: QUESTIONS, model })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'The model must be a name.' })
    }
    const sentence = { error: 'Each question needs a short name and a type of noul, choice or score.' }
    for (const questions of [
      { 'tier\ndecide fake ok 1ms': QUESTIONS.tier },
      { tier: { ...QUESTIONS.tier, type: 'constructor' } },
      { tier: null },
    ]) {
      const res = await postJson(url, '/api/decide', 'POST', { state: 'Task x', questions })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual(sentence)
    }
    expect(fake.seen).toHaveLength(0)
  })

  it('answers 429 when the model is rate limited after its retry', async () => {
    const { fake, url } = await startFakeDecisionBridge({
      answer: () => ({ status: 429, body: { error: { message: 'slow down' } } }),
    })
    const res = await postJson(url, '/api/decide', 'POST', { state: 'Task x', questions: QUESTIONS })
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'Too many requests. Try again in a moment.' })
    expect(fake.seen).toHaveLength(2)
  })

  it('answers 502 after the retry on a server error', async () => {
    const { fake, url } = await startFakeDecisionBridge({
      answer: () => ({ status: 500, body: { error: { message: 'boom' } } }),
    })
    const res = await postJson(url, '/api/decide', 'POST', { state: 'Task x', questions: QUESTIONS })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'The service failed: boom' })
    expect(fake.seen).toHaveLength(2)
  })

  it('answers 502 when the model does not answer in time', async () => {
    const stalled = await startStalledDecisions()
    cleanups.push(() => stalled.close())
    const { url } = await startDecideBridge({ decideUrl: stalled.url, decideTimeoutMs: 50 })
    const res = await postJson(url, '/api/decide', 'POST', { state: 'Task x', questions: QUESTIONS })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'The decision model did not answer in time.' })
    expect(stalled.requests).toHaveLength(2)
  })

  it('never puts the key, the state or the answers in an answer or a log line', async () => {
    const logs = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => {
      logs.push(String(line))
    })
    cleanups.push(() => spy.mockRestore())
    const { url } = await startFakeDecisionBridge({
      answer: (body, count) =>
        count === 1 ? goodAnswer(body) : { status: 500, body: { error: { message: `failed for Bearer ${KEY} and ${KEY}` } } },
    })
    const state = 'SECRET STATE TEXT'

    const first = await postJson(url, '/api/decide', 'POST', { state, questions: QUESTIONS })
    const firstText = await first.text()
    const second = await postJson(url, '/api/decide', 'POST', { state, questions: QUESTIONS })
    const secondText = await second.text()

    expect(firstText).not.toContain(KEY)
    expect(secondText).not.toContain(KEY)
    expect(secondText).toContain('[key]')
    expect(logs).toHaveLength(2)
    for (const line of logs) {
      expect(line).not.toContain(KEY)
      expect(line).not.toContain(state)
      expect(line).not.toContain('small')
    }
    expect(logs[0]).toContain('typesafe/jev-1.14')
    expect(logs[0]).toContain('tier')
    expect(logs[0]).toContain('ok')
    expect(logs[1]).toContain('server')
  })

  it('calls the decide route through the control client', async () => {
    const { url } = await startFakeDecisionBridge()
    const client = createClient({ baseUrl: url })
    const answer = await client.decide({ state: 'Task x', questions: QUESTIONS })
    expect(answer).toMatchObject({
      ok: true,
      model: 'typesafe/jev-1.14',
      answers: ANSWERS,
      usage: USAGE,
      attempts: 1,
    })
  })
})
