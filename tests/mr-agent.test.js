import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { summarizeRun } from '../src/briefs/run.js'
import { createRunLineReader } from '../src/briefs/recording.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { killTree } from '../server/processTree.js'
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
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(answer))
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

function runAgent({ folder, api = null, env = {}, model = 'test/model', endpoint = '', prompt = 'Do the task.', seconds = 40 }) {
  return new Promise((done, fail) => {
    const childEnv = { ...baseEnvironment(), ...env }
    if (api) {
      childEnv.MACHINEROOM_API_URL = api.url
      childEnv.MACHINEROOM_API_KEY = 'test-key'
    }
    const args = [SCRIPT, '--model', model, '--cwd', folder]
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
    const tools = assistants[0].message.content.filter((item) => item.type === 'tool_use')
    expect(tools.map((item) => item.name)).toEqual(['Read', 'Write', 'Edit', 'Read', 'Bash', 'LS', 'Grep'])
    expect(tools[0].input).toEqual({ file_path: 'a.txt' })
    expect(tools[1].input).toMatchObject({ file_path: 'out/b.txt', content: 'made\n' })
    expect(tools[2].input).toMatchObject({ file_path: 'a.txt', old_string: 'hello', new_string: 'goodbye' })
    expect(tools[4].input).toEqual({ command: 'echo shell-ok' })
    expect(tools[5].input).toEqual({ path: '.' })
    expect(tools[6].input).toEqual({ pattern: 'goodbye', path: '.' })
    expect(assistants[1].message.content).toEqual([{ type: 'text', text: 'All done.' }])

    const users = lines.filter((line) => line.type === 'user').map((line) => line.message.content[0])
    expect(users).toHaveLength(7)
    expect(users[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'call_read', is_error: false })
    expect(users[0].content).toBe('hello\n')
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
    expect(api.calls[0].body.messages.at(-1)).toEqual({ role: 'user', content: 'Do the task.' })
    expect(api.calls[0].body.tools.map((tool) => tool.function.name)).toEqual([
      'read_file',
      'write_file',
      'edit_file',
      'list_dir',
      'search',
      'run_shell',
      'web_search',
      'web_fetch',
      'mcp_list_tools',
      'mcp_call_tool',
    ])
    expect(api.calls[1].body.messages.some((message) => message.role === 'tool' && message.tool_call_id === 'call_read')).toBe(true)
  })

  it('offers only the tools each permission mode allows', async () => {
    const folder = tempDir()
    const cases = [
      ['plan', ['read_file', 'list_dir', 'search', 'web_search', 'web_fetch', 'mcp_list_tools']],
      ['edits', ['read_file', 'write_file', 'edit_file', 'list_dir', 'search', 'web_search', 'web_fetch', 'mcp_list_tools']],
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
      else expect(offered, mode).toHaveLength(10)
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
    expect(api.calls[0].body.tools).toHaveLength(10)
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
      'cmd /c format C:',
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

  it('cuts long shell output to 8000 characters', async () => {
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
    expect(users[0].message.content[0].content).toHaveLength(8000)
    expect(users[0].message.content[0].content).toBe('x'.repeat(8000))
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

  it('stops after 60 steps with an error result', async () => {
    const folder = tempDir()
    const api = await startFakeApi(() => chatAnswer({ calls: [{ name: 'list_dir', arguments: { path: '.' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
    const result = await runAgent({ folder, api })
    expect(result.code).toBe(1)
    expect(api.calls).toHaveLength(60)
    const lines = jsonLines(result.stdout)
    expect(lines.filter((line) => line.type === 'assistant')).toHaveLength(60)
    expect(lines.filter((line) => line.type === 'user')).toHaveLength(60)
    expect(lines.at(-1)).toEqual({
      type: 'result',
      subtype: 'error',
      is_error: true,
      result: 'Stopped after 60 steps.',
      usage: { input_tokens: 60, output_tokens: 60 },
    })
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
    const result = await runAgent({ folder, api: { url: `http://127.0.0.1:${port}/v1` } })
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
