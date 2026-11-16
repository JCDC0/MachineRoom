import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { killTree } from '../server/processTree.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const SCRIPT = fileURLToPath(new URL('../scripts/mr-agent.mjs', import.meta.url))
const LOOP_WARNING = 'This call has failed the same way three times. Try something else or stop and report.'
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()()
  }
})

function tempDir(prefix = 'native-loop-') {
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
    message.tool_calls = calls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
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
      const parsed = body === '' ? null : JSON.parse(body)
      calls.push({ method: req.method, url: req.url, body: parsed })
      const answer = await handler(parsed, calls.length - 1, calls)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(answer))
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

function runAgent({ folder, api, seconds = 40 }) {
  return new Promise((done, fail) => {
    const childEnv = { ...baseEnvironment() }
    childEnv.MACHINEROOM_API_URL = api.url
    childEnv.MACHINEROOM_API_KEY = 'test-key'
    const child = spawn(process.execPath, [SCRIPT, '--model', 'test/model', '--cwd', folder, 'Do the task.'], {
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

function toolResults(result) {
  return jsonLines(result.stdout)
    .filter((line) => line.type === 'user')
    .map((line) => line.message.content[0])
}

function failingRead(id) {
  return { id, name: 'read_file', arguments: { path: 'missing.txt' } }
}

async function runSequence({ folder, answers }) {
  const api = await startFakeApi((_body, index) =>
    index < answers.length ? chatAnswer({ calls: [answers[index]] }) : chatAnswer({ text: 'Done.' }),
  )
  const result = await runAgent({ folder, api })
  return { api, result }
}

describe('native agent loop', () => {
  it('adds the loop line on the third identical failure', async () => {
    const folder = tempDir()
    const { result } = await runSequence({
      folder,
      answers: [failingRead('call_1'), failingRead('call_2'), failingRead('call_3')],
    })

    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    const results = toolResults(result)
    expect(results).toHaveLength(3)
    expect(results[0].content).not.toContain(LOOP_WARNING)
    expect(results[1].content).not.toContain(LOOP_WARNING)
    expect(results[2].content).toContain(LOOP_WARNING)
  })

  it('ends the run on the fifth identical failure and names the call', async () => {
    const folder = tempDir()
    const api = await startFakeApi(() => chatAnswer({ calls: [failingRead('call_same')] }))
    const result = await runAgent({ folder, api })

    expect(result.code).toBe(4)
    expect(api.calls).toHaveLength(5)
    const lines = jsonLines(result.stdout)
    const final = lines.at(-1)
    expect(final).toMatchObject({ type: 'result', is_error: true })
    expect(final.result).toContain('read_file')
    expect(final.result).toContain('missing.txt')
    expect(final.result).toContain('five times')
  })

  it('resets the count after a success', async () => {
    const folder = tempDir()
    writeFileSync(join(folder, 'ok.txt'), 'fine\n')
    const { result } = await runSequence({
      folder,
      answers: [
        failingRead('call_1'),
        failingRead('call_2'),
        { id: 'call_ok', name: 'read_file', arguments: { path: 'ok.txt' } },
        failingRead('call_3'),
        failingRead('call_4'),
        failingRead('call_5'),
      ],
    })

    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    const results = toolResults(result)
    expect(results).toHaveLength(6)
    expect(results[2].is_error).toBe(false)
    expect(results[5].content).toContain(LOOP_WARNING)
    expect(results[3].content).not.toContain(LOOP_WARNING)
    expect(results[4].content).not.toContain(LOOP_WARNING)
  })
})
