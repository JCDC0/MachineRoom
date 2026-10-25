import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { writeSearchChoice } from '../server/search.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SCRIPT = join(ROOT, 'scripts', 'mr-agent.mjs')
const servers = new Set()
const tempDirs = []

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  tempDirs.push(dir)
  return dir
}

async function fakeServer(handler) {
  const seen = []
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res, seen)).catch(() => {
      if (!res.headersSent) res.statusCode = 500
      res.end()
    })
  })
  servers.add(server)
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}`,
    seen,
  }
}

async function bodyOf(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function runAgent(args, env) {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (code) => done({ code, stdout, stderr }))
  })
}

afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections?.()
    await new Promise((done) => server.close(() => done()))
  }
  servers.clear()
  while (tempDirs.length > 0) removeTempDir(tempDirs.pop())
})

describe('the MachineRoom agent web tools', () => {
  it('calls web_search through the saved provider and returns the result', async () => {
    const search = await fakeServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        results: [{ title: 'MachineRoom room', url: 'https://example.com/room', content: 'A 3D room of agents.' }],
      }))
    })
    const api = await fakeServer(async (req, res, seen) => {
      const body = JSON.parse(await bodyOf(req))
      seen.push(body)
      const first = seen.length === 1
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        choices: [{
          message: first
            ? {
                role: 'assistant',
                content: 'Looking.',
                tool_calls: [{
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'web_search', arguments: JSON.stringify({ query: 'machineroom' }) },
                }],
              }
            : { role: 'assistant', content: 'Found it.' },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      }))
    })
    const runs = tempDir('mr-agent-runs-')
    const project = tempDir('mr-agent-project-')
    writeSearchChoice(runs, { provider: 'searxng', url: search.url, keyName: '' })
    const result = await runAgent(
      [SCRIPT, '--model', 'test-model', '--cwd', project, 'Find the room'],
      {
        ...process.env,
        MACHINEROOM_API_KEY: 'test-key',
        MACHINEROOM_API_URL: `${api.url}/v1`,
        MACHINEROOM_RUNS: runs,
      }
    )
    expect(result.code, result.stderr).toBe(0)
    const lines = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line))
    const assistant = lines.find((line) => line.type === 'assistant' && line.message.content.some((item) => item.type === 'tool_use'))
    const use = assistant.message.content.find((item) => item.type === 'tool_use')
    expect(use.name).toBe('WebSearch')
    expect(use.input).toEqual({ query: 'machineroom' })
    const toolResult = lines.find((line) => line.type === 'user')
    expect(toolResult.message.content[0].content).toContain('MachineRoom room')
    expect(toolResult.message.content[0].content).toContain('https://example.com/room')
    const final = lines.find((line) => line.type === 'result')
    expect(final.is_error).toBe(false)
    expect(final.result).toBe('Found it.')
    const tools = api.seen[0].tools.map((tool) => tool.function.name)
    expect(tools).toContain('web_search')
    expect(tools).toContain('web_fetch')
    const toolMessage = api.seen[1].messages.find((message) => message.role === 'tool')
    expect(toolMessage.content).toContain('https://example.com/room')
  })

  it('calls web_fetch and refuses a loopback address', async () => {
    const api = await fakeServer(async (req, res, seen) => {
      const body = JSON.parse(await bodyOf(req))
      seen.push(body)
      const first = seen.length === 1
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        choices: [{
          message: first
            ? {
                role: 'assistant',
                content: 'Reading.',
                tool_calls: [{
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'web_fetch', arguments: JSON.stringify({ url: 'http://127.0.0.1:1/' }) },
                }],
              }
            : { role: 'assistant', content: 'Done.' },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      }))
    })
    const runs = tempDir('mr-agent-runs-')
    const project = tempDir('mr-agent-project-')
    const result = await runAgent(
      [SCRIPT, '--model', 'test-model', '--cwd', project, 'Read the page'],
      {
        ...process.env,
        MACHINEROOM_API_KEY: 'test-key',
        MACHINEROOM_API_URL: `${api.url}/v1`,
        MACHINEROOM_RUNS: runs,
      }
    )
    expect(result.code, result.stderr).toBe(0)
    const lines = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line))
    const assistant = lines.find((line) => line.type === 'assistant' && line.message.content.some((item) => item.type === 'tool_use'))
    const use = assistant.message.content.find((item) => item.type === 'tool_use')
    expect(use.name).toBe('WebFetch')
    expect(use.input).toEqual({ url: 'http://127.0.0.1:1/' })
    const toolResult = lines.find((line) => line.type === 'user')
    expect(toolResult.message.content[0].is_error).toBe(true)
    expect(toolResult.message.content[0].content).toContain('not public')
    const final = lines.find((line) => line.type === 'result')
    expect(final.is_error).toBe(false)
    expect(final.result).toBe('Done.')
  })
})
