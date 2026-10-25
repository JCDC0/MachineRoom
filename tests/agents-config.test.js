import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HARNESS_EFFORTS,
  HARNESS_KEYS,
  buildMadeLane,
  isHarnessAvailable,
  listHarnesses,
  nextFreeKey,
  readAgentsConfig,
  readAllLanes,
  saveAgentsConfig,
} from '../server/agents-config.js'
import { createBridge } from '../server/index.js'
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
} = {}) {
  mkdirSync(runsFolder, { recursive: true })
  const lanesFile = join(projectRoot, 'docs', 'agents', 'lanes.json')

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
      lanes,
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
    expect(body.error).toBe('A request to create a lane needs a page Origin.')
  })

  it('refuses unconfirmed create with 400', async () => {
    const { url } = await startBridgeRig()
    const { status, body } = await getJson(`${url}/api/lanes/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: 'Test', harness: 'claude', model: 'claude-haiku-5-5' }),
    })
    expect(status).toBe(400)
    expect(body.error).toBe('Confirm creating the lane first.')
  })

  it('refuses empty name or name over 40 characters with 400 and one sentence', async () => {
    const { url } = await startBridgeRig()
    const emptyRes = await getJson(`${url}/api/lanes/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: '   ', harness: 'claude', model: 'claude-haiku-5-5', confirmed: true }),
    })
    expect(emptyRes.status).toBe(400)
    expect(emptyRes.body.error).toBe('The lane name must be 1 to 40 characters.')

    const longRes = await getJson(`${url}/api/lanes/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ name: 'A'.repeat(41), harness: 'claude', model: 'claude-haiku-5-5', confirmed: true }),
    })
    expect(longRes.status).toBe(400)
    expect(longRes.body.error).toBe('The lane name must be 1 to 40 characters.')
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
    expect(badEffort.body.error).toBe('The effort ultra is not available for claude.')
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
    expect(laneJsonRefusal.body.error).toBe('A lane from lanes.json cannot be updated.')
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
  it('refuses delete for lane from lanes.json with 400', async () => {
    const { url } = await startBridgeRig()
    const res = await getJson(`${url}/api/lanes/claude/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('A lane from lanes.json cannot be deleted; make it inactive instead.')
  })

  it('refuses delete for running lane with 409', async () => {
    const { url, client, runsFolder } = await startBridgeRig()
    const created = await client.createLane({
      name: 'Running Lane',
      harness: 'claude',
      model: 'claude-haiku-5-5',
      confirmed: true,
    })

    const resRunning = await getJson(`${url}/api/lanes/${created.key}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(resRunning.status).toBe(200)
  })

  it('deletes owner-made lane from config and active lanes', async () => {
    const { client, runsFolder } = await startBridgeRig()
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
  })
})

describe('lane runs of made lanes and brief run refusal', () => {
  it('refuses brief run for made lane not in lanes.json with 400', async () => {
    const { client } = await startBridgeRig({ projectRoot: REPO_ROOT })
    await client.createLane({
      name: 'Claude Made',
      harness: 'claude',
      model: 'claude-haiku-5-5',
      confirmed: true,
    })

    await expect(client.startRun('claude-2', ['T1'])).rejects.toThrow('Choose a lane from the list.')
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
