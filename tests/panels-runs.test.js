import { act, createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../src/control/client.js'
import { createMockClient } from '../src/control/mock.js'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import {
  cancelSplitRun,
  clearProjectDraft,
  clearSplitRun,
  formatCost,
  NO_IDLE_LANE_PROBLEM,
  planLaneTasks,
  PROJECT_SPLIT_DELAY,
  PROJECT_TASK_PROBLEM,
  PROJECT_TASK_SEPARATOR_PROBLEM,
  PROJECT_TASKS_PROBLEM,
  projectRunConfirm,
  projectRunBody,
  projectRunLabel,
  projectRunLanes,
  projectCheckLine,
  projectSplitLabel,
  projectTaskProblem,
  projectWorktreeName,
  queueRecoveryAvailable,
  queueRecoveryMessage,
  queueRecoveryPlan,
  readProjectDraft,
  recordLine,
  resultWord,
  runStartLine,
  splitRunProgress,
  splitRunSnapshot,
  splitTasks,
  startSplitRun,
  timeSinceStart,
} from '../src/ui/panels/runs.js'
import { buttonWithText, settle, type, withDom } from './helpers/uiDom.js'

describe('resultWord', () => {
  it('returns finished when exitCode is 0 and killed is false', () => {
    expect(resultWord({ exitCode: 0, killed: false })).toBe('finished')
    expect(resultWord({ exitCode: 0 })).toBe('finished')
  })

  it('returns stopped when killed is true', () => {
    expect(resultWord({ exitCode: 0, killed: true })).toBe('stopped')
    expect(resultWord({ exitCode: 1, killed: true })).toBe('stopped')
    expect(resultWord({ exitCode: null, killed: true })).toBe('stopped')
    expect(resultWord({ killed: true })).toBe('stopped')
  })

  it('returns failed when exitCode is non-zero or null without killed', () => {
    expect(resultWord({ exitCode: 1, killed: false })).toBe('failed')
    expect(resultWord({ exitCode: 2 })).toBe('failed')
    expect(resultWord({ exitCode: null, killed: false })).toBe('failed')
    expect(resultWord({})).toBe('failed')
    expect(resultWord(null)).toBe('failed')
    expect(resultWord(undefined)).toBe('failed')
  })
})

describe('timeSinceStart', () => {
  const base = Date.parse('2026-10-19T20:00:00.000Z')

  it('returns time unknown for invalid or missing timestamps', () => {
    expect(timeSinceStart(null)).toBe('time unknown')
    expect(timeSinceStart(undefined)).toBe('time unknown')
    expect(timeSinceStart('')).toBe('time unknown')
    expect(timeSinceStart('not-a-date')).toBe('time unknown')
  })

  it('returns just now when difference is less than 60 seconds', () => {
    expect(timeSinceStart(base, base + 10000)).toBe('just now')
    expect(timeSinceStart(base, base + 59000)).toBe('just now')
  })

  it('returns minutes ago when under an hour', () => {
    expect(timeSinceStart(base, base + 60000)).toBe('1 min ago')
    expect(timeSinceStart(base, base + 5 * 60000)).toBe('5 min ago')
    expect(timeSinceStart(base, base + 59 * 60000)).toBe('59 min ago')
  })

  it('returns hours ago when under a day', () => {
    expect(timeSinceStart(base, base + 60 * 60000)).toBe('1 h ago')
    expect(timeSinceStart(base, base + 3 * 3600000)).toBe('3 h ago')
    expect(timeSinceStart(base, base + 23 * 3600000)).toBe('23 h ago')
  })

  it('returns days ago for 24 hours or more', () => {
    expect(timeSinceStart(base, base + 24 * 3600000)).toBe('1 d ago')
    expect(timeSinceStart(base, base + 48 * 3600000)).toBe('2 d ago')
  })

  it('accepts ISO strings, numbers, or objects with startedAt', () => {
    const iso = '2026-10-19T20:00:00.000Z'
    expect(timeSinceStart(iso, base + 120000)).toBe('2 min ago')
    expect(timeSinceStart({ startedAt: iso }, base + 120000)).toBe('2 min ago')
  })
})

describe('formatCost', () => {
  it('returns cost unknown for null, undefined, or non-finite values', () => {
    expect(formatCost(null)).toBe('cost unknown')
    expect(formatCost(undefined)).toBe('cost unknown')
    expect(formatCost(Number.NaN)).toBe('cost unknown')
    expect(formatCost('free')).toBe('cost unknown')
  })

  it('formats zero as $0.00', () => {
    expect(formatCost(0)).toBe('$0.00')
  })

  it('formats numbers with up to four decimals', () => {
    expect(formatCost(0.0123)).toBe('$0.0123')
    expect(formatCost(0.5)).toBe('$0.5000')
  })
})

describe('recordLine', () => {
  it('formats a finished record with cost, minutes, and start time', () => {
    const record = {
      lane: 'hermes',
      briefs: ['T7'],
      startedAt: '2026-10-19T20:30:00.000Z',
      minutes: 0,
      exitCode: 0,
      killed: false,
      costUsd: null,
      log: 'C:\\private\\folder\\log.txt',
    }
    const line = recordLine(record)
    expect(line).toBe('hermes | T7 | finished | cost unknown | 0 min | 2026-10-19T20:30:00.000Z')
    expect(line).not.toContain('C:\\private\\folder')
    expect(line).not.toContain('log.txt')
  })

  it('formats a stopped record when killed', () => {
    const record = {
      lane: 'opencode',
      briefs: ['T5', 'T7'],
      startedAt: '2026-10-19T21:00:00.000Z',
      minutes: 4,
      exitCode: null,
      killed: true,
      costUsd: 0.025,
      log: 'C:\\Users\\jc\\AppData\\log.txt',
    }
    const line = recordLine(record)
    expect(line).toBe('opencode | T5 T7 | stopped | $0.0250 | 4 min | 2026-10-19T21:00:00.000Z')
    expect(line).not.toContain('C:\\Users\\jc')
  })

  it('formats a failed record when exitCode is non-zero', () => {
    const record = {
      lane: 'hermes',
      briefs: ['P7'],
      startedAt: '2026-10-19T21:30:00.000Z',
      minutes: 1,
      exitCode: 1,
      killed: false,
      costUsd: 0.001,
    }
    expect(recordLine(record)).toBe('hermes | P7 | failed | $0.0010 | 1 min | 2026-10-19T21:30:00.000Z')
  })

  it('handles missing or empty fields safely', () => {
    expect(recordLine({})).toBe('unknown | none | failed | cost unknown | 0 min | time unknown')
    expect(recordLine(null)).toBe('')
  })

  it('formats a project run using the first line of task', () => {
    const line = recordLine({
      lane: 'opencode',
      briefs: [],
      task: '\r\n  Fix the flaky lock.\tPlease.\r\nAlso add a regression test.',
      project: 'App',
      startedAt: '2026-10-19T22:00:00.000Z',
      minutes: 2,
      exitCode: 0,
      killed: false,
      costUsd: 0.01,
    })
    expect(line).toBe('opencode | Fix the flaky lock. Please. | finished | $0.0100 | 2 min | 2026-10-19T22:00:00.000Z')
    expect(line).not.toContain('Also add a regression test')
    expect(line).not.toMatch(/[\r\n]/)
  })

  it('shows the saved note when a run failed or was refused', () => {
    const refused = recordLine({
      lane: 'opencode',
      briefs: [],
      task: 'Fix the typo.',
      project: 'App',
      startedAt: '2026-10-19T22:05:00.000Z',
      minutes: 0,
      exitCode: 3,
      killed: false,
      startFailed: true,
      note: 'the runner refused to start\nor could not start',
      costUsd: null,
    })
    expect(refused).toContain('opencode | Fix the typo. | failed | cost unknown | 0 min | 2026-10-19T22:05:00.000Z')
    expect(refused).toContain('the runner refused to start or could not start')
    expect(refused).not.toMatch(/[\r\n]/)

    const failed = recordLine({
      lane: 'agy',
      briefs: ['P206'],
      startedAt: '2026-10-19T22:10:00.000Z',
      minutes: 1,
      exitCode: 1,
      killed: false,
      note: 'Runner exited 1 before committing.',
      costUsd: 0.002,
    })
    expect(failed).toContain('Runner exited 1 before committing.')

    const succeeded = recordLine({
      lane: 'agy',
      briefs: ['P206'],
      startedAt: '2026-10-19T22:12:00.000Z',
      minutes: 1,
      exitCode: 0,
      killed: false,
      note: 'leftovers were stopped',
      costUsd: 0.002,
    })
    expect(succeeded).toBe('agy | P206 | finished | $0.0020 | 1 min | 2026-10-19T22:12:00.000Z')
  })

  it('shows queueStatus and tests status when present', () => {
    const failedTests = recordLine({
      lane: 'opencode',
      briefs: [],
      task: 'Queue task one',
      project: 'App',
      startedAt: '2026-10-19T22:15:00.000Z',
      minutes: 3,
      exitCode: 1,
      killed: false,
      costUsd: 0.05,
      tests: 'failed',
      queueStatus: 'failed: tests',
      note: 'Tests exited with code 1.',
    })
    expect(failedTests).toContain('opencode | Queue task one | failed')
    expect(failedTests).toContain('failed: tests')
    expect(failedTests).toContain('tests failed')
    expect(failedTests).toContain('Tests exited with code 1.')

    const passedTests = recordLine({
      lane: 'opencode',
      briefs: [],
      task: 'Queue task two',
      project: 'App',
      startedAt: '2026-10-19T22:20:00.000Z',
      minutes: 2,
      exitCode: 0,
      killed: false,
      costUsd: 0.03,
      tests: 'passed',
    })
    expect(passedTests).toContain('tests passed')

    const stoppedQueue = recordLine({
      lane: 'opencode',
      briefs: [],
      task: 'Queue task three',
      project: 'App',
      startedAt: '2026-10-19T22:25:00.000Z',
      minutes: 1,
      exitCode: null,
      killed: true,
      costUsd: 0.01,
      tests: 'none',
      queueStatus: 'failed: lane killed',
    })
    expect(stoppedQueue).toContain('stopped')
    expect(stoppedQueue).toContain('failed: lane killed')
    expect(stoppedQueue).toContain('tests none')
  })
})

describe('runStartLine', () => {
  it('names the lane and what the bridge started', () => {
    expect(runStartLine({ lane: 'opencode', queue: true, tasks: 1 })).toBe('opencode started 1 task in order.')
    expect(runStartLine({ lane: 'hermes', queue: true, tasks: 3 })).toBe('hermes started 3 tasks in order.')
    expect(runStartLine({ lane: 'claude' })).toBe('claude started.')
  })

  it('handles a missing lane or answer', () => {
    expect(runStartLine(null)).toBe('The bridge sent no answer.')
    expect(runStartLine(undefined)).toBe('The bridge sent no answer.')
    expect(runStartLine({ lane: '  ' })).toBe('The run started.')
  })
})

describe('splitTasks', () => {
  it('reads one task', () => {
    expect(splitTasks('Fix the typo.')).toEqual(['Fix the typo.'])
    expect(splitTasks('  Fix the typo.  \n')).toEqual(['Fix the typo.'])
    expect(splitTasks('First line.\nSecond line.')).toEqual(['First line.\nSecond line.'])
  })

  it('reads three tasks', () => {
    expect(splitTasks('One.\n---\nTwo.\n---\nThree.')).toEqual(['One.', 'Two.', 'Three.'])
    expect(splitTasks('One.\r\n---\r\nTwo.\r\n---\r\nThree.')).toEqual(['One.', 'Two.', 'Three.'])
    expect(splitTasks('  One.  \n---\n  Two.  \n---\n  Three.  ')).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('drops blank blocks', () => {
    expect(splitTasks('')).toEqual([])
    expect(splitTasks('   \n\n')).toEqual([])
    expect(splitTasks('\n---\nOne.\n---\n\n---\nTwo.\n---\n')).toEqual(['One.', 'Two.'])
  })

  it('treats a line of --- with spaces around it as a separator', () => {
    expect(splitTasks('One.\n  ---  \nTwo.')).toEqual(['One.', 'Two.'])
    expect(splitTasks('One.\n\t---\t\nTwo.')).toEqual(['One.', 'Two.'])
    expect(splitTasks('One.\n-----\nTwo.')).toEqual(['One.\n-----\nTwo.'])
  })
})

describe('planLaneTasks', () => {
  const lanes = [
    { key: 'opencode', name: 'OpenCode', running: false },
    { key: 'hermes', name: 'Hermes', running: true },
    { key: 'claude', name: 'Claude', running: false },
    { key: 'opencode2', name: '', running: false },
  ]

  it('pairs tasks with idle lanes in picker order', () => {
    expect(planLaneTasks(['One.', 'Two.', 'Three.'], lanes)).toEqual({
      pairs: [
        { task: 'One.', lane: 'opencode', name: 'OpenCode' },
        { task: 'Two.', lane: 'claude', name: 'Claude' },
        { task: 'Three.', lane: 'opencode2', name: 'opencode2' },
      ],
      problem: null,
    })
  })

  it("pairs tasks in the route's order, then the roster's", () => {
    const route = {
      lane: 'claude',
      skipped: [
        { lane: 'hermes', why: 'The lane hermes is busy.' },
        { lane: 'opencode2', why: 'The lane opencode2 is turned off.' },
      ],
    }
    expect(planLaneTasks(['One.', 'Two.', 'Three.'], lanes, route)).toEqual({
      pairs: [
        { task: 'One.', lane: 'claude', name: 'Claude' },
        { task: 'Two.', lane: 'opencode2', name: 'opencode2' },
        { task: 'Three.', lane: 'opencode', name: 'OpenCode' },
      ],
      problem: null,
    })
  })

  it('keeps the roster order with no route', () => {
    const plan = planLaneTasks(['One.', 'Two.'], lanes, null)
    expect(plan.pairs.map((pair) => pair.lane)).toEqual(['opencode', 'claude'])
  })

  it('takes one task on one idle lane and trims the task', () => {
    expect(planLaneTasks(['  One.  '], lanes)).toEqual({
      pairs: [{ task: 'One.', lane: 'opencode', name: 'OpenCode' }],
      problem: null,
    })
  })

  it('skips running lanes and keeps the order of the rest', () => {
    const plan = planLaneTasks(['One.', 'Two.'], [lanes[2], lanes[1], lanes[0]])
    expect(plan.problem).toBeNull()
    expect(plan.pairs.map((pair) => pair.lane)).toEqual(['claude', 'opencode'])
  })

  it('skips duplicate and unusable lanes', () => {
    const list = [
      null,
      'lane',
      { key: '' },
      { key: 'opencode', name: 'OpenCode' },
      { key: 'opencode', name: 'OpenCode again' },
      { key: 'hermes', name: 'Hermes', running: true },
    ]
    expect(planLaneTasks(['One.'], list)).toEqual({
      pairs: [{ task: 'One.', lane: 'opencode', name: 'OpenCode' }],
      problem: null,
    })
  })

  it('refuses when there are fewer idle lanes than tasks', () => {
    expect(planLaneTasks(['One.', 'Two.', 'Three.', 'Four.'], lanes)).toEqual({
      pairs: [],
      problem: '4 tasks need 4 idle lanes. Only 3 lanes are idle.',
    })
    expect(planLaneTasks(['One.', 'Two.'], [lanes[0]])).toEqual({
      pairs: [],
      problem: '2 tasks need 2 idle lanes. Only 1 lane is idle.',
    })
  })

  it('refuses when no lane is idle', () => {
    expect(planLaneTasks(['One.'], [lanes[1]])).toEqual({
      pairs: [],
      problem: NO_IDLE_LANE_PROBLEM,
    })
    expect(NO_IDLE_LANE_PROBLEM).toBe('No lane is idle.')
    expect(planLaneTasks(['One.'], [])).toEqual({ pairs: [], problem: NO_IDLE_LANE_PROBLEM })
    expect(planLaneTasks(['One.'], null)).toEqual({ pairs: [], problem: NO_IDLE_LANE_PROBLEM })
  })

  it('refuses a bad task list before it counts lanes', () => {
    expect(planLaneTasks([], lanes)).toEqual({ pairs: [], problem: PROJECT_TASK_PROBLEM })
    expect(planLaneTasks([''], lanes)).toEqual({ pairs: [], problem: PROJECT_TASK_PROBLEM })
    expect(planLaneTasks(['one', 7], lanes)).toEqual({ pairs: [], problem: PROJECT_TASK_PROBLEM })
    expect(planLaneTasks(Array.from({ length: 21 }, () => 'x'), lanes)).toEqual({
      pairs: [],
      problem: PROJECT_TASKS_PROBLEM,
    })
  })
})

describe('projectTaskProblem with a task list', () => {
  it('checks each task in the list', () => {
    expect(projectTaskProblem(['one', 'two'])).toBeNull()
    expect(projectTaskProblem([])).toBe(PROJECT_TASK_PROBLEM)
    expect(projectTaskProblem(['one', ''])).toBe(PROJECT_TASK_PROBLEM)
    expect(projectTaskProblem(['one', '   '])).toBe(PROJECT_TASK_PROBLEM)
    expect(projectTaskProblem(['one', 7])).toBe(PROJECT_TASK_PROBLEM)
    expect(projectTaskProblem(['one', 'x'.repeat(4001)])).toBe(PROJECT_TASK_PROBLEM)
    expect(projectTaskProblem(Array.from({ length: 21 }, () => 'x'))).toBe(PROJECT_TASKS_PROBLEM)
    expect(projectTaskProblem(['one\n---\ntwo'])).toBe(PROJECT_TASK_SEPARATOR_PROBLEM)
  })
})

describe('projectRunLabel', () => {
  it('counts a queue in the button label', () => {
    expect(projectRunLabel(0)).toBe('Run')
    expect(projectRunLabel(1)).toBe('Run')
    expect(projectRunLabel(2)).toBe('Run 2 tasks in order')
    expect(projectRunLabel(20)).toBe('Run 20 tasks in order')
    expect(projectRunLabel('3')).toBe('Run')
    expect(projectRunLabel(undefined)).toBe('Run')
  })
})

describe('projectSplitLabel', () => {
  it('counts tasks and lanes when several tasks are split', () => {
    expect(projectSplitLabel(2)).toBe('Run 2 tasks on 2 lanes')
    expect(projectSplitLabel(10)).toBe('Run 10 tasks on 10 lanes')
  })

  it('falls back to the queue label for one task or junk', () => {
    expect(projectSplitLabel(0)).toBe('Run')
    expect(projectSplitLabel(1)).toBe('Run')
    expect(projectSplitLabel('3')).toBe('Run')
    expect(projectSplitLabel(undefined)).toBe('Run')
  })
})

describe('PROJECT_SPLIT_DELAY', () => {
  it('is three seconds', () => {
    expect(PROJECT_SPLIT_DELAY).toBe(3000)
  })
})

describe('cancelSplitRun', () => {
  afterEach(() => {
    vi.useRealTimers()
    clearSplitRun()
  })

  it('stops before the next start and keeps the runs already started', async () => {
    vi.useFakeTimers()
    const calls = []
    const client = {
      startRun: async (lane) => {
        calls.push(lane)
        return { lane, queue: true, tasks: 1 }
      },
    }
    const pairs = [
      { lane: 'alpha', task: 'One.' },
      { lane: 'beta', task: 'Two.' },
      { lane: 'gamma', task: 'Three.' },
    ]

    const run = startSplitRun({ client, pairs })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual(['alpha'])
    expect(splitRunSnapshot().active).toBe(true)

    expect(cancelSplitRun()).toBe(true)
    expect(splitRunSnapshot().cancelled).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    await run

    expect(calls).toEqual(['alpha'])
    const snapshot = splitRunSnapshot()
    expect(snapshot.active).toBe(false)
    expect(snapshot.done).toBe(true)
    expect(snapshot.cancelled).toBe(true)
    expect(splitRunProgress(snapshot)).toBe(
      'Stopped after starting 1 of 3 tasks. The runs already started keep running.'
    )
  })

  it('says nothing is stopping when no split run is active', () => {
    expect(cancelSplitRun()).toBe(false)
    expect(splitRunProgress({ pairs: [], answers: [] })).toBe('Started 0 tasks.')
  })

  it('clears a stopped run and starts the next one uncancelled', async () => {
    vi.useFakeTimers()
    const calls = []
    const client = {
      startRun: async (lane) => {
        calls.push(lane)
        return { lane, queue: true, tasks: 1 }
      },
    }
    const pairs = [
      { lane: 'alpha', task: 'One.' },
      { lane: 'beta', task: 'Two.' },
      { lane: 'gamma', task: 'Three.' },
    ]

    const first = startSplitRun({ client, pairs })
    await vi.advanceTimersByTimeAsync(0)
    cancelSplitRun()
    await first
    expect(clearSplitRun()).toBe(true)
    expect(splitRunSnapshot().active).toBe(false)

    calls.length = 0
    const second = startSplitRun({ client, pairs })
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(3000)
    await second

    expect(calls).toEqual(['alpha', 'beta', 'gamma'])
    expect(splitRunSnapshot().cancelled).toBe(false)
  })
})

describe('projectWorktreeName', () => {
  it('names the worktree folder beside the project', () => {
    expect(projectWorktreeName('Other', 'opencode')).toBe('Other/.worktrees/opencode')
    expect(projectWorktreeName('C:\\GitHub\\Other', 'claude')).toBe('Other/.worktrees/claude')
    expect(projectWorktreeName('work/Other/', 'opencode10')).toBe('Other/.worktrees/opencode10')
  })

  it('returns an empty name when the project or lane is missing', () => {
    expect(projectWorktreeName('', 'opencode')).toBe('')
    expect(projectWorktreeName('Other', '')).toBe('')
    expect(projectWorktreeName(null, 'opencode')).toBe('')
    expect(projectWorktreeName('C:', 'opencode')).toBe('')
  })
})

describe('projectRunBody', () => {
  it('sends a single task in its own worktree as a queue of one', () => {
    expect(projectRunBody({ task: 'Fix it.', allowDirty: true, worktree: true })).toEqual({
      tasks: ['Fix it.'],
      worktree: true,
    })
    expect(projectRunBody({ task: 'Fix it.', worktree: false })).toEqual({
      task: 'Fix it.',
      allowDirty: false,
    })
  })

  it('sends a queue with the worktree switch', () => {
    expect(projectRunBody({ tasks: ['One.', 'Two.'], allowDirty: true, worktree: true })).toEqual({
      tasks: ['One.', 'Two.'],
      worktree: true,
    })
    expect(projectRunBody({ tasks: ['One.', 'Two.'], worktree: false })).toEqual({
      tasks: ['One.', 'Two.'],
    })
  })

  it('falls back to an empty task for junk input', () => {
    expect(projectRunBody()).toEqual({ task: '', allowDirty: false })
    expect(projectRunBody({ task: 7, worktree: 'yes' })).toEqual({ task: '', allowDirty: false })
  })
})

describe('projectRunBody with a check command', () => {
  it('adds the command to a queue and to a single task', () => {
    expect(projectRunBody({ tasks: ['One.', 'Two.'], worktree: true, checkCommand: ' node check.mjs ' })).toEqual({
      tasks: ['One.', 'Two.'],
      worktree: true,
      checkCommand: 'node check.mjs',
    })
    expect(projectRunBody({ task: 'Fix it.', checkCommand: 'node check.mjs' })).toEqual({
      task: 'Fix it.',
      allowDirty: false,
      checkCommand: 'node check.mjs',
    })
    expect(projectRunBody({ task: 'Fix it.', checkCommand: '   ' })).toEqual({
      task: 'Fix it.',
      allowDirty: false,
    })
  })
})

describe('projectCheckLine', () => {
  it('names the command, npm test or no check', () => {
    expect(projectCheckLine({ checkCommand: 'node check.mjs', hasTestScript: false })).toBe('Check: node check.mjs')
    expect(projectCheckLine({ checkCommand: '', hasTestScript: true })).toBe('Check: npm test')
    expect(projectCheckLine({ checkCommand: '', hasTestScript: false })).toBe(
      'No check: this project has no npm test script.'
    )
  })
})

describe('projectRunLanes', () => {
  it('leaves out the sub orchestrators', () => {
    const agents = [
      { key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', role: null },
      { key: 'sub-frontend', name: 'Frontend', adapterType: 'claude_local', role: null, subOrchestrator: true },
      { key: 'sub-backend', name: 'Backend', adapterType: 'claude_local', role: null },
    ]
    expect(projectRunLanes(agents, [{ lane: 'opencode' }])).toEqual([
      { key: 'opencode', name: 'OpenCode', running: true },
    ])
  })

  it('leaves out the orchestrator', () => {
    const agents = [
      { key: 'orchestrator', name: 'Orchestrator', adapterType: 'claude_local', role: null },
      { key: 'claude-2', name: 'Coder', adapterType: 'claude_local', role: null },
    ]
    expect(projectRunLanes(agents, [])).toEqual([{ key: 'claude-2', name: 'Coder', running: false }])
  })
})

describe('projectRunConfirm with a task list', () => {
  it('keeps the single task shape and names a queue', () => {
    expect(projectRunConfirm({ lane: 'opencode', project: 'Other', tasks: ['One.'] })).toEqual({
      lane: 'opencode',
      project: 'Other',
      task: 'One.',
    })
    expect(projectRunConfirm({ lane: 'opencode', project: 'Other', tasks: ['One.', 'Two.', 'Three.'] })).toEqual({
      lane: 'opencode',
      project: 'Other',
      task: 'One.',
      queue: true,
      count: 3,
    })
    expect(projectRunConfirm({ lane: 'opencode', tasks: ['One.', 'Two.'] })).toEqual({
      lane: 'opencode',
      project: 'this project',
      task: 'One.',
      queue: true,
      count: 2,
    })
  })
})

describe('the control client startRun', () => {
  it('passes a task queue through to the bridge', async () => {
    const bodies = []
    const client = createClient({
      baseUrl: 'http://127.0.0.1:5174',
      fetchImpl: async (url, options) => {
        bodies.push(JSON.parse(options.body))
        return { ok: true, json: async () => ({ lane: 'opencode', briefs: [], queue: true, tasks: 2 }) }
      },
    })
    const answer = await client.startRun('opencode', { tasks: ['One.', 'Two.'] })
    expect(bodies).toEqual([{ lane: 'opencode', tasks: ['One.', 'Two.'], confirmed: true }])
    expect(answer).toMatchObject({ lane: 'opencode', queue: true, tasks: 2 })
  })

  it('passes the worktree switch through to the bridge', async () => {
    const bodies = []
    const client = createClient({
      baseUrl: 'http://127.0.0.1:5174',
      fetchImpl: async (url, options) => {
        bodies.push(JSON.parse(options.body))
        return { ok: true, json: async () => ({ lane: 'opencode', briefs: [], worktree: true }) }
      },
    })
    const answer = await client.startRun('opencode', { task: 'Fix it.', worktree: true })
    expect(bodies).toEqual([{ lane: 'opencode', task: 'Fix it.', worktree: true, confirmed: true }])
    expect(answer).toMatchObject({ lane: 'opencode', worktree: true })
  })
})

const RECOVERY_BRANCH = 'machineroom/queue-opencode-20261113-120000-123'
const RECOVERY_TASK = 'Fix the parser\nand add a test.'
const RECOVERY_TASKS = ['Add the parser', RECOVERY_TASK, 'Write the docs', 'Run the checks']

function recoveryRecord(extra = {}) {
  return {
    lane: 'opencode',
    project: 'C:\\work\\demo',
    queue: RECOVERY_BRANCH,
    queueIndex: 2,
    queueStatus: 'failed: tests',
    task: RECOVERY_TASK,
    tasks: RECOVERY_TASKS,
    note: 'The tests failed.',
    exitCode: 1,
    ...extra,
  }
}

describe('queueRecoveryAvailable', () => {
  it('offers recovery only on a queue row whose queueStatus says it failed or stopped', () => {
    expect(queueRecoveryAvailable({ queue: RECOVERY_BRANCH, queueStatus: 'failed: tests' })).toBe(true)
    expect(queueRecoveryAvailable({ queue: RECOVERY_BRANCH, queueStatus: 'failed: the queue stopped' })).toBe(true)
    expect(queueRecoveryAvailable({ queue: RECOVERY_BRANCH, queueStatus: 'stopped by the owner' })).toBe(true)
    expect(queueRecoveryAvailable({ queue: RECOVERY_BRANCH, queueStatus: 'passed' })).toBe(false)
    expect(queueRecoveryAvailable({ queue: RECOVERY_BRANCH })).toBe(false)
    expect(queueRecoveryAvailable({ queueStatus: 'failed: tests' })).toBe(false)
    expect(queueRecoveryAvailable({ lane: 'agy', briefs: ['P1'], queueStatus: 'failed: tests' })).toBe(false)
    expect(queueRecoveryAvailable(null)).toBe(false)
  })
})

describe('queueRecoveryPlan', () => {
  it('names the lane, project, branch, failed task number and first line, and the count left', () => {
    const plan = queueRecoveryPlan(recoveryRecord())
    expect(plan).toMatchObject({
      lane: 'opencode',
      project: 'demo',
      branch: RECOVERY_BRANCH,
      number: 2,
      task: RECOVERY_TASK,
      firstLine: 'Fix the parser',
      remainingCount: 2,
      count: 4,
      note: 'The tests failed.',
      missing: [],
    })
    expect(plan.remaining).toEqual(['Write the docs', 'Run the checks'])
  })

  it('reports the parts a record without a task list does not hold', () => {
    const plan = queueRecoveryPlan({
      lane: 'opencode',
      project: 'C:\\work\\demo',
      queue: RECOVERY_BRANCH,
      queueIndex: 2,
      queueStatus: 'failed: tests',
      task: 'Fix the parser',
    })
    expect(plan.remaining).toBeNull()
    expect(plan.remainingCount).toBeNull()
    expect(plan.missing).toEqual(['the queue task list', 'how many tasks the queue held', 'the note'])
  })
})

describe('queueRecoveryMessage', () => {
  it('carries the failed task and every task that did not run in full', () => {
    const message = queueRecoveryMessage(recoveryRecord())
    expect(message).toContain('Recovery for the opencode lane on demo.')
    expect(message).toContain(`Queue branch: ${RECOVERY_BRANCH}`)
    expect(message).toContain('Failed task: task 2.')
    expect(message).toContain(RECOVERY_TASK)
    expect(message).toContain('2 tasks did not run:')
    expect(message).toContain('3. Write the docs')
    expect(message).toContain('4. Run the checks')
    expect(message).toContain('Note: The tests failed.')
    expect(message).toContain("Inspect the uncommitted work in the lane's worktree first")
    expect(message).toContain('Do not discard changes and do not rerun the queue by itself.')
  })

  it('says which parts are missing instead of guessing the remaining tasks', () => {
    const message = queueRecoveryMessage({
      lane: 'opencode',
      project: 'C:\\work\\demo',
      queue: RECOVERY_BRANCH,
      queueIndex: 2,
      queueStatus: 'failed: tests',
      task: 'Fix the parser',
    })
    expect(message).toContain("The record does not hold the queue's task list, so the tasks that did not run are not known.")
    expect(message).toContain('Missing from the record: the queue task list, how many tasks the queue held, the note.')
    expect(message).not.toContain('Write the docs')
  })
})

describe('Dispatch project check command', () => {
  it('fills the saved command and names it on the confirm card', async () => {
    const saved = []
    const started = []
    const client = {
      health: async () => ({ lanes: true }),
      runs: async () => ({ running: [], recent: [], project: 'demo' }),
      projectSettings: async () => ({ checkCommand: 'node scripts/check.mjs', hasTestScript: true }),
      saveProjectSettings: async ({ checkCommand }) => {
        saved.push(checkCommand)
        return { checkCommand, hasTestScript: true }
      },
      startRun: async (lane, body) => {
        started.push({ lane, body })
        return { lane, queue: true, tasks: 1 }
      },
    }
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(DispatchPanel, {
            client,
            initialAgents: [{ key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', role: null }],
          })
        )
      })
      await settle()
      const field = container.querySelector('#project-run-check')
      expect(field).not.toBeNull()
      expect(field.value).toBe('node scripts/check.mjs')
      expect(container.textContent).toContain(
        'Runs after each task; the task is committed only when it passes. Empty uses npm test when package.json has one.'
      )

      const lane = container.querySelector('#project-run-lane')
      await type(root, lane, 'opencode')
      await type(root, container.querySelector('#project-run-task'), 'Fix the typo.')
      await act(async () => {
        buttonWithText(container, 'Run').click()
      })
      await settle()
      expect(container.textContent).toContain('Check: node scripts/check.mjs')

      await act(async () => {
        buttonWithText(container, 'Confirm').click()
      })
      await settle()
      expect(saved).toEqual(['node scripts/check.mjs'])
      expect(started).toHaveLength(1)
      expect(started[0].body.checkCommand).toBe('node scripts/check.mjs')
    })
  })
})

describe('Dispatch queue recovery', () => {
  function makeClient(records, send) {
    return {
      health: async () => ({ lanes: true }),
      runs: async () => ({ running: [], recent: records, project: 'demo' }),
      sendOrchestrator: async (text) => {
        send.push(text)
      },
    }
  }

  async function mount(root, client) {
    await act(async () => {
      root.render(createElement(DispatchPanel, { client, initialAgents: [] }))
    })
    await settle()
  }

  it('offers Ask for recovery only on a stopped or failed queue row', async () => {
    const send = []
    const client = makeClient([
      recoveryRecord(),
      { lane: 'opencode2', queue: 'machineroom/queue-opencode2-1', task: 'Done.', exitCode: 0 },
      { lane: 'agy', briefs: ['P1'], exitCode: 1, note: 'The run failed.' },
    ], send)
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const buttons = container
        .querySelectorAll('button')
        .filter((button) => button.textContent.trim() === 'Ask for recovery')
      expect(buttons).toHaveLength(1)
      expect(container.textContent).toContain('opencode')
      expect(container.textContent).toContain('opencode2')
      expect(container.textContent).toContain('agy')
    })
  })

  it('sends nothing before Confirm and then one message to Main', async () => {
    const send = []
    const client = makeClient([recoveryRecord()], send)
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const ask = buttonWithText(container, 'Ask for recovery')
      expect(ask).not.toBeNull()
      await act(async () => {
        ask.click()
      })
      await settle()
      expect(send).toHaveLength(0)
      expect(container.textContent).toContain('Lane: opencode')
      expect(container.textContent).toContain('Project: demo')
      expect(container.textContent).toContain(`Queue branch: ${RECOVERY_BRANCH}`)
      expect(container.textContent).toContain('Task 2: Fix the parser')
      expect(container.textContent).toContain('2 tasks did not run.')

      const confirm = buttonWithText(container, 'Confirm')
      expect(confirm).not.toBeNull()
      await act(async () => {
        confirm.click()
      })
      await settle()
      expect(send).toHaveLength(1)
      expect(send[0]).toContain(RECOVERY_TASK)
      expect(send[0]).toContain('3. Write the docs')
      expect(send[0]).toContain('4. Run the checks')
      expect(container.textContent).toContain('Sent to Main.')
    })
  })

  it('shows the error under the row when the message cannot be sent', async () => {
    const client = makeClient([recoveryRecord()], [])
    client.sendOrchestrator = async () => {
      throw new Error('The orchestrator is not connected.')
    }
    await withDom(async ({ container, root }) => {
      await mount(root, client)
      const ask = buttonWithText(container, 'Ask for recovery')
      await act(async () => {
        ask.click()
      })
      await settle()
      const confirm = buttonWithText(container, 'Confirm')
      await act(async () => {
        confirm.click()
      })
      await settle()
      expect(container.textContent).toContain('The orchestrator is not connected.')
    })
  })
})

describe('mock client runs lifecycle', () => {
  it('starts a run, refuses a concurrent run on the same lane, and completes into recent', async () => {
    const client = createMockClient({ latencyMs: 0, runMs: 300 })
    const entry = await client.startRun('hermes', ['P5'])
    expect(entry.lane).toBe('hermes')
    expect(entry.briefs).toEqual(['P5'])

    const runsWhileActive = await client.runs()
    expect(runsWhileActive.running).toHaveLength(1)
    expect(runsWhileActive.running[0].lane).toBe('hermes')

    await expect(client.startRun('hermes', ['P5'])).rejects.toThrow('That lane is already running.')

    const deadline = Date.now() + 3000
    let runsAfterDone = await client.runs()
    while (runsAfterDone.running.length > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      runsAfterDone = await client.runs()
    }
    expect(runsAfterDone.running).toHaveLength(0)
    expect(runsAfterDone.recent).toHaveLength(1)
    expect(resultWord(runsAfterDone.recent[0])).toBe('finished')
    expect(recordLine(runsAfterDone.recent[0])).toContain('hermes | P5 | finished')
  })

  it('keeps the worktree switch on the running entry and the record', async () => {
    const client = createMockClient({ latencyMs: 0, runMs: 60 })
    const entry = await client.startRun('opencode', { task: 'Fix it.', worktree: true })
    expect(entry.worktree).toBe(true)

    const active = await client.runs()
    expect(active.running[0].worktree).toBe(true)

    const deadline = Date.now() + 3000
    let runs = active
    while (runs.running.length > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      runs = await client.runs()
    }
    expect(runs.recent[0].worktree).toBe(true)
  })
})

describe('queueRecoveryMessage with the runner record fields', () => {
  it('lists the tasks the runner recorded as not run', () => {
    const message = queueRecoveryMessage({
      lane: 'opencode',
      project: 'C:/work/app',
      queue: 'machineroom/queue-opencode-20261113-120000-123',
      queueIndex: 2,
      queueSize: 3,
      queueRemaining: ['Write the third file.'],
      queueStatus: 'failed: tests',
      task: 'Write the second file.',
      note: 'The tests failed.',
    })
    expect(message).toContain('1 task did not run:')
    expect(message).toContain('3. Write the third file.')
    expect(message).not.toContain('the queue task list')
  })
})

describe('Dispatch draft per project', () => {
  const draftAgents = [{ key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', role: null }]

  function draftClient(project, { savedCheckCommand = '', startRun } = {}) {
    return {
      health: async () => ({ lanes: true }),
      runs: async () => ({ running: [], recent: [], project }),
      projectSettings: async () => ({ checkCommand: savedCheckCommand, hasTestScript: true }),
      saveProjectSettings: async ({ checkCommand }) => ({ checkCommand, hasTestScript: true }),
      startRun:
        startRun ??
        (async (lane, body) => ({ lane, queue: Array.isArray(body?.tasks), tasks: body?.tasks?.length ?? 1 })),
    }
  }

  async function mountDraftPanel(root, client) {
    await act(async () => {
      root.render(createElement(DispatchPanel, { client, initialAgents: draftAgents }))
    })
    await settle()
  }

  it('keeps the task, lane and check command after the panel unmounts and mounts again', async () => {
    const project = 'draft-survives'
    const client = draftClient(project, { savedCheckCommand: 'node saved-check.mjs' })
    await withDom(async ({ container, root, window }) => {
      await mountDraftPanel(root, client)
      await type(root, container.querySelector('#project-run-task'), 'Write the draft.')
      await type(root, container.querySelector('#project-run-lane'), 'opencode')
      await type(root, container.querySelector('#project-run-check'), 'node draft-check.mjs')
      expect(window.localStorage.values.size).toBe(0)
    })
    await withDom(async ({ container, root }) => {
      await mountDraftPanel(root, client)
      expect(container.querySelector('#project-run-task').value).toBe('Write the draft.')
      expect(container.querySelector('#project-run-check').value).toBe('node draft-check.mjs')
      await act(async () => {
        buttonWithText(container, 'Run').click()
      })
      await settle()
      expect(container.textContent).toContain('Lane: opencode')
      expect(container.textContent).toContain('Check: node draft-check.mjs')
    })
    clearProjectDraft(project)
  })

  it('keeps two projects apart and brings each draft back on return', async () => {
    const alpha = draftClient('draft-alpha')
    const beta = draftClient('draft-beta')
    await withDom(async ({ container, root }) => {
      await mountDraftPanel(root, alpha)
      await type(root, container.querySelector('#project-run-task'), 'Alpha task.')

      await act(async () => {
        root.render(createElement(DispatchPanel, { client: beta, initialAgents: draftAgents }))
      })
      await settle()
      expect(container.querySelector('#project-run-task').value).toBe('')
      await type(root, container.querySelector('#project-run-task'), 'Beta task.')

      await act(async () => {
        root.render(createElement(DispatchPanel, { client: alpha, initialAgents: draftAgents }))
      })
      await settle()
      expect(container.querySelector('#project-run-task').value).toBe('Alpha task.')
      expect(readProjectDraft('draft-beta').task).toBe('Beta task.')
    })
    clearProjectDraft('draft-alpha')
    clearProjectDraft('draft-beta')
  })

  it('clears the draft when a start succeeds', async () => {
    const project = 'draft-start'
    const started = []
    const client = draftClient(project, {
      startRun: async (lane, body) => {
        started.push({ lane, body })
        return { lane, queue: true, tasks: 1 }
      },
    })
    await withDom(async ({ container, root }) => {
      await mountDraftPanel(root, client)
      await type(root, container.querySelector('#project-run-lane'), 'opencode')
      await type(root, container.querySelector('#project-run-task'), 'Run this once.')
      await act(async () => {
        buttonWithText(container, 'Run').click()
      })
      await settle()
      await act(async () => {
        buttonWithText(container, 'Confirm').click()
      })
      await settle()
      expect(started).toHaveLength(1)
      expect(container.querySelector('#project-run-task').value).toBe('')
      expect(readProjectDraft(project)).toBeNull()
    })
    await withDom(async ({ container, root }) => {
      await mountDraftPanel(root, client)
      expect(container.querySelector('#project-run-task').value).toBe('')
    })
    clearProjectDraft(project)
  })

  it('clears the draft only after Discard draft is confirmed', async () => {
    const project = 'draft-discard'
    const client = draftClient(project, { savedCheckCommand: 'node saved-check.mjs' })
    await withDom(async ({ container, root }) => {
      await mountDraftPanel(root, client)
      await type(root, container.querySelector('#project-run-task'), 'Throw this away.')
      await type(root, container.querySelector('#project-run-lane'), 'opencode')
      await type(root, container.querySelector('#project-run-check'), 'node draft-check.mjs')

      const discard = buttonWithText(container, 'Discard draft')
      expect(discard).not.toBeNull()
      await act(async () => {
        discard.click()
      })
      expect(container.querySelector('#project-run-task').value).toBe('Throw this away.')
      expect(readProjectDraft(project).task).toBe('Throw this away.')

      await act(async () => {
        buttonWithText(container, 'Confirm discard').click()
      })
      expect(container.querySelector('#project-run-task').value).toBe('')
      expect(container.querySelector('#project-run-check').value).toBe('')
      expect(readProjectDraft(project)).toBeNull()
    })
    await withDom(async ({ container, root }) => {
      await mountDraftPanel(root, client)
      expect(container.querySelector('#project-run-task').value).toBe('')
      expect(container.querySelector('#project-run-check').value).toBe('node saved-check.mjs')
    })
    clearProjectDraft(project)
  })
})
