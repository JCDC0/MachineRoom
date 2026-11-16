import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MCP_PROTOCOL_VERSION,
  MCP_START_PROBLEM,
  listAllMcpTools,
  writeMcpServers,
} from '../server/mcp.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

function useTempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => removeTempDir(dir))
  return dir
}

const STDIO_SERVER = {
  name: 'files',
  transport: 'stdio',
  command: 'node',
  args: ['server.mjs'],
  env: { ROOM: 'one' },
  url: '',
  enabled: true,
}

function answerFor(message) {
  if (message.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'probe', version: '1' },
      },
    }
  }
  if (message.method === 'tools/list') {
    return { jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'echo', description: 'Echo text' }] } }
  }
  return undefined
}

function fakeSpawn({ failFirst = false } = {}) {
  const calls = []
  const spawnImpl = (command, args, options) => {
    if (failFirst && calls.length === 0) {
      calls.push({ command, args, options })
      throw new Error('no program')
    }
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.killed = false
    child.kill = () => {
      child.killed = true
      return true
    }
    child.stdin = {
      write(text) {
        for (const line of String(text).split('\n')) {
          if (line.trim() === '') continue
          const message = JSON.parse(line)
          const answer = answerFor(message)
          if (!answer) continue
          queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify(answer)}\n`))
        }
        return true
      },
      end() {},
    }
    calls.push({ command, args, options, child })
    return child
  }
  spawnImpl.calls = calls
  return spawnImpl
}

describe('listAllMcpTools cache', () => {
  it('starts a server once for two lists within 60 seconds and once per runs folder', async () => {
    const runsDir = useTempDir('mr-mcp-cache-')
    writeMcpServers(runsDir, [STDIO_SERVER])
    const spawnImpl = fakeSpawn()

    const first = await listAllMcpTools(runsDir, { spawnImpl })
    const second = await listAllMcpTools(runsDir, { spawnImpl })
    expect(spawnImpl.calls).toHaveLength(1)
    expect(second.tools).toEqual(first.tools)
    expect(first.tools.map((tool) => tool.name)).toEqual(['echo'])

    const otherDir = useTempDir('mr-mcp-cache-')
    writeMcpServers(otherDir, [STDIO_SERVER])
    await listAllMcpTools(otherDir, { spawnImpl })
    expect(spawnImpl.calls).toHaveLength(2)
  })

  it('starts the server again after its config changes', async () => {
    const runsDir = useTempDir('mr-mcp-cache-')
    writeMcpServers(runsDir, [STDIO_SERVER])
    const spawnImpl = fakeSpawn()

    await listAllMcpTools(runsDir, { spawnImpl })
    await listAllMcpTools(runsDir, { spawnImpl })
    expect(spawnImpl.calls).toHaveLength(1)

    writeMcpServers(runsDir, [{ ...STDIO_SERVER, args: ['other.mjs'] }])
    await listAllMcpTools(runsDir, { spawnImpl })
    expect(spawnImpl.calls).toHaveLength(2)
    expect(spawnImpl.calls[1].args).toEqual(['other.mjs'])
  })

  it('starts the server again when only an environment value changes', async () => {
    const runsDir = useTempDir('mr-mcp-cache-')
    writeMcpServers(runsDir, [STDIO_SERVER])
    const spawnImpl = fakeSpawn()

    await listAllMcpTools(runsDir, { spawnImpl })
    writeMcpServers(runsDir, [{ ...STDIO_SERVER, env: { ROOM: 'two' } }])
    await listAllMcpTools(runsDir, { spawnImpl })
    expect(spawnImpl.calls).toHaveLength(2)
  })

  it('retries a failed list on the next call and keeps the next answer', async () => {
    const runsDir = useTempDir('mr-mcp-cache-')
    writeMcpServers(runsDir, [STDIO_SERVER])
    const spawnImpl = fakeSpawn({ failFirst: true })

    const failed = await listAllMcpTools(runsDir, { spawnImpl })
    expect(failed.ok).toBe(false)
    expect(failed.errors).toEqual([{ server: 'files', problem: MCP_START_PROBLEM }])

    const retried = await listAllMcpTools(runsDir, { spawnImpl })
    expect(retried.ok).toBe(true)
    expect(spawnImpl.calls).toHaveLength(2)

    const cached = await listAllMcpTools(runsDir, { spawnImpl })
    expect(cached.tools).toEqual(retried.tools)
    expect(spawnImpl.calls).toHaveLength(2)
  })

  it('shares one request between two calls at once', async () => {
    const runsDir = useTempDir('mr-mcp-cache-')
    writeMcpServers(runsDir, [STDIO_SERVER])
    const spawnImpl = fakeSpawn()

    const [first, second] = await Promise.all([
      listAllMcpTools(runsDir, { spawnImpl }),
      listAllMcpTools(runsDir, { spawnImpl }),
    ])
    expect(spawnImpl.calls).toHaveLength(1)
    expect(second.tools).toEqual(first.tools)
    expect(first.tools.map((tool) => tool.server)).toEqual(['files'])
  })
})
