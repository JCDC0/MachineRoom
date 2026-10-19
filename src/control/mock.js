import { branchFor, buildPrompt, modelFor, parseBriefs } from '../briefs/briefs.js'
import { CANNOT_TAKE_TASKS, cleanAgentDraft, cleanAgentPatch, hireSummary } from './agents.js'

export const CLIENT_METHODS = [
  'agents',
  'issues',
  'createIssue',
  'comments',
  'postComment',
  'approvals',
  'decideApproval',
  'costs',
  'setAgentBudget',
  'hireAgent',
  'updateAgent',
  'models',
  'briefs',
  'briefPrompt',
  'subscribe',
]

const DECISIONS = { approve: 'approved', reject: 'rejected', 'request-revision': 'revision_requested' }
const clone = (value) => JSON.parse(JSON.stringify(value))
const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const AGENT_DEFAULTS = { reasoningEffort: null, maxTurnsPerRun: null, timeoutSec: null, subagentsAllowed: false, subagentDepth: 0, instructions: '', reportsToAgentId: null }

const SAMPLE_BRIEFS = [
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

const SAMPLE_LANES = {
  hermes: { name: 'Hermes', harness: 'Hermes', model: 'deepseek/deepseek-v4.1-flash-1017', worktree: 'C:\\GitHub\\MachineRoom-hermes', role: 'You take cheap tasks with named files and clear tests.', forbidden: ['server/**', 'src/ui/**', 'src/engine/**', 'src/control/**'], notes: [] },
  opencode: { name: 'OpenCode', harness: 'OpenCode', model: 'Gemini 4 Argon', worktree: 'C:\\GitHub\\MachineRoom-opencode', role: 'You own the bridge.', forbidden: ['src/ui/**', 'src/engine/**', 'src/Stage.jsx'], notes: [] },
  agy: { name: 'agy', harness: 'agy', model: 'Gemini 3.8 Flash (High)', models: { C3e: 'Gemini 4 Argon' }, worktree: 'C:\\GitHub\\MachineRoom-agy', role: 'You own the HUD.', forbidden: ['server/**', 'src/engine/**', 'src/control/**'], notes: [] },
}

const SAMPLE_RULES = {
  about: 'MachineRoom is a React and three.js viewer that shows coding agents working on a project as a 3D room.',
  rules: ['Work only in your own worktree and branch. Never push.', 'Run npm test after every change.'],
  report: 'Give the report in your reply, not in a file.',
}

function overridesOf(draft) {
  const overrides = {}
  for (const key of ['model', 'maxTurnsPerRun', 'timeoutSec', 'subagentsAllowed']) {
    if (draft[key] !== undefined && draft[key] !== null && draft[key] !== '') overrides[key] = draft[key]
  }
  return Object.keys(overrides).length ? overrides : null
}

function seed(at) {
  const iso = (minutesAgo) => new Date(at - minutesAgo * 60000).toISOString()
  return {
    agents: [
      { id: 'agent-claude', key: 'claude-code', name: 'Claude Code', adapterType: 'claude_local', role: 'engineer', status: 'idle', model: 'claude-haiku-5-5', maxTurnsPerRun: 14, timeoutSec: 420, budgetMonthlyCents: 0, spentMonthlyCents: 0 },
      { id: 'agent-hermes', key: 'hermes', name: 'Hermes', adapterType: 'hermes_local', role: 'engineer', status: 'idle', model: null, budgetMonthlyCents: 0, spentMonthlyCents: 0 },
      { id: 'agent-opencode', key: 'opencode-go', name: 'OpenCode Go', adapterType: 'opencode_local', role: 'engineer', status: 'running', model: 'opencode-go/qwen3.8-flash', budgetMonthlyCents: 500, spentMonthlyCents: 8 },
      { id: 'agent-agy', key: 'agy', name: 'agy', adapterType: 'process', role: 'designer', status: 'idle', model: null, budgetMonthlyCents: 0, spentMonthlyCents: 0 },
      { id: 'agent-orchestrator', key: 'orchestrator', name: 'Orchestrator', adapterType: 'claude_local', role: 'ceo', status: 'paused', model: null, budgetMonthlyCents: 300, spentMonthlyCents: 291 },
    ],
    issues: [
      { id: 'issue-18', identifier: 'JC-18', title: 'Fix the typo in README.md', description: 'Change Teh to The and commit.', status: 'done', priority: 'medium', assigneeAgentId: 'agent-opencode', parentId: null, createdAt: iso(90), updatedAt: iso(88) },
      { id: 'issue-19', identifier: 'JC-19', title: 'Record a failing test scenario', description: 'Add a test that fails, then fix it.', status: 'in_progress', priority: 'high', assigneeAgentId: 'agent-opencode', parentId: null, createdAt: iso(40), updatedAt: iso(3) },
      { id: 'issue-20', identifier: 'JC-20', title: 'Summarise the source files', description: 'Write docs/summary.md.', status: 'todo', priority: 'low', assigneeAgentId: 'agent-hermes', parentId: null, createdAt: iso(20), updatedAt: iso(20) },
      { id: 'issue-21', identifier: 'JC-21', title: 'Review the layout change', description: 'Read the diff and report problems.', status: 'in_review', priority: 'medium', assigneeAgentId: 'agent-claude', parentId: 'issue-19', createdAt: iso(15), updatedAt: iso(6) },
      { id: 'issue-22', identifier: 'JC-22', title: 'Plan the control panels', description: 'Break the work into small tasks.', status: 'blocked', priority: 'critical', assigneeAgentId: 'agent-orchestrator', parentId: null, createdAt: iso(10), updatedAt: iso(9) },
    ],
    comments: {
      'issue-18': [
        { id: 'comment-1', issueId: 'issue-18', authorAgentId: 'agent-opencode', authorName: 'OpenCode Go', body: 'Fixed the typo in README.md.\n\n- Changed "Teh quick" to "The quick".\n- Committed as f12c3db.', createdAt: iso(88) },
      ],
      'issue-22': [
        { id: 'comment-2', issueId: 'issue-22', authorAgentId: null, authorName: 'You', body: 'Keep each task under 20 minutes.', createdAt: iso(10) },
        { id: 'comment-3', issueId: 'issue-22', authorAgentId: 'agent-orchestrator', authorName: 'Orchestrator', body: 'Blocked: my monthly budget is almost spent. I need an override to continue.', createdAt: iso(9) },
      ],
    },
    approvals: [
      { id: 'approval-1', type: 'budget_override_required', status: 'pending', summary: 'Orchestrator asks to raise its monthly budget from 300 to 600 cents.', requestedByAgentId: 'agent-orchestrator', createdAt: iso(9) },
      { id: 'approval-2', type: 'hire_agent', status: 'pending', summary: 'Hire "Planner" (claude_local, claude-sonnet-5-5, 14 turns, subagents off).', requestedByAgentId: 'agent-orchestrator', createdAt: iso(7) },
      { id: 'approval-3', type: 'request_board_approval', status: 'approved', summary: 'Run the recording scenarios on the free model.', requestedByAgentId: 'agent-claude', createdAt: iso(300) },
    ],
    costs: {
      summary: { spendCents: 299, budgetCents: 1000, utilizationPercent: 29 },
      byAgent: [
        { agentId: 'agent-orchestrator', agentName: 'Orchestrator', costCents: 291, inputTokens: 412000, outputTokens: 38000 },
        { agentId: 'agent-opencode', agentName: 'OpenCode Go', costCents: 8, inputTokens: 20400, outputTokens: 30600 },
        { agentId: 'agent-claude', agentName: 'Claude Code', costCents: 0, inputTokens: 41892, outputTokens: 4126 },
      ],
      quota: [
        {
          provider: 'anthropic',
          ok: true,
          windows: [
            { label: 'Current session', usedPercent: 5, resetsAt: new Date(at + 4 * 3600000).toISOString(), detail: null },
            { label: 'Current week (all models)', usedPercent: 42, resetsAt: new Date(at + 3 * 86400000).toISOString(), detail: null },
            { label: 'Extra usage', usedPercent: null, resetsAt: null, detail: 'Not enabled' },
          ],
        },
        { provider: 'openai', ok: false, error: 'Codex app-server: spawn codex ENOENT', windows: [] },
      ],
    },
    models: [
      { id: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek v4.1 Flash (free)', harness: 'opencode', tier: 'small', free: true },
      { id: 'opencode-go/qwen3.8-flash', label: 'Qwen 3.8 Flash', harness: 'opencode', tier: 'small', free: false },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', harness: 'claude', tier: 'small', free: false },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', harness: 'claude', tier: 'medium', free: false },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', harness: 'claude', tier: 'large', free: false },
      { id: 'xiaomi/mimo-v2.6-pro', label: 'MiMo v2.6 Pro', harness: 'hermes', tier: 'medium', free: false },
    ],
  }
}

export function createMockClient({ latencyMs = 120, now = Date.now, requireApproval = true } = {}) {
  const state = seed(now())
  state.agents = state.agents.map((agent) => ({ ...AGENT_DEFAULTS, ...agent }))
  let approvalCounter = 3
  const failures = new Map()
  let issueCounter = 22
  let commentCounter = 3
  const listeners = new Set()

  function emit(event) {
    for (const listener of [...listeners]) listener({ ...event })
  }

  async function call(name, work) {
    await new Promise((resolve) => setTimeout(resolve, latencyMs))
    if (failures.has(name)) {
      const message = failures.get(name)
      failures.delete(name)
      throw new Error(message)
    }
    return clone(work())
  }

  const agentById = (id) => state.agents.find((agent) => agent.id === id)

  const client = {
    agents: () => call('agents', () => state.agents),

    issues: ({ status } = {}) => call('issues', () => (status ? state.issues.filter((issue) => issue.status === status) : state.issues)),

    createIssue: (draft) =>
      call('createIssue', () => {
        if (!draft?.title?.trim()) throw new Error('A title is required.')
        const assignee = agentById(draft.assigneeAgentId)
        if (!assignee) throw new Error('Choose an agent for this task.')
        if (CANNOT_TAKE_TASKS.includes(assignee.status)) throw new Error('That agent cannot take tasks yet.')
        issueCounter += 1
        const stamp = new Date(now()).toISOString()
        const issue = {
          id: `issue-${issueCounter}`,
          identifier: `JC-${issueCounter}`,
          title: draft.title.trim(),
          description: draft.description ?? '',
          status: 'todo',
          priority: draft.priority ?? 'medium',
          assigneeAgentId: draft.assigneeAgentId,
          parentId: null,
          overrides: overridesOf(draft),
          createdAt: stamp,
          updatedAt: stamp,
        }
        state.issues.unshift(issue)
        emit({ topic: 'issues' })
        return issue
      }),

    comments: (issueId) => call('comments', () => state.comments[issueId] ?? []),

    postComment: (issueId, body) =>
      call('postComment', () => {
        if (!body?.trim()) throw new Error('Write a comment first.')
        if (!state.issues.some((issue) => issue.id === issueId)) throw new Error('That task no longer exists.')
        commentCounter += 1
        const comment = { id: `comment-${commentCounter}`, issueId, authorAgentId: null, authorName: 'You', body: body.trim(), createdAt: new Date(now()).toISOString() }
        state.comments[issueId] = [...(state.comments[issueId] ?? []), comment]
        emit({ topic: 'comments', id: issueId })
        return comment
      }),

    approvals: () => call('approvals', () => state.approvals),

    decideApproval: (id, decision, note) =>
      call('decideApproval', () => {
        const approval = state.approvals.find((item) => item.id === id)
        if (!approval) throw new Error('That approval no longer exists.')
        if (!DECISIONS[decision]) throw new Error(`Unknown decision: ${decision}`)
        if (approval.status !== 'pending') throw new Error('That approval is already decided.')
        approval.status = DECISIONS[decision]
        if (note) approval.decisionNote = note
        const hired = approval.type === 'hire_agent' && approval.agentId ? agentById(approval.agentId) : null
        if (hired && hired.status === 'pending_approval') {
          if (approval.status === 'approved') hired.status = 'idle'
          else if (approval.status === 'rejected') hired.status = 'terminated'
          emit({ topic: 'agents' })
        }
        emit({ topic: 'approvals' })
        return approval
      }),

    costs: () => call('costs', () => state.costs),

    setAgentBudget: (agentId, budgetMonthlyCents) =>
      call('setAgentBudget', () => {
        const agent = agentById(agentId)
        if (!agent) throw new Error('That agent no longer exists.')
        if (!Number.isInteger(budgetMonthlyCents) || budgetMonthlyCents < 0) throw new Error('The budget must be a whole number of cents, zero or more.')
        agent.budgetMonthlyCents = budgetMonthlyCents
        emit({ topic: 'agents' })
        emit({ topic: 'costs' })
        return agent
      }),

    hireAgent: (draft) =>
      call('hireAgent', () => {
        const clean = cleanAgentDraft(draft)
        const key = slug(clean.name)
        if (!key) throw new Error('The name needs letters or numbers.')
        if (state.agents.some((agent) => agent.key === key)) throw new Error('An agent with that name already exists.')
        if (clean.reportsToAgentId && !agentById(clean.reportsToAgentId)) throw new Error('The agent it reports to no longer exists.')
        const agent = { id: `agent-${key}`, key, ...clean, status: requireApproval ? 'pending_approval' : 'idle', spentMonthlyCents: 0 }
        state.agents.push(agent)
        let approval = null
        if (requireApproval) {
          approvalCounter += 1
          approval = {
            id: `approval-${approvalCounter}`,
            type: 'hire_agent',
            status: 'pending',
            summary: hireSummary(agent),
            requestedByAgentId: null,
            agentId: agent.id,
            createdAt: new Date(now()).toISOString(),
          }
          state.approvals.unshift(approval)
          emit({ topic: 'approvals' })
        }
        emit({ topic: 'agents' })
        return { agent, approval }
      }),

    updateAgent: (agentId, patch) =>
      call('updateAgent', () => {
        const agent = agentById(agentId)
        if (!agent) throw new Error('That agent no longer exists.')
        if (agent.status === 'terminated') throw new Error('That agent was terminated.')
        if (agent.status === 'pending_approval') throw new Error('Approve the hire first.')
        const { status, ...changes } = cleanAgentPatch(patch)
        if (changes.reportsToAgentId === agent.id) throw new Error('An agent cannot report to itself.')
        if (changes.reportsToAgentId && !agentById(changes.reportsToAgentId)) throw new Error('The agent it reports to no longer exists.')
        if ('name' in changes && state.agents.some((other) => other.id !== agent.id && other.key === slug(changes.name))) throw new Error('An agent with that name already exists.')
        const allowed = changes.subagentsAllowed ?? agent.subagentsAllowed
        if ('subagentDepth' in changes && !allowed) throw new Error('Turn subagents on to set a depth.')
        Object.assign(agent, changes)
        if ('subagentsAllowed' in changes) {
          if (!allowed) agent.subagentDepth = 0
          else if (!('subagentDepth' in changes) && agent.subagentDepth === 0) agent.subagentDepth = 1
        }
        if (status) agent.status = status === 'paused' ? 'paused' : 'idle'
        emit({ topic: 'agents' })
        if ('budgetMonthlyCents' in changes) emit({ topic: 'costs' })
        return agent
      }),

    models: () => call('models', () => state.models),

    briefs: () => call('briefs', () => parseBriefs(SAMPLE_BRIEFS)),

    briefPrompt: (ids, lane) =>
      call('briefPrompt', () => {
        const all = parseBriefs(SAMPLE_BRIEFS)
        const picked = (ids ?? []).map((id) => all.find((brief) => brief.id === id))
        if (picked.length === 0 || picked.some((brief) => !brief)) throw new Error('Choose a brief from the list.')
        if (!Object.hasOwn(SAMPLE_LANES, lane)) throw new Error('Choose hermes, opencode or agy.')
        return {
          prompt: buildPrompt({ briefs: picked, laneKey: lane, lanes: SAMPLE_LANES, rules: SAMPLE_RULES, version: '0.1.35' }),
          lane,
          model: modelFor(SAMPLE_LANES[lane], picked[0].id),
          branch: branchFor(picked[0]),
        }
      }),

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    emit,

    failNext(name, message = 'The request failed.') {
      failures.set(name, message)
    },
  }

  return client
}
