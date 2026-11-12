import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONFIRM_CREATE_PROBLEM,
  HARNESS_EFFORTS,
  HARNESS_KEYS,
  LANES_JSON_DELETE_PROBLEM,
  LANES_JSON_UPDATE_PROBLEM,
  NAME_LENGTH_PROBLEM,
  ORIGIN_CREATE_PROBLEM,
  buildMadeLane,
  codexAppProgram,
  createAgentsConfigApi,
  effortUnavailableProblem,
  isHarnessAvailable,
  laneRunningProblem,
  listHarnesses,
  nextFreeKey,
  readAgentsConfig,
  readAllLanes,
  saveAgentsConfig,
} from '../server/agents-config.js'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, projectLanesFileFor, readActiveLanesChoice, readHiddenLanes, writeActiveLanes } from '../server/active-lanes.js'
import { gitPath } from '../server/programPath.js'
import { createClient } from '../src/control/client.js'
import { createMockClient } from '../src/control/mock.js'
import { waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix = 'mr-cfg-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {}
  })
  return dir
}

function gitProject(prefix = 'mr-git-') {
  const dir = tempDir(prefix)
  execFileSync(gitPath(), ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync(gitPath(), ['config', 'user.email', 'test@example.invalid'], { cwd: dir, stdio: 'ignore' })
  execFileSync(gitPath(), ['config', 'user.name', 'test'], { cwd: dir, stdio: 'ignore' })
  writeFileSync(join(dir, 'README.md'), '# Test\n')
  mkdirSync(join(dir, 'docs', 'agents'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'agents', 'lanes.json'), JSON.stringify(SAMPLE_LANES, null, 2))
  writeFileSync(join(dir, 'docs', 'agents', 'TASKS.md'), '## Open work\n\n**T1. Task (Claude Code).** Brief.\n')
  execFileSync(gitPath(), ['add', '.'], { cwd: dir, stdio: 'ignore' })
  execFileSync(gitPath(), ['commit', '-m', 'Initial commit'], { cwd: dir, stdio: 'ignore' })
  return dir
}

const SAMPLE_LANES = {
  orchestrator: {
    name: 'Orchestrator',
    harness: 'Claude Code',
    cli: { harness: 'claude', bin: process.execPath, model: 'opus', contextWindow: 200000 },
  },
  claude: {
    name: 'Claude Code',
    harness: 'Claude Code',
    model: 'Claude Sonnet',
    cli: { harness: 'claude', bin: process.execPath, model: 'sonnet' },
    worktree: 'C:\\work\\claude',
    role: 'You work on briefs.',
    forbidden: ['src/App.jsx'],
    notes: ['Keep output short.'],
  },
  opencode: {
    name: 'OpenCode',
    harness: 'OpenCode',
    model: 'DeepSeek',
    cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' },
    worktree: 'C:\\work\\opencode',
    role: 'You own the bridge.',
    forbidden: [],
    notes: ['Test everything.'],
  },
  opencode2: {
    name: 'OpenCode 2',
    harness: 'OpenCode',
    cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' },
  },
  agy: {
    name: 'agy',
    harness: 'agy',
    cli: { harness: 'agy', bin: join(tmpdir(), 'machineroom-no-such-agy', 'agy.exe'), model: 'gemini-3.8-flash-high' },
    notes: ['AGY note.'],
  },
}

function writeFakeRunner(dir, recordedPath) {
  const runnerFile = join(dir, 'fake-runner.mjs')
  const code = [
    "import { writeFileSync } from 'node:fs'",
    'const args = process.argv.slice(2)',
    `writeFileSync(${JSON.stringify(recordedPath)}, JSON.stringify(args))`,
    "console.log('runner started ' + args.join(' '))",
    'process.exit(0)',
  ].join('\n')
  writeFileSync(runnerFile, code, 'utf8')
  return runnerFile
}

async function startBridgeRig({
  projectRoot = gitProject('mr-proj-'),
  runsFolder = tempDir('mr-runs-'),
  lanes = SAMPLE_LANES,
  runnerPath,
  active = true,
  dynamicLanes = false,
} = {}) {
  mkdirSync(runsFolder, { recursive: true })
  if (active) writeActiveLanes(activeLanesFileFor(projectRoot, runsFolder), Object.keys(lanes))
  const lanesFile = join(projectRoot, 'docs', 'agents', 'lanes.json')
  if (dynamicLanes) {
    const previousLanesDir = process.env.MACHINEROOM_LANES_DIR
    process.env.MACHINEROOM_LANES_DIR = join(projectRoot, 'docs', 'agents')
    cleanups.push(() => {
      if (previousLanesDir === undefined) delete process.env.MACHINEROOM_LANES_DIR
      else process.env.MACHINEROOM_LANES_DIR = previousLanesDir
    })
  }

  const runnerCommand = runnerPath
    ? { file: process.execPath, args: [runnerPath] }
    : { file: process.execPath, args: ['-e', 'process.exit(0)'] }

  const bridge = createBridge({
    port: 0,
    projectRoot,
    runsFolder,
    lanesFile,
    lanesSource: {
      folder: runsFolder,
      ...(dynamicLanes ? {} : { lanes }),
      repoRoot: projectRoot,
      pollMs: 20,
      quietMs: 60000,
    },
    runnerCommand,
    env: {
      PATH: process.env.PATH,
      LOCALAPPDATA: runsFolder,
      APPDATA: runsFolder,
    },
  })

  const { url } = await bridge.start()
  cleanups.push(() => bridge.stop())
  const client = createClient({
    baseUrl: url,
    fetchImpl: (input, init) =>
      fetch(input, { ...init, headers: { ...init?.headers, origin: 'http://localhost:5173' } }),
  })
  return { bridge, url, projectRoot, runsFolder, lanesFile, client }
}

async function getJson(url, options = {}) {
  const res = await fetch(url, options)
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

describe('key generation', () => {
  it('picks next free key that clashes with no lane in lanes.json', () => {
    expect(nextFreeKey('claude', SAMPLE_LANES, [])).toBe('claude-2')
    expect(nextFreeKey('opencode', SAMPLE_LANES, [])).toBe('opencode-3')
    expect(nextFreeKey('agy', SAMPLE_LANES, [])).toBe('agy-2')
    expect(nextFreeKey('acp', SAMPLE_LANES, [])).toBe('acp-1')
  })

  it('increments past taken keys in agents config', () => {
    const existing = [{ key: 'claude-2' }]
    expect(nextFreeKey('claude', SAMPLE_LANES, existing)).toBe('claude-3')
  })
})

describe('merged list and template copying', () => {
  it('builds made lane from first lanes.json lane with that harness', () => {
    const agent = {
      key: 'claude-2',
      name: 'Custom Claude',
      harness: 'claude',
      model: 'claude-haiku-5-5',
      effort: 'high',
      createdAt: '2026-10-25T10:00:00.000Z',
    }
    const made = buildMadeLane(agent, SAMPLE_LANES)
    expect(made.key).toBe('claude-2')
    expect(made.name).toBe('Custom Claude')
    expect(made.custom).toBe(true)
    expect(made.model).toBe('claude-haiku-5-5')
    expect(made.effort).toBe('high')
    expect(made.reasoning).toBe('high')
    expect(made.cli).toEqual({ harness: 'claude', bin: process.execPath, model: 'claude-haiku-5-5' })
    expect(made.role).toBeUndefined()
    expect(made.forbidden).toBeUndefined()
    expect(made.notes).toEqual(['Keep output short.'])
  })

  it('returns lanes.json lanes plus owner made lanes in readAllLanes', () => {
    const runs = tempDir('mr-readall-')
    saveAgentsConfig(runs, {
      agents: [
        {
          key: 'claude-2',
          name: 'Custom Claude',
          harness: 'claude',
          model: 'claude-haiku-5-5',
          effort: 'low',
          createdAt: '2026-10-25T10:00:00.000Z',
        },
      ],
    })
    const all = readAllLanes({ lanesJson: SAMPLE_LANES, runsFolder: runs })
    expect(Object.hasOwn(all, 'claude')).toBe(true)
    expect(Object.hasOwn(all, 'claude-2')).toBe(true)
    expect(all['claude-2'].custom).toBe(true)
    expect(all['claude-2'].cli.model).toBe('claude-haiku-5-5')
  })

  it('reads a saved removed list and still keeps those lanes in readAllLanes', () => {
    const runs = tempDir('mr-removed-')
    saveAgentsConfig(runs, { agents: [], removed: ['claude', '', 'orchestrator', 'claude'] })
    expect(readAgentsConfig(runs)).toEqual({ agents: [], removed: ['claude'] })

    const all = readAllLanes({ lanesJson: SAMPLE_LANES, runsFolder: runs })
    expect(Object.hasOwn(all, 'claude')).toBe(true)
    expect(Object.hasOwn(all, 'opencode')).toBe(true)
    expect(Object.hasOwn(all, 'orchestrator')).toBe(true)
  })
})

describe('GET /api/harnesses', () => {
  it('lists harnesses run-lane can start with models and efforts', async () => {
    const { url } = await startBridgeRig()
    const { status, body } = await getJson(`${url}/api/harnesses`)
    expect(status).toBe(200)
    expect(Array.isArray(body)).toBe(true)
    expect(body.map((item) => item.key)).toEqual(HARNESS_KEYS)

    const claude = body.find((item) => item.key === 'claude')
    expect(claude.name).toBe('Claude Code')
    expect(Array.isArray(claude.models)).toBe(true)
    expect(claude.models.some((m) => m.id === 'claude-haiku-5-5')).toBe(true)
    expect(claude.efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])

    const opencode = body.find((item) => item.key === 'opencode')
    expect(opencode.efforts).toEqual(['low', 'medium', 'high', 'max'])

    const agy = body.find((item) => item.key === 'agy')
    expect(agy.efforts).toEqual([])

    const acp = body.find((item) => item.key === 'acp')
    expect(acp.efforts).toEqual([])

    const machineroom = body.find((item) => item.key === 'machineroom')
    expect(machineroom.name).toBe('MachineRoom')
    expect(machineroom.efforts).toEqual([])
    expect(machineroom.models).toEqual([])
    expect(machineroom.available).toBe(false)

    const codex = body.find((item) => item.key === 'codex')
    expect(codex.name).toBe('Codex')
    expect(codex.efforts).toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(codex.models.map((item) => item.id)).toEqual(['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'])

    const copilot = body.find((item) => item.key === 'copilot')
    expect(copilot.name).toBe('GitHub Copilot')
    expect(copilot.efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(copilot.models.map((item) => item.id)).toEqual(['claude-haiku-4.5', 'claude-sonnet-4.5', 'gpt-5-mini', 'gpt-5'])
  })
})

describe('machineroom availability', () => {
  it('needs one of the two key variables and never reads the value further', () => {
    const lanes = {}
    expect(isHarnessAvailable('machineroom', { lanes, env: {} })).toBe(false)
    expect(isHarnessAvailable('machineroom', { lanes, env: { MACHINEROOM_API_KEY: 'test' } })).toBe(true)
    expect(isHarnessAvailable('machineroom', { lanes, env: { OPENROUTER_API_KEY: 'placeholder' } })).toBe(true)
    expect(isHarnessAvailable('machineroom', { lanes, env: { MACHINEROOM_API_KEY: '   ', OPENROUTER_API_KEY: '' } })).toBe(false)
  })
})

describe('Codex app availability', () => {
  it('finds the newest Codex app program by modified time', () => {
    const localAppData = tempDir('mr-codex-app-')
    const older = join(localAppData, 'OpenAI', 'Codex', 'bin', '0123456789abcdef', 'codex.exe')
    const newer = join(localAppData, 'OpenAI', 'Codex', 'bin', 'fedcba9876543210', 'codex.exe')
    mkdirSync(dirname(older), { recursive: true })
    mkdirSync(dirname(newer), { recursive: true })
    writeFileSync(older, '')
    writeFileSync(newer, '')
    utimesSync(older, new Date(1000), new Date(1000))
    utimesSync(newer, new Date(2000), new Date(2000))

    expect(codexAppProgram({ env: { LOCALAPPDATA: localAppData }, platform: 'win32' })).toBe(newer)
  })

  it('skips a newer folder whose name is not 16 hex characters', () => {
    const localAppData = tempDir('mr-codex-app-backup-')
    const version = join(localAppData, 'OpenAI', 'Codex', 'bin', '0123456789abcdef', 'codex.exe')
    const backup = join(localAppData, 'OpenAI', 'Codex', 'bin', 'backup copy', 'codex.exe')
    mkdirSync(dirname(version), { recursive: true })
    mkdirSync(dirname(backup), { recursive: true })
    writeFileSync(version, '')
    writeFileSync(backup, '')
    utimesSync(version, new Date(1000), new Date(1000))
    utimesSync(backup, new Date(2000), new Date(2000))

    expect(codexAppProgram({ env: { LOCALAPPDATA: localAppData }, platform: 'win32' })).toBe(version)
  })

  it('returns null without a folder, variable, or on another system', () => {
    const localAppData = tempDir('mr-codex-app-empty-')
    expect(codexAppProgram({ env: { LOCALAPPDATA: localAppData }, platform: 'win32' })).toBeNull()
    expect(codexAppProgram({ env: {}, platform: 'win32' })).toBeNull()
    expect(codexAppProgram({ env: { LOCALAPPDATA: localAppData }, platform: 'linux' })).toBeNull()
  })

  it('marks a Codex lane available when its app program is installed', () => {
    const localAppData = tempDir('mr-codex-app-available-')
    const program = join(localAppData, 'OpenAI', 'Codex', 'bin', '0123456789abcdef', 'codex.exe')
    mkdirSync(dirname(program), { recursive: true })
    writeFileSync(program, '')

    expect(isHarnessAvailable('codex', {
      lanes: { codex: { cli: { harness: 'codex', bin: 'codex' } } },
      env: { LOCALAPPDATA: localAppData, PATH: '', Path: '' },
      platform: 'win32',
    })).toBe(true)
  })
})

describe('POST /api/lanes/create', () => {
  it('refuses request without page Origin with 403', async () => {
    const { url } = await startBridgeRig()
    const { status, body } = await getJson(`${url}/api/lanes/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test', harness: 'claude', model: 'claude-haiku-5-5', confirmed: true }),
    })
    expect(status).toBe(403)
    expect(body.error).toBe(ORIGIN_CREATE_PROBLEM)
  })

  it('refuses unconfirmed create with 400', async () => {
    const { url } = await startBridgeRig()
    const { status, body } = await getJson(`${url}/api/lanes/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: 'Test', harness: 'claude', model: 'claude-haiku-5-5' }),
    })
    expect(status).toBe(400)
    expect(body.error).toBe(CONFIRM_CREATE_PROBLEM)
  })

  it('refuses empty name or name over 40 characters with 400 and one sentence', async () => {
    const { url } = await startBridgeRig()
    const emptyRes = await getJson(`${url}/api/lanes/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: '   ', harness: 'claude', model: 'claude-haiku-5-5', confirmed: true }),
    })
    expect(emptyRes.status).toBe(400)
    expect(emptyRes.body.error).toBe(NAME_LENGTH_PROBLEM)

    const longRes = await getJson(`${url}/api/lanes/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: 'A'.repeat(41), harness: 'claude', model: 'claude-haiku-5-5', confirmed: true }),
    })
    expect(longRes.status).toBe(400)
    expect(longRes.body.error).toBe(NAME_LENGTH_PROBLEM)
  })

  it('refuses unavailable harness, unlisted model or unlisted effort', async () => {
    const { url } = await startBridgeRig()

    const badHarness = await getJson(`${url}/api/lanes/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: 'Test', harness: 'unknown-harness', model: 'any', confirmed: true }),
    })
    expect(badHarness.status).toBe(400)
    expect(badHarness.body.error).toMatch(/^The harness unknown-harness is not available/)

    const badModel = await getJson(`${url}/api/lanes/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: 'Test', harness: 'claude', model: 'not-a-real-model', confirmed: true }),
    })
    expect(badModel.status).toBe(400)
    expect(badModel.body.error).toBe('The model not-a-real-model is not available for claude.')

    const badEffort = await getJson(`${url}/api/lanes/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: 'Test', harness: 'claude', model: 'claude-haiku-5-5', effort: 'ultra', confirmed: true }),
    })
    expect(badEffort.status).toBe(400)
    expect(badEffort.body.error).toBe(effortUnavailableProblem('ultra', 'claude'))
  })

  it('creates lane, saves to agents.json, updates active lanes and answers new lane', async () => {
    const { url, runsFolder, client } = await startBridgeRig()

    await client.setActiveLanes(['opencode', 'claude'])
    const beforeActive = await client.lanes()
    expect(beforeActive.chosen).toBe(true)

    const created = await client.createLane({
      name: 'Helper Claude',
      harness: 'claude',
      model: 'claude-haiku-5-5',
      effort: 'medium',
      confirmed: true,
    })

    expect(created.key).toBe('claude-2')
    expect(created.name).toBe('Helper Claude')
    expect(created.harness).toBe('claude')
    expect(created.model).toBe('claude-haiku-5-5')
    expect(created.effort).toBe('medium')

    const file = readAgentsConfig(runsFolder)
    expect(file.agents.length).toBe(1)
    expect(file.agents[0].key).toBe('claude-2')

    const lanesRes = await client.lanes()
    const customRow = lanesRes.lanes.find((l) => l.key === 'claude-2')
    expect(customRow).toBeTruthy()
    expect(customRow.custom).toBe(true)
    expect(customRow.effort).toBe('medium')
    expect(customRow.active).toBe(true)
  })

  it('makes the first made lane the active choice so the room and Auto see it', async () => {
    const projectRoot = gitProject('mr-proj-choice-')
    writeFileSync(
      join(projectRoot, 'docs', 'agents', 'policy.json'),
      JSON.stringify({
        tiers: {
          small: [{ lane: 'owner', model: null, reasoning: null, provider: null }],
          medium: [{ lane: 'owner', model: null, reasoning: null, provider: null }],
          large: [{ lane: 'owner', model: null, reasoning: null, provider: null }],
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
      })
    )
    const { url, runsFolder, client } = await startBridgeRig({ projectRoot, active: false, dynamicLanes: true })
    expect(readActiveLanesChoice(activeLanesFileFor(projectRoot, runsFolder))).toBeNull()

    const created = await client.createLane({
      name: 'Coder',
      harness: 'claude',
      model: 'claude-haiku-5-5',
      confirmed: true,
    })
    expect(created.key).toBe('claude-2')
    expect(readActiveLanesChoice(activeLanesFileFor(projectRoot, runsFolder))).toEqual(['claude-2'])

    const agentsRes = await getJson(`${url}/api/control/agents`)
    expect(agentsRes.status).toBe(200)
    expect(agentsRes.body.some((agent) => agent.key === 'claude-2')).toBe(true)

    const autoRes = await getJson(`${url}/api/control/route/lane`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'Fix the typo in src/a.js.' }),
    })
    expect(autoRes.status).toBe(200)
    expect(autoRes.body.error).toBeUndefined()
  })

  it('keeps the existing active choice when it makes another lane', async () => {
    const { projectRoot, runsFolder, client } = await startBridgeRig()
    await client.setActiveLanes(['opencode', 'claude'])

    await client.createLane({
      name: 'Coder',
      harness: 'claude',
      model: 'claude-haiku-5-5',
      confirmed: true,
    })

    const choice = readActiveLanesChoice(activeLanesFileFor(projectRoot, runsFolder))
    expect(choice).toContain('opencode')
    expect(choice).toContain('claude')
  })
})

describe('POST /api/lanes/:key/update', () => {
  it('refuses update without Origin, unconfirmed, or for lanes.json lane', async () => {
    const { url } = await startBridgeRig()

    const noOrigin = await getJson(`${url}/api/lanes/claude/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New Name', confirmed: true }),
    })
    expect(noOrigin.status).toBe(403)

    const unconfirmed = await getJson(`${url}/api/lanes/claude/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: 'New Name' }),
    })
    expect(unconfirmed.status).toBe(400)

    const laneJsonRefusal = await getJson(`${url}/api/lanes/claude/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: 'New Name', confirmed: true }),
    })
    expect(laneJsonRefusal.status).toBe(400)
    expect(laneJsonRefusal.body.error).toBe(LANES_JSON_UPDATE_PROBLEM)
  })

  it('updates owner-made lane name, model and effort', async () => {
    const { client } = await startBridgeRig()

    const created = await client.createLane({
      name: 'Initial Name',
      harness: 'claude',
      model: 'claude-haiku-5-5',
      effort: 'low',
      confirmed: true,
    })

    const updated = await client.updateLane({
      key: created.key,
      name: 'Updated Name',
      model: 'claude-sonnet-5-5',
      effort: 'high',
      confirmed: true,
    })

    expect(updated.name).toBe('Updated Name')
    expect(updated.model).toBe('claude-sonnet-5-5')
    expect(updated.effort).toBe('high')
  })
})

describe('POST /api/lanes/:key/delete', () => {
  it('refuses delete for the orchestrator with 400', async () => {
    const { url } = await startBridgeRig()
    const res = await getJson(`${url}/api/lanes/orchestrator/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(LANES_JSON_DELETE_PROBLEM)
  })

  it('removes a lane from lanes.json in this project only and drops it from active lanes', async () => {
    const { url, client, runsFolder, projectRoot } = await startBridgeRig()
    await client.setActiveLanes(['opencode', 'claude'])

    const res = await getJson(`${url}/api/lanes/claude/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, deleted: 'claude' })

    const file = readAgentsConfig(runsFolder)
    expect(file.agents).toEqual([])
    expect(file.removed).toEqual([])
    expect(readHiddenLanes(projectLanesFileFor(projectRoot, runsFolder))).toEqual(['claude'])

    const otherProject = tempDir('mr-other-project-')
    expect(readHiddenLanes(projectLanesFileFor(otherProject, runsFolder))).toEqual([])
    expect(Object.hasOwn(readAllLanes({ lanesJson: SAMPLE_LANES, runsFolder }), 'claude')).toBe(true)

    const lanesRes = await client.lanes()
    const claudeLane = lanesRes.lanes.find((l) => l.key === 'claude')
    expect(claudeLane.hidden).toBe(true)
    expect(claudeLane.active).toBe(false)
    const opencodeLane = lanesRes.lanes.find((l) => l.key === 'opencode')
    expect(opencodeLane.hidden).toBe(false)
    expect(opencodeLane.active).toBe(true)

    const family = await client.family()
    expect(family.nodes.some((node) => node.id === 'claude')).toBe(false)
    expect(family.nodes.some((node) => node.id === 'opencode')).toBe(true)

    const again = await getJson(`${url}/api/lanes/claude/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(again.status).toBe(404)

    await client.showLane({ key: 'claude', confirmed: true })
    expect(readHiddenLanes(projectLanesFileFor(projectRoot, runsFolder))).toEqual([])
    const shownLanes = await client.lanes()
    expect(shownLanes.lanes.find((l) => l.key === 'claude').hidden).toBe(false)
  })

  it('creates a lane after a project remove and leaves the project hidden list alone', async () => {
    const { client, runsFolder, projectRoot } = await startBridgeRig()
    await client.deleteLane({ key: 'claude', confirmed: true })

    const created = await client.createLane({
      name: 'Helper Claude',
      harness: 'claude',
      model: 'claude-haiku-5-5',
      confirmed: true,
    })
    expect(created.key).toBe('claude-2')
    const file = readAgentsConfig(runsFolder)
    expect(file.removed).toEqual([])
    expect(file.agents.map((agent) => agent.key)).toEqual(['claude-2'])
    expect(readHiddenLanes(projectLanesFileFor(projectRoot, runsFolder))).toEqual(['claude'])
  })

  it('moves an old removed list into this project hidden list when the bridge starts', async () => {
    const runs = tempDir('mr-move-removed-')
    saveAgentsConfig(runs, {
      agents: [
        {
          key: 'claude-2',
          name: 'Helper Claude',
          harness: 'claude',
          model: 'claude-haiku-5-5',
          createdAt: '2026-10-25T10:00:00.000Z',
        },
      ],
      removed: ['claude', 'opencode2'],
    })
    const lines = []
    const log = vi.spyOn(console, 'log').mockImplementation((line) => lines.push(String(line)))
    try {
      const { projectRoot } = await startBridgeRig({ runsFolder: runs })
      expect(readAgentsConfig(runs).removed).toEqual([])
      expect(readAgentsConfig(runs).agents.map((agent) => agent.key)).toEqual(['claude-2'])
      expect(readHiddenLanes(projectLanesFileFor(projectRoot, runs))).toEqual(['claude', 'opencode2'])

      const moved = lines.filter((line) => line.startsWith('Moved '))
      expect(moved).toHaveLength(1)
      expect(moved[0]).toContain('claude, opencode2')
    } finally {
      log.mockRestore()
    }
  })

  it('keeps starting when this project hidden lane file cannot be written', async () => {
    const runs = tempDir('mr-move-blocked-')
    saveAgentsConfig(runs, {
      agents: [],
      removed: ['claude', 'opencode2'],
    })
    const projectRoot = gitProject('mr-proj-blocked-')
    mkdirSync(projectLanesFileFor(projectRoot, runs), { recursive: true })
    const lines = []
    const log = vi.spyOn(console, 'log').mockImplementation((line) => lines.push(String(line)))
    try {
      const { url } = await startBridgeRig({ projectRoot, runsFolder: runs })
      const health = await getJson(`${url}/api/health`)
      expect(health.status).toBe(200)

      const failed = lines.filter((line) => line.startsWith('Could not move the old removed lanes: '))
      expect(failed).toHaveLength(1)
      expect(failed[0]).toContain('EISDIR')
      expect(readAgentsConfig(runs).removed).toEqual(['claude', 'opencode2'])
    } finally {
      log.mockRestore()
    }
  })

  it('refuses delete for running lane with 409', async () => {
    const runs = tempDir('mr-running-')
    saveAgentsConfig(runs, {
      agents: [
        {
          key: 'claude-2',
          name: 'Running Claude',
          harness: 'claude',
          model: 'claude-haiku-5-5',
          effort: 'low',
          createdAt: '2026-10-25T10:00:00.000Z',
        },
      ],
    })
    let statusSent = 0
    let bodySent = null
    const api = createAgentsConfigApi({
      runsFolder: runs,
      isWorking: (key) => key === 'claude-2',
      sendJson: (req, res, status, body) => {
        statusSent = status
        bodySent = body
      },
      readJsonBody: async () => ({ confirmed: true }),
    })

    const handled = await api.handle(
      { method: 'POST', headers: { origin: 'http://localhost:5173' } },
      {},
      new URL('http://localhost:5173/api/lanes/claude-2/delete')
    )
    expect(handled).toBe(true)
    expect(statusSent).toBe(409)
    expect(bodySent.error).toBe(laneRunningProblem('claude-2'))
  })

  it('deletes an owner-made lane for every project', async () => {
    const { client, runsFolder, projectRoot } = await startBridgeRig()
    await client.setActiveLanes(['opencode', 'claude'])

    const created = await client.createLane({
      name: 'To Delete',
      harness: 'claude',
      model: 'claude-haiku-5-5',
      confirmed: true,
    })

    const delRes = await client.deleteLane({ key: created.key, confirmed: true })
    expect(delRes.ok).toBe(true)

    const file = readAgentsConfig(runsFolder)
    expect(file.agents.some((a) => a.key === created.key)).toBe(false)
    expect(file.removed).toEqual([])
    expect(readHiddenLanes(projectLanesFileFor(projectRoot, runsFolder))).toEqual([])

    const otherProject = tempDir('mr-other-project-')
    expect(readHiddenLanes(projectLanesFileFor(otherProject, runsFolder))).toEqual([])
    expect(Object.hasOwn(readAllLanes({ lanesJson: SAMPLE_LANES, runsFolder }), created.key)).toBe(false)

    const lanesRes = await client.lanes()
    expect(lanesRes.lanes.some((l) => l.key === created.key)).toBe(false)
  })

  it('sends agents notice on create, update and delete', async () => {
    const { url, client } = await startBridgeRig()
    const notices = []
    const controller = new AbortController()
    cleanups.push(() => controller.abort())

    const response = await fetch(`${url}/events`, { signal: controller.signal })
    const decoder = new TextDecoder()
    let buffer = ''
    ;(async () => {
      try {
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true })
          let cut = buffer.indexOf('\n\n')
          while (cut !== -1) {
            const block = buffer.slice(0, cut)
            buffer = buffer.slice(cut + 2)
            cut = buffer.indexOf('\n\n')
            const lines = block.split('\n')
            if (lines.some((l) => l.trim() === 'event: change')) {
              const dataLine = lines.find((l) => l.startsWith('data: '))
              if (dataLine) {
                try {
                  notices.push(JSON.parse(dataLine.slice(6)))
                } catch {}
              }
            }
          }
        }
      } catch {}
    })()

    const created = await client.createLane({
      name: 'Notice Lane',
      harness: 'claude',
      model: 'claude-haiku-5-5',
      confirmed: true,
    })

    await waitFor(() => notices.some((n) => n.topic === 'agents'), { what: 'agents notice on create' })

    const countBeforeUpdate = notices.filter((n) => n.topic === 'agents').length

    await client.updateLane({
      key: created.key,
      name: 'Notice Lane Renamed',
      confirmed: true,
    })

    await waitFor(() => notices.filter((n) => n.topic === 'agents').length > countBeforeUpdate, {
      what: 'agents notice on update',
    })

    const countBeforeDelete = notices.filter((n) => n.topic === 'agents').length

    await client.deleteLane({
      key: created.key,
      confirmed: true,
    })

    await waitFor(() => notices.filter((n) => n.topic === 'agents').length > countBeforeDelete, {
      what: 'agents notice on delete',
    })

    await waitFor(() => notices.some((n) => n.topic === 'family'), {
      what: 'family notice on delete',
    })
  })
})

describe('lane runs of made lanes', () => {
  it('starts a brief run for a made lane that is not in lanes.json', async () => {
    const { client } = await startBridgeRig({ projectRoot: REPO_ROOT })
    await client.createLane({
      name: 'Claude Made',
      harness: 'claude',
      model: 'claude-haiku-5-5',
      confirmed: true,
    })

    const started = await client.startRun('claude-2', ['P100'])
    expect(started.lane).toBe('claude-2')
  })

  it('runs made lane on project with fake runner and passes effort as reasoning', async () => {
    const runnerDir = tempDir('mr-runner-')
    const outRecord = join(runnerDir, 'runner-args.json')
    const runnerPath = writeFakeRunner(runnerDir, outRecord)

    const { client, projectRoot } = await startBridgeRig({ runnerPath })
    await client.createLane({
      name: 'Claude Runner',
      harness: 'claude',
      model: 'claude-haiku-5-5',
      effort: 'high',
      confirmed: true,
    })

    const runRes = await client.startRun('claude-2', {
      task: 'Check the files',
      worktree: true,
    })

    expect(runRes.lane).toBe('claude-2')
    await waitFor(() => existsSync(outRecord), { what: 'fake runner to write args' })
    const recorded = JSON.parse(readFileSync(outRecord, 'utf8'))
    expect(recorded).toContain('claude-2')
    expect(recorded).toContain('--project')
    expect(recorded).toContain(projectRoot)
    expect(recorded).toContain('--task')
    expect(recorded).toContain('Check the files')
    expect(recorded).toContain('--worktree')
    expect(recorded).toContain('--reasoning')
    expect(recorded).toContain('high')
  })
})

describe('mock client integration', () => {
  it('provides harnesses with claude and opencode available, agy not', async () => {
    const mock = createMockClient()
    const harnesses = await mock.harnesses()
    const claude = harnesses.find((h) => h.key === 'claude')
    const opencode = harnesses.find((h) => h.key === 'opencode')
    const agy = harnesses.find((h) => h.key === 'agy')

    expect(claude.available).toBe(true)
    expect(claude.models.length).toBe(2)
    expect(opencode.available).toBe(true)
    expect(opencode.models.length).toBe(2)
    expect(agy.available).toBe(false)
  })

  it('creates, updates and deletes made lanes through mock', async () => {
    const mock = createMockClient()
    const created = await mock.createLane({
      name: 'Mock Agent',
      harness: 'claude',
      model: 'claude-haiku-5-5',
      effort: 'medium',
      confirmed: true,
    })
    expect(created.key).toBe('claude-2')
    expect(created.custom).toBe(true)

    const updated = await mock.updateLane({
      key: 'claude-2',
      name: 'Updated Mock',
      confirmed: true,
    })
    expect(updated.name).toBe('Updated Mock')

    const del = await mock.deleteLane({ key: 'claude-2', confirmed: true })
    expect(del.ok).toBe(true)
  })
})
