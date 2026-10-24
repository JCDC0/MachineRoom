import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { buildPrompt, parseBriefs, parseRules } from '../src/briefs/briefs.js'
import { createMockClient } from '../src/control/mock.js'
import { makeTempDir } from './helpers/tempRoot.js'

const read = (name) => readFileSync(new URL(`../docs/agents/${name}`, import.meta.url), 'utf8')
const cleanups = []

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()()
})

async function startBridge(lanes) {
  const dir = makeTempDir('bridge-safety-')
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const briefsDir = join(dir, 'docs', 'agents')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(briefsDir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }))
  writeFileSync(join(briefsDir, 'TASKS.md'), '## Open\n\n**X1. Do the thing (AGY).** Text here.\n')
  writeFileSync(join(briefsDir, 'HOUSE-RULES.md'), read('HOUSE-RULES.md'))
  writeFileSync(join(briefsDir, 'lanes.json'), JSON.stringify(lanes))
  const bridge = createBridge({ port: 0, projectRoot: dir, paperclipUrl: 'http://127.0.0.1:1', companyId: 'company-1', reconnectMinMs: 60000, reconnectMaxMs: 60000 })
  const info = await bridge.start()
  cleanups.push(() => bridge.stop())
  return `http://127.0.0.1:${info.port}`
}

const goodLane = { name: 'agy', harness: 'agy', model: 'Gemini', worktree: 'C:\\x', role: 'You build.', forbidden: ['server/**'], notes: [] }

describe('briefs route with hostile or broken input', () => {
  it('refuses a lane name that only exists on every object, instead of crashing', async () => {
    const url = await startBridge({ agy: goodLane })
    for (const lane of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const response = await fetch(`${url}/api/control/brief-prompt?ids=X1&lane=${lane}`)
      expect(response.status, lane).toBe(400)
      expect(await response.json()).toEqual({ error: 'Choose hermes, opencode or agy.' })
    }
    expect((await fetch(`${url}/api/health`)).status).toBe(200)
  })

  it('answers a normal lane', async () => {
    const url = await startBridge({ agy: goodLane })
    const response = await fetch(`${url}/api/control/brief-prompt?ids=X1&lane=agy`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ lane: 'agy', model: 'Gemini', branch: 'feat/x1-do-the-thing' })
    expect(body.prompt).toContain('Commit with the prefix 1.2.4')
  })

  it('answers 500 for a bug inside a route and keeps running', async () => {
    const url = await startBridge({ agy: goodLane, broken: {} })
    const response = await fetch(`${url}/api/control/brief-prompt?ids=X1&lane=broken`, { headers: { Origin: 'http://localhost:5173' } })
    expect(response.status).toBe(500)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(await response.json()).toEqual({ error: 'The bridge could not answer that.' })
    expect((await fetch(`${url}/api/health`)).status).toBe(200)
    expect((await fetch(`${url}/api/control/brief-prompt?ids=X1&lane=agy`)).status).toBe(200)
  })
})

describe('prompt builders with hostile lane names', () => {
  const lanes = { agy: goodLane }
  const briefs = parseBriefs('**X1. Do the thing (AGY).** Text here.')
  const rules = parseRules(read('HOUSE-RULES.md'))

  it('buildPrompt refuses a name that is not an own lane', () => {
    for (const laneKey of ['__proto__', 'constructor', 'toString']) {
      expect(() => buildPrompt({ briefs, laneKey, lanes, rules, version: '0.1.1' }), laneKey).toThrow(/no lane/)
    }
  })

  it('the mock refuses them in plain words', async () => {
    const client = createMockClient({ latencyMs: 0 })
    for (const lane of ['__proto__', 'constructor']) await expect(client.briefPrompt(['C3e'], lane)).rejects.toThrow(/Choose hermes/)
  })
})

describe('a Paperclip that takes the request and never answers', () => {
  async function startSilentPaperclip() {
    const server = createServer(() => {})
    await new Promise((settle) => server.listen(0, '127.0.0.1', settle))
    cleanups.push(
      () =>
        new Promise((settle) => {
          server.closeAllConnections()
          server.close(() => settle())
        })
    )
    return `http://127.0.0.1:${server.address().port}`
  }

  it('answers the page within the time limit instead of holding the request open', async () => {
    const paperclipUrl = await startSilentPaperclip()
    const bridge = createBridge({
      port: 0,
      projectRoot: '',
      paperclipUrl,
      companyId: 'company-1',
      reconnectMinMs: 60000,
      reconnectMaxMs: 60000,
      surfaceEveryMs: 0,
      upstreamTimeoutMs: 200,
    })
    const info = await bridge.start()
    cleanups.push(() => bridge.stop())
    const url = `http://127.0.0.1:${info.port}`

    const agents = await fetch(`${url}/api/control/agents`, { signal: AbortSignal.timeout(3000) })
    expect(agents.status).toBe(200)
    expect(Array.isArray(await agents.json())).toBe(true)

    const task = await fetch(`${url}/api/control/approvals`, { signal: AbortSignal.timeout(3000) })
    expect(task.status).toBe(200)
    expect(await task.json()).toEqual([])

    const list = await fetch(`${url}/api/agents`, { signal: AbortSignal.timeout(3000) })
    expect(list.status).toBe(502)
  })
})

describe('ids that are not valid percent-escapes', () => {
  it('answers the not-found sentence for an approval or an agent', async () => {
    const url = await startBridge({ agy: goodLane })
    const post = (path, body) =>
      fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const decided = await post('/api/control/approvals/%E0%A4%A/decide', { decision: 'approve' })
    expect(decided.status).toBe(404)
    expect(await decided.json()).toEqual({ error: 'That approval no longer exists.' })
    const budget = await post('/api/control/agents/%E0%A4%A/budget', { budgetMonthlyCents: 100 })
    expect(budget.status).toBe(404)
    expect(await budget.json()).toEqual({ error: 'That agent no longer exists.' })
  })
})
