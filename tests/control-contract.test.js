import { createServer, request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { createBridge } from '../server/index.js'
import { createClient } from '../src/control/client.js'
import { CLIENT_METHODS, createMockClient } from '../src/control/mock.js'

const BASE_TIME = Date.parse('2026-10-18T00:00:00Z')
const iso = (minutesAgo) => new Date(BASE_TIME - minutesAgo * 60000).toISOString()

function seedPaperclipState() {
  return {
    agents: [
      { id: 'agent-claude', urlKey: 'claude-code', name: 'Claude Code', adapterType: 'claude_local', role: 'engineer', status: 'idle', adapterConfig: { model: 'claude-haiku-5-5' }, budgetMonthlyCents: 0, spentMonthlyCents: 0 },
      { id: 'agent-hermes', urlKey: 'hermes', name: 'Hermes', adapterType: 'hermes_local', role: 'engineer', status: 'idle', adapterConfig: {}, budgetMonthlyCents: 0, spentMonthlyCents: 0 },
      { id: 'agent-opencode', urlKey: 'opencode-go', name: 'OpenCode Go', adapterType: 'opencode_local', role: 'engineer', status: 'running', adapterConfig: { model: 'opencode-go/qwen3.8-flash' }, budgetMonthlyCents: 500, spentMonthlyCents: 8 },
      { id: 'agent-agy', urlKey: 'agy', name: 'agy', adapterType: 'process', role: 'designer', status: 'idle', adapterConfig: {}, budgetMonthlyCents: 0, spentMonthlyCents: 0 },
      { id: 'agent-orchestrator', urlKey: 'orchestrator', name: 'Orchestrator', adapterType: 'claude_local', role: 'ceo', status: 'paused', adapterConfig: {}, budgetMonthlyCents: 300, spentMonthlyCents: 291 },
    ],
    issues: [
      { id: 'issue-18', identifier: 'JC-18', title: 'Fix the typo in README.md', description: 'Change Teh to The and commit.', status: 'done', priority: 'medium', assigneeAgentId: 'agent-opencode', parentId: null, assigneeAdapterOverrides: null, createdAt: iso(90), updatedAt: iso(88) },
      { id: 'issue-19', identifier: 'JC-19', title: 'Record a failing test scenario', description: 'Add a test that fails, then fix it.', status: 'in_progress', priority: 'high', assigneeAgentId: 'agent-opencode', parentId: null, assigneeAdapterOverrides: null, createdAt: iso(40), updatedAt: iso(3) },
      { id: 'issue-20', identifier: 'JC-20', title: 'Summarise the source files', description: 'Write docs/summary.md.', status: 'todo', priority: 'low', assigneeAgentId: 'agent-hermes', parentId: null, assigneeAdapterOverrides: null, createdAt: iso(20), updatedAt: iso(20) },
      { id: 'issue-21', identifier: 'JC-21', title: 'Review the layout change', description: 'Read the diff and report problems.', status: 'in_review', priority: 'medium', assigneeAgentId: 'agent-claude', parentId: 'issue-19', assigneeAdapterOverrides: null, createdAt: iso(15), updatedAt: iso(6) },
      { id: 'issue-22', identifier: 'JC-22', title: 'Plan the control panels', description: 'Break the work into small tasks.', status: 'blocked', priority: 'critical', assigneeAgentId: 'agent-orchestrator', parentId: null, assigneeAdapterOverrides: null, createdAt: iso(10), updatedAt: iso(9) },
    ],
    comments: {
      'issue-18': [
        { id: 'comment-1', issueId: 'issue-18', authorAgentId: 'agent-opencode', body: 'Fixed the typo in README.md.\n\n- Changed "Teh quick" to "The quick".\n- Committed as f12c3db.', createdAt: iso(88) },
      ],
      'issue-22': [
        { id: 'comment-2', issueId: 'issue-22', authorAgentId: null, body: 'Keep each task under 20 minutes.', createdAt: iso(10) },
        { id: 'comment-3', issueId: 'issue-22', authorAgentId: 'agent-orchestrator', body: 'Blocked: my monthly budget is almost spent. I need an override to continue.', createdAt: iso(9) },
      ],
    },
    approvals: [
      { id: 'approval-1', type: 'budget_override_required', status: 'pending', payload: { summary: 'Orchestrator asks to raise its monthly budget from 300 to 600 cents.' }, requestedByAgentId: 'agent-orchestrator', createdAt: iso(9), decisionNote: null },
      { id: 'approval-2', type: 'hire_agent', status: 'pending', payload: { summary: 'Hire "Planner" (claude_local, claude-sonnet-5-5, 14 turns, subagents off).' }, requestedByAgentId: 'agent-orchestrator', createdAt: iso(7), decisionNote: null },
      { id: 'approval-3', type: 'request_board_approval', status: 'approved', payload: { summary: 'Run the recording scenarios on the free model.' }, requestedByAgentId: 'agent-claude', createdAt: iso(300), decisionNote: null },
    ],
    costsSummary: { companyId: 'comp-1', spendCents: 299, budgetCents: 1000, utilizationPercent: 29 },
    costsByAgent: [
      { agentId: 'agent-orchestrator', agentName: 'Orchestrator', costCents: 291, inputTokens: 412000, outputTokens: 38000 },
      { agentId: 'agent-opencode', agentName: 'OpenCode Go', costCents: 8, inputTokens: 20400, outputTokens: 30600 },
      { agentId: 'agent-claude', agentName: 'Claude Code', costCents: 0, inputTokens: 41892, outputTokens: 4126 },
    ],
    quotaWindows: [
      {
        provider: 'anthropic',
        ok: true,
        windows: [
          { label: 'Current session', usedPercent: 5, resetsAt: new Date(BASE_TIME + 4 * 3600000).toISOString(), detail: null },
          { label: 'Current week (all models)', usedPercent: 42, resetsAt: new Date(BASE_TIME + 3 * 86400000).toISOString(), detail: null },
          { label: 'Extra usage', usedPercent: null, resetsAt: null, detail: 'Not enabled' },
        ],
      },
      { provider: 'openai', ok: false, error: 'Codex app-server: spawn codex ENOENT', windows: [] },
    ],
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}

function sendJson(res, status, data) {
  const payload = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

function startFakeControlPaperclip(companyId = 'comp-1') {
  const state = seedPaperclipState()
  const sockets = new Set()
  const createdIssues = []
  let issueCounter = 22
  let commentCounter = 3
  let frameCounter = 0

  function broadcast(type, payload) {
    frameCounter += 1
    const text = JSON.stringify({
      id: frameCounter,
      companyId,
      type,
      createdAt: new Date(BASE_TIME).toISOString(),
      payload,
    })
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) ws.send(text)
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname
    const method = req.method ?? 'GET'

    if (method === 'GET' && path === `/api/companies/${companyId}/agents`) {
      sendJson(res, 200, state.agents)
      return
    }

    if (method === 'GET' && path === `/api/companies/${companyId}/issues`) {
      const status = url.searchParams.get('status')
      const list = status ? state.issues.filter((item) => item.status === status) : state.issues
      sendJson(res, 200, list)
      return
    }

    if (method === 'POST' && path === `/api/companies/${companyId}/issues`) {
      const body = await readBody(req)
      createdIssues.push(body)
      issueCounter += 1
      const stamp = new Date(BASE_TIME).toISOString()
      const issue = {
        id: `issue-${issueCounter}`,
        identifier: `JC-${issueCounter}`,
        title: body.title,
        description: body.description ?? '',
        status: body.status ?? 'todo',
        priority: body.priority ?? 'medium',
        assigneeAgentId: body.assigneeAgentId ?? null,
        parentId: body.parentId ?? null,
        assigneeAdapterOverrides: body.assigneeAdapterOverrides ?? null,
        createdAt: stamp,
        updatedAt: stamp,
      }
      state.issues.unshift(issue)
      broadcast('activity.logged', {
        entityType: 'issue',
        entityId: issue.id,
        action: 'issue.created',
        details: { identifier: issue.identifier, title: issue.title, status: issue.status },
      })
      sendJson(res, 201, issue)
      return
    }

    const commentsRoute = /^\/api\/issues\/([^/]+)\/comments$/.exec(path)
    if (commentsRoute) {
      const issueId = decodeURIComponent(commentsRoute[1])
      const issue = state.issues.find((item) => item.id === issueId)
      if (!issue) {
        sendJson(res, 404, { error: 'Issue not found' })
        return
      }
      if (method === 'GET') {
        sendJson(res, 200, state.comments[issueId] ?? [])
        return
      }
      if (method === 'POST') {
        const body = await readBody(req)
        commentCounter += 1
        const comment = {
          id: `comment-${commentCounter}`,
          issueId,
          authorAgentId: null,
          body: body.body,
          createdAt: new Date(BASE_TIME).toISOString(),
        }
        state.comments[issueId] = [...(state.comments[issueId] ?? []), comment]
        broadcast('activity.logged', {
          entityType: 'issue',
          entityId: issueId,
          action: 'issue.comment_added',
          details: { commentId: comment.id },
        })
        sendJson(res, 201, comment)
        return
      }
    }

    if (method === 'GET' && path === `/api/companies/${companyId}/approvals`) {
      sendJson(res, 200, state.approvals)
      return
    }

    const approvalGet = /^\/api\/approvals\/([^/]+)$/.exec(path)
    if (method === 'GET' && approvalGet) {
      const id = decodeURIComponent(approvalGet[1])
      const approval = state.approvals.find((item) => item.id === id)
      if (!approval) {
        sendJson(res, 404, { error: 'Approval not found' })
        return
      }
      sendJson(res, 200, approval)
      return
    }

    const approvalDecide = /^\/api\/approvals\/([^/]+)\/(approve|reject|request-revision)$/.exec(path)
    if (method === 'POST' && approvalDecide) {
      const id = decodeURIComponent(approvalDecide[1])
      const verb = approvalDecide[2]
      const approval = state.approvals.find((item) => item.id === id)
      if (!approval) {
        sendJson(res, 404, { error: 'Approval not found' })
        return
      }
      if (approval.status !== 'pending') {
        sendJson(res, 422, { error: 'Only pending approvals can be decided' })
        return
      }
      const body = await readBody(req)
      const statusMap = { approve: 'approved', reject: 'rejected', 'request-revision': 'revision_requested' }
      approval.status = statusMap[verb]
      approval.decisionNote = body.decisionNote ?? null
      broadcast('activity.logged', {
        entityType: 'approval',
        entityId: approval.id,
        action: `approval.${approval.status}`,
        details: { type: approval.type },
      })
      sendJson(res, 200, approval)
      return
    }

    if (method === 'GET' && path === `/api/companies/${companyId}/costs/summary`) {
      sendJson(res, 200, state.costsSummary)
      return
    }

    if (method === 'GET' && path === `/api/companies/${companyId}/costs/by-agent`) {
      sendJson(res, 200, state.costsByAgent)
      return
    }

    if (method === 'GET' && path === `/api/companies/${companyId}/costs/quota-windows`) {
      sendJson(res, 200, state.quotaWindows)
      return
    }

    const agentBudget = /^\/api\/agents\/([^/]+)\/budgets$/.exec(path)
    if (method === 'PATCH' && agentBudget) {
      const id = decodeURIComponent(agentBudget[1])
      const agent = state.agents.find((item) => item.id === id)
      if (!agent) {
        sendJson(res, 404, { error: 'Agent not found' })
        return
      }
      const body = await readBody(req)
      agent.budgetMonthlyCents = body.budgetMonthlyCents
      broadcast('activity.logged', {
        entityType: 'agent',
        entityId: agent.id,
        action: 'agent.budget_updated',
        details: { budgetMonthlyCents: agent.budgetMonthlyCents },
      })
      sendJson(res, 200, agent)
      return
    }

    sendJson(res, 404, { error: 'API route not found' })
  })

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    if (req.url === `/api/companies/${companyId}/events/ws`) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        sockets.add(ws)
        ws.on('close', () => sockets.delete(ws))
      })
    } else {
      socket.destroy()
    }
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}`,
        createdIssues,
        broadcast,
        close() {
          for (const ws of sockets) ws.terminate()
          sockets.clear()
          return new Promise((resolveClose) => {
            wss.close(() => server.close(() => resolveClose()))
          })
        },
      })
    })
  })
}

function makeNodeEventSource() {
  const instances = []

  class NodeEventSource {
    constructor(url) {
      this.url = url
      this.closed = false
      this.connected = false
      this.listeners = new Map()
      this.buffer = ''
      instances.push(this)
      this.req = httpRequest(url, (res) => {
        this.connected = true
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          this.buffer += chunk
          const blocks = this.buffer.split('\n\n')
          this.buffer = blocks.pop() ?? ''
          for (const block of blocks) {
            const trimmed = block.trim()
            if (!trimmed || trimmed.startsWith(':')) continue
            let event = 'message'
            let data = ''
            for (const line of trimmed.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim()
              else if (line.startsWith('data:')) data += line.slice(5).trim()
            }
            const handlers = this.listeners.get(event) ?? []
            for (const handler of [...handlers]) handler({ data })
          }
        })
      })
      this.req.on('error', () => {})
      this.req.end()
    }

    addEventListener(name, handler) {
      const list = this.listeners.get(name) ?? []
      list.push(handler)
      this.listeners.set(name, list)
    }

    close() {
      this.closed = true
      this.req.destroy()
    }
  }

  return { NodeEventSource, instances }
}

async function waitUntil(fn, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 15))
  }
  throw new Error('condition not met in time')
}

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function runContractSuite(label, makeHarness) {
  describe(`control contract (${label})`, () => {
    it('has every method of the contract', async () => {
      const { client } = await makeHarness()
      for (const name of CLIENT_METHODS) expect(typeof client[name], name).toBe('function')
    })

    it('lists agents with the contract fields', async () => {
      const { client } = await makeHarness()
      const agents = await client.agents()
      expect(agents).toHaveLength(5)
      for (const agent of agents) {
        for (const key of ['id', 'key', 'name', 'adapterType', 'role', 'status', 'model', 'budgetMonthlyCents', 'spentMonthlyCents']) {
          expect(agent, `${agent.name} ${key}`).toHaveProperty(key)
        }
      }
      expect(agents.find((a) => a.id === 'agent-opencode').spentMonthlyCents).toBe(8)
      expect(agents.find((a) => a.id === 'agent-orchestrator').spentMonthlyCents).toBe(291)
    })

    it('filters issues by status', async () => {
      const { client } = await makeHarness()
      const all = await client.issues()
      expect(all).toHaveLength(5)
      const todo = await client.issues({ status: 'todo' })
      expect(todo.length).toBeGreaterThan(0)
      expect(todo.every((issue) => issue.status === 'todo')).toBe(true)
    })

    it('creates an issue with overrides and puts it first', async () => {
      const { client } = await makeHarness()
      const before = await client.issues()
      const issue = await client.createIssue({
        title: '  Add a test  ',
        assigneeAgentId: 'agent-opencode',
        model: 'opencode/deepseek-v4.1-flash-free',
        maxTurnsPerRun: 8,
        timeoutSec: 300,
        subagentsAllowed: false,
      })
      expect(issue.title).toBe('Add a test')
      expect(issue.status).toBe('todo')
      expect(issue.identifier).toBe('JC-23')
      expect(issue.overrides).toEqual({
        model: 'opencode/deepseek-v4.1-flash-free',
        maxTurnsPerRun: 8,
        timeoutSec: 300,
        subagentsAllowed: false,
      })
      const afterFirst = await client.issues()
      expect(afterFirst).toHaveLength(before.length + 1)
      expect(afterFirst[0].id).toBe(issue.id)

      const plain = await client.createIssue({ title: 'Plain task', assigneeAgentId: 'agent-opencode', model: '' })
      expect(plain.overrides).toBeNull()
    })

    it('refuses an issue with no title or an unknown agent', async () => {
      const { client } = await makeHarness()
      await expect(client.createIssue({ title: ' ', assigneeAgentId: 'agent-opencode' })).rejects.toThrow(/title/i)
      await expect(client.createIssue({ title: 'x', assigneeAgentId: 'nobody' })).rejects.toThrow(/agent/i)
    })

    it('reads comments oldest first and adds a comment to the end of the thread', async () => {
      const { client } = await makeHarness()
      const initial = await client.comments('issue-22')
      expect(initial.map((c) => c.id)).toEqual(['comment-2', 'comment-3'])
      expect(initial[0].authorName).toBe('You')
      expect(initial[1].authorName).toBe('Orchestrator')
      const comment = await client.postComment('issue-18', 'Looks good.')
      expect(comment.authorName).toBe('You')
      const thread = await client.comments('issue-18')
      expect(thread.at(-1).body).toBe('Looks good.')
      expect(await client.comments('issue-99')).toEqual([])
    })

    it('refuses an empty comment and a comment on a missing task', async () => {
      const { client } = await makeHarness()
      await expect(client.postComment('issue-18', '  ')).rejects.toThrow(/comment/i)
      await expect(client.postComment('issue-99', 'hi')).rejects.toThrow(/exist/i)
    })

    it('lists approvals and decides an approval once', async () => {
      const { client } = await makeHarness()
      const list = await client.approvals()
      expect(list).toHaveLength(3)
      const done = await client.decideApproval('approval-1', 'approve', 'ok')
      expect(done.status).toBe('approved')
      expect(done.decisionNote).toBe('ok')
      await expect(client.decideApproval('approval-1', 'reject')).rejects.toThrow(/already/i)
      expect((await client.decideApproval('approval-2', 'request-revision')).status).toBe('revision_requested')
      await expect(client.decideApproval('approval-2', 'nope')).rejects.toThrow(/unknown decision/i)
      await expect(client.decideApproval('missing', 'approve')).rejects.toThrow(/exist/i)
    })

    it('reports costs and quota windows, including one that could not be read', async () => {
      const { client } = await makeHarness()
      const { quota, summary, byAgent } = await client.costs()
      expect(summary).toEqual({ spendCents: 299, budgetCents: 1000, utilizationPercent: 29 })
      expect(byAgent).toHaveLength(3)
      expect(quota.find((item) => item.ok).windows.some((window) => window.usedPercent === null)).toBe(true)
      expect(quota.find((item) => !item.ok).error).toBeTruthy()
    })

    it('sets a budget and refuses a bad one', async () => {
      const { client } = await makeHarness()
      expect((await client.setAgentBudget('agent-claude', 250)).budgetMonthlyCents).toBe(250)
      await expect(client.setAgentBudget('agent-claude', -1)).rejects.toThrow(/cents/i)
      await expect(client.setAgentBudget('nobody', 10)).rejects.toThrow(/agent/i)
    })

    it('lists models in tiers and marks the free one', async () => {
      const { client } = await makeHarness()
      const models = await client.models()
      expect(new Set(models.map((model) => model.tier))).toEqual(new Set(['small', 'medium', 'large']))
      expect(models.filter((model) => model.free).map((model) => model.id)).toContain('opencode/deepseek-v4.1-flash-free')
    })

    it('notifies subscribers of topic changes after writes and stops after unsubscribe', async () => {
      const { client } = await makeHarness()
      const seen = []
      const stop = client.subscribe((event) => seen.push(event))
      await client.createIssue({ title: 'C', assigneeAgentId: 'agent-agy' })
      await client.postComment('issue-18', 'Thanks.')
      await client.decideApproval('approval-1', 'approve')
      await client.setAgentBudget('agent-claude', 100)
      await waitUntil(() => seen.length >= 5)
      expect(seen).toEqual([
        { topic: 'issues' },
        { topic: 'comments', id: 'issue-18' },
        { topic: 'approvals' },
        { topic: 'agents' },
        { topic: 'costs' },
      ])
      stop()
      await client.createIssue({ title: 'D', assigneeAgentId: 'agent-agy' })
      await new Promise((r) => setTimeout(r, 40))
      expect(seen).toHaveLength(5)
    })
  })
}

runContractSuite('mock', async () => ({
  client: createMockClient({ latencyMs: 0, now: () => BASE_TIME }),
}))

runContractSuite('real client over bridge and fake Paperclip', async () => {
  const fake = await startFakeControlPaperclip('comp-1')
  cleanups.push(() => fake.close())
  const bridge = createBridge({
    paperclipUrl: fake.url,
    companyId: 'comp-1',
    projectId: 'proj-1',
    projectWorkspaceId: 'ws-1',
    projectRoot: '',
    port: 0,
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  await waitUntil(async () => (await fetch(`${url}/api/health`).then((r) => r.json())).paperclip)
  const { NodeEventSource, instances } = makeNodeEventSource()
  cleanups.push(() => {
    for (const item of instances) item.close()
  })
  const client = createClient({ baseUrl: url, EventSourceImpl: NodeEventSource })
  return { client, fake, url, instances }
})

describe('real control client and bridge extras', () => {
  it('shares one EventSource across subscribers and closes it when the last one leaves', async () => {
    const fake = await startFakeControlPaperclip('comp-1')
    cleanups.push(() => fake.close())
    const bridge = createBridge({ paperclipUrl: fake.url, companyId: 'comp-1', projectRoot: '', port: 0 })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    await waitUntil(async () => (await fetch(`${url}/api/health`).then((r) => r.json())).paperclip)

    const { NodeEventSource, instances } = makeNodeEventSource()
    cleanups.push(() => {
      for (const item of instances) item.close()
    })
    const client = createClient({ baseUrl: url, EventSourceImpl: NodeEventSource })

    const first = []
    const second = []
    const stop1 = client.subscribe((e) => first.push(e))
    const stop2 = client.subscribe((e) => second.push(e))
    expect(instances).toHaveLength(1)
    expect(instances[0].closed).toBe(false)

    await waitUntil(() => Boolean(instances[0].connected))
    fake.broadcast('heartbeat.run.status', { runId: 'r1', agentId: 'agent-opencode', status: 'succeeded' })
    await waitUntil(() => first.length >= 2 && second.length >= 2)
    expect(first).toEqual([{ topic: 'agents' }, { topic: 'costs' }])
    expect(second).toEqual([{ topic: 'agents' }, { topic: 'costs' }])

    stop1()
    expect(instances[0].closed).toBe(false)
    stop2()
    expect(instances[0].closed).toBe(true)
  })

  it('sends model, maxTurnsPerRun and timeoutSec in assigneeAdapterOverrides.adapterConfig', async () => {
    const fake = await startFakeControlPaperclip('comp-1')
    cleanups.push(() => fake.close())
    const bridge = createBridge({
      paperclipUrl: fake.url,
      companyId: 'comp-1',
      projectId: 'proj-1',
      projectWorkspaceId: 'ws-1',
      projectRoot: '',
      port: 0,
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    const client = createClient({ baseUrl: url })

    await client.createIssue({
      title: 'Check overrides',
      assigneeAgentId: 'agent-opencode',
      model: 'opencode/deepseek-v4.1-flash-free',
      maxTurnsPerRun: 6,
      timeoutSec: 180,
    })

    expect(fake.createdIssues[0]).toMatchObject({
      title: 'Check overrides',
      assigneeAgentId: 'agent-opencode',
      projectId: 'proj-1',
      projectWorkspaceId: 'ws-1',
      status: 'todo',
      assigneeAdapterOverrides: {
        adapterConfig: {
          model: 'opencode/deepseek-v4.1-flash-free',
          maxTurnsPerRun: 6,
          timeoutSec: 180,
        },
      },
    })
  })

  it('enforces local origins, JSON content-type and the 64 KB body limit on control routes', async () => {
    const fake = await startFakeControlPaperclip('comp-1')
    cleanups.push(() => fake.close())
    const bridge = createBridge({ paperclipUrl: fake.url, companyId: 'comp-1', projectRoot: '', port: 0 })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const evil = await fetch(`${url}/api/control/models`, { headers: { Origin: 'https://evil.example' } })
    expect(evil.status).toBe(403)

    const plainText = await fetch(`${url}/api/control/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    })
    expect(plainText.status).toBe(415)
    expect(await plainText.json()).toEqual({ error: 'Send JSON.' })

    const huge = await fetch(`${url}/api/control/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(70000) }),
    })
    expect(huge.status).toBe(413)
    expect(await huge.json()).toEqual({ error: 'That request is too large.' })
  })
})
