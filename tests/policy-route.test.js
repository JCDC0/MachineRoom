import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { MOCK_POLICY } from '../src/control/mock.js'
import { makeTempDir } from './helpers/tempRoot.js'

const POLICY = {
  tiers: {
    small: [
      { lane: 'opencode2', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
      { lane: 'agy', model: 'Gemini 3.8 Flash (High)', reasoning: 'high', provider: 'antigravity' },
    ],
    medium: [
      { lane: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
      { lane: 'agy', model: 'Gemini 3.8 Flash (High)', reasoning: 'high', provider: 'antigravity' },
    ],
    large: [
      { lane: 'agy', model: 'Gemini 4 Argon (Medium)', reasoning: 'medium', provider: 'antigravity' },
      { lane: 'owner', model: null, reasoning: null, provider: null },
    ],
  },
  limits: {
    runUsd: 0.25,
    issueUsd: 1,
    agentMonthlyUsd: 10,
    companyMonthlyUsd: 30,
    maxTurnsPerRun: 200,
    timeoutSec: 3600,
  },
  quotaSkipPercent: 90,
}

const SMALL = { files: 1, hasTests: true, clarity: 'clear', reversible: true, touchesSecrets: false, touchesDeploy: false }
const MEDIUM = { files: 5, hasTests: true, clarity: 'clear', reversible: true, touchesSecrets: false, touchesDeploy: false }

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

async function startPaperclip({ summary = { spendCents: 0, budgetCents: 100000 }, quota = [] } = {}) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/api/companies/comp-1/costs/summary') {
      sendJson(res, 200, summary)
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/companies/comp-1/costs/quota-windows') {
      sendJson(res, 200, quota)
      return
    }
    sendJson(res, 404, { error: 'not found' })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const fake = {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
  cleanups.push(fake.close)
  return fake
}

async function startRouteBridge({ policy = JSON.stringify(POLICY), paperclipUrl }) {
  const briefsDir = makeTempDir('mr-policy-')
  cleanups.push(() => rmSync(briefsDir, { recursive: true, force: true }))
  if (policy !== null) writeFileSync(join(briefsDir, 'policy.json'), policy)
  const bridge = createBridge({
    paperclipUrl,
    companyId: 'comp-1',
    projectRoot: '',
    briefsDir,
    port: 0,
    surfaceEveryMs: 0,
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, briefsDir }
}

async function postRoute(url, body) {
  const response = await fetch(`${url}/api/control/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

describe('POST /api/control/route', () => {
  it('refuses a missing, a broken and a bad policy file', async () => {
    const paperclip = await startPaperclip()

    const missing = await startRouteBridge({ policy: null, paperclipUrl: paperclip.url })
    const missingAnswer = await postRoute(missing.url, { profile: SMALL })
    expect(missingAnswer.status).toBe(404)
    expect(missingAnswer.body).toEqual({ error: 'The policy file is missing.' })

    const broken = await startRouteBridge({ policy: '{', paperclipUrl: paperclip.url })
    const brokenAnswer = await postRoute(broken.url, { profile: SMALL })
    expect(brokenAnswer.status).toBe(400)
    expect(brokenAnswer.body).toEqual({ error: 'The policy file is not JSON.' })

    const bad = await startRouteBridge({ policy: JSON.stringify({ ...POLICY, quotaSkipPercent: 200 }), paperclipUrl: paperclip.url })
    const badAnswer = await postRoute(bad.url, { profile: SMALL })
    expect(badAnswer.status).toBe(400)
    expect(badAnswer.body).toEqual({ error: 'policy.quotaSkipPercent must be a number from 0 to 100.' })
  })

  it('refuses a profile that is not an object', async () => {
    const paperclip = await startPaperclip()
    const { url } = await startRouteBridge({ paperclipUrl: paperclip.url })
    for (const profile of [undefined, null, 'small', 5, ['small']]) {
      const answer = await postRoute(url, { profile })
      expect(answer.status, String(profile)).toBe(400)
      expect(answer.body, String(profile)).toEqual({ error: 'Describe the task first.' })
    }
  })

  it('refuses failures that are not a whole number from 0 to 5', async () => {
    const paperclip = await startPaperclip()
    const { url } = await startRouteBridge({ paperclipUrl: paperclip.url })
    for (const failures of [-1, 1.5, 6, '2', null]) {
      const answer = await postRoute(url, { profile: SMALL, failures })
      expect(answer.status, String(failures)).toBe(400)
      expect(answer.body, String(failures)).toEqual({ error: 'Failures must be a whole number from 0 to 5.' })
    }
  })

  it('routes from the policy with the quota and the spend from Paperclip', async () => {
    const paperclip = await startPaperclip({ summary: { spendCents: 2500, budgetCents: 100000 } })
    const { url } = await startRouteBridge({ paperclipUrl: paperclip.url })
    const answer = await postRoute(url, { profile: MEDIUM, failures: 0 })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({
      tier: 'medium',
      choice: { lane: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
      reason: 'The medium tier runs opencode on opencode-go/deepseek-v4.1-flash at max.',
    })
  })

  it('skips a provider above 90 percent and a provider it could not read', async () => {
    const paperclip = await startPaperclip({
      quota: [
        { provider: 'opencode', ok: true, windows: [{ label: 'Current week', usedPercent: 97, resetsAt: null, detail: null }] },
        { provider: 'antigravity', ok: false, error: 'Usage not available', windows: [{ label: 'Current week', usedPercent: 100 }] },
      ],
    })
    const { url } = await startRouteBridge({ paperclipUrl: paperclip.url })
    const answer = await postRoute(url, { profile: MEDIUM })
    expect(answer.status).toBe(200)
    expect(answer.body.tier).toBe('medium')
    expect(answer.body.choice).toEqual({
      lane: 'agy',
      model: 'Gemini 3.8 Flash (High)',
      reasoning: 'high',
      provider: 'antigravity',
    })
  })

  it('routes without a choice when the company spent its monthly limit', async () => {
    const paperclip = await startPaperclip({ summary: { spendCents: 3000, budgetCents: 100000 } })
    const { url } = await startRouteBridge({ paperclipUrl: paperclip.url })
    const answer = await postRoute(url, { profile: MEDIUM })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({
      tier: 'medium',
      choice: null,
      reason: 'The company has spent $30.00 of its $30.00 monthly limit.',
    })
  })

  it('says quota and spend were not read when Paperclip is down', async () => {
    const { url } = await startRouteBridge({ paperclipUrl: 'http://127.0.0.1:1' })
    const answer = await postRoute(url, { profile: MEDIUM })
    expect(answer.status).toBe(200)
    expect(answer.body.choice).toEqual({
      lane: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
      reasoning: 'max',
      provider: 'opencode',
    })
    expect(answer.body.reason).toBe(
      'The medium tier runs opencode on opencode-go/deepseek-v4.1-flash at max. Quota and spend were not read.'
    )
  })
})

describe('the mock policy', () => {
  it('is a copy of the real policy file', () => {
    const text = readFileSync(new URL('../docs/agents/policy.json', import.meta.url), 'utf8')
    expect(MOCK_POLICY).toEqual(JSON.parse(text))
  })
})
