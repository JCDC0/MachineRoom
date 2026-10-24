import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { basename, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FOLDER_SHAPE, createBridge, isAllowedHost, packTree } from '../server/index.js'
import { getJson, postJson, readFrames, startLaneBridge, waitFor, waitForBridge } from './helpers/bridge.js'
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

function tempDir(prefix = 'mr-bridge-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function toolLine(path, { at = Date.now(), id = 'call-1', output = '' } = {}) {
  return JSON.stringify({
    type: 'tool_use',
    timestamp: at,
    part: { type: 'tool', id, tool: 'read', state: { status: 'completed', input: { path }, output } },
  })
}

function runRecord(lane, log, exitCode = 0) {
  return {
    lane,
    briefs: ['Y1'],
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

function writeRun(runsDir, name, lines, { exitCode = 0 } = {}) {
  const log = join(runsDir, `${name}.log`)
  writeFileSync(log, lines.map((line) => `${line}\n`).join(''))
  writeFileSync(join(runsDir, 'runs.jsonl'), `${JSON.stringify(runRecord('opencode', log, exitCode))}\n`)
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

function readRaw(url, headers = {}) {
  return new Promise((resolveRead, rejectRead) => {
    const req = httpRequest(url, { headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolveRead({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', rejectRead)
    req.end()
  })
}

function getWithHost(url, path, host) {
  return new Promise((resolveReq, rejectReq) => {
    const headers = host === undefined ? {} : { Host: host }
    const req = httpRequest(`${url}${path}`, { headers, setHost: false }, (res) => {
      res.resume()
      resolveReq(res.statusCode)
    })
    req.on('error', rejectReq)
    req.end()
  })
}

describe('local pages only', () => {
  it('allows the bridge port, Vite and the named origins, and skips a bad list entry', async () => {
    const logs = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line) => {
      logs.push(String(line))
    })
    cleanups.push(() => spy.mockRestore())
    const { url, bridge } = await laneBridge({ bridge: { env: { MACHINEROOM_ORIGINS: 'http://localhost:4000, https://example.com,http://127.0.0.1:4000/diff' } } })
    const port = new URL(url).port

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
    expect(bridge.server.listening).toBe(true)
  })

  it('allows localhost, 127.0.0.1 and [::1] Host headers and rejects foreign hosts', async () => {
    const { url } = await laneBridge()
    for (const host of ['localhost', 'localhost:5174', '127.0.0.1', '127.0.0.1:5174', '[::1]', '[::1]:5174']) {
      expect(isAllowedHost(host), host).toBe(true)
      expect(await getWithHost(url, '/api/health', host), host).toBe(200)
    }
    expect(isAllowedHost('')).toBe(false)
    expect(isAllowedHost(undefined)).toBe(false)
    for (const host of ['evil.example', 'evil.example:5174', 'localhost.evil.com', '127.0.0.1.evil.com:5174', '[::2]:5174']) {
      expect(isAllowedHost(host), host).toBe(false)
      for (const path of ['/api/health', '/api/tree', '/api/control/models', '/events']) {
        expect(await getWithHost(url, path, host), `${host} ${path}`).toBe(403)
      }
    }
  })
})

describe('health and agents', () => {
  it('answers the lane and session fields only, and no backup route', async () => {
    const { url } = await laneBridge()
    await waitForBridge(url)
    const health = await getJson(`${url}/api/health`)
    expect(health.status).toBe(200)
    expect(health.body.ok).toBe(true)
    expect(health.body.lanes).toBe(true)
    expect(health.body.sessions).toBe(false)
    expect(health.body.unparsed).toMatchObject({ total: 0 })
    expect(health.body.masked).toMatchObject({ total: 0 })
    expect(Object.keys(health.body).sort()).toEqual(['lanes', 'masked', 'ok', 'sessions', 'unparsed'])
    expect(health.body).not.toHaveProperty('paperclip')
    expect(health.body).not.toHaveProperty('paperclipVersion')
    expect(health.body).not.toHaveProperty('surface')
    expect(health.body).not.toHaveProperty('features')

    for (const method of ['GET', 'POST']) {
      const answer = await fetch(`${url}/api/backup`, { method })
      expect(answer.status, method).toBe(404)
      expect(await answer.json()).toEqual({ error: 'not found' })
    }
  })

  it('lists the lane agents only, in lane file order', async () => {
    const { url } = await laneBridge()
    const answer = await getJson(`${url}/api/agents`, { headers: { Origin: 'http://localhost:5173' } })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual([
      { id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', parser: 'claude', role: null },
      { id: 'agent-hermes', key: 'hermes', name: 'Hermes', adapterType: 'hermes_local', parser: 'hermes', role: null },
      { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', parser: 'opencode', role: null },
    ])
  })

  it('answers an empty agent list when no lane has a cli block', async () => {
    const { url } = await laneBridge({ lanes: { opencode: { name: 'OpenCode', worktree: 'C:\\work\\opencode' } } })
    const answer = await getJson(`${url}/api/agents`)
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual([])
  })

  it('maps lane agents to viewer keys and parsers', async () => {
    const { url } = await laneBridge({
      lanes: {
        agy: { name: 'agy', cli: { harness: 'agy' } },
        claude: { name: 'Claude Code', cli: { harness: 'claude' } },
        hermes: { name: 'Hermes', cli: { harness: 'hermes' } },
        opencode: { name: 'OpenCode Go', cli: { harness: 'opencode' } },
      },
    })
    const answer = await getJson(`${url}/api/agents`)

    expect(answer.body).toEqual([
      { id: 'agent-agy', key: 'agy', name: 'agy', adapterType: 'process', parser: 'agy', role: null },
      { id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', parser: 'claude', role: null },
      { id: 'agent-hermes', key: 'hermes', name: 'Hermes', adapterType: 'hermes_local', parser: 'hermes', role: null },
      { id: 'agent-opencode', key: 'opencode', name: 'OpenCode Go', adapterType: 'opencode_local', parser: 'opencode', role: null },
    ])
  })

  it('keeps two claude_local agents apart in list order and carries each role', async () => {
    const { url } = await laneBridge({
      lanes: {
        'twin-a': { name: 'Twin', cli: { harness: 'claude' } },
        'twin-b': { name: 'Twin', cli: { harness: 'claude' } },
      },
    })
    const answer = await getJson(`${url}/api/agents`)

    expect(answer.body).toEqual([
      { id: 'agent-twin-a', key: 'twin-a', name: 'Twin', adapterType: 'claude_local', parser: 'claude', role: null },
      { id: 'agent-twin-b', key: 'twin-b', name: 'Twin', adapterType: 'claude_local', parser: 'claude', role: null },
    ])
  })
})

describe('the file tree', () => {
  it('returns the file tree for both git repositories and plain folders', async () => {
    const gitDir = tempDir()
    execFileSync('git', ['init'], { cwd: gitDir, stdio: 'ignore' })
    mkdirSync(join(gitDir, 'src'), { recursive: true })
    mkdirSync(join(gitDir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(gitDir, '.gitignore'), 'node_modules/\n')
    writeFileSync(join(gitDir, 'src', 'index.js'), 'export default 1\n')
    writeFileSync(join(gitDir, 'README.md'), 'hello\n')
    writeFileSync(join(gitDir, 'node_modules', 'pkg', 'index.js'), 'ignored\n')

    const gitBridge = await laneBridge({ projectRoot: gitDir })
    const gitTree = await getJson(`${gitBridge.url}/api/tree`)
    expect(gitTree.body.files).toEqual(['.gitignore', 'README.md', 'src/index.js'])
    expect(gitTree.body.created).toEqual([])

    const plainDir = tempDir()
    mkdirSync(join(plainDir, 'src'), { recursive: true })
    mkdirSync(join(plainDir, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(plainDir, 'dist'), { recursive: true })
    writeFileSync(join(plainDir, 'src', 'app.js'), '1\n')
    writeFileSync(join(plainDir, 'node_modules', 'pkg', 'x.js'), '2\n')
    writeFileSync(join(plainDir, 'dist', 'bundle.js'), '3\n')

    const plainBridge = await laneBridge({ projectRoot: plainDir })
    const plainTree = await getJson(`${plainBridge.url}/api/tree`)
    expect(plainTree.body.files).toEqual(['src/app.js'])
    expect(plainTree.body.created).toEqual([])
  })

  it('answers GET /api/tree gzipped when the request names gzip', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.js'), '1\n')
    const { url } = await laneBridge({ projectRoot: dir })
    const accept = { Accept: `application/json; shape=${FOLDER_SHAPE}` }
    const gzipped = await readRaw(`${url}/api/tree`, { ...accept, 'Accept-Encoding': 'br, gzip' })
    expect(gzipped.status).toBe(200)
    expect(gzipped.headers['content-encoding']).toBe('gzip')
    expect(gzipped.headers.vary).toBe('Origin, Accept-Encoding')
    expect(JSON.parse(gunzipSync(gzipped.body).toString('utf8')).shape).toBe(FOLDER_SHAPE)

    const plain = await readRaw(`${url}/api/tree`, accept)
    expect(plain.status).toBe(200)
    expect(plain.headers['content-encoding']).toBeUndefined()
    expect(plain.headers.vary).toBe('Origin')
    expect(JSON.parse(gunzipSync(gzipped.body).toString('utf8'))).toEqual(JSON.parse(plain.body.toString('utf8')))
  })

  it('raises the tree version after a file appears', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.js'), '1\n')
    const { url } = await laneBridge({ projectRoot: dir, bridge: { debounceMs: 50 } })
    const accept = { Accept: `application/json; shape=${FOLDER_SHAPE}` }
    const before = await getJson(`${url}/api/tree`, { headers: accept })
    expect(Number.isInteger(before.body.version)).toBe(true)

    writeFileSync(join(dir, 'b.js'), '2\n')
    let after = before.body
    await waitFor(async () => {
      after = (await getJson(`${url}/api/tree`, { headers: accept })).body
      return after.version > before.body.version
    }, { what: 'the tree version to rise' })
    expect(after.version).toBeGreaterThan(before.body.version)
    expect(after.files.some((run) => run.includes('b.js'))).toBe(true)
  })

  it('sends only the files added since the version a page read', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.js'), '1\n')
    const { url } = await laneBridge({ projectRoot: dir, bridge: { debounceMs: 50 } })
    const read = await getJson(`${url}/api/tree`, { headers: { Accept: `application/json; shape=${FOLDER_SHAPE}` } })
    const sse = await openSse(url, {}, `?tree=${FOLDER_SHAPE}&since=${read.body.version}`)
    cleanups.push(() => sse.close())
    await waitFor(async () => (await getJson(`${url}/api/tree`)).status === 200)

    writeFileSync(join(dir, 'b.js'), '2\n')
    const event = await sse.next((e) => e.event === 'tree')
    expect(JSON.parse(event.data)).toEqual({ root: basename(dir), files: ['b.js'] })
  })

  it('sends the whole list to a stream whose since is unknown', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.js'), '1\n')
    const { url } = await laneBridge({ projectRoot: dir, bridge: { debounceMs: 50 } })
    await getJson(`${url}/api/tree`, { headers: { Accept: `application/json; shape=${FOLDER_SHAPE}` } })
    const sse = await openSse(url, {}, `?tree=${FOLDER_SHAPE}&since=999999`)
    cleanups.push(() => sse.close())

    writeFileSync(join(dir, 'b.js'), '2\n')
    const event = await sse.next((e) => e.event === 'tree')
    expect(JSON.parse(event.data)).toEqual(packTree({ root: basename(dir), files: ['a.js', 'b.js'] }))
  })

  it('emits a tree SSE event only to a stream that asks for one', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.js'), '1\n')
    const { url } = await laneBridge({ projectRoot: dir, bridge: { debounceMs: 50 } })
    const withTree = await openSse(url, {}, '?tree=1')
    cleanups.push(() => withTree.close())
    const withoutTree = await openSse(url)
    cleanups.push(() => withoutTree.close())
    await waitFor(async () => (await getJson(`${url}/api/tree`)).status === 200)

    writeFileSync(join(dir, 'b.js'), '2\n')
    const event = await withTree.next((e) => e.event === 'tree')
    expect(JSON.parse(event.data).files).toEqual(['a.js', 'b.js'])
    await expect(withoutTree.next((e) => e.event === 'tree', 300)).rejects.toThrow('timed out waiting for SSE event')
  })
})

describe('frames from a lane log', () => {
  it('streams queued, running, each read line and the end', async () => {
    const runs = tempDir()
    const name = 'opencode-Y1-20261024-120000'
    writeRun(runs, name, [
      toolLine('docs/a.md', { id: 'call-1' }),
      toolLine('src/b.js', { id: 'call-2' }),
    ])
    const { url } = await laneBridge({ runsDir: runs })
    const frames = await readFrames(url, (seen) => seen.some((frame) => frame.type === 'heartbeat.run.status' && frame.payload?.status === 'succeeded'))

    expect(frames.map((frame) => frame.type)).toEqual([
      'heartbeat.run.queued',
      'heartbeat.run.status',
      'heartbeat.run.log',
      'heartbeat.run.log',
      'heartbeat.run.status',
    ])
    expect(frames[1].payload.status).toBe('running')
    expect(frames[3].payload.chunk).toContain('src/b.js')
    expect(frames[4].payload.status).toBe('succeeded')
  })

  it('keeps the history for a late join and resumes after Last-Event-ID', async () => {
    const runs = tempDir()
    const name = 'opencode-Y1-20261024-121000'
    writeRun(runs, name, [toolLine('docs/a.md', { id: 'call-1' })])
    const { url } = await laneBridge({ runsDir: runs })

    const stream = await openSse(url, {}, '?history=1')
    cleanups.push(() => stream.close())
    const history = []
    for (;;) {
      const event = await stream.next((item) => item.event === 'frame')
      history.push(event)
      if (JSON.parse(event.data).payload?.status === 'succeeded') break
    }
    expect(history.length).toBeGreaterThan(3)

    const again = await openSse(url, { 'Last-Event-ID': history[0].id }, '?history=1')
    cleanups.push(() => again.close())
    const next = await again.next((item) => item.event === 'frame')
    expect(next.id).toBe(history[1].id)
    expect(JSON.parse(next.data)).toEqual(JSON.parse(history[1].data))
  })

  it('sends no history to a client that does not ask', async () => {
    const runs = tempDir()
    const name = 'opencode-Y1-20261024-122000'
    writeRun(runs, name, [toolLine('docs/a.md', { id: 'call-1' })])
    const { url } = await laneBridge({ runsDir: runs })
    await waitFor(async () => {
      const seen = await readFrames(url, (frames) => frames.some((frame) => frame.payload?.status === 'succeeded'))
      return seen.length > 0
    }, { what: 'the run to reach the history' })

    const late = await openSse(url)
    cleanups.push(() => late.close())
    await expect(late.next((e) => e.event === 'frame', 300)).rejects.toThrow('timed out waiting for SSE event')
  })

  it('masks a key before it reaches the stream and the history', async () => {
    const runs = tempDir()
    const name = 'opencode-Y1-20261024-123000'
    writeRun(runs, name, [toolLine('docs/a.md', { id: 'call-1', output: `read with ${KEY}` })])
    const { url } = await laneBridge({ runsDir: runs })
    const frames = await readFrames(url, (seen) => seen.some((frame) => frame.type === 'heartbeat.run.log'))
    const log = frames.find((frame) => frame.type === 'heartbeat.run.log')
    expect(log.payload.chunk).toContain('[key]')
    expect(log.payload.chunk).not.toContain(KEY)

    const health = await waitForBridge(url)
    expect(health.masked.total).toBeGreaterThan(0)
    const kept = await readFrames(url, (seen) => seen.some((frame) => frame.type === 'heartbeat.run.log'))
    expect(kept.find((frame) => frame.type === 'heartbeat.run.log').payload.chunk).not.toContain(KEY)
  })

  it('sends a change notice for a lane run status', async () => {
    const loop = await laneBridge()
    const sse = await openSse(loop.url)
    cleanups.push(() => sse.close())
    loop.writeLog('opencode-Y1-20261024-124000', `${toolLine('docs/a.md', { id: 'call-1' })}\n`)
    const notice = await sse.next((e) => e.event === 'change')
    expect(JSON.parse(notice.data)).toEqual({ topic: 'agents' })
  })
})

describe('the assistant route', () => {
  it('runs the configured runner and returns its text', async () => {
    const { url } = await laneBridge({
      bridge: {
        assistantRunner: async ({ prompt }) => `You asked: ${prompt}`,
        assistantModel: 'opencode/deepseek-v4.1-flash-free',
      },
    })
    const answer = await postJson(`${url}/api/assistant`, { prompt: 'Where is the room?' })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ text: 'You asked: Where is the room?' })
  })
})

describe('the bridge without a Paperclip', () => {
  it('starts with no lane and no session source and answers health', async () => {
    const dir = tempDir()
    const bridge = createBridge({ port: 0, projectRoot: dir, env: {} })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    const health = await getJson(`${url}/api/health`)
    expect(health.body).toMatchObject({ ok: true, lanes: false, sessions: false })
    expect((await getJson(`${url}/api/agents`)).body).toEqual([])
  })
})
