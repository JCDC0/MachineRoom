import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { basename, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FOLDER_SHAPE, createBridge, isAllowedHost, packTree, trimHistory } from '../server/index.js'
import { DEFAULT_ASSISTANT_MODEL } from '../server/assistant.js'
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

  it('refuses the Vite origin when the bridge serves the built viewer', async () => {
    const { url } = await laneBridge({ bridge: { staticDir: tempDir() } })
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      const res = await fetch(`${url}/api/health`, { headers: { Origin: origin } })
      expect(res.status, origin).toBe(403)
    }
    const port = new URL(url).port
    const own = await fetch(`${url}/api/health`, { headers: { Origin: `http://localhost:${port}` } })
    expect(own.status).toBe(200)
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
    expect(health.body.orchestrator).toBe(true)
    expect(health.body.problems).toEqual([])
    expect(Object.keys(health.body).sort()).toEqual(['lanes', 'masked', 'ok', 'orchestrator', 'problems', 'sessions', 'unparsed'])
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

  it('names a missing project folder as a problem and fails the health answer', async () => {
    const missing = join(tempDir('mr-health-'), 'gone')
    const { url } = await startLaneBridge({ projectRoot: missing })
    const health = await getJson(`${url}/api/health`)

    expect(health.status).toBe(200)
    expect(health.body.ok).toBe(false)
    expect(health.body.problems).toContainEqual(expect.stringContaining('does not exist or is not a folder'))
  })

  it('names a missing built viewer as a problem and says how to build it', async () => {
    const { url } = await startLaneBridge({ bridge: { staticDir: tempDir('mr-health-dist-') } })
    const health = await getJson(`${url}/api/health`)

    expect(health.body.ok).toBe(false)
    expect(health.body.problems).toContainEqual(expect.stringContaining('index.html'))
    expect(health.body.problems).toContainEqual(expect.stringContaining('Run npm run build.'))
  })

  it('names the last tree read error as a problem', async () => {
    const { url } = await startLaneBridge({
      bridge: {
        readTree: async () => {
          throw new Error('The folder is locked.')
        },
      },
    })
    const health = await getJson(`${url}/api/health`)

    expect(health.body.ok).toBe(true)
    expect(health.body.problems).toContain('The last tree read failed: The folder is locked.')
  })

  it('names a stopped session source as a problem', async () => {
    const reader = {
      agent: { id: 'agent-test', key: 'test', name: 'OpenCode session', parser: 'opencode' },
      tick: () => {},
      problem: () => 'no such table: session_v2',
    }
    const { url } = await startLaneBridge({ bridge: { sessionsSource: { readers: [reader], pollMs: 20 } } })
    const health = await getJson(`${url}/api/health`)

    expect(health.body.ok).toBe(true)
    expect(health.body.sessions).toBe(true)
    expect(health.body.problems).toContain('The OpenCode session source stopped: no such table: session_v2')
  })

  it('lists the lane agents only, in lane file order', async () => {
    const { url } = await laneBridge()
    const answer = await getJson(`${url}/api/agents`, { headers: { Origin: 'http://localhost:5173' } })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual([
      { id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', parser: 'claude', role: null, harness: 'claude', model: 'sonnet' },
      { id: 'agent-hermes', key: 'hermes', name: 'Hermes', adapterType: 'hermes_local', parser: 'hermes', role: null, harness: 'hermes', model: 'deepseek/deepseek-v4.1-flash-1017' },
      { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', parser: 'opencode', role: null, harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
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
        agy: { name: 'agy', cli: { harness: 'agy', model: 'gemini-3.8-flash-high' } },
        claude: { name: 'Claude Code', cli: { harness: 'claude', model: 'sonnet' } },
        hermes: { name: 'Hermes', cli: { harness: 'hermes', model: 'deepseek/deepseek-v4.1-flash-1017' } },
        opencode: { name: 'OpenCode Go', cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
      },
    })
    const answer = await getJson(`${url}/api/agents`)

    expect(answer.body).toEqual([
      { id: 'agent-agy', key: 'agy', name: 'agy', adapterType: 'process', parser: 'agy', role: null, harness: 'agy', model: 'gemini-3.8-flash-high' },
      { id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', parser: 'claude', role: null, harness: 'claude', model: 'sonnet' },
      { id: 'agent-hermes', key: 'hermes', name: 'Hermes', adapterType: 'hermes_local', parser: 'hermes', role: null, harness: 'hermes', model: 'deepseek/deepseek-v4.1-flash-1017' },
      { id: 'agent-opencode', key: 'opencode', name: 'OpenCode Go', adapterType: 'opencode_local', parser: 'opencode', role: null, harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
    ])
  })

  it('keeps two claude_local agents apart in list order and carries each role', async () => {
    const { url } = await laneBridge({
      lanes: {
        'twin-a': { name: 'Twin', cli: { harness: 'claude', model: 'sonnet' } },
        'twin-b': { name: 'Twin', cli: { harness: 'claude', model: 'sonnet' } },
      },
    })
    const answer = await getJson(`${url}/api/agents`)

    expect(answer.body).toEqual([
      { id: 'agent-twin-a', key: 'twin-a', name: 'Twin', adapterType: 'claude_local', parser: 'claude', role: null, harness: 'claude', model: 'sonnet' },
      { id: 'agent-twin-b', key: 'twin-b', name: 'Twin', adapterType: 'claude_local', parser: 'claude', role: null, harness: 'claude', model: 'sonnet' },
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

  it('sends a file added between the tree read and the stream connect', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.js'), '1\n')
    const { url } = await laneBridge({ projectRoot: dir, bridge: { debounceMs: 50 } })
    const accept = { Accept: `application/json; shape=${FOLDER_SHAPE}` }
    const read = await getJson(`${url}/api/tree`, { headers: accept })

    writeFileSync(join(dir, 'b.js'), '2\n')
    await waitFor(
      async () => (await getJson(`${url}/api/tree`, { headers: accept })).body.version > read.body.version,
      { what: 'the tree version to rise' }
    )

    const sse = await openSse(url, {}, `?history=1&tree=${FOLDER_SHAPE}&since=${read.body.version}`)
    cleanups.push(() => sse.close())
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

  it('sends no tree event to a page already at the current version', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.js'), '1\n')
    const { url } = await laneBridge({ projectRoot: dir, bridge: { debounceMs: 50 } })
    const read = await getJson(`${url}/api/tree`, { headers: { Accept: `application/json; shape=${FOLDER_SHAPE}` } })
    const sse = await openSse(url, {}, `?tree=1&since=${read.body.version}`)
    cleanups.push(() => sse.close())

    await expect(sse.next((e) => e.event === 'tree', 300)).rejects.toThrow('timed out waiting for SSE event')

    writeFileSync(join(dir, 'b.js'), '2\n')
    const event = await sse.next((e) => e.event === 'tree')
    expect(JSON.parse(event.data)).toEqual({ root: basename(dir), files: ['b.js'] })
  })

  it('sends a page two versions behind exactly the files added since', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.js'), '1\n')
    const { url } = await laneBridge({ projectRoot: dir, bridge: { debounceMs: 50 } })
    const accept = { Accept: `application/json; shape=${FOLDER_SHAPE}` }
    const first = await getJson(`${url}/api/tree`, { headers: accept })

    writeFileSync(join(dir, 'b.js'), '2\n')
    const second = await waitFor(
      async () => {
        const body = (await getJson(`${url}/api/tree`, { headers: accept })).body
        return body.version > first.body.version ? body : null
      },
      { what: 'the second tree version' }
    )
    writeFileSync(join(dir, 'c.js'), '3\n')
    await waitFor(
      async () => {
        const body = (await getJson(`${url}/api/tree`, { headers: accept })).body
        return body.version > second.version ? body : null
      },
      { what: 'the third tree version' }
    )

    const sse = await openSse(url, {}, `?tree=${FOLDER_SHAPE}&since=${first.body.version}`)
    cleanups.push(() => sse.close())
    const event = await sse.next((e) => e.event === 'tree')
    expect(JSON.parse(event.data)).toEqual({ root: basename(dir), files: ['b.js', 'c.js'] })
  })

  it('sends the whole list to a page whose version is no longer kept', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.js'), '1\n')
    const { url } = await laneBridge({ projectRoot: dir, bridge: { debounceMs: 50 } })
    const accept = { Accept: `application/json; shape=${FOLDER_SHAPE}` }
    const first = await getJson(`${url}/api/tree`, { headers: accept })
    let version = first.body.version
    const added = []
    for (let index = 0; index < 5; index += 1) {
      const name = `change-${index}.js`
      added.push(name)
      writeFileSync(join(dir, name), 'x\n')
      const next = await waitFor(
        async () => {
          const body = (await getJson(`${url}/api/tree`, { headers: accept })).body
          return body.version > version ? body : null
        },
        { what: `tree version ${index + 2}` }
      )
      version = next.version
    }

    const sse = await openSse(url, {}, `?tree=1&since=${first.body.version}`)
    cleanups.push(() => sse.close())
    writeFileSync(join(dir, 'later.js'), 'x\n')
    const event = await sse.next((e) => e.event === 'tree')
    expect(JSON.parse(event.data).files).toEqual(['a.js', ...added, 'later.js'].sort())
  })

  it('emits a tree SSE event only to a stream that asks for one', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.js'), '1\n')
    const { url } = await laneBridge({ projectRoot: dir, bridge: { debounceMs: 50 } })
    await getJson(`${url}/api/tree`)
    const withTree = await openSse(url, {}, '?tree=1')
    cleanups.push(() => withTree.close())
    const withoutTree = await openSse(url)
    cleanups.push(() => withoutTree.close())

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

    const after = await openSse(url, {}, `?history=1&after=${history[0].id}`)
    cleanups.push(() => after.close())
    const resumed = await after.next((item) => item.event === 'frame')
    expect(resumed.id).toBe(history[1].id)
    expect(JSON.parse(resumed.data)).toEqual(JSON.parse(history[1].data))
  })

  it('bounds the kept history even when every frame is a run start', () => {
    const history = Array.from({ length: 600 }, (_, index) => ({ id: String(index), pinned: true }))
    trimHistory(history)
    expect(history).toHaveLength(500)
    expect(history[0].id).toBe('100')
    expect(history.at(-1).id).toBe('599')
  })

  it('drops an unpinned frame before an open run start', () => {
    const history = [
      { id: 'start', pinned: true },
      { id: 'log', pinned: false },
    ]
    for (let index = 0; index < 500; index += 1) history.push({ id: `n${index}`, pinned: false })
    trimHistory(history)
    expect(history).toHaveLength(500)
    expect(history[0].id).toBe('start')
    expect(history.some((entry) => entry.id === 'log')).toBe(false)
  })

  it('unpins a run in history after 2 hours without a frame and trims it (S37)', () => {
    const twoHoursMs = 2 * 60 * 60 * 1000
    const start = 1000000
    const history = [
      { id: 'start', runId: 'run-1', pinned: true, at: start },
    ]
    for (let index = 0; index < 500; index += 1) {
      history.push({ id: `n${index}`, pinned: false, at: start + twoHoursMs + 10 })
    }
    trimHistory(history, start + twoHoursMs + 10)
    expect(history).toHaveLength(500)
    expect(history.some((entry) => entry.id === 'start')).toBe(false)

    const activeHistory = [
      { id: 'start', runId: 'run-2', pinned: true, at: start },
      { id: 'recent-log', runId: 'run-2', pinned: false, at: start + twoHoursMs },
    ]
    for (let index = 0; index < 500; index += 1) {
      activeHistory.push({ id: `n${index}`, pinned: false, at: start + twoHoursMs + 10 })
    }
    trimHistory(activeHistory, start + twoHoursMs + 10)
    expect(activeHistory).toHaveLength(500)
    expect(activeHistory.some((entry) => entry.id === 'start')).toBe(true)
  })

  it('clears expired pins in one pass over mixed pinned, expired and fresh runs (S39)', () => {
    const twoHoursMs = 2 * 60 * 60 * 1000
    const start = 1000000
    const now = start + twoHoursMs + 5000
    const history = [
      { id: 'exp1-start', runId: 'run-exp-1', pinned: true, at: start },
      { id: 'exp1-log', runId: 'run-exp-1', pinned: false, at: start + 100 },
      { id: 'exp2-start', runId: 'run-exp-2', pinned: true, at: start + 200 },
      { id: 'fresh1-start', runId: 'run-fresh-1', pinned: true, at: start },
      { id: 'fresh1-recent', runId: 'run-fresh-1', pinned: false, at: now - 1000 },
      { id: 'fresh2-start', runId: 'run-fresh-2', pinned: true, at: now - 2000 },
      { id: 'fresh2-pinned-log', runId: 'run-fresh-2', pinned: true, at: now - 500 },
      { id: 'orphan-pinned', pinned: true, at: start },
      { id: 'orphan-unpinned', pinned: false, at: start },
    ]
    for (let i = 0; i < 600; i += 1) {
      history.push({ id: `pad-${i}`, pinned: false, at: now })
    }

    trimHistory(history, now)

    expect(history).toHaveLength(500)
    const byId = new Map(history.map((entry) => [entry.id, entry]))
    expect(byId.has('exp1-start')).toBe(false)
    expect(byId.has('exp1-log')).toBe(false)
    expect(byId.has('exp2-start')).toBe(false)
    expect(byId.has('orphan-unpinned')).toBe(false)
    expect(byId.get('fresh1-start')?.pinned).toBe(true)
    expect(byId.get('fresh2-start')?.pinned).toBe(true)
    expect(byId.get('fresh2-pinned-log')?.pinned).toBe(true)
    expect(byId.get('orphan-pinned')?.pinned).toBe(true)
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

  it('sends a runs notice when a run starts from a lane log, so Reviews reloads', async () => {
    const loop = await laneBridge()
    const sse = await openSse(loop.url)
    cleanups.push(() => sse.close())
    loop.writeLog('opencode-Y1-20261024-124500', `${toolLine('docs/a.md', { id: 'call-1' })}\n`)
    const notice = await sse.next((e) => e.event === 'change' && JSON.parse(e.data).topic === 'runs')
    expect(JSON.parse(notice.data)).toEqual({ topic: 'runs' })
  })

  it('sends no endpoints or mcp notice that no panel hears', async () => {
    const loop = await laneBridge()
    const sse = await openSse(loop.url)
    cleanups.push(() => sse.close())
    const headers = { 'content-type': 'application/json', origin: loop.url }
    const endpoint = await getJson(`${loop.url}/api/endpoints`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Work',
        provider: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        keyName: 'openrouter',
        models: ['alpha'],
        confirmed: true,
      }),
    })
    expect(endpoint.status).toBe(200)
    const server = await getJson(`${loop.url}/api/mcp/servers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'files', transport: 'stdio', command: 'node', enabled: true, confirmed: true }),
    })
    expect(server.status).toBe(200)
    await expect(
      sse.next((e) => e.event === 'change' && ['endpoints', 'mcp'].includes(JSON.parse(e.data).topic), 300)
    ).rejects.toThrow('timed out waiting for SSE event')
  })
})

describe('the assistant route', () => {
  it('runs the configured runner and returns its text', async () => {
    const { url } = await laneBridge({
      bridge: {
        assistantRunner: async ({ prompt }) => `You asked: ${prompt}`,
        assistantModel: DEFAULT_ASSISTANT_MODEL,
      },
    })
    const answer = await getJson(`${url}/api/assistant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: new URL(url).origin },
      body: JSON.stringify({ prompt: 'Where is the room?', confirmed: true }),
    })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ text: 'You asked: Where is the room?' })
  })
})

describe('the bridge with no sources', () => {
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
