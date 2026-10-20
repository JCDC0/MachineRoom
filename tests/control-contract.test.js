import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { createBridge } from '../server/index.js'
import { createClient } from '../src/control/client.js'
import { CLIENT_METHODS, createMockClient } from '../src/control/mock.js'
import { makeTempDir } from './helpers/tempRoot.js'

const BASE_TIME = Date.parse('2026-10-18T00:00:00Z')
const iso = (minutesAgo) => new Date(BASE_TIME - minutesAgo * 60000).toISOString()

const SAMPLE_TASKS_MD = [
  '## Open work',
  '',
  '**B6. Late join replay (OpenCode).** Let the event stream send the kept history to a viewer that connects without Last-Event-ID, behind a history query. Test it in tests/bridge.test.js.',
  '',
  '**U4. Reject a foreign Host header in the bridge (OpenCode).** Answer 403 when the Host header is not localhost, 127.0.0.1 or [::1]. Add tests for each.',
  '',
  '**C3e. HUD polish (AGY).** Move the assistant window above the transport bar and check the result by eye at two window sizes.',
  '',
  '**P5. Recover cut and redacted tool lines (Hermes).** Recover the tool name and path from a broken OpenCode log line, with tests.',
  '',
  '**M1. Exit test with a real Paperclip (Claude and the owner).** Create a task for Hermes from the drawer and read its comment in the thread.',
  '',
  '**C2. Control client (OpenCode, merged as 0.1.34).** Make the contract real.',
].join('\n')

const SAMPLE_HOUSE_RULES_MD = [
  '# House rules',
  '',
  '## About',
  '',
  'MachineRoom is a React and three.js viewer that shows coding agents working on a project as a 3D room.',
  '',
  '## Rules',
  '',
  '- Work only in your own worktree and branch. Never push.',
  '- Run npm test after every change.',
  '',
  '## Report',
  '',
  'Give the report in your reply, not in a file.',
].join('\n')

const SAMPLE_LANES_JSON = {
  hermes: { name: 'Hermes', harness: 'Hermes', model: 'deepseek/deepseek-v4.1-flash-1017', worktree: 'C:\\GitHub\\MachineRoom-hermes', role: 'You take cheap tasks with named files and clear tests.', forbidden: ['server/**', 'src/ui/**', 'src/engine/**', 'src/control/**'], notes: [], cli: { harness: 'hermes', bin: 'hermes.exe', model: 'deepseek/deepseek-v4.1-flash-1017' } },
  opencode: { name: 'OpenCode', harness: 'OpenCode', model: 'Gemini 4 Argon', worktree: 'C:\\GitHub\\MachineRoom-opencode', role: 'You own the bridge.', forbidden: ['src/ui/**', 'src/engine/**', 'src/Stage.jsx'], notes: [], cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/mimo-v2.6-pro' } },
  agy: { name: 'agy', harness: 'agy', model: 'Gemini 3.8 Flash (High)', models: { C3e: 'Gemini 4 Argon' }, worktree: 'C:\\GitHub\\MachineRoom-agy', role: 'You own the HUD.', forbidden: ['server/**', 'src/engine/**', 'src/control/**'], notes: [] },
}

const TINY_RUNNER = [
  "import { appendFileSync, mkdirSync } from 'node:fs'",
  "import { tmpdir } from 'node:os'",
  "import { join } from 'node:path'",
  'const args = process.argv.slice(2)',
  "console.log('args ' + args.join(' '))",
  "for (let i = 1; i <= 7; i += 1) console.log('line ' + i)",
  'await new Promise((done) => setTimeout(done, 300))',
  "const folder = join(process.env.TEMP || tmpdir(), 'machineroom-runs')",
  "mkdirSync(folder, { recursive: true })",
  "const record = { lane: args[0], briefs: args.slice(1), model: null, reasoning: null, startedAt: new Date().toISOString(), minutes: 0, exitCode: 0, killed: false, costUsd: null, log: null, branch: '', commits: [] }",
  "appendFileSync(join(folder, 'runs.jsonl'), JSON.stringify(record) + '\\n')",
].join('\n')

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

function startFakeControlPaperclip(companyId = 'comp-1', { requireApproval = true } = {}) {
  const state = seedPaperclipState()
  const sockets = new Set()
  const createdIssues = []
  const createdHires = []
  const agentPatches = []
  let issueCounter = 22
  let commentCounter = 3
  let approvalCounter = 3
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

    if (method === 'GET' && path === `/api/companies/${companyId}`) {
      sendJson(res, 200, { id: companyId, name: 'MachineRoom', requireBoardApprovalForNewAgents: requireApproval })
      return
    }

    if (method === 'POST' && path === `/api/companies/${companyId}/agent-hires`) {
      const body = await readBody(req)
      createdHires.push(body)
      const key = String(body.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      const stamp = new Date(BASE_TIME).toISOString()
      const agent = {
        id: `agent-${key}`,
        urlKey: key,
        name: String(body.name ?? ''),
        role: body.role ?? 'general',
        adapterType: body.adapterType ?? '',
        adapterConfig: body.adapterConfig ?? {},
        metadata: body.metadata ?? {},
        reportsTo: body.reportsTo ?? null,
        budgetMonthlyCents: body.budgetMonthlyCents ?? 0,
        spentMonthlyCents: 0,
        status: requireApproval ? 'pending_approval' : 'idle',
        createdAt: stamp,
        updatedAt: stamp,
      }
      state.agents.push(agent)
      broadcast('activity.logged', {
        entityType: 'agent',
        entityId: agent.id,
        action: 'agent.hire_created',
        details: { name: agent.name, requiresApproval: requireApproval },
      })
      if (requireApproval) {
        approvalCounter += 1
        const approval = {
          id: `approval-${approvalCounter}`,
          type: 'hire_agent',
          status: 'pending',
          payload: { summary: `Hire "${agent.name}".`, agentId: agent.id },
          requestedByAgentId: null,
          createdAt: stamp,
          decisionNote: null,
        }
        state.approvals.unshift(approval)
        broadcast('activity.logged', {
          entityType: 'approval',
          entityId: approval.id,
          action: 'approval.created',
          details: { type: 'hire_agent', linkedAgentId: agent.id },
        })
      }
      sendJson(res, 201, agent)
      return
    }

    const agentPatch = /^\/api\/agents\/([^/]+)$/.exec(path)
    if (method === 'PATCH' && agentPatch) {
      const id = decodeURIComponent(agentPatch[1])
      const agent = state.agents.find((item) => item.id === id)
      if (!agent) {
        sendJson(res, 404, { error: 'Agent not found' })
        return
      }
      const body = await readBody(req)
      agentPatches.push({ id, body })
      if (body.adapterConfig && typeof body.adapterConfig === 'object') {
        agent.adapterConfig = { ...agent.adapterConfig, ...body.adapterConfig }
      }
      if (body.metadata && typeof body.metadata === 'object') agent.metadata = body.metadata
      if (body.name !== undefined) agent.name = body.name
      if (body.role !== undefined) agent.role = body.role
      if (body.reportsTo !== undefined) agent.reportsTo = body.reportsTo
      if (body.status !== undefined) agent.status = body.status
      broadcast('activity.logged', {
        entityType: 'agent',
        entityId: agent.id,
        action: 'agent.updated',
        details: { changedTopLevelKeys: Object.keys(body).sort() },
      })
      sendJson(res, 200, agent)
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
      const linkedAgentId = approval.type === 'hire_agent' ? (approval.payload?.agentId ?? null) : null
      const linked = linkedAgentId ? state.agents.find((item) => item.id === linkedAgentId) : null
      if (linked && linked.status === 'pending_approval') {
        if (approval.status === 'approved') linked.status = 'idle'
        else if (approval.status === 'rejected') linked.status = 'terminated'
      }
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

    const agentTurn = /^\/api\/agents\/([^/]+)\/(pause|resume)$/.exec(path)
    if (method === 'POST' && agentTurn) {
      const agent = state.agents.find((item) => item.id === decodeURIComponent(agentTurn[1]))
      if (!agent) {
        sendJson(res, 404, { error: 'Agent not found' })
        return
      }
      agent.status = agentTurn[2] === 'pause' ? 'paused' : 'idle'
      broadcast('activity.logged', { entityType: 'agent', entityId: agent.id, action: agentTurn[2] === 'pause' ? 'agent.paused' : 'agent.resumed', details: {} })
      sendJson(res, 200, agent)
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
        createdHires,
        agentPatches,
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
const REAL_TMP = tmpdir()
const NO_GIT_CONFIG = join(REAL_TMP, 'machineroom-contract-no-git-config')

function testGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_SYSTEM: NO_GIT_CONFIG,
      GIT_CONFIG_GLOBAL: NO_GIT_CONFIG,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'MachineRoom Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'MachineRoom Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  })
}

let sharedLaneGit = null

function laneGit() {
  if (sharedLaneGit) return sharedLaneGit
  const base = makeTempDir('mr-contract-git-')
  const repo = join(base, 'repo')
  const worktree = join(base, 'lane-worktree')
  const missing = join(base, 'gone')
  mkdirSync(join(repo, 'docs', 'agents'), { recursive: true })
  testGit(repo, ['init', '-b', 'main'])
  testGit(repo, ['config', 'user.name', 'MachineRoom Test'])
  testGit(repo, ['config', 'user.email', 'test@example.invalid'])
  testGit(repo, ['config', 'commit.gpgsign', 'false'])
  testGit(repo, ['config', 'core.autocrlf', 'false'])
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'machine-room', version: '0.1.35' }))
  writeFileSync(join(repo, 'docs', 'agents', 'TASKS.md'), SAMPLE_TASKS_MD)
  writeFileSync(join(repo, 'docs', 'agents', 'HOUSE-RULES.md'), SAMPLE_HOUSE_RULES_MD)
  const lanes = {
    hermes: { ...SAMPLE_LANES_JSON.hermes, worktree },
    opencode: { ...SAMPLE_LANES_JSON.opencode, worktree: repo },
    agy: { ...SAMPLE_LANES_JSON.agy, worktree: missing },
  }
  writeFileSync(join(repo, 'docs', 'agents', 'lanes.json'), JSON.stringify(lanes))
  writeFileSync(join(repo, 'notes.txt'), 'hello\n')
  testGit(repo, ['add', '.'])
  testGit(repo, ['commit', '-m', 'first'])
  testGit(repo, ['worktree', 'add', '-b', 'feat/x', worktree])
  writeFileSync(join(worktree, 'notes.txt'), 'hello again\n')
  writeFileSync(join(worktree, 'extra.js'), 'export const x = 1\n')
  testGit(worktree, ['add', '.'])
  testGit(worktree, ['commit', '-m', 'second'])
  sharedLaneGit = { base, repo, worktree, missing, lanes }
  return sharedLaneGit
}

afterAll(() => {
  if (sharedLaneGit) rmSync(sharedLaneGit.base, { recursive: true, force: true })
  sharedLaneGit = null
})

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
        for (const key of ['id', 'key', 'name', 'adapterType', 'role', 'status', 'model', 'reasoningEffort', 'maxTurnsPerRun', 'timeoutSec', 'subagentsAllowed', 'subagentDepth', 'instructions', 'reportsToAgentId', 'budgetMonthlyCents', 'spentMonthlyCents']) {
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

    it('hires an agent and maps the answer to the agent and its approval', async () => {
      const { client } = await makeHarness()
      const { agent, approval } = await client.hireAgent({
        name: 'Scout',
        adapterType: 'hermes_local',
        role: 'researcher',
        model: 'xiaomi/mimo-v2.6-pro',
        reasoningEffort: 'high',
        maxTurnsPerRun: 4,
        timeoutSec: 120,
        budgetMonthlyCents: 250,
        subagentsAllowed: true,
        subagentDepth: 2,
        reportsToAgentId: 'agent-hermes',
        instructions: 'Be brief.',
      })
      expect(agent).toMatchObject({
        name: 'Scout',
        adapterType: 'hermes_local',
        role: 'researcher',
        status: 'pending_approval',
        model: 'xiaomi/mimo-v2.6-pro',
        reasoningEffort: 'high',
        maxTurnsPerRun: 4,
        timeoutSec: 120,
        budgetMonthlyCents: 250,
        subagentsAllowed: true,
        subagentDepth: 2,
        reportsToAgentId: 'agent-hermes',
      })
      expect(approval).toMatchObject({ type: 'hire_agent', status: 'pending', agentId: agent.id })
      const list = await client.agents()
      expect(list.some((item) => item.id === agent.id)).toBe(true)
    })

    it('refuses a bad hire and a bad update with plain sentences', async () => {
      const { client } = await makeHarness()
      await expect(client.hireAgent({ adapterType: 'claude_local' })).rejects.toThrow('A name is required.')
      await expect(client.hireAgent({ name: 'Planner' })).rejects.toThrow('Choose a harness.')
      await expect(client.hireAgent({ name: 'Hermes', adapterType: 'hermes_local' })).rejects.toThrow('An agent with that name already exists.')
      await expect(client.hireAgent({ name: '!!!', adapterType: 'process' })).rejects.toThrow('The name needs letters or numbers.')
      await expect(client.hireAgent({ name: 'Planner', adapterType: 'claude_local', reportsToAgentId: 'agent-ghost' })).rejects.toThrow('The agent it reports to no longer exists.')
      await expect(client.hireAgent({ name: 'Planner', adapterType: 'claude_local', maxTurnsPerRun: 0 })).rejects.toThrow(/1 to 200/)
      await expect(client.updateAgent('agent-ghost', { model: 'm' })).rejects.toThrow('That agent no longer exists.')
      await expect(client.updateAgent('agent-hermes', {})).rejects.toThrow('Change at least one setting.')
      await expect(client.updateAgent('agent-hermes', { adapterType: 'process' })).rejects.toThrow('The harness cannot be changed. Hire a new agent.')
      await expect(client.updateAgent('agent-hermes', { reportsToAgentId: 'agent-hermes' })).rejects.toThrow('An agent cannot report to itself.')
      await expect(client.updateAgent('agent-hermes', { name: 'agy' })).rejects.toThrow('An agent with that name already exists.')
      await expect(client.updateAgent('agent-hermes', { subagentDepth: 2 })).rejects.toThrow('Turn subagents on to set a depth.')
    })

    it('updates an agent, its subagent settings and its budget', async () => {
      const { client } = await makeHarness()
      const updated = await client.updateAgent('agent-hermes', { model: 'm2', reasoningEffort: 'high', maxTurnsPerRun: 20, timeoutSec: 600 })
      expect(updated).toMatchObject({ model: 'm2', reasoningEffort: 'high', maxTurnsPerRun: 20, timeoutSec: 600 })
      expect(await client.updateAgent('agent-agy', { subagentsAllowed: true })).toMatchObject({ subagentsAllowed: true, subagentDepth: 1 })
      expect(await client.updateAgent('agent-agy', { subagentDepth: 3 })).toMatchObject({ subagentsAllowed: true, subagentDepth: 3 })
      expect(await client.updateAgent('agent-agy', { subagentsAllowed: false })).toMatchObject({ subagentsAllowed: false, subagentDepth: 0 })
      expect((await client.updateAgent('agent-hermes', { model: '' })).model).toBeNull()
      expect((await client.updateAgent('agent-hermes', { budgetMonthlyCents: 250 })).budgetMonthlyCents).toBe(250)
      expect((await client.updateAgent('agent-hermes', { status: 'paused' })).status).toBe('paused')
      expect((await client.updateAgent('agent-hermes', { status: 'active' })).status).toBe('idle')
    })

    it('refuses to change a waiting or a terminated agent and turns a hire ready on approval', async () => {
      const { client } = await makeHarness()
      const { agent, approval } = await client.hireAgent({ name: 'Planner', adapterType: 'claude_local' })
      await expect(client.updateAgent(agent.id, { model: 'm' })).rejects.toThrow('Approve the hire first.')
      await client.decideApproval(approval.id, 'approve')
      expect(await client.updateAgent(agent.id, { model: 'm3' })).toMatchObject({ status: 'idle', model: 'm3' })
      const second = await client.hireAgent({ name: 'Scout', adapterType: 'claude_local' })
      await client.decideApproval(second.approval.id, 'reject')
      await expect(client.updateAgent(second.agent.id, { model: 'm' })).rejects.toThrow('That agent was terminated.')
    })

    it('notices agents after a hire and an update and approvals after a hire', async () => {
      const { client } = await makeHarness()
      const seen = []
      const stop = client.subscribe((event) => seen.push(event))
      await new Promise((r) => setTimeout(r, 30))
      await client.hireAgent({ name: 'Planner', adapterType: 'claude_local' })
      await client.updateAgent('agent-hermes', { model: 'm4' })
      await waitUntil(() => seen.filter((event) => event.topic === 'agents').length >= 2 && seen.some((event) => event.topic === 'approvals'))
      stop()
    })

    it('lists models in tiers and marks the free one', async () => {
      const { client } = await makeHarness()
      const models = await client.models()
      expect(new Set(models.map((model) => model.tier))).toEqual(new Set(['small', 'medium', 'large']))
      expect(models.filter((model) => model.free).map((model) => model.id)).toContain('opencode/deepseek-v4.1-flash-free')
    })

    it('lists briefs and builds a prompt for one or more briefs and one lane', async () => {
      const { client } = await makeHarness()
      const briefs = await client.briefs()
      expect(briefs.map((brief) => brief.id)).toEqual(['B6', 'U4', 'C3e', 'P5', 'M1', 'C2'])
      for (const brief of briefs) {
        for (const key of ['id', 'title', 'ownerText', 'owners', 'done', 'section', 'text']) {
          expect(brief, `${brief.id} ${key}`).toHaveProperty(key)
        }
      }
      expect(briefs.find((brief) => brief.id === 'C2').done).toBe(true)

      const one = await client.briefPrompt(['C3e'], 'agy')
      expect(one.lane).toBe('agy')
      expect(one.model).toBe('Gemini 4 Argon')
      expect(one.branch).toBe('feat/c3e-hud-polish')
      expect(one.prompt).toContain('Model to select in agy: Gemini 4 Argon.')
      expect(one.prompt).toContain('Task C3e: HUD polish.')
      expect(one.prompt).toContain('Commit with the prefix 0.1.36')

      const two = await client.briefPrompt(['U4', 'B6'], 'opencode')
      expect(two.branch).toBe('feat/u4-reject-a-foreign')
      expect(two.prompt).toContain('Do the tasks in order.')

      await expect(client.briefPrompt(['ZZ9'], 'agy')).rejects.toThrow(/Choose a brief/)
      await expect(client.briefPrompt([], 'agy')).rejects.toThrow(/Choose a brief/)
      await expect(client.briefPrompt(['C3e'], 'nobody')).rejects.toThrow(/Choose hermes/)
    })

    it('starts a run on a lane and keeps its record when it ends', async () => {
      const { client } = await makeHarness()
      const entry = await client.startRun('hermes', ['C3e'])
      expect(entry.lane).toBe('hermes')
      expect(entry.briefs).toEqual(['C3e'])
      expect(typeof entry.startedAt).toBe('string')
      expect(entry.lastLines).toEqual([])

      await waitUntil(async () => {
        const state = await client.runs()
        return state.running.every((item) => item.lane !== 'hermes') && state.recent.some((record) => record.lane === 'hermes')
      })
      const { running, recent } = await client.runs()
      expect(running).toEqual([])
      const record = recent.find((item) => item.lane === 'hermes')
      expect(record).toMatchObject({ lane: 'hermes', briefs: ['C3e'], exitCode: 0, killed: false })
      expect(typeof record.startedAt).toBe('string')
    })

    it('refuses a second run on a lane that is already running', async () => {
      const { client } = await makeHarness()
      const results = await Promise.allSettled([client.startRun('hermes', ['C3e']), client.startRun('hermes', ['B6'])])
      const started = results.filter((item) => item.status === 'fulfilled')
      const refused = results.filter((item) => item.status === 'rejected')
      expect(started).toHaveLength(1)
      expect(refused).toHaveLength(1)
      expect(String(refused[0].reason.message)).toMatch(/already running/i)
      await waitUntil(async () => (await client.runs()).running.length === 0)
    })

    it('refuses a bad lane, a lane with no command line and bad briefs with plain sentences', async () => {
      const { client } = await makeHarness()
      await expect(client.startRun('nobody', ['C3e'])).rejects.toThrow('Choose a lane from the list.')
      await expect(client.startRun('agy', ['C3e'])).rejects.toThrow('That lane has no command line.')
      await expect(client.startRun('hermes', [])).rejects.toThrow('Choose one to five briefs.')
      await expect(client.startRun('hermes', ['B6', 'C3e', 'B6', 'C3e', 'B6', 'C3e'])).rejects.toThrow('Choose one to five briefs.')
      await expect(client.startRun('hermes', ['c3e'])).rejects.toThrow('Choose a brief from the list.')
      await expect(client.startRun('hermes', ['Z9'])).rejects.toThrow('Choose a brief from the list.')
      await expect(client.startRun('hermes', ['C3e&calc'])).rejects.toThrow('Choose a brief from the list.')
      const { running } = await client.runs()
      expect(running).toEqual([])
    })

    it('answers the outcome table', async () => {
      const harness = await makeHarness()
      const { client } = harness
      if (harness.runsTemp) {
        const folder = join(harness.runsTemp, 'machineroom-runs')
        mkdirSync(folder, { recursive: true })
        appendFileSync(join(folder, 'runs.jsonl'), `${JSON.stringify({ lane: 'seed-lane', model: 'seed-model', branch: 'feat/seed', costUsd: 0.5 })}\n`)
        appendFileSync(join(folder, 'outcomes.jsonl'), `${JSON.stringify({ branch: 'feat/seed', outcome: 'merged', grade: 'A', fixes: 2 })}\n`)
      }

      const rows = await client.outcomes()
      expect(Array.isArray(rows)).toBe(true)
      for (const row of rows) {
        for (const key of ['lane', 'model', 'runs', 'merged', 'rejected', 'pending', 'mergeRate', 'averageFixes', 'costUsd', 'costPerMerge']) {
          expect(row, `${row.lane} ${key}`).toHaveProperty(key)
        }
        expect(row.runs).toBe(row.merged + row.rejected + row.pending)
        expect(typeof row.lane).toBe('string')
        expect(typeof row.model).toBe('string')
        expect(typeof row.costUsd).toBe('number')
        for (const key of ['mergeRate', 'averageFixes', 'costPerMerge']) {
          expect(row[key] === null || typeof row[key] === 'number', `${row.lane} ${key}`).toBe(true)
        }
      }
      const keys = rows.map((row) => `${row.lane}\u0000${row.model}`)
      expect(keys).toEqual([...keys].sort())
      if (harness.runsTemp) {
        expect(rows.find((row) => row.lane === 'seed-lane')).toEqual({
          lane: 'seed-lane',
          model: 'seed-model',
          runs: 1,
          merged: 1,
          rejected: 0,
          pending: 0,
          mergeRate: 1,
          averageFixes: 2,
          costUsd: 0.5,
          costPerMerge: 0.5,
        })
      }
    })

    it('notices a run when it starts and when it ends', async () => {
      const { client, settle } = await makeHarness()
      const seen = []
      const stop = client.subscribe((event) => seen.push(event))
      await settle()
      await client.startRun('hermes', ['C3e'])
      await waitUntil(() => seen.filter((event) => event.topic === 'runs').length >= 2)
      stop()
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

    it('lists one review per lane with a worktree and the contract fields', async () => {
      const { client } = await makeHarness()
      const reviews = await client.reviews()
      expect(reviews.length).toBeGreaterThan(0)
      for (const review of reviews) {
        expect(typeof review.lane, review.lane).toBe('string')
        expect(typeof review.worktree, review.lane).toBe('string')
        if (review.error) {
          expect(typeof review.error).toBe('string')
          expect(Object.keys(review).sort()).toEqual(['error', 'lane', 'worktree'])
        } else {
          for (const key of ['branch', 'head', 'ahead', 'commits', 'dirty', 'files', 'added', 'deleted', 'lastRun']) {
            expect(review, `${review.lane} ${key}`).toHaveProperty(key)
          }
          expect(review.head, review.lane).toMatch(/^[0-9a-f]{40}$/)
          expect(Array.isArray(review.commits), review.lane).toBe(true)
          expect(Number.isInteger(review.ahead), review.lane).toBe(true)
          expect(typeof review.dirty, review.lane).toBe('boolean')
          expect(review.lastRun === null || typeof review.lastRun === 'object', review.lane).toBe(true)
        }
      }
    })

    it('answers the diff for a lane and refuses a bad lane the same way', async () => {
      const { client } = await makeHarness()
      const reviews = await client.reviews()
      const good = reviews.find((review) => !review.error)
      expect(good).toBeTruthy()
      const diff = await client.reviewDiff(good.lane)
      expect(diff.lane).toBe(good.lane)
      expect(typeof diff.branch).toBe('string')
      expect(Array.isArray(diff.files)).toBe(true)
      for (const file of diff.files) {
        expect(typeof file.path).toBe('string')
        expect(Number.isInteger(file.added), file.path).toBe(true)
        expect(Number.isInteger(file.deleted), file.path).toBe(true)
      }
      expect(typeof diff.patch).toBe('string')
      expect(typeof diff.truncated).toBe('boolean')

      for (const lane of ['__proto__', 'constructor', 'nobody']) {
        await expect(client.reviewDiff(lane), lane).rejects.toThrow('Choose a lane from the list.')
      }
    })

    it('merges a lane once at the head that was read, then finds nothing left to merge', async () => {
      const { client } = await makeHarness()
      const reviews = await client.reviews()
      const lane = reviews.find((review) => !review.error && review.ahead > 0 && !review.dirty)
      expect(lane).toBeTruthy()
      expect(lane.head).toMatch(/^[0-9a-f]{40}$/)

      await expect(client.mergeReview(lane.lane, { head: '0'.repeat(40), message: 'Merge the lane' })).rejects.toThrow(
        'The lane moved since you read it. Read it again.'
      )
      await expect(client.mergeReview(lane.lane, { head: lane.head, message: '' })).rejects.toThrow(
        'Send the head you read and a message of one line.'
      )

      const merged = await client.mergeReview(lane.lane, { head: lane.head, message: 'Merge the lane' })
      expect(merged).toMatchObject({ ok: true, lane: lane.lane, branch: lane.branch, head: lane.head })
      expect(merged.commit).toMatch(/^[0-9a-f]{40}$/)

      await expect(client.mergeReview(lane.lane, { head: lane.head, message: 'Merge the lane' })).rejects.toThrow('Nothing to merge.')
      await expect(client.mergeReview('nobody', { head: lane.head, message: 'Merge the lane' })).rejects.toThrow(
        'Choose a lane from the list.'
      )
    })
  })
}

runContractSuite('mock', async () => ({
  client: createMockClient({ latencyMs: 0, now: () => BASE_TIME }),
  settle: async () => {},
}))

runContractSuite('real client over bridge and fake Paperclip', async () => {
  const fake = await startFakeControlPaperclip('comp-1')
  cleanups.push(() => fake.close())
  const runsTemp = makeTempDir('mr-contract-runs-')
  cleanups.push(() => rmSync(runsTemp, { recursive: true, force: true }))
  const previousTemp = process.env.TEMP
  process.env.TEMP = runsTemp
  cleanups.push(() => {
    process.env.TEMP = previousTemp
  })
  const runnerDir = makeTempDir('mr-contract-runner-')
  cleanups.push(() => rmSync(runnerDir, { recursive: true, force: true }))
  const runnerPath = join(runnerDir, 'tiny-runner.mjs')
  writeFileSync(runnerPath, TINY_RUNNER)
  const gitLane = laneGit()
  const bridge = createBridge({
    paperclipUrl: fake.url,
    companyId: 'comp-1',
    projectId: 'proj-1',
    projectWorkspaceId: 'ws-1',
    projectRoot: gitLane.repo,
    port: 0,
    runnerCommand: { file: process.execPath, args: [runnerPath] },
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  await waitUntil(async () => (await fetch(`${url}/api/health`).then((r) => r.json())).paperclip)
  const { NodeEventSource, instances } = makeNodeEventSource()
  cleanups.push(() => {
    for (const item of instances) item.close()
  })
  const client = createClient({ baseUrl: url, EventSourceImpl: NodeEventSource })
  const settle = async () => {
    await waitUntil(() => instances.some((item) => item.connected))
    await new Promise((r) => setTimeout(r, 20))
  }
  return { client, fake, url, instances, settle, runsTemp }
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

    const preflight = await fetch(`${url}/api/control/agents`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'PATCH' },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-methods')).toContain('PATCH')

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

describe('mock merge confirm', () => {
  it('refuses a merge that was not confirmed and merges a sample lane only once', async () => {
    const client = createMockClient({ latencyMs: 0, now: () => BASE_TIME })
    const reviews = await client.reviews()
    const lane = reviews.find((review) => !review.error && review.ahead > 0 && !review.dirty)
    expect(lane).toBeTruthy()
    for (const confirmed of [false, undefined]) {
      await expect(
        client.mergeReview(lane.lane, { head: lane.head, message: 'Merge the lane', confirmed })
      ).rejects.toThrow('Confirm the merge first.')
    }
    expect((await client.mergeReview(lane.lane, { head: lane.head, message: 'Merge the lane' })).ok).toBe(true)
    await expect(client.mergeReview(lane.lane, { head: lane.head, message: 'Merge the lane' })).rejects.toThrow('Nothing to merge.')
  })
})
