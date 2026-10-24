import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_REFUSAL } from '../server/control.js'
import { createBridge } from '../server/index.js'
import { createLanesSource, readLanes } from '../server/lanes-source.js'
import {
  LANE_TASK_REFUSAL,
  laneLiveRuns,
  laneTaskIssues,
  readRecentLaneRecords,
  runNameOf,
} from '../server/lane-tasks.js'
import { agentTasks } from '../src/model/liveTasks.js'
import { makeTempDir } from './helpers/tempRoot.js'

const BASE_TIME = Date.parse('2026-10-24T10:00:00Z')
const iso = (minutesAgo) => new Date(BASE_TIME - minutesAgo * 60000).toISOString()

const AGENTS = [
  { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local' },
  { id: 'agent-opencode2', key: 'opencode2', name: 'OpenCode 2', adapterType: 'opencode_local' },
  { id: 'agent-agy', key: 'agy', name: 'agy', adapterType: 'process' },
]

const LANES = {
  opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/deepseek-v4.1-flash' } },
  opencode2: { name: 'OpenCode 2', cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/deepseek-v4.1-flash' } },
  agy: { name: 'agy', cli: { harness: 'agy', bin: 'agy.exe', model: 'gemini-3.8-flash-high' } },
}

const BRIEFS = [
  { id: 'L1', title: 'Costs and meters from the lane records' },
  { id: 'L2', title: 'Tasks, approvals and the callout from the lane runs' },
  { id: 'S6g', title: 'Claude Code as a lane' },
]

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix = 'mr-lane-task-') {
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

function record({ lane, briefs = [], log, startedAt = iso(20), minutes = 2, exitCode = 0, killed = false, costUsd = null, project, task } = {}) {
  const value = {
    lane,
    briefs,
    model: null,
    reasoning: null,
    startedAt,
    minutes,
    exitCode,
    killed,
    costUsd,
    log,
    branch: '',
    commits: [],
  }
  if (project !== undefined) value.project = project
  if (task !== undefined) value.task = task
  return value
}

async function startLaneBridge({ lanes = true } = {}) {
  const base = tempDir()
  const runs = join(base, 'machineroom-runs')
  mkdirSync(runs, { recursive: true })
  useTemp(base)
  const bridge = createBridge({
    projectRoot: base,
    port: 0,
    env: {},
    reconnectMinMs: 60000,
    reconnectMaxMs: 60000,
    lanesSource: lanes ? { folder: runs, lanes: LANES, repoRoot: base, pollMs: 20, quietMs: 60000 } : null,
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, runs }
}

async function getJson(url, path) {
  const response = await fetch(`${url}${path}`)
  return { status: response.status, body: await response.json() }
}

async function postJson(url, path, body) {
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

async function patchJson(url, path, body) {
  const response = await fetch(`${url}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

async function waitFor(fn, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error('condition not met in time')
}

describe('lane tasks', () => {
  it('builds one issue per open run and record with its brief, title and status', () => {
    const openRuns = [
      { name: 'opencode-L2-20261024-120000', lane: 'opencode', startedAt: iso(1), project: null },
      { name: 'opencode-project-20261024-110000', lane: 'opencode', startedAt: iso(5), project: 'C:\\GitHub\\Other' },
    ]
    const longTask = `${'A long task on another project. '.repeat(4)}End`
    const records = [
      record({ lane: 'opencode2', briefs: ['S6g'], log: 'C:\\runs\\opencode2-S6g-20261024-080000.log', startedAt: iso(40), exitCode: 1 }),
      record({
        lane: 'opencode',
        log: 'C:\\runs\\opencode-L1-20261024-090000.log',
        briefs: ['L1'],
        startedAt: iso(30),
        minutes: 3,
        exitCode: 0,
      }),
      record({
        lane: 'agy',
        log: '/tmp/runs/agy-project-20261024-070000.log',
        startedAt: iso(60),
        project: 'C:\\GitHub\\Other',
        task: longTask,
      }),
    ]

    const issues = laneTaskIssues({ openRuns, records, agents: AGENTS, briefs: BRIEFS })

    expect(issues).toHaveLength(5)
    expect(issues.map((issue) => issue.id)).toEqual([
      'opencode-L2-20261024-120000',
      'opencode-project-20261024-110000',
      'opencode-L1-20261024-090000',
      'opencode2-S6g-20261024-080000',
      'agy-project-20261024-070000',
    ])

    const open = issues[0]
    expect(open).toMatchObject({
      identifier: 'L2',
      title: 'Tasks, approvals and the callout from the lane runs',
      description: '',
      status: 'in_progress',
      priority: 'medium',
      assigneeAgentId: 'agent-opencode',
      parentId: null,
      overrides: null,
      createdAt: iso(1),
      updatedAt: iso(1),
    })

    const openProject = issues[1]
    expect(openProject).toMatchObject({ identifier: 'project', title: 'project', status: 'in_progress', assigneeAgentId: 'agent-opencode' })

    const good = issues[2]
    expect(good).toMatchObject({
      identifier: 'L1',
      title: 'Costs and meters from the lane records',
      status: 'done',
      assigneeAgentId: 'agent-opencode',
      createdAt: iso(30),
    })
    expect(good.updatedAt).toBe(new Date(Date.parse(iso(30)) + 3 * 60000).toISOString())

    const failed = issues[3]
    expect(failed).toMatchObject({ identifier: 'S6g', status: 'blocked', assigneeAgentId: 'agent-opencode2' })

    const project = issues[4]
    expect(project).toMatchObject({ identifier: 'project', title: longTask.slice(0, 80), status: 'done', assigneeAgentId: 'agent-agy' })
  })

  it('leaves out records with no lane and keeps the newest 30', () => {
    const dir = tempDir()
    const file = join(dir, 'runs.jsonl')
    const lines = []
    for (let index = 0; index < 32; index += 1) {
      lines.push(JSON.stringify(record({ lane: 'opencode', log: `/tmp/runs/opencode-L2-20261024-${String(index).padStart(6, '0')}.log` })))
    }
    lines.push(JSON.stringify({ briefs: ['L2'], exitCode: 0 }))
    lines.push('not json')
    writeFileSync(file, `${lines.join('\n')}\n`)

    const records = readRecentLaneRecords(file)
    expect(records).toHaveLength(30)
    expect(records[0].log).toContain('000031')
    expect(records.every((entry) => entry.lane === 'opencode')).toBe(true)
    expect(readRecentLaneRecords(file, 2)).toHaveLength(2)
  })

  it('reads a run name from a Windows or a POSIX log path', () => {
    expect(runNameOf({ log: 'C:\\Temp\\machineroom-runs\\opencode-L2-20261024-120000.log' })).toBe('opencode-L2-20261024-120000')
    expect(runNameOf({ log: '/tmp/machineroom-runs/agy-project-20261024-120000.log' })).toBe('agy-project-20261024-120000')
    expect(runNameOf({ log: null })).toBe('')
  })

  it('gives the callout the brief id of a working lane', () => {
    const openRuns = [{ name: 'opencode-L2-20261024-120000', lane: 'opencode', startedAt: iso(1), project: null }]
    const records = [
      record({ lane: 'opencode', briefs: ['L2'], log: '/tmp/runs/opencode-L2-20261024-120000.log', startedAt: iso(40) }),
    ]
    const issues = laneTaskIssues({ openRuns, records, agents: AGENTS, briefs: BRIEFS })
    const liveRuns = laneLiveRuns({ openRuns, agents: AGENTS })
    const tasks = agentTasks(liveRuns, issues, [{ id: 'agent-opencode', key: 'opencode' }])
    expect(tasks.get('opencode')).toBe('L2')
  })

  it('reads the project of an open run through the lane source', async () => {
    const dir = tempDir()
    const runs = join(dir, 'runs')
    mkdirSync(runs, { recursive: true })
    const project = join(dir, 'Other')
    mkdirSync(project, { recursive: true })
    const source = createLanesSource({
      folder: runs,
      lanes: readLanes(),
      projectRoot: project,
      repoRoot: project,
      pollMs: 20,
      quietMs: 60000,
    })
    cleanups.push(() => source.stop())
    source.start()

    const name = 'opencode-project-20261024-130000'
    writeFileSync(join(runs, `${name}.meta.json`), `${JSON.stringify({ lane: 'opencode', project })}\n`)
    writeFileSync(join(runs, `${name}.log`), '')

    const runsOpen = await waitFor(() => (source.openRuns().length > 0 ? source.openRuns() : null), 3000)
    expect(runsOpen).toHaveLength(1)
    expect(runsOpen[0]).toMatchObject({ name, lane: 'opencode', project })
    expect(runsOpen[0].startedAt).toEqual(expect.any(String))
  })
})

describe('the lane routes', () => {
  it('answers tasks, live runs, comments and approvals from the lane runs', async () => {
    const { url, runs } = await startLaneBridge()
    const openName = 'opencode-L2-20261024-120000'
    const goodName = 'opencode-L1-20261024-100000'
    const failedName = 'opencode2-S6g-20261024-090000'
    const projectName = 'opencode-project-20261024-080000'
    const task = 'Update the sample project to the new layout and run its tests'

    writeFileSync(join(runs, `${openName}.log`), '')
    writeFileSync(
      join(runs, 'runs.jsonl'),
      [
        record({ lane: 'opencode', briefs: ['L1'], log: join(runs, `${goodName}.log`), startedAt: iso(30), exitCode: 0, costUsd: 0.5 }),
        record({ lane: 'opencode2', briefs: ['S6g'], log: join(runs, `${failedName}.log`), startedAt: iso(40), exitCode: 1 }),
        record({
          lane: 'opencode',
          log: join(runs, `${projectName}.log`),
          startedAt: iso(50),
          exitCode: 0,
          project: join(process.env.TEMP, 'other-project'),
          task,
        }),
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n')
        .concat('\n')
    )

    const issues = await waitFor(async () => {
      const { status, body } = await getJson(url, '/api/control/issues')
      return status === 200 && Array.isArray(body) && body.some((issue) => issue.id === openName) ? body : null
    })
    expect(issues).toHaveLength(4)
    const open = issues.find((issue) => issue.id === openName)
    expect(open).toMatchObject({ identifier: 'L2', status: 'in_progress', assigneeAgentId: 'agent-opencode' })
    expect(open.title).toContain('Tasks, approvals')
    expect(issues.find((issue) => issue.id === goodName)).toMatchObject({ identifier: 'L1', status: 'done' })
    expect(issues.find((issue) => issue.id === failedName)).toMatchObject({ identifier: 'S6g', status: 'blocked' })
    expect(issues.find((issue) => issue.id === projectName)).toMatchObject({ identifier: 'project', title: task, status: 'done' })

    const live = await getJson(url, '/api/control/live-runs')
    expect(live).toEqual({
      status: 200,
      body: {
        runs: [
          {
            runId: `run-${openName}`,
            agentId: 'agent-opencode',
            agentName: 'OpenCode',
            adapterType: 'opencode_local',
            status: 'running',
            issueId: openName,
            startedAt: expect.any(String),
            lastOutputAt: null,
          },
        ],
      },
    })

    const mapping = agentTasks(live.body.runs, issues, [{ id: 'agent-opencode', key: 'opencode' }])
    expect(mapping.get('opencode')).toBe('L2')

    expect(await getJson(url, `/api/control/comments?issueId=${encodeURIComponent(openName)}`)).toEqual({ status: 200, body: [] })
    expect(await getJson(url, '/api/control/approvals')).toEqual({ status: 200, body: [] })

    const cost = await getJson(url, '/api/control/costs')
    expect(cost.body.summary.spendCents).toBe(50)
    expect(cost.body.quota).toEqual([])

    const created = await postJson(url, '/api/control/issues', { title: 'Make a task', assigneeAgentId: 'agent-opencode' })
    expect(created).toEqual({ status: 409, body: { error: LANE_TASK_REFUSAL } })
    const withoutAgent = await postJson(url, '/api/control/issues', { title: 'Make a task' })
    expect(withoutAgent).toEqual({ status: 409, body: { error: LANE_TASK_REFUSAL } })
    const commented = await postJson(url, '/api/control/comments', { issueId: openName, body: 'Please read this.' })
    expect(commented).toEqual({ status: 409, body: { error: LANE_TASK_REFUSAL } })
  })

  it('lists the lane agents and refuses every agent write', async () => {
    const { url } = await startLaneBridge()
    const agents = await getJson(url, '/api/control/agents')
    expect(agents.status).toBe(200)
    expect(agents.body.map((agent) => [agent.key, agent.name, agent.role, agent.budgetMonthlyCents])).toEqual([
      ['opencode', 'OpenCode', null, 0],
      ['opencode2', 'OpenCode 2', null, 0],
      ['agy', 'agy', null, 0],
    ])

    expect(await postJson(url, '/api/control/agents', { name: 'Scout', adapterType: 'claude_local' })).toEqual({
      status: 409,
      body: { error: AGENT_REFUSAL },
    })
    expect(await patchJson(url, '/api/control/agents/agent-opencode', { model: 'm' })).toEqual({
      status: 409,
      body: { error: AGENT_REFUSAL },
    })
    expect(await postJson(url, '/api/control/agents/agent-opencode/budget', { budgetMonthlyCents: 250 })).toEqual({
      status: 409,
      body: { error: AGENT_REFUSAL },
    })
    const missing = await postJson(url, '/api/control/agents/%E0%A4%A/budget', { budgetMonthlyCents: 250 })
    expect(missing).toEqual({ status: 404, body: { error: 'That agent no longer exists.' } })
  })

  it('reads the run records with the live lane source off', async () => {
    const { url, runs } = await startLaneBridge({ lanes: false })
    const name = 'opencode-L1-20261024-100000'
    writeFileSync(
      join(runs, 'runs.jsonl'),
      `${JSON.stringify(record({ lane: 'opencode', briefs: ['L1'], log: join(runs, `${name}.log`), startedAt: iso(30), exitCode: 0 }))}\n`
    )

    const issues = await getJson(url, '/api/control/issues')
    expect(issues.status).toBe(200)
    expect(issues.body.map((issue) => issue.id)).toEqual([name])
    expect(await getJson(url, '/api/control/live-runs')).toEqual({ status: 200, body: { runs: [] } })
    expect(await getJson(url, '/api/control/approvals')).toEqual({ status: 200, body: [] })
    expect(await getJson(url, '/api/control/comments?issueId=x')).toEqual({ status: 200, body: [] })
  })
})
