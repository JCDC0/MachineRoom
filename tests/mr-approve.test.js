import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../scripts/mr-approve.mjs', import.meta.url))
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()()
  }
})

function baseEnvironment() {
  const env = {}
  for (const name of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'ComSpec', 'COMSPEC', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
    if (typeof process.env[name] === 'string') env[name] = process.env[name]
  }
  return env
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

async function waitFor(check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = check()
    if (value) return value
    if (Date.now() > deadline) throw new Error('Timed out waiting for the approval server.')
    await sleep(10)
  }
}

function startBridge(answerFor) {
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', async () => {
      const parsed = body === '' ? null : JSON.parse(body)
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: parsed })
      const answer = await answerFor(parsed)
      const text = JSON.stringify(answer)
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
      res.end(text)
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
      done({ url: `http://127.0.0.1:${address.port}`, requests })
    })
  })
}

function startMcp(env) {
  const child = spawn(process.execPath, [SCRIPT], {
    env: { ...baseEnvironment(), ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const answers = []
  let buffer = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let cut = buffer.indexOf('\n')
    while (cut !== -1) {
      const line = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      if (line.trim() !== '') answers.push(JSON.parse(line))
      cut = buffer.indexOf('\n')
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  cleanups.push(
    () =>
      new Promise((done) => {
        child.once('close', () => done())
        child.kill()
      }),
  )
  return {
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    },
    answers,
    stderr: () => stderr,
    waitFor(predicate) {
      return waitFor(() => answers.find(predicate))
    },
  }
}

describe('mr-approve MCP server', () => {
  it('lists the approve tool and allows a call through the bridge', async () => {
    const bridge = await startBridge(() => ({ allow: true }))
    const mcp = startMcp({
      MACHINEROOM_BRIDGE: bridge.url,
      MACHINEROOM_ORCHESTRATOR_ID: 'orchestrator',
      MACHINEROOM_ORCHESTRATOR_TOKEN: 'test-token',
    })
    mcp.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    const init = await mcp.waitFor((message) => message.id === 1)
    expect(init.result.serverInfo.name).toBe('machineroom-approve')
    mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    mcp.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const list = await mcp.waitFor((message) => message.id === 2)
    expect(list.result.tools.map((tool) => tool.name)).toEqual(['approve'])

    const input = { path: 'a.txt', content: 'hello\n' }
    mcp.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'approve', arguments: { tool_name: 'write_file', input } },
    })
    const called = await mcp.waitFor((message) => message.id === 3)
    expect(JSON.parse(called.result.content[0].text)).toEqual({ behavior: 'allow', updatedInput: input })
    expect(bridge.requests).toHaveLength(1)
    expect(bridge.requests[0].url).toBe('/api/orchestrator/approvals')
    expect(bridge.requests[0].headers['x-machineroom-orchestrator']).toBe('test-token')
    expect(bridge.requests[0].body).toEqual({ id: 'orchestrator', tool: 'write_file', input })
  })

  it('answers a deny with its message', async () => {
    const bridge = await startBridge(() => ({ allow: false, message: 'The owner denied it.' }))
    const mcp = startMcp({
      MACHINEROOM_BRIDGE: bridge.url,
      MACHINEROOM_ORCHESTRATOR_ID: 'orchestrator',
      MACHINEROOM_ORCHESTRATOR_TOKEN: 'test-token',
    })
    mcp.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    await mcp.waitFor((message) => message.id === 1)
    mcp.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'approve', arguments: { tool_name: 'run_shell', input: { command: 'rm -rf build' } } },
    })
    const called = await mcp.waitFor((message) => message.id === 2)
    expect(JSON.parse(called.result.content[0].text)).toEqual({ behavior: 'deny', message: 'The owner denied it.' })
  })

  it('denies when the bridge is not configured', async () => {
    const mcp = startMcp({})
    mcp.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'approve', arguments: { tool_name: 'write_file', input: {} } },
    })
    const called = await mcp.waitFor((message) => message.id === 1)
    expect(JSON.parse(called.result.content[0].text)).toEqual({
      behavior: 'deny',
      message: 'The approval bridge is not configured.',
    })
  })
})
