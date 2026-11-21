import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_REFUSAL, changeEvents } from '../server/control.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { createBridge } from '../server/index.js'
import { createLanesSource } from '../server/lanes-source.js'
import {
  LANE_TASK_REFUSAL,
  laneLiveRuns,
  laneTaskIssues,
  laneTaskState,
  mergedBriefIds,
  readArchivedBriefs,
  readLaneBriefs,
  recentLaneRecords,
  runNameOf,
} from '../server/lane-tasks.js'
import { readAllRunRecords } from '../server/runs.js'
import { attentionItems } from '../src/briefs/attention.js'
import { agentTasks } from '../src/model/liveTasks.js'
import { makeTempDir } from './helpers/tempRoot.js'

// The cost route counts this calendar month, so a fixed date fails once its month ends.
const THIS_MONTH = new Date()
const BASE_TIME = Date.UTC(THIS_MONTH.getUTCFullYear(), THIS_MONTH.getUTCMonth(), 15, 10)
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
  const previousRuns = process.env.MACHINEROOM_RUNS
  process.env.TEMP = dir
  process.env.MACHINEROOM_RUNS = join(dir, 'machineroom-runs')
  cleanups.push(() => {
    process.env.TEMP = previous
    if (previousRuns === undefined) delete process.env.MACHINEROOM_RUNS
    else process.env.MACHINEROOM_RUNS = previousRuns
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
  writeActiveLanes(activeLanesFileFor(base, runs), Object.keys(LANES))
  useTemp(base)
  const bridge = createBridge({
    projectRoot: base,
    port: 0,
    env: {},
    lanesSource: lanes ? { folder: runs, lanes: LANES, repoRoot: base, pollMs: 20, quietMs: 60000 } : null,
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, runs, base }
}

async function getJson(url, path, options) {
  const response = await fetch(`${url}${path}`, options)
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

async function waitFor(fn, timeoutMs = 10000) {
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

  it('reads a failed or stopped run as done once a later run fixed its work', () => {
    const statusOf = (records) =>
      Object.fromEntries(laneTaskIssues({ records }).map((issue) => [issue.id, issue.status]))
    const failed = record({
      lane: 'opencode',
      briefs: ['L1'],
      log: '/tmp/runs/opencode-L1-20261024-090000.log',
      startedAt: iso(30),
      exitCode: 1,
    })
    const stopped = record({
      lane: 'opencode',
      briefs: ['L1'],
      log: '/tmp/runs/opencode-L1-20261024-080000.log',
      startedAt: iso(40),
      exitCode: 1,
      killed: true,
    })
    const fixedLater = record({
      lane: 'agy',
      briefs: ['L1'],
      log: '/tmp/runs/agy-L1-20261024-070000.log',
      startedAt: iso(20),
      exitCode: 0,
    })

    expect(statusOf([failed, fixedLater])).toEqual({
      'opencode-L1-20261024-090000': 'done',
      'agy-L1-20261024-070000': 'done',
    })
    expect(statusOf([stopped, fixedLater])).toEqual({
      'opencode-L1-20261024-080000': 'done',
      'agy-L1-20261024-070000': 'done',
    })
    expect(statusOf([failed])).toEqual({ 'opencode-L1-20261024-090000': 'blocked' })
    expect(statusOf([failed, record({ ...fixedLater, startedAt: iso(60), log: '/tmp/runs/agy-L1-20261024-100000.log' })])).toEqual({
      'opencode-L1-20261024-090000': 'blocked',
      'agy-L1-20261024-100000': 'done',
    })
  })

  it('reads brief ids from versioned merge subjects', () => {
    expect(mergedBriefIds([
      '0.1.401: Merge P644, The room puts the chosen top above the hub',
      '0.1.402: mErGe p645A, Update the room',
      '0.1.402: Fix P646, Update the room',
    ])).toEqual(new Set(['p644', 'p645a']))

    expect(mergedBriefIds(['0.1.402: Merge P648 and P649, plain names'])).toEqual(new Set(['p648', 'p649']))
    expect(mergedBriefIds(['0.1.402: Merge U167, the menu'])).toEqual(new Set(['u167']))
    expect(mergedBriefIds(['0.1.402: Merge P639, Agent seats S4'])).toEqual(new Set(['p639']))
  })

  it('marks failed runs done when all of their briefs merged', () => {
    const failed = record({ lane: 'codex', briefs: ['P644'], log: '/tmp/runs/codex-P644-20261024-090000.log', exitCode: 1 })
    const mergedBriefs = new Set(['p644'])

    expect(laneTaskIssues({ records: [failed], mergedBriefs })[0].status).toBe('done')
    expect(laneTaskIssues({ records: [{ ...failed, briefs: ['P644', 'P645a'] }], mergedBriefs })[0].status).toBe('blocked')
    expect(laneTaskIssues({ records: [{ ...failed, briefs: [] }], mergedBriefs })[0].status).toBe('blocked')
  })

  it('skips a failed record while all of its briefs are running again', () => {
    const failed = record({
      lane: 'codex',
      briefs: ['P650'],
      log: '/tmp/runs/codex-P650-20261120-163000.log',
      startedAt: iso(30),
      exitCode: 1,
    })
    const openRun = { name: 'agy3-P650-20261120-164900', lane: 'agy3', startedAt: iso(1) }

    const running = laneTaskIssues({ openRuns: [openRun], records: [failed] })
    expect(running).toHaveLength(1)
    expect(running[0]).toMatchObject({ id: openRun.name, identifier: 'P650', status: 'in_progress' })

    const alone = laneTaskIssues({ records: [failed] })
    expect(alone).toHaveLength(1)
    expect(alone[0]).toMatchObject({ id: 'codex-P650-20261120-163000', identifier: 'P650', status: 'blocked' })

    const pair = record({
      lane: 'codex',
      briefs: ['P650', 'P651'],
      log: '/tmp/runs/codex-P650-P651-20261120-163000.log',
      startedAt: iso(30),
      exitCode: 1,
    })
    const partial = laneTaskIssues({ openRuns: [openRun], records: [pair] })
    expect(partial).toHaveLength(2)
    expect(partial.find((issue) => issue.id === 'codex-P650-P651-20261120-163000')?.status).toBe('blocked')
    expect(partial.find((issue) => issue.id === openRun.name)?.status).toBe('in_progress')
  })

  it('keeps a run with two briefs blocked while only one of them succeeded later', () => {
    const failed = record({
      lane: 'opencode',
      briefs: ['L1', 'S6g'],
      log: '/tmp/runs/opencode-L1+S6g-20261024-090000.log',
      startedAt: iso(30),
      exitCode: 1,
    })
    const oneLater = record({
      lane: 'agy',
      briefs: ['L1'],
      log: '/tmp/runs/agy-L1-20261024-080000.log',
      startedAt: iso(20),
      exitCode: 0,
    })
    const bothLater = record({
      lane: 'agy',
      briefs: ['L1', 'S6g'],
      log: '/tmp/runs/agy-L1+S6g-20261024-070000.log',
      startedAt: iso(10),
      exitCode: 0,
    })
    const id = 'opencode-L1+S6g-20261024-090000'

    expect(laneTaskIssues({ records: [failed, oneLater] }).find((issue) => issue.id === id).status).toBe('blocked')
    expect(laneTaskIssues({ records: [failed, oneLater, bothLater] }).find((issue) => issue.id === id).status).toBe('done')
  })

  it('keeps a failed edit blocked when only a Plan mode run succeeded later', () => {
    const failed = record({ lane: 'codex', briefs: ['P1'], log: '/tmp/runs/codex-P1-20261024-090000.log', startedAt: iso(30), exitCode: 1 })
    const plan = record({ lane: 'codex', briefs: ['P1'], log: '/tmp/runs/codex-P1-20261024-080000.log', startedAt: iso(20), exitCode: 0 })
    plan.mode = 'plan'
    const id = 'codex-P1-20261024-090000'
    expect(laneTaskIssues({ records: [failed, plan] }).find((issue) => issue.id === id).status).toBe('blocked')
  })

  it('reads a failed run as done when its failover backup succeeded later', () => {
    const failed = record({
      lane: 'opencode',
      briefs: ['L1'],
      log: '/tmp/runs/opencode-L1-20261024-090000.log',
      startedAt: iso(30),
      exitCode: 1,
    })
    failed.failover = { kind: 'quota', to: 'agy' }
    const backup = record({
      lane: 'agy',
      briefs: ['L1'],
      log: '/tmp/runs/agy-L1-20261024-080000.log',
      startedAt: iso(20),
      exitCode: 0,
    })
    backup.failoverFrom = { lane: 'opencode', startedAt: failed.startedAt }

    const issues = laneTaskIssues({ records: [failed, backup] })
    expect(issues.find((issue) => issue.id === 'opencode-L1-20261024-090000').status).toBe('done')
  })

  it('keeps the failed task blocked when its backup fails and Needs you shows the backup', () => {
    const failed = {
      ...record({ lane: 'opencode', briefs: ['L1'], log: '/tmp/runs/opencode-L1-20261024-090000.log', startedAt: iso(30), exitCode: 1 }),
      failover: { kind: 'quota', to: 'agy' },
    }
    const other = record({ lane: 'agy', briefs: ['L2'], log: '/tmp/runs/agy-L2-20261024-090100.log', startedAt: iso(29) })
    const backup = {
      ...record({ lane: 'agy', briefs: ['L1'], log: '/tmp/runs/agy-L1-20261024-090200.log', startedAt: iso(28), exitCode: 1 }),
      failoverFrom: { lane: 'opencode', startedAt: failed.startedAt },
    }

    expect(attentionItems([failed, other]).map((item) => item.lane)).toEqual(['opencode'])
    expect(attentionItems([failed, backup]).map((item) => item.lane)).toEqual(['agy'])
    expect(laneTaskIssues({ records: [failed, backup] }).map((issue) => issue.status)).toEqual(['blocked', 'blocked'])
  })

  it('takes a title from the archive when the brief has left TASKS.md', () => {
    const dir = tempDir()
    const agents = join(dir, 'docs', 'agents')
    const archive = join(agents, 'history', 'TASKS-ARCHIVE.md')
    mkdirSync(join(agents, 'history'), { recursive: true })
    writeFileSync(join(agents, 'TASKS.md'), '## Open\n\n**N1. The new brief.** Text here.\n')
    writeFileSync(archive, '# Archive.\n\n## Done\n\n**A1. The archived brief.** Text here.\n')
    const records = [
      record({ lane: 'opencode', briefs: ['A1'], log: '/tmp/runs/opencode-A1-20261024-100000.log', startedAt: iso(10) }),
      record({ lane: 'opencode', briefs: ['N1'], log: '/tmp/runs/opencode-N1-20261024-090000.log', startedAt: iso(20) }),
    ]

    const first = readArchivedBriefs(dir)
    expect(readArchivedBriefs(dir)).toBe(first)
    const state = laneTaskState({ records, briefs: readLaneBriefs(dir), folder: dir })
    expect(state.issues.map((issue) => [issue.identifier, issue.title])).toEqual([
      ['A1', 'The archived brief'],
      ['N1', 'The new brief'],
    ])

    writeFileSync(archive, '# Archive.\n\n## Done\n\n**A1. The changed archived brief.** Text here.\n')
    const changed = readArchivedBriefs(dir)
    expect(changed).not.toBe(first)
    expect(changed.find((brief) => brief.id === 'A1').title).toBe('The changed archived brief')
  })

  it('reuses the combined current and archived brief lookup until the archive changes', () => {
    const dir = tempDir()
    const agents = join(dir, 'docs', 'agents')
    const archive = join(agents, 'history', 'TASKS-ARCHIVE.md')
    mkdirSync(join(agents, 'history'), { recursive: true })
    writeFileSync(join(agents, 'TASKS.md'), '## Open\n\n**N1. The new brief.** Text here.\n')
    writeFileSync(archive, '# Archive.\n\n## Done\n\n**A1. The archived brief.** Text here.\n')

    let titleReads = 0
    const briefs = Object.freeze(
      readLaneBriefs(dir).map((brief) => {
        const value = brief.title
        return {
          ...brief,
          get title() {
            titleReads += 1
            return value
          },
        }
      })
    )
    const records = [
      record({ lane: 'opencode', briefs: ['A1'], log: '/tmp/runs/opencode-A1-20261024-100000.log', startedAt: iso(10) }),
      record({ lane: 'opencode', briefs: ['N1'], log: '/tmp/runs/opencode-N1-20261024-090000.log', startedAt: iso(20) }),
    ]

    const first = laneTaskState({ records, briefs, folder: dir })
    expect(first.issues.map((issue) => [issue.identifier, issue.title])).toEqual([
      ['A1', 'The archived brief'],
      ['N1', 'The new brief'],
    ])
    const readsAfterFirst = titleReads

    const second = laneTaskState({ records: [...records], briefs, folder: dir })
    expect(second.issues.map((issue) => [issue.identifier, issue.title])).toEqual([
      ['A1', 'The archived brief'],
      ['N1', 'The new brief'],
    ])
    expect(titleReads).toBe(readsAfterFirst)

    writeFileSync(archive, '# Archive.\n\n## Done\n\n**A1. The updated archived brief.** Text here.\n')
    const third = laneTaskState({ records: [...records], briefs, folder: dir })
    expect(third.issues.map((issue) => [issue.identifier, issue.title])).toEqual([
      ['A1', 'The updated archived brief'],
      ['N1', 'The new brief'],
    ])
    const readsAfterUpdate = titleReads

    const fourth = laneTaskState({ records: [...records], briefs, folder: dir })
    expect(fourth.issues.map((issue) => [issue.identifier, issue.title])).toEqual([
      ['A1', 'The updated archived brief'],
      ['N1', 'The new brief'],
    ])
    expect(titleReads).toBe(readsAfterUpdate)
  })

  it('reuses cached TASKS.md briefs until the file changes', () => {
    const dir = tempDir()
    const agents = join(dir, 'docs', 'agents')
    mkdirSync(agents, { recursive: true })
    const tasksFile = join(agents, 'TASKS.md')
    writeFileSync(tasksFile, '## Open\n\n**N1. Initial brief.** Body.\n')

    const first = readLaneBriefs(dir)
    expect(readLaneBriefs(dir)).toBe(first)
    expect(first.find((brief) => brief.id === 'N1').title).toBe('Initial brief')

    writeFileSync(tasksFile, '## Open\n\n**N1. Updated brief title here.** Body.\n')
    const changed = readLaneBriefs(dir)
    expect(changed).not.toBe(first)
    expect(changed.find((brief) => brief.id === 'N1').title).toBe('Updated brief title here')
  })

  it('resolves failed tasks with frozen recoveryRecords in laneTaskIssues', () => {
    const failedPlan = { ...record({ lane: 'codex', briefs: ['P1'], log: '/tmp/runs/codex-P1-20261024-090000.log', startedAt: iso(40), exitCode: 1 }), mode: 'plan' }
    const failedEdit = record({ lane: 'codex', briefs: ['P2'], log: '/tmp/runs/codex-P2-20261024-090100.log', startedAt: iso(35), exitCode: 1 })
    const planFix = { ...record({ lane: 'codex', briefs: ['P1'], log: '/tmp/runs/codex-P1-20261024-080000.log', startedAt: iso(20), exitCode: 0 }), mode: 'plan' }
    const planForEdit = { ...record({ lane: 'codex', briefs: ['P2'], log: '/tmp/runs/codex-P2-20261024-080100.log', startedAt: iso(15), exitCode: 0 }), mode: 'plan' }
    const recovery = Object.freeze([failedPlan, failedEdit, planFix, planForEdit])

    const issues = laneTaskIssues({ records: [failedPlan, failedEdit], recoveryRecords: recovery })
    expect(issues.find((issue) => issue.id === 'codex-P1-20261024-090000').status).toBe('done')
    expect(issues.find((issue) => issue.id === 'codex-P2-20261024-090100').status).toBe('blocked')
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

    const all = readAllRunRecords(file)
    const records = recentLaneRecords(all)
    expect(records).toHaveLength(30)
    expect(records[0].log).toContain('000031')
    expect(records.every((entry) => entry.lane === 'opencode')).toBe(true)
    expect(recentLaneRecords(all, 2)).toHaveLength(2)
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
      lanes: LANES,
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

    const runsOpen = await waitFor(() => (source.openRuns().length > 0 ? source.openRuns() : null), 10000)
    expect(runsOpen).toHaveLength(1)
    expect(runsOpen[0]).toMatchObject({ name, lane: 'opencode', project })
    expect(runsOpen[0].startedAt).toEqual(expect.any(String))
  })
})

describe('the lane routes', () => {
  it('answers tasks, live runs, comments and approvals from the lane runs', async () => {
    const { url, runs, base } = await startLaneBridge()
    const openName = 'opencode-L2-20261024-120000'
    const goodName = 'opencode-project-20261024-100000'
    const failedName = 'opencode2-project-20261024-090000'
    const projectName = 'opencode-project-20261024-080000'
    const task = 'Update the sample project to the new layout and run its tests'

    writeFileSync(join(runs, `${openName}.log`), '')
    writeFileSync(
      join(runs, 'runs.jsonl'),
      [
        record({ lane: 'opencode', task: 'Check the costs', log: join(runs, `${goodName}.log`), startedAt: iso(30), exitCode: 0, costUsd: 0.5, project: base }),
        record({ lane: 'opencode2', task: 'Review the harness', log: join(runs, `${failedName}.log`), startedAt: iso(40), exitCode: 1, project: base }),
        record({
          lane: 'opencode',
          log: join(runs, `${projectName}.log`),
          startedAt: iso(50),
          exitCode: 0,
          project: base,
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
    expect(issues.find((issue) => issue.id === goodName)).toMatchObject({ identifier: 'project', title: 'Check the costs', status: 'done' })
    expect(issues.find((issue) => issue.id === failedName)).toMatchObject({ identifier: 'project', title: 'Review the harness', status: 'blocked' })
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

    const commented = await postJson(url, '/api/control/comments', { issueId: openName, body: 'Please read this.' })
    expect(commented).toEqual({ status: 409, body: { error: LANE_TASK_REFUSAL } })
  })

  it('uses only the current project to decide if a later run fixed a failed task', async () => {
    const { url, runs, base } = await startLaneBridge({ lanes: false })
    const file = join(runs, 'runs.jsonl')
    const id = 'opencode-project-failed'
    const task = 'Run the checks'
    const failed = record({ lane: 'opencode', project: base, task, log: join(runs, `${id}.log`), startedAt: iso(30), exitCode: 1 })
    const foreign = record({ lane: 'agy', project: tempDir(), task, log: join(runs, 'agy-project-success.log'), startedAt: iso(20) })
    writeFileSync(file, [failed, foreign].map((entry) => JSON.stringify(entry) + '\n').join(''))

    const issues = await getJson(url, '/api/control/issues')
    expect(issues.body.find((issue) => issue.id === id)).toMatchObject({ status: 'blocked' })
    expect(issues.body.map((issue) => issue.id)).toEqual([id])
    const page = { headers: { origin: url } }
    const before = await getJson(url, '/api/control/runs', page)
    expect(before.body.attention).toEqual([{ lane: 'opencode', startedAt: failed.startedAt, text: 'opencode failed on Run the checks' }])

    const repair = { ...foreign, project: join(base, '.worktrees', 'agy') }
    appendFileSync(file, JSON.stringify(repair) + '\n')
    const after = await getJson(url, '/api/control/issues?status=done')
    expect(after.body.map((issue) => issue.id)).toContain(id)
    expect((await getJson(url, '/api/control/runs', page)).body.attention).toEqual([])
  })

  it('lists the lane agents and refuses an agent budget write', async () => {
    const { url } = await startLaneBridge()
    const agents = await getJson(url, '/api/control/agents')
    expect(agents.status).toBe(200)
    expect(agents.body.map((agent) => [agent.key, agent.name, agent.role, agent.budgetMonthlyCents])).toEqual([
      ['opencode', 'OpenCode', null, 0],
      ['opencode2', 'OpenCode 2', null, 0],
      ['agy', 'agy', null, 0],
    ])

    expect(await postJson(url, '/api/control/agents/agent-opencode/budget', { budgetMonthlyCents: 250 })).toEqual({
      status: 409,
      body: { error: AGENT_REFUSAL },
    })
    const missing = await postJson(url, '/api/control/agents/%E0%A4%A/budget', { budgetMonthlyCents: 250 })
    expect(missing).toEqual({ status: 404, body: { error: 'That agent no longer exists.' } })
  })

  it('reads the run records with the live lane source off', async () => {
    const { url, runs, base } = await startLaneBridge({ lanes: false })
    const name = 'opencode-project-20261024-100000'
    writeFileSync(
      join(runs, 'runs.jsonl'),
      `${JSON.stringify(record({ lane: 'opencode', task: 'Check the costs', log: join(runs, `${name}.log`), startedAt: iso(30), exitCode: 0, project: base }))}\n`
    )

    const issues = await getJson(url, '/api/control/issues')
    expect(issues.status).toBe(200)
    expect(issues.body.map((issue) => issue.id)).toEqual([name])
    expect(await getJson(url, '/api/control/live-runs')).toEqual({ status: 200, body: { runs: [] } })
    expect(await getJson(url, '/api/control/approvals')).toEqual({ status: 200, body: [] })
    expect(await getJson(url, '/api/control/comments?issueId=x')).toEqual({ status: 200, body: [] })
  })

  it('returns no tasks with a missing runs folder and no lane source', async () => {
    const base = tempDir()
    const runs = join(base, 'missing-runs')
    const bridge = createBridge({ projectRoot: base, runsFolder: runs, lanesSource: null, port: 0, env: {} })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    rmSync(runs, { recursive: true, force: true })
    expect(existsSync(runs)).toBe(false)
    expect(await getJson(url, '/api/control/issues')).toEqual({ status: 200, body: [] })
  })

  it('skips main subjects and lane briefs when serving another project folder', async () => {
    const { url, runs, base } = await startLaneBridge({ lanes: false })
    const name = 'opencode-P674-20261121-100000'
    writeFileSync(
      join(runs, 'runs.jsonl'),
      `${JSON.stringify(record({ lane: 'opencode', briefs: ['P674'], log: join(runs, `${name}.log`), startedAt: iso(30), exitCode: 1, project: base }))}\n`
    )

    const issues = await getJson(url, '/api/control/issues')
    expect(issues.status).toBe(200)
    expect(issues.body).toHaveLength(1)
    expect(issues.body[0]).toMatchObject({
      id: name,
      identifier: 'project',
      title: 'project',
      status: 'blocked',
    })
  })
})

it('carries live lane context into the control response', () => {
  const [run] = laneLiveRuns({ openRuns: [{ name: 'opencode-test', lane: 'opencode', contextTokens: 116800, contextWindow: 163840 }], agents: AGENTS })
  expect(run).toMatchObject({ contextTokens: 116800, contextWindow: 163840 })
  expect(changeEvents({ type: 'heartbeat.run.context' })).toEqual([{ topic: 'liveRuns' }])
})

it('reads a Codex rollout into a live lane', async () => {
  const base = tempDir()
  const runs = join(base, 'runs')
  const home = join(base, 'codex')
  const date = new Date()
  const day = join(home, 'sessions', String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'))
  mkdirSync(runs, { recursive: true })
  mkdirSync(day, { recursive: true })
  const previous = process.env.CODEX_HOME
  process.env.CODEX_HOME = home
  cleanups.push(() => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous })
  const source = createLanesSource({ folder: runs, lanes: { codex: { name: 'Codex', cli: { harness: 'codex', model: 'test' } } }, pollMs: 20 })
  cleanups.push(() => source.stop())
  source.start()
  writeFileSync(join(day, 'rollout-test-thread-1.jsonl'), JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 163840, last_token_usage: { total_tokens: 116800 } } } }) + '\n')
  writeFileSync(join(runs, 'codex-project-20261117-120000.log'), JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }) + '\n')
  const open = await waitFor(() => source.openRuns().find((run) => run.contextWindow === 163840), 10000)
  expect(open.contextTokens).toBe(116800)
})

it('reads a live Codex rollout at most once every two seconds', async () => {
  const base = tempDir()
  const runs = join(base, 'runs')
  const home = join(base, 'codex')
  const date = new Date()
  const day = join(home, 'sessions', String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'))
  mkdirSync(runs, { recursive: true })
  mkdirSync(day, { recursive: true })
  const previous = process.env.CODEX_HOME
  process.env.CODEX_HOME = home
  cleanups.push(() => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous })
  const rollout = join(day, 'rollout-test-thread-2.jsonl')
  const usage = (tokens) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 163840, last_token_usage: { total_tokens: tokens } } } }) + '\n'
  let offset = 0
  const frames = []
  const source = createLanesSource({
    folder: runs,
    lanes: { codex: { name: 'Codex', cli: { harness: 'codex', model: 'test' } } },
    pollMs: 20,
    now: () => Date.now() + offset,
    onFrame: (frame) => frames.push(frame),
  })
  cleanups.push(() => source.stop())
  source.start()
  writeFileSync(rollout, usage(1000))
  writeFileSync(join(runs, 'codex-project-20261117-120000.log'), JSON.stringify({ type: 'thread.started', thread_id: 'thread-2' }) + '\n')
  const contexts = () => frames.filter((frame) => frame.type === 'heartbeat.run.context').length
  await waitFor(() => contexts() === 1, 10000)
  writeFileSync(rollout, usage(2000))
  offset += 500
  source.tick()
  source.tick()
  expect(contexts()).toBe(1)
  offset += 2000
  await waitFor(() => contexts() === 2, 10000)
  expect(source.openRuns()[0].contextTokens).toBe(2000)
})
