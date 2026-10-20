import { outcomeTable } from '../../server/outcomes.js'
import { branchFor, buildPrompt, modelFor, parseBriefs } from '../briefs/briefs.js'
import { planPrompt } from '../briefs/plan.js'
import { SINCE_PROBLEM, dayStart, laneStats } from '../briefs/run.js'
import { chooseRoute } from '../policy/route.js'
import { CANNOT_TAKE_TASKS, cleanAgentDraft, cleanAgentPatch, fieldProblem, hireSummary, taskDraftProblem } from './agents.js'

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
  'suggestRoute',
  'briefs',
  'briefPrompt',
  'runs',
  'runStats',
  'outcomes',
  'startRun',
  'reviews',
  'reviewDiff',
  'mergeReview',
  'askPlanner',
  'plan',
  'decide',
  'backupStatus',
  'backupNow',
  'subscribe',
]

const DECISIONS = { approve: 'approved', reject: 'rejected', 'request-revision': 'revision_requested' }
const RUN_ID = /^[A-Z]\d+[a-z]?$/
const RUN_RECENT_LIMIT = 20
const HOUR_MS = 60 * 60 * 1000
const BACKUP_STALE_HOURS = 26
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
  hermes: { name: 'Hermes', harness: 'Hermes', model: 'deepseek/deepseek-v4.1-flash-1017', worktree: 'C:\\GitHub\\MachineRoom-hermes', role: 'You take cheap tasks with named files and clear tests.', forbidden: ['server/**', 'src/ui/**', 'src/engine/**', 'src/control/**'], notes: [], cli: { harness: 'hermes', bin: 'hermes.exe', model: 'deepseek/deepseek-v4.1-flash-1017' } },
  opencode: { name: 'OpenCode', harness: 'OpenCode', model: 'Gemini 4 Argon', worktree: 'C:\\GitHub\\MachineRoom-opencode', role: 'You own the bridge.', forbidden: ['src/ui/**', 'src/engine/**', 'src/Stage.jsx'], notes: [], cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/mimo-v2.6-pro' } },
  agy: { name: 'agy', harness: 'agy', model: 'Gemini 3.8 Flash (High)', models: { C3e: 'Gemini 4 Argon' }, worktree: 'C:\\GitHub\\MachineRoom-agy', role: 'You own the HUD.', forbidden: ['server/**', 'src/engine/**', 'src/control/**'], notes: [] },
}

const SAMPLE_RULES = {
  about: 'MachineRoom is a React and three.js viewer that shows coding agents working on a project as a 3D room.',
  rules: ['Work only in your own worktree and branch. Never push.', 'Run npm test after every change.'],
  report: 'Give the report in your reply, not in a file.',
}

const SAMPLE_PLAN = {
  status: 'ready',
  briefs: [
    {
      id: 'C7a',
      title: 'Add the plan route',
      owner: 'opencode',
      size: 'small',
      files: ['server/plans.js'],
      tests: ['tests/plans.test.js'],
      text: 'Add the plan route in the bridge with tests.',
      dependsOn: [],
    },
  ],
  problems: ['Brief C7b names no test.'],
}

export const MOCK_POLICY = {
  tiers: {
    small: [
      { lane: 'hermes', model: 'deepseek/deepseek-v4.1-flash-1017', reasoning: 'xhigh', provider: 'openrouter' },
      { lane: 'hermes', model: 'minimax/minimax-m3.1-flash:free', reasoning: 'high', provider: 'openrouter' },
    ],
    medium: [
      { lane: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
      { lane: 'hermes', model: 'deepseek/deepseek-v4.1-flash-1017', reasoning: 'xhigh', provider: 'openrouter' },
    ],
    large: [
      { lane: 'agy', model: 'Gemini 4 Argon (Medium)', reasoning: 'medium', provider: 'antigravity' },
      { lane: 'owner', model: null, reasoning: null, provider: null },
    ],
  },
  limits: {
    runUsd: 0.25,
    issueUsd: 1,
    agentMonthlyUsd: 10,
    companyMonthlyUsd: 30,
    maxTurnsPerRun: 200,
    timeoutSec: 3600,
  },
  quotaSkipPercent: 90,
}

const SAMPLE_REVIEW_PATCH = [
  'diff --git a/src/control/client.js b/src/control/client.js',
  'index 1111111..2222222 100644',
  '--- a/src/control/client.js',
  '+++ b/src/control/client.js',
  '@@ -103,6 +103,8 @@',
  "     runs: () => request('GET', '/api/control/runs'),",
  ' ',
  "+    reviews: () => request('GET', '/api/control/reviews'),",
  '+',
  '     subscribe(listener) {',
].join('\n')

const SAMPLE_REVIEW_DIFF_FILES = [{ path: 'src/control/client.js', added: 2, deleted: 0 }]

const SAMPLE_MERGE_COMMIT = '4f3c9a1b7d2e8f0a6c5b4d3e2f1a0b9c8d7e6f5a'

const SAMPLE_REVIEWS = {
  hermes: {
    lane: 'hermes',
    worktree: 'C:\\GitHub\\MachineRoom-hermes',
    branch: 'feat/p5-recover-cut-tool-lines',
    head: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
    ahead: 2,
    commits: ['9f1c2a3 P5: take the tool name from the broken line', '4b7d0e8 P5: map the grep line to search'],
    dirty: false,
    files: 1,
    added: 2,
    deleted: 0,
    lastRun: null,
  },
  opencode: {
    lane: 'opencode',
    worktree: 'C:\\GitHub\\MachineRoom-opencode',
    branch: 'feat/w3a-read-the-lane',
    head: '2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e',
    ahead: 1,
    commits: ['6c49a75 0.1.47: Start a lane on a brief from the bridge'],
    dirty: true,
    files: 1,
    added: 2,
    deleted: 0,
    lastRun: {
      lane: 'opencode',
      briefs: ['W3a'],
      model: 'opencode-go/mimo-v2.6-pro',
      reasoning: null,
      startedAt: '2026-10-18T22:10:00.000Z',
      minutes: 12,
      exitCode: 0,
      killed: false,
      costUsd: 0.42,
      log: null,
      branch: 'feat/w3a-read-the-lane',
      commits: ['6c49a75 0.1.47: Start a lane on a brief from the bridge'],
    },
  },
  agy: {
    lane: 'agy',
    worktree: 'C:\\GitHub\\MachineRoom-agy',
    branch: 'feat/t7-run-a-brief',
    head: '3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f',
    ahead: 3,
    commits: ['c3a1b2e T7: add the Run now button', '5d6e7f8 T7: confirm card before a run', '0a1b2c3 T7: list the runs under the brief'],
    dirty: false,
    files: 1,
    added: 2,
    deleted: 0,
    lastRun: null,
  },
}

const SAMPLE_OUTCOME_RUNS = [
  { lane: 'opencode', model: 'opencode-go/mimo-v2.6-pro', costUsd: 0.42, branch: 'feat/w3a-read-the-lane' },
  { lane: 'hermes', model: 'deepseek/deepseek-v4.1-flash-1017', costUsd: 0.18, branch: 'feat/p5-recover-cut-tool-lines' },
  { lane: 'agy', model: 'Gemini 3.8 Flash (High)', costUsd: 0.31, branch: 'feat/t7-run-a-brief' },
  { lane: 'opencode', model: 'opencode-go/mimo-v2.6-pro', costUsd: 0.22, branch: 'feat/c3e-hud-polish' },
]

const SAMPLE_OUTCOMES = [
  { branch: 'feat/w3a-read-the-lane', outcome: 'merged', grade: 'A-', fixes: 2 },
  { branch: 'feat/p5-recover-cut-tool-lines', outcome: 'merged', grade: 'B+', fixes: 1 },
  { branch: 'feat/t7-run-a-brief', outcome: 'rejected', grade: 'C', fixes: 0 },
]

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

export function createMockClient({ latencyMs = 120, runMs = latencyMs * 50, now = Date.now, requireApproval = true } = {}) {
  const state = seed(now())
  state.agents = state.agents.map((agent) => ({ ...AGENT_DEFAULTS, ...agent }))
  let approvalCounter = 3
  const failures = new Map()
  let issueCounter = 22
  let commentCounter = 3
  const listeners = new Set()
  const runsState = { running: [], recent: [] }
  const reviewState = clone(SAMPLE_REVIEWS)
  const backupState = { latestMs: now() - 49.5 * HOUR_MS, running: false }

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
        const problem = taskDraftProblem(draft)
        if (problem) throw new Error(problem)
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

    comments: (issueId) => call('comments', () => (Object.hasOwn(state.comments, issueId) ? state.comments[issueId] : [])),

    postComment: (issueId, body) =>
      call('postComment', () => {
        if (!body?.trim()) throw new Error('Write a comment first.')
        if (!state.issues.some((issue) => issue.id === issueId)) throw new Error('That task no longer exists.')
        commentCounter += 1
        const comment = { id: `comment-${commentCounter}`, issueId, authorAgentId: null, authorName: 'You', body: body.trim(), createdAt: new Date(now()).toISOString() }
        state.comments[issueId] = [...(Object.hasOwn(state.comments, issueId) ? state.comments[issueId] : []), comment]
        emit({ topic: 'comments', id: issueId })
        return comment
      }),

    approvals: () => call('approvals', () => state.approvals),

    decideApproval: (id, decision, note) =>
      call('decideApproval', () => {
        const approval = state.approvals.find((item) => item.id === id)
        if (!approval) throw new Error('That approval no longer exists.')
        if (!Object.hasOwn(DECISIONS, decision)) throw new Error(`Unknown decision: ${decision}`)
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
        const problem = fieldProblem('budgetMonthlyCents', budgetMonthlyCents)
        if (problem) throw new Error(problem)
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

    suggestRoute: (profile, { failures } = {}) =>
      call('suggestRoute', () => {
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('Describe the task first.')
        if (failures !== undefined && (!Number.isInteger(failures) || failures < 0 || failures > 5)) {
          throw new Error('Failures must be a whole number from 0 to 5.')
        }
        return chooseRoute({
          policy: MOCK_POLICY,
          profile,
          failures,
          quotas: state.costs.quota,
          spent: { companyMonthlyUsd: state.costs.summary.spendCents / 100 },
        })
      }),

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

    runs: () => call('runs', () => runsState),

    runStats: ({ since } = {}) =>
      call('runStats', () => {
        if (since && dayStart(since) === null) throw new Error(SINCE_PROBLEM)
        return laneStats(runsState.recent, since ? { since } : {})
      }),

    outcomes: () => call('outcomes', () => outcomeTable(SAMPLE_OUTCOME_RUNS, SAMPLE_OUTCOMES)),

    startRun: (lane, briefs, options = {}) =>
      call('startRun', () => {
        const confirmed = Object.hasOwn(options, 'confirmed') ? options.confirmed : true
        if (confirmed !== true) throw new Error('Confirm the run first.')
        const info = typeof lane === 'string' && Object.hasOwn(SAMPLE_LANES, lane) ? SAMPLE_LANES[lane] : null
        if (!info || typeof info !== 'object') throw new Error('Choose a lane from the list.')
        if (!Object.hasOwn(info, 'cli') || !info.cli || typeof info.cli !== 'object') throw new Error('That lane has no command line.')
        if (!Array.isArray(briefs) || briefs.length < 1 || briefs.length > 5) throw new Error('Choose one to five briefs.')
        const known = new Set(parseBriefs(SAMPLE_BRIEFS).map((brief) => brief.id))
        if (briefs.some((id) => typeof id !== 'string' || !RUN_ID.test(id) || !known.has(id))) throw new Error('Choose a brief from the list.')
        if (runsState.running.some((item) => item.lane === lane)) throw new Error('That lane is already running.')
        const entry = { lane, briefs: [...briefs], startedAt: new Date(now()).toISOString(), lastLines: [] }
        runsState.running.push(entry)
        emit({ topic: 'runs' })
        setTimeout(() => {
          const index = runsState.running.indexOf(entry)
          if (index === -1) return
          runsState.running.splice(index, 1)
          runsState.recent.unshift({
            lane,
            briefs: [...entry.briefs],
            model: typeof info.cli.model === 'string' && info.cli.model ? info.cli.model : null,
            reasoning: info.reasoning ? String(info.reasoning) : null,
            startedAt: entry.startedAt,
            minutes: 0,
            exitCode: 0,
            killed: false,
            costUsd: null,
            log: null,
            branch: '',
            commits: [],
          })
          if (runsState.recent.length > RUN_RECENT_LIMIT) runsState.recent.pop()
          emit({ topic: 'runs' })
        }, runMs)
        return entry
      }),

    reviews: () => call('reviews', () => Object.values(reviewState)),

    reviewDiff: (lane) =>
      call('reviewDiff', () => {
        const review = typeof lane === 'string' && Object.hasOwn(reviewState, lane) ? reviewState[lane] : null
        if (!review) throw new Error('Choose a lane from the list.')
        return {
          lane: review.lane,
          branch: review.branch,
          head: review.head,
          files: clone(SAMPLE_REVIEW_DIFF_FILES),
          patch: SAMPLE_REVIEW_PATCH,
          truncated: false,
        }
      }),

    mergeReview: (lane, options = {}) =>
      call('mergeReview', () => {
        const review = typeof lane === 'string' && Object.hasOwn(reviewState, lane) ? reviewState[lane] : null
        if (!review) throw new Error('Choose a lane from the list.')
        const confirmed = Object.hasOwn(options, 'confirmed') ? options.confirmed : true
        if (confirmed !== true) throw new Error('Confirm the merge first.')
        if (
          typeof options.head !== 'string' ||
          !/^[0-9a-fA-F]{40}$/.test(options.head) ||
          typeof options.message !== 'string' ||
          options.message.length < 1 ||
          options.message.length > 200 ||
          /[\r\n]/.test(options.message)
        ) {
          throw new Error('Send the head you read and a message of one line.')
        }
        if (options.head !== review.head) throw new Error('The lane moved since you read it. Read it again.')
        if (review.dirty) throw new Error('The lane has uncommitted changes.')
        if (review.ahead === 0) throw new Error('Nothing to merge.')
        review.ahead = 0
        review.commits = []
        review.files = 0
        review.added = 0
        review.deleted = 0
        return { ok: true, lane: review.lane, branch: review.branch, head: review.head, commit: SAMPLE_MERGE_COMMIT }
      }),

    askPlanner: (goal) =>
      call('askPlanner', () => {
        const text = typeof goal === 'string' ? goal.trim() : ''
        if (text.length < 1 || text.length > 2000) throw new Error('Write the goal in 1 to 2000 characters.')
        issueCounter += 1
        const stamp = new Date(now()).toISOString()
        const issue = {
          id: `issue-${issueCounter}`,
          identifier: `JC-${issueCounter}`,
          title: `Plan: ${text.slice(0, 60)}`,
          description: planPrompt({ goal: text, lanes: SAMPLE_LANES, rules: SAMPLE_RULES, ids: parseBriefs(SAMPLE_BRIEFS) }),
          status: 'todo',
          priority: 'medium',
          assigneeAgentId: null,
          parentId: null,
          overrides: null,
          createdAt: stamp,
          updatedAt: stamp,
        }
        state.issues.unshift(issue)
        emit({ topic: 'issues' })
        return { issueId: issue.id, identifier: issue.identifier }
      }),

    plan: (issueId) =>
      call('plan', () => {
        if (!state.issues.some((issue) => issue.id === issueId)) throw new Error('That task no longer exists.')
        return SAMPLE_PLAN
      }),

    decide: ({ questions } = {}) =>
      call('decide', () => {
        const named = questions !== null && typeof questions === 'object' && !Array.isArray(questions)
        if (!named || Object.keys(questions).length === 0) throw new Error('Send at least one question.')
        throw new Error('No key is set for the decision model.')
      }),

    backupStatus: () =>
      call('backupStatus', () => {
        const ageHours = Math.round(((now() - backupState.latestMs) / HOUR_MS) * 10) / 10
        const stale = ageHours > BACKUP_STALE_HOURS
        return {
          enabled: true,
          status: stale ? 'warning' : 'ok',
          latestAt: new Date(backupState.latestMs).toISOString(),
          ageHours,
          warnings: stale ? ['database_backup_stale'] : [],
          checkedAt: new Date(now()).toISOString(),
        }
      }),

    async backupNow() {
      if (backupState.running) throw new Error('A backup is already running.')
      backupState.running = true
      try {
        return await call('backupNow', () => {
          const done = new Date(now())
          const pad = (value) => String(value).padStart(2, '0')
          const stamp = `${done.getFullYear()}${pad(done.getMonth() + 1)}${pad(done.getDate())}-${pad(done.getHours())}${pad(done.getMinutes())}${pad(done.getSeconds())}`
          backupState.latestMs = done.getTime()
          return { ok: true, name: `paperclip-${stamp}.sql.gz`, sizeBytes: 796653, prunedCount: 0, finishedAt: done.toISOString() }
        })
      } finally {
        backupState.running = false
      }
    },

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
