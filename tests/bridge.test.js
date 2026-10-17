import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { createBridge } from '../server/index.js'

function startFakePaperclip(companyId = 'comp-1', agents = []) {
  const sockets = new Set()
  let connections = 0

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === `/api/companies/${companyId}/agents`) {
      const payload = JSON.stringify(agents)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(payload)
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
