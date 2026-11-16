import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startLane } from '../scripts/run-lane.mjs'
import { gitPath } from '../server/programPath.js'
import { runRecord } from '../src/briefs/run.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()()
  }
})

function tempDir(prefix = 'mr-attention-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function makeRepo(folder, extraFiles = {}) {
  const repo = join(folder, 'repo')
  mkdirSync(repo, { recursive: true })
  const git = gitPath()
  const run = (args) => execFileSync(git, args, { cwd: repo, encoding: 'utf8', windowsHide: true })
  run(['init'])
  run(['config', 'user.name', 'Test User'])
  run(['config', 'user.email', 'test@example.invalid'])
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  for (const [name, content] of Object.entries(extraFiles)) {
    writeFileSync(join(repo, name), content)
  }
  run(['add', '-A'])
  run(['commit', '-m', 'init'])
  return repo
}

function startFakeApi(handler) {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', async () => {
      const parsed = body === '' ? null : JSON.parse(body)
      const answer = await handler(parsed)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(answer))
    })
  })
  cleanups.push(() => new Promise((done) => {
    server.close(() => done())
    server.closeAllConnections?.()
  }))
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      done({ url: `http://127.0.0.1:${address.port}/v1` })
    })
  })
}

async function runProjectLane({ lane, name, envExtra = {}, extraFiles = {} }) {
  const folder = tempDir()
  const repo = makeRepo(folder, extraFiles)
  const runs = join(folder, 'runs')
  mkdirSync(runs, { recursive: true })
  const logPath = join(runs, `${name}.log`)
  const usageFile = join(runs, `${name}.usage.json`)
  const saved = {
    MACHINEROOM_RUNS: process.env.MACHINEROOM_RUNS,
    MACHINEROOM_API_URL: process.env.MACHINEROOM_API_URL,
    MACHINEROOM_API_KEY: process.env.MACHINEROOM_API_KEY,
  }
  process.env.MACHINEROOM_RUNS = runs
  for (const [key, value] of Object.entries(envExtra)) process.env[key] = value
  try {
    const result = await startLane({
      options: { lane: name, minutes: 1 },
      lane,
      lanes: { [name]: lane },
      wanted: [],
      prompt: 'Do the task.',
      logPath,
      usageFile,
      name,
      project: repo,
      task: 'Do the task.',
    })
    const lines = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/)
    return { result, record: JSON.parse(lines.at(-1)) }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe('loop stop record', () => {
  it('records stopReason repeated failure when machineroom stops on repeated failure', async () => {
    const api = await startFakeApi(() => ({
      id: 'chatcmpl-loop',
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_same', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'missing.txt' }) } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))
    const { result, record } = await runProjectLane({
      name: 'direct',
      lane: { name: 'Direct', cli: { harness: 'machineroom', model: 'test/model' } },
      envExtra: { MACHINEROOM_API_URL: api.url, MACHINEROOM_API_KEY: 'test-key' },
    })

    expect(result.code).toBe(4)
    expect(record.exitCode).toBe(4)
    expect(record.stopReason).toBe('repeated failure')
  })

  it('does not set stopReason for another harness exiting 4 or machineroom exiting 1', async () => {
    const other = await runProjectLane({
      name: 'opencode',
      lane: { name: 'OpenCode', cli: { harness: 'opencode', bin: process.execPath, model: 'test/model' } },
      extraFiles: { run: 'process.exit(4)\n' },
    })
    expect(other.record.exitCode).toBe(4)
    expect(Object.hasOwn(other.record, 'stopReason')).toBe(false)

    const api = await startFakeApi(() => ({ error: { message: 'Provider failed.' } }))
    const fail1 = await runProjectLane({
      name: 'direct',
      lane: { name: 'Direct', cli: { harness: 'machineroom', model: 'test/model' } },
      envExtra: { MACHINEROOM_API_URL: api.url, MACHINEROOM_API_KEY: 'test-key' },
    })
    expect(fail1.record.exitCode).toBe(1)
    expect(Object.hasOwn(fail1.record, 'stopReason')).toBe(false)
    expect(Object.hasOwn(runRecord({ lane: 'direct', exitCode: 4 }), 'stopReason')).toBe(false)
  })
})
