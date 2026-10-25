import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { AGENT_REFUSAL } from '../server/control.js'
import { LANE_TASK_REFUSAL } from '../server/lane-tasks.js'
import { PLAN_REFUSAL } from '../server/plans.js'
import { createClient } from '../src/control/client.js'
import { CLIENT_METHODS, MOCK_POLICY, createMockClient } from '../src/control/mock.js'
import { makeTempDir } from './helpers/tempRoot.js'

const NO_GIT_CONFIG = join(tmpdir(), 'machineroom-contract-no-git-config')
const RUN_ROOM = resolve(fileURLToPath(new URL('..', import.meta.url)))

const SAMPLE_TASKS_MD = [
  '## Open work',
  '',
  '**B6. Late join replay (OpenCode).** Let the event stream send the kept history to a viewer. Test it in tests/bridge.test.js.',
  '',
  '**U4. Reject a foreign Host header in the bridge (OpenCode).** Answer 403 when the Host header is not local.',
  '',
  '**C3e. HUD polish (AGY).** Move the assistant window above the transport bar.',
  '',
  '**C2. Control client (OpenCode, merged as 0.1.34).** Make the contract real.',
].join('\n')

const SAMPLE_HOUSE_RULES_MD = [
  '# House rules',
  '',
  '## Rules',
  '',
  '- Work only in your own worktree and branch. Never push.',
  '- Run npm test after every change.',
].join('\n')

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
  "const record = { lane: args[0], briefs: args.slice(1), model: null, reasoning: null, startedAt: new Date().toISOString(), minutes: 0, exitCode: 0, killed: false, costUsd: 0.2, log: null, branch: '', commits: [] }",
  "appendFileSync(join(folder, 'runs.jsonl'), JSON.stringify(record) + '\\n')",
].join('\n')

const SMALL = { files: 1, hasTests: true, clarity: 'clear', reversible: true, touchesSecrets: false, touchesDeploy: false }

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

const cleanups = []
let shared = null

beforeAll(() => {
  const base = makeTempDir('mr-contract-git-')
  const repo = join(base, 'repo')
  const worktree = join(base, 'lane-worktree')
  mkdirSync(join(repo, 'docs', 'agents'), { recursive: true })
  testGit(repo, ['init', '-b', 'main'])
  testGit(repo, ['config', 'user.name', 'MachineRoom Test'])
  testGit(repo, ['config', 'user.email', 'test@example.invalid'])
  testGit(repo, ['config', 'commit.gpgsign', 'false'])
  testGit(repo, ['config', 'core.autocrlf', 'false'])
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'machine-room', version: '0.1.35' }))
  writeFileSync(join(repo, 'docs', 'agents', 'TASKS.md'), SAMPLE_TASKS_MD)
  writeFileSync(join(repo, 'docs', 'agents', 'HOUSE-RULES.md'), SAMPLE_HOUSE_RULES_MD)
  writeFileSync(join(repo, 'docs', 'agents', 'policy.json'), JSON.stringify(MOCK_POLICY))
  writeFileSync(
    join(repo, 'docs', 'agents', 'lanes.json'),
    JSON.stringify({
      opencode: {
        name: 'OpenCode',
        harness: 'OpenCode',
        role: 'You own the bridge.',
        forbidden: [],
        worktree,
        cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/deepseek-v4.1-flash' },
      },
      claude: {
        name: 'Claude Code',
        harness: 'Claude Code',
        role: 'You review.',
        forbidden: [],
        worktree: repo,
        cli: { harness: 'claude', bin: 'claude', model: 'sonnet' },
      },
    })
  )
  writeFileSync(join(repo, 'notes.txt'), 'hello\n')
  testGit(repo, ['add', '.'])
  testGit(repo, ['commit', '-m', 'first'])
  testGit(repo, ['worktree', 'add', '-b', 'feat/contract-lane', worktree])
  writeFileSync(join(worktree, 'notes.txt'), 'hello again\n')
  writeFileSync(join(worktree, 'extra.js'), 'export const x = 1\n')
  testGit(worktree, ['add', '.'])
  testGit(worktree, ['commit', '-m', 'second'])
  shared = { base, repo, worktree }
})

afterAll(() => {
  if (shared) rmSync(shared.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  shared = null
})

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function useTemp(dir) {
  const previous = process.env.TEMP
  process.env.TEMP = dir
  cleanups.push(() => {
    process.env.TEMP = previous
  })
}

function record(lane, briefs, { exitCode = 0, task = '', project = '' } = {}) {
  return {
    lane,
    briefs,
    model: null,
    reasoning: null,
    startedAt: new Date().toISOString(),
    minutes: 1,
    exitCode,
    killed: false,
    costUsd: 0.5,
    log: null,
    branch: '',
    commits: [],
    ...(task ? { task } : {}),
    ...(project ? { project } : {}),
  }
}

function writeRuns(runs, records) {
  mkdirSync(runs, { recursive: true })
  writeFileSync(join(runs, 'runs.jsonl'), `${records.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
}

async function makeHarness({ records = [] } = {}) {
  const base = tempDir('mr-contract-runs-')
  const runs = join(base, 'machineroom-runs')
  mkdirSync(runs, { recursive: true })
  const withLogs = records.map((entry, index) => ({
    ...entry,
    log: entry.log ?? join(runs, `${entry.lane}-${entry.briefs[0] ?? 'project'}-20261024-12${String(index).padStart(4, '0')}.log`),
  }))
  if (withLogs.length > 0) writeRuns(runs, withLogs)
  const runnerDir = tempDir('mr-contract-runner-')
  const runnerPath = join(runnerDir, 'tiny-runner.mjs')
  writeFileSync(runnerPath, TINY_RUNNER)
  useTemp(base)
  const lanes = JSON.parse(readFileSync(join(shared.repo, 'docs', 'agents', 'lanes.json'), 'utf8'))
  const bridge = createBridge({
    projectRoot: RUN_ROOM,
    briefsDir: join(shared.repo, 'docs', 'agents'),
    port: 0,
    runnerCommand: { file: process.execPath, args: [runnerPath] },
    lanesSource: { folder: runs, lanes, repoRoot: RUN_ROOM, pollMs: 20, quietMs: 60000 },
    env: {},
    reconnectMinMs: 60000,
    reconnectMaxMs: 60000,
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  const client = createClient({
    baseUrl: url,
    fetchImpl: (input, init = {}) =>
      fetch(input, {
        ...init,
        headers: {
          ...init?.headers,
          Origin: 'http://localhost:5173',
        },
      }),
  })
  return { client, url, runs, repo: shared.repo, worktree: shared.worktree }
}

async function waitUntil(fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error('condition not met in time')
}

describe('the control client contract', () => {
  it('has every method of the contract on the mock and on the bridge client', async () => {
    const mock = createMockClient({ latencyMs: 0 })
    for (const name of CLIENT_METHODS) expect(typeof mock[name], `mock ${name}`).toBe('function')
    const { client } = await makeHarness()
    for (const name of CLIENT_METHODS) expect(typeof client[name], `bridge ${name}`).toBe('function')
  })

  it('lists the lanes with the spend from the run records', async () => {
    const { client } = await makeHarness({ records: [record('opencode', ['B6'])] })
    const agents = await client.agents()
    expect(agents.map((agent) => [agent.key, agent.name, agent.role, agent.spentMonthlyCents])).toEqual([
      ['opencode', 'OpenCode', null, 50],
      ['claude', 'Claude Code', null, 0],
    ])
    for (const agent of agents) {
      for (const key of ['id', 'key', 'name', 'adapterType', 'role', 'status', 'model', 'reasoningEffort', 'maxTurnsPerRun', 'timeoutSec', 'subagentsAllowed', 'subagentDepth', 'instructions', 'reportsToAgentId', 'budgetMonthlyCents', 'spentMonthlyCents']) {
        expect(agent, `${agent.name} ${key}`).toHaveProperty(key)
      }
    }
  })

  it('lists one task per run record with its status and filters by status', async () => {
    const { client } = await makeHarness({
      records: [record('opencode', ['B6']), record('claude', ['U4'], { exitCode: 1, task: 'Review the header' })],
    })
    const all = await client.issues()
    expect(all).toHaveLength(2)
    expect(all.every((issue) => issue.identifier === 'B6' || issue.identifier === 'U4')).toBe(true)
    const done = await client.issues({ status: 'done' })
    expect(done.map((issue) => issue.identifier)).toEqual(['B6'])
    const blocked = await client.issues({ status: 'blocked' })
    expect(blocked.map((issue) => issue.identifier)).toEqual(['U4'])
  })

  it('refuses every task and comment write', async () => {
    const { client } = await makeHarness()
    const agents = await client.agents()
    await expect(client.createIssue({ title: 'Do it', assigneeAgentId: agents[0].id })).rejects.toThrow(LANE_TASK_REFUSAL)
    await expect(client.postComment('opencode-B6-20261024-120000', 'Hello.')).rejects.toThrow(LANE_TASK_REFUSAL)
  })

  it('answers an empty thread and no approvals', async () => {
    const { client } = await makeHarness()
    expect(await client.comments('opencode-B6-20261024-120000')).toEqual([])
    expect(await client.approvals()).toEqual([])
    await expect(client.decideApproval('approval-1', 'approve')).rejects.toThrow('That approval no longer exists.')
  })

  it('refuses every agent write', async () => {
    const { client } = await makeHarness()
    await expect(client.hireAgent({ name: 'Scout', adapterType: 'claude_local' })).rejects.toThrow(AGENT_REFUSAL)
    await expect(client.updateAgent('agent-opencode', { model: 'm2' })).rejects.toThrow(AGENT_REFUSAL)
    await expect(client.setAgentBudget('agent-opencode', 250)).rejects.toThrow(AGENT_REFUSAL)
  })

  it('reports costs from the lane records with no quota window', async () => {
    const { client } = await makeHarness({ records: [record('opencode', ['B6']), record('opencode', ['U4'])] })
    const { summary, byAgent, quota } = await client.costs()
    expect(summary).toEqual({ spendCents: 100, budgetCents: 0, utilizationPercent: null })
    expect(byAgent).toEqual([
      { agentId: 'agent-opencode', agentName: 'OpenCode', costCents: 100, inputTokens: null, outputTokens: null },
      { agentId: 'agent-claude', agentName: 'Claude Code', costCents: 0, inputTokens: null, outputTokens: null },
    ])
    expect(quota).toEqual([])
  })

  it('lists the live run of an open lane log', async () => {
    const { client, runs } = await makeHarness()
    const name = 'opencode-B6-20261024-120000'
    writeFileSync(join(runs, `${name}.log`), '')
    const live = await (async () => {
      let seen = []
      await waitUntil(async () => {
        seen = await client.liveRuns()
        return seen.length > 0
      })
      return seen
    })()
    expect(live).toEqual([
      {
        runId: `run-${name}`,
        agentId: 'agent-opencode',
        agentName: 'OpenCode',
        adapterType: 'opencode_local',
        status: 'running',
        issueId: name,
        startedAt: expect.any(String),
        lastOutputAt: null,
      },
    ])
  })

  it('suggests a route from the policy with the lane spend', async () => {
    const { client } = await makeHarness()
    const route = await client.suggestRoute(SMALL)
    expect(route).toEqual({
      tier: 'small',
      choice: { lane: 'opencode2', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max', provider: 'opencode' },
      reason: 'The small tier runs opencode2 on opencode-go/deepseek-v4.1-flash at max.',
    })
    await expect(client.suggestRoute('small')).rejects.toThrow('Describe the task first.')
    await expect(client.suggestRoute(SMALL, { failures: 9 })).rejects.toThrow('Failures must be a whole number from 0 to 5.')
  })

  it('lists briefs and builds a prompt for one lane', async () => {
    const { client } = await makeHarness()
    const briefs = await client.briefs()
    expect(briefs.map((brief) => brief.id)).toEqual(['B6', 'U4', 'C3e', 'C2'])
    expect(briefs.find((brief) => brief.id === 'C2').done).toBe(true)
    const one = await client.briefPrompt(['B6'], 'opencode')
    expect(one.lane).toBe('opencode')
    expect(one.branch).toBe('feat/b6-late-join-replay')
    expect(one.prompt).toContain('Task B6: Late join replay.')
    await expect(client.briefPrompt(['ZZ9'], 'opencode')).rejects.toThrow(/Choose a brief/)
  })

  it('starts a run and keeps its record', async () => {
    const { client } = await makeHarness()
    const entry = await client.startRun('opencode', ['B6'])
    expect(entry.lane).toBe('opencode')
    expect(entry.briefs).toEqual(['B6'])
    await waitUntil(async () => {
      const state = await client.runs()
      return state.running.every((item) => item.lane !== 'opencode') && state.recent.some((item) => item.lane === 'opencode')
    })
    const { recent } = await client.runs()
    expect(recent.find((item) => item.lane === 'opencode')).toMatchObject({ lane: 'opencode', briefs: ['B6'], exitCode: 0, killed: false })
  })

  it('refuses a bad run in plain words', async () => {
    const { client } = await makeHarness()
    await expect(client.startRun('nobody', ['B6'])).rejects.toThrow('Choose a lane from the list.')
    await expect(client.startRun('opencode', [])).rejects.toThrow('Choose one to five briefs.')
    await expect(client.startRun('opencode', ['ZZ9'])).rejects.toThrow('Choose a brief from the list.')
  })

  it('asks the planner and reads the plan through the lane records only', async () => {
    const { client } = await makeHarness()
    await expect(client.askPlanner('Split the work into briefs.')).rejects.toThrow(PLAN_REFUSAL)
    await expect(client.plan('opencode-B6-20261024-120000')).rejects.toThrow(PLAN_REFUSAL)
    await expect(client.acceptPlan('opencode-B6-20261024-120000', ['B6'], 'plan-1')).rejects.toThrow(PLAN_REFUSAL)
  })

  it('enforces local origins, JSON content-type and the 64 KB body limit on control routes', async () => {
    const { url } = await makeHarness()
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

describe('the mock client still answers the contract', () => {
  it('lists agents, issues and models', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const agents = await client.agents()
    expect(agents.length).toBeGreaterThan(0)
    const issues = await client.issues()
    expect(Array.isArray(issues)).toBe(true)
    const models = await client.models()
    expect(new Set(models.map((model) => model.tier))).toEqual(new Set(['small', 'medium', 'large']))
  })

  it('turns autocompact off and on for each orchestrator', async () => {
    const client = createMockClient({ latencyMs: 0 })
    expect((await client.orchestrator()).autocompact).toBe(true)
    expect((await client.orchestrator()).autocompactPercent).toBe(80)
    await client.setAutocompact('orchestrator', false)
    expect((await client.orchestrator()).autocompact).toBe(false)
    expect((await client.orchestrators()).find((entry) => entry.id === 'orchestrator').autocompact).toBe(false)
    await client.setAutocompact('frontend', false)
    expect((await client.orchestrators()).find((entry) => entry.id === 'frontend').autocompact).toBe(false)
    expect((await client.orchestrator('frontend')).autocompact).toBe(false)
    await client.setAutocompact('orchestrator', true, 75)
    expect((await client.orchestrator()).autocompact).toBe(true)
    expect((await client.orchestrator()).autocompactPercent).toBe(75)
    await expect(client.setAutocompact('orchestrator', 'yes')).rejects.toThrow('Say whether autocompact is on or off.')
    await expect(client.setAutocompact('orchestrator', true, 40)).rejects.toThrow('Percent must be a whole number from 50 to 95.')
  })

  it('compacts an orchestrator and sets its model on the mock', async () => {
    const client = createMockClient({ latencyMs: 0 })
    await client.compactOrchestrator({ id: 'orchestrator', keep: 'Keep tests' })
    const chat = await client.orchestrator('orchestrator')
    expect(chat.messages.at(-1).text).toContain('The session was compacted.')

    await client.setOrchestratorModel({ id: 'orchestrator', model: 'claude-haiku-5-5' })
    expect((await client.orchestrator('orchestrator')).model).toBe('claude-haiku-5-5')
    await expect(client.setOrchestratorModel({ id: 'orchestrator', model: 'unlisted-model' })).rejects.toThrow(
      'Choose a model listed for this harness.'
    )
  })
})

describe('the control client orchestrator routes', () => {
  function recorder(answer = {}) {
    const calls = []
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, method: options.method, body: options.body })
      return { ok: true, json: async () => answer }
    }
    return { calls, client: createClient({ baseUrl: 'http://127.0.0.1:9', fetchImpl }) }
  }

  it('reads the list and one chat by id', async () => {
    const { calls, client } = recorder({ subs: [] })
    await client.orchestrators()
    await client.orchestrator()
    await client.orchestrator('frontend')
    expect(calls).toEqual([
      { url: 'http://127.0.0.1:9/api/orchestrators', method: 'GET', body: undefined },
      { url: 'http://127.0.0.1:9/api/orchestrator', method: 'GET', body: undefined },
      { url: 'http://127.0.0.1:9/api/orchestrator?id=frontend', method: 'GET', body: undefined },
    ])
  })

  it('sends and stops at the named orchestrator', async () => {
    const { calls, client } = recorder()
    await client.sendOrchestrator('Hello')
    await client.sendOrchestrator('Go', { id: 'frontend' })
    await client.stopOrchestrator()
    await client.stopOrchestrator({ id: 'frontend' })
    expect(calls.map((call) => [call.method, call.url, JSON.parse(call.body ?? 'null')])).toEqual([
      ['POST', 'http://127.0.0.1:9/api/orchestrator/messages', { text: 'Hello', confirmed: true }],
      ['POST', 'http://127.0.0.1:9/api/orchestrator/messages', { text: 'Go', id: 'frontend', confirmed: true }],
      ['POST', 'http://127.0.0.1:9/api/orchestrator/stop', { confirmed: true }],
      ['POST', 'http://127.0.0.1:9/api/orchestrator/stop', { confirmed: true, id: 'frontend' }],
    ])
  })

  it('sets autocompact at the named orchestrator', async () => {
    const { calls, client } = recorder({ id: 'frontend', autocompact: false, autocompactPercent: 75 })
    await client.setAutocompact('frontend', false)
    await client.setAutocompact(undefined, true, 75)
    expect(calls).toEqual([
      {
        url: 'http://127.0.0.1:9/api/orchestrator/autocompact',
        method: 'POST',
        body: JSON.stringify({ id: 'frontend', on: false, confirmed: true }),
      },
      {
        url: 'http://127.0.0.1:9/api/orchestrator/autocompact',
        method: 'POST',
        body: JSON.stringify({ id: 'orchestrator', on: true, percent: 75, confirmed: true }),
      },
    ])
  })

  it('compacts and sets model at the named orchestrator', async () => {
    const { calls, client } = recorder({ ok: true })
    await client.compactOrchestrator()
    await client.compactOrchestrator({ id: 'frontend', keep: 'Keep all tests' })
    await client.setOrchestratorModel({ id: 'frontend', model: 'claude-haiku-5-5' })
    expect(calls).toEqual([
      {
        url: 'http://127.0.0.1:9/api/orchestrator/compact',
        method: 'POST',
        body: JSON.stringify({ confirmed: true }),
      },
      {
        url: 'http://127.0.0.1:9/api/orchestrator/compact',
        method: 'POST',
        body: JSON.stringify({ confirmed: true, id: 'frontend', keep: 'Keep all tests' }),
      },
      {
        url: 'http://127.0.0.1:9/api/orchestrator/model',
        method: 'POST',
        body: JSON.stringify({ model: 'claude-haiku-5-5', confirmed: true, id: 'frontend' }),
      },
    ])
  })

  it('writes the whole ladder as the owner', async () => {
    const { calls, client } = recorder({ ladder: { subs: [] } })
    await client.setLadder({ subs: [] })
    expect(calls).toEqual([
      {
        url: 'http://127.0.0.1:9/api/orchestrator/ladder',
        method: 'POST',
        body: JSON.stringify({ ladder: { subs: [] }, by: 'owner', confirmed: true }),
      },
    ])
  })

  it('keeps the problems the bridge answers on the error', async () => {
    const client = createClient({
      fetchImpl: async () => ({
        ok: false,
        json: async () => ({ error: 'The ladder has problems.', problems: ['Sub "x" has no scope.', 4] }),
      }),
    })
    const failure = await client.setLadder({ subs: [] }).catch((error) => error)
    expect(failure.message).toBe('The ladder has problems.')
    expect(failure.problems).toEqual(['Sub "x" has no scope.'])
  })

  it('reads the lanes list and writes active lanes with confirmation', async () => {
    const { calls, client } = recorder({ lanes: [], max: 0, chosen: false })
    await client.lanes()
    await client.setActiveLanes({ lanes: ['opencode'], confirmed: true })
    expect(calls).toEqual([
      { url: 'http://127.0.0.1:9/api/lanes', method: 'GET', body: undefined },
      {
        url: 'http://127.0.0.1:9/api/lanes/active',
        method: 'POST',
        body: JSON.stringify({ lanes: ['opencode'], confirmed: true }),
      },
    ])
  })
})
