import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { postJson, waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

const POLICY = {
  tiers: {
    small: [
      { lane: 'opencode2', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
      { lane: 'opencode3', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
    ],
    medium: [
      { lane: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
      { lane: 'opencode4', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
    ],
    large: [
      { lane: 'opencode5', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
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

const laneOf = (name) => ({
  name,
  cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/deepseek-v4.1-flash' },
})

const LANES = {
  orchestrator: { name: 'Orchestrator', cli: { harness: 'claude', bin: 'claude', model: 'opus' } },
  opencode: laneOf('OpenCode'),
  opencode2: laneOf('OpenCode 2'),
  opencode3: laneOf('OpenCode 3'),
  opencode4: laneOf('OpenCode 4'),
  opencode5: laneOf('OpenCode 5'),
}

const TASKS = [
  '**P31. The room picks a lane (OpenCode).** Add the route in `src/policy/route.js`. Files: `src/policy/route.js`, `tests/policy-lane.test.js`.',
].join('\n')

const MEDIUM_TASK = 'Fix it. Files: `a.js`, `b.js`, `c.js`, `tests/a.test.js`.'
const SMALL_REASON = 'The small tier runs opencode2 on opencode-go/deepseek-v4.1-flash at max.'
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function useRuns(base) {
  const runs = join(base, 'runs')
  const previousRuns = process.env.MACHINEROOM_RUNS
  process.env.MACHINEROOM_RUNS = runs
  cleanups.push(() => {
    if (previousRuns === undefined) delete process.env.MACHINEROOM_RUNS
    else process.env.MACHINEROOM_RUNS = previousRuns
  })
  return runs
}

function writeBriefs(base) {
  const briefs = join(base, 'docs', 'agents')
  mkdirSync(briefs, { recursive: true })
  writeFileSync(join(briefs, 'TASKS.md'), TASKS)
  writeFileSync(join(briefs, 'lanes.json'), JSON.stringify(LANES))
  writeFileSync(join(briefs, 'policy.json'), JSON.stringify(POLICY))
  return briefs
}

async function startRig({ project = false, active = ['opencode', 'opencode2', 'opencode3'], lock = '' } = {}) {
  const base = tempDir('mr-run-route-')
  const runs = useRuns(base)
  mkdirSync(runs, { recursive: true })
  const briefs = writeBriefs(base)
  const root = project ? join(base, 'project') : REPO_ROOT
  if (project) mkdirSync(root, { recursive: true })
  if (lock !== '') writeFileSync(join(runs, `${lock}.lock`), `${JSON.stringify({ pid: process.pid })}\n`)
  const calls = join(base, 'runner-calls.jsonl')
  const runner = join(base, 'runner.mjs')
  writeFileSync(
    runner,
    ["import { appendFileSync } from 'node:fs'", 'appendFileSync(process.argv[2], `${JSON.stringify(process.argv.slice(3))}\\n`)'].join('\n')
  )
  writeActiveLanes(activeLanesFileFor(root, runs), active)
  const bridge = createBridge({
    projectRoot: root,
    briefsDir: briefs,
    runsFolder: runs,
    lanesFile: join(briefs, 'lanes.json'),
    runnerCommand: { file: process.execPath, args: [runner, calls] },
    port: 0,
    env: {},
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, base, root, runs, briefs, calls }
}

function readCalls(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

describe('a run started with no lane', () => {
  it('routes a brief and names the lane and the policy reason', async () => {
    const rig = await startRig()
    const answer = await postJson(`${rig.url}/api/control/runs`, { briefs: ['P31'], confirmed: true })
    expect(answer.status).toBe(202)
    expect(answer.body.lane).toBe('opencode2')
    expect(answer.body.briefs).toEqual(['P31'])
    expect(answer.body.routed).toEqual({ tier: 'small', reason: SMALL_REASON })
    await waitFor(() => readCalls(rig.calls).length === 1, { what: 'the runner' })
    expect(readCalls(rig.calls)[0][0]).toBe('opencode2')
  })

  it('routes a task when the lane is auto and skips a busy lane', async () => {
    const rig = await startRig({ project: true, active: ['opencode2', 'opencode3', 'opencode'], lock: 'opencode2' })
    const answer = await postJson(`${rig.url}/api/control/runs`, { lane: 'auto', task: MEDIUM_TASK, confirmed: true })
    expect(answer.status).toBe(202)
    expect(answer.body.lane).toBe('opencode')
    expect(answer.body.routed).toEqual({
      tier: 'medium',
      reason: 'The medium tier runs opencode on opencode-go/deepseek-v4.1-flash at max.',
    })
    await waitFor(() => readCalls(rig.calls).length === 1, { what: 'the runner' })
    expect(readCalls(rig.calls)[0][0]).toBe('opencode')
  })

  it('starts a named lane as before and adds no route', async () => {
    const rig = await startRig()
    const answer = await postJson(`${rig.url}/api/control/runs`, {
      lane: 'opencode3',
      briefs: ['P31'],
      confirmed: true,
    })
    expect(answer.status).toBe(202)
    expect(answer.body.lane).toBe('opencode3')
    expect(answer.body).not.toHaveProperty('routed')
    await waitFor(() => readCalls(rig.calls).length === 1, { what: 'the runner' })
    expect(readCalls(rig.calls)[0][0]).toBe('opencode3')
  })

  it('answers 409 and the reason when no lane is free', async () => {
    const rig = await startRig({ active: [] })
    const answer = await postJson(`${rig.url}/api/control/runs`, { briefs: ['P31'], confirmed: true })
    expect(answer.status).toBe(409)
    expect(answer.body).toEqual({ error: 'Every lane is busy or turned off.' })
    expect(readCalls(rig.calls)).toEqual([])
  })

  it('routes with the policy of this repository when the project has no policy file', async () => {
    const rig = await startRig()
    rmSync(join(rig.briefs, 'policy.json'))
    const answer = await postJson(`${rig.url}/api/control/runs`, { briefs: ['P31'], confirmed: true })
    expect(answer.status).toBe(202)
    expect(answer.body.routed.reason).toBeTruthy()
  })

  it('keeps the named lane refusal and the brief check', async () => {
    const rig = await startRig()
    const bad = await postJson(`${rig.url}/api/control/runs`, { lane: 'nobody', briefs: ['P31'], confirmed: true })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: 'Choose a lane from the list.' })
    const brief = await postJson(`${rig.url}/api/control/runs`, { briefs: ['Z99'], confirmed: true })
    expect(brief.status).toBe(400)
    expect(brief.body).toEqual({ error: 'Choose a brief from the list.' })
    expect(readCalls(rig.calls)).toEqual([])
  })
})
