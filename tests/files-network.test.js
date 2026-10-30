import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import {
  FILE_MAX_BYTES,
  FILE_NOT_A_FILE_PROBLEM,
  FILE_NOT_FOUND_PROBLEM,
  FILE_ORIGIN_PROBLEM,
  FILE_OUTSIDE_PROBLEM,
  FILE_REFUSED_PROBLEM,
} from '../server/files.js'
import { createNetworkMonitor } from '../server/network.js'
import { createClient } from '../src/control/client.js'
import { createMockClient } from '../src/control/mock.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    try {
      await fn()
    } catch {}
  }
})

const PAGE_HEADERS = { origin: 'http://localhost:5173' }

function makeRoot(prefix = 'mr-files-') {
  const root = makeTempDir(prefix)
  cleanups.push(() => removeTempDir(root))
  return root
}

async function startBridge(options = {}) {
  const bridge = createBridge({
    port: 0,
    env: {},
    ...options,
  })
  const { url } = await bridge.start()
  cleanups.push(() => bridge.stop())
  const client = createClient({
    baseUrl: url,
    fetchImpl: (input, init) =>
      fetch(input, { ...init, headers: { origin: 'http://localhost:5173', ...(init?.headers ?? {}) } }),
  })
  return { bridge, url, client }
}

async function getJson(url, path, headers = PAGE_HEADERS) {
  const response = await fetch(`${url}${path}`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(10000),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

function filePath(path) {
  return `/api/file?path=${encodeURIComponent(path)}`
}

async function listenForChange(url, topic, onOpen = () => {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(`${url}/events`, { signal: controller.signal })
    onOpen()
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      let cut = buffer.indexOf('\n\n')
      while (cut !== -1) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        const lines = block.split(/\r?\n/)
        if (lines.includes('event: change')) {
          const dataLine = lines.find((line) => line.startsWith('data: '))
          if (dataLine) {
            const parsed = JSON.parse(dataLine.slice(6))
            if (!topic || parsed.topic === topic) return parsed
          }
        }
        cut = buffer.indexOf('\n\n')
      }
    }
    return null
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

describe('the file route trust boundary', () => {
  it('refuses a request with no page Origin and no same-origin fetch', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'README.md'), 'hello\n')
    const { url } = await startBridge({ projectRoot: root })

    const res = await getJson(url, filePath('README.md'), {})
    expect(res.status).toBe(403)
    expect(res.body.error).toBe(FILE_ORIGIN_PROBLEM)
    expect(res.body.error).not.toContain(root)
  })

  it('accepts a same-origin Sec-Fetch-Site header and reads a text file', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'README.md'), 'hello\n')
    const { url, client } = await startBridge({ projectRoot: root })

    const res = await getJson(url, filePath('README.md'), { 'sec-fetch-site': 'same-origin' })
    expect(res.status).toBe(200)
    expect(res.body.path).toBe('README.md')
    expect(res.body.size).toBe(6)
    expect(res.body.binary).toBe(false)
    expect(res.body.truncated).toBe(false)
    expect(res.body.text).toBe('hello\n')
    expect(Number.isNaN(Date.parse(res.body.modified))).toBe(false)

    const fromClient = await client.fileInfo({ path: 'README.md' })
    expect(fromClient).toEqual(res.body)
  })

  it('refuses .., an absolute path and a symbolic link that leads out with one sentence', async () => {
    const root = makeRoot()
    const outside = makeTempDir('mr-outside-')
    cleanups.push(() => removeTempDir(outside))
    writeFileSync(join(root, 'inside.txt'), 'inside\n')
    writeFileSync(join(outside, 'secret.txt'), 'secret\n')
    const { url } = await startBridge({ projectRoot: root })

    const dotdot = await getJson(url, filePath('../secret.txt'))
    expect(dotdot.status).toBe(400)
    expect(dotdot.body.error).toBe(FILE_OUTSIDE_PROBLEM)

    const absolute = await getJson(url, filePath(join(root, 'inside.txt')))
    expect(absolute.status).toBe(400)
    expect(absolute.body.error).toBe(FILE_OUTSIDE_PROBLEM)

    let linked = false
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'outside-link.txt'))
      linked = true
    } catch {}
    if (linked) {
      const link = await getJson(url, filePath('outside-link.txt'))
      expect(link.status).toBe(400)
      expect(link.body.error).toBe(FILE_OUTSIDE_PROBLEM)
    }

    for (const res of [dotdot, absolute]) {
      expect(res.body.error).not.toContain(root)
      expect(res.body.error.endsWith('.')).toBe(true)
    }
  })

  it('refuses .git, .worktrees, .env, .env.*, .pem and .key', async () => {
    const root = makeRoot()
    mkdirSync(join(root, '.git'), { recursive: true })
    writeFileSync(join(root, '.git', 'config'), '[core]\n')
    mkdirSync(join(root, '.worktrees', 'lane'), { recursive: true })
    writeFileSync(join(root, '.worktrees', 'lane', 'file.txt'), 'x\n')
    writeFileSync(join(root, '.env'), 'SECRET=1\n')
    writeFileSync(join(root, '.env.local'), 'SECRET=1\n')
    mkdirSync(join(root, 'keys'), { recursive: true })
    writeFileSync(join(root, 'keys', 'server.pem'), 'pem\n')
    writeFileSync(join(root, 'keys', 'server.key'), 'key\n')
    const { url } = await startBridge({ projectRoot: root })

    for (const path of [
      '.git/config',
      '.worktrees/lane/file.txt',
      '.env',
      '.env.local',
      'keys/server.pem',
      'keys/server.key',
    ]) {
      const res = await getJson(url, filePath(path))
      expect(res.status, path).toBe(400)
      expect(res.body.error, path).toBe(FILE_REFUSED_PROBLEM)
      expect(res.body.error).not.toContain(root)
    }
    const stream = await getJson(url, filePath('.env::$DATA'))
    expect(stream.status).toBe(400)
    expect(stream.body.error).toBe(FILE_OUTSIDE_PROBLEM)
  })

  it('answers 404 for a missing file and 400 for a folder', async () => {
    const root = makeRoot()
    mkdirSync(join(root, 'src'), { recursive: true })
    const { url } = await startBridge({ projectRoot: root })

    const missing = await getJson(url, filePath('src/missing.js'))
    expect(missing.status).toBe(404)
    expect(missing.body.error).toBe(FILE_NOT_FOUND_PROBLEM)

    const folder = await getJson(url, filePath('src'))
    expect(folder.status).toBe(400)
    expect(folder.body.error).toBe(FILE_NOT_A_FILE_PROBLEM)
  })
})

describe('the file route reading rules', () => {
  it('masks a key in the text it returns', async () => {
    const root = makeRoot()
    const secret = 'sk-' + 'or-v1-' + 'q'.repeat(40)
    writeFileSync(join(root, 'config.js'), `export const OPENROUTER_API_KEY = "${secret}"\n`)
    const { url } = await startBridge({ projectRoot: root })

    const res = await getJson(url, filePath('config.js'))
    expect(res.status).toBe(200)
    expect(res.body.text).toContain('[key]')
    expect(res.body.text).not.toContain(secret)
  })

  it('sets truncated and keeps at most 256 KB of a large file', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'big.txt'), 'a'.repeat(300 * 1024))
    const { url } = await startBridge({ projectRoot: root })

    const res = await getJson(url, filePath('big.txt'))
    expect(res.status).toBe(200)
    expect(res.body.size).toBe(300 * 1024)
    expect(res.body.truncated).toBe(true)
    expect(res.body.binary).toBe(false)
    expect(res.body.text.length).toBe(FILE_MAX_BYTES)
  })

  it('answers binary with no text for a zero byte in the first 8 KB', async () => {
    const root = makeRoot()
    writeFileSync(join(root, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]))
    writeFileSync(join(root, 'late-zero.bin'), Buffer.concat([Buffer.alloc(9000, 0x61), Buffer.from([0x00])]))
    const { url } = await startBridge({ projectRoot: root })

    const binary = await getJson(url, filePath('image.png'))
    expect(binary.status).toBe(200)
    expect(binary.body.binary).toBe(true)
    expect(binary.body.text).toBe('')

    const late = await getJson(url, filePath('late-zero.bin'))
    expect(late.status).toBe(200)
    expect(late.body.binary).toBe(false)
  })
})

describe('the network monitor', () => {
  it('opens at most one connection every 30 seconds however many pages ask', async () => {
    let clock = 1000
    let calls = 0
    const notices = []
    const monitor = createNetworkMonitor({
      connector: async () => {
        calls += 1
        return true
      },
      now: () => clock,
      onNotice: (event) => notices.push(event),
      setIntervalImpl: () => ({ unref() {} }),
      clearIntervalImpl: () => {},
    })

    const first = await monitor.ask()
    expect(first.online).toBe(true)
    expect(Date.parse(first.checkedAt)).toBe(1000)
    expect(calls).toBe(1)

    clock += 29000
    const second = await monitor.ask()
    expect(second).toEqual(first)
    expect(calls).toBe(1)

    clock += 1000
    const third = await monitor.ask()
    expect(third).toEqual({ online: true, checkedAt: new Date(31000).toISOString() })
    expect(calls).toBe(2)
    expect(notices).toEqual([])
  })

  it('sends one network notice when online changes and none when it repeats', async () => {
    let clock = 0
    let online = true
    const notices = []
    const monitor = createNetworkMonitor({
      connector: async () => online,
      now: () => clock,
      onNotice: (event) => notices.push(event),
      setIntervalImpl: () => ({ unref() {} }),
      clearIntervalImpl: () => {},
    })

    await monitor.ask()
    clock += 30000
    online = false
    const offline = await monitor.ask()
    expect(offline.online).toBe(false)
    expect(notices).toEqual([{ topic: 'network' }])

    clock += 30000
    await monitor.ask()
    expect(notices).toEqual([{ topic: 'network' }])
  })

  it('stops checking once no page has asked in the last 2 minutes', async () => {
    let clock = 0
    let calls = 0
    let tickFn = null
    let timer = null
    const monitor = createNetworkMonitor({
      connector: async () => {
        calls += 1
        return true
      },
      now: () => clock,
      intervalMs: 100,
      activeMs: 200,
      setIntervalImpl: (fn) => {
        tickFn = fn
        timer = { unref() {} }
        return timer
      },
      clearIntervalImpl: () => {
        tickFn = null
        timer = null
      },
    })

    await monitor.ask()
    expect(calls).toBe(1)
    expect(timer).not.toBeNull()

    clock = 250
    tickFn()
    expect(timer).toBeNull()
    expect(calls).toBe(1)

    clock = 300
    await monitor.ask()
    expect(calls).toBe(2)
  })

  it('answers the route from a fake connector, without a real connection', async () => {
    const root = makeRoot()
    let clock = 0
    let online = true
    let calls = 0
    const { client } = await startBridge({
      projectRoot: root,
      networkConnector: async () => {
        calls += 1
        return online
      },
      networkNow: () => clock,
    })

    const first = await client.network()
    expect(first.online).toBe(true)
    expect(Date.parse(first.checkedAt)).toBe(0)
    expect(calls).toBe(1)

    clock += 1000
    await client.network()
    expect(calls).toBe(1)

    clock += 29000
    online = false
    const second = await client.network()
    expect(second.online).toBe(false)
    expect(calls).toBe(2)
  })

  it('sends a network notice through the bridge when online changes', async () => {
    const root = makeRoot()
    let clock = 0
    let online = true
    const { url } = await startBridge({
      projectRoot: root,
      networkConnector: async () => online,
      networkNow: () => clock,
    })

    await getJson(url, '/api/network', {})
    const changePromise = listenForChange(url, 'network', async () => {
      clock = 30000
      online = false
      await getJson(url, '/api/network', {})
    })
    const change = await changePromise
    expect(change).toEqual({ topic: 'network' })
  })
})

describe('the client and the mock', () => {
  it('implements fileInfo and network on both', async () => {
    const mock = createMockClient({ latencyMs: 1 })
    const read = await mock.fileInfo({ path: 'README.md' })
    expect(read.path).toBe('README.md')
    expect(read.binary).toBe(false)
    expect(read.text).toContain('MachineRoom')
    await expect(mock.fileInfo({ path: '../secret.txt' })).rejects.toThrow(FILE_OUTSIDE_PROBLEM)
    await expect(mock.fileInfo({ path: '.env' })).rejects.toThrow('That file was not found.')
    expect(await mock.network()).toEqual({ online: true, checkedAt: expect.any(String) })

    const root = makeRoot()
    writeFileSync(join(root, 'README.md'), 'hello\n')
    const { client } = await startBridge({
      projectRoot: root,
      networkConnector: async () => true,
    })
    expect((await client.fileInfo({ path: 'README.md' })).text).toBe('hello\n')
    expect((await client.network()).online).toBe(true)
  })
})
