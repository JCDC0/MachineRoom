import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { summarizeRun } from '../src/briefs/run.js'
import { createRunLineReader } from '../src/briefs/recording.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { killTree } from '../server/processTree.js'
import { gitPath } from '../server/programPath.js'
import { shellFor } from '../scripts/mr-agent.mjs'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const SCRIPT = fileURLToPath(new URL('../scripts/mr-agent.mjs', import.meta.url))
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()()
  }
})

function tempDir(prefix = 'mr-agent-') {
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

function chatAnswer({ text = '', calls = [], usage = null } = {}) {
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
    usage: usage ?? { prompt_tokens: 0, completion_tokens: 0 },
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
        const headers = { 'content-type': 'application/json', ...(answer?.headers ?? {}) }
        res.writeHead(status, headers)
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

function startApprovalBridge(handler) {
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', async () => {
      const parsed = body === '' ? null : JSON.parse(body)
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: parsed })
      const answer = await handler(parsed)
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

function runAgent({ folder, api = null, env = {}, model = 'test/model', endpoint = '', prompt = 'Do the task.', seconds = 40, reasoning = '' }) {
  return new Promise((done, fail) => {
    const childEnv = { ...baseEnvironment(), ...env }
    if (api) {
      childEnv.MACHINEROOM_API_URL = api.url
      childEnv.MACHINEROOM_API_KEY = 'test-key'
    }
    const args = [SCRIPT, '--model', model, '--cwd', folder]
    if (reasoning) args.push('--reasoning', reasoning)
    if (endpoint) args.push('--endpoint', endpoint)
    args.push(prompt)
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

async function runCalls({ folder, calls, env = {} }) {
  const api = await startFakeApi((_body, index) =>
    index < calls.length ? chatAnswer({ calls: [calls[index]] }) : chatAnswer({ text: 'Done.' }),
  )
  const result = await runAgent({ folder, api, env })
  const users = jsonLines(result.stdout)
    .filter((line) => line.type === 'user')
    .map((line) => line.message.content[0])
  return { api, result, users }
}

describe('mr-agent', () => {
  it('runs the file and shell tools and prints stream-json lines', async () => {
    const folder = tempDir()
    writeFileSync(join(folder, 'a.txt'), 'hello\n')
    const api = await startFakeApi((_body, index) => {
      if (index === 0) {
        return chatAnswer({
          text: 'Working.',
          usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0005 },
          calls: [
            { id: 'call_read', name: 'read_file', arguments: { path: 'a.txt' } },
            { id: 'call_write', name: 'write_file', arguments: { path: 'out/b.txt', content: 'made\n' } },
            { id: 'call_edit', name: 'edit_file', arguments: { path: 'a.txt', old_string: 'hello', new_string: 'goodbye' } },
            { id: 'call_outside', name: 'read_file', arguments: { path: '../outside.txt' } },
            { id: 'call_shell', name: 'run_shell', arguments: { command: 'echo shell-ok' } },
            { id: 'call_list', name: 'list_dir', arguments: { path: '.' } },
            { id: 'call_search', name: 'search', arguments: { pattern: 'goodbye', path: '.' } },
          ],
        })
      }
      return chatAnswer({ text: 'All done.', usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 } })
    })

    const result = await runAgent({ folder, api })
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('goodbye\n')
    expect(readFileSync(join(folder, 'out', 'b.txt'), 'utf8')).toBe('made\n')

    const lines = jsonLines(result.stdout)
    const assistants = lines.filter((line) => line.type === 'assistant')
    expect(assistants).toHaveLength(2)
    expect(assistants[0].message.content[0]).toEqual({ type: 'text', text: 'Working.' })
    expect(assistants[0].message.usage).toEqual({ input_tokens: 10, output_tokens: 5 })
    const tools = assistants[0].message.content.filter((item) => item.type === 'tool_use')
    expect(tools.map((item) => item.name)).toEqual(['Read', 'Write', 'Edit', 'Read', 'Bash', 'LS', 'Grep'])
    expect(tools[0].input).toEqual({ file_path: 'a.txt' })
    expect(tools[1].input).toMatchObject({ file_path: 'out/b.txt', content: 'made\n' })
    expect(tools[2].input).toMatchObject({ file_path: 'a.txt', old_string: 'hello', new_string: 'goodbye' })
    expect(tools[4].input).toEqual({ command: 'echo shell-ok' })
    expect(tools[5].input).toEqual({ path: '.' })
    expect(tools[6].input).toEqual({ pattern: 'goodbye', path: '.' })
    expect(assistants[1].message.content).toEqual([{ type: 'text', text: 'All done.' }])
    expect(assistants[1].message.usage).toEqual({ input_tokens: 100, output_tokens: 20 })

    const users = lines.filter((line) => line.type === 'user').map((line) => line.message.content[0])
    expect(users).toHaveLength(7)
    expect(users[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'call_read', is_error: false })
    expect(users[0].content).toBe('1\thello')
    expect(users[1].is_error).toBe(false)
    expect(users[2].is_error).toBe(false)
    expect(users[3]).toMatchObject({ type: 'tool_result', tool_use_id: 'call_outside', is_error: true })
    expect(users[3].content).toContain('outside the working folder')
    expect(users[4].content).toContain('shell-ok')
    expect(users[4].is_error).toBe(false)
    expect(users[5].content).toContain('out/')
    expect(users[6].content).toContain('a.txt:1: goodbye')

    const final = lines.at(-1)
    expect(final).toMatchObject({
      type: 'result',
      is_error: false,
      result: 'All done.',
      usage: { input_tokens: 110, output_tokens: 25 },
    })
    expect(final.total_cost_usd).toBeCloseTo(0.0015)
    expect(result.stdout).not.toContain('test-key')
    expect(result.stderr).not.toContain('test-key')

    expect(api.calls).toHaveLength(2)
    expect(api.calls[0].headers.authorization).toBe('Bearer test-key')
    expect(api.calls[0].body.model).toBe('test/model')
    expect(api.calls[0].body.max_tokens).toBe(32000)
    expect(api.calls[0].body.reasoning).toBeUndefined()
    expect(api.calls[0].body.messages.at(-1)).toEqual({ role: 'user', content: 'Do the task.' })
    expect(api.calls[0].body.tools.map((tool) => tool.function.name)).toEqual([
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
    expect(api.calls[1].body.messages.some((message) => message.role === 'tool' && message.tool_call_id === 'call_read')).toBe(true)
  })

  it('writes the project instructions and the shell into the system prompt', async () => {
    const folder = tempDir()
    writeFileSync(join(folder, 'AGENTS.md'), 'Use tabs. Run the tests.\n')
    writeFileSync(join(folder, 'CLAUDE.md'), 'This file loses.\n')
    const api = await startFakeApi(() => chatAnswer({ text: 'Done.' }))
    const result = await runAgent({ folder, api })
    expect(result.code).toBe(0)
    const system = api.calls[0].body.messages[0]
    expect(system.role).toBe('system')
    expect(system.content).toContain(`working folder ${folder}`)
    expect(system.content).toContain('Project instructions from AGENTS.md:')
    expect(system.content).toContain('Use tabs. Run the tests.')
    expect(system.content).not.toContain('This file loses.')
    expect(system.content).toContain(shellFor('').file)
    expect(system.content).toMatch(/Today is \d{4}-\d{2}-\d{2}\./)
  })

  it('falls back to CLAUDE.md and cuts the instructions at 20000 characters', async () => {
    const folder = tempDir()
    writeFileSync(join(folder, 'CLAUDE.md'), 'x'.repeat(25000))
    const api = await startFakeApi(() => chatAnswer({ text: 'Done.' }))
    const result = await runAgent({ folder, api })
    expect(result.code).toBe(0)
    const system = api.calls[0].body.messages[0].content
    expect(system).toContain('Project instructions from CLAUDE.md:')
    expect(system.endsWith('x'.repeat(20000))).toBe(true)
    expect(system).not.toContain('x'.repeat(20001))
  })

  it('tries a 429 answer again and finishes', async () => {
    const folder = tempDir()
    const api = await startFakeApi((_body, index) =>
      index === 0
        ? { status: 429, headers: { 'retry-after': '0' }, body: { error: 'slow down' } }
        : chatAnswer({ text: 'Done.' }),
    )
    const result = await runAgent({ folder, api })
    expect(result.code).toBe(0)
    expect(api.calls).toHaveLength(2)
    expect(jsonLines(result.stdout).at(-1)).toMatchObject({ type: 'result', is_error: false, result: 'Done.' })
  })

  it('does not try a 401 answer again and masks the key', async () => {
    const folder = tempDir()
    const api = await startFakeApi(() => ({ status: 401, body: { error: 'The key test-key is not allowed.' } }))
    const result = await runAgent({ folder, api })
    expect(result.code).toBe(1)
    expect(api.calls).toHaveLength(1)
    const final = jsonLines(result.stdout).at(-1)
    expect(final.is_error).toBe(true)
    expect(final.result).toContain('401')
    expect(final.result).not.toContain('test-key')
  })

  it('passes the reasoning effort and the token limit to the API', async () => {
    const folder = tempDir()
    const api = await startFakeApi(() => chatAnswer({ text: 'Done.' }))
    const result = await runAgent({ folder, api, reasoning: 'high' })
    expect(result.code).toBe(0)
    expect(api.calls[0].body.reasoning).toEqual({ effort: 'high' })
    expect(api.calls[0].body.max_tokens).toBe(32000)
  })

  it('offers only the tools each permission mode allows', async () => {
    const folder = tempDir()
    const cases = [
      ['plan', ['read_file', 'list_dir', 'search', 'glob_files', 'web_search', 'web_fetch', 'mcp_list_tools']],
      ['edits', ['read_file', 'write_file', 'edit_file', 'list_dir', 'search', 'glob_files', 'web_search', 'web_fetch', 'mcp_list_tools']],
      ['ask', null],
      ['auto', null],
      ['bypass', null],
    ]
    for (const [mode, names] of cases) {
      const api = await startFakeApi(() => chatAnswer({ text: 'Done.' }))
      const result = await runAgent({ folder, api, env: { MACHINEROOM_PERMISSION_MODE: mode } })
      expect(result.code, mode).toBe(0)
      const offered = api.calls[0].body.tools.map((tool) => tool.function.name)
      if (names) expect(offered, mode).toEqual(names)
      else expect(offered, mode).toHaveLength(11)
    }
  })

  it('refuses a tool the permission mode does not offer', async () => {
    const folder = tempDir()
    const planApi = await startFakeApi((_body, index) =>
      index === 0
        ? chatAnswer({ calls: [{ name: 'write_file', arguments: { path: 'plan.txt', content: 'made\n' } }] })
        : chatAnswer({ text: 'Done.' }),
    )
    const planResult = await runAgent({ folder, api: planApi, env: { MACHINEROOM_PERMISSION_MODE: 'plan' } })
    expect(planResult.code).toBe(0)
    expect(existsSync(join(folder, 'plan.txt'))).toBe(false)
    const planUsers = jsonLines(planResult.stdout).filter((line) => line.type === 'user')
    expect(planUsers[0].message.content[0]).toMatchObject({
      is_error: true,
      content: 'The write_file tool is not allowed in plan mode.',
    })

    const command = `"${process.execPath}" -e "require('fs').writeFileSync('ran.txt','x')"`
    const editsApi = await startFakeApi((_body, index) =>
      index === 0
        ? chatAnswer({ calls: [{ name: 'run_shell', arguments: { command } }] })
        : chatAnswer({ text: 'Done.' }),
    )
    const editsResult = await runAgent({ folder, api: editsApi, env: { MACHINEROOM_PERMISSION_MODE: 'edits' } })
    expect(editsResult.code).toBe(0)
    expect(existsSync(join(folder, 'ran.txt'))).toBe(false)
    const editsUsers = jsonLines(editsResult.stdout).filter((line) => line.type === 'user')
    expect(editsUsers[0].message.content[0]).toMatchObject({
      is_error: true,
      content: 'The run_shell tool is not allowed in edits mode.',
    })
  })

  it('asks the bridge before a write in ask mode and allows it', async () => {
    const folder = tempDir()
    const bridge = await startApprovalBridge(() => ({ allow: true }))
    const api = await startFakeApi((_body, index) =>
      index === 0
        ? chatAnswer({ calls: [{ name: 'write_file', arguments: { path: 'a.txt', content: 'made\n' } }] })
        : chatAnswer({ text: 'Done.' }),
    )
    const result = await runAgent({
      folder,
      api,
      env: {
        MACHINEROOM_PERMISSION_MODE: 'ask',
        MACHINEROOM_BRIDGE: bridge.url,
        MACHINEROOM_ORCHESTRATOR_ID: 'orchestrator',
        MACHINEROOM_ORCHESTRATOR_TOKEN: 'test-token',
      },
    })
    expect(result.code).toBe(0)
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('made\n')
    expect(api.calls[0].body.tools).toHaveLength(11)
    expect(bridge.requests).toHaveLength(1)
    expect(bridge.requests[0].body).toEqual({
      id: 'orchestrator',
      tool: 'write_file',
      input: { path: 'a.txt', content: 'made\n' },
    })
    expect(bridge.requests[0].headers['x-machineroom-orchestrator']).toBe('test-token')
  })

  it('returns a denied write as a tool error with the owner message', async () => {
    const folder = tempDir()
    const bridge = await startApprovalBridge(() => ({ allow: false, message: 'The owner denied it.' }))
    const api = await startFakeApi((_body, index) =>
      index === 0
        ? chatAnswer({ calls: [{ name: 'write_file', arguments: { path: 'a.txt', content: 'made\n' } }] })
        : chatAnswer({ text: 'Done.' }),
    )
    const result = await runAgent({
      folder,
      api,
      env: {
        MACHINEROOM_PERMISSION_MODE: 'ask',
        MACHINEROOM_BRIDGE: bridge.url,
        MACHINEROOM_ORCHESTRATOR_ID: 'orchestrator',
        MACHINEROOM_ORCHESTRATOR_TOKEN: 'test-token',
      },
    })
    expect(result.code).toBe(0)
    expect(existsSync(join(folder, 'a.txt'))).toBe(false)
    const users = jsonLines(result.stdout).filter((line) => line.type === 'user')
    expect(users).toHaveLength(1)
    expect(users[0].message.content[0]).toMatchObject({ is_error: true, content: 'The owner denied it.' })
  })

  it('refuses risky shell commands in auto mode and runs the rest', async () => {
    const folder = tempDir()
    const commands = [
      'rm -rf build',
      'Remove-Item -Recurse -Force build',
      'del /s /q build',
      'rmdir /s /q build',
      'git push origin main',
      'git reset --hard HEAD',
      'git clean -fd',
      'git checkout -- .',
      'git branch -D old',
      'format C:',
      'shutdown /s',
      'mkfs.ext4 /dev/sda',
      'echo auto-ok',
    ]
    const api = await startFakeApi((_body, index) =>
      index < commands.length
        ? chatAnswer({ calls: [{ name: 'run_shell', arguments: { command: commands[index] } }] })
        : chatAnswer({ text: 'Done.' }),
    )
    const result = await runAgent({ folder, api, env: { MACHINEROOM_PERMISSION_MODE: 'auto' } })
    expect(result.code).toBe(0)
    const users = jsonLines(result.stdout).filter((line) => line.type === 'user')
    expect(users).toHaveLength(commands.length)
    for (const user of users.slice(0, -1)) {
      expect(user.message.content[0].is_error).toBe(true)
      expect(user.message.content[0].content).toBe('Auto mode does not run this command.')
    }
    expect(users.at(-1).message.content[0].is_error).toBe(false)
    expect(users.at(-1).message.content[0].content).toContain('auto-ok')
  })

  it('refuses split, aliased, option-first and wrapped destructive commands in auto mode', async () => {
    const folder = tempDir()
    const commands = [
      'rm -f -r build',
      'rm -fR x',
      'rd /s /q build',
      'erase /s /q build',
      'cmd /c rd /s /q build',
      'git -C . push',
      'git reset HEAD --hard',
      'GIT branch -D old',
      'bash -c "shutdown -h now"',
      'bash -c shutdown -h now',
      'cmd /c format C:',
      'cmd /k format C:',
      'bash -c "mkfs.ext4 /dev/sda"',
    ]
    const api = await startFakeApi((_body, index) =>
      index < commands.length
        ? chatAnswer({ calls: [{ name: 'run_shell', arguments: { command: commands[index] } }] })
        : chatAnswer({ text: 'Done.' }),
    )
    const result = await runAgent({ folder, api, env: { MACHINEROOM_PERMISSION_MODE: 'auto' } })
    expect(result.code).toBe(0)
    const users = jsonLines(result.stdout).filter((line) => line.type === 'user')
    expect(users).toHaveLength(commands.length)
    commands.forEach((command, index) => {
      expect(users[index].message.content[0].is_error, command).toBe(true)
      expect(users[index].message.content[0].content, command).toBe('Auto mode does not run this command.')
    })
  })

  it('still runs git log and a plain rm in auto mode', async () => {
    const folder = tempDir()
    const commands = ['git log --oneline', 'rm notes.txt']
    const api = await startFakeApi((_body, index) =>
      index < commands.length
        ? chatAnswer({ calls: [{ name: 'run_shell', arguments: { command: commands[index] } }] })
        : chatAnswer({ text: 'Done.' }),
    )
    const result = await runAgent({ folder, api, env: { MACHINEROOM_PERMISSION_MODE: 'auto' } })
    expect(result.code).toBe(0)
    const users = jsonLines(result.stdout).filter((line) => line.type === 'user')
    expect(users).toHaveLength(commands.length)
    for (const user of users) {
      expect(user.message.content[0].content).not.toBe('Auto mode does not run this command.')
    }
  })

  it('uses a saved endpoint and its key slot', async () => {
    const folder = tempDir()
    const runs = tempDir('mr-agent-runs-')
    const api = await startFakeApi(() => chatAnswer({ text: 'Done.' }))
    writeFileSync(
      join(runs, 'endpoints.json'),
      JSON.stringify({
        endpoints: [
          { name: 'Local', provider: 'Custom', baseUrl: api.url, keyName: 'local', models: ['test/model'] },
        ],
      }),
    )
    writeFileSync(join(runs, 'keys.json'), JSON.stringify({ local: 'slot-secret-value' }), 'utf8')
    const result = await runAgent({
      folder,
      model: 'Local/test/model',
      endpoint: 'Local',
      env: {
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_API_KEY: '',
        OPENROUTER_API_KEY: '',
      },
    })
    expect(result.code).toBe(0)
    expect(result.stdout).not.toContain('slot-secret-value')
    expect(result.stderr).not.toContain('slot-secret-value')
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0].headers.authorization).toBe('Bearer slot-secret-value')
    expect(api.calls[0].body.model).toBe('test/model')
  })

  it('uses the saved endpoint its model names when no endpoint is given', async () => {
    const folder = tempDir()
    const runs = tempDir('mr-agent-runs-')
    const api = await startFakeApi(() => chatAnswer({ text: 'Done.' }))
    writeFileSync(
      join(runs, 'endpoints.json'),
      JSON.stringify({ endpoints: [{ name: 'Local', provider: 'Custom', baseUrl: api.url, keyName: 'local', models: ['test/model'] }] }),
    )
    writeFileSync(join(runs, 'keys.json'), JSON.stringify({ local: 'slot-secret-value' }), 'utf8')
    const result = await runAgent({
      folder,
      model: 'Local/test/model',
      env: { MACHINEROOM_RUNS: runs, MACHINEROOM_API_KEY: '', OPENROUTER_API_KEY: '' },
    })
    expect(result.code).toBe(0)
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0].headers.authorization).toBe('Bearer slot-secret-value')
    expect(api.calls[0].body.model).toBe('test/model')
  })

  it('prints one sentence for an endpoint that is not saved', async () => {
    const folder = tempDir()
    const runs = tempDir('mr-agent-runs-')
    const result = await runAgent({
      folder,
      model: 'Local/test/model',
      endpoint: 'Local',
      env: {
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_API_KEY: '',
        OPENROUTER_API_KEY: '',
      },
    })
    expect(result.code).toBe(1)
    expect(result.stderr.trim()).toBe('The endpoint Local was not found.')
  })

  it('stops the whole shell tree on the time limit', async () => {
    const folder = tempDir()
    const leftover = join(folder, 'leftover.txt')
    writeFileSync(join(folder, 'child.cjs'), `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(leftover)}, 'x'), 2500)`)
    writeFileSync(join(folder, 'parent.cjs'), `require('child_process').spawn(process.execPath, ['child.cjs'], { stdio: 'inherit' })`)
    const command = `"${process.execPath}" parent.cjs`
    const api = await startFakeApi((_body, index) =>
      index === 0
        ? chatAnswer({ calls: [{ name: 'run_shell', arguments: { command } }] })
        : chatAnswer({ text: 'Done.' }),
    )
    const result = await runAgent({ folder, api, env: { MR_AGENT_SHELL_TIMEOUT_MS: '700' } })
    expect(result.code).toBe(0)
    const users = jsonLines(result.stdout).filter((line) => line.type === 'user')
    expect(users[0].message.content[0].is_error).toBe(true)
    await new Promise((done) => setTimeout(done, 3000))
    expect(existsSync(leftover)).toBe(false)
  })

  it('keeps the head and tail of long shell output', async () => {
    const folder = tempDir()
    const command = `"${process.execPath}" -e "process.stdout.write('x'.repeat(9000))"`
    const api = await startFakeApi((_body, index) =>
      index === 0
        ? chatAnswer({ calls: [{ name: 'run_shell', arguments: { command } }] })
        : chatAnswer({ text: 'Done.' }),
    )
    const result = await runAgent({ folder, api })
    expect(result.code).toBe(0)
    const users = jsonLines(result.stdout).filter((line) => line.type === 'user')
    expect(users).toHaveLength(1)
    const content = users[0].message.content[0].content
    expect(content.startsWith('x'.repeat(2000))).toBe(true)
    expect(content.endsWith('x'.repeat(6000))).toBe(true)
    expect(content).toContain('[1000 characters cut]')
  })

  it('does not pass the key to shell commands', async () => {
    const folder = tempDir()
    const command = `"${process.execPath}" -e "process.stdout.write(String(process.env.MACHINEROOM_API_KEY ?? 'none'))"`
    const api = await startFakeApi((_body, index) =>
      index === 0
        ? chatAnswer({ calls: [{ name: 'run_shell', arguments: { command } }] })
        : chatAnswer({ text: 'Done.' }),
    )
    const result = await runAgent({ folder, api })
    expect(result.code).toBe(0)
    const users = jsonLines(result.stdout).filter((line) => line.type === 'user')
    expect(users).toHaveLength(1)
    expect(users[0].message.content[0].content).toBe('none')
  })

  it('prints the missing key sentence and exits 1', async () => {
    const folder = tempDir()
    const result = await runAgent({ folder, env: { MACHINEROOM_API_KEY: '', OPENROUTER_API_KEY: '' } })
    expect(result.code).toBe(1)
    expect(result.stderr.trim()).toBe('Set MACHINEROOM_API_KEY or OPENROUTER_API_KEY.')
    expect(result.stdout).toBe('')
  })

  it('stops after 200 steps with an error result', async () => {
    const folder = tempDir()
    const api = await startFakeApi(() => chatAnswer({ calls: [{ name: 'list_dir', arguments: { path: '.' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
    const result = await runAgent({ folder, api })
    expect(result.code).toBe(1)
    expect(api.calls).toHaveLength(200)
    const lines = jsonLines(result.stdout)
    expect(lines.filter((line) => line.type === 'assistant')).toHaveLength(200)
    expect(lines.filter((line) => line.type === 'user')).toHaveLength(200)
    expect(lines.at(-1)).toEqual({
      type: 'result',
      subtype: 'error',
      is_error: true,
      result: 'Stopped after 200 steps.',
      usage: { input_tokens: 200, output_tokens: 200 },
    })
  })

  it('replaces the oldest tool results and keeps the newest six', async () => {
    const folder = tempDir()
    writeFileSync(join(folder, 'notes.txt'), `${'n'.repeat(600)}\n`)
    const calls = Array.from({ length: 8 }, (_, index) => ({ id: `call_${index}`, name: 'read_file', arguments: { path: 'notes.txt' } }))
    const api = await startFakeApi((_body, index) => (index === 0 ? chatAnswer({ calls }) : chatAnswer({ text: 'Done.' })))
    const result = await runAgent({ folder, api, env: { MR_AGENT_CONTEXT_CHARS: '2000' } })
    expect(result.code).toBe(0)
    const results = api.calls[1].body.messages.filter((message) => message.role === 'tool')
    expect(results).toHaveLength(8)
    const removed = '[Output removed to save room. Run the tool again if it is needed.]'
    expect(results.slice(0, 2).map((message) => message.content)).toEqual([removed, removed])
    for (const message of results.slice(2)) expect(message.content).toContain('1\t')
  })

  it('keeps a long write call under the context bound', async () => {
    const folder = tempDir()
    const content = 'x'.repeat(500 * 1024)
    const api = await startFakeApi((_body, index) =>
      index === 0
        ? chatAnswer({
            calls: [
              { id: 'call_write', name: 'write_file', arguments: { path: 'big.txt', content } },
              { id: 'call_list', name: 'list_dir', arguments: { path: '.' } },
            ],
          })
        : chatAnswer({ text: 'Done.' }),
    )
    const result = await runAgent({ folder, api, env: { MR_AGENT_CONTEXT_CHARS: '2000' } })
    expect(result.code).toBe(0)
    expect(api.calls).toHaveLength(2)
    const messages = api.calls[1].body.messages
    expect(JSON.stringify(messages).length).toBeLessThan(2000)
    const callIndex = messages.findIndex((message) => message.role === 'assistant' && Array.isArray(message.tool_calls))
    expect(callIndex).toBeGreaterThan(-1)
    const calls = messages[callIndex].tool_calls
    expect(calls.map((call) => call.id)).toEqual(['call_write', 'call_list'])
    expect(calls.map((call) => call.function.name)).toEqual(['write_file', 'list_dir'])
    expect(JSON.parse(calls[0].function.arguments).path).toBe('big.txt')
    expect(messages.slice(callIndex + 1, callIndex + 3)).toMatchObject([
      { role: 'tool', tool_call_id: 'call_write' },
      { role: 'tool', tool_call_id: 'call_list' },
    ])
  })

  it('cuts the newest tool result to 2000 characters when the newest six hold the bound', async () => {
    const folder = tempDir()
    const command = `"${process.execPath}" -e "process.stdout.write('x'.repeat(9000))"`
    const api = await startFakeApi((_body, index) =>
      index === 0
        ? chatAnswer({ calls: [{ id: 'call_shell', name: 'run_shell', arguments: { command } }] })
        : chatAnswer({ text: 'Done.' }),
    )
    const result = await runAgent({ folder, api, env: { MR_AGENT_CONTEXT_CHARS: '4000' } })
    expect(result.code).toBe(0)
    const messages = api.calls[1].body.messages
    expect(JSON.stringify(messages).length).toBeLessThan(4000)
    const tool = messages.at(-1)
    expect(tool).toMatchObject({ role: 'tool', tool_call_id: 'call_shell' })
    expect(tool.content).toBe('x'.repeat(2000))
  })

  it('replaces old assistant text and write arguments and keeps the call', async () => {
    const folder = tempDir()
    const api = await startFakeApi((_body, index) => {
      if (index === 0) {
        return chatAnswer({
          text: 'Starting the long write.',
          calls: [{ id: 'call_write', name: 'write_file', arguments: { path: 'big.txt', content: 'z'.repeat(4000) } }],
        })
      }
      if (index < 6) {
        return chatAnswer({ text: `Step ${index}.`, calls: [{ id: `call_${index}`, name: 'list_dir', arguments: { path: '.' } }] })
      }
      return chatAnswer({ text: 'Done.' })
    })
    const result = await runAgent({ folder, api, env: { MR_AGENT_CONTEXT_CHARS: '1000' } })
    expect(result.code).toBe(0)
    const messages = api.calls[6].body.messages
    const assistant = messages[2]
    expect(assistant).toMatchObject({ role: 'assistant', content: '[Text removed to save room.]' })
    expect(assistant.tool_calls[0].id).toBe('call_write')
    expect(assistant.tool_calls[0].function.name).toBe('write_file')
    expect(JSON.parse(assistant.tool_calls[0].function.arguments).path).toBe('big.txt')
    expect(messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'call_write' })
  })

  it('takes the step limit from the environment', async () => {
    const folder = tempDir()
    const api = await startFakeApi(() => chatAnswer({ calls: [{ name: 'list_dir', arguments: { path: '.' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
    const result = await runAgent({ folder, api, env: { MR_AGENT_MAX_STEPS: '3' } })
    expect(result.code).toBe(1)
    expect(api.calls).toHaveLength(3)
    const lines = jsonLines(result.stdout)
    expect(lines.filter((line) => line.type === 'assistant')).toHaveLength(3)
    expect(lines.at(-1)).toMatchObject({ is_error: true, result: 'Stopped after 3 steps.' })
  })

  it('stops on a fetch error with an error result', async () => {
    const folder = tempDir()
    const server = createServer(() => {})
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    const { port } = server.address()
    await new Promise((done) => {
      server.close(() => done())
      server.closeAllConnections?.()
    })
    const result = await runAgent({ folder, api: { url: `http://127.0.0.1:${port}/v1` }, env: { MR_AGENT_RETRY_BASE_MS: '1' } })
    expect(result.code).toBe(1)
    const final = jsonLines(result.stdout).at(-1)
    expect(final).toMatchObject({ type: 'result', is_error: true })
    expect(final.result).toContain('The API request failed')
  })

  it('reads endpoint slot key from list shape keys.json', async () => {
    const folder = tempDir()
    const runsFolder = tempDir('mr-runs-')
    const token = 'agent-slot-token'
    const seenHeaders = []
    const api = await startFakeApi((_body, _index, calls) => {
      seenHeaders.push(calls.at(-1)?.headers?.authorization)
      return chatAnswer({ text: 'Done.' })
    })
    writeFileSync(
      join(runsFolder, 'endpoints.json'),
      JSON.stringify({
        endpoints: [
          { name: 'CustomTest', provider: 'Custom', baseUrl: api.url, keyName: 'shared_slot', models: ['test-model'] },
        ],
      }),
    )
    writeFileSync(
      join(runsFolder, 'keys.json'),
      JSON.stringify({ keys: [{ name: 'shared_slot', value: token }] }),
    )
    const result = await runAgent({
      folder,
      env: { MACHINEROOM_RUNS: runsFolder },
      model: 'CustomTest/test-model',
    })
    expect(result.code).toBe(0)
    expect(seenHeaders).toEqual([`Bearer ${token}`])
  })
})

describe('machineroom harness', () => {
  it('builds the agent command with Node and the script', () => {
    const harness = harnessByKey.machineroom
    expect(harness.name).toBe('MachineRoom')
    expect(harness.adapterType).toBe('machineroom_local')
    const command = harness.command({ cli: { model: 'deepseek/test' }, prompt: 'Do it.', folder: 'C:\\work' })
    expect(command.file).toBe(process.execPath)
    expect(command.cwd).toBe('C:\\work')
    expect(command.args.slice(1)).toEqual(['--model', 'deepseek/test', '--cwd', 'C:\\work', 'Do it.'])
    expect(command.args[0].replaceAll('\\', '/')).toMatch(/\/scripts\/mr-agent\.mjs$/)
    const reasoned = harness.command({ cli: { model: 'deepseek/test' }, prompt: 'Do it.', folder: 'C:\\work', reasoning: 'xhigh' })
    expect(reasoned.args.slice(1)).toEqual(['--model', 'deepseek/test', '--cwd', 'C:\\work', '--reasoning', 'xhigh', 'Do it.'])
  })

  it('reads peakTokens from the assistant usage lines', () => {
    const log = [
      JSON.stringify({ type: 'assistant', message: { content: [], usage: { input_tokens: 100, output_tokens: 5 } } }),
      JSON.stringify({ type: 'assistant', message: { content: [], usage: { input_tokens: 250, output_tokens: 8 } } }),
      JSON.stringify({ type: 'result', result: 'Done.', usage: { input_tokens: 350, output_tokens: 13 } }),
    ].join('\n')
    expect(harnessByKey.machineroom.usage(log)).toEqual({
      costUsd: null,
      inputTokens: 350,
      outputTokens: 13,
      peakTokens: 250,
    })
  })

  it('reads a stream-json line and summarizes a run', () => {
    const reader = createRunLineReader('machineroom')
    const assistant = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/a.js' } }] } })
    expect(reader(assistant, 1000)).toEqual({ chunk: `${assistant}\n`, at: 1000, read: true })
    const log = [
      assistant,
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x', is_error: false }] } }),
      JSON.stringify({ type: 'result', result: 'Done.', usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 }),
    ].join('\n')
    expect(summarizeRun({ harness: 'machineroom', log, worktree: 'C:\\scratch' })).toMatchObject({
      harness: 'machineroom',
      toolCalls: 1,
      failed: 0,
      written: [],
      read: ['src/a.js'],
      head: ['Done.'],
      costUsd: 0.01,
      inputTokens: 10,
      outputTokens: 5,
    })
  })
})

describe('mr-agent files', () => {
  it('makes missing folders when it writes and refuses a path outside the folder', async () => {
    const folder = tempDir()
    const outsideName = `outside-${process.pid}-${Date.now()}.txt`
    const outside = join(folder, '..', outsideName)
    writeFileSync(outside, 'outside\n')
    const api = await startFakeApi((_body, index) =>
      index === 0
        ? chatAnswer({
            calls: [
              { name: 'write_file', arguments: { path: 'deep/inside.txt', content: 'inside\n' } },
              { name: 'write_file', arguments: { path: `../${outsideName}`, content: 'nope\n' } },
            ],
          })
        : chatAnswer({ text: 'Done.' }),
    )
    const result = await runAgent({ folder, api })
    expect(result.code).toBe(0)
    expect(readFileSync(join(folder, 'deep', 'inside.txt'), 'utf8')).toBe('inside\n')
    expect(readFileSync(outside, 'utf8')).toBe('outside\n')
    const users = jsonLines(result.stdout).filter((line) => line.type === 'user').map((line) => line.message.content[0])
    expect(users[0].is_error).toBe(false)
    expect(users[1].is_error).toBe(true)
    expect(users[1].content).toContain('outside the working folder')
  })
})

describe('mr-agent tools', () => {
  it('reads numbered pages and says how many lines are left', async () => {
    const folder = tempDir()
    writeFileSync(join(folder, 'lines.txt'), ['one', 'two', 'three', 'four', 'five'].join('\n') + '\n')
    writeFileSync(join(folder, 'big.txt'), Array.from({ length: 2005 }, (_, index) => `line ${index + 1}`).join('\n'))
    const { users } = await runCalls({
      folder,
      calls: [
        { name: 'read_file', arguments: { path: 'lines.txt', offset: 2, limit: 2 } },
        { name: 'read_file', arguments: { path: 'big.txt' } },
      ],
    })
    expect(users[0].content).toBe('2\ttwo\n3\tthree\n[2 more lines. Read again with offset to see them.]')
    expect(users[0].is_error).toBe(false)
    const big = users[1].content
    const bigLines = big.split('\n')
    expect(bigLines).toHaveLength(2001)
    expect(bigLines[0]).toBe('1\tline 1')
    expect(bigLines[1999]).toBe('2000\tline 2000')
    expect(bigLines[2000]).toBe('[5 more lines. Read again with offset to see them.]')
    expect(big).not.toContain('2001\tline 2001')
  })

  it('cuts a line longer than 2000 characters', async () => {
    const folder = tempDir()
    writeFileSync(join(folder, 'long.txt'), 'a'.repeat(3000))
    const { users } = await runCalls({ folder, calls: [{ name: 'read_file', arguments: { path: 'long.txt' } }] })
    expect(users[0].content).toBe(`1\t${'a'.repeat(2000)}`)
    expect(users[0].is_error).toBe(false)
  })

  it('answers that a binary file is binary', async () => {
    const folder = tempDir()
    writeFileSync(join(folder, 'bin.dat'), Buffer.from([65, 0, 66]))
    const { users } = await runCalls({ folder, calls: [{ name: 'read_file', arguments: { path: 'bin.dat' } }] })
    expect(users[0].content).toContain('binary')
    expect(users[0].is_error).toBe(false)
  })

  it('keeps the last line and the exit code of a failing command', async () => {
    const folder = tempDir()
    const command = `"${process.execPath}" -e "console.log('first');console.log('last-marker');process.exit(1)"`
    const { users } = await runCalls({ folder, calls: [{ name: 'run_shell', arguments: { command } }] })
    expect(users[0].is_error).toBe(true)
    expect(users[0].content).toContain('last-marker')
    expect(users[0].content.endsWith('exit 1')).toBe(true)
  })

  it('stops a command when the timeout in seconds runs out', async () => {
    const folder = tempDir()
    const { users } = await runCalls({ folder, calls: [{ name: 'run_shell', arguments: { command: 'sleep 5', timeout: 1 } }] })
    expect(users[0].is_error).toBe(true)
    expect(users[0].content).toContain('ran past 1 seconds')
  })

  it('chooses Git Bash, a PATH bash or PowerShell on Windows', () => {
    const beside = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const gitExe = 'C:\\Program Files\\Git\\cmd\\git.exe'
    expect(
      shellFor('ls -la', {
        platform: 'win32',
        git: () => gitExe,
        exists: (path) => path === beside,
        onPath: () => null,
      }),
    ).toEqual({ file: beside, args: ['-c', 'ls -la'] })
    const onPathBash = 'D:\\tools\\bash.exe'
    expect(
      shellFor('ls', {
        platform: 'win32',
        git: () => gitExe,
        exists: (path) => path === onPathBash,
        onPath: () => onPathBash,
      }),
    ).toEqual({ file: onPathBash, args: ['-c', 'ls'] })
    expect(
      shellFor('dir', {
        platform: 'win32',
        git: () => null,
        exists: () => false,
        onPath: () => null,
      }),
    ).toEqual({ file: 'powershell.exe', args: ['-NoProfile', '-Command', 'dir'] })
    const windowsBash = 'C:\\Windows\\System32\\bash.exe'
    expect(
      shellFor('ls', {
        platform: 'win32',
        git: () => gitExe,
        exists: (path) => path === windowsBash,
        onPath: () => windowsBash,
        systemRoot: 'C:\\Windows',
      }),
    ).toEqual({ file: 'powershell.exe', args: ['-NoProfile', '-Command', 'ls'] })
    const windowsGit = 'C:\\Windows\\cmd\\git.exe'
    const windowsBeside = 'C:\\Windows\\bin\\bash.exe'
    expect(
      shellFor('ls', {
        platform: 'win32',
        git: () => windowsGit,
        exists: (path) => path === windowsBeside,
        onPath: () => null,
        systemRoot: 'C:\\WINDOWS',
      }),
    ).toEqual({ file: 'powershell.exe', args: ['-NoProfile', '-Command', 'ls'] })
    expect(
      shellFor('ls', {
        platform: 'win32',
        git: () => null,
        exists: (path) => path === onPathBash,
        onPath: () => onPathBash,
        systemRoot: 'C:\\Windows',
      }),
    ).toEqual({ file: onPathBash, args: ['-c', 'ls'] })
    expect(shellFor('ls', { platform: 'linux' })).toEqual({ file: '/bin/sh', args: ['-c', 'ls'] })
  })

  it('skips folders git ignores when it searches', async () => {
    const folder = tempDir()
    mkdirSync(join(folder, 'ignored'), { recursive: true })
    writeFileSync(join(folder, '.gitignore'), 'ignored/\n')
    writeFileSync(join(folder, 'kept.txt'), 'needle here\n')
    writeFileSync(join(folder, 'ignored', 'hidden.txt'), 'needle here\n')
    execFileSync(gitPath(), ['init'], { cwd: folder, stdio: 'ignore' })
    const { users } = await runCalls({ folder, calls: [{ name: 'search', arguments: { pattern: 'needle' } }] })
    expect(users[0].content).toContain('kept.txt:1: needle here')
    expect(users[0].content).not.toContain('hidden.txt')
  })

  it('filters a search by glob and ignores case when asked', async () => {
    const folder = tempDir()
    mkdirSync(join(folder, 'sub'), { recursive: true })
    writeFileSync(join(folder, 'a.js'), 'Hello World\n')
    writeFileSync(join(folder, 'b.txt'), 'Hello World\n')
    writeFileSync(join(folder, 'sub', 'c.js'), 'hello there\n')
    writeFileSync(join(folder, 'long.txt'), `needle ${'z'.repeat(400)}\n`)
    const { users } = await runCalls({
      folder,
      calls: [
        { name: 'search', arguments: { pattern: 'hello', glob: '*.js', ignore_case: true } },
        { name: 'search', arguments: { pattern: 'hello', glob: '*.js' } },
        { name: 'search', arguments: { pattern: 'needle' } },
      ],
    })
    expect(users[0].content).toContain('a.js:1: Hello World')
    expect(users[0].content).toContain('sub/c.js:1: hello there')
    expect(users[0].content).not.toContain('b.txt')
    expect(users[1].content).toContain('sub/c.js:1: hello there')
    expect(users[1].content).not.toContain('a.js')
    expect(users[2].content.startsWith('long.txt:1: needle')).toBe(true)
    for (const line of users[2].content.split('\n')) expect(line.length).toBeLessThanOrEqual(300)
  })

  it('lists the files that match a glob', async () => {
    const folder = tempDir()
    mkdirSync(join(folder, 'src', 'nested'), { recursive: true })
    writeFileSync(join(folder, 'src', 'a.js'), 'a\n')
    writeFileSync(join(folder, 'src', 'b.js'), 'b\n')
    writeFileSync(join(folder, 'src', 'c.txt'), 'c\n')
    writeFileSync(join(folder, 'src', 'nested', 'd.js'), 'd\n')
    writeFileSync(join(folder, 'root.js'), 'r\n')
    const { users } = await runCalls({
      folder,
      calls: [
        { name: 'glob_files', arguments: { pattern: '*.js', path: 'src' } },
        { name: 'glob_files', arguments: { pattern: '**/*.js', path: '.' } },
      ],
    })
    expect(users[0].content).toBe('src/a.js\nsrc/b.js\nsrc/nested/d.js')
    expect(users[1].content).toBe('root.js\nsrc/a.js\nsrc/b.js\nsrc/nested/d.js')
  })

  it('replaces every match and answers with the line count', async () => {
    const folder = tempDir()
    writeFileSync(join(folder, 'a.txt'), 'x x x\n')
    const { users } = await runCalls({
      folder,
      calls: [
        { name: 'edit_file', arguments: { path: 'a.txt', old_string: 'x', new_string: 'y', replace_all: true } },
        { name: 'write_file', arguments: { path: 'w.txt', content: 'a\nb\nc\n' } },
        { name: 'edit_file', arguments: { path: 'a.txt', old_string: 'y', new_string: 'z' } },
      ],
    })
    expect(users[0]).toMatchObject({ content: 'Edited a.txt. 1 line.', is_error: false })
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('y y y\n')
    expect(users[1]).toMatchObject({ content: 'Wrote w.txt. 3 lines.', is_error: false })
    expect(readFileSync(join(folder, 'w.txt'), 'utf8')).toBe('a\nb\nc\n')
    expect(users[2].is_error).toBe(true)
    expect(users[2].content).toContain('more than once')
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('y y y\n')
  })
})
