import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { cachedRunRecords, laneCosts, readLaneCosts } from '../server/lane-costs.js'
import { boardLines } from '../src/engine/board.js'
import { costBoard } from '../src/model/costs.js'
import { makeTempDir } from './helpers/tempRoot.js'

const NOW = Date.parse('2026-10-24T12:00:00.000Z')

const AGENTS = [
  { id: 'agent-opencode', key: 'opencode', name: 'OpenCode' },
  { id: 'agent-opencode2', key: 'opencode2', name: 'OpenCode 2' },
  { id: 'agent-agy', key: 'agy', name: 'agy' },
]

const LANES = {
  opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/deepseek-v4.1-flash' } },
  opencode2: { name: 'OpenCode 2', cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/deepseek-v4.1-flash' } },
}

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix = 'mr-lane-costs-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function useTemp(dir) {
  const previous = process.env.TEMP
  const previousRuns = process.env.MACHINEROOM_RUNS
  process.env.TEMP = dir
  process.env.MACHINEROOM_RUNS = join(dir, 'machineroom-runs')
  cleanups.push(() => {
    process.env.TEMP = previous
    if (previousRuns === undefined) delete process.env.MACHINEROOM_RUNS
    else process.env.MACHINEROOM_RUNS = previousRuns
  })
}

function writeRuns(file, records) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
}

function record(lane, startedAt, costUsd, extra = {}) {
  return { lane, startedAt, costUsd, ...extra }
}

function localTime(dayOffset, hour) {
  const base = new Date(NOW)
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, 0, 0).toISOString()
}

describe('laneCosts', () => {
  it('sums this month per lane, skips a null cost and a run from last month, and counts a project run', () => {
    const records = [
      record('opencode', '2026-10-02T09:00:00.000Z', 0.5),
      record('opencode', '2026-10-20T09:00:00.000Z', 0.1, { project: 'C:\\GitHub\\Other', task: 'A small job' }),
      record('opencode2', '2026-10-10T09:00:00.000Z', 0.1234),
      record('agy', '2026-10-11T09:00:00.000Z', null),
      record('opencode', localTime(-24, 23), 5),
      record('hermes', '2026-10-05T09:00:00.000Z', 2),
    ]
    const costs = laneCosts({ records, agents: AGENTS, now: NOW })

    expect(costs.byAgent).toEqual([
      { agentId: 'agent-opencode', agentName: 'OpenCode', costCents: 60, todayCents: 0, inputTokens: null, outputTokens: null },
      { agentId: 'agent-opencode2', agentName: 'OpenCode 2', costCents: 12, todayCents: 0, inputTokens: null, outputTokens: null },
      { agentId: 'agent-agy', agentName: 'agy', costCents: 0, todayCents: 0, inputTokens: null, outputTokens: null },
    ])
    expect(costs.summary).toEqual({ spendCents: 72, budgetCents: 0, utilizationPercent: null })
    expect(costs.quota).toEqual([])
  })

  it('sums today per lane by the local calendar day and leaves yesterday out', () => {
    const records = [
      record('opencode', localTime(0, 1), 0.3),
      record('opencode', localTime(-1, 23), 0.4),
      record('opencode2', localTime(0, 9), 0.05),
      record('opencode2', localTime(-2, 12), 0.2),
      record('opencode', 'not a time', 1),
    ]

    const costs = laneCosts({ records, agents: AGENTS, now: NOW })
    expect(costs.byAgent.map((row) => [row.costCents, row.todayCents])).toEqual([
      [70, 30],
      [25, 5],
      [0, 0],
    ])
  })

  it('starts this month at local midnight on the first', () => {
    const now = new Date(2026, 10, 1, 10, 0, 0).getTime()
    const early = new Date(2026, 10, 1, 2, 0, 0).toISOString()
    const last = new Date(2026, 9, 31, 23, 0, 0).toISOString()

    const costs = laneCosts({
      records: [record('opencode', early, 0.5), record('opencode', last, 0.25)],
      agents: AGENTS,
      now,
    })

    expect(costs.byAgent[0]).toMatchObject({ costCents: 50, todayCents: 50 })
  })

  it('sums the tokens per lane and leaves one null when no record carries it', () => {
    const agents = [
      { id: 'agent-opencode', key: 'opencode', name: 'OpenCode' },
      { id: 'agent-agy', key: 'agy', name: 'agy' },
      { id: 'agent-claude', key: 'claude', name: 'Claude Code' },
    ]
    const records = [
      record('opencode', '2026-10-02T09:00:00.000Z', 0.5, { inputTokens: 1200, outputTokens: 300 }),
      record('opencode', '2026-10-03T09:00:00.000Z', null, { inputTokens: 800, outputTokens: 200 }),
      record('agy', '2026-10-04T09:00:00.000Z', null, { inputTokens: 5000, outputTokens: 600 }),
      record('claude', '2026-10-05T09:00:00.000Z', 0.2, { inputTokens: 400 }),
    ]

    const costs = laneCosts({ records, agents, now: NOW })
    expect(costs.byAgent).toEqual([
      { agentId: 'agent-opencode', agentName: 'OpenCode', costCents: 50, todayCents: 0, inputTokens: 2000, outputTokens: 500 },
      { agentId: 'agent-agy', agentName: 'agy', costCents: 0, todayCents: 0, inputTokens: 5000, outputTokens: 600 },
      { agentId: 'agent-claude', agentName: 'Claude Code', costCents: 20, todayCents: 0, inputTokens: 400, outputTokens: null },
    ])
    expect(costs.summary.spendCents).toBe(70)
  })

  it('reads the records from a temp runs.jsonl', () => {
    const folder = tempDir()
    const file = join(folder, 'runs.jsonl')
    writeRuns(file, [
      record('opencode', localTime(0, 8), 0.5),
      record('opencode2', localTime(0, 8), 0.25),
    ])

    const costs = readLaneCosts({ agents: AGENTS, file, now: NOW })
    expect(costs.byAgent.map((row) => row.costCents)).toEqual([50, 25, 0])
    expect(costs.byAgent.map((row) => row.todayCents)).toEqual([50, 25, 0])
    expect(costs.summary.spendCents).toBe(75)
  })

  it('reuses cached read keyed on size and modified time, and picks up a newly finished run', () => {
    const folder = tempDir()
    const file = join(folder, 'runs.jsonl')
    writeRuns(file, [
      record('opencode', localTime(0, 8), 0.5),
    ])

    const first = cachedRunRecords(file)
    expect(first.length).toBe(1)
    expect(first[0].costUsd).toBe(0.5)

    const cachedAgain = cachedRunRecords(file)
    expect(cachedAgain).toEqual(first)
    expect(cachedAgain).not.toBe(first)
    cachedAgain.push(record('opencode', '2026-10-24T10:00:00.000Z', 1.0))
    expect(cachedRunRecords(file).length).toBe(1)

    appendFileSync(file, JSON.stringify(record('opencode2', '2026-10-24T09:00:00.000Z', 0.25)) + '\n', 'utf8')
    const updated = cachedRunRecords(file)
    expect(updated).not.toBe(first)
    expect(updated.length).toBe(2)

    const costs = readLaneCosts({ agents: AGENTS, file, now: NOW })
    expect(costs.byAgent.map((row) => row.costCents)).toEqual([50, 25, 0])
    expect(costs.summary.spendCents).toBe(75)
  })
})

describe('the lane costs routes', () => {
  async function startBridge({ lanes = true } = {}) {
    const base = tempDir()
    const runs = join(base, 'machineroom-runs')
    useTemp(base)
    const previousLanesDir = process.env.MACHINEROOM_LANES_DIR
    process.env.MACHINEROOM_LANES_DIR = fileURLToPath(new URL('../docs/agents', import.meta.url))
    cleanups.push(() => {
      if (previousLanesDir === undefined) delete process.env.MACHINEROOM_LANES_DIR
      else process.env.MACHINEROOM_LANES_DIR = previousLanesDir
    })
    writeActiveLanes(activeLanesFileFor(base, runs), Object.keys(LANES))
    writeRuns(join(runs, 'runs.jsonl'), [
      record('opencode', new Date().toISOString(), 0.5, { inputTokens: 1200, outputTokens: 300 }),
      record('opencode', new Date().toISOString(), 0.1, { project: 'C:\\GitHub\\Other', inputTokens: 800, outputTokens: 200 }),
      record('opencode2', new Date().toISOString(), 0.1234),
    ])
    const bridge = createBridge({
      projectRoot: base,
      port: 0,
      env: {},
      ...(lanes ? { lanesSource: { folder: runs, lanes: LANES, repoRoot: base, quietMs: 60000, pollMs: 20 } } : {}),
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    return url
  }

  it('answers costs and agents from the lane records', async () => {
    const url = await startBridge()

    const costs = await fetch(`${url}/api/control/costs`)
    expect(costs.status).toBe(200)
    const body = await costs.json()
    expect(body.summary).toEqual({ spendCents: 72, budgetCents: 0, utilizationPercent: null })
    expect(body.byAgent).toEqual([
      { agentId: 'agent-opencode', agentName: 'OpenCode', costCents: 60, todayCents: 60, inputTokens: 2000, outputTokens: 500 },
      { agentId: 'agent-opencode2', agentName: 'OpenCode 2', costCents: 12, todayCents: 12, inputTokens: null, outputTokens: null },
    ])
    expect(body.quota).toEqual([])

    const agents = await fetch(`${url}/api/control/agents`)
    expect(agents.status).toBe(200)
    const list = await agents.json()
    expect(list.map((agent) => [agent.id, agent.key, agent.name, agent.spentMonthlyCents])).toEqual([
      ['agent-opencode', 'opencode', 'OpenCode', 60],
      ['agent-opencode2', 'opencode2', 'OpenCode 2', 12],
    ])
    expect(list.every((agent) => agent.budgetMonthlyCents === 0)).toBe(true)
    expect(list.every((agent) => agent.role === null)).toBe(true)
  })

  it('reads the same records with the live lane source off', async () => {
    const url = await startBridge({ lanes: false })

    const costs = await fetch(`${url}/api/control/costs`)
    expect(costs.status).toBe(200)
    expect((await costs.json()).summary.spendCents).toBe(72)

    const agents = await fetch(`${url}/api/control/agents`)
    expect(agents.status).toBe(200)
    const list = await agents.json()
    const byKey = new Map(list.map((agent) => [agent.key, agent.spentMonthlyCents]))
    expect(byKey.get('opencode')).toBe(60)
    expect(byKey.get('opencode2')).toBe(12)
  })
})

describe('the board in lane mode', () => {
  it('shows the lanes spend and null tokens without NaN', () => {
    const costs = laneCosts({
      records: [
        record('opencode', '2026-10-02T09:00:00.000Z', 0.5, { inputTokens: 1200, outputTokens: 300 }),
        record('opencode', '2026-10-20T09:00:00.000Z', 0.1, { project: 'C:\\GitHub\\Other', inputTokens: 800, outputTokens: 200 }),
        record('opencode2', '2026-10-10T09:00:00.000Z', 0.1234),
        record('agy', '2026-10-11T09:00:00.000Z', null),
      ],
      agents: AGENTS,
      now: NOW,
    })
    const board = costBoard(
      costs,
      AGENTS.map((agent) => ({ id: agent.id, key: agent.key, name: agent.name }))
    )
    const lines = boardLines(board)

    expect(lines.empty).toBeNull()
    expect(lines.summary).toEqual({ text: 'SPENT $0.72, NO BUDGET', over: false })
    expect(lines.rows.map((row) => row.key)).toEqual(['opencode', 'opencode2', 'agy'])
    expect(lines.rows[0]).toEqual({
      key: 'opencode',
      name: 'OpenCode',
      cost: '$0.60',
      tokens: '2.0k in / 500 out',
      share: 0.833,
      reported: true,
    })
    expect(lines.rows[2]).toEqual({
      key: 'agy',
      name: 'agy',
      cost: 'not reported',
      tokens: null,
      share: null,
      reported: false,
    })
    expect(JSON.stringify(lines)).not.toContain('NaN')
  })
})
