import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createClaudeParser } from '../src/model/parsers/claude.js'
import { createOpencodeParser } from '../src/model/parsers/opencode.js'
import {
  callMcpTool,
  enabledMcpServers,
  listAllMcpTools,
  mcpResultText,
  mcpRunsDir,
  mcpServersForAcp,
} from '../scripts/mcp-bridge.mjs'
import { killTree } from '../server/processTree.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'
import { testContext } from './helpers.js'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const AGENT = join(ROOT, 'scripts', 'mr-agent.mjs')
const ACP = join(ROOT, 'scripts', 'acp-run.mjs')
const cleanups = []
const servers = []

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()
    server.closeAllConnections?.()
    await new Promise((done) => server.close(() => done()))
  }
  while (cleanups.length > 0) {
    await cleanups.pop()()
  }
})

function tempDir(prefix = 'mcp-') {
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

function writeConfig(runs, serversList) {
  writeFileSync(join(runs, 'mcp.json'), JSON.stringify({ servers: serversList }), 'utf8')
}

const STDIO_SERVER = `import { createInterface } from 'node:readline'
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } }) + '\\n')
    return
  }
  if (message.method === 'notifications/initialized') return
  if (message.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [
      { name: 'read_file', description: 'Read one file.', inputSchema: { type: 'object' } },
      { name: 'write_file', description: 'Write one file.', inputSchema: { type: 'object' } },
    ] } }) + '\\n')
    return
  }
  if (message.method === 'tools/call') {
    const args = message.params?.arguments ?? {}
    const path = String(args.path ?? args.file ?? '')
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'fake ' + message.params?.name + ' ' + path + ' env ' + String(process.env.MCP_TEST ?? 'none') }] } }) + '\\n')
  }
})
`

function stdioServer(runs) {
  const folder = tempDir('mcp-stdio-')
  const file = join(folder, 'server.mjs')
  writeFileSync(file, STDIO_SERVER, 'utf8')
  writeConfig(runs, [
    { name: 'files', transport: 'stdio', command: process.execPath, args: [file], env: { MCP_TEST: 'yes' }, enabled: true },
  ])
  return { file, folder }
}

function httpMcpServer() {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      const message = JSON.parse(body)
      if (message.id === undefined) {
        res.writeHead(202)
        res.end()
        return
      }
      let result
      if (message.method === 'initialize') {
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake-http', version: '1' } }
      } else if (message.method === 'tools/list') {
        result = { tools: [{ name: 'search', description: 'Search notes.', inputSchema: { type: 'object' } }] }
      } else if (message.method === 'tools/call') {
        result = { content: [{ type: 'text', text: `http ${message.params?.name} ${message.params?.arguments?.query ?? ''}` }] }
      } else {
        result = {}
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
    })
  })
  servers.push(server)
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      done({ url: `http://127.0.0.1:${server.address().port}/mcp`, server })
    })
  })
}

function runProcess(file, args, options = {}) {
  return new Promise((done, fail) => {
    const child = spawn(file, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? baseEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      killTree(child)
      fail(new Error(`The process did not exit. stderr: ${stderr}`))
    }, (options.seconds ?? 40) * 1000)
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

function chatAnswer({ text = '', calls = [] } = {}) {
  const message = { role: 'assistant', content: text === '' ? null : text }
  if (calls.length > 0) {
    message.tool_calls = calls.map((call, index) => ({
      id: call.id ?? `call_${index}`,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
    }))
  }
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    choices: [{ index: 0, message, finish_reason: calls.length > 0 ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }
}

describe('the MCP bridge', () => {
  it('reads both runs folder names and skips a disabled server', () => {
    const one = tempDir('mcp-runs-one-')
    const two = tempDir('mcp-runs-two-')
    expect(mcpRunsDir({ MACHINEROOM_RUNS_DIR: one, MACHINEROOM_RUNS: two })).toBe(one)
    expect(mcpRunsDir({ MACHINEROOM_RUNS: two })).toBe(two)
    const runs = tempDir('mcp-runs-')
    writeConfig(runs, [
      { name: 'on', transport: 'stdio', command: 'node', args: ['a'], env: { A: '1' }, enabled: true },
      { name: 'off', transport: 'stdio', command: 'node', args: [], enabled: false },
    ])
    expect(enabledMcpServers(runs).map((entry) => entry.name)).toEqual(['on'])
  })

  it('lists and calls tools on a stdio server that really starts', async () => {
    const runs = tempDir('mcp-runs-')
    stdioServer(runs)
    const listed = await listAllMcpTools(runs)
    expect(listed.ok).toBe(true)
    expect(listed.errors).toEqual([])
    expect(listed.tools.map((tool) => `${tool.server}:${tool.name}`)).toEqual(['files:read_file', 'files:write_file'])

    const called = await callMcpTool(runs, { server: 'files', tool: 'read_file', arguments: { path: 'src/a.js' } })
    expect(called.ok).toBe(true)
    expect(called.problem).toBe('')
    expect(mcpResultText(called.result)).toBe('fake read_file src/a.js env yes')
  })

  it('lists and calls tools on an http server', async () => {
    const runs = tempDir('mcp-runs-')
    const remote = await httpMcpServer()
    writeConfig(runs, [{ name: 'notes', transport: 'http', url: remote.url, enabled: true }])
    const listed = await listAllMcpTools(runs)
    expect(listed.tools.map((tool) => `${tool.server}:${tool.name}`)).toEqual(['notes:search'])
    expect(listed.tools[0].description).toBe('Search notes.')
    const called = await callMcpTool(runs, { server: 'notes', tool: 'search', arguments: { query: 'room' } })
    expect(called.ok).toBe(true)
    expect(mcpResultText(called.result)).toBe('http search room')
  })

  it('answers one error for a server that is not configured', async () => {
    const runs = tempDir('mcp-runs-')
    writeConfig(runs, [])
    expect(await listAllMcpTools(runs)).toEqual({ ok: true, tools: [], errors: [] })
    const missing = await listAllMcpTools(runs, { server: 'gone' })
    expect(missing.ok).toBe(false)
    expect(missing.errors[0].error).toBe('The MCP server gone is not configured.')
    const called = await callMcpTool(runs, { server: 'gone', tool: 'x' })
    expect(called).toEqual({ ok: false, result: null, problem: 'The MCP server gone is not configured.' })
  })

  it('shapes stdio and http servers for session/new', () => {
    const runs = tempDir('mcp-runs-')
    writeConfig(runs, [
      { name: 'files', transport: 'stdio', command: 'node', args: ['server.mjs'], env: { MCP_TEST: 'yes' }, enabled: true },
      { name: 'notes', transport: 'http', url: 'http://127.0.0.1:9/mcp', enabled: true },
      { name: 'off', transport: 'http', url: 'http://127.0.0.1:9/off', enabled: false },
    ])
    expect(mcpServersForAcp(runs)).toEqual([
      { name: 'files', command: 'node', args: ['server.mjs'], env: { MCP_TEST: 'yes' } },
      { name: 'notes', type: 'http', url: 'http://127.0.0.1:9/mcp' },
    ])
  })
})

describe('mr-agent MCP tools', () => {
  it('lists and calls a configured server and writes the call with its path', async () => {
    const project = tempDir('mcp-project-')
    const runs = tempDir('mcp-runs-')
    stdioServer(runs)
    const calls = []
    const api = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        const parsed = JSON.parse(body)
        calls.push(parsed)
        const index = calls.length - 1
        let answer
        if (index === 0) {
          answer = chatAnswer({ calls: [{ id: 'call_list', name: 'mcp_list_tools', arguments: { server: 'files' } }] })
        } else if (index === 1) {
          answer = chatAnswer({ calls: [{ id: 'call_read', name: 'mcp_call_tool', arguments: { server: 'files', tool: 'read_file', arguments: { file: 'src/a.js' } } }] })
        } else {
          answer = chatAnswer({ text: 'Done.' })
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(answer))
      })
    })
    servers.push(api)
    await new Promise((done) => api.listen(0, '127.0.0.1', done))
    const result = await runProcess(process.execPath, [AGENT, '--model', 'test/model', '--cwd', project, 'Do the task.'], {
      env: {
        ...baseEnvironment(),
        MACHINEROOM_API_KEY: 'test-key',
        MACHINEROOM_API_URL: `http://127.0.0.1:${api.address().port}/v1`,
        MACHINEROOM_RUNS: runs,
      },
    })
    expect(result.code, result.stderr).toBe(0)
    expect(calls[0].tools.map((tool) => tool.function.name)).toEqual([
      'read_file',
      'write_file',
      'edit_file',
      'list_dir',
      'search',
      'glob_files',
      'run_shell',
      'web_search',
      'web_fetch',
      'mcp_list_tools',
      'mcp_call_tool',
    ])
    const lines = jsonLines(result.stdout)
    const assistantTools = lines
      .filter((line) => line.type === 'assistant')
      .flatMap((line) => line.message.content.filter((item) => item.type === 'tool_use'))
    expect(assistantTools.map((item) => item.name)).toEqual(['mcp_list_tools', 'mcp_call_tool'])
    expect(assistantTools[0].input).toEqual({ server: 'files' })
    expect(assistantTools[1].input).toMatchObject({ server: 'files', tool: 'read_file', path: 'src/a.js' })
    const results = lines.filter((line) => line.type === 'user').map((line) => line.message.content[0])
    expect(results[0].content).toContain('files: read_file - Read one file.')
    expect(results[1].content).toBe('fake read_file src/a.js env yes')
    expect(results[1].is_error).toBe(false)
    expect(lines.at(-1)).toMatchObject({ type: 'result', is_error: false, result: 'Done.' })
  })

})

describe('acp-run MCP servers', () => {
  it('sends the enabled servers in session/new', async () => {
    const folder = tempDir('mcp-acp-')
    const runs = tempDir('mcp-runs-')
    const record = join(folder, 'session-new.json')
    const agent = join(folder, 'agent.mjs')
    writeFileSync(
      agent,
      `import { createInterface } from 'node:readline'
import { writeFileSync } from 'node:fs'
const record = process.argv[2]
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  const answer = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
  if (message.method === 'initialize') answer({ protocolVersion: 1, agentCapabilities: {} })
  else if (message.method === 'session/new') {
    writeFileSync(record, JSON.stringify(message.params))
    answer({ sessionId: 'ses_mcp' })
  } else if (message.method === 'session/prompt') answer({ stopReason: 'end_turn' })
})
`,
      'utf8',
    )
    writeConfig(runs, [
      { name: 'files', transport: 'stdio', command: process.execPath, args: [agent], env: { MCP_TEST: 'yes' }, enabled: true },
      { name: 'notes', transport: 'http', url: 'http://127.0.0.1:9/mcp', enabled: true },
      { name: 'off', transport: 'stdio', command: process.execPath, args: [agent], enabled: false },
    ])
    const result = await runProcess(
      process.execPath,
      [ACP, '--file', process.execPath, '--arg', agent, '--arg', record, '--cwd', folder, '--prompt', 'Do it.', '--seconds', '20'],
      { cwd: folder, env: { ...baseEnvironment(), MACHINEROOM_RUNS: runs } },
    )
    expect(result.code, result.stderr).toBe(0)
    const params = JSON.parse(readFileSync(record, 'utf8'))
    expect(params.mcpServers).toEqual([
      { name: 'files', command: process.execPath, args: [agent], env: { MCP_TEST: 'yes' } },
      { name: 'notes', type: 'http', url: 'http://127.0.0.1:9/mcp' },
    ])
  })
})

const ctx = testContext()
const lines = (...items) => items.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n') + '\n'

describe('Claude MCP tool calls', () => {
  it('reads mcp__ path and file arguments as a read touch', () => {
    const parser = createClaudeParser(ctx)
    const out = parser.push(
      lines(
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'm1', name: 'mcp__files__read_file', input: { path: 'src\\math.js' } }] } },
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'm1', content: 'x', is_error: false }] } },
      ),
      1000,
    )
    const start = out.find((activity) => activity.type === 'tool.start')
    expect(start).toMatchObject({ tool: 'mcp', label: 'mcp files read_file src/math.js' })
    expect(start.touches).toEqual([{ path: 'src/math.js', mode: 'read', kind: 'file' }])
    expect(out.find((activity) => activity.type === 'tool.end')).toMatchObject({ id: 'm1', ok: true })
  })

  it('reads mcp_call_tool and mcp_list_tools', () => {
    const parser = createClaudeParser(ctx)
    const out = parser.push(
      lines(
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'm2', name: 'mcp_call_tool', input: { server: 'files', tool: 'write_file', arguments: { file: 'docs/notes.md' } } }] } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'm3', name: 'mcp_list_tools', input: { server: 'files' } }] } },
      ),
      1000,
    )
    const starts = out.filter((activity) => activity.type === 'tool.start')
    expect(starts[0]).toMatchObject({ tool: 'mcp', label: 'mcp files write_file docs/notes.md' })
    expect(starts[0].touches).toEqual([{ path: 'docs/notes.md', mode: 'read', kind: 'file' }])
    expect(starts[1]).toMatchObject({ tool: 'mcp', label: 'mcp list tools files', touches: [] })
  })

  it('names an acpx MCP call without a path', () => {
    const parser = createClaudeParser(ctx)
    const out = parser.push(lines({ type: 'acpx.tool_call', name: 'mcp__files__read_file', toolCallId: 'm4', tag: 'tool_call_update' }), 1000)
    expect(out[0]).toMatchObject({ type: 'tool.start', tool: 'mcp', label: 'mcp files read_file', touches: [] })
  })
})

describe('OpenCode MCP tool calls', () => {
  it('reads mcp__ path arguments as a read touch', () => {
    const parser = createOpencodeParser(ctx)
    const out = parser.push(
      lines({ type: 'tool_use', part: { id: 'p1', tool: 'mcp__files__read_file', state: { status: 'completed', input: { path: 'src/math.js' }, output: 'x' } } }),
      9000,
    )
    expect(out[0]).toMatchObject({ type: 'tool.start', tool: 'mcp', label: 'mcp files read_file src/math.js' })
    expect(out[0].touches).toEqual([{ path: 'src/math.js', mode: 'read', kind: 'file' }])
    expect(out[1]).toMatchObject({ type: 'tool.end', ok: true })
  })

  it('reads mcp_call_tool and mcp_list_tools', () => {
    const parser = createOpencodeParser(ctx)
    const out = parser.push(
      lines(
        { type: 'tool_use', part: { id: 'p2', tool: 'mcp_call_tool', state: { status: 'completed', input: { server: 'files', tool: 'write_file', arguments: { file: 'docs/notes.md' } } } } },
        { type: 'tool_use', part: { id: 'p3', tool: 'mcp_list_tools', state: { status: 'completed', input: { server: 'files' } } } },
      ),
      9000,
    )
    const starts = out.filter((activity) => activity.type === 'tool.start')
    expect(starts[0]).toMatchObject({ tool: 'mcp', label: 'mcp files write_file docs/notes.md' })
    expect(starts[0].touches).toEqual([{ path: 'docs/notes.md', mode: 'read', kind: 'file' }])
    expect(starts[1]).toMatchObject({ tool: 'mcp', label: 'mcp list tools files', touches: [] })
  })
})
