import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { MOCK_POLICY } from '../src/control/mock.js'
import { makeTempDir } from './helpers/tempRoot.js'

const POLICY = {
  tiers: {
    small: [
      { lane: 'opencode2', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
      { lane: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
    ],
    medium: [
      { lane: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
      { lane: 'claude', model: 'sonnet', reasoning: 'high', provider: 'anthropic' },
    ],
    large: [
      { lane: 'claude', model: 'opus', reasoning: 'high', provider: 'anthropic' },
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

function tempDir(prefix = 'mr-policy-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function writeRuns(base, costs) {
  const folder = join(base, 'machineroom-runs')
  mkdirSync(folder, { recursive: true })
  const startedAt = new Date().toISOString()
  const lines = costs.map((costUsd) => JSON.stringify({ lane: 'opencode', startedAt, costUsd }))
  writeFileSync(join(folder, 'runs.jsonl'), `${lines.join('\n')}\n`)
}

async function startRouteBridge({ policy = JSON.stringify(POLICY), costs = [] } = {}) {
  const briefsDir = tempDir()
  if (policy !== null) writeFileSync(join(briefsDir, 'policy.json'), policy)
  const base = tempDir()
  if (costs.length > 0) writeRuns(base, costs)
  const previousTemp = process.env.TEMP
  const previousRuns = process.env.MACHINEROOM_RUNS
  process.env.TEMP = base
  process.env.MACHINEROOM_RUNS = join(base, 'machineroom-runs')
  cleanups.push(() => {
    process.env.TEMP = previousTemp
    if (previousRuns === undefined) delete process.env.MACHINEROOM_RUNS
    else process.env.MACHINEROOM_RUNS = previousRuns
  })
  const bridge = createBridge({
    projectRoot: '',
    briefsDir,
    port: 0,
    env: {},
    reconnectMinMs: 60000,
    reconnectMaxMs: 60000,
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, briefsDir, base }
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
    const missing = await startRouteBridge({ policy: null })
    const missingAnswer = await postRoute(missing.url, { profile: SMALL })
    expect(missingAnswer.status).toBe(404)
    expect(missingAnswer.body).toEqual({ error: 'The policy file is missing.' })

    const broken = await startRouteBridge({ policy: '{' })
    const brokenAnswer = await postRoute(broken.url, { profile: SMALL })
    expect(brokenAnswer.status).toBe(400)
    expect(brokenAnswer.body).toEqual({ error: 'The policy file is not JSON.' })

    const bad = await startRouteBridge({ policy: JSON.stringify({ ...POLICY, quotaSkipPercent: 200 }) })
    const badAnswer = await postRoute(bad.url, { profile: SMALL })
    expect(badAnswer.status).toBe(400)
    expect(badAnswer.body).toEqual({ error: 'policy.quotaSkipPercent must be a number from 0 to 100.' })
  })

  it('refuses a profile that is not an object', async () => {
    const { url } = await startRouteBridge()
    for (const profile of [undefined, null, 'small', 5, ['small']]) {
      const answer = await postRoute(url, { profile })
      expect(answer.status, String(profile)).toBe(400)
      expect(answer.body, String(profile)).toEqual({ error: 'Describe the task first.' })
    }
  })

  it('refuses failures that are not a whole number from 0 to 5', async () => {
    const { url } = await startRouteBridge()
    for (const failures of [-1, 1.5, 6, '2', null]) {
      const answer = await postRoute(url, { profile: SMALL, failures })
      expect(answer.status, String(failures)).toBe(400)
      expect(answer.body, String(failures)).toEqual({ error: 'Failures must be a whole number from 0 to 5.' })
    }
  })

  it('routes from the policy with no spend in the lane records', async () => {
    const { url } = await startRouteBridge()
    const answer = await postRoute(url, { profile: MEDIUM, failures: 0 })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({
      tier: 'medium',
      choice: { lane: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
      reason: 'The medium tier runs opencode on opencode-go/deepseek-v4.1-flash at max.',
    })
  })

  it('escalates a failure to the next tier', async () => {
    const { url } = await startRouteBridge()
    const answer = await postRoute(url, { profile: SMALL, failures: 1 })
    expect(answer.body.tier).toBe('medium')
    expect(answer.body.choice.lane).toBe('opencode')
    expect(answer.body.reason).toBe('The medium tier runs opencode on opencode-go/deepseek-v4.1-flash at max. Escalated from the small tier after 1 failure.')
  })

  it('routes without a choice when the lane records reach the company limit', async () => {
    const { url } = await startRouteBridge({ costs: [20, 10] })
    const answer = await postRoute(url, { profile: MEDIUM })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({
      tier: 'medium',
      choice: null,
      reason: 'The company has spent $30.00 of its $30.00 monthly limit.',
    })
  })

  it('does not skip a provider, since the lane records carry no quota window', async () => {
    const { url } = await startRouteBridge()
    const answer = await postRoute(url, { profile: SMALL })
    expect(answer.body.choice).toEqual({
      lane: 'opencode2',
      model: 'opencode-go/deepseek-v4.1-flash',
      reasoning: 'max',
      provider: 'opencode',
    })
  })
})

describe('the mock policy', () => {
  it('is a copy of the real policy file', () => {
    const text = readFileSync(new URL('../docs/agents/policy.json', import.meta.url), 'utf8')
    expect(MOCK_POLICY).toEqual(JSON.parse(text))
  })
})
