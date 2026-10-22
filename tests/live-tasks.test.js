import { describe, expect, it } from 'vitest'
import { agentTasks } from '../src/model/liveTasks.js'

describe('agentTasks', () => {
  const roster = [
    { id: 'agent-1', key: 'opencode', name: 'OpenCode Go' },
    { id: 'agent-2', key: 'hermes', name: 'Hermes' },
  ]

  const issues = [
    { id: 'issue-1', identifier: 'JC-19', title: 'Task 1' },
    { id: 'issue-2', identifier: 'JC-20', title: 'Task 2' },
  ]

  it('the mapping', () => {
    const liveRuns = [
      { runId: 'run-1', agentId: 'agent-1', status: 'running', issueId: 'issue-1' },
      { runId: 'run-2', agentId: 'agent-2', status: 'running', issueId: 'issue-2' },
    ]
    const map = agentTasks(liveRuns, issues, roster)
    expect(map).toBeInstanceOf(Map)
    expect(map.get('opencode')).toBe('JC-19')
    expect(map.get('hermes')).toBe('JC-20')
    expect(map.size).toBe(2)
  })

  it('running beats queued', () => {
    const liveRunsWithBoth = [
      { runId: 'run-q', agentId: 'agent-1', status: 'queued', issueId: 'issue-1' },
      { runId: 'run-r', agentId: 'agent-1', status: 'running', issueId: 'issue-2' },
    ]
    const mapBoth = agentTasks(liveRunsWithBoth, issues, roster)
    expect(mapBoth.get('opencode')).toBe('JC-20')

    const liveRunsQueuedOnly = [
      { runId: 'run-q', agentId: 'agent-1', status: 'queued', issueId: 'issue-1' },
    ]
    const mapQueued = agentTasks(liveRunsQueuedOnly, issues, roster)
    expect(mapQueued.has('opencode')).toBe(false)
    expect(mapQueued.size).toBe(0)
  })

  it('the newest of two running runs', () => {
    const olderFirst = [
      { runId: 'run-old', agentId: 'agent-1', status: 'running', issueId: 'issue-1', startedAt: '2026-10-21T10:00:00.000Z' },
      { runId: 'run-new', agentId: 'agent-1', status: 'running', issueId: 'issue-2', startedAt: '2026-10-21T10:05:00.000Z' },
    ]
    expect(agentTasks(olderFirst, issues, roster).get('opencode')).toBe('JC-20')

    const newerFirst = [
      { runId: 'run-new', agentId: 'agent-1', status: 'running', issueId: 'issue-2', startedAt: '2026-10-21T10:05:00.000Z' },
      { runId: 'run-old', agentId: 'agent-1', status: 'running', issueId: 'issue-1', startedAt: '2026-10-21T10:00:00.000Z' },
    ]
    expect(agentTasks(newerFirst, issues, roster).get('opencode')).toBe('JC-20')

    const noTimestamps = [
      { runId: 'run-1', agentId: 'agent-1', status: 'running', issueId: 'issue-1' },
      { runId: 'run-2', agentId: 'agent-1', status: 'running', issueId: 'issue-2' },
    ]
    expect(agentTasks(noTimestamps, issues, roster).get('opencode')).toBe('JC-19')
  })

  it('an unknown agent and an unknown task skipped', () => {
    const liveRuns = [
      { runId: 'run-1', agentId: 'agent-unknown', status: 'running', issueId: 'issue-1' },
      { runId: 'run-2', agentId: 'agent-1', status: 'running', issueId: 'issue-unknown' },
      { runId: 'run-3', agentId: 'agent-2', status: 'running', issueId: 'issue-2' },
      { runId: 'run-4', agentId: 'agent-no-key', status: 'running', issueId: 'issue-1' },
    ]
    const rosterWithNoKey = [...roster, { id: 'agent-no-key' }]
    const map = agentTasks(liveRuns, issues, rosterWithNoKey)
    expect(map.has('agent-unknown')).toBe(false)
    expect(map.has('opencode')).toBe(false)
    expect(map.has('undefined')).toBe(false)
    expect(map.has(undefined)).toBe(false)
    expect(map.get('hermes')).toBe('JC-20')
    expect(map.size).toBe(1)
  })

  it('a name with a direction control shown through visibleText', () => {
    const issuesWithControl = [
      { id: 'issue-ctrl-1', identifier: 'JC-19\u202E' },
      { id: 'issue-ctrl-2', name: 'TASK-\u200E99' },
    ]
    const liveRuns = [
      { runId: 'run-1', agentId: 'agent-1', status: 'running', issueId: 'issue-ctrl-1' },
      { runId: 'run-2', agentId: 'agent-2', status: 'running', issueId: 'issue-ctrl-2' },
    ]
    const map = agentTasks(liveRuns, issuesWithControl, roster)
    expect(map.get('opencode')).toBe('JC-19[U+202E]')
    expect(map.get('hermes')).toBe('TASK-[U+200E]99')
  })

  it('the 16 character cut', () => {
    const longIssues = [
      { id: 'issue-long', identifier: 'JC-12345678901234567890' },
    ]
    const liveRuns = [
      { runId: 'run-1', agentId: 'agent-1', status: 'running', issueId: 'issue-long' },
    ]
    const map = agentTasks(liveRuns, longIssues, roster)
    expect(map.get('opencode')).toBe('JC-1234567890123')
    expect(map.get('opencode').length).toBe(16)
  })

  it('input that is not an array', () => {
    expect(agentTasks(null, issues, roster)).toEqual(new Map())
    expect(agentTasks(undefined, issues, roster)).toEqual(new Map())
    expect(agentTasks('not an array', issues, roster)).toEqual(new Map())
    expect(agentTasks(123, issues, roster)).toEqual(new Map())
    expect(agentTasks({}, issues, roster)).toEqual(new Map())
    expect(agentTasks([], issues, roster)).toEqual(new Map())
    expect(agentTasks([{}], null, roster)).toEqual(new Map())
    expect(agentTasks([{}], issues, null)).toEqual(new Map())
  })
})
