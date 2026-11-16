import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MCP_CALL_CEILING_MS,
  MCP_CALL_TIMEOUT_MS,
  MCP_CEILING_PROBLEM,
  MCP_TIMEOUT_PROBLEM,
  callMcpServerTool,
} from '../server/mcp.js'

const SERVER = { name: 'slow', transport: 'stdio', command: 'node', args: ['s.mjs'], env: {}, url: '', enabled: true }

function fakeSpawn(onCall) {
  return () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const send = (message) => child.stdout.emit('data', `${JSON.stringify(message)}\n`)
    child.stdin = {
      write(line) {
        const message = JSON.parse(line)
        if (message.method === 'initialize') {
          send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: {} } })
        } else if (message.method === 'tools/call') {
          onCall(message, send)
        }
      },
      end() {},
    }
    child.kill = () => true
    return child
  }
}

const progress = (token) => ({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: 1 } })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('MCP call progress', () => {
  it('sends a progress token with the call', async () => {
    let meta
    const run = callMcpServerTool(SERVER, 'go', {}, {
      spawnImpl: fakeSpawn((message, send) => {
        meta = message.params._meta
        send({ jsonrpc: '2.0', id: message.id, result: { content: [] } })
      }),
    })
    await vi.advanceTimersByTimeAsync(0)
    await run
    expect(typeof meta.progressToken).toBe('string')
  })

  it('answers a call that reports progress for longer than the inactivity limit', async () => {
    const run = callMcpServerTool(SERVER, 'go', {}, {
      spawnImpl: fakeSpawn((message, send) => {
        let ticks = 0
        const every = setInterval(() => {
          ticks += 1
          if (ticks < 8) send(progress(message.params._meta.progressToken))
          else {
            clearInterval(every)
            send({ jsonrpc: '2.0', id: message.id, result: { content: ['done'] } })
          }
        }, 5000)
      }),
    })
    await vi.advanceTimersByTimeAsync(40000)
    expect(await run).toEqual({ ok: true, result: { content: ['done'] } })
  })

  it('times out a call that sends nothing', async () => {
    const run = callMcpServerTool(SERVER, 'go', {}, { spawnImpl: fakeSpawn(() => {}) })
    await vi.advanceTimersByTimeAsync(MCP_CALL_TIMEOUT_MS + 1)
    expect(await run).toEqual({ ok: false, problem: MCP_TIMEOUT_PROBLEM })
  })

  it('stops at the ceiling when progress never ends', async () => {
    const run = callMcpServerTool(SERVER, 'go', {}, {
      spawnImpl: fakeSpawn((message, send) => {
        setInterval(() => send(progress(message.params._meta.progressToken)), 5000)
      }),
    })
    await vi.advanceTimersByTimeAsync(MCP_CALL_CEILING_MS + 1)
    expect(await run).toEqual({ ok: false, problem: MCP_CEILING_PROBLEM })
  })

  it('ignores a progress notice with another token', async () => {
    const run = callMcpServerTool(SERVER, 'go', {}, {
      spawnImpl: fakeSpawn((message, send) => {
        setTimeout(() => send(progress('other')), MCP_CALL_TIMEOUT_MS - 1000)
      }),
    })
    await vi.advanceTimersByTimeAsync(MCP_CALL_TIMEOUT_MS + 1)
    expect(await run).toEqual({ ok: false, problem: MCP_TIMEOUT_PROBLEM })
  })
})
