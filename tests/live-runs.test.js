import { createServer } from 'node:http'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { LIVE_RUN_LIMIT, changeEvents, createControlApi, liveRunList, mapLiveRun } from '../server/control.js'
import { createMockClient } from '../src/control/mock.js'
import TasksPanel, { liveRunMark } from '../src/ui/panels/TasksPanel.jsx'
import { liveRunsQueryInt } from '../scripts/fake-paperclip.mjs'
import { getJson, postJson, startLoop, waitFor } from './helpers/loop.js'

const servers = []
const loops = []

afterEach(async () => {
  while (servers.length > 0) await new Promise((resolve) => servers.pop().close(resolve))
  while (loops.length > 0) await loops.pop().stop()
})

function paperclipRun(n, status, extra = {}) {
  return {
    id: `run-${n}`,
    companyId: 'comp-1',
    status,
    invocationSource: 'assignment',
    startedAt: status === 'queued' ? null : `2026-10-21T10:${String(n % 60).padStart(2, '0')}:00.000Z`,
    finishedAt: null,
    createdAt: `2026-10-21T10:${String(n % 60).padStart(2, '0')}:00.000Z`,
    agentId: 'agent-1',
    agentName: 'OpenCode Go',
    adapterType: 'opencode_local',
    issueId: 'issue-19',
    lastOutputAt: null,
    logBytes: 120,
    ...extra,
  }
}

async function startUpstream(answer) {
  const asked = []
  const server = createServer((req, res) => {
    asked.push(req.url)
    const [status, body] = answer(req)
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  servers.push(server)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, asked }
}

async function askRoute(paperclipUrl, { featureOn } = {}) {
  let sent = null
  const api = createControlApi({
    paperclipUrl,
    companyId: 'comp-1',
    sendJson: (req, res, status, body) => {
      sent = { status, body }
    },
    readJsonBody: async () => ({}),
    featureOn,
    timeoutMs: 2000,
  })
  const handled = await api.handle({ method: 'GET' }, {}, new URL('http://bridge/api/control/live-runs'))
  return { handled, ...sent }
}

describe('the live runs route', () => {
  it('maps each run to the contract fields and fills the missing ones with null', () => {
    expect(mapLiveRun(paperclipRun(1, 'running', { lastOutputAt: '2026-10-21T10:02:00.000Z' }))).toEqual({
      runId: 'run-1',
      agentId: 'agent-1',
      agentName: 'OpenCode Go',
      adapterType: 'opencode_local',
      status: 'running',
      issueId: 'issue-19',
      startedAt: '2026-10-21T10:01:00.000Z',
      lastOutputAt: '2026-10-21T10:02:00.000Z',
    })
    expect(mapLiveRun({ id: 'run-2', status: 'queued' })).toEqual({
      runId: 'run-2',
      agentId: null,
      agentName: null,
      adapterType: null,
      status: 'queued',
      issueId: null,
      startedAt: null,
      lastOutputAt: null,
    })
    expect(mapLiveRun(null).runId).toBeNull()
  })

  it('keeps only queued and running runs, newest first, at most 50', () => {
    const list = [paperclipRun(1, 'running'), paperclipRun(3, 'succeeded'), paperclipRun(2, 'queued'), paperclipRun(4, 'failed'), null, 'text']
    expect(liveRunList(list).map((run) => run.runId)).toEqual(['run-2', 'run-1'])
    const many = Array.from({ length: 70 }, (_, n) => paperclipRun(n, n % 2 === 0 ? 'running' : 'queued'))
    const kept = liveRunList(many)
    expect(kept).toHaveLength(LIVE_RUN_LIMIT)
    expect(LIVE_RUN_LIMIT).toBe(50)
    expect(kept[0].runId).toBe('run-59')
    expect(liveRunList({ runs: [] })).toEqual([])
  })

  it('asks Paperclip for at most 50 and answers { runs }', async () => {
    const upstream = await startUpstream(() => [200, [paperclipRun(1, 'running'), paperclipRun(5, 'cancelled'), paperclipRun(2, 'queued')]])
    const answer = await askRoute(upstream.url)
    expect(answer.handled).toBe(true)
    expect(answer.status).toBe(200)
    expect(answer.body.runs.map((run) => [run.runId, run.status])).toEqual([['run-2', 'queued'], ['run-1', 'running']])
    expect(upstream.asked).toEqual(['/api/companies/comp-1/live-runs?limit=50'])
  })

  it('refuses before Paperclip when the tasks feature is off', async () => {
    const upstream = await startUpstream(() => [200, []])
    const answer = await askRoute(upstream.url, { featureOn: (feature) => feature !== 'tasks' })
    expect(answer.status).toBe(503)
    expect(answer.body).toEqual({ error: 'Paperclip changed: tasks is off. Run npm run doctor to see which routes.' })
    expect(upstream.asked).toEqual([])
  })

  it('says in words when Paperclip fails, refuses or is not there', async () => {
    const broken = await startUpstream(() => [500, { error: 'boom' }])
    expect(await askRoute(broken.url)).toMatchObject({ status: 502, body: { error: 'Paperclip could not complete that.' } })
    const refused = await startUpstream(() => [403, { error: 'Run telemetry is outside this actor\'s authorization boundary' }])
    expect(await askRoute(refused.url)).toMatchObject({ status: 400, body: { error: 'Paperclip could not read the live runs.' } })
    const old = await startUpstream(() => [404, { error: 'API route not found' }])
    expect(await askRoute(old.url)).toMatchObject({ status: 404, body: { error: 'Paperclip has no live runs route.' } })
    const gone = await startUpstream(() => [200, []])
    servers.pop().close()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await askRoute(gone.url)).toMatchObject({ status: 502, body: { error: 'Paperclip is not reachable.' } })
  })
})

describe('the liveRuns notice', () => {
  const frame = (type, payload = {}) => ({ id: 1, companyId: 'comp-1', type, createdAt: '2026-10-21T10:00:00.000Z', payload })

  it('goes out on a run that is queued, starts or ends', () => {
    expect(changeEvents(frame('heartbeat.run.queued', { runId: 'r1' }))).toEqual([{ topic: 'agents' }, { topic: 'issues' }, { topic: 'liveRuns' }])
    expect(changeEvents(frame('heartbeat.run.status', { runId: 'r1', status: 'running' }))).toEqual([{ topic: 'agents' }, { topic: 'issues' }, { topic: 'liveRuns' }])
    for (const status of ['succeeded', 'failed', 'cancelled', 'timed_out']) {
      expect(changeEvents(frame('heartbeat.run.status', { runId: 'r1', status })), status).toEqual([{ topic: 'agents' }, { topic: 'issues' }, { topic: 'costs' }, { topic: 'liveRuns' }])
    }
  })

  it('stays quiet on the log, event and progress frames a run sends many times a second', () => {
    for (const type of ['heartbeat.run.log', 'heartbeat.run.event', 'heartbeat.run.progress']) {
      expect(changeEvents(frame(type, { runId: 'r1', chunk: 'x' })), type).toEqual([])
    }
    expect(changeEvents(frame('agent.status', { status: 'running' }))).toEqual([{ topic: 'agents' }])
  })
})

describe('the fake Paperclip live runs', () => {
  it('reads minCount and limit as Paperclip does', () => {
    expect(liveRunsQueryInt(null, 50, 50)).toBe(50)
    expect(liveRunsQueryInt('abc', 50, 50)).toBe(50)
    expect(liveRunsQueryInt('0', 50, 0)).toBe(0)
    expect(liveRunsQueryInt('-3', 50, 50)).toBe(50)
    expect(liveRunsQueryInt('7.9', 50, 50)).toBe(7)
    expect(liveRunsQueryInt('900', 50, 50)).toBe(50)
  })

  it('serves its own run while it lives, through the bridge', async () => {
    const steps = [{ type: 'heartbeat.run.log', gapMs: 1600, payload: { seq: 1, stream: 'stdout', chunk: 'working\n', truncated: false } }]
    const loop = await startLoop({ fake: { speed: 4, scripts: new Map([['claude_local', { source: 'test', steps }]]) } })
    loops.push(loop)
    const agent = loop.fake.agents[0]
    expect(agent.adapterType).toBe('claude_local')
    expect((await getJson(`${loop.url}/api/control/live-runs`)).body).toEqual({ runs: [] })
    const created = await postJson(`${loop.url}/api/control/issues`, { title: 'Live run check', assigneeAgentId: agent.id, confirmed: true })
    expect(created.status).toBe(201)
    const seen = await waitFor(async () => {
      const runs = (await getJson(`${loop.url}/api/control/live-runs`)).body.runs
      return runs.find((run) => run.status === 'running')
    }, { what: 'a running live run' })
    expect(seen).toMatchObject({ agentId: agent.id, agentName: agent.name, adapterType: agent.adapterType, issueId: created.body.id })
    expect(seen.startedAt).toEqual(expect.any(String))
    await loop.fake.runsDone()
    expect((await getJson(`${loop.url}/api/control/live-runs`)).body).toEqual({ runs: [] })
    const padded = (await getJson(`${loop.fake.url}/api/companies/${loop.fake.companyId}/live-runs?minCount=5`)).body
    expect(padded.map((run) => run.status)).toEqual(['succeeded'])
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
