import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { saveAgentsConfig } from '../server/agents-config.js'
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

function writeRuns(folder, costs) {
  mkdirSync(folder, { recursive: true })
  const startedAt = new Date().toISOString()
  const lines = costs.map((costUsd) => JSON.stringify({ lane: 'opencode', startedAt, costUsd }))
  writeFileSync(join(folder, 'runs.jsonl'), `${lines.join('\n')}\n`)
}

async function startRouteBridge({
  policy = JSON.stringify(POLICY),
  costs = [],
  lanes = null,
  projectLanes = null,
  tasks = null,
  active = null,
  lock = '',
  runsFolder = null,
  agents = null,
  removed = [],
} = {}) {
  const briefsDir = tempDir()
  if (policy !== null) writeFileSync(join(briefsDir, 'policy.json'), policy)
  if (projectLanes !== null) {
    writeFileSync(join(briefsDir, 'lanes.json'), typeof projectLanes === 'string' ? projectLanes : JSON.stringify(projectLanes))
  }
  if (tasks !== null) writeFileSync(join(briefsDir, 'TASKS.md'), tasks)
  const base = tempDir()
  const lanesFile = join(base, 'lanes.json')
  if (lanes !== null) writeFileSync(lanesFile, typeof lanes === 'string' ? lanes : JSON.stringify(lanes))
  const runs = runsFolder ?? join(base, 'machineroom-runs')
  mkdirSync(runs, { recursive: true })
  if (costs.length > 0) writeRuns(runs, costs)
  if (agents !== null || removed.length > 0) saveAgentsConfig(runs, { agents: agents ?? [], removed })
  const previousTemp = process.env.TEMP
  const previousRuns = process.env.MACHINEROOM_RUNS
  process.env.TEMP = base
  process.env.MACHINEROOM_RUNS = join(base, 'machineroom-runs')
  if (active !== null) writeActiveLanes(activeLanesFileFor('', runs), active)
  if (lock !== '') writeFileSync(join(runs, `${lock}.lock`), `${JSON.stringify({ pid: process.pid })}\n`)
  cleanups.push(() => {
    process.env.TEMP = previousTemp
    if (previousRuns === undefined) delete process.env.MACHINEROOM_RUNS
    else process.env.MACHINEROOM_RUNS = previousRuns
  })
  const bridge = createBridge({
    projectRoot: '',
    briefsDir,
    lanesFile,
    ...(runsFolder ? { runsFolder } : {}),
    port: 0,
    env: {},
    reconnectMinMs: 60000,
    reconnectMaxMs: 60000,
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, briefsDir, base, runs }
}

async function postRoute(url, body) {
  const response = await fetch(`${url}/api/control/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

async function postLaneRoute(url, body) {
  const response = await fetch(`${url}/api/control/route/lane`, {
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
    const { url } = await startRouteBridge({ costs: [20, 10], lanes: LANES })
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

const LANES = {
  orchestrator: { name: 'Orchestrator', cli: { harness: 'claude', model: 'opus' } },
  opencode2: { name: 'OpenCode 2', cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
  opencode3: { name: 'OpenCode 3', cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
  opencode: { name: 'OpenCode', cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
  hermes: { name: 'Hermes', retired: true, cli: { harness: 'hermes', model: 'deepseek/deepseek-v4.1-flash-1017' } },
  agy: { name: 'agy', harness: 'agy' },
}

const TASKS = [
  '**P31. The room picks a lane (OpenCode).** Add the route in `src/policy/route.js`. Files: `src/policy/route.js`, `tests/policy-lane.test.js`.',
].join('\n')

const MEDIUM_TASK = 'Fix the typo. Files: `a.js`, `b.js`, `c.js`, `tests/a.test.js`.'

const SMALL_TASK = 'Fix the typo in `src/a.js`.'

function policyWithSmall(choices) {
  return JSON.stringify({ ...POLICY, tiers: { ...POLICY.tiers, small: choices } })
}

const ALL = ['opencode2', 'opencode3', 'opencode']

describe('POST /api/control/route/lane', () => {
  it('routes a task and a brief by their profile', async () => {
    const { url } = await startRouteBridge({ lanes: LANES, tasks: TASKS, active: ALL })
    const task = await postLaneRoute(url, { task: MEDIUM_TASK })
    expect(task.status).toBe(200)
    expect(task.body).toEqual({
      lane: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
      reasoning: 'max',
      tier: 'medium',
      reason: 'The medium tier runs opencode on opencode-go/deepseek-v4.1-flash at max.',
      skipped: [],
    })

    const brief = await postLaneRoute(url, { brief: 'P31' })
    expect(brief.status).toBe(200)
    expect(brief.body).toMatchObject({ lane: 'opencode2', tier: 'small' })
    expect(brief.body.reason).toBe('The small tier runs opencode2 on opencode-go/deepseek-v4.1-flash at max.')
  })

  it('routes a short task to the small tier by its text', async () => {
    const { url } = await startRouteBridge({ lanes: LANES, tasks: TASKS, active: ALL })
    const answer = await postLaneRoute(url, { task: 'Fix the typo in `src/a.js`.' })
    expect(answer.status).toBe(200)
    expect(answer.body).toMatchObject({ lane: 'opencode2', tier: 'small' })
    expect(answer.body.reason).toBe('The small tier runs opencode2 on opencode-go/deepseek-v4.1-flash at max.')
  })

  it('skips a lane that is turned off, busy or not in the room and gives each reason', async () => {
    const { url } = await startRouteBridge({ lanes: LANES, tasks: TASKS, active: ['opencode2', 'opencode3', 'opencode'], lock: 'opencode2' })
    const answer = await postLaneRoute(url, { brief: 'P31' })
    expect(answer.status).toBe(200)
    expect(answer.body.lane).toBe('opencode')
    expect(answer.body.skipped).toEqual([{ lane: 'opencode2', why: 'The lane opencode2 is busy.' }])

    const off = await startRouteBridge({ lanes: LANES, tasks: TASKS, active: ['opencode3'] })
    const medium = await postLaneRoute(off.url, { task: MEDIUM_TASK })
    expect(medium.body.lane).toBe('opencode3')
    expect(medium.body.reason).toBe('No lane of the medium tier is free, so the first free lane was taken.')
    expect(medium.body.skipped).toEqual([
      { lane: 'opencode', why: 'The lane opencode is turned off.' },
      { lane: 'claude', why: 'The lane claude is not in this room.' },
    ])
  })

  it('leaves a retired lane out of the fall', async () => {
    const { url } = await startRouteBridge({ lanes: LANES, tasks: TASKS, active: ['hermes'] })
    const answer = await postLaneRoute(url, { task: MEDIUM_TASK })
    expect(answer.body.lane).toBeNull()
    expect(answer.body.reason).toBe('Every lane is busy or turned off.')
  })

  it('falls to the first free lane of the list when no choice is free', async () => {
    const { url } = await startRouteBridge({ lanes: LANES, tasks: TASKS, active: ['opencode3'], lock: 'opencode2' })
    const answer = await postLaneRoute(url, { task: MEDIUM_TASK })
    expect(answer.status).toBe(200)
    expect(answer.body).toMatchObject({ lane: 'opencode3', model: null, reasoning: null, tier: 'medium' })
    expect(answer.body.reason).toBe('No lane of the medium tier is free, so the first free lane was taken.')
  })

  it('answers no lane when every lane is busy or turned off', async () => {
    const { url } = await startRouteBridge({ lanes: LANES, tasks: TASKS, active: [] })
    const answer = await postLaneRoute(url, { task: MEDIUM_TASK })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({
      lane: null,
      model: null,
      reasoning: null,
      tier: 'medium',
      reason: 'Every lane is busy or turned off.',
      skipped: [
        { lane: 'opencode', why: 'The lane opencode is turned off.' },
        { lane: 'claude', why: 'The lane claude is not in this room.' },
      ],
    })
  })

  it('picks an owner-made lane from the bridge lane records', async () => {
    const made = {
      key: 'opencode-7',
      name: 'Made OpenCode',
      harness: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
      effort: 'max',
      createdAt: '2026-11-11T10:00:00.000Z',
    }
    const policy = policyWithSmall([{ lane: 'opencode-7', model: made.model, reasoning: 'max', provider: 'opencode' }])
    const { url } = await startRouteBridge({ policy, lanes: LANES, tasks: TASKS, active: ['opencode-7'], agents: [made] })
    const answer = await postLaneRoute(url, { task: SMALL_TASK })
    expect(answer.status).toBe(200)
    expect(answer.body.lane).toBe('opencode-7')
    expect(answer.body.reason).toBe('The small tier runs opencode-7 on opencode-go/deepseek-v4.1-flash at max.')
  })

  it('turns off a lane moved from an old removed list', async () => {
    const policy = policyWithSmall([{ lane: 'opencode2', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' }])
    const { url } = await startRouteBridge({ policy, lanes: LANES, tasks: TASKS, active: ['opencode2'], removed: ['opencode2'] })
    const answer = await postLaneRoute(url, { task: SMALL_TASK })
    expect(answer.status).toBe(200)
    expect(answer.body.lane).toBeNull()
    expect(answer.body.skipped).toEqual([{ lane: 'opencode2', why: 'The lane opencode2 is turned off.' }])
  })

  it('does not read a lanes.json inside the project', async () => {
    const projectLanes = {
      orchestrator: { name: 'Orchestrator', cli: { harness: 'claude', model: 'opus' } },
      projectlane: { name: 'Project lane', cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
    }
    const policy = policyWithSmall([
      { lane: 'projectlane', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
      { lane: 'opencode2', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
    ])
    const { url } = await startRouteBridge({
      policy,
      lanes: LANES,
      projectLanes,
      tasks: TASKS,
      active: ['projectlane', 'opencode2'],
    })
    const answer = await postLaneRoute(url, { task: SMALL_TASK })
    expect(answer.status).toBe(200)
    expect(answer.body.lane).toBe('opencode2')
    expect(answer.body.skipped).toEqual([{ lane: 'projectlane', why: 'The lane projectlane is not in this room.' }])
  })

  it('says in one sentence that there is no lane for the tier in the room', async () => {
    const { url } = await startRouteBridge({ policy: null, lanes: {}, tasks: TASKS, active: ['owner'] })
    const answer = await postLaneRoute(url, { task: SMALL_TASK })
    expect(answer.status).toBe(200)
    expect(answer.body.lane).toBeNull()
    expect(answer.body.reason).toBe('There is no lane for the small tier. Make one in the room.')
  })

  it('reads the lane lock and the spend from the bridge runs folder', async () => {
    const own = join(tempDir(), 'own-runs')
    const { url, base } = await startRouteBridge({ lanes: LANES, tasks: TASKS, active: ALL, runsFolder: own })
    const other = join(base, 'machineroom-runs')
    mkdirSync(other, { recursive: true })
    writeFileSync(join(other, 'runs.jsonl'), `${JSON.stringify({ lane: 'opencode', startedAt: new Date().toISOString(), costUsd: 30 })}\n`)
    writeFileSync(join(other, 'opencode2.lock'), `${JSON.stringify({ pid: process.pid })}\n`)
    const answer = await postLaneRoute(url, { task: SMALL_TASK })
    expect(answer.status).toBe(200)
    expect(answer.body.lane).toBe('opencode2')
  })

  it('answers the manual sentence when no lane choice is saved', async () => {
    const { url } = await startRouteBridge({ lanes: LANES, tasks: TASKS })
    const answer = await postLaneRoute(url, { task: SMALL_TASK })
    expect(answer.status).toBe(400)
    expect(answer.body).toEqual({ error: 'Pick the lanes for this project first.' })
  })

  it('refuses a request with no name, two names, a bad brief and a long task', async () => {
    const { url } = await startRouteBridge({ lanes: LANES, tasks: TASKS, active: ALL })
    for (const body of [{}, { brief: '' }, { task: '  ' }]) {
      const answer = await postLaneRoute(url, body)
      expect(answer.status).toBe(400)
      expect(answer.body).toEqual({ error: 'Name a brief or a task.' })
    }
    const both = await postLaneRoute(url, { brief: 'P31', task: 'Fix it.' })
    expect(both.status).toBe(400)
    expect(both.body).toEqual({ error: 'Send a brief or a task, not both.' })
    const missing = await postLaneRoute(url, { brief: 'Z99' })
    expect(missing.status).toBe(400)
    expect(missing.body).toEqual({ error: 'Choose a brief from the list.' })
    const long = await postLaneRoute(url, { task: 'x'.repeat(4001) })
    expect(long.status).toBe(400)
    expect(long.body).toEqual({ error: 'Write the task in 1 to 4000 characters.' })
    const failures = await postLaneRoute(url, { task: 'Fix it.', failures: 9 })
    expect(failures.status).toBe(400)
    expect(failures.body).toEqual({ error: 'Failures must be a whole number from 0 to 5.' })
  })

  it('refuses a missing policy, a broken policy and a broken lane file', async () => {
    const missing = await startRouteBridge({ policy: null, lanes: LANES, tasks: TASKS, active: ALL })
    const noPolicy = await postLaneRoute(missing.url, { task: MEDIUM_TASK })
    expect(noPolicy.status).toBe(200)
    expect(noPolicy.body.tier).toBe('medium')

    const broken = await startRouteBridge({ policy: '{', lanes: LANES, tasks: TASKS, active: ALL })
    const badPolicy = await postLaneRoute(broken.url, { task: MEDIUM_TASK })
    expect(badPolicy.status).toBe(400)
    expect(badPolicy.body).toEqual({ error: 'The policy file is not JSON.' })

    const badLanes = await startRouteBridge({ lanes: '{', tasks: TASKS, active: ALL })
    const noLanes = await postLaneRoute(badLanes.url, { task: MEDIUM_TASK })
    expect(noLanes.status).toBe(400)
    expect(noLanes.body).toEqual({ error: 'The lane file is not valid.' })
  })

  it('refuses a brief when the brief file is missing', async () => {
    const { url } = await startRouteBridge({ lanes: LANES, tasks: null, active: ALL })
    const answer = await postLaneRoute(url, { brief: 'P31' })
    expect(answer.status).toBe(404)
    expect(answer.body).toEqual({ error: 'The brief files are missing.' })
  })

  it('answers only POST', async () => {
    const { url } = await startRouteBridge({ lanes: LANES, tasks: TASKS, active: ALL })
    const answer = await fetch(`${url}/api/control/route/lane`)
    expect(answer.status).toBe(405)
    expect(await answer.json()).toEqual({ error: 'Method not allowed.' })
  })
})

describe('the mock policy', () => {
  it('is a copy of the real policy file', () => {
    const text = readFileSync(new URL('../docs/agents/policy.json', import.meta.url), 'utf8')
    expect(MOCK_POLICY).toEqual(JSON.parse(text))
  })
})
