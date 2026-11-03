import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { changeEvents, createControlApi } from '../server/control.js'
import { createMockClient } from '../src/control/mock.js'
import TasksPanel, { liveRunMark } from '../src/ui/panels/TasksPanel.jsx'

const AGENTS = [
  { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local' },
  { id: 'agent-opencode2', key: 'opencode2', name: 'OpenCode 2', adapterType: 'opencode_local' },
]

const OPEN = [
  { name: 'opencode-L2-20261021-100000', lane: 'opencode', startedAt: '2026-10-21T10:00:00.000Z' },
  { name: 'opencode2-L1-20261021-100500', lane: 'opencode2', startedAt: '2026-10-21T10:05:00.000Z' },
]

function laneSource(openRuns = OPEN, agents = AGENTS) {
  return { agents, openRuns: () => openRuns }
}

async function askRoute(lanes, path = '/api/control/live-runs') {
  let sent = null
  const api = createControlApi({
    sendJson: (req, res, status, body) => {
      sent = { status, body }
    },
    readJsonBody: async () => ({}),
    lanes,
  })
  const handled = await api.handle({ method: 'GET' }, {}, new URL(`http://bridge${path}`))
  return { handled, ...sent }
}

describe('the live runs route', () => {
  it('answers the open lane runs newest first with the contract fields', async () => {
    const answer = await askRoute(() => laneSource())
    expect(answer.handled).toBe(true)
    expect(answer.status).toBe(200)
    expect(answer.body.runs).toEqual([
      {
        runId: 'run-opencode2-L1-20261021-100500',
        agentId: 'agent-opencode2',
        agentName: 'OpenCode 2',
        adapterType: 'opencode_local',
        status: 'running',
        issueId: 'opencode2-L1-20261021-100500',
        startedAt: '2026-10-21T10:05:00.000Z',
        lastOutputAt: null,
      },
      {
        runId: 'run-opencode-L2-20261021-100000',
        agentId: 'agent-opencode',
        agentName: 'OpenCode',
        adapterType: 'opencode_local',
        status: 'running',
        issueId: 'opencode-L2-20261021-100000',
        startedAt: '2026-10-21T10:00:00.000Z',
        lastOutputAt: null,
      },
    ])
  })

  it('answers an empty list when there is no open run and no lane source', async () => {
    expect(await askRoute(() => laneSource([]))).toMatchObject({ status: 200, body: { runs: [] } })
    expect(await askRoute(() => null)).toMatchObject({ status: 200, body: { runs: [] } })
  })

  it('keeps a run whose agent is not in the list', async () => {
    const answer = await askRoute(() => laneSource([OPEN[0]], []))
    expect(answer.body.runs[0]).toMatchObject({ runId: 'run-opencode-L2-20261021-100000', agentId: null, agentName: 'opencode' })
  })
})

describe('the liveRuns notice', () => {
  const frame = (type, payload = {}) => ({ id: 1, companyId: 'comp-1', type, createdAt: '2026-10-21T10:00:00.000Z', payload })

  it('goes out on a run that is queued, starts or ends', () => {
    expect(changeEvents(frame('heartbeat.run.queued', { runId: 'r1' }))).toEqual([{ topic: 'agents' }, { topic: 'issues' }, { topic: 'liveRuns' }, { topic: 'runs' }])
    expect(changeEvents(frame('heartbeat.run.status', { runId: 'r1', status: 'running' }))).toEqual([{ topic: 'agents' }, { topic: 'issues' }, { topic: 'liveRuns' }, { topic: 'runs' }])
    for (const status of ['succeeded', 'failed', 'cancelled', 'timed_out']) {
      expect(changeEvents(frame('heartbeat.run.status', { runId: 'r1', status })), status).toEqual([{ topic: 'agents' }, { topic: 'issues' }, { topic: 'costs' }, { topic: 'liveRuns' }, { topic: 'runs' }])
    }
  })

  it('stays quiet on the log, event and progress frames a run sends many times a second', () => {
    for (const type of ['heartbeat.run.log', 'heartbeat.run.event', 'heartbeat.run.progress']) {
      expect(changeEvents(frame(type, { runId: 'r1', chunk: 'x' })), type).toEqual([])
    }
    expect(changeEvents(frame('agent.status', { status: 'running' }))).toEqual([{ topic: 'agents' }])
  })
})

describe('the live run mark in the Tasks panel', () => {
  it('picks the running run of a task before a queued one and names its agent', () => {
    const runs = [
      { runId: 'a', agentId: 'agent-hermes', agentName: 'Hermes', status: 'queued', issueId: 'issue-20' },
      { runId: 'b', agentId: 'agent-opencode', agentName: null, status: 'running', issueId: 'issue-20' },
      { runId: 'c', agentId: 'agent-claude', agentName: 'Claude Code', status: 'succeeded', issueId: 'issue-21' },
    ]
    const agents = [{ id: 'agent-opencode', name: 'OpenCode' }]
    expect(liveRunMark('issue-20', runs, agents)).toEqual({ status: 'running', text: 'running OpenCode' })
    expect(liveRunMark('issue-20', runs.slice(0, 1))).toEqual({ status: 'queued', text: 'queued Hermes' })
    expect(liveRunMark('issue-21', runs)).toBeNull()
    expect(liveRunMark('issue-19', null)).toBeNull()
    expect(liveRunMark('issue-20', [{ status: 'running', issueId: 'issue-20', agentName: 'Bad\u202Ename' }]).text).toBe('running Bad[U+202E]name')
  })

  it('shows running AGENT beside the task with the mock run and nothing on the others', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const html = renderToString(
      createElement(TasksPanel, {
        client,
        initialIssues: await client.issues(),
        initialAgents: await client.agents(),
        initialLiveRuns: await client.liveRuns(),
      })
    )
    expect(html).toContain('<span class="task-live mono is-running">running OpenCode</span>')
    expect(html.match(/task-live/g)).toHaveLength(1)
    expect(html.indexOf('JC-19')).toBeLessThan(html.indexOf('running OpenCode'))
  })

  it('shows queued AGENT and keeps the list when the read gave nothing', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const issues = await client.issues()
    const agents = await client.agents()
    const queued = renderToString(
      createElement(TasksPanel, {
        client,
        initialIssues: issues,
        initialAgents: agents,
        initialLiveRuns: [{ runId: 'q', agentId: 'agent-hermes', agentName: 'Hermes', adapterType: 'hermes_local', status: 'queued', issueId: 'issue-20', startedAt: null, lastOutputAt: null }],
      })
    )
    expect(queued).toContain('<span class="task-live mono is-queued">queued Hermes</span>')
    const plain = renderToString(createElement(TasksPanel, { client, initialIssues: issues, initialAgents: agents }))
    expect(plain).not.toContain('task-live')
    expect(plain).toContain('JC-22')
  })
})
