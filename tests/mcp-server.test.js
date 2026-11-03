import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MCP_ARGS_PROBLEM,
  MCP_CALL_CONFIRM_PROBLEM,
  MCP_CALL_TIMEOUT_MS,
  MCP_COMMAND_PROBLEM,
  MCP_DELETE_CONFIRM_PROBLEM,
  MCP_ENABLED_PROBLEM,
  MCP_ENV_PROBLEM,
  MCP_HTTP_PROBLEM,
  MCP_HTTP_STATUS_PROBLEM,
  MCP_JSON_PROBLEM,
  MCP_LIST_TIMEOUT_MS,
  MCP_NAME_PROBLEM,
  MCP_NOT_FOUND_PROBLEM,
  MCP_OFF_PROBLEM,
  MCP_PROTOCOL_VERSION,
  MCP_RPC_PROBLEM,
  MCP_SAVE_CONFIRM_PROBLEM,
  MCP_SERVER_PROBLEM,
  MCP_START_PROBLEM,
  MCP_STOPPED_PROBLEM,
  MCP_TIMEOUT_PROBLEM,
  MCP_TOOL_ARGS_PROBLEM,
  MCP_TOOL_PROBLEM,
  MCP_TOOLS_PROBLEM,
  MCP_TRANSPORT_PROBLEM,
  MCP_URL_PROBLEM,
  OWNER_MCP_PROBLEM,
  callMcpServerTool,
  callMcpTool,
  cleanMcpServer,
  listAllMcpTools,
  listMcpServerTools,
  mcpFile,
  mcpServerProblem,
  readMcpServers,
  removeMcpServer,
  upsertMcpServer,
  writeMcpServers,
} from '../server/mcp.js'
import { getJson, startLaneBridge } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()()
  }
})

function useTempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => removeTempDir(dir))
  return dir
}

const SAMPLE_TOOLS = [
  {
    name: 'read_file',
    description: 'Read a file',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  { name: 'search', description: 'Search the web' },
  { name: '', description: 'No name' },
  { description: 'Still no name' },
]

const SAMPLE_TOOLS_CLEAN = [
  {
    name: 'read_file',
    description: 'Read a file',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'search',
    description: 'Search the web',
    inputSchema: { type: 'object', properties: {} },
  },
]

const DEFAULT_CALL_RESULT = { content: [{ type: 'text', text: 'ok' }] }

const STDIO_SERVER = {
  name: 'files',
  transport: 'stdio',
  command: 'node',
  args: ['server.mjs', '--stdio'],
  env: { FILES_DIR: 'room' },
  url: '',
  enabled: true,
}

const HTTP_SERVER = {
  name: 'files',
  transport: 'http',
  command: '',
  args: [],
  env: {},
  url: 'http://127.0.0.1:4321/mcp',
  enabled: true,
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function initResult() {
  return { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'probe', version: '1' } }
}

function jsonResponse(body, { status = 200, headers = {}, text = null } = {}) {
  const payload = text ?? (body === null ? '' : JSON.stringify(body))
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    text: async () => payload,
    body: { cancel: async () => {} },
  }
}

function httpMcpFetch({ tools = SAMPLE_TOOLS, callResult = DEFAULT_CALL_RESULT, sessionId = 'session-1' } = {}) {
  const requests = []
  const fetchImpl = async (url, init = {}) => {
    const message = JSON.parse(String(init.body))
    requests.push({ url, init, message })
    if (message.method === 'initialize') {
      return jsonResponse(rpcResult(message.id, initResult()), {
        headers: sessionId === '' ? {} : { 'mcp-session-id': sessionId },
      })
    }
    if (message.method === 'notifications/initialized') return jsonResponse(null, { status: 202 })
    if (message.method === 'tools/list') return jsonResponse(rpcResult(message.id, { tools }))
    if (message.method === 'tools/call') return jsonResponse(rpcResult(message.id, callResult))
    return jsonResponse(rpcError(message.id, -32601, 'Unknown method'))
  }
  fetchImpl.requests = requests
  return fetchImpl
}

function stdioResponder({ tools = SAMPLE_TOOLS, callResult = DEFAULT_CALL_RESULT, initializeError = null } = {}) {
  return (message) => {
    if (message.method === 'initialize') {
      if (initializeError) return rpcError(message.id, -32603, initializeError.message)
      return rpcResult(message.id, initResult())
    }
    if (message.method === 'tools/list') return rpcResult(message.id, { tools })
    if (message.method === 'tools/call') return rpcResult(message.id, callResult)
    return undefined
  }
}

function fakeChild(handler, { split = false } = {}) {
  const child = new EventEmitter()
  const written = []
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = {
    write(text) {
      for (const line of String(text).split('\n')) {
        if (line.trim() === '') continue
        const message = JSON.parse(line)
        written.push(message)
        const answer = handler(message)
        if (!answer) continue
        const payload = `${JSON.stringify(answer)}\n`
        queueMicrotask(() => {
          if (!split) {
            child.stdout.emit('data', payload)
            return
          }
          const cut = Math.max(1, Math.floor(payload.length / 2))
          child.stdout.emit('data', payload.slice(0, cut))
          queueMicrotask(() => child.stdout.emit('data', payload.slice(cut)))
        })
      }
      return true
    },
    end() {},
  }
  child.killed = false
  child.kill = () => {
    child.killed = true
    return true
  }
  return { child, written }
}

function fakeSpawn(handler, { split = false, onSpawn = null } = {}) {
  const calls = []
  const spawnImpl = (command, args, options) => {
    const { child, written } = fakeChild(handler, { split })
    calls.push({ command, args, options, child, written })
    if (onSpawn) onSpawn(child)
    return child
  }
  spawnImpl.calls = calls
  return spawnImpl
}

function fakeFetch(handler) {
  const requests = []
  const fetchImpl = async (url, init = {}) => {
    const message = JSON.parse(String(init.body))
    const entry = { url, init, message }
    requests.push(entry)
    return handler(message, entry)
  }
  fetchImpl.requests = requests
  return fetchImpl
}

function hangingFetch() {
  return (url, init = {}) =>
    new Promise((resolve, reject) => {
      const stop = () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))
      if (init.signal?.aborted) stop()
      else init.signal?.addEventListener('abort', stop, { once: true })
    })
}

const REAL_SERVER_SCRIPT = [
  "const readline = require('node:readline')",
  "const rl = readline.createInterface({ input: process.stdin })",
  "rl.on('line', (line) => {",
  "  if (!line.trim()) return",
  '  const message = JSON.parse(line)',
  "  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')",
  "  if (message.method === 'initialize') reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'probe', version: '1' } })",
  "  else if (message.method === 'tools/list') reply({ tools: [{ name: 'echo', description: 'Echo text', inputSchema: { type: 'object' } }] })",
  "  else if (message.method === 'tools/call') reply({ content: [{ type: 'text', text: message.params.arguments.text }] })",
  '})',
].join('\n')

const REAL_SERVER = {
  name: 'real',
  transport: 'stdio',
  command: process.execPath,
  args: ['-e', REAL_SERVER_SCRIPT],
  env: {},
  url: '',
  enabled: true,
}

async function startLocalMcpServer() {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      let message
      try {
        message = JSON.parse(body)
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      const send = (payload) => {
        const text = JSON.stringify(payload)
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
        res.end(text)
      }
      if (message.method === 'initialize') {
        const text = JSON.stringify(rpcResult(message.id, initResult()))
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(text),
          'mcp-session-id': 'local-session',
        })
        res.end(text)
        return
      }
      if (message.method === 'notifications/initialized') {
        res.writeHead(202)
        res.end()
        return
      }
      if (message.method === 'tools/list') {
        send(rpcResult(message.id, { tools: SAMPLE_TOOLS }))
        return
      }
      if (message.method === 'tools/call') {
        const text = String(message.params?.arguments?.text ?? '')
        send(rpcResult(message.id, { content: [{ type: 'text', text }] }))
        return
      }
      send(rpcError(message.id, -32601, 'Unknown method'))
    })
  })
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  cleanups.push(() => new Promise((resolveClose) => server.close(() => resolveClose())))
  const address = server.address()
  return `http://127.0.0.1:${address.port}/mcp`
}

async function startMcpBridge() {
  const runsDir = useTempDir('mr-mcp-runs-')
  const projectRoot = useTempDir('mr-mcp-project-')
  const started = await startLaneBridge({ runsDir, projectRoot })
  cleanups.push(() => started.stop())
  return started
}

function pageGet(url, path, headers = {}) {
  return getJson(`${url}${path}`, { headers: { origin: new URL(url).origin, ...headers } })
}

function pagePost(url, path, body, headers = {}) {
  return getJson(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(url).origin, ...headers },
    body: JSON.stringify(body),
  })
}

describe('MCP server registry', () => {
  it('answers an empty list when mcp.json is missing', () => {
    expect(readMcpServers(useTempDir('mr-mcp-runs-'))).toEqual([])
  })

  it('writes and reads the servers with every field and a trailing newline', () => {
    const runsDir = useTempDir('mr-mcp-runs-')
    const entry = {
      name: 'files',
      transport: 'stdio',
      command: 'node',
      args: ['server.mjs'],
      env: { ROOM: 'one' },
      url: '',
      enabled: true,
    }
    writeMcpServers(runsDir, [entry])
    expect(readMcpServers(runsDir)).toEqual([entry])
    const text = readFileSync(mcpFile(runsDir), 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual({ servers: [entry] })
  })

  it('returns an empty list for a missing or broken file', () => {
    const runsDir = useTempDir('mr-mcp-runs-')
    writeFileSync(mcpFile(runsDir), '{ not json', 'utf8')
    expect(readMcpServers(runsDir)).toEqual([])
    writeFileSync(mcpFile(runsDir), JSON.stringify({ servers: 'no' }), 'utf8')
    expect(readMcpServers(runsDir)).toEqual([])
    expect(readMcpServers('')).toEqual([])
  })

  it('reads a bare list and skips entries that fail validation', () => {
    const runsDir = useTempDir('mr-mcp-runs-')
    writeFileSync(
      mcpFile(runsDir),
      JSON.stringify([
        { name: 'one', transport: 'stdio', command: 'node' },
        { name: 'bad name', transport: 'stdio', command: 'node' },
        { name: 'two', transport: 'http', url: 'https://example.com/mcp' },
        { name: 'one', transport: 'stdio', command: 'node' },
      ]),
      'utf8'
    )
    expect(readMcpServers(runsDir).map((entry) => entry.name)).toEqual(['one', 'two'])
  })

  it('creates the runs folder and normalizes what it writes', () => {
    const runsDir = useTempDir('mr-mcp-runs-')
    const nested = join(runsDir, 'deeper', 'runs')
    writeMcpServers(nested, [{ name: 'one', transport: 'stdio', command: 'node' }])
    expect(readFileSync(mcpFile(nested), 'utf8')).toContain('"servers"')
    expect(readMcpServers(nested)).toEqual([
      {
        name: 'one',
        transport: 'stdio',
        command: 'node',
        args: [],
        env: {},
        url: '',
        enabled: true,
      },
    ])
  })

  it('leaves an invalid entry out when it writes', () => {
    const runsDir = useTempDir('mr-mcp-runs-')
    writeMcpServers(runsDir, [
      { name: 'one', transport: 'stdio', command: 'node' },
      { name: 'bad name', transport: 'stdio', command: 'node' },
      { name: 'two', transport: 'http', url: 'ftp://example.com/mcp' },
    ])
    expect(readMcpServers(runsDir).map((entry) => entry.name)).toEqual(['one'])
  })

  it('accepts stdio and http entries and refuses every other shape', () => {
    expect(mcpServerProblem({ name: 'files', transport: 'stdio', command: 'node' })).toBeNull()
    expect(mcpServerProblem({ name: 'files-2_a', transport: 'http', url: 'http://127.0.0.1:1234/mcp' })).toBeNull()
    expect(mcpServerProblem({ name: 'files', transport: 'http', url: 'https://example.com/mcp' })).toBeNull()
    expect(mcpServerProblem({ name: '', transport: 'stdio', command: 'node' })).toBe(MCP_NAME_PROBLEM)
    expect(mcpServerProblem({ name: 'x'.repeat(41), transport: 'stdio', command: 'node' })).toBe(MCP_NAME_PROBLEM)
    expect(mcpServerProblem({ name: 'bad name', transport: 'stdio', command: 'node' })).toBe(MCP_NAME_PROBLEM)
    expect(mcpServerProblem({ name: 'bad.name', transport: 'stdio', command: 'node' })).toBe(MCP_NAME_PROBLEM)
    expect(mcpServerProblem({ name: 'files', transport: 'sse', command: 'node' })).toBe(MCP_TRANSPORT_PROBLEM)
    expect(mcpServerProblem({ name: 'files', transport: 'stdio', command: '   ' })).toBe(MCP_COMMAND_PROBLEM)
    expect(mcpServerProblem({ name: 'files', transport: 'http', url: '' })).toBe(MCP_URL_PROBLEM)
    expect(mcpServerProblem({ name: 'files', transport: 'http', url: 'ftp://example.com/mcp' })).toBe(MCP_URL_PROBLEM)
    expect(mcpServerProblem({ name: 'files', transport: 'http', url: 'not a url' })).toBe(MCP_URL_PROBLEM)
    expect(mcpServerProblem({ name: 'files', transport: 'stdio', command: 'node', args: 'one' })).toBe(MCP_ARGS_PROBLEM)
    expect(mcpServerProblem({ name: 'files', transport: 'stdio', command: 'node', args: [1] })).toBe(MCP_ARGS_PROBLEM)
    expect(mcpServerProblem({ name: 'files', transport: 'stdio', command: 'node', env: [] })).toBe(MCP_ENV_PROBLEM)
    expect(mcpServerProblem({ name: 'files', transport: 'stdio', command: 'node', env: { TOKEN: 1 } })).toBe(MCP_ENV_PROBLEM)
    expect(mcpServerProblem({ name: 'files', transport: 'stdio', command: 'node', enabled: 'yes' })).toBe(MCP_ENABLED_PROBLEM)
    expect(mcpServerProblem(null)).toBe(MCP_NAME_PROBLEM)
  })

  it('keeps only the fields the transport uses and defaults args, env and enabled', () => {
    expect(cleanMcpServer({ name: ' one ', transport: 'stdio', command: ' node ', url: 'https://ignored.example' })).toEqual({
      name: 'one',
      transport: 'stdio',
      command: 'node',
      args: [],
      env: {},
      url: '',
      enabled: true,
    })
    expect(cleanMcpServer({ name: 'web', transport: 'http', url: ' https://example.com/mcp ', command: 'ignored' })).toEqual({
      name: 'web',
      transport: 'http',
      command: '',
      args: [],
      env: {},
      url: 'https://example.com/mcp',
      enabled: true,
    })
    expect(cleanMcpServer({ name: 'off', transport: 'stdio', command: 'node', enabled: false }).enabled).toBe(false)
  })

  it('adds a server, replaces one by name in place and refuses an invalid entry', () => {
    const runsDir = useTempDir('mr-mcp-runs-')
    const first = { name: 'one', transport: 'stdio', command: 'node', args: ['one.mjs'], enabled: true }
    const second = { name: 'two', transport: 'http', url: 'https://example.com/mcp', enabled: true }
    expect(upsertMcpServer(runsDir, first)).toMatchObject({ ok: true, servers: [{ name: 'one' }] })
    expect(upsertMcpServer(runsDir, second).ok).toBe(true)
    const replaced = upsertMcpServer(runsDir, { ...first, enabled: false })
    expect(replaced.ok).toBe(true)
    expect(replaced.servers.map((entry) => [entry.name, entry.enabled])).toEqual([
      ['one', false],
      ['two', true],
    ])
    expect(readMcpServers(runsDir)).toEqual(replaced.servers)
    const refused = upsertMcpServer(runsDir, { ...first, name: 'bad name' })
    expect(refused).toEqual({ ok: false, problem: MCP_NAME_PROBLEM })
    expect(readMcpServers(runsDir)).toHaveLength(2)
  })

  it('removes a server and reports one that is not there', () => {
    const runsDir = useTempDir('mr-mcp-runs-')
    upsertMcpServer(runsDir, { name: 'one', transport: 'stdio', command: 'node', enabled: true })
    upsertMcpServer(runsDir, { name: 'two', transport: 'stdio', command: 'node', enabled: true })
    const removed = removeMcpServer(runsDir, 'one')
    expect(removed.ok).toBe(true)
    expect(removed.server.name).toBe('one')
    expect(removed.servers.map((entry) => entry.name)).toEqual(['two'])
    expect(readMcpServers(runsDir).map((entry) => entry.name)).toEqual(['two'])
    expect(removeMcpServer(runsDir, 'one')).toEqual({ ok: false, missing: true, problem: MCP_NOT_FOUND_PROBLEM })
  })
})

describe('listMcpServerTools', () => {
  it('initializes a stdio server and lists its tools over newline JSON-RPC', async () => {
    const spawnImpl = fakeSpawn(stdioResponder())
    const answer = await listMcpServerTools(STDIO_SERVER, { spawnImpl })
    expect(answer).toEqual({ ok: true, tools: SAMPLE_TOOLS_CLEAN })
    const call = spawnImpl.calls[0]
    expect(call.command).toBe('node')
    expect(call.args).toEqual(['server.mjs', '--stdio'])
    expect(call.options.stdio).toEqual(['pipe', 'pipe', 'pipe'])
    expect(call.options.shell).toBe(false)
    expect(call.options.env.FILES_DIR).toBe('room')
    expect(call.options.env.PATH).toBe(process.env.PATH)
    expect(call.written.map((message) => message.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
    expect(call.written[0].params).toEqual({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'machineroom', version: '1' },
    })
    expect(call.written[1]).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(call.written[2]).toEqual({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    expect(call.child.killed).toBe(true)
  })

  it('reads a stdio answer split across data chunks', async () => {
    const spawnImpl = fakeSpawn(stdioResponder(), { split: true })
    const answer = await listMcpServerTools(STDIO_SERVER, { spawnImpl })
    expect(answer).toEqual({ ok: true, tools: SAMPLE_TOOLS_CLEAN })
  })

  it('starts a real stdio MCP server and calls a tool on it', async () => {
    const listed = await listMcpServerTools(REAL_SERVER, { timeoutMs: 10000 })
    expect(listed.ok).toBe(true)
    expect(listed.tools.map((tool) => tool.name)).toEqual(['echo'])
    const called = await callMcpServerTool(REAL_SERVER, 'echo', { text: 'hello room' }, { timeoutMs: 10000 })
    expect(called.ok).toBe(true)
    expect(called.result).toEqual({ content: [{ type: 'text', text: 'hello room' }] })
  })

  it('refuses an invalid server without starting it', async () => {
    const spawnImpl = fakeSpawn(stdioResponder())
    expect(await listMcpServerTools({ ...STDIO_SERVER, command: ' ' }, { spawnImpl })).toEqual({
      ok: false,
      problem: MCP_COMMAND_PROBLEM,
    })
    expect(await listMcpServerTools({ ...STDIO_SERVER, transport: 'sse' }, { spawnImpl })).toEqual({
      ok: false,
      problem: MCP_TRANSPORT_PROBLEM,
    })
    expect(spawnImpl.calls).toHaveLength(0)
  })

  it('reports a stdio server that cannot start', async () => {
    const spawnImpl = () => {
      throw new Error('no program')
    }
    expect(await listMcpServerTools(STDIO_SERVER, { spawnImpl })).toEqual({ ok: false, problem: MCP_START_PROBLEM })
  })

  it('reports a stdio server that fails on start', async () => {
    const spawnImpl = fakeSpawn(() => undefined, {
      onSpawn: (child) => {
        setTimeout(() => child.emit('error', new Error('no program')), 5)
      },
    })
    expect(await listMcpServerTools(STDIO_SERVER, { spawnImpl, timeoutMs: 5000 })).toEqual({
      ok: false,
      problem: MCP_START_PROBLEM,
    })
  })

  it('reports a stdio server that exits before it answers', async () => {
    const spawnImpl = fakeSpawn(() => undefined, {
      onSpawn: (child) => {
        setTimeout(() => child.emit('exit', 1), 5)
      },
    })
    expect(await listMcpServerTools(STDIO_SERVER, { spawnImpl, timeoutMs: 5000 })).toEqual({
      ok: false,
      problem: MCP_STOPPED_PROBLEM,
    })
  })

  it('stops waiting for a stdio server that never answers', async () => {
    const spawnImpl = fakeSpawn(() => undefined)
    const answer = await listMcpServerTools(STDIO_SERVER, { spawnImpl, timeoutMs: 30 })
    expect(answer).toEqual({ ok: false, problem: MCP_TIMEOUT_PROBLEM })
    expect(spawnImpl.calls[0].child.killed).toBe(true)
  })

  it('turns a stdio JSON-RPC error into a problem', async () => {
    const spawnImpl = fakeSpawn(stdioResponder({ initializeError: { message: 'No tools here' } }))
    expect(await listMcpServerTools(STDIO_SERVER, { spawnImpl })).toEqual({
      ok: false,
      problem: `${MCP_RPC_PROBLEM} No tools here`,
    })
  })

  it('refuses a tools list that is not a list', async () => {
    const spawnImpl = fakeSpawn((message) => {
      if (message.method === 'initialize') return rpcResult(message.id, initResult())
      if (message.method === 'tools/list') return rpcResult(message.id, { tools: 'no' })
      return undefined
    })
    expect(await listMcpServerTools(STDIO_SERVER, { spawnImpl })).toEqual({ ok: false, problem: MCP_TOOLS_PROBLEM })
  })

  it('posts JSON-RPC to an http server, sends the initialized notice and keeps the session id', async () => {
    const fetchImpl = httpMcpFetch()
    const answer = await listMcpServerTools(HTTP_SERVER, { fetchImpl })
    expect(answer).toEqual({ ok: true, tools: SAMPLE_TOOLS_CLEAN })
    expect(fetchImpl.requests.map((entry) => entry.message.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ])
    const init = fetchImpl.requests[0]
    expect(init.url).toBe(HTTP_SERVER.url)
    expect(init.init.method).toBe('POST')
    expect(init.init.headers['content-type']).toBe('application/json')
    expect(init.message.params).toEqual({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'machineroom', version: '1' },
    })
    expect(fetchImpl.requests[1].message.id).toBeUndefined()
    expect(fetchImpl.requests[1].init.headers['mcp-session-id']).toBe('session-1')
    expect(fetchImpl.requests[2].init.headers['mcp-session-id']).toBe('session-1')
    expect(fetchImpl.requests[2].message).toEqual({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  })

  it('reads an http answer sent as an event stream', async () => {
    const fetchImpl = fakeFetch((message) => {
      if (message.method === 'initialize') return jsonResponse(rpcResult(message.id, initResult()))
      if (message.method === 'notifications/initialized') return jsonResponse(null, { status: 202 })
      if (message.method === 'tools/list') {
        const data = JSON.stringify(rpcResult(message.id, { tools: SAMPLE_TOOLS }))
        return jsonResponse(null, {
          headers: { 'content-type': 'text/event-stream' },
          text: `: keepalive\n\nevent: message\ndata: ${data}\n\n`,
        })
      }
      return jsonResponse({}, { status: 500 })
    })
    expect(await listMcpServerTools(HTTP_SERVER, { fetchImpl })).toEqual({ ok: true, tools: SAMPLE_TOOLS_CLEAN })
  })

  it('reports an http error status and a JSON-RPC error', async () => {
    const refused = fakeFetch(() => jsonResponse({ error: 'no' }, { status: 500 }))
    expect(await listMcpServerTools(HTTP_SERVER, { fetchImpl: refused })).toEqual({
      ok: false,
      problem: `${MCP_HTTP_STATUS_PROBLEM} It answered 500.`,
    })
    const rpc = fakeFetch((message) => jsonResponse(rpcError(message.id, -32602, 'Bad params')))
    expect(await listMcpServerTools(HTTP_SERVER, { fetchImpl: rpc })).toEqual({
      ok: false,
      problem: `${MCP_RPC_PROBLEM} Bad params`,
    })
  })

  it('reports an http answer that is not JSON or never arrives', async () => {
    const notJson = fakeFetch(() => jsonResponse(null, { text: 'not json' }))
    expect(await listMcpServerTools(HTTP_SERVER, { fetchImpl: notJson })).toEqual({ ok: false, problem: MCP_JSON_PROBLEM })
    const offline = fakeFetch(() => {
      throw new Error('offline')
    })
    expect(await listMcpServerTools(HTTP_SERVER, { fetchImpl: offline })).toEqual({ ok: false, problem: MCP_HTTP_PROBLEM })
    const hanging = hangingFetch()
    expect(await listMcpServerTools(HTTP_SERVER, { fetchImpl: hanging, timeoutMs: 30 })).toEqual({
      ok: false,
      problem: MCP_TIMEOUT_PROBLEM,
    })
  })
})

describe('callMcpServerTool', () => {
  it('calls a tool on a stdio server', async () => {
    const spawnImpl = fakeSpawn(stdioResponder())
    const answer = await callMcpServerTool(STDIO_SERVER, 'echo', { text: 'hi' }, { spawnImpl })
    expect(answer).toEqual({ ok: true, result: DEFAULT_CALL_RESULT })
    const call = spawnImpl.calls[0]
    expect(call.written.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'hi' } },
    })
    expect(call.child.killed).toBe(true)
  })

  it('keeps a tool error result and uses an empty object for missing arguments', async () => {
    const callResult = { content: [{ type: 'text', text: 'nope' }], isError: true }
    const spawnImpl = fakeSpawn(stdioResponder({ callResult }))
    const answer = await callMcpServerTool(STDIO_SERVER, 'echo', null, { spawnImpl })
    expect(answer).toEqual({ ok: true, result: callResult })
    expect(spawnImpl.calls[0].written.at(-1).params).toEqual({ name: 'echo', arguments: {} })
  })

  it('calls a tool on an http server', async () => {
    const fetchImpl = httpMcpFetch({ callResult: { content: [{ type: 'text', text: 'web' }] } })
    const answer = await callMcpServerTool(HTTP_SERVER, 'search', { query: 'room' }, { fetchImpl })
    expect(answer).toEqual({ ok: true, result: { content: [{ type: 'text', text: 'web' }] } })
    expect(fetchImpl.requests.at(-1).message).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'room' } },
    })
  })

  it('refuses an empty tool name or arguments that are not an object', async () => {
    const spawnImpl = fakeSpawn(stdioResponder())
    expect(await callMcpServerTool(STDIO_SERVER, '  ', {}, { spawnImpl })).toEqual({ ok: false, problem: MCP_TOOL_PROBLEM })
    expect(await callMcpServerTool(STDIO_SERVER, 'echo', [1], { spawnImpl })).toEqual({
      ok: false,
      problem: MCP_TOOL_ARGS_PROBLEM,
    })
    expect(spawnImpl.calls).toHaveLength(0)
  })

  it('reports a tool call that times out', async () => {
    const spawnImpl = fakeSpawn(() => undefined)
    expect(await callMcpServerTool(STDIO_SERVER, 'echo', {}, { spawnImpl, timeoutMs: 30 })).toEqual({
      ok: false,
      problem: MCP_TIMEOUT_PROBLEM,
    })
  })
})

describe('listAllMcpTools and callMcpTool', () => {
  it('answers no tools when no server is saved', async () => {
    expect(await listAllMcpTools(useTempDir('mr-mcp-runs-'))).toEqual({ ok: true, tools: [], errors: [] })
  })

  it('queries every enabled server and tags each tool with its server', async () => {
    const runsDir = useTempDir('mr-mcp-runs-')
    writeMcpServers(runsDir, [
      { name: 'one', transport: 'http', url: 'http://127.0.0.1:1/one', enabled: true },
      { name: 'two', transport: 'http', url: 'http://127.0.0.1:1/two', enabled: true },
      { name: 'off', transport: 'http', url: 'http://127.0.0.1:1/off', enabled: false },
    ])
    const fetchImpl = fakeFetch((message, entry) => {
      if (message.method === 'initialize') return jsonResponse(rpcResult(message.id, initResult()))
      if (message.method === 'notifications/initialized') return jsonResponse(null, { status: 202 })
      const name = entry.url.endsWith('/one') ? 'alpha' : 'beta'
      if (message.method === 'tools/list') {
        return jsonResponse(rpcResult(message.id, { tools: [{ name, description: `${name} tool`, inputSchema: { type: 'object' } }] }))
      }
      return jsonResponse({}, { status: 500 })
    })
    const answer = await listAllMcpTools(runsDir, { fetchImpl })
    expect(answer).toEqual({
      ok: true,
      tools: [
        { server: 'one', name: 'alpha', description: 'alpha tool', inputSchema: { type: 'object' } },
        { server: 'two', name: 'beta', description: 'beta tool', inputSchema: { type: 'object' } },
      ],
      errors: [],
    })
    expect(fetchImpl.requests.some((entry) => entry.url.endsWith('/off'))).toBe(false)
  })

  it('keeps the tools of the servers that answer and lists the ones that fail', async () => {
    const runsDir = useTempDir('mr-mcp-runs-')
    writeMcpServers(runsDir, [
      { name: 'bad', transport: 'http', url: 'http://127.0.0.1:1/bad', enabled: true },
      { name: 'good', transport: 'http', url: 'http://127.0.0.1:1/good', enabled: true },
    ])
    const fetchImpl = fakeFetch((message, entry) => {
      if (entry.url.endsWith('/bad')) return jsonResponse({ error: 'no' }, { status: 500 })
      if (message.method === 'initialize') return jsonResponse(rpcResult(message.id, initResult()))
      if (message.method === 'notifications/initialized') return jsonResponse(null, { status: 202 })
      if (message.method === 'tools/list') {
        return jsonResponse(rpcResult(message.id, { tools: [{ name: 'good_tool', description: 'Works' }] }))
      }
      return jsonResponse({}, { status: 500 })
    })
    const answer = await listAllMcpTools(runsDir, { fetchImpl })
    expect(answer.ok).toBe(false)
    expect(answer.tools).toEqual([
      { server: 'good', name: 'good_tool', description: 'Works', inputSchema: { type: 'object', properties: {} } },
    ])
    expect(answer.errors).toEqual([{ server: 'bad', problem: `${MCP_HTTP_STATUS_PROBLEM} It answered 500.` }])
  })

  it('finds a server by name and calls its tool', async () => {
    const runsDir = useTempDir('mr-mcp-runs-')
    writeMcpServers(runsDir, [{ name: 'web', transport: 'http', url: 'http://127.0.0.1:1/mcp', enabled: true }])
    const fetchImpl = httpMcpFetch()
    const answer = await callMcpTool(
      runsDir,
      { server: 'web', tool: 'read_file', arguments: { path: 'README.md' } },
      { fetchImpl }
    )
    expect(answer).toEqual({ ok: true, result: DEFAULT_CALL_RESULT })
    expect(fetchImpl.requests.at(-1).message.params).toEqual({
      name: 'read_file',
      arguments: { path: 'README.md' },
    })
  })

  it('refuses a missing server, a turned-off server, a missing tool and bad arguments', async () => {
    const runsDir = useTempDir('mr-mcp-runs-')
    writeMcpServers(runsDir, [
      { name: 'off', transport: 'http', url: 'http://127.0.0.1:1/mcp', enabled: false },
      { name: 'on', transport: 'http', url: 'http://127.0.0.1:1/mcp', enabled: true },
    ])
    expect(await callMcpTool(runsDir, { server: '', tool: 'x' })).toEqual({ ok: false, problem: MCP_SERVER_PROBLEM })
    expect(await callMcpTool(runsDir, { server: 'gone', tool: 'x' })).toEqual({ ok: false, problem: MCP_NOT_FOUND_PROBLEM })
    expect(await callMcpTool(runsDir, { server: 'off', tool: 'x' })).toEqual({ ok: false, problem: MCP_OFF_PROBLEM })
    expect(await callMcpTool(runsDir, { server: 'on', tool: ' ' })).toEqual({ ok: false, problem: MCP_TOOL_PROBLEM })
  })

  it('refuses tool arguments that are an array', async () => {
    const runsDir = useTempDir('mr-mcp-runs-')
    writeMcpServers(runsDir, [{ name: 'web', transport: 'http', url: 'http://127.0.0.1:1/mcp', enabled: true }])
    expect(await callMcpTool(runsDir, { server: 'web', tool: 'read', arguments: [1] })).toEqual({
      ok: false,
      problem: MCP_TOOL_ARGS_PROBLEM,
    })
  })

  it('uses the documented default timeouts', () => {
    expect(MCP_LIST_TIMEOUT_MS).toBe(8000)
    expect(MCP_CALL_TIMEOUT_MS).toBe(15000)
  })
})

describe('/api/mcp routes', () => {
  it('answers an empty server list', async () => {
    const { url } = await startMcpBridge()
    const answer = await pageGet(url, '/api/mcp/servers')
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ ok: true, servers: [] })
  })

  it('refuses every MCP route with no Origin', async () => {
    const { url, runsDir } = await startMcpBridge()
    writeMcpServers(runsDir, [{ name: 'web', transport: 'http', url: 'http://127.0.0.1:1/mcp', enabled: true }])
    const asks = [
      { method: 'GET', path: '/api/mcp/servers' },
      { method: 'POST', path: '/api/mcp/servers', body: { confirmed: true } },
      { method: 'POST', path: '/api/mcp/servers/web/delete', body: { confirmed: true } },
      { method: 'GET', path: '/api/mcp/tools' },
      { method: 'POST', path: '/api/mcp/call', body: { confirmed: true } },
    ]
    for (const ask of asks) {
      const res = await getJson(`${url}${ask.path}`, {
        method: ask.method,
        headers: { 'content-type': 'application/json' },
        body: ask.body ? JSON.stringify(ask.body) : undefined,
      })
      expect(res.status, `${ask.method} ${ask.path}`).toBe(403)
      expect(res.body).toEqual({ error: OWNER_MCP_PROBLEM })
    }
    expect(readMcpServers(runsDir)).toHaveLength(1)
  })

  it('takes a same-origin page GET with no Origin header', async () => {
    const { url } = await startMcpBridge()
    for (const path of ['/api/mcp/servers', '/api/mcp/tools']) {
      const answer = await getJson(`${url}${path}`, { headers: { 'sec-fetch-site': 'same-origin' } })
      expect(answer.status, path).toBe(200)
    }
    const servers = await getJson(`${url}/api/mcp/servers`, { headers: { 'sec-fetch-site': 'same-origin' } })
    expect(servers.body).toEqual({ ok: true, servers: [] })
  })

  it('refuses a tool call without the owner confirm', async () => {
    const { url } = await startMcpBridge()
    const res = await pagePost(url, '/api/mcp/call', { server: 'local', tool: 'echo' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: MCP_CALL_CONFIRM_PROBLEM })
  })

  it('refuses a save without confirmation and saves a valid server with it', async () => {
    const { url, runsDir } = await startMcpBridge()
    const unconfirmed = await pagePost(url, '/api/mcp/servers', {
      name: 'files',
      transport: 'stdio',
      command: 'node',
      enabled: true,
    })
    expect(unconfirmed.status).toBe(400)
    expect(unconfirmed.body.error).toBe(MCP_SAVE_CONFIRM_PROBLEM)
    expect(readMcpServers(runsDir)).toEqual([])

    const saved = await pagePost(url, '/api/mcp/servers', {
      name: 'files',
      transport: 'stdio',
      command: 'node',
      args: ['server.mjs'],
      env: { ROOM: 'one' },
      enabled: true,
      confirmed: true,
    })
    expect(saved.status).toBe(200)
    expect(saved.body.ok).toBe(true)
    expect(saved.body.server).toEqual({
      name: 'files',
      transport: 'stdio',
      command: 'node',
      args: ['server.mjs'],
      env: { ROOM: 'one' },
      url: '',
      enabled: true,
    })
    expect(saved.body.servers).toEqual([saved.body.server])
    expect(readMcpServers(runsDir)).toEqual([saved.body.server])
    const listed = await pageGet(url, '/api/mcp/servers')
    expect(listed.body).toEqual({ ok: true, servers: [saved.body.server] })
  })

  it('refuses an invalid server and keeps the saved list', async () => {
    const { url, runsDir } = await startMcpBridge()
    const refused = await pagePost(url, '/api/mcp/servers', {
      name: 'bad name',
      transport: 'stdio',
      command: 'node',
      confirmed: true,
    })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toBe(MCP_NAME_PROBLEM)
    const noCommand = await pagePost(url, '/api/mcp/servers', {
      name: 'files',
      transport: 'stdio',
      command: ' ',
      confirmed: true,
    })
    expect(noCommand.status).toBe(400)
    expect(noCommand.body.error).toBe(MCP_COMMAND_PROBLEM)
    const badUrl = await pagePost(url, '/api/mcp/servers', {
      name: 'files',
      transport: 'http',
      url: 'ftp://example.com/mcp',
      confirmed: true,
    })
    expect(badUrl.status).toBe(400)
    expect(badUrl.body.error).toBe(MCP_URL_PROBLEM)
    expect(readMcpServers(runsDir)).toEqual([])
  })

  it('replaces a server by name and keeps one copy', async () => {
    const { url, runsDir } = await startMcpBridge()
    await pagePost(url, '/api/mcp/servers', {
      name: 'files',
      transport: 'stdio',
      command: 'node',
      enabled: true,
      confirmed: true,
    })
    const changed = await pagePost(url, '/api/mcp/servers', {
      name: 'files',
      transport: 'stdio',
      command: 'node',
      enabled: false,
      confirmed: true,
    })
    expect(changed.status).toBe(200)
    expect(changed.body.servers).toHaveLength(1)
    expect(changed.body.servers[0].enabled).toBe(false)
    expect(readMcpServers(runsDir)).toHaveLength(1)
  })

  it('deletes a server behind a confirmation and answers 404 for one that is gone', async () => {
    const { url, runsDir } = await startMcpBridge()
    await pagePost(url, '/api/mcp/servers', {
      name: 'files',
      transport: 'stdio',
      command: 'node',
      confirmed: true,
    })
    const unconfirmed = await pagePost(url, '/api/mcp/servers/files/delete', {})
    expect(unconfirmed.status).toBe(400)
    expect(unconfirmed.body.error).toBe(MCP_DELETE_CONFIRM_PROBLEM)
    const missing = await pagePost(url, '/api/mcp/servers/gone/delete', { confirmed: true })
    expect(missing.status).toBe(404)
    expect(missing.body.error).toBe(MCP_NOT_FOUND_PROBLEM)
    const deleted = await pagePost(url, '/api/mcp/servers/files/delete', { confirmed: true })
    expect(deleted.status).toBe(200)
    expect(deleted.body).toEqual({ ok: true, deleted: 'files', servers: [] })
    expect(readMcpServers(runsDir)).toEqual([])
    expect((await pageGet(url, '/api/mcp/servers')).body.servers).toEqual([])
  })

  it('answers no tools when nothing is saved and uses 405 for another method', async () => {
    const { url } = await startMcpBridge()
    const tools = await pageGet(url, '/api/mcp/tools')
    expect(tools.status).toBe(200)
    expect(tools.body).toEqual({ ok: true, tools: [], errors: [] })
    const wrong = await pagePost(url, '/api/mcp/tools', {})
    expect(wrong.status).toBe(405)
    const callWrong = await pageGet(url, '/api/mcp/call')
    expect(callWrong.status).toBe(405)
  })

  it('lists and calls tools on a saved http server', async () => {
    const { url, runsDir } = await startMcpBridge()
    const mcpUrl = await startLocalMcpServer()
    const saved = await pagePost(url, '/api/mcp/servers', {
      name: 'local',
      transport: 'http',
      url: mcpUrl,
      enabled: true,
      confirmed: true,
    })
    expect(saved.status).toBe(200)

    const tools = await pageGet(url, '/api/mcp/tools')
    expect(tools.status).toBe(200)
    expect(tools.body).toEqual({
      ok: true,
      tools: SAMPLE_TOOLS_CLEAN.map((tool) => ({ server: 'local', ...tool })),
      errors: [],
    })

    const called = await pagePost(url, '/api/mcp/call', {
      server: 'local',
      tool: 'echo',
      arguments: { text: 'hello bridge' },
      confirmed: true,
    })
    expect(called.status).toBe(200)
    expect(called.body).toEqual({
      ok: true,
      result: { content: [{ type: 'text', text: 'hello bridge' }] },
      problem: null,
    })
    expect(readMcpServers(runsDir)).toHaveLength(1)
  })

  it('lists and calls tools on a saved stdio server', async () => {
    const { url } = await startMcpBridge()
    const saved = await pagePost(url, '/api/mcp/servers', {
      name: 'real',
      transport: 'stdio',
      command: process.execPath,
      args: ['-e', REAL_SERVER_SCRIPT],
      enabled: true,
      confirmed: true,
    })
    expect(saved.status).toBe(200)
    const tools = await pageGet(url, '/api/mcp/tools')
    expect(tools.body.ok).toBe(true)
    expect(tools.body.tools.map((tool) => tool.name)).toEqual(['echo'])
    expect(tools.body.errors).toEqual([])
    const called = await pagePost(url, '/api/mcp/call', {
      server: 'real',
      tool: 'echo',
      arguments: { text: 'stdio room' },
      confirmed: true,
    })
    expect(called.body).toEqual({
      ok: true,
      result: { content: [{ type: 'text', text: 'stdio room' }] },
      problem: null,
    })
  })

  it('answers a call to a missing server or with bad arguments as a problem', async () => {
    const { url } = await startMcpBridge()
    const missing = await pagePost(url, '/api/mcp/call', { server: 'gone', tool: 'echo', confirmed: true })
    expect(missing.status).toBe(200)
    expect(missing.body).toEqual({ ok: false, result: null, problem: MCP_NOT_FOUND_PROBLEM })
    await pagePost(url, '/api/mcp/servers', {
      name: 'local',
      transport: 'http',
      url: 'http://127.0.0.1:1/mcp',
      enabled: true,
      confirmed: true,
    })
    const badArgs = await pagePost(url, '/api/mcp/call', { server: 'local', tool: 'echo', arguments: [1], confirmed: true })
    expect(badArgs.body).toEqual({ ok: false, result: null, problem: MCP_TOOL_ARGS_PROBLEM })
  })

  it('leaves a turned-off server out of the tool list', async () => {
    const { url, runsDir } = await startMcpBridge()
    writeMcpServers(runsDir, [{ name: 'off', transport: 'http', url: 'http://127.0.0.1:1/mcp', enabled: false }])
    const tools = await pageGet(url, '/api/mcp/tools')
    expect(tools.body).toEqual({ ok: true, tools: [], errors: [] })
  })
})
