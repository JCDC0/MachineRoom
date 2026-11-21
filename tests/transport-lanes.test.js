import { describe, expect, it } from 'vitest'
import {
  LANE_PILL_LIMIT,
  ROOM_LINGER_MS,
  agentListPosition,
  ageText,
  inspectLane,
  isLaneAgent,
  laneAgents,
  lanePillTitle,
  lanePills,
  queueStep,
  runFailed,
} from '../src/ui/transportLanes.js'

const NOW = Date.parse('2026-11-03T12:00:00.000Z')

function lane(key, name) {
  return { id: `agent-${key}`, key, name, adapterType: 'opencode_local', role: null }
}

const AGENTS = [lane('opencode', 'OpenCode'), lane('opencode2', 'OpenCode 2'), lane('agy', 'agy')]

function run(laneKey, startedAt, status = 'running') {
  return {
    runId: `run-${laneKey}`,
    agentId: `agent-${laneKey}`,
    status,
    issueId: `${laneKey}-U120-20261103-090000`,
    startedAt,
  }
}

function issue(id, identifier) {
  return { id, identifier, status: 'in_progress', title: identifier }
}

function record(laneKey, startedAt, exitCode, extra = {}) {
  return { lane: laneKey, startedAt, exitCode, killed: false, briefs: ['U120'], ...extra }
}

describe('the lanes a pill can show', () => {
  it('keeps lanes and leaves the orchestrator, a sub, a session reader and an older agent out', () => {
    const agents = [
      { id: 'agent-orchestrator', key: 'orchestrator', adapterType: 'claude_local', role: null },
      { id: 'agent-sub-x', key: 'sub-x', adapterType: 'claude_local', role: null, subOrchestrator: true },
      { id: 'agent-claude-session', key: 'claude-session', adapterType: 'claude_local', role: null },
      { id: 'agent-opencode', key: 'opencode', adapterType: 'opencode_local', role: null },
      { id: 'agent-old', key: 'old', adapterType: 'unknown_local', role: null },
      { id: 'agent-role', key: 'role', adapterType: 'opencode_local', role: 'general' },
      lane('opencode2', 'OpenCode 2'),
      lane('opencode2', 'OpenCode 2'),
    ]
    expect(laneAgents(agents).map((agent) => agent.key)).toEqual(['opencode', 'opencode2'])
    expect(isLaneAgent(agents[0])).toBe(false)
    expect(isLaneAgent(agents[1])).toBe(false)
    expect(isLaneAgent(agents[2])).toBe(false)
    expect(isLaneAgent(agents[3])).toBe(true)
    expect(isLaneAgent(null)).toBe(false)
  })
})

describe('the lane pill list', () => {
  it('shows a working lane with its label, task, minutes and yellow tone', () => {
    const { pills, more } = lanePills({
      agents: AGENTS,
      liveRuns: [run('opencode', '2026-11-03T11:48:00.000Z')],
      issues: [issue('opencode-U120-20261103-090000', 'U120')],
      labels: new Map([['opencode', 'Frontend']]),
      now: NOW,
    })
    expect(pills).toEqual([
      {
        key: 'opencode',
        label: 'Frontend',
        task: 'U120',
        state: 'working',
        tone: 'working',
        minutes: 12,
        startedAt: Date.parse('2026-11-03T11:48:00.000Z'),
        step: null,
      },
    ])
    expect(more).toBe(0)
    expect(lanePillTitle(pills[0])).toBe('Frontend · U120 · working · 12 min')
  })

  it('names a queued run and keeps the yellow dot', () => {
    const { pills } = lanePills({
      agents: AGENTS,
      liveRuns: [run('agy', '2026-11-03T11:55:00.000Z', 'queued')],
      issues: [issue('agy-U120-20261103-090000', 'U120')],
      now: NOW,
    })
    expect(pills).toHaveLength(1)
    expect(pills[0]).toMatchObject({ key: 'agy', label: 'agy', task: 'U120', state: 'queued', tone: 'working', minutes: 5 })
  })

  it('prefers the running task id and keeps long task text whole', () => {
    const running = run('opencode', '2026-11-03T11:48:00.000Z')
    const queued = { ...run('opencode', '2026-11-03T11:50:00.000Z', 'queued'), issueId: 'queued-issue' }
    const { pills } = lanePills({
      agents: AGENTS,
      liveRuns: [running, queued],
      issues: [
        { id: running.issueId, identifier: 'P525', name: 'A much longer issue name' },
        { id: queued.issueId, name: 'A different and longer queued issue name' },
      ],
      now: NOW,
    })
    expect(pills[0].task).toBe('P525')

    const longTask = 'P525-a-long-task-identifier'
    expect(lanePills({ agents: AGENTS, liveRuns: [running], issues: [{ id: running.issueId, identifier: longTask }] }).pills[0].task).toBe(longTask)
  })

  it('shows a red pill for a lane whose last run failed, and drops it once the lane runs again', () => {
    const records = { running: [], recent: [record('opencode2', '2026-11-03T10:30:00.000Z', 1, { task: 'A broken task' })] }
    const failed = lanePills({ agents: AGENTS, records, now: NOW })
    expect(failed.pills).toEqual([
      {
        key: 'opencode2',
        label: 'OpenCode 2',
        task: 'U120',
        state: 'failed',
        tone: 'failed',
        minutes: null,
        startedAt: Date.parse('2026-11-03T10:30:00.000Z'),
        step: null,
      },
    ])

    const restarted = lanePills({
      agents: AGENTS,
      liveRuns: [run('opencode2', '2026-11-03T11:58:00.000Z')],
      issues: [issue('opencode2-U120-20261103-090000', 'U120')],
      records,
      now: NOW,
    })
    expect(restarted.pills.map((pill) => [pill.key, pill.state])).toEqual([['opencode2', 'working']])
  })

  it('reads a failed pill from the last record per lane past the recent list', () => {
    const recent = Array.from({ length: 20 }, (_, index) => record('opencode2', `2026-11-03T1${Math.floor(index / 10)}:${String(index % 60).padStart(2, '0')}:00.000Z`, 0))
    const records = {
      running: [],
      recent,
      last: [record('opencode2', '2026-11-03T10:30:00.000Z', 1, { task: 'A broken task' })],
    }
    const { pills } = lanePills({ agents: AGENTS, records, now: NOW })
    expect(pills).toHaveLength(1)
    expect(pills[0]).toMatchObject({ key: 'opencode2', state: 'failed', tone: 'failed' })
  })

  it('shows nothing for a lane whose last run ended well or has no record', () => {
    const records = {
      running: [],
      recent: [record('opencode', '2026-11-03T10:00:00.000Z', 0)],
    }
    expect(lanePills({ agents: AGENTS, records, now: NOW }).pills).toEqual([])
    expect(runFailed(records.recent[0])).toBe(false)
    expect(runFailed({ killed: true })).toBe(true)
    expect(runFailed({ exitCode: null })).toBe(false)
    expect(runFailed(null)).toBe(false)
  })

  it('includes idle lanes when the agent list asks for them', () => {
    const { pills } = lanePills({ agents: AGENTS, includeIdle: true, limit: 20 })
    expect(pills.map((pill) => [pill.label, pill.state])).toEqual([['OpenCode', 'idle'], ['OpenCode 2', 'idle'], ['agy', 'idle']])
  })

  it('keeps the newest record per lane as that lane last run', () => {
    const records = {
      running: [],
      recent: [
        record('opencode', '2026-11-03T11:00:00.000Z', 0),
        record('opencode', '2026-11-03T09:00:00.000Z', 1),
      ],
    }
    expect(lanePills({ agents: AGENTS, records, now: NOW }).pills).toEqual([])
  })

  it('caps the list at LANE_PILL_LIMIT pills and counts the rest', () => {
    const agents = []
    const liveRuns = []
    const issues = []
    const count = LANE_PILL_LIMIT + 3
    for (let index = 0; index < count; index += 1) {
      const key = `lane${index}`
      agents.push(lane(key, key))
      liveRuns.push(run(key, `2026-11-03T11:${String(30 - index).padStart(2, '0')}:00.000Z`))
      issues.push(issue(`${key}-U120-20261103-090000`, `U${120 + index}`))
    }
    const { pills, more } = lanePills({ agents, liveRuns, issues, now: NOW })
    expect(pills).toHaveLength(LANE_PILL_LIMIT)
    expect(pills[0].task).toBe(`U${120 + count - 1}`)
    expect(more).toBe(3)
  })

  it('puts the lanes at work first and the failed lanes after them, newest failure first', () => {
    const records = {
      running: [],
      recent: [
        record('agy', '2026-11-03T10:00:00.000Z', 2),
        record('opencode', '2026-11-03T11:00:00.000Z', 1),
      ],
    }
    const { pills } = lanePills({
      agents: AGENTS,
      liveRuns: [run('opencode2', '2026-11-03T11:40:00.000Z')],
      issues: [issue('opencode2-U120-20261103-090000', 'U120')],
      records,
      now: NOW,
    })
    expect(pills.map((pill) => [pill.key, pill.state])).toEqual([
      ['opencode2', 'working'],
      ['opencode', 'failed'],
      ['agy', 'failed'],
    ])
  })

  it('drops old failed lanes and keeps recent finished lanes when lingerMs is set', () => {
    expect(ROOM_LINGER_MS).toBe(5 * 60 * 1000)
    const agents = [
      lane('old-fail', 'Old Fail'),
      lane('recent-fail', 'Recent Fail'),
      lane('recent-ok', 'Recent Ok'),
      lane('old-ok', 'Old Ok'),
    ]
    const records = {
      last: [
        record('old-fail', NOW - 10 * 86400000 - 60000, 1, { finishedAt: NOW - 10 * 86400000 }),
        record('recent-fail', NOW - 3 * 60000, 1, { finishedAt: NOW - 2 * 60000 }),
        record('recent-ok', NOW - 2 * 60000, 0, { finishedAt: NOW - 60000 }),
        record('old-ok', NOW - 7 * 60000, 0, { finishedAt: NOW - 6 * 60000 }),
      ],
    }
    const { pills } = lanePills({ agents, records, now: NOW, includeIdle: false, lingerMs: ROOM_LINGER_MS })
    expect(pills).toEqual([
      {
        key: 'recent-fail',
        label: 'Recent Fail',
        task: 'U120',
        state: 'failed',
        tone: 'failed',
        minutes: 2,
        startedAt: NOW - 3 * 60000,
        step: null,
      },
      {
        key: 'recent-ok',
        label: 'Recent Ok',
        task: 'U120',
        state: 'finished',
        tone: 'finished',
        minutes: 1,
        step: null,
      },
    ])
  })

  it('ignores lingerMs when includeIdle is true', () => {
    const records = {
      last: [
        record('opencode', NOW - 10 * 86400000 - 60000, 1, { finishedAt: NOW - 10 * 86400000 }),
      ],
    }
    const { pills } = lanePills({ agents: AGENTS, records, now: NOW, includeIdle: true, lingerMs: ROOM_LINGER_MS })
    expect(pills.map((pill) => [pill.key, pill.state])).toEqual([
      ['opencode', 'failed'],
      ['opencode2', 'idle'],
      ['agy', 'idle'],
    ])
  })

  it('shows no minutes when the run names no start', () => {
    const { pills } = lanePills({
      agents: AGENTS,
      liveRuns: [run('opencode', null)],
      issues: [issue('opencode-U120-20261103-090000', 'U120')],
      now: NOW,
    })
    expect(pills[0].minutes).toBeNull()
    expect(lanePillTitle(pills[0])).toBe('OpenCode · U120 · working')
  })
})

describe('the footer list position and age', () => {
  it('positions the list from the button and limits its height above the menu', () => {
    expect(agentListPosition({ top: 726, left: 500, width: 200 }, 800, 52)).toEqual({ bottom: 82, left: 600, height: 658 })
    expect(agentListPosition({ top: 1000, left: 300, width: 100 }, 1200, 60)).toEqual({ bottom: 208, left: 350, height: 924 })
  })

  it('uses end times for failed and finished rows and formats their ages', () => {
    const records = { last: [
      record('opencode', '2026-11-01T00:00:00Z', 1, { finishedAt: NOW - 5 * 60000 }),
      record('opencode2', '2026-11-01T00:00:00Z', 0, { finishedAt: NOW - 3 * 3600000 }),
      record('agy', '2026-11-01T00:00:00Z', 1, { finishedAt: NOW - 2 * 86400000 }),
    ] }
    const { pills } = lanePills({ agents: AGENTS, records, now: NOW, includeIdle: true })
    expect(pills.map((pill) => [pill.state, ageText(pill.minutes)])).toEqual([['failed', '2 d'], ['failed', '5 min'], ['finished', '3 h']])
    expect(ageText(null)).toBe('')
    expect(lanePillTitle(pills[1])).toContain('5 min')
  })
})

describe('the queue step of a run', () => {
  it('reads task 3 of 8 from the runner output', () => {
    const running = [{ lane: 'opencode', queue: true, tasks: 8, lastLines: ['task 3 of 8', 'working'] }]
    expect(queueStep(running, 'opencode')).toBe('3/8')
  })

  it('reads the newest step it can find', () => {
    const running = [{ lane: 'opencode', queue: true, lastLines: ['task 2 of 5', 'task 3 of 5'] }]
    expect(queueStep(running, 'opencode')).toBe('3/5')
  })

  it('says nothing for a run that is not a queue, another lane, or a step that makes no sense', () => {
    expect(queueStep([{ lane: 'opencode', queue: false, lastLines: ['task 1 of 2'] }], 'opencode')).toBeNull()
    expect(queueStep([{ lane: 'agy', queue: true, lastLines: ['task 1 of 2'] }], 'opencode')).toBeNull()
    expect(queueStep([{ lane: 'opencode', queue: true, lastLines: ['task 0 of 2'] }], 'opencode')).toBeNull()
    expect(queueStep([{ lane: 'opencode', queue: true, lastLines: ['task 9 of 2'] }], 'opencode')).toBeNull()
    expect(queueStep([{ lane: 'opencode', queue: true, lastLines: [] }], 'opencode')).toBeNull()
    expect(queueStep(null, 'opencode')).toBeNull()
    expect(queueStep([{ lane: 'opencode', queue: true, lastLines: ['task 1 of 2'] }], '')).toBeNull()
  })

  it('hands the step to the pill', () => {
    const { pills } = lanePills({
      agents: AGENTS,
      liveRuns: [run('opencode', '2026-11-03T11:50:00.000Z')],
      issues: [issue('opencode-U120-20261103-090000', 'U120')],
      records: { running: [{ lane: 'opencode', queue: true, tasks: 4, lastLines: ['task 2 of 4'] }], recent: [] },
      now: NOW,
    })
    expect(pills[0].step).toBe('2/4')
  })
})

describe('a click on a pill', () => {
  it('asks the page to inspect that lane', () => {
    const sent = []
    const windowStub = {
      CustomEvent: class {
        constructor(type, init) {
          this.type = type
          this.detail = init.detail
        }
      },
      dispatchEvent: (event) => sent.push({ type: event.type, detail: event.detail }),
    }
    expect(inspectLane('opencode', windowStub)).toBe(true)
    expect(sent).toEqual([{ type: 'machineroom:inspect', detail: { kind: 'agent', id: 'opencode' } }])
  })

  it('does nothing without a lane or a window', () => {
    expect(inspectLane('', {})).toBe(false)
    expect(inspectLane('opencode', null)).toBe(false)
    expect(inspectLane('opencode', { dispatchEvent: () => {} })).toBe(false)
  })
})
