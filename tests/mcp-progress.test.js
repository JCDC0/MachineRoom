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

  it.each([
    ['an id', { ...progress('t'), id: 9 }],
    ['no numeric progress', { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 't', progress: 'x' } }],
  ])('does not keep a stdio call alive on a notice with %s', async (_name, notice) => {
    const run = callMcpServerTool(SERVER, 'go', {}, {
      spawnImpl: fakeSpawn((message, send) => {
        setTimeout(() => send({ ...notice, params: { ...notice.params, progressToken: message.params._meta.progressToken } }), MCP_CALL_TIMEOUT_MS - 1000)
      }),
    })
    await vi.advanceTimersByTimeAsync(MCP_CALL_TIMEOUT_MS + 1)
    expect(await run).toEqual({ ok: false, problem: MCP_TIMEOUT_PROBLEM })
  })
})

const HTTP = { name: 'web', transport: 'http', command: '', args: [], env: {}, url: 'http://127.0.0.1:9/mcp', enabled: true }

function httpFetch(chunksFor) {
  return async (_url, init) => {
    const message = JSON.parse(init.body)
    const json = (body) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify(body), body: null })
    if (message.method === 'initialize') return json({ jsonrpc: '2.0', id: message.id, result: {} })
    if (message.method !== 'tools/call') return { ok: true, status: 202, headers: new Headers(), body: { cancel: async () => {} } }
    const token = message.params._meta.progressToken
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      async start(controller) {
        for (const [wait, chunk] of chunksFor(token, message.id)) {
          await new Promise((resolve) => setTimeout(resolve, wait))
          if (init.signal.aborted) return controller.error(new DOMException('aborted', 'AbortError'))
          if (chunk === null) return controller.close()
          controller.enqueue(encoder.encode(chunk))
        }
      },
    })
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body, text: async () => '' }
  }
}

const event = (message, eol = '\n') => `data: ${JSON.stringify(message)}${eol}${eol}`
const nearLimit = MCP_CALL_TIMEOUT_MS - 1000

describe('MCP call progress over HTTP', () => {
  const run = (chunksFor) => callMcpServerTool(HTTP, 'go', {}, { fetchImpl: httpFetch(chunksFor) })

  it('resets the timer on progress with CRLF separators', async () => {
    const result = run((token, id) => [
      [nearLimit, event(progress(token), '\r\n')],
      [nearLimit, event({ jsonrpc: '2.0', id, result: { content: ['done'] } }, '\r\n')],
      [0, null],
    ])
    for (let i = 0; i < 31; i += 1) await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toEqual({ ok: true, result: { content: ['done'] } })
  })

  it('resets the timer on an event split after its first byte', async () => {
    const result = run((token, id) => {
      const text = event(progress(token))
      return [
        [nearLimit, text.slice(0, 1)],
        [0, text.slice(1)],
        [nearLimit, event({ jsonrpc: '2.0', id, result: { content: ['done'] } })],
        [0, null],
      ]
    })
    for (let i = 0; i < 31; i += 1) await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toEqual({ ok: true, result: { content: ['done'] } })
  })

  it.each([
    ['an id', (token) => ({ ...progress(token), id: 9 })],
    ['no numeric progress', (token) => ({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token } })],
  ])('does not keep a call alive on a notice with %s', async (_name, make) => {
    const result = run((token) => [
      [nearLimit, event(make(token))],
      [nearLimit, event({ jsonrpc: '2.0', id: 99, result: {} })],
      [0, null],
    ])
    for (let i = 0; i < 31; i += 1) await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toEqual({ ok: false, problem: MCP_TIMEOUT_PROBLEM })
  })
})
