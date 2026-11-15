import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { killTree } from '../server/processTree.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const SCRIPT = fileURLToPath(new URL('../scripts/mr-agent.mjs', import.meta.url))
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()()
  }
})

function tempDir(prefix = 'mr-agent-inbox-') {
  const dir = makeTempDir(prefix)
  cleanups.push(async () => removeTempDir(dir))
  return dir
}

function baseEnvironment() {
  const env = {}
  for (const name of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'ComSpec', 'COMSPEC', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
    if (typeof process.env[name] === 'string') env[name] = process.env[name]
  }
  return env
}

function chatAnswer({ text = '', calls = [] } = {}) {
  const message = { role: 'assistant', content: text === '' ? null : text }
  if (calls.length > 0) {
    message.tool_calls = calls.map((call, index) => ({
      id: call.id ?? `call_${index}`,
      type: 'function',
      function: {
        name: call.name,
        arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
      },
    }))
  }
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    choices: [{ index: 0, message, finish_reason: calls.length > 0 ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }
}

function startFakeApi(handler) {
  const calls = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', async () => {
      try {
        const parsed = body === '' ? null : JSON.parse(body)
        calls.push({ method: req.method, url: req.url, headers: req.headers, body: parsed })
        const answer = await handler(parsed, calls.length - 1, calls)
        const status = Number.isInteger(answer?.status) ? answer.status : 200
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(answer?.body ?? answer))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String(error?.message ?? error) }))
      }
    })
  })
  cleanups.push(
    () =>
      new Promise((done) => {
        server.close(() => done())
        server.closeAllConnections?.()
      }),
  )
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      done({ url: `http://127.0.0.1:${address.port}/v1`, calls, server })
    })
  })
}

function startFakeBridge(handler) {
  const requests = []
  const timers = new Set()
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers })
    Promise.resolve(handler(req, res, { requests, timers })).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
      }
      res.end(JSON.stringify({ error: String(error?.message ?? error) }))
    })
  })
  cleanups.push(() => {
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    return new Promise((done) => {
      server.close(() => done())
      server.closeAllConnections?.()
    })
  })
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      done({ url: `http://127.0.0.1:${address.port}`, requests, server })
    })
  })
}

function runAgent({ folder, api, env = {}, seconds = 20 }) {
  return new Promise((done, fail) => {
    const childEnv = {
      ...baseEnvironment(),
      MACHINEROOM_API_URL: api.url,
      MACHINEROOM_API_KEY: 'test-key',
      ...env,
    }
    const args = [SCRIPT, '--model', 'test/model', '--cwd', folder, 'Do the task.']
    const child = spawn(process.execPath, args, {
      cwd: folder,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      killTree(child)
      fail(new Error(`mr-agent did not exit. stderr: ${stderr}`))
    }, seconds * 1000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      fail(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      done({ code, stdout, stderr })
    })
  })
}

function jsonLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

describe('mr-agent lane inbox', () => {
  it('reads unseen messages after the first model call and does not repeat them on the third', async () => {
    const folder = tempDir()
    const ticket = 'lane-ticket-1'
    let inbox = []
    const bridge = await startFakeBridge((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ messages: inbox }))
    })
    const api = await startFakeApi((_body, index) => {
      if (index === 0) {
        inbox = [{ from: 'orchestrator', text: 'Check tests first.', at: '2026-11-15T10:00:00.000Z' }]
        return chatAnswer({ calls: [{ name: 'list_dir', arguments: { path: '.' } }] })
      }
      if (index === 1) {
        return chatAnswer({ calls: [{ name: 'list_dir', arguments: { path: '.' } }] })
      }
      return chatAnswer({ text: 'Done.' })
    })

    const result = await runAgent({
      folder,
      api,
      env: {
        MACHINEROOM_BRIDGE: `${bridge.url}/`,
        MACHINEROOM_LANE_TICKET: ticket,
      },
    })

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(api.calls).toHaveLength(3)
    expect(bridge.requests).toHaveLength(2)
    for (const request of bridge.requests) {
      expect(request.method).toBe('GET')
      expect(request.url).toBe('/api/orchestrator/messages')
      expect(request.headers['x-machineroom-lane']).toBe(ticket)
      expect(request.headers.origin).toBeUndefined()
    }

    const firstUsers = api.calls[0].body.messages.filter((m) => m.role === 'user')
    expect(firstUsers).toHaveLength(1)
    expect(firstUsers[0].content).toBe('Do the task.')

    const expectedInboxText = 'Messages for you while you work:\norchestrator: Check tests first.'
    const secondInbox = api.calls[1].body.messages.filter((m) => m.role === 'user' && m.content.startsWith('Messages for you while you work:'))
    expect(secondInbox).toEqual([{ role: 'user', content: expectedInboxText }])
    expect(api.calls[1].body.messages.at(-1)).toEqual({ role: 'user', content: expectedInboxText })

    const thirdInbox = api.calls[2].body.messages.filter((m) => m.role === 'user' && m.content.startsWith('Messages for you while you work:'))
    expect(thirdInbox).toHaveLength(1)
    expect(api.calls[2].body.messages.at(-1).role).toBe('tool')
  })

  it('compares messages by at and text so only unseen replies are appended', async () => {
    const folder = tempDir()
    const firstMessage = { from: 'orchestrator', text: 'Same text.', at: '2026-11-15T10:00:00.000Z' }
    let inbox = []
    const bridge = await startFakeBridge((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ messages: inbox }))
    })
    const api = await startFakeApi((_body, index) => {
      if (index === 0) {
        inbox = [firstMessage]
        return chatAnswer({ calls: [{ name: 'list_dir', arguments: { path: '.' } }] })
      }
      if (index === 1) {
        inbox = [
          firstMessage,
          { from: 'sub:ui', text: 'Same text.', at: '2026-11-15T10:00:00.000Z' },
          { from: 'orchestrator', text: 'Same text.', at: '2026-11-15T10:01:00.000Z' },
          { from: 'lane:opencode', text: 'Schema landed.', at: '2026-11-15T10:02:00.000Z' },
        ]
        return chatAnswer({ calls: [{ name: 'list_dir', arguments: { path: '.' } }] })
      }
      return chatAnswer({ text: 'Done.' })
    })

    const result = await runAgent({
      folder,
      api,
      env: {
        MACHINEROOM_BRIDGE: bridge.url,
        MACHINEROOM_LANE_TICKET: 'lane-ticket-2',
      },
    })

    expect(result.code).toBe(0)
    expect(api.calls[1].body.messages.at(-1)).toEqual({
      role: 'user',
      content: 'Messages for you while you work:\norchestrator: Same text.',
    })
    expect(api.calls[2].body.messages.at(-1)).toEqual({
      role: 'user',
      content: 'Messages for you while you work:\norchestrator: Same text.\nlane:opencode: Schema landed.',
    })
  })

  it('adds nothing and does not retry in that turn on 403', async () => {
    const folder = tempDir()
    const bridge = await startFakeBridge((_req, res) => {
      res.writeHead(403, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'That lane run has ended or is not known.' }))
    })
    const api = await startFakeApi((_body, index) =>
      index === 0
        ? chatAnswer({ calls: [{ name: 'list_dir', arguments: { path: '.' } }] })
        : chatAnswer({ text: 'Done.' }),
    )

    const result = await runAgent({
      folder,
      api,
      env: {
        MACHINEROOM_BRIDGE: bridge.url,
        MACHINEROOM_LANE_TICKET: 'lane-ticket-403',
      },
    })

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(bridge.requests).toHaveLength(1)
    expect(api.calls[1].body.messages.filter((m) => m.role === 'user')).toHaveLength(1)
  })

  it('adds nothing and does not retry in that turn when the inbox read times out at 3 seconds', async () => {
    const folder = tempDir()
    const bridge = await startFakeBridge((_req, res, { timers }) => {
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (!res.writableEnded) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ messages: [{ from: 'orchestrator', text: 'Too late.', at: '2026-11-15T10:05:00.000Z' }] }))
        }
      }, 15000)
      timers.add(timer)
    })
    const api = await startFakeApi((_body, index) =>
      index === 0
        ? chatAnswer({ calls: [{ name: 'list_dir', arguments: { path: '.' } }] })
        : chatAnswer({ text: 'Done.' }),
    )

    const startedAt = Date.now()
    const result = await runAgent({
      folder,
      api,
      seconds: 8,
      env: {
        MACHINEROOM_BRIDGE: bridge.url,
        MACHINEROOM_LANE_TICKET: 'lane-ticket-slow',
      },
    })
    const elapsedMs = Date.now() - startedAt

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(elapsedMs).toBeGreaterThanOrEqual(2500)
    expect(elapsedMs).toBeLessThan(7500)
    expect(bridge.requests).toHaveLength(1)
    expect(api.calls[1].body.messages.filter((m) => m.role === 'user')).toHaveLength(1)
  }, 15000)

  it('makes no inbox request when either variable is missing and makes one when both are set', async () => {
    const folder = tempDir()
    const bridge = await startFakeBridge((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ messages: [{ from: 'orchestrator', text: 'Ping.', at: '2026-11-15T10:06:00.000Z' }] }))
    })
    const makeApi = () =>
      startFakeApi((_body, index) =>
        index === 0
          ? chatAnswer({ calls: [{ name: 'list_dir', arguments: { path: '.' } }] })
          : chatAnswer({ text: 'Done.' }),
      )

    for (const env of [
      {},
      { MACHINEROOM_BRIDGE: bridge.url },
      { MACHINEROOM_LANE_TICKET: 'lane-ticket-only' },
    ]) {
      const api = await makeApi()
      const result = await runAgent({ folder, api, env })
      expect(result.code).toBe(0)
      expect(bridge.requests).toHaveLength(0)
    }

    const api = await makeApi()
    const result = await runAgent({
      folder,
      api,
      env: {
        MACHINEROOM_BRIDGE: bridge.url,
        MACHINEROOM_LANE_TICKET: 'lane-ticket-both',
      },
    })
    expect(result.code).toBe(0)
    expect(bridge.requests).toHaveLength(1)
    expect(api.calls[1].body.messages.at(-1)).toEqual({
      role: 'user',
      content: 'Messages for you while you work:\norchestrator: Ping.',
    })
  })

  it('never prints, logs or puts the lane ticket into the conversation', async () => {
    const folder = tempDir()
    const ticket = 'secret-lane-ticket-998877'
    let count = 0
    const bridge = await startFakeBridge((_req, res) => {
      count += 1
      if (count === 1) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ messages: [{ from: 'orchestrator', text: 'Carry on.', at: '2026-11-15T10:07:00.000Z' }] }))
        return
      }
      res.writeHead(403, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'That lane run has ended or is not known.' }))
    })
    const command = `"${process.execPath}" -e "process.stdout.write(String(process.env.MACHINEROOM_LANE_TICKET ?? 'none'))"`
    const api = await startFakeApi((_body, index) => {
      if (index === 0) return chatAnswer({ calls: [{ name: 'run_shell', arguments: { command } }] })
      if (index === 1) return chatAnswer({ calls: [{ name: 'list_dir', arguments: { path: '.' } }] })
      return chatAnswer({ text: 'Done.' })
    })

    const result = await runAgent({
      folder,
      api,
      env: {
        MACHINEROOM_BRIDGE: bridge.url,
        MACHINEROOM_LANE_TICKET: ticket,
      },
    })

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(bridge.requests).toHaveLength(2)
    expect(api.calls[1].body.messages.at(-1).content).toBe('Messages for you while you work:\norchestrator: Carry on.')
    expect(result.stdout).not.toContain(ticket)
    expect(result.stderr).not.toContain(ticket)
    for (const line of jsonLines(result.stdout)) {
      expect(JSON.stringify(line)).not.toContain(ticket)
    }
    const users = jsonLines(result.stdout).filter((line) => line.type === 'user')
    expect(users[0].message.content[0].content).toBe('none')
    expect(JSON.stringify(api.calls)).not.toContain(ticket)
  })
})
