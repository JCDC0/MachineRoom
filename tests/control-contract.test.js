import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
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
  "if (args[0] === '--stop') { console.log('stopped: ' + args[1] + ' (PID 4242)'); process.exit(0) }",
  "console.log('args ' + args.join(' '))",
  "for (let i = 1; i <= 7; i += 1) console.log('line ' + i)",
  'await new Promise((done) => setTimeout(done, 300))',
  "const folder = join(process.env.TEMP || tmpdir(), 'machineroom-runs')",
  "mkdirSync(folder, { recursive: true })",
  "const record = { lane: args[0], briefs: args.slice(1), model: null, reasoning: null, startedAt: new Date().toISOString(), minutes: 0, exitCode: 0, killed: false, costUsd: 0.2, log: null, branch: '', commits: [] }",
  "appendFileSync(join(folder, 'runs.jsonl'), JSON.stringify(record) + '\\n')",
].join('\n')

const SLOW_RUNNER = TINY_RUNNER.replace('setTimeout(done, 300)', 'setTimeout(done, 4000)')

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
  const previousRuns = process.env.MACHINEROOM_RUNS
  process.env.TEMP = dir
  process.env.MACHINEROOM_RUNS = join(dir, 'machineroom-runs')
  cleanups.push(() => {
    process.env.TEMP = previous
    if (previousRuns === undefined) delete process.env.MACHINEROOM_RUNS
    else process.env.MACHINEROOM_RUNS = previousRuns
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

async function makeHarness({ records = [], runnerCode = TINY_RUNNER } = {}) {
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
  writeFileSync(runnerPath, runnerCode)
  useTemp(base)
  const previousLanesDir = process.env.MACHINEROOM_LANES_DIR
  process.env.MACHINEROOM_LANES_DIR = join(shared.repo, 'docs', 'agents')
  cleanups.push(() => {
    if (previousLanesDir === undefined) delete process.env.MACHINEROOM_LANES_DIR
    else process.env.MACHINEROOM_LANES_DIR = previousLanesDir
  })
  const lanes = JSON.parse(readFileSync(join(shared.repo, 'docs', 'agents', 'lanes.json'), 'utf8'))
  writeActiveLanes(activeLanesFileFor(RUN_ROOM, runs), Object.keys(lanes).filter((k) => k !== 'orchestrator'))
  const bridge = createBridge({
    projectRoot: RUN_ROOM,
    briefsDir: join(shared.repo, 'docs', 'agents'),
    port: 0,
    runnerCommand: { file: process.execPath, args: [runnerPath] },
    lanesSource: { folder: runs, lanes, repoRoot: RUN_ROOM, pollMs: 20, quietMs: 60000 },
    env: {},
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
    expect(agents.map((agent) => agent.model)).toEqual(['opencode-go/deepseek-v4.1-flash', 'sonnet'])
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

  it('refuses comment writes', async () => {
    const { client } = await makeHarness()
    await expect(client.postComment('opencode-B6-20261024-120000', 'Hello.')).rejects.toThrow(LANE_TASK_REFUSAL)
  })

  it('answers an empty thread and no approvals', async () => {
    const { client } = await makeHarness()
    expect(await client.comments('opencode-B6-20261024-120000')).toEqual([])
    expect(await client.approvals()).toEqual([])
    await expect(client.decideApproval('approval-1', 'approve')).rejects.toThrow('That approval no longer exists.')
  })

  it('refuses agent budget writes', async () => {
    const { client } = await makeHarness()
    await expect(client.setAgentBudget('agent-opencode', 250)).rejects.toThrow(AGENT_REFUSAL)
  })

  it('reports costs from the lane records with no quota window', async () => {
    const { client } = await makeHarness({ records: [record('opencode', ['B6']), record('opencode', ['U4'])] })
    const { summary, byAgent, quota } = await client.costs()
    expect(summary).toEqual({ spendCents: 100, budgetCents: 0, utilizationPercent: null })
    expect(byAgent).toEqual([
      { agentId: 'agent-opencode', agentName: 'OpenCode', costCents: 100, todayCents: 100, inputTokens: null, outputTokens: null },
      { agentId: 'agent-claude', agentName: 'Claude Code', costCents: 0, todayCents: 0, inputTokens: null, outputTokens: null },
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

  it('stops a running run by exact start time and refuses a mismatch on bridge and mock', async () => {
    const { client } = await makeHarness({ runnerCode: SLOW_RUNNER })
    const entry = await client.startRun('opencode', ['B6'])
    await expect(
      client.stopRun({ lane: 'opencode', startedAt: '2020-01-01T00:00:00.000Z', confirmed: true })
    ).rejects.toThrow('That start time does not match the running run.')
    await expect(
      client.stopRun({ lane: 'opencode', startedAt: entry.startedAt, confirmed: false })
    ).rejects.toThrow('Confirm the stop first.')

    const stopped = await client.stopRun({ lane: 'opencode', startedAt: entry.startedAt, confirmed: true })
    expect(stopped).toEqual({
      ok: true,
      lane: 'opencode',
      startedAt: entry.startedAt,
      output: 'stopped: opencode (PID 4242)',
    })
    const state = await client.runs()
    expect(state.running).toEqual([])
    expect(state.recent.find((item) => item.lane === 'opencode' && item.startedAt === entry.startedAt)).toMatchObject({
      lane: 'opencode',
      killed: true,
      note: 'stopped by the owner',
    })
    await expect(client.stopRun({ lane: 'opencode', startedAt: entry.startedAt, confirmed: true })).rejects.toThrow(
      'No run is running on opencode.'
    )

    const mock = createMockClient({ latencyMs: 0, runMs: 500 })
    const mockSubRun = await mock.startRun('opencode2', { task: 'Fix stop dialog.' })
    await expect(
      mock.stopRun({ lane: 'opencode2', startedAt: '2020-01-01T00:00:00.000Z', confirmed: true })
    ).rejects.toThrow('That start time does not match the running run.')
    const mockStopped = await mock.stopRun({ lane: 'opencode2', startedAt: mockSubRun.startedAt, confirmed: true })
    expect(mockStopped).toMatchObject({ ok: true, lane: 'opencode2', startedAt: mockSubRun.startedAt })
    const mockRuns = await mock.runs()
    expect(mockRuns.running).toEqual([])
    expect(mockRuns.recent[0]).toMatchObject({ lane: 'opencode2', killed: true, note: 'stopped by the owner' })
    const frontendChat = await mock.orchestrator('frontend')
    expect(frontendChat.messages.at(-1)).toMatchObject({
      from: 'room',
      text: expect.stringMatching(/^The owner stopped opencode2's run on Fix stop dialog\. at .+\.$/),
    })

    const mockMainRun = await mock.startRun('opencode', ['B6'])
    await mock.stopRun({ lane: 'opencode', startedAt: mockMainRun.startedAt, confirmed: true })
    const mainChat = await mock.orchestrator('orchestrator')
    expect(mainChat.messages.at(-1)).toMatchObject({
      from: 'room',
      text: expect.stringMatching(/^The owner stopped opencode's run on B6 at .+\.$/),
    })
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

    const plainText = await fetch(`${url}/api/control/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    })
    expect(plainText.status).toBe(415)
    expect(await plainText.json()).toEqual({ error: 'Send JSON.' })

    const huge = await fetch(`${url}/api/control/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'x'.repeat(70000) }),
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
    expect((await client.orchestrator()).autocompactMode).toBe('percent')
    expect((await client.orchestrator()).autocompactValue).toBe(80)
    expect((await client.orchestrator()).compactRules).toBe('')
    await client.setAutocompact('orchestrator', false)
    expect((await client.orchestrator()).autocompact).toBe(false)
    expect((await client.orchestrators()).find((entry) => entry.id === 'orchestrator').autocompact).toBe(false)
    await client.setAutocompact('frontend', false)
    expect((await client.orchestrators()).find((entry) => entry.id === 'frontend').autocompact).toBe(false)
    expect((await client.orchestrator('frontend')).autocompact).toBe(false)
    await client.setAutocompact('orchestrator', true, 75)
    expect((await client.orchestrator()).autocompact).toBe(true)
    expect((await client.orchestrator()).autocompactPercent).toBe(75)
    expect((await client.orchestrator()).autocompactValue).toBe(75)
    await client.setAutocompact('orchestrator', { on: true, mode: 'tokens', value: 50000, rules: 'Keep decisions.' })
    expect((await client.orchestrator()).autocompactMode).toBe('tokens')
    expect((await client.orchestrator()).autocompactValue).toBe(50000)
    expect((await client.orchestrator()).compactRules).toBe('Keep decisions.')
    await expect(client.setAutocompact('orchestrator', 'yes')).rejects.toThrow('Say whether autocompact is on or off.')
    await expect(client.setAutocompact('orchestrator', true, 0)).rejects.toThrow('Percent must be a number above 0 and at most 100.')
    await expect(client.setAutocompact('orchestrator', true, 105)).rejects.toThrow('Percent must be a number above 0 and at most 100.')
    await expect(client.setAutocompact('orchestrator', { mode: 'tokens', value: 999 })).rejects.toThrow(
      'Tokens must be a whole number from 1000 to 10000000.'
    )
    await expect(client.setAutocompact('orchestrator', { mode: 'tokens', value: 10000001 })).rejects.toThrow(
      'Tokens must be a whole number from 1000 to 10000000.'
    )
    await expect(client.setAutocompact('orchestrator', { mode: 'invalid' })).rejects.toThrow('Mode must be percent or tokens.')
    await expect(client.setAutocompact('orchestrator', { rules: 'x'.repeat(2001) })).rejects.toThrow(
      'Compact rules must be at most 2000 characters.'
    )
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

  it('manages reasoning effort and sessions on the mock', async () => {
    const client = createMockClient({ latencyMs: 0 })
    expect((await client.orchestrator()).effort).toBeNull()

    await client.setOrchestratorEffort({ id: 'orchestrator', effort: 'high' })
    expect((await client.orchestrator()).effort).toBe('high')
    expect((await client.orchestrators())[0].effort).toBe('high')

    await expect(client.setOrchestratorEffort({ id: 'orchestrator', effort: 'invalid' })).rejects.toThrow(
      'Choose an effort level listed for this harness.'
    )

    await client.setOrchestratorEffort({ id: 'orchestrator', effort: null })
    expect((await client.orchestrator()).effort).toBeNull()

    const sessions = await client.orchestratorSessions({ id: 'orchestrator' })
    expect(sessions.current.sessionId).toEqual(expect.any(String))
    expect(sessions.current.sessionId.length).toBeGreaterThan(0)
    expect(sessions.current.count).toBe(3)
    expect(sessions.sessions).toHaveLength(2)
    expect(sessions.sessions[0].pinned).toBe(true)

    await client.sendOrchestrator('Keep current conversation id', { id: 'orchestrator' })
    const afterSend = await client.orchestratorSessions({ id: 'orchestrator' })
    expect(afterSend.current.sessionId).toBe(sessions.current.sessionId)

    const session1 = await client.orchestratorSession({ id: 'orchestrator', session: sessions.sessions[0].id })
    expect(session1.id).toBe(sessions.sessions[0].id)
    expect(session1.messages).toHaveLength(2)

    await client.updateOrchestratorSession({
      id: 'orchestrator',
      session: sessions.sessions[0].id,
      title: 'Updated title',
      pinned: false,
    })
    const reloaded = await client.orchestratorSession({ id: 'orchestrator', session: sessions.sessions[0].id })
    expect(reloaded.title).toBe('Updated title')

    await client.updateOrchestratorSession({
      id: 'orchestrator',
      session: sessions.sessions[0].id,
      unread: true,
      archived: true,
    })
    const flagged = await client.orchestratorSessions({ id: 'orchestrator' })
    expect(flagged.sessions[0]).toMatchObject({ unread: true, archived: true })

    await client.newOrchestratorSession({ id: 'orchestrator' })
    const afterNew = await client.orchestratorSessions({ id: 'orchestrator' })
    expect(afterNew.current.count).toBe(0)
    expect(afterNew.current.sessionId).toEqual(expect.any(String))
    expect(afterNew.current.sessionId).not.toBe(sessions.current.sessionId)

    await client.openOrchestratorSession({ id: 'orchestrator', session: sessions.sessions[0].id })
    const afterOpen = await client.orchestratorSessions({ id: 'orchestrator' })
    expect(afterOpen.current.count).toBe(2)
    expect(afterOpen.current.sessionId).toEqual(expect.any(String))
    expect(afterOpen.current.sessionId).not.toBe(afterNew.current.sessionId)

    await expect(
      client.deleteOrchestratorSession({ id: 'orchestrator', session: sessions.sessions[0].id })
    ).rejects.toThrow('The current conversation cannot be archived or deleted.')

    await client.newOrchestratorSession({ id: 'orchestrator' })
    await client.deleteOrchestratorSession({ id: 'orchestrator', session: sessions.sessions[0].id })
    const afterDelete = await client.orchestratorSessions({ id: 'orchestrator' })
    expect(afterDelete.sessions.some((s) => s.id === sessions.sessions[0].id)).toBe(false)
  })

  it('branches the current conversation on the mock', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const before = await client.orchestrator()
    const beforeSessions = await client.orchestratorSessions({ id: 'orchestrator' })
    expect(before.messages).toHaveLength(3)
    await expect(client.branchOrchestratorSession({ id: 'orchestrator', index: 0 })).rejects.toThrow(
      'Choose a message to branch from.'
    )
    const branched = await client.branchOrchestratorSession({ id: 'orchestrator', index: 2 })
    expect(branched).toMatchObject({ ok: true, title: 'What is running? (branch)', count: 2 })
    expect((await client.orchestrator()).messages).toHaveLength(2)
    const after = await client.orchestratorSessions({ id: 'orchestrator' })
    expect(after.current.sessionId).toEqual(expect.any(String))
    expect(after.current.sessionId.length).toBeGreaterThan(0)
    expect(after.current.sessionId).not.toBe(beforeSessions.current.sessionId)
    expect(after.current.title).toBe('What is running? (branch)')
    expect(after.current.count).toBe(2)
    expect(after.sessions).toHaveLength(3)
    expect(after.sessions.find((session) => session.title === 'What is running?').count).toBe(3)
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

  it('sends /api/control/runs/stop with lane, startedAt and confirmed', async () => {
    const { calls, client } = recorder({ ok: true })
    await client.stopRun({ lane: 'opencode', startedAt: '2026-10-24T12:00:00.000Z' })
    await client.stopRun('opencode2', '2026-10-24T12:05:00.000Z', { confirmed: false })
    expect(calls.map((call) => [call.method, call.url, JSON.parse(call.body ?? 'null')])).toEqual([
      [
        'POST',
        'http://127.0.0.1:9/api/control/runs/stop',
        { lane: 'opencode', startedAt: '2026-10-24T12:00:00.000Z', confirmed: true },
      ],
      [
        'POST',
        'http://127.0.0.1:9/api/control/runs/stop',
        { lane: 'opencode2', startedAt: '2026-10-24T12:05:00.000Z', confirmed: false },
      ],
    ])
  })

  it('sets autocompact at the named orchestrator', async () => {
    const { calls, client } = recorder({ id: 'frontend', autocompact: false, autocompactPercent: 75 })
    await client.setAutocompact('frontend', false)
    await client.setAutocompact(undefined, true, 75)
    await client.setAutocompact({ id: 'frontend', on: true, mode: 'tokens', value: 20000, rules: 'Keep tests' })
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
      {
        url: 'http://127.0.0.1:9/api/orchestrator/autocompact',
        method: 'POST',
        body: JSON.stringify({ id: 'frontend', on: true, mode: 'tokens', value: 20000, rules: 'Keep tests', confirmed: true }),
      },
    ])
  })

  it('compacts and sets model at the named orchestrator', async () => {
    const { calls, client } = recorder({ ok: true })
    await client.compactOrchestrator()
    await client.compactOrchestrator({ id: 'frontend', keep: 'Keep all tests' })
    await client.setOrchestratorModel({ id: 'frontend', model: 'claude-haiku-5-5' })
    await client.setOrchestratorHarness({ id: 'frontend', harness: 'opencode', model: 'opencode-go/qwen3.8-flash' })
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
      {
        url: 'http://127.0.0.1:9/api/orchestrator/harness',
        method: 'POST',
        body: JSON.stringify({ harness: 'opencode', model: 'opencode-go/qwen3.8-flash', confirmed: true, id: 'frontend' }),
      },
    ])
  })

  it('calls reasoning effort and session routes with correct URLs and bodies', async () => {
    const { calls, client } = recorder({ ok: true, current: {}, sessions: [], messages: [] })
    await client.setOrchestratorEffort({ id: 'frontend', effort: 'max' })
    await client.orchestratorSessions()
    await client.orchestratorSessions({ id: 'frontend' })
    await client.orchestratorSession({ id: 'frontend', session: 'sess-1' })
    await client.newOrchestratorSession({ id: 'frontend' })
    await client.branchOrchestratorSession({ id: 'frontend', index: 3 })
    await client.updateOrchestratorSession({
      id: 'frontend',
      session: 'sess-1',
      title: 'New title',
      pinned: true,
      unread: true,
      archived: false,
    })
    await client.openOrchestratorSession({ id: 'frontend', session: 'sess-1' })
    await client.deleteOrchestratorSession({ id: 'frontend', session: 'sess-1' })

    expect(calls).toEqual([
      {
        url: 'http://127.0.0.1:9/api/orchestrator/effort',
        method: 'POST',
        body: JSON.stringify({ effort: 'max', confirmed: true, id: 'frontend' }),
      },
      {
        url: 'http://127.0.0.1:9/api/orchestrator/sessions',
        method: 'GET',
        body: undefined,
      },
      {
        url: 'http://127.0.0.1:9/api/orchestrator/sessions?id=frontend',
        method: 'GET',
        body: undefined,
      },
      {
        url: 'http://127.0.0.1:9/api/orchestrator/sessions/sess-1?id=frontend',
        method: 'GET',
        body: undefined,
      },
      {
        url: 'http://127.0.0.1:9/api/orchestrator/sessions/new',
        method: 'POST',
        body: JSON.stringify({ confirmed: true, id: 'frontend' }),
      },
      {
        url: 'http://127.0.0.1:9/api/orchestrator/sessions/branch',
        method: 'POST',
        body: JSON.stringify({ index: 3, confirmed: true, id: 'frontend' }),
      },
      {
        url: 'http://127.0.0.1:9/api/orchestrator/sessions/sess-1?id=frontend',
        method: 'POST',
        body: JSON.stringify({ confirmed: true, pinned: true, unread: true, archived: false, title: 'New title', id: 'frontend' }),
      },
      {
        url: 'http://127.0.0.1:9/api/orchestrator/sessions/sess-1/open?id=frontend',
        method: 'POST',
        body: JSON.stringify({ confirmed: true, id: 'frontend' }),
      },
      {
        url: 'http://127.0.0.1:9/api/orchestrator/sessions/sess-1/delete?id=frontend',
        method: 'POST',
        body: JSON.stringify({ confirmed: true, id: 'frontend' }),
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

  it('reads projects and opens a project', async () => {
    const { calls, client } = recorder({ ok: true, restarting: true, path: '/tmp/project' })
    await client.projects()
    await client.openProject({ path: '/tmp/project' })
    expect(calls).toEqual([
      { url: 'http://127.0.0.1:9/api/projects', method: 'GET', body: undefined },
      {
        url: 'http://127.0.0.1:9/api/projects/open',
        method: 'POST',
        body: JSON.stringify({ path: '/tmp/project', confirmed: true }),
      },
    ])
  })

  it('reads mock projects and opens a project on the mock', async () => {
    const mock = createMockClient({ latencyMs: 0 })
    const projects = await mock.projects()
    expect(projects.current).toMatchObject({ name: 'machineroom', git: true })
    expect(projects.recent).toHaveLength(2)
    expect(projects.folders).toHaveLength(3)
    const opened = await mock.openProject({ path: '/mock/projects/alpha' })
    expect(opened).toEqual({ ok: true, restarting: true, path: '/mock/projects/alpha' })
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

describe('the control client lane route', () => {
  const MEDIUM_TASK = 'Fix it. Files: `a.js`, `b.js`, `c.js`, `tests/a.test.js`.'

  function recorder(answer = { lane: 'opencode' }) {
    const calls = []
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, method: options.method, body: options.body })
      return { ok: true, json: async () => answer }
    }
    return { calls, client: createClient({ baseUrl: 'http://127.0.0.1:9', fetchImpl }) }
  }

  it('sends a brief, a task and failures to the lane route', async () => {
    const { calls, client } = recorder()
    await client.routeLane({ task: 'Fix it.' })
    await client.routeLane({ brief: 'B6', failures: 1 })
    await client.routeLane()
    expect(calls).toEqual([
      {
        url: 'http://127.0.0.1:9/api/control/route/lane',
        method: 'POST',
        body: JSON.stringify({ task: 'Fix it.' }),
      },
      {
        url: 'http://127.0.0.1:9/api/control/route/lane',
        method: 'POST',
        body: JSON.stringify({ brief: 'B6', failures: 1 }),
      },
      { url: 'http://127.0.0.1:9/api/control/route/lane', method: 'POST', body: '{}' },
    ])
  })

  it('answers a lane from the mock policy and refuses an empty name', async () => {
    const mock = createMockClient({ latencyMs: 0 })
    const answer = await mock.routeLane({ task: MEDIUM_TASK })
    expect(answer).toMatchObject({ lane: 'opencode', tier: 'medium', model: 'opencode-go/deepseek-v4.1-flash', reasoning: 'max' })
    expect(answer.reason).toBe('The medium tier runs opencode on opencode-go/deepseek-v4.1-flash at max.')
    await expect(mock.routeLane()).rejects.toThrow('Name a brief or a task.')
    await expect(mock.routeLane({ brief: 'B6', task: 'Fix it.' })).rejects.toThrow('Send a brief or a task, not both.')
    await expect(mock.routeLane({ brief: 'ZZ9' })).rejects.toThrow('Choose a brief from the list.')
  })
})

describe('the control client MCP routes', () => {
  function recorder(answer = {}) {
    const calls = []
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, method: options.method, body: options.body })
      return { ok: true, json: async () => answer }
    }
    return { calls, client: createClient({ baseUrl: 'http://127.0.0.1:9', fetchImpl }) }
  }

  it('reads servers and tools and writes servers on the bridge routes', async () => {
    const { calls, client } = recorder({ ok: true, servers: [], tools: [], errors: [] })
    await client.mcpServers()
    await client.saveMcpServer({
      name: 'docs two',
      transport: 'http',
      url: 'http://127.0.0.1:8787/mcp',
      confirmed: true,
    })
    await client.deleteMcpServer({ name: 'docs two', confirmed: true })
    await client.mcpTools()
    await client.callMcpTool({ server: 'docs', tool: 'search_docs', arguments: { query: 'room' } })
    expect(calls).toEqual([
      { url: 'http://127.0.0.1:9/api/mcp/servers', method: 'GET', body: undefined },
      {
        url: 'http://127.0.0.1:9/api/mcp/servers',
        method: 'POST',
        body: JSON.stringify({
          name: 'docs two',
          transport: 'http',
          command: '',
          args: [],
          url: 'http://127.0.0.1:8787/mcp',
          enabled: true,
          confirmed: true,
        }),
      },
      {
        url: 'http://127.0.0.1:9/api/mcp/servers/docs%20two/delete',
        method: 'POST',
        body: JSON.stringify({ confirmed: true }),
      },
      { url: 'http://127.0.0.1:9/api/mcp/tools', method: 'GET', body: undefined },
      {
        url: 'http://127.0.0.1:9/api/mcp/call',
        method: 'POST',
        body: JSON.stringify({ server: 'docs', tool: 'search_docs', arguments: { query: 'room' }, confirmed: false }),
      },
    ])
  })

  it('fills the stdio defaults and leaves the confirm off when it is not sent', async () => {
    const { calls, client } = recorder()
    await client.saveMcpServer({ name: 'notes', command: 'node' })
    await client.deleteMcpServer({ name: 'notes' })
    expect(calls).toEqual([
      {
        url: 'http://127.0.0.1:9/api/mcp/servers',
        method: 'POST',
        body: JSON.stringify({
          name: 'notes',
          transport: 'stdio',
          command: 'node',
          args: [],
          url: '',
          enabled: true,
          confirmed: false,
        }),
      },
      {
        url: 'http://127.0.0.1:9/api/mcp/servers/notes/delete',
        method: 'POST',
        body: JSON.stringify({ confirmed: false }),
      },
    ])
  })

  it('passes create: true on saveMcpServer only when given', async () => {
    const { calls, client } = recorder({ ok: true })
    await client.saveMcpServer({
      name: 'notes',
      transport: 'stdio',
      command: 'node',
      confirmed: true,
      create: true,
    })
    await client.saveMcpServer({
      name: 'notes',
      transport: 'stdio',
      command: 'node',
      enabled: false,
      confirmed: true,
      create: false,
    })
    expect(calls.map((call) => JSON.parse(call.body))).toEqual([
      {
        name: 'notes',
        transport: 'stdio',
        command: 'node',
        args: [],
        url: '',
        enabled: true,
        confirmed: true,
        create: true,
      },
      {
        name: 'notes',
        transport: 'stdio',
        command: 'node',
        args: [],
        url: '',
        enabled: false,
        confirmed: true,
      },
    ])
  })

  it('saves, lists and deletes MCP servers on the mock with an mcp notice', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const notices = []
    const stop = client.subscribe((event) => notices.push(event))
    const initial = await client.mcpServers()
    expect(initial.ok).toBe(true)
    expect(initial.servers.map((entry) => entry.name)).toEqual(['filesystem', 'docs'])

    const saved = await client.saveMcpServer({ name: 'notes', command: 'node', args: ['notes.mjs'], confirmed: true })
    expect(saved.server).toEqual({
      name: 'notes',
      transport: 'stdio',
      command: 'node',
      args: ['notes.mjs'],
      env: {},
      url: '',
      enabled: true,
    })
    expect((await client.mcpServers()).servers.map((entry) => entry.name)).toEqual(['filesystem', 'docs', 'notes'])

    const off = await client.saveMcpServer({ name: 'docs', enabled: false, confirmed: true })
    expect(off.server).toMatchObject({ name: 'docs', transport: 'http', url: 'http://127.0.0.1:8787/mcp', enabled: false })
    expect((await client.mcpTools()).tools.map((tool) => tool.server)).toEqual(['filesystem', 'filesystem'])

    const deleted = await client.deleteMcpServer({ name: 'notes', confirmed: true })
    expect(deleted).toMatchObject({ ok: true, deleted: 'notes' })
    expect(deleted.servers.map((entry) => entry.name)).toEqual(['filesystem', 'docs'])
    expect(notices).toEqual([{ topic: 'mcp' }, { topic: 'mcp' }, { topic: 'mcp' }])
    stop()
  })

  it('lists the sample tools and runs one on the mock', async () => {
    const client = createMockClient({ latencyMs: 0 })
    const listed = await client.mcpTools()
    expect(listed.ok).toBe(true)
    expect(listed.errors).toEqual([])
    expect(listed.tools).toEqual([
      { server: 'filesystem', name: 'read_file', description: expect.any(String), inputSchema: expect.any(Object) },
      { server: 'filesystem', name: 'list_directory', description: expect.any(String), inputSchema: expect.any(Object) },
      { server: 'docs', name: 'search_docs', description: expect.any(String), inputSchema: expect.any(Object) },
    ])

    const answer = await client.callMcpTool({ server: 'filesystem', tool: 'read_file', arguments: { path: 'README.md' } })
    expect(answer.ok).toBe(true)
    expect(answer.problem).toBeNull()
    expect(answer.result.content[0].text).toBe('read_file on filesystem ran with 1 arguments.')

    expect(await client.callMcpTool({ server: 'nobody', tool: 'read_file' })).toEqual({
      ok: false,
      result: null,
      problem: 'The MCP server nobody is not saved.',
    })
    expect(await client.callMcpTool({ server: 'docs', tool: 'read_file' })).toEqual({
      ok: false,
      result: null,
      problem: 'The server docs has no tool read_file.',
    })
  })

  it('refuses an MCP write or call in plain words on the mock', async () => {
    const client = createMockClient({ latencyMs: 0 })
    await expect(client.saveMcpServer({ name: 'notes', command: 'node' })).rejects.toThrow(
      'Confirm saving the MCP server first.'
    )
    await expect(client.deleteMcpServer({ name: 'docs' })).rejects.toThrow('Confirm deleting the MCP server first.')
    await expect(client.deleteMcpServer({ name: 'nobody', confirmed: true })).rejects.toThrow(
      'The MCP server was not found.'
    )
    await expect(client.saveMcpServer({ name: 'bad name!', command: 'node', confirmed: true })).rejects.toThrow(
      'The server name must be 1 to 40 letters, digits, dashes or underscores.'
    )
    await expect(client.saveMcpServer({ name: 'notes', transport: 'nope', command: 'node', confirmed: true })).rejects.toThrow(
      'Choose stdio or http.'
    )
    await expect(client.saveMcpServer({ name: 'notes', confirmed: true })).rejects.toThrow('A stdio server needs a command.')
    await expect(
      client.saveMcpServer({ name: 'notes', transport: 'http', url: 'ftp://127.0.0.1/mcp', confirmed: true })
    ).rejects.toThrow('An http server needs an http or https address.')
    await expect(
      client.saveMcpServer({ name: 'docs', transport: 'stdio', command: 'node', confirmed: true, create: true })
    ).rejects.toThrow('The MCP server docs is already saved.')
    await expect(client.callMcpTool({ server: 'filesystem' })).rejects.toThrow('Choose an MCP server and a tool.')
  })

  it('refuses an already saved MCP server with create: true and keeps updates working on both clients', async () => {
    const mock = createMockClient({ latencyMs: 0 })
    const { client: bridgeClient } = await makeHarness()
    for (const [label, client] of [
      ['mock', mock],
      ['bridge', bridgeClient],
    ]) {
      await client.saveMcpServer({
        name: 'notes',
        transport: 'stdio',
        command: 'node',
        args: ['notes.mjs'],
        enabled: false,
        confirmed: true,
        create: true,
      })
      const notices = []
      const stop = client.subscribe((event) => notices.push(event))
      await expect(
        client.saveMcpServer({
          name: 'notes',
          transport: 'http',
          url: 'https://other.example/mcp',
          enabled: true,
          confirmed: true,
          create: true,
        }),
        `${label} create refusal`
      ).rejects.toThrow('The MCP server notes is already saved.')
      if (label === 'mock') expect(notices).toEqual([])
      stop()

      const list = (await client.mcpServers()).servers
      const saved = list.find((entry) => entry.name === 'notes')
      expect(saved, `${label} saved entry`).toMatchObject({
        name: 'notes',
        transport: 'stdio',
        command: 'node',
        args: ['notes.mjs'],
        enabled: false,
      })

      const toggled = await client.saveMcpServer({
        name: 'notes',
        transport: 'stdio',
        command: 'node',
        args: ['notes.mjs'],
        enabled: true,
        confirmed: true,
      })
      expect(toggled.server.enabled, `${label} toggle`).toBe(true)
    }
  })
})

describe('the control client review routes', () => {
  function recorder(answer = { lanes: [], ok: true }) {
    const calls = []
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, method: options.method, body: options.body })
      return { ok: true, json: async () => answer }
    }
    return { calls, client: createClient({ baseUrl: 'http://127.0.0.1:9', fetchImpl }) }
  }

  it('sends destination branch and head with or without a message by strategy', async () => {
    const { calls, client } = recorder()
    const head = 'a'.repeat(40)
    const baseHead = 'b'.repeat(40)
    await client.reviews()
    await client.mergeReview('opencode', { head, base: 'trunk', baseHead })
    await client.mergeReview('hermes', { head, base: 'main', baseHead, message: 'Merge it' })
    expect(calls).toEqual([
      { url: 'http://127.0.0.1:9/api/control/reviews', method: 'GET', body: undefined },
      {
        url: 'http://127.0.0.1:9/api/control/reviews/opencode/merge',
        method: 'POST',
        body: JSON.stringify({ confirmed: true, head, base: 'trunk', baseHead }),
      },
      {
        url: 'http://127.0.0.1:9/api/control/reviews/hermes/merge',
        method: 'POST',
        body: JSON.stringify({ confirmed: true, head, base: 'main', baseHead, message: 'Merge it' }),
      },
    ])
  })

  it('matches the review base, baseHead and strategy fields between bridge and mock', async () => {
    const bridge = createBridge({
      projectRoot: shared.repo,
      briefsDir: join(shared.repo, 'docs', 'agents'),
      port: 0,
      env: {},
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    const bridgeClient = createClient({
      baseUrl: url,
      fetchImpl: (input, init = {}) =>
        fetch(input, {
          ...init,
          headers: { ...init?.headers, Origin: 'http://localhost:5173' },
        }),
    })
    const expectedHead = testGit(shared.repo, ['rev-parse', 'refs/heads/main']).trim()
    const liveReviews = await bridgeClient.reviews()
    const liveRow = liveReviews.find((entry) => entry.lane === 'opencode')
    expect(liveRow).toMatchObject({
      lane: 'opencode',
      base: 'main',
      baseHead: expectedHead,
      strategy: 'merge-commit',
      checks: 'unchecked',
    })

    const mock = createMockClient({ latencyMs: 0 })
    const gitState = await mock.gitState()
    const mockReviews = await mock.reviews()
    const hermes = mockReviews.find((entry) => entry.lane === 'hermes')
    const opencode = mockReviews.find((entry) => entry.lane === 'opencode')
    const agy = mockReviews.find((entry) => entry.lane === 'agy')
    expect(hermes).toMatchObject({
      lane: 'hermes',
      base: 'main',
      baseHead: gitState.head,
      strategy: 'merge-commit',
      checks: 'passed',
    })
    expect(opencode?.checks).toBe('unchecked')
    expect(agy?.checks).toBe('failed')

    await expect(
      mock.mergeReview('hermes', { head: hermes.head, base: hermes.base, baseHead: '0'.repeat(40), message: 'Merge it' })
    ).rejects.toThrow('The main branch moved since you read it, so refresh reviews first.')

    await mock.switchBranch({ branch: 'feat/preview', confirmed: true })
    await expect(
      mock.mergeReview('hermes', { head: hermes.head, base: hermes.base, baseHead: hermes.baseHead, message: 'Merge it' })
    ).rejects.toThrow('The main checkout is not on main.')

    await mock.switchBranch({ branch: 'main', confirmed: true })
    const merged = await mock.mergeReview('hermes', {
      head: hermes.head,
      base: hermes.base,
      baseHead: hermes.baseHead,
      message: 'Merge it',
    })
    expect(merged).toMatchObject({ ok: true, lane: 'hermes', head: hermes.head })

    await expect(
      mock.mergeReview('agy', { head: agy.head, base: agy.base, baseHead: agy.baseHead, message: 'Merge it' })
    ).rejects.toThrow('The main branch moved since you read it, so refresh reviews first.')

    const refreshed = await mock.reviews()
    const agyFresh = refreshed.find((entry) => entry.lane === 'agy')
    await expect(
      mock.mergeReview('agy', {
        head: agyFresh.head,
        base: agyFresh.base,
        baseHead: agyFresh.baseHead,
        message: 'Merge it',
      })
    ).rejects.toThrow('Checks failed on this head, so the lane was not merged.')
    expect((await mock.gitState()).head).toBe(merged.commit)
  })
})
