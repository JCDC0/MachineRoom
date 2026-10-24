import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { laneCosts, readLaneCosts } from '../server/lane-costs.js'
import { boardLines } from '../src/engine/board.js'
import { costBoard } from '../src/model/costs.js'
import { backupsNotRunning, laneModeFromHealth } from '../src/ui/panels/backup.js'
import { makeTempDir } from './helpers/tempRoot.js'

const DEAD_PAPERCLIP = 'http://127.0.0.1:3999'
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
  process.env.TEMP = dir
  cleanups.push(() => {
    process.env.TEMP = previous
  })
}

function writeRuns(file, records) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
}

function record(lane, startedAt, costUsd, extra = {}) {
  return { lane, startedAt, costUsd, ...extra }
}

describe('laneCosts', () => {
  it('sums this month per lane, skips a null cost and a run from last month, and counts a project run', () => {
    const records = [
      record('opencode', '2026-10-02T09:00:00.000Z', 0.5),
      record('opencode', '2026-10-20T09:00:00.000Z', 0.1, { project: 'C:\\GitHub\\Other', task: 'A small job' }),
      record('opencode2', '2026-10-10T09:00:00.000Z', 0.1234),
      record('agy', '2026-10-11T09:00:00.000Z', null),
      record('opencode', '2026-09-30T23:59:00.000Z', 5),
      record('hermes', '2026-10-05T09:00:00.000Z', 2),
    ]
    const costs = laneCosts({ records, agents: AGENTS, now: NOW })

    expect(costs.byAgent).toEqual([
      { agentId: 'agent-opencode', agentName: 'OpenCode', costCents: 60, inputTokens: null, outputTokens: null },
      { agentId: 'agent-opencode2', agentName: 'OpenCode 2', costCents: 12, inputTokens: null, outputTokens: null },
      { agentId: 'agent-agy', agentName: 'agy', costCents: 0, inputTokens: null, outputTokens: null },
    ])
    expect(costs.summary).toEqual({ spendCents: 72, budgetCents: 0, utilizationPercent: null })
    expect(costs.quota).toEqual([])
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
      { agentId: 'agent-opencode', agentName: 'OpenCode', costCents: 50, inputTokens: 2000, outputTokens: 500 },
      { agentId: 'agent-agy', agentName: 'agy', costCents: 0, inputTokens: 5000, outputTokens: 600 },
      { agentId: 'agent-claude', agentName: 'Claude Code', costCents: 20, inputTokens: 400, outputTokens: null },
    ])
    expect(costs.summary.spendCents).toBe(70)
  })

  it('reads the records from a temp runs.jsonl', () => {
    const folder = tempDir()
    const file = join(folder, 'runs.jsonl')
    writeRuns(file, [
      record('opencode', '2026-10-24T08:00:00.000Z', 0.5),
      record('opencode2', '2026-10-24T08:00:00.000Z', 0.25),
    ])

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
    writeRuns(join(runs, 'runs.jsonl'), [
      record('opencode', new Date().toISOString(), 0.5, { inputTokens: 1200, outputTokens: 300 }),
      record('opencode', new Date().toISOString(), 0.1, { project: 'C:\\GitHub\\Other', inputTokens: 800, outputTokens: 200 }),
      record('opencode2', new Date().toISOString(), 0.1234),
      record('agy', new Date().toISOString(), null, { inputTokens: 5000, outputTokens: 600 }),
    ])
    const bridge = createBridge({
      paperclipUrl: DEAD_PAPERCLIP,
      companyId: 'comp-lanes',
      projectRoot: base,
      port: 0,
      env: {},
      surfaceEveryMs: 0,
      reconnectMinMs: 60000,
      reconnectMaxMs: 60000,
      ...(lanes ? { lanesSource: { folder: runs, lanes: LANES, repoRoot: base, quietMs: 60000, pollMs: 20 } } : {}),
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    return url
  }

  it('answers costs and agents from the lane records when the lane source is on and Paperclip is dead', async () => {
    const url = await startBridge()

    const costs = await fetch(`${url}/api/control/costs`)
    expect(costs.status).toBe(200)
    const body = await costs.json()
    expect(body.summary).toEqual({ spendCents: 72, budgetCents: 0, utilizationPercent: null })
    expect(body.byAgent).toEqual([
      { agentId: 'agent-opencode', agentName: 'OpenCode', costCents: 60, inputTokens: 2000, outputTokens: 500 },
      { agentId: 'agent-opencode2', agentName: 'OpenCode 2', costCents: 12, inputTokens: null, outputTokens: null },
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

  it('answers the same error as before when the lane source is off', async () => {
    const url = await startBridge({ lanes: false })

    const costs = await fetch(`${url}/api/control/costs`)
    expect(costs.status).toBe(502)
    expect(await costs.json()).toEqual({ error: 'Paperclip is not reachable.' })

    const agents = await fetch(`${url}/api/control/agents`)
    expect(agents.status).toBe(502)
    expect(await agents.json()).toEqual({ error: 'Paperclip is not reachable.' })
  })
})

describe('the board and the backup line in lane mode', () => {
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

  it('gives the Backups sentence only when Paperclip is down in lane mode', () => {
    expect(backupsNotRunning({ laneMode: true, paperclipDown: true })).toBe(
      'Backups belong to Paperclip, which is not running.'
    )
    expect(backupsNotRunning({ laneMode: true, paperclipDown: false })).toBeNull()
    expect(backupsNotRunning({ laneMode: false, paperclipDown: true })).toBeNull()
    expect(backupsNotRunning()).toBeNull()
  })

  it('tells lane mode apart from a health answer', () => {
    expect(laneModeFromHealth({ lanes: true, paperclip: false })).toBe(true)
    expect(laneModeFromHealth({ lanes: true, paperclip: false, paperclipVersion: null })).toBe(true)
    expect(laneModeFromHealth({ lanes: true, paperclip: true })).toBe(false)
    expect(laneModeFromHealth({ lanes: true })).toBe(true)
    expect(laneModeFromHealth({ lanes: false, paperclip: false })).toBe(false)
    expect(laneModeFromHealth({ paperclip: false })).toBe(false)
    expect(laneModeFromHealth(null)).toBe(false)
    expect(laneModeFromHealth('lanes')).toBe(false)
  })
})
