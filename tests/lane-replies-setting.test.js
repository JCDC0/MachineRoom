import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentsConfigApi } from '../server/agents-config.js'
import { readHarnessSettings, saveHarnessSettings } from '../server/harness-settings.js'
import { killTree } from '../server/processTree.js'
import { createRunsApi } from '../server/runs.js'
import { createMockClient } from '../src/control/mock.js'
import HarnessesSettings from '../src/ui/HarnessesSettings.jsx'
import { waitFor } from './helpers/bridge.js'
import { settle, type, withDom } from './helpers/uiDom.js'

const SCRIPT = fileURLToPath(new URL('../scripts/mr-agent.mjs', import.meta.url))
const dirs = []
const cleanups = []
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'mr-lane-replies-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function api(folder) {
  const instance = createAgentsConfigApi({
    runsFolder: folder,
    lanes: {},
    env: { PATH: '' },
    readJsonBody: async (req) => req.body,
    sendJson: (req, res, status, body) => {
      res.status = status
      res.body = body
    },
  })
  return async (path, body, origin = 'http://localhost') => {
    const res = {}
    await instance.handle({ method: body ? 'POST' : 'GET', headers: origin ? { origin } : {}, body }, res, new URL(path, 'http://localhost'))
    return res
  }
}

const rows = [
  {
    key: 'claude',
    name: 'Claude Code',
    available: true,
    ready: true,
    enabled: true,
    program: 'claude',
    version: '2.1.0',
    reason: '',
    laneReplies: 'next-turn',
  },
  {
    key: 'machineroom',
    name: 'MachineRoom',
    available: false,
    ready: false,
    enabled: true,
    program: '',
    version: '',
    reason: 'No key is saved.',
    laneReplies: 'next-turn',
  },
]

function fakeClient() {
  return {
    harnesses: vi.fn().mockResolvedValue(rows),
    harnessSettings: vi.fn().mockImplementation(async ({ laneReplies }) => rows.map((row) => ({ ...row, laneReplies }))),
  }
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
      id: `call_${index}`,
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

function startBridge(handler) {
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', async () => {
      let parsed = null
      try {
        parsed = body === '' ? null : JSON.parse(body)
      } catch {}
      const record = { method: req.method, url: req.url, headers: req.headers, body: parsed }
      requests.push(record)
      const answer = await handler(req, res, record)
      if (answer?.hold) return
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(answer?.body ?? answer))
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
      const { port } = server.address()
      done({ url: `http://127.0.0.1:${port}`, requests, server })
    })
  })
}

function chatCalls(requests) {
  return requests.filter((record) => record.url === '/v1/chat/completions')
}

function runAgent({ folder, env = {}, seconds = 20 }) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [SCRIPT, '--model', 'test/model', '--cwd', folder, 'Do the task.'], {
      cwd: folder,
      env: { ...baseEnvironment(), ...env },
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

function agentEnv(bridge, replies) {
  return {
    MACHINEROOM_API_URL: `${bridge.url}/v1`,
    MACHINEROOM_API_KEY: 'test-key',
    MACHINEROOM_BRIDGE: bridge.url,
    MACHINEROOM_LANE_TICKET: 'ticket-1',
    MACHINEROOM_LANE_REPLIES: replies,
  }
}

const MESSAGE = { from: 'lane:main', text: 'Stop and read this.', at: '2026-11-16T10:00:00.000Z' }

describe('the native agent and the reply choice', () => {
  it('interrupts a slow model call when a message arrives and carries it into the next call', async () => {
    const folder = setup()
    let aborted = false
    const bridge = await startBridge(async (req, res, record) => {
      if (record.url === '/api/orchestrator/messages') return { messages: [MESSAGE] }
      if (chatCalls(bridge.requests).length === 1) {
        res.on('close', () => {
          if (!res.writableEnded) aborted = true
        })
        return { hold: true }
      }
      return chatAnswer({ text: 'Done.' })
    })

    const result = await runAgent({ folder, env: agentEnv(bridge, 'interrupt') })

    expect(result.code).toBe(0)
    expect(aborted).toBe(true)
    const calls = chatCalls(bridge.requests)
    expect(calls).toHaveLength(2)
    expect(JSON.stringify(calls[1].body.messages)).toContain('Messages for you while you work:')
    expect(JSON.stringify(calls[1].body.messages)).toContain('Stop and read this.')
    expect(result.stdout).toContain('"result":"Done."')
  }, 30000)

  it('carries a reply read while the model call ended into the next call', async () => {
    const folder = setup()
    writeFileSync(join(folder, 'a.txt'), 'hello\n')
    let inboxRead = null
    const inboxStarted = new Promise((resolve) => {
      inboxRead = resolve
    })
    const bridge = await startBridge(async (req, res, record) => {
      if (record.url === '/api/orchestrator/messages') {
        inboxRead()
        await new Promise((done) => setTimeout(done, 800))
        return { messages: [MESSAGE] }
      }
      if (chatCalls(bridge.requests).length === 1) {
        await inboxStarted
        await new Promise((done) => setTimeout(done, 300))
        return chatAnswer({ calls: [{ name: 'read_file', arguments: { path: 'a.txt' } }] })
      }
      return chatAnswer({ text: 'Done.' })
    })

    const result = await runAgent({ folder, env: agentEnv(bridge, 'interrupt') })

    expect(result.code).toBe(0)
    const calls = chatCalls(bridge.requests)
    expect(calls.length).toBeGreaterThanOrEqual(2)
    const second = JSON.stringify(calls[1].body.messages)
    expect(second).toContain('Messages for you while you work:')
    expect(second).toContain('Stop and read this.')
    expect(result.stdout).toContain('"result":"Done."')
  }, 30000)

  it('waits for the model call to end with next-turn', async () => {
    const folder = setup()
    writeFileSync(join(folder, 'a.txt'), 'hello\n')
    const bridge = await startBridge(async (req, res, record) => {
      if (record.url === '/api/orchestrator/messages') return { messages: [MESSAGE] }
      if (chatCalls(bridge.requests).length === 1) {
        await new Promise((done) => setTimeout(done, 1300))
        return chatAnswer({ calls: [{ name: 'read_file', arguments: { path: 'a.txt' } }] })
      }
      return chatAnswer({ text: 'Done.' })
    })

    const result = await runAgent({ folder, env: agentEnv(bridge, 'next-turn') })

    expect(result.code).toBe(0)
    const calls = chatCalls(bridge.requests)
    expect(calls).toHaveLength(2)
    const second = calls[1].body.messages
    expect(second.some((message) => message.role === 'tool')).toBe(true)
    expect(JSON.stringify(second)).toContain('Stop and read this.')
  }, 30000)
})

describe('the reply choice in harness settings', () => {
  it('reads next-turn when the file has no choice or an unknown one', () => {
    const dir = setup()
    expect(readHarnessSettings(dir).laneReplies).toBe('next-turn')
    saveHarnessSettings(dir, { programs: {}, off: [], laneReplies: 'interrupt' })
    expect(readHarnessSettings(dir).laneReplies).toBe('interrupt')
    writeFileSync(join(dir, 'harnesses.json'), JSON.stringify({ laneReplies: 'sometimes' }))
    expect(readHarnessSettings(dir).laneReplies).toBe('next-turn')
  })

  it('saves the choice through the Settings route and reads it back', async () => {
    const dir = setup()
    const request = api(dir)
    expect((await request('/api/harnesses')).body.every((row) => row.laneReplies === 'next-turn')).toBe(true)

    const saved = await request('/api/harnesses/settings', { confirmed: true, laneReplies: 'interrupt' })
    expect(saved.status).toBe(200)
    expect(saved.body.every((row) => row.laneReplies === 'interrupt')).toBe(true)
    expect(readHarnessSettings(dir).laneReplies).toBe('interrupt')

    const listed = (await request('/api/harnesses')).body
    expect(listed.every((row) => row.laneReplies === 'interrupt')).toBe(true)

    expect((await request('/api/harnesses/settings', { confirmed: true, laneReplies: 'sometimes' })).status).toBe(400)
    expect((await request('/api/harnesses/settings', { confirmed: true, laneReplies: 'interrupt' }, '')).status).toBe(403)
  })

  it('passes the saved choice to a lane run the bridge starts', async () => {
    const root = setup()
    const runs = join(root, 'runs')
    mkdirSync(runs)
    saveHarnessSettings(runs, { programs: {}, off: [], laneReplies: 'interrupt' })
    const lanesFile = join(root, 'lanes.json')
    writeFileSync(lanesFile, JSON.stringify({ coder: { name: 'Coder', cli: { harness: 'opencode', bin: 'opencode' } } }))
    const out = join(root, 'replies.txt')
    const script = join(root, 'runner.mjs')
    writeFileSync(script, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(out)}, String(process.env.MACHINEROOM_LANE_REPLIES ?? ''))`)
    let body = null
    let answer = null
    const api = createRunsApi({
      projectRoot: root,
      lanesFile,
      runsFolder: runs,
      runnerCommand: { file: process.execPath, args: [script] },
      activeLanes: { isChosen: () => true, isLaneActive: () => true },
      orchestrators: () => ({ idForToken: () => 'orchestrator', sectorForLane: () => null }),
      readJsonBody: async () => body,
      sendJson: (req, res, status, result) => {
        answer = { status, body: result }
      },
    })
    cleanups.push(() => api.stopAll())

    body = { lane: 'coder', task: 'Work', confirmed: true }
    await api.handle({ method: 'POST', headers: { origin: 'http://localhost:5173' } }, {}, new URL('http://localhost/api/control/runs'))
    expect(answer.status).toBe(202)
    const saved = await waitFor(() => {
      try {
        return readFileSync(out, 'utf8')
      } catch {
        return ''
      }
    }, { what: 'the lane runner environment' })
    expect(saved).toBe('interrupt')
    await waitFor(() => !api.isRunning('coder'), { what: 'the run end' })
  })
})

describe('the reply choice in Settings', () => {
  it('saves the choice in the mock client and reads it back', async () => {
    const client = createMockClient({ latencyMs: 0 })
    expect((await client.harnesses()).every((row) => row.laneReplies === 'next-turn')).toBe(true)
    const saved = await client.harnessSettings({ laneReplies: 'interrupt', confirmed: true })
    expect(saved.harnesses.every((row) => row.laneReplies === 'interrupt')).toBe(true)
    expect((await client.harnesses()).every((row) => row.laneReplies === 'interrupt')).toBe(true)
    await expect(client.harnessSettings({ laneReplies: 'sometimes', confirmed: true })).rejects.toThrow()
  })

  it('shows the select and saves the choice', async () => {
    const client = fakeClient()
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(HarnessesSettings, { client }))
      })
      await settle()

      const select = container.querySelector('#harness-lane-replies')
      expect(select).not.toBeNull()
      expect(container.textContent).toContain('Replies to a working lane')
      const options = select.querySelectorAll('option')
      expect(options.map((option) => option.textContent)).toEqual(['Wait for its next turn', 'Interrupt it at once'])

      await type(root, select, 'interrupt')
      await settle()

      expect(client.harnessSettings).toHaveBeenCalledWith({ laneReplies: 'interrupt', confirmed: true })
    })
  })
})
