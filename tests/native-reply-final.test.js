import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { killTree } from '../server/processTree.js'

const SCRIPT = fileURLToPath(new URL('../scripts/mr-agent.mjs', import.meta.url))
const dirs = []
const servers = []
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close()
    server.closeAllConnections?.()
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function answer(text) {
  return {
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }
}

function startBridge(handler) {
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', async () => {
      const record = { url: req.url, body: body === '' ? null : JSON.parse(body) }
      requests.push(record)
      const reply = await handler(record, requests)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(reply))
    })
  })
  servers.push(server)
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => done({ url: `http://127.0.0.1:${server.address().port}`, requests }))
  })
}

function runAgent(folder, bridge) {
  return new Promise((done, fail) => {
    const env = { ...process.env, MACHINEROOM_API_URL: `${bridge.url}/v1`, MACHINEROOM_API_KEY: 'test-key', MACHINEROOM_BRIDGE: bridge.url, MACHINEROOM_LANE_TICKET: 'ticket-1', MACHINEROOM_LANE_REPLIES: 'interrupt' }
    const child = spawn(process.execPath, [SCRIPT, '--model', 'test/model', '--cwd', folder, 'Do the task.'], { cwd: folder, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    const timer = setTimeout(() => {
      killTree(child)
      fail(new Error('mr-agent did not exit'))
    }, 20000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      done({ code, stdout })
    })
  })
}

describe('a native final answer and a reply read at the same time', () => {
  it('delivers the reply and makes one more model call', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'mr-native-final-'))
    dirs.push(folder)
    let inboxStarted
    const started = new Promise((resolve) => {
      inboxStarted = resolve
    })
    const bridge = await startBridge(async (record, requests) => {
      if (record.url === '/api/orchestrator/messages') {
        inboxStarted()
        await new Promise((done) => setTimeout(done, 800))
        return { messages: [{ from: 'lane:main', text: 'Also check the docs.', at: '2026-11-16T10:00:00.000Z' }] }
      }
      if (requests.filter((r) => r.url === '/v1/chat/completions').length === 1) {
        await started
        await new Promise((done) => setTimeout(done, 300))
        return answer('First answer.')
      }
      return answer('Second answer.')
    })

    const result = await runAgent(folder, bridge)

    expect(result.code).toBe(0)
    const calls = bridge.requests.filter((r) => r.url === '/v1/chat/completions')
    expect(calls).toHaveLength(2)
    expect(JSON.stringify(calls[1].body.messages)).toContain('Also check the docs.')
    expect(result.stdout).toContain('"result":"Second answer."')
  }, 30000)
})
