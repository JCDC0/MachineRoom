import { harnessUnavailableProblem, modelUnavailableProblem, resolveContextWindow } from '../../server/model-list.js'
import { outcomeTable } from '../../server/outcomes.js'
import { branchFor, buildPrompt, modelFor, parseBriefs } from '../briefs/briefs.js'
import { briefMarkdown, planPrompt } from '../briefs/plan.js'
import { SINCE_PROBLEM, dayStart, laneStats } from '../briefs/run.js'
import { readLadder } from '../model/hierarchy.js'
import { chooseRoute } from '../policy/route.js'
import { CANNOT_TAKE_TASKS, cleanAgentDraft, cleanAgentPatch, fieldProblem, hireSummary, taskDraftProblem } from './agents.js'

function laneHasHarness(lanes, harness) {
  return Object.values(lanes ?? {}).some((lane) => lane?.cli?.harness === harness)
}

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
  'searchProvider',
  'setSearchProvider',
  'suggestRoute',
  'briefs',
  'briefPrompt',
  'runs',
  'runStats',
  'outcomes',
  'liveRuns',
  'orchestrators',
  'orchestrator',
  'sendOrchestrator',
  'sendToOrchestrator',
  'stopOrchestrator',
  'compactOrchestrator',
  'setAutocompact',
  'setOrchestratorModel',
  'setOrchestratorEffort',
  'setOrchestratorHarness',
  'orchestratorSessions',
  'orchestratorSession',
  'newOrchestratorSession',
  'updateOrchestratorSession',
  'openOrchestratorSession',
  'deleteOrchestratorSession',
  'setLadder',
  'startRun',
  'lanes',
  'harnesses',
  'harnessModels',
  'providers',
  'endpoints',
  'saveEndpoint',
  'deleteEndpoint',
  'endpointModels',
  'createLane',
  'updateLane',
  'deleteLane',
  'setActiveLanes',
  'reviews',
  'reviewDiff',
  'mergeReview',
  'askPlanner',
  'plan',
  'acceptPlan',
  'decide',
  'projects',
  'openProject',
  'family',
  'setAgentLabel',
  'keys',
  'setKey',
  'deleteKey',
  'approveProposal',
  'declineProposal',
  'subscribe',
]

export const MOCK_LANE_KEYS = ['claude', 'hermes', 'opencode', 'opencode2', 'opencode3', 'opencode4', 'agy']

const SAMPLE_LADDER = {
  subs: [
    {
      id: 'frontend',
      name: 'Frontend',
      harness: 'opencode',
      model: 'opencode-go/deepseek-v4.1-flash',
      lanes: ['opencode2', 'opencode3'],
      scope: ['src/ui/**', 'src/styles.css'],
      restricted: true,
      setBy: 'owner',
    },
  ],
}

const DECISIONS = { approve: 'approved', reject: 'rejected', 'request-revision': 'revision_requested' }
const RUN_ID = /^[A-Z]\d+[a-z]?$/
const RUN_RECENT_LIMIT = 20
const TASK_PROBLEM = 'Write the task in 1 to 4000 characters.'
const TASKS_PROBLEM = 'Write one to twenty tasks, each 1 to 4000 characters.'
const TASK_SEPARATOR_PROBLEM = 'A task cannot hold a line of only ---.'
const RUN_KIND_PROBLEM = 'Send a task, a queue or briefs, not more than one.'
const QUEUE_DIRTY_PROBLEM = 'A queue needs a clean project.'
const clone = (value) => JSON.parse(JSON.stringify(value))
const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

function tasksProblem(tasks) {
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 20) return TASKS_PROBLEM
  for (const task of tasks) {
    if (typeof task !== 'string') return TASKS_PROBLEM
    const text = task.trim()
    if (text.length < 1 || text.length > 4000) return TASKS_PROBLEM
    if (task.split(/\r?\n/).some((line) => line.trim() === '---')) return TASK_SEPARATOR_PROBLEM
  }
  return null
}

const AGENT_DEFAULTS = { reasoningEffort: null, maxTurnsPerRun: null, timeoutSec: null, subagentsAllowed: false, subagentDepth: 0, instructions: '', reportsToAgentId: null }

const SAMPLE_BRIEFS = [
  '## Open work',
  '',
  '**B6. Late join replay (OpenCode).** Let the event stream send the kept history to a viewer that connects without Last-Event-ID, behind a history query. Files: `server/index.js`, `tests/bridge.test.js`. Tests in `tests/bridge.test.js`.',
  '',
  '**U4. Reject a foreign Host header in the bridge (OpenCode).** Answer 403 when the Host header is not localhost, 127.0.0.1 or [::1]. Files: `server/index.js`, `tests/bridge-safety.test.js`. Add tests for each in `tests/bridge-safety.test.js`.',
  '',
  '**C3e. HUD polish (AGY).** Move the assistant window above the transport bar and check the result by eye at two window sizes. Files: `src/ui/Assistant.jsx`, `tests/assistant-ui.test.js`. Tests in `tests/assistant-ui.test.js`.',
  '',
  '**P5. Recover cut and redacted tool lines (Hermes).** Recover the tool name and path from a broken OpenCode log line. Files: `src/model/parsers/opencode.js`, `tests/parsers.test.js`. Tests in `tests/parsers.test.js`.',
  '',
  '**M1. Exit test on a lane run (Claude and the owner).** Start one lane on a brief and read its report in the thread. Files: `src/ui/panels/DispatchPanel.jsx`, `src/ui/panels/IssueThread.jsx`, `src/control/client.js`, `tests/dispatch.test.js`. Tests in `tests/dispatch.test.js`.',
  '',
  '**C2. Control client (OpenCode, merged as 0.1.34).** Make the contract real. Files: `src/control/client.js`, `tests/control-contract.test.js`. Tests in `tests/control-contract.test.js`.',
].join('\n')

const SAMPLE_LANES = {
  hermes: { name: 'Hermes', harness: 'Hermes', model: 'deepseek/deepseek-v4.1-flash-1017', worktree: 'C:\\GitHub\\MachineRoom-hermes', role: 'You take cheap tasks with named files and clear tests.', forbidden: ['server/**', 'src/ui/**', 'src/engine/**', 'src/control/**'], notes: [], cli: { harness: 'hermes', bin: 'hermes.exe', model: 'deepseek/deepseek-v4.1-flash-1017' } },
  opencode: { name: 'OpenCode', harness: 'OpenCode', model: 'Gemini 4 Argon', worktree: 'C:\\GitHub\\MachineRoom-opencode', role: 'You own the bridge.', forbidden: ['src/ui/**', 'src/engine/**', 'src/Stage.jsx'], notes: [], cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/mimo-v2.6-pro' } },
  opencode2: { name: 'OpenCode 2', harness: 'OpenCode', model: 'Gemini 4 Argon', worktree: 'C:\\GitHub\\MachineRoom-opencode2', role: 'You own the bridge.', forbidden: ['src/ui/**', 'src/engine/**', 'src/Stage.jsx'], notes: [], cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/mimo-v2.6-pro' } },
  agy: { name: 'agy', harness: 'agy', model: 'Gemini 3.8 Flash (High)', models: { C3e: 'Gemini 4 Argon' }, worktree: 'C:\\GitHub\\MachineRoom-agy', role: 'You own the HUD.', forbidden: ['server/**', 'src/engine/**', 'src/control/**'], notes: [] },
}

export const MOCK_PROVIDERS = [
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { name: 'NVIDIA', baseUrl: 'https://integrate.api.nvidia.com/v1' },
  { name: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.ai/v1' },
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { name: 'Together', baseUrl: 'https://api.together.xyz/v1' },
  { name: 'xAI', baseUrl: 'https://api.x.ai/v1' },
  { name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
  { name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
  { name: 'Custom', baseUrl: '' },
]

const SAMPLE_ENDPOINTS = [
  { name: 'Local Ollama', provider: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', keyName: '', models: ['llama3.3', 'qwen3'] },
  { name: 'OpenRouter Work', provider: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyName: 'openrouter', models: ['deepseek/deepseek-v4.1-flash-1017'] },
]

const SAMPLE_RULES = {
  about: 'MachineRoom is a React and three.js viewer that shows coding agents working on a project as a 3D room.',
  rules: ['Work only in your own worktree and branch. Never push.', 'Run npm test after every change.'],
  report: 'Give the report in your reply, not in a file.',
}

const SAMPLE_PLAN = {
  status: 'ready',
  planId: 'comment-plan-1',
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
      { lane: 'opencode2', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
      { lane: 'agy', model: 'Gemini 3.8 Flash (High)', reasoning: 'high', provider: 'antigravity' },
    ],
    medium: [
      { lane: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
      { lane: 'agy', model: 'Gemini 3.8 Flash (High)', reasoning: 'high', provider: 'antigravity' },
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

export const MOCK_PROJECTS = {
  current: {
    path: '/mock/projects/machineroom',
    name: 'machineroom',
    git: true,
  },
  recent: [
    {
      path: '/mock/projects/paperclip',
      name: 'paperclip',
      openedAt: '2026-10-24T12:00:00.000Z',
      sessions: [
        { id: 'session-1', title: 'Fix token counts', endedAt: '2026-10-24T12:30:00.000Z' },
      ],
    },
    {
      path: '/mock/projects/airp',
      name: 'airp',
      openedAt: '2026-10-23T10:00:00.000Z',
      sessions: [],
    },
  ],
  folders: [
    { path: '/mock/projects/alpha', name: 'alpha', git: true },
    { path: '/mock/projects/beta', name: 'beta', git: false },
    { path: '/mock/projects/gamma', name: 'gamma', git: true },
  ],
}

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
      { id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', role: null, status: 'idle', model: 'sonnet', budgetMonthlyCents: 0, spentMonthlyCents: 0 },
      { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', role: null, status: 'running', model: 'opencode-go/deepseek-v4.1-flash', budgetMonthlyCents: 0, spentMonthlyCents: 0 },
      { id: 'agent-opencode2', key: 'opencode2', name: 'OpenCode 2', adapterType: 'opencode_local', role: null, status: 'idle', model: 'opencode-go/deepseek-v4.1-flash', budgetMonthlyCents: 0, spentMonthlyCents: 0 },
      { id: 'agent-opencode3', key: 'opencode3', name: 'OpenCode 3', adapterType: 'opencode_local', role: null, status: 'idle', model: 'opencode-go/deepseek-v4.1-flash', budgetMonthlyCents: 0, spentMonthlyCents: 0 },
      { id: 'agent-opencode4', key: 'opencode4', name: 'OpenCode 4', adapterType: 'opencode_local', role: null, status: 'idle', model: 'opencode-go/deepseek-v4.1-flash', budgetMonthlyCents: 0, spentMonthlyCents: 0 },
    ],
    lanes: [
      { key: 'claude', name: 'Claude Code', harness: 'claude', model: 'sonnet', custom: false, effort: null, active: true, working: false },
      { key: 'opencode', name: 'OpenCode', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', custom: false, effort: null, active: true, working: true },
      { key: 'opencode2', name: 'OpenCode 2', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', custom: false, effort: null, active: true, working: false },
      { key: 'opencode3', name: 'OpenCode 3', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', custom: false, effort: null, active: true, working: false },
      { key: 'opencode4', name: 'OpenCode 4', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', custom: false, effort: null, active: true, working: false },
    ],
    chosenLanes: false,
    issues: [
      { id: 'issue-18', identifier: 'JC-18', title: 'Fix the typo in README.md', description: 'Change Teh to The and commit.', status: 'done', priority: 'medium', assigneeAgentId: 'agent-opencode', parentId: null, createdAt: iso(90), updatedAt: iso(88) },
      { id: 'issue-19', identifier: 'JC-19', title: 'Record a failing test scenario', description: 'Add a test that fails, then fix it.', status: 'in_progress', priority: 'high', assigneeAgentId: 'agent-opencode', parentId: null, createdAt: iso(40), updatedAt: iso(3) },
      { id: 'issue-20', identifier: 'JC-20', title: 'Summarise the source files', description: 'Write docs/summary.md.', status: 'todo', priority: 'low', assigneeAgentId: 'agent-opencode2', parentId: null, createdAt: iso(20), updatedAt: iso(20) },
      { id: 'issue-21', identifier: 'JC-21', title: 'Review the layout change', description: 'Read the diff and report problems.', status: 'in_review', priority: 'medium', assigneeAgentId: 'agent-claude', parentId: 'issue-19', createdAt: iso(15), updatedAt: iso(6) },
      { id: 'issue-22', identifier: 'JC-22', title: 'Plan the control panels', description: 'Break the work into small tasks.', status: 'blocked', priority: 'critical', assigneeAgentId: 'agent-opencode3', parentId: null, createdAt: iso(10), updatedAt: iso(9) },
    ],
    comments: {
      'issue-18': [
        { id: 'comment-1', issueId: 'issue-18', authorAgentId: 'agent-opencode', authorName: 'OpenCode', body: 'Fixed the typo in README.md.\n\n- Changed "Teh quick" to "The quick".\n- Committed as f12c3db.', createdAt: iso(88) },
      ],
      'issue-22': [
        { id: 'comment-2', issueId: 'issue-22', authorAgentId: null, authorName: 'You', body: 'Keep each task under 20 minutes.', createdAt: iso(10) },
        { id: 'comment-3', issueId: 'issue-22', authorAgentId: 'agent-opencode3', authorName: 'OpenCode 3', body: 'Blocked: the diff touches files another lane is editing.', createdAt: iso(9) },
      ],
    },
    approvals: [
      { id: 'approval-1', type: 'budget_override_required', status: 'pending', summary: 'OpenCode 2 asks for a longer time limit on its next run.', requestedByAgentId: 'agent-opencode2', createdAt: iso(9) },
      { id: 'approval-2', type: 'hire_agent', status: 'pending', summary: 'Hire "Planner" (claude_local, claude-sonnet-5-5, 14 turns, subagents off).', requestedByAgentId: 'agent-opencode', createdAt: iso(7) },
      { id: 'approval-3', type: 'request_board_approval', status: 'approved', summary: 'Run the recording scenarios on the free model.', requestedByAgentId: 'agent-claude', createdAt: iso(300) },
    ],
    liveRuns: [
      { runId: 'run-live-1', agentId: 'agent-opencode', agentName: 'OpenCode', adapterType: 'opencode_local', status: 'running', issueId: 'issue-19', startedAt: iso(3), lastOutputAt: iso(1) },
    ],
    orchestratorChat: {
      state: 'idle',
      model: 'opus',
      project: 'MachineRoom',
      contextTokens: 96000,
      contextWindow: 200000,
      autocompact: true,
      autocompactMode: 'percent',
      autocompactValue: 80,
      compactRules: '',
      autocompactPercent: 80,
      effort: null,
      sessions: [
        {
          id: 'session-sample-1',
          title: 'Investigate test failures in lane runner',
          startedAt: iso(600),
          endedAt: iso(540),
          pinned: true,
          starred: false,
          sessionId: 'ses_sample_1',
          opencodeSessionId: null,
          summary: 'Investigated test failures and found timing issues.',
          messages: [
            { id: 'session-1-msg-1', from: 'owner', text: 'Check the test failures', at: iso(600) },
            { id: 'session-1-msg-2', from: 'orchestrator', text: 'I checked the logs and identified 2 timing issues.', at: iso(590) },
          ],
        },
        {
          id: 'session-sample-2',
          title: 'Review routing policy changes',
          startedAt: iso(1200),
          endedAt: iso(1100),
          pinned: false,
          starred: true,
          sessionId: 'ses_sample_2',
          opencodeSessionId: null,
          summary: 'Reviewed proposed policy diff.',
          messages: [
            { id: 'session-2-msg-1', from: 'owner', text: 'Review the policy patch', at: iso(1200) },
            { id: 'session-2-msg-2', from: 'orchestrator', text: 'The patch reorders tier choices as suggested.', at: iso(1180) },
          ],
        },
      ],
      messages: [
        { id: 'orchestrator-message-1', from: 'owner', text: 'What is running?', at: iso(40) },
        { id: 'orchestrator-message-2', from: 'orchestrator', text: 'OpenCode has one run on JC-19. I will report when it ends.', at: iso(38) },
        { id: 'orchestrator-message-3', from: 'room', text: 'Run opencode-JC-19-20261024-120000 on lane opencode ended: succeeded.', at: iso(30) },
      ],
    },
    costs: {
      summary: { spendCents: 490, budgetCents: 0, utilizationPercent: 0 },
      byAgent: [
        { agentId: 'agent-claude', agentName: 'Claude Code', costCents: 218, inputTokens: 310000, outputTokens: 26000 },
        { agentId: 'agent-opencode', agentName: 'OpenCode', costCents: 143, inputTokens: 214000, outputTokens: 31000 },
        { agentId: 'agent-opencode2', agentName: 'OpenCode 2', costCents: 87, inputTokens: 96000, outputTokens: 14000 },
        { agentId: 'agent-opencode3', agentName: 'OpenCode 3', costCents: 42, inputTokens: 51000, outputTokens: 7200 },
      ],
      quota: [],
    },
    models: [
      { id: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek v4.1 Flash (free)', harness: 'opencode', tier: 'small', free: true },
      { id: 'opencode-go/qwen3.8-flash', label: 'Qwen 3.8 Flash', harness: 'opencode', tier: 'small', free: false },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', harness: 'claude', tier: 'small', free: false, contextWindow: 1000000 },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', harness: 'claude', tier: 'medium', free: false, contextWindow: 1000000 },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', harness: 'claude', tier: 'large', free: false, contextWindow: 1000000 },
      { id: 'xiaomi/mimo-v2.6-pro', label: 'MiMo v2.6 Pro', harness: 'hermes', tier: 'medium', free: false },
      { id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek v4.1 Flash (OpenRouter)', harness: 'hermes', tier: 'medium', free: false },
      { id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek v4.1 Flash (Go)', harness: 'opencode', tier: 'medium', free: false },
    ],
  }
}

export function createMockClient({ latencyMs = 120, runMs = latencyMs * 50, now = Date.now, requireApproval = true } = {}) {
  const state = seed(now())
  state.agents = state.agents.map((agent) => ({ ...AGENT_DEFAULTS, ...agent }))
  const terminated = new Set()
  let briefsText = SAMPLE_BRIEFS
  let approvalCounter = 3
  const failures = new Map()
  let issueCounter = 22
  let commentCounter = 3
  let orchestratorMessageCounter = 3
  const listeners = new Set()
  const runsState = { project: 'MachineRoom', running: [], recent: [] }
  const reviewState = clone(SAMPLE_REVIEWS)
  let endpointState = clone(SAMPLE_ENDPOINTS)
  let ladder = readLadder(SAMPLE_LADDER, { lanes: MOCK_LANE_KEYS }).ladder
  let searchChoice = { provider: '', url: '', keyName: '' }
  const subChats = new Map()
  const familyLabels = new Map()
  const keySlots = new Map()
  const proposals = []

  function ensureSubChat(sub) {
    if (subChats.has(sub.id)) return subChats.get(sub.id)
    const chat = {
      state: 'idle',
      model: sub.model,
      project: 'MachineRoom',
      contextTokens: null,
      contextWindow: 200000,
      autocompact: true,
      autocompactMode: 'percent',
      autocompactValue: 80,
      compactRules: '',
      autocompactPercent: 80,
      effort: null,
      sessions: [],
      messages: [],
    }
    subChats.set(sub.id, chat)
    return chat
  }

  for (const sub of ladder.subs) ensureSubChat(sub)

  function chatStore(id) {
    if (id === undefined || id === null || id === '' || id === 'orchestrator') return state.orchestratorChat
    const sub = ladder.subs.find((entry) => entry.id === id)
    if (!sub) throw new Error('That orchestrator does not exist.')
    const chat = ensureSubChat(sub)
    chat.model = sub.model
    chat.id = sub.id
    chat.name = sub.name
    return chat
  }

  function orchestratorList() {
    const claimed = new Set()
    for (const sub of ladder.subs) {
      for (const lane of sub.lanes) claimed.add(lane)
    }
    const baseLanes = Object.fromEntries(state.lanes.map((lane) => [lane.key, { cli: { harness: lane.harness, bin: process.execPath } }]))
    const mockHarnesses = ['claude', 'opencode', 'hermes']
      .filter((key) => laneHasHarness(baseLanes, key) || ['claude', 'opencode'].includes(key))
      .map((key) => ({
        key,
        name: key === 'claude' ? 'Claude Code' : key === 'opencode' ? 'OpenCode' : 'Hermes',
        harness: key,
        models: state.models.filter((m) => m.harness === key).map(({ id, label, contextWindow }) => ({ id, label, ...(contextWindow ? { contextWindow } : {}) })),
      }))
    return [
      {
        id: 'orchestrator',
        name: 'Orchestrator',
        harness: state.orchestratorChat.harness ?? 'claude',
        model: state.orchestratorChat.model,
        state: state.orchestratorChat.state,
        contextTokens: state.orchestratorChat.contextTokens,
        contextWindow: state.orchestratorChat.contextWindow,
        autocompact: state.orchestratorChat.autocompact,
        autocompactMode: state.orchestratorChat.autocompactMode ?? 'percent',
        autocompactValue: state.orchestratorChat.autocompactValue ?? 80,
        compactRules: state.orchestratorChat.compactRules ?? '',
        autocompactPercent: state.orchestratorChat.autocompactPercent ?? 80,
        effort: state.orchestratorChat.effort ?? null,
        lanes: MOCK_LANE_KEYS.filter((lane) => !claimed.has(lane)),
        scope: [],
        restricted: false,
        setBy: 'owner',
        harnesses: mockHarnesses,
      },
      ...ladder.subs.map((sub) => ({
        id: sub.id,
        name: sub.name,
        harness: sub.harness,
        model: sub.model,
        state: ensureSubChat(sub).state,
        contextTokens: ensureSubChat(sub).contextTokens,
        contextWindow: ensureSubChat(sub).contextWindow,
        autocompact: ensureSubChat(sub).autocompact,
        autocompactMode: ensureSubChat(sub).autocompactMode ?? 'percent',
        autocompactValue: ensureSubChat(sub).autocompactValue ?? 80,
        compactRules: ensureSubChat(sub).compactRules ?? '',
        autocompactPercent: ensureSubChat(sub).autocompactPercent ?? 80,
        effort: ensureSubChat(sub).effort ?? null,
        lanes: [...sub.lanes],
        scope: [...sub.scope],
        restricted: sub.restricted !== false,
        setBy: sub.setBy,
        harnesses: mockHarnesses,
      })),
    ]
  }

  function sendMessage(id, text, confirmed) {
    if (confirmed !== true) throw new Error('Confirm the message first.')
    const value = typeof text === 'string' ? text.trim() : ''
    if (value.length < 1 || value.length > 8000) throw new Error('Write a message from 1 to 8000 characters.')
    const chat = chatStore(id)
    chat.state = 'idle'
    orchestratorMessageCounter += 1
    const at = new Date(now()).toISOString()
    const message = { id: `orchestrator-message-${orchestratorMessageCounter}`, from: 'owner', text: value, at }
    chat.messages.push(message)
    orchestratorMessageCounter += 1
    const sub = chat.id && chat.id !== 'orchestrator'
    chat.messages.push({
      id: `orchestrator-message-${orchestratorMessageCounter}`,
      from: 'orchestrator',
      text: sub
        ? 'I have the message. I will plan for my lanes and report to the main orchestrator.'
        : 'I have the message. I will start with the lanes that are free and report back.',
      at,
    })
    while (chat.messages.length > 200) chat.messages.shift()
    emit({ topic: 'orchestrator' })
    return { id: message.id }
  }

  function replaceLadder(next) {
    const result = readLadder(next, { lanes: MOCK_LANE_KEYS })
    if (result.problems.length > 0) {
      const error = new Error(result.problems.join(' '))
      error.problems = [...result.problems]
      throw error
    }
    const ids = new Set(result.ladder.subs.map((sub) => sub.id))
    for (const id of [...subChats.keys()]) {
      if (!ids.has(id)) subChats.delete(id)
    }
    for (const sub of result.ladder.subs) ensureSubChat(sub)
    ladder = result.ladder
    emit({ topic: 'orchestrator' })
    return { ladder: clone(ladder) }
  }

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
  let liveRunCounter = 1

  function startLiveRun(lane) {
    const agent = state.agents.find((item) => item.key === lane || String(item.key ?? '').startsWith(`${lane}-`))
    if (!agent) return null
    const issue = state.issues.find((item) => item.assigneeAgentId === agent.id && item.status !== 'done' && item.status !== 'cancelled')
    const busy = state.liveRuns.some((run) => run.agentId === agent.id && run.status === 'running')
    const stamp = new Date(now()).toISOString()
    liveRunCounter += 1
    const run = {
      runId: `run-live-${liveRunCounter}`,
      agentId: agent.id,
      agentName: agent.name,
      adapterType: agent.adapterType,
      status: busy ? 'queued' : 'running',
      issueId: issue ? issue.id : null,
      startedAt: busy ? null : stamp,
      lastOutputAt: null,
    }
    state.liveRuns.unshift(run)
    emit({ topic: 'liveRuns' })
    return run
  }

  function endLiveRun(run) {
    const index = state.liveRuns.indexOf(run)
    if (index === -1) return
    state.liveRuns.splice(index, 1)
    emit({ topic: 'liveRuns' })
  }

  const client = {
    agents: () =>
      call('agents', () => {
        if (!state.chosenLanes) return state.agents
        const activeKeys = new Set(state.lanes.filter((lane) => lane.active).map((lane) => lane.key))
        return state.agents.filter(
          (agent) => agent.key === 'orchestrator' || String(agent.key ?? '').startsWith('sub-') || activeKeys.has(agent.key)
        )
      }),

    issues: ({ status } = {}) => call('issues', () => (status ? state.issues.filter((issue) => issue.status === status) : state.issues)),

    createIssue: (draft) =>
      call('createIssue', () => {
        if (!draft?.title?.trim()) throw new Error('A title is required.')
        const assignee = agentById(draft.assigneeAgentId)
        if (!assignee) throw new Error('Choose an agent for this task.')
        if (CANNOT_TAKE_TASKS.includes(assignee.status) || terminated.has(assignee.id)) throw new Error('That agent cannot take tasks yet.')
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
          else if (approval.status === 'rejected') {
            hired.status = 'error'
            terminated.add(hired.id)
          }
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
        if (terminated.has(agent.id)) throw new Error('That agent was terminated.')
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

    searchProvider: () => call('searchProvider', () => searchChoice),

    setSearchProvider: ({ provider, url, keyName, confirmed = true } = {}) =>
      call('setSearchProvider', () => {
        if (confirmed !== true) throw new Error('Confirm web search first.')
        const name = typeof provider === 'string' ? provider.trim().toLowerCase() : ''
        if (name !== '' && !['searxng', 'tavily', 'brave', 'duckduckgo'].includes(name)) {
          throw new Error('Pick SearXNG, Tavily, Brave, DuckDuckGo or Off.')
        }
        if (name === '') {
          searchChoice = { provider: '', url: '', keyName: '' }
          return searchChoice
        }
        const address = typeof url === 'string' ? url.trim() : ''
        if (name === 'searxng' && address === '') {
          throw new Error('The SearXNG address must be an http or https address.')
        }
        if (address !== '') {
          let parsed
          try {
            parsed = new URL(address)
          } catch {
            throw new Error('The SearXNG address must be an http or https address.')
          }
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('The SearXNG address must be an http or https address.')
          }
        }
        const slot = typeof keyName === 'string' ? keyName.trim() : ''
        if (slot !== '' && !/^[A-Za-z0-9 _-]{1,40}$/.test(slot)) {
          throw new Error('A key slot name holds 1 to 40 letters, digits, spaces, - or _.')
        }
        const named = name === 'tavily' || name === 'brave'
        searchChoice = { provider: name, url: address, keyName: named ? slot : '' }
        return searchChoice
      }),

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

    briefs: () => call('briefs', () => parseBriefs(briefsText)),

    briefPrompt: (ids, lane) =>
      call('briefPrompt', () => {
        const all = parseBriefs(briefsText)
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

    liveRuns: () => call('liveRuns', () => state.liveRuns),

    orchestrators: () => call('orchestrators', () => orchestratorList()),

    orchestrator: (id) => call('orchestrator', () => chatStore(id)),

    sendOrchestrator: (text, { id } = {}) => call('sendOrchestrator', () => sendMessage(id, text, true)),

    sendToOrchestrator: (text, { confirmed } = {}) => call('sendToOrchestrator', () => sendMessage(undefined, text, confirmed)),

    stopOrchestrator: ({ confirmed, id } = {}) =>
      call('stopOrchestrator', () => {
        if (confirmed !== true) throw new Error('Confirm the stop first.')
        const chat = chatStore(id)
        chat.state = 'paused'
        emit({ topic: 'orchestrator' })
        return { ok: true }
      }),

    compactOrchestrator: (options = {}) =>
      call('compactOrchestrator', () => {
        const { id, keep, confirmed = true } = options
        if (confirmed !== true) throw new Error('Confirm the compact first.')
        if (keep !== undefined && keep !== null) {
          if (typeof keep !== 'string' || keep.trim().length > 2000) {
            throw new Error('Write at most 2000 characters to keep.')
          }
        }
        const chat = chatStore(id)
        if (chat.state === 'working') throw new Error('A turn is already running.')
        chat.contextTokens = 12000
        orchestratorMessageCounter += 1
        chat.messages.push({
          id: `orchestrator-message-${orchestratorMessageCounter}`,
          from: 'room',
          text: 'The session was compacted. The next turn starts a new session with the summary.',
          at: new Date(now()).toISOString(),
        })
        emit({ topic: 'orchestrator' })
        return { ok: true }
      }),

    setAutocompact: (idOrOptions, onArg, percentArg) =>
      call('setAutocompact', () => {
        let id
        let on
        let mode
        let value
        let rules
        let percent
        if (typeof idOrOptions === 'object' && idOrOptions !== null) {
          id = idOrOptions.id
          on = idOrOptions.on
          mode = idOrOptions.mode
          value = idOrOptions.value
          rules = idOrOptions.rules
          percent = idOrOptions.percent
        } else {
          id = idOrOptions
          if (typeof onArg === 'object' && onArg !== null) {
            on = onArg.on
            mode = onArg.mode
            value = onArg.value
            rules = onArg.rules
            percent = onArg.percent
          } else {
            on = onArg
            percent = percentArg
          }
        }
        if (
          on === undefined &&
          mode === undefined &&
          value === undefined &&
          rules === undefined &&
          percent === undefined
        ) {
          throw new Error('Say whether autocompact is on or off.')
        }
        if (on !== undefined && typeof on !== 'boolean') throw new Error('Say whether autocompact is on or off.')
        if (mode !== undefined && mode !== 'percent' && mode !== 'tokens') {
          throw new Error('Mode must be percent or tokens.')
        }
        const chat = chatStore(id)
        const targetMode = mode !== undefined ? mode : (percent !== undefined ? 'percent' : (chat.autocompactMode ?? 'percent'))
        if (percent !== undefined) {
          if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
            throw new Error('Percent must be a number above 0 and at most 100.')
          }
        }
        if (value !== undefined) {
          if (targetMode === 'percent') {
            if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100) {
              throw new Error('Percent must be a number above 0 and at most 100.')
            }
          } else if (targetMode === 'tokens') {
            if (typeof value !== 'number' || !Number.isInteger(value) || value < 1000 || value > 10000000) {
              throw new Error('Tokens must be a whole number from 1000 to 10000000.')
            }
          }
        } else if (mode !== undefined && percent === undefined) {
          const currentVal = chat.autocompactValue ?? chat.autocompactPercent ?? 80
          if (mode === 'percent') {
            if (typeof currentVal !== 'number' || !Number.isFinite(currentVal) || currentVal <= 0 || currentVal > 100) {
              throw new Error('Percent must be a number above 0 and at most 100.')
            }
          } else if (mode === 'tokens') {
            if (typeof currentVal !== 'number' || !Number.isInteger(currentVal) || currentVal < 1000 || currentVal > 10000000) {
              throw new Error('Tokens must be a whole number from 1000 to 10000000.')
            }
          }
        }
        if (rules !== undefined && rules !== null) {
          if (typeof rules !== 'string' || rules.length > 2000) {
            throw new Error('Compact rules must be at most 2000 characters.')
          }
        }
        if (typeof on === 'boolean') chat.autocompact = on
        if (mode !== undefined) chat.autocompactMode = mode
        if (value !== undefined) chat.autocompactValue = value
        if (percent !== undefined) {
          chat.autocompactMode = 'percent'
          chat.autocompactValue = percent
          chat.autocompactPercent = percent
        } else if (chat.autocompactMode === 'percent') {
          chat.autocompactPercent = chat.autocompactValue
        }
        if (rules !== undefined) {
          chat.compactRules = rules === null ? '' : rules
        }
        emit({ topic: 'orchestrator' })
        return {
          id: id ?? 'orchestrator',
          autocompact: chat.autocompact,
          autocompactMode: chat.autocompactMode ?? 'percent',
          autocompactValue: chat.autocompactValue ?? 80,
          compactRules: chat.compactRules ?? '',
          autocompactPercent: chat.autocompactPercent ?? (chat.autocompactMode === 'percent' ? chat.autocompactValue : 80),
        }
      }),

    setOrchestratorModel: (idOrOptions, modelArg, options = {}) =>
      call('setOrchestratorModel', () => {
        let id
        let model
        let confirmed = true
        if (typeof idOrOptions === 'object' && idOrOptions !== null) {
          id = idOrOptions.id
          model = idOrOptions.model
          if (idOrOptions.confirmed !== undefined) confirmed = idOrOptions.confirmed
        } else {
          id = idOrOptions
          model = modelArg
          if (options.confirmed !== undefined) confirmed = options.confirmed
        }
        if (confirmed !== true) throw new Error('Confirm the model change first.')
        const chat = chatStore(id)
        const harness = (id && id !== 'orchestrator')
          ? (ladder.subs.find((s) => s.id === id)?.harness ?? 'opencode')
          : 'claude'
        const allowed = state.models.some((m) => m.id === model && m.harness === harness)
        if (!allowed) throw new Error('Choose a model listed for this harness.')
        chat.model = model
        chat.contextWindow = resolveContextWindow(model, harness, chat.contextWindow)
        if (id && id !== 'orchestrator') {
          const sub = ladder.subs.find((s) => s.id === id)
          if (sub) sub.model = model
        }
        emit({ topic: 'orchestrator' })
        return { id: id ?? 'orchestrator', model }
      }),

    setOrchestratorHarness: (idOrOptions, harnessArg, modelArg, options = {}) =>
      call('setOrchestratorHarness', () => {
        let id
        let harness
        let model
        let confirmed = true
        if (typeof idOrOptions === 'object' && idOrOptions !== null) {
          id = idOrOptions.id
          harness = idOrOptions.harness
          model = idOrOptions.model
          if (idOrOptions.confirmed !== undefined) confirmed = idOrOptions.confirmed
        } else {
          id = idOrOptions
          harness = harnessArg
          model = modelArg
          if (options.confirmed !== undefined) confirmed = options.confirmed
        }
        if (confirmed !== true) throw new Error('Confirm the harness change first.')
        if (!harness) throw new Error('Choose a harness.')
        const baseLanes = Object.fromEntries(state.lanes.map((lane) => [lane.key, { cli: { harness: lane.harness, bin: process.execPath } }]))
        const available = ['claude', 'opencode', 'hermes'].includes(harness) || laneHasHarness(baseLanes, harness)
        if (!available) throw new Error(harnessUnavailableProblem(harness))
        const allowed = state.models.some((m) => m.id === model && m.harness === harness)
        if (!allowed) throw new Error(modelUnavailableProblem(model, harness))
        const chat = chatStore(id)
        chat.harness = harness
        chat.model = model
        chat.sessionId = null
        chat.opencodeSessionId = null
        const window = resolveContextWindow(model, harness, chat.contextWindow)
        chat.contextWindow = window
        if (id && id !== 'orchestrator') {
          const sub = ladder.subs.find((s) => s.id === id)
          if (sub) {
            sub.harness = harness
            sub.model = model
          }
        }
        emit({ topic: 'orchestrator' })
        return {
          id: id ?? 'orchestrator',
          name: id ?? 'Orchestrator',
          harness,
          model,
          contextWindow: window,
          state: chat.state ?? 'idle',
          messages: chat.messages ? [...chat.messages] : [],
        }
      }),

    setOrchestratorEffort: (idOrOptions, effortArg, options = {}) =>
      call('setOrchestratorEffort', () => {
        let id
        let effort
        let confirmed = true
        if (typeof idOrOptions === 'object' && idOrOptions !== null) {
          id = idOrOptions.id
          effort = idOrOptions.effort
          if (idOrOptions.confirmed !== undefined) confirmed = idOrOptions.confirmed
        } else {
          id = idOrOptions
          effort = effortArg
          if (options.confirmed !== undefined) confirmed = options.confirmed
        }
        if (confirmed !== true) throw new Error('Confirm the effort change first.')
        const chat = chatStore(id)
        const harness = id && id !== 'orchestrator'
          ? (ladder.subs.find((s) => s.id === id)?.harness ?? 'opencode')
          : 'claude'
        const allowed = harness === 'claude'
          ? ['low', 'medium', 'high', 'xhigh', 'max']
          : ['low', 'medium', 'high', 'max']
        if (effort !== null && !allowed.includes(effort)) {
          throw new Error('Choose an effort level listed for this harness.')
        }
        chat.effort = effort
        emit({ topic: 'orchestrator' })
        return { id: id ?? 'orchestrator', effort }
      }),

    orchestratorSessions: (options = {}) =>
      call('orchestratorSessions', () => {
        const id = options?.id
        const chat = chatStore(id)
        const firstOwner = chat.messages.find((m) => m.from === 'owner')
        const current = {
          title: chat.currentTitle || (firstOwner ? firstOwner.text.trim().slice(0, 60) : null),
          startedAt: chat.messages[0]?.at ?? null,
          count: chat.messages.length,
        }
        const sessionList = Array.isArray(chat.sessions) ? chat.sessions : []
        const sorted = [...sessionList].sort((a, b) => {
          const aPinned = Boolean(a.pinned)
          const bPinned = Boolean(b.pinned)
          if (aPinned !== bPinned) return aPinned ? -1 : 1
          const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0
          const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0
          return bTime - aTime
        })
        return {
          current,
          sessions: sorted.map((s) => ({
            id: s.id,
            title: s.title,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            pinned: Boolean(s.pinned),
            starred: Boolean(s.starred),
            count: Array.isArray(s.messages) ? s.messages.length : 0,
          })),
        }
      }),

    orchestratorSession: (idOrOptions, sessionArg) =>
      call('orchestratorSession', () => {
        let id
        let sessionId
        if (typeof idOrOptions === 'object' && idOrOptions !== null) {
          id = idOrOptions.id
          sessionId = idOrOptions.session
        } else {
          sessionId = idOrOptions
          id = sessionArg?.id ?? sessionArg
        }
        const chat = chatStore(id)
        const sessionList = Array.isArray(chat.sessions) ? chat.sessions : []
        const found = sessionList.find((s) => s.id === sessionId)
        if (!found) throw new Error('There is no session with that id.')
        return {
          id: found.id,
          title: found.title,
          messages: found.messages.map((m) => ({ ...m })),
        }
      }),

    newOrchestratorSession: (options = {}) =>
      call('newOrchestratorSession', () => {
        const { id, confirmed = true } = options
        if (confirmed !== true) throw new Error('Confirm the session change first.')
        const chat = chatStore(id)
        if (chat.state === 'working') throw new Error('A turn is already running.')
        if (!Array.isArray(chat.sessions)) chat.sessions = []
        const firstOwner = chat.messages.find((m) => m.from === 'owner')
        if (firstOwner) {
          orchestratorMessageCounter += 1
          const sid = `session-mock-${orchestratorMessageCounter}`
          chat.sessions.unshift({
            id: sid,
            title: chat.currentTitle || firstOwner.text.trim().slice(0, 60),
            startedAt: chat.messages[0]?.at ?? new Date(now()).toISOString(),
            endedAt: chat.messages.at(-1)?.at ?? new Date(now()).toISOString(),
            pinned: false,
            starred: false,
            messages: chat.messages.map((m) => ({ ...m })),
          })
        }
        chat.currentSessionId = null
        chat.currentTitle = null
        chat.messages = []
        emit({ topic: 'orchestrator' })
        return { ok: true }
      }),

    updateOrchestratorSession: (options = {}) =>
      call('updateOrchestratorSession', () => {
        const { id, session: sessionId, pinned, starred, title, confirmed = true } = options
        if (confirmed !== true) throw new Error('Confirm the session change first.')
        const chat = chatStore(id)
        const sessionList = Array.isArray(chat.sessions) ? chat.sessions : []
        const target = sessionList.find((s) => s.id === sessionId)
        if (!target) throw new Error('There is no session with that id.')
        if (title !== undefined) {
          if (typeof title !== 'string' || title.trim().length < 1 || title.trim().length > 80) {
            throw new Error('Write a title from 1 to 80 characters.')
          }
          target.title = title.trim()
        }
        if (pinned !== undefined) {
          if (typeof pinned !== 'boolean') throw new Error('Say whether pinned is true or false.')
          target.pinned = pinned
        }
        if (starred !== undefined) {
          if (typeof starred !== 'boolean') throw new Error('Say whether starred is true or false.')
          target.starred = starred
        }
        emit({ topic: 'orchestrator' })
        return { id: target.id, title: target.title, pinned: target.pinned, starred: target.starred }
      }),

    openOrchestratorSession: (options = {}) =>
      call('openOrchestratorSession', () => {
        const { id, session: sessionId, confirmed = true } = options
        if (confirmed !== true) throw new Error('Confirm the session change first.')
        const chat = chatStore(id)
        if (chat.state === 'working') throw new Error('A turn is already running.')
        const sessionList = Array.isArray(chat.sessions) ? chat.sessions : []
        const target = sessionList.find((s) => s.id === sessionId)
        if (!target) throw new Error('There is no session with that id.')
        const firstOwner = chat.messages.find((m) => m.from === 'owner')
        if (firstOwner) {
          orchestratorMessageCounter += 1
          const sid = `session-mock-${orchestratorMessageCounter}`
          chat.sessions.unshift({
            id: sid,
            title: chat.currentTitle || firstOwner.text.trim().slice(0, 60),
            startedAt: chat.messages[0]?.at ?? new Date(now()).toISOString(),
            endedAt: chat.messages.at(-1)?.at ?? new Date(now()).toISOString(),
            pinned: false,
            starred: false,
            messages: chat.messages.map((m) => ({ ...m })),
          })
        }
        chat.currentSessionId = target.id
        chat.currentTitle = target.title
        chat.messages = target.messages.map((m) => ({ ...m }))
        emit({ topic: 'orchestrator' })
        return { ok: true, id: target.id }
      }),

    deleteOrchestratorSession: (options = {}) =>
      call('deleteOrchestratorSession', () => {
        const { id, session: sessionId, confirmed = true } = options
        if (confirmed !== true) throw new Error('Confirm the session change first.')
        const chat = chatStore(id)
        const sessionList = Array.isArray(chat.sessions) ? chat.sessions : []
        const index = sessionList.findIndex((s) => s.id === sessionId)
        if (index === -1) throw new Error('There is no session with that id.')
        sessionList.splice(index, 1)
        if (chat.currentSessionId === sessionId) {
          chat.currentSessionId = null
          chat.currentTitle = null
        }
        emit({ topic: 'orchestrator' })
        return { ok: true }
      }),

    setLadder: (next) => call('setLadder', () => replaceLadder(next)),

    startRun: (lane, run, options = {}) =>
      call('startRun', () => {
        const body = Array.isArray(run) ? { briefs: run } : run ?? {}
        const confirmed = Object.hasOwn(options, 'confirmed') ? options.confirmed : true
        if (confirmed !== true) throw new Error('Confirm the run first.')
        const info = typeof lane === 'string' && Object.hasOwn(SAMPLE_LANES, lane) ? SAMPLE_LANES[lane] : null
        if (!info || typeof info !== 'object') throw new Error('Choose a lane from the list.')
        if (!Object.hasOwn(info, 'cli') || !info.cli || typeof info.cli !== 'object') throw new Error('That lane has no command line.')
        if (state.chosenLanes && !state.lanes.some((l) => l.key === lane && l.active)) {
          throw new Error(`The lane ${lane} is not active. Add it in Agents first.`)
        }
        const projectRun = body.briefs === undefined
        const queue = body.tasks !== undefined
        const worktree = projectRun && body.worktree === true
        if (queue && (body.task !== undefined || body.briefs !== undefined)) throw new Error(RUN_KIND_PROBLEM)
        const briefs = projectRun ? [] : body.briefs
        let task = ''
        let tasks = []
        if (projectRun) {
          if (queue) {
            if (body.allowDirty === true) throw new Error(QUEUE_DIRTY_PROBLEM)
            const problem = tasksProblem(body.tasks)
            if (problem) throw new Error(problem)
            tasks = body.tasks
          } else {
            if (typeof body.task !== 'string' || body.task.trim().length < 1 || body.task.length > 4000) {
              throw new Error(TASK_PROBLEM)
            }
            task = body.task
          }
        } else {
          if (!Array.isArray(briefs) || briefs.length < 1 || briefs.length > 5) throw new Error('Choose one to five briefs.')
          const known = new Set(parseBriefs(briefsText).map((brief) => brief.id))
          if (briefs.some((id) => typeof id !== 'string' || !RUN_ID.test(id) || !known.has(id))) throw new Error('Choose a brief from the list.')
        }
        if (runsState.running.some((item) => item.lane === lane)) throw new Error('That lane is already running.')
        const entry = { lane, briefs: [...briefs], startedAt: new Date(now()).toISOString(), lastLines: [] }
        if (worktree) entry.worktree = true
        if (queue) {
          entry.queue = true
          entry.tasks = tasks.length
        }
        runsState.running.push(entry)
        emit({ topic: 'runs' })
        const liveRun = startLiveRun(lane)
        setTimeout(() => {
          const index = runsState.running.indexOf(entry)
          if (index === -1) return
          runsState.running.splice(index, 1)
          endLiveRun(liveRun)
          const record = {
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
          }
          if (projectRun) {
            record.project = 'MachineRoom'
            if (worktree) record.worktree = true
            if (queue) {
              record.queue = true
              record.tasks = tasks.length
            } else {
              record.task = task.slice(0, 200)
            }
          }
          runsState.recent.unshift(record)
          if (runsState.recent.length > RUN_RECENT_LIMIT) runsState.recent.pop()
          emit({ topic: 'runs' })
        }, runMs)
        return entry
      }),

    lanes: () =>
      call('lanes', () => ({
        lanes: clone(state.lanes),
        max: state.lanes.length,
        chosen: Boolean(state.chosenLanes),
      })),

    harnesses: () =>
      call('harnesses', () => [
        {
          key: 'claude',
          name: 'Claude Code',
          available: true,
          models: [
            { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
            { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
          ],
          efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        },
        {
          key: 'opencode',
          name: 'OpenCode',
          available: true,
          models: [
            { id: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek v4.1 Flash (free)' },
            { id: 'opencode-go/qwen3.8-flash', label: 'Qwen 3.8 Flash' },
          ],
          efforts: ['low', 'medium', 'high', 'max'],
        },
        {
          key: 'agy',
          name: 'AGY',
          available: false,
          models: [],
          efforts: [],
        },
        {
          key: 'acp',
          name: 'ACP',
          available: false,
          models: [],
          efforts: [],
        },
      ]),

    harnessModels: (harnessOrOptions = {}) =>
      call('harnessModels', () => {
        let harness = ''
        if (typeof harnessOrOptions === 'string') {
          harness = harnessOrOptions
        } else if (harnessOrOptions && typeof harnessOrOptions === 'object') {
          harness = typeof harnessOrOptions.harness === 'string' ? harnessOrOptions.harness : ''
        }
        const models = state.models
          .filter((m) => m.harness === harness)
          .map(({ id, label }) => ({ id, label }))
        return {
          harness,
          models,
          source: 'list',
          fetchedAt: new Date().toISOString(),
        }
      }),

    providers: () => call('providers', () => clone(MOCK_PROVIDERS)),

    endpoints: () => call('endpoints', () => clone(endpointState)),

    saveEndpoint: (draft) =>
      call('saveEndpoint', () => {
        if (draft?.confirmed !== true) throw new Error('Confirm saving the endpoint first.')
        const name = typeof draft?.name === 'string' ? draft.name.trim() : ''
        if (!name || name.length > 40) throw new Error('The endpoint name must be 1 to 40 letters, digits, spaces, dashes or underscores.')
        const endpoint = {
          name,
          provider: draft.provider,
          baseUrl: draft.baseUrl,
          keyName: typeof draft.keyName === 'string' ? draft.keyName : '',
          models: Array.isArray(draft.models) ? [...draft.models] : [],
        }
        const index = endpointState.findIndex((entry) => entry.name === name)
        if (index === -1) {
          if (endpointState.length >= 20) throw new Error('At most 20 endpoints are allowed.')
          endpointState.push(endpoint)
        } else {
          endpointState[index] = endpoint
        }
        emit({ topic: 'endpoints' })
        return { endpoint: clone(endpoint), endpoints: clone(endpointState) }
      }),

    deleteEndpoint: ({ name, confirmed = true } = {}) =>
      call('deleteEndpoint', () => {
        if (confirmed !== true) throw new Error('Confirm deleting the endpoint first.')
        const index = endpointState.findIndex((entry) => entry.name === name)
        if (index === -1) throw new Error('The endpoint was not found.')
        endpointState.splice(index, 1)
        emit({ topic: 'endpoints' })
        return { ok: true, deleted: name, endpoints: clone(endpointState) }
      }),

    endpointModels: (name) =>
      call('endpointModels', () => {
        const endpoint = endpointState.find((entry) => entry.name === name)
        if (!endpoint) throw new Error('The endpoint was not found.')
        return [...endpoint.models]
      }),

    createLane: ({ name, harness, model, effort, confirmed = true } = {}) =>
      call('createLane', () => {
        if (confirmed !== true) throw new Error('Confirm creating the lane first.')
        const cleanName = typeof name === 'string' ? name.trim() : ''
        if (!cleanName || cleanName.length > 40) throw new Error('The lane name must be 1 to 40 characters.')
        const harnessList = [
          { key: 'claude', available: true, models: ['claude-haiku-5-5', 'claude-sonnet-5-5'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
          { key: 'opencode', available: true, models: ['opencode/deepseek-v4.1-flash-free', 'opencode-go/qwen3.8-flash'], efforts: ['low', 'medium', 'high', 'max'] },
          { key: 'agy', available: false, models: [], efforts: [] },
          { key: 'acp', available: false, models: [], efforts: [] },
        ]
        const found = harnessList.find((h) => h.key === harness)
        if (!found || !found.available) throw new Error(`The harness ${harness} is not available on this computer.`)
        if (!found.models.includes(model)) throw new Error(`The model ${model} is not available for ${harness}.`)
        if (effort && !found.efforts.includes(effort)) throw new Error(`The effort ${effort} is not available for ${harness}.`)
        const customCount = state.lanes.filter((l) => l.custom === true).length
        if (customCount >= 30) throw new Error('At most 30 custom agents are allowed.')
        const prefix = `${harness}-`
        const regex = new RegExp(`^${harness}-?(\\d+)$`)
        const taken = new Set()
        for (const l of state.lanes) {
          if (l.key === harness) taken.add(1)
          const m = regex.exec(l.key)
          if (m) taken.add(Number(m[1]))
        }
        let n = 1
        while (taken.has(n) || state.lanes.some((l) => l.key === `${prefix}${n}`)) n += 1
        const key = `${prefix}${n}`
        const entry = {
          key,
          name: cleanName,
          harness,
          model,
          effort: effort || null,
          custom: true,
          active: true,
          working: false,
          createdAt: new Date().toISOString(),
        }
        state.lanes.push(entry)
        emit({ topic: 'agents' })
        return { ...entry }
      }),

    updateLane: ({ key, name, model, effort, confirmed = true } = {}) =>
      call('updateLane', () => {
        if (confirmed !== true) throw new Error('Confirm updating the lane first.')
        const lane = state.lanes.find((l) => l.key === key)
        if (!lane) throw new Error(`The lane ${key} was not found.`)
        if (lane.custom !== true) throw new Error(`The lane ${key} comes from lanes.json and cannot be updated.`)
        const harnessList = [
          { key: 'claude', available: true, models: ['claude-haiku-5-5', 'claude-sonnet-5-5'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
          { key: 'opencode', available: true, models: ['opencode/deepseek-v4.1-flash-free', 'opencode-go/qwen3.8-flash'], efforts: ['low', 'medium', 'high', 'max'] },
          { key: 'agy', available: false, models: [], efforts: [] },
          { key: 'acp', available: false, models: [], efforts: [] },
        ]
        const found = harnessList.find((h) => h.key === lane.harness)
        if (name !== undefined) {
          const cleanName = String(name).trim()
          if (!cleanName || cleanName.length > 40) throw new Error('The lane name must be 1 to 40 characters.')
          lane.name = cleanName
        }
        if (model !== undefined) {
          if (!found || !found.models.includes(model)) throw new Error(`The model ${model} is not available for ${lane.harness}.`)
          lane.model = model
        }
        if (effort !== undefined) {
          if (effort && (!found || !found.efforts.includes(effort))) throw new Error(`The effort ${effort} is not available for ${lane.harness}.`)
          lane.effort = effort || null
        }
        emit({ topic: 'agents' })
        return { ...lane }
      }),

    deleteLane: ({ key, confirmed = true } = {}) =>
      call('deleteLane', () => {
        if (confirmed !== true) throw new Error('Confirm deleting the lane first.')
        const idx = state.lanes.findIndex((l) => l.key === key)
        if (idx === -1) throw new Error(`The lane ${key} was not found.`)
        const lane = state.lanes[idx]
        if (lane.custom !== true) throw new Error('A lane from lanes.json cannot be deleted; make it inactive instead.')
        if (lane.working === true) throw new Error(`The lane ${key} is running.`)
        state.lanes.splice(idx, 1)
        emit({ topic: 'agents' })
        return { ok: true, deleted: key }
      }),

    setActiveLanes: (optionsOrLanes, maybeConfirmed) =>
      call('setActiveLanes', () => {
        let lanes
        let confirmed = true
        if (Array.isArray(optionsOrLanes)) {
          lanes = optionsOrLanes
          if (typeof maybeConfirmed === 'boolean') confirmed = maybeConfirmed
          else if (maybeConfirmed && typeof maybeConfirmed === 'object' && maybeConfirmed.confirmed !== undefined) {
            confirmed = maybeConfirmed.confirmed
          }
        } else if (optionsOrLanes && typeof optionsOrLanes === 'object') {
          lanes = optionsOrLanes.lanes
          if (optionsOrLanes.confirmed !== undefined) confirmed = optionsOrLanes.confirmed
        }
        if (confirmed !== true) throw new Error('Confirm the active lanes first.')
        if (!Array.isArray(lanes) || lanes.length === 0) throw new Error('Choose at least one lane.')
        const seen = new Set()
        for (const key of lanes) {
          if (typeof key !== 'string' || !state.lanes.some((l) => l.key === key)) {
            throw new Error(`The lane ${key} is not known.`)
          }
          if (seen.has(key)) throw new Error('A lane cannot be listed more than once.')
          seen.add(key)
        }
        state.chosenLanes = true
        for (const lane of state.lanes) {
          lane.active = seen.has(lane.key)
        }
        emit({ topic: 'agents' })
        return { ok: true, lanes: clone(lanes) }
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
          description: planPrompt({ goal: text, lanes: SAMPLE_LANES, rules: SAMPLE_RULES, ids: parseBriefs(briefsText) }),
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

    acceptPlan: (issueId, ids, planId) =>
      call('acceptPlan', () => {
        if (!state.issues.some((issue) => issue.id === issueId)) throw new Error('That task no longer exists.')
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 || ids.some((id) => typeof id !== 'string' || !id.trim())) {
          throw new Error('Choose 1 to 8 briefs.')
        }
        if (typeof planId !== 'string' || planId !== SAMPLE_PLAN.planId) {
          throw new Error('The plan changed since you read it. Read it again.')
        }
        const clean = ids.map((id) => id.trim())
        const chosen = Object.create(null)
        for (const id of clean) chosen[id] = true
        const planned = Object.create(null)
        for (const brief of SAMPLE_PLAN.briefs) planned[brief.id] = true
        const known = Object.create(null)
        for (const brief of parseBriefs(briefsText)) known[brief.id] = true
        const missing = clean.find((id) => !Object.hasOwn(planned, id) || Object.hasOwn(known, id))
        if (missing) throw new Error(`Brief ${missing} is not in the plan, or has a problem now.`)
        const selected = SAMPLE_PLAN.briefs.filter((brief) => Object.hasOwn(chosen, brief.id))
        if (selected.length > 0) {
          const heading = /^## Briefs from the planner[ \t]*\r?$/m.test(briefsText)
          let base = briefsText
          if (!base.endsWith('\n')) base += '\n'
          if (!base.endsWith('\n\n')) base += '\n'
          const lines = selected.map((brief) => briefMarkdown(brief, SAMPLE_LANES))
          briefsText = `${base}${heading ? '' : '## Briefs from the planner\n\n'}${lines.join('\n\n')}\n`
        }
        return { added: selected.map((brief) => brief.id) }
      }),

    decide: ({ questions } = {}) =>
      call('decide', () => {
        const named = questions !== null && typeof questions === 'object' && !Array.isArray(questions)
        if (!named || Object.keys(questions).length === 0) throw new Error('Send at least one question.')
        throw new Error('No key is set for the decision model.')
      }),

    projects: () =>
      call('projects', () => ({
        current: { ...MOCK_PROJECTS.current },
        recent: MOCK_PROJECTS.recent.map((item) => ({ ...item, sessions: item.sessions.map((s) => ({ ...s })) })),
        folders: MOCK_PROJECTS.folders.map((folder) => ({ ...folder })),
      })),

    openProject: (pathOrOptions, options = {}) =>
      call('openProject', () => {
        let path
        let confirmed = true
        if (typeof pathOrOptions === 'object' && pathOrOptions !== null) {
          path = pathOrOptions.path
          if (pathOrOptions.confirmed !== undefined) confirmed = pathOrOptions.confirmed
        } else {
          path = pathOrOptions
          if (options.confirmed !== undefined) confirmed = options.confirmed
        }
        if (confirmed !== true) throw new Error('Confirm opening the project first.')
        if (typeof path !== 'string' || !path.trim()) throw new Error('Provide an absolute folder path.')
        return { ok: true, restarting: true, path }
      }),

    family: () =>
      call('family', () => {
        const directLanes = state.lanes.filter((l) => l.active && !ladder.subs.some((s) => s.lanes.includes(l.key))).map((l) => l.key)
        const mainNode = {
          id: 'orchestrator',
          kind: 'orchestrator',
          label: familyLabels.get('orchestrator') || 'Orchestrator',
          harness: 'claude',
          model: state.orchestratorChat.model,
          effort: null,
          parent: null,
          children: [...ladder.subs.map((s) => s.id), ...directLanes],
          active: true,
          working: state.orchestratorChat.state === 'working',
          custom: false,
        }
        const subNodes = ladder.subs.map((sub) => ({
          id: sub.id,
          kind: 'sub',
          label: familyLabels.get(sub.id) || 'Sub orchestrator',
          harness: sub.harness,
          model: sub.model,
          effort: null,
          parent: 'orchestrator',
          children: sub.lanes.filter((key) => state.lanes.some((l) => l.key === key && l.active)),
          active: true,
          working: false,
          custom: false,
        }))
        const laneNodes = state.lanes
          .filter((lane) => lane.active)
          .map((lane) => {
            const sub = ladder.subs.find((s) => s.lanes.includes(lane.key))
            return {
              id: lane.key,
              kind: 'lane',
              label: familyLabels.get(lane.key) || 'Code agent',
              harness: lane.harness,
              model: lane.model,
              effort: lane.effort ?? null,
              parent: sub ? sub.id : 'orchestrator',
              children: [],
              active: true,
              working: Boolean(lane.working),
              custom: Boolean(lane.custom),
            }
          })
        return {
          nodes: [mainNode, ...subNodes, ...laneNodes],
          keys: [...keySlots.keys()].sort().map((name) => ({ name })),
          proposals: clone(proposals),
        }
      }),

    setAgentLabel: (options = {}) =>
      call('setAgentLabel', () => {
        const { id, label, confirmed = true } = options
        if (confirmed !== true) throw new Error('Confirm setting the label first.')
        if (typeof label !== 'string' || !label.trim() || label.trim().length > 40) {
          throw new Error('The label must be 1 to 40 characters.')
        }
        familyLabels.set(id, label.trim())
        emit({ topic: 'family' })
        return { ok: true, id, label: label.trim() }
      }),

    keys: () => call('keys', () => [...keySlots.keys()].sort().map((name) => ({ name }))),

    setKey: (options = {}) =>
      call('setKey', () => {
        const { name, value, confirmed = true } = options
        if (confirmed !== true) throw new Error('Confirm setting the key first.')
        if (typeof name !== 'string' || !/^[A-Za-z0-9 _-]{1,40}$/.test(name)) {
          throw new Error('The key name must be 1 to 40 letters, digits, space, dash or underscore.')
        }
        if (typeof value !== 'string' || value.length < 1 || value.length > 500) {
          throw new Error('The key value must be 1 to 500 characters.')
        }
        keySlots.set(name, value)
        emit({ topic: 'family' })
        return { ok: true, name }
      }),

    deleteKey: (options = {}) =>
      call('deleteKey', () => {
        const { name, confirmed = true } = options
        if (confirmed !== true) throw new Error('Confirm deleting the key first.')
        if (!keySlots.has(name)) throw new Error(`The key ${name} was not found.`)
        keySlots.delete(name)
        emit({ topic: 'family' })
        return { ok: true, deleted: name }
      }),

    approveProposal: (options = {}) =>
      call('approveProposal', () => {
        const { id, confirmed = true } = options
        if (confirmed !== true) throw new Error('Confirm approving the proposal first.')
        const index = proposals.findIndex((p) => p.id === id)
        if (index === -1) throw new Error('The proposal was not found.')
        proposals.splice(index, 1)
        emit({ topic: 'family' })
        return { ok: true, approved: id }
      }),

    declineProposal: (options = {}) =>
      call('declineProposal', () => {
        const { id, confirmed = true } = options
        if (confirmed !== true) throw new Error('Confirm declining the proposal first.')
        const index = proposals.findIndex((p) => p.id === id)
        if (index === -1) throw new Error('The proposal was not found.')
        proposals.splice(index, 1)
        emit({ topic: 'family' })
        return { ok: true, declined: id }
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
