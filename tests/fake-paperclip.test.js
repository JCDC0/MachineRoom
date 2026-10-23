import { afterEach, describe, expect, it } from 'vitest'
import { PAPERCLIP_SURFACE, compareSurface, surfaceFeatures } from '../server/surface.js'
import {
  DEFAULT_PORT,
  DEFAULT_SPEED,
  LIVE_CHUNK_LIMIT,
  backupName,
  fakeSpec,
  loadScripts,
  parseFakeArgs,
  startFakePaperclip,
  startupLines,
} from '../scripts/fake-paperclip.mjs'
import { waitFor } from './helpers/loop.js'
import { makeTempDir } from './helpers/tempRoot.js'

const fakes = []

async function fake(options = {}) {
  const started = await startFakePaperclip({ speed: 1000, ...options, port: 0 })
  fakes.push(started)
  return started
}

afterEach(async () => {
  while (fakes.length > 0) await fakes.pop().stop()
})

async function call(url, method = 'GET', body) {
  const init = { method, signal: AbortSignal.timeout(10000) }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const response = await fetch(url, init)
  return { status: response.status, body: await response.json() }
}

function listen(url, companyId) {
  const frames = []
  const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/api/companies/${companyId}/events/ws`)
  socket.addEventListener('message', (event) => frames.push(JSON.parse(event.data)))
  const opened = new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen)
    socket.addEventListener('error', rejectOpen)
  })
  return { frames, opened, close: () => socket.close() }
}

describe('parseFakeArgs', () => {
  it('has defaults', () => {
    expect(parseFakeArgs([])).toEqual({ port: DEFAULT_PORT, speed: DEFAULT_SPEED, missing: [], slow: [], fail: [], help: false })
  })

  it('reads the port, the speed and route lists with an optional method', () => {
    const options = parseFakeArgs([
      '--port',
      '0',
      '--speed',
      '2.5',
      '--missing',
      '/api/companies/{companyId}/approvals,GET /api/approvals/{id}',
      '--slow',
      '/api/companies/{companyId}/agents',
      '--fail',
      'post /api/instance/database-backups',
    ])
    expect(options.port).toBe(0)
    expect(options.speed).toBe(2.5)
    expect(options.missing).toEqual([
      { method: null, path: '/api/companies/{companyId}/approvals' },
      { method: 'GET', path: '/api/approvals/{id}' },
    ])
    expect(options.slow).toEqual([{ method: null, path: '/api/companies/{companyId}/agents' }])
    expect(options.fail).toEqual([{ method: 'POST', path: '/api/instance/database-backups' }])
  })

  it('refuses bad input with a sentence', () => {
    expect(() => parseFakeArgs(['--port', 'x'])).toThrow('--port needs a whole number from 0 to 65535.')
    expect(() => parseFakeArgs(['--speed', '0'])).toThrow('--speed needs a number above 0.')
    expect(() => parseFakeArgs(['--slow'])).toThrow('--slow needs a value.')
    expect(() => parseFakeArgs(['--loud'])).toThrow('Unknown option --loud.')
    expect(() => parseFakeArgs(['--missing', '/api/nope'])).toThrow('--missing names /api/nope, which is not a route in server/surface.js.')
    expect(() => parseFakeArgs(['--fail', 'DELETE /api/companies'])).toThrow('which is not a route in server/surface.js.')
    expect(() => parseFakeArgs(['--fail', 'approvals'])).toThrow('--fail needs a route such as')
  })
})

describe('fakeSpec', () => {
  it('lists every route the bridge uses', () => {
    const result = compareSurface(fakeSpec())
    expect(result.ok).toBe(true)
    expect(result.checked).toBe(PAPERCLIP_SURFACE.filter((route) => !route.socket).length)
    expect(result.untypedAnswers).toBe(0)
    expect(result.untypedBodies).toBe(0)
  })

  it('leaves out the missing routes and turns their feature off', () => {
    const result = compareSurface(fakeSpec({ missing: parseFakeArgs(['--missing', 'POST /api/instance/database-backups']).missing }))
    expect(result.missing).toEqual([{ method: 'POST', path: '/api/instance/database-backups', reason: 'route' }])
    expect(surfaceFeatures(result)).toMatchObject({ backup: false, room: true, approvals: true })
  })
})

describe('the fake Paperclip server', () => {
  it('answers like Paperclip and prints how to see the room', async () => {
    const paperclip = await fake()
    const health = await call(`${paperclip.url}/api/health`)
    expect(health.body).toMatchObject({ status: 'ok', databaseBackup: { enabled: true, status: 'ok' } })
    expect(health.body.databaseBackup.latestBackup.name).toMatch(/^paperclip-\d{8}-\d{6}\.sql\.gz$/)
    expect((await call(`${paperclip.url}/api/companies`)).body.map((company) => company.id)).toEqual([paperclip.companyId])
    expect((await call(`${paperclip.url}/api/companies/other/agents`)).status).toBe(404)
    expect((await call(`${paperclip.url}/api/nothing`)).status).toBe(404)
    const lines = startupLines(paperclip)
    expect(lines).toContain(`Company: ${paperclip.companyId}`)
    expect(lines).toContain(`npm run serve -- --paperclip ${paperclip.url} --company ${paperclip.companyId}`)
  })

  it('answers 404 on a missing route and 500 on a failing one', async () => {
    const options = parseFakeArgs(['--missing', '/api/companies/{companyId}/approvals', '--fail', '/api/companies/{companyId}/costs/summary'])
    const paperclip = await fake(options)
    expect((await call(`${paperclip.url}/api/companies/${paperclip.companyId}/approvals`)).status).toBe(404)
    expect((await call(`${paperclip.url}/api/companies/${paperclip.companyId}/costs/summary`)).status).toBe(500)
    expect((await call(`${paperclip.url}/api/companies/${paperclip.companyId}/costs/by-agent`)).status).toBe(200)
  })

  it('makes a new backup name each time', async () => {
    const paperclip = await fake()
    const first = await call(`${paperclip.url}/api/instance/database-backups`, 'POST')
    const second = await call(`${paperclip.url}/api/instance/database-backups`, 'POST')
    expect(first.status).toBe(201)
    expect(first.body.backupFile).not.toBe(second.body.backupFile)
    expect(backupName(Date.UTC(2026, 9, 21, 12, 0, 0))).toMatch(/^paperclip-202610\d\d-\d{6}\.sql\.gz$/)
  })

  it('plays the built-in script when no recording fits', async () => {
    const paperclip = await fake({ fixturesDir: makeTempDir('mr-fake-empty-') })
    expect(paperclip.scripts.size).toBe(0)
    const link = listen(paperclip.url, paperclip.companyId)
    await link.opened
    const agent = paperclip.agents[0]
    const created = await call(`${paperclip.url}/api/companies/${paperclip.companyId}/issues`, 'POST', {
      title: 'Say hello',
      assigneeAgentId: agent.id,
      status: 'todo',
    })
    expect(created.status).toBe(201)
    await paperclip.runsDone()
    await waitFor(() => link.frames.some((frame) => frame.payload?.status === 'succeeded'), { what: 'the end of the run' })
    const types = link.frames.map((frame) => frame.type)
    expect(types).toContain('heartbeat.run.queued')
    const logs = link.frames.filter((frame) => frame.type === 'heartbeat.run.log')
    expect(logs.map((frame) => frame.payload.seq)).toEqual([1, 2, 3, 4, 5])
    expect(logs[1].payload.chunk).toContain('Say hello')
    const statuses = link.frames.filter((frame) => frame.type === 'heartbeat.run.status').map((frame) => frame.payload.status)
    expect(statuses).toEqual(['running', 'succeeded'])
    const comments = await call(`${paperclip.url}/api/issues/${created.body.id}/comments`)
    expect(comments.body[0]).toMatchObject({ authorAgentId: agent.id })
    expect(comments.body[0].body).toContain('built-in')
    link.close()
  })

  it('cuts a long chunk on the socket and keeps the whole one in the run log', async () => {
    const long = `${'x'.repeat(LIVE_CHUNK_LIMIT + 500)}\n`
    const scripts = new Map([['claude_local', { source: 'test', steps: [{ type: 'heartbeat.run.log', gapMs: 0, payload: { seq: 1, stream: 'stdout', chunk: long, truncated: false } }] }]])
    const paperclip = await fake({ scripts })
    const link = listen(paperclip.url, paperclip.companyId)
    await link.opened
    await call(`${paperclip.url}/api/companies/${paperclip.companyId}/issues`, 'POST', {
      title: 'Long line',
      assigneeAgentId: paperclip.agents[0].id,
      status: 'todo',
    })
    await paperclip.runsDone()
    await waitFor(() => link.frames.some((frame) => frame.type === 'heartbeat.run.log'), { what: 'the log frame' })
    const cut = link.frames.find((frame) => frame.type === 'heartbeat.run.log')
    expect(cut.payload).toMatchObject({ truncated: true, seq: 1 })
    expect(cut.payload.chunk).toHaveLength(LIVE_CHUNK_LIMIT)
    const log = await call(`${paperclip.url}/api/heartbeat-runs/${cut.payload.runId}/log?offset=0`)
    const entry = JSON.parse(log.body.content.trim())
    expect(entry).toMatchObject({ seq: 1, chunk: long })
    const rest = await call(`${paperclip.url}/api/heartbeat-runs/${cut.payload.runId}/log?offset=${log.body.nextOffset}`)
    expect(rest.body.content).toBe('')
    link.close()
  })

  it('lists five agents, with the orchestrator as the chief', async () => {
    const paperclip = await fake()
    expect(paperclip.agents).toHaveLength(5)
    const orchestrator = paperclip.agents.find((agent) => agent.urlKey === 'orchestrator')
    expect(orchestrator).toMatchObject({
      name: 'Orchestrator',
      adapterType: 'opencode_local',
      role: 'ceo',
      adapterConfig: { model: 'opencode/fake-free' },
    })
    const listed = await call(`${paperclip.url}/api/companies/${paperclip.companyId}/agents`)
    expect(listed.body.map((agent) => agent.name)).toEqual(['Claude Code', 'Hermes', 'OpenCode Go', 'agy', 'Orchestrator'])
    expect(startupLines(paperclip)).toContain('Agent: Orchestrator (opencode_local), runs scenario-e-run.jsonl')
  })

  it('reads a run script for each harness and per agent from the recordings', () => {
    const scripts = loadScripts()
    const sources = Object.fromEntries([...scripts].map(([key, script]) => [key, script.source]))
    expect(sources).toEqual({
      agy: 'scenario-f-run.jsonl',
      claude_local: 'sandbox-run.jsonl',
      hermes_local: 'sandbox-run.jsonl',
      opencode_local: 'sandbox-run.jsonl',
      process: 'sandbox-run.jsonl',
      orchestrator: 'scenario-e-run.jsonl',
      'opencode-go': 'scenario-e-run.jsonl',
    })
    const logs = (script) => script.steps.filter((step) => step.type === 'heartbeat.run.log')
    expect(logs(scripts.get('orchestrator'))).toHaveLength(2)
    expect(logs(scripts.get('opencode-go'))).toHaveLength(3)
    expect(logs(scripts.get('opencode-go')).map((step) => step.payload.chunk).join('').match(/"tool":"subagent"/g)).toHaveLength(2)
    expect(scripts.has('claude-code')).toBe(false)
  })
})
