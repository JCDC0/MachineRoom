import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CONFIRM_ACTIVE_LANES_PROBLEM,
  EMPTY_ACTIVE_LANES_PROBLEM,
  OWNER_ACTIVE_LANES_PROBLEM,
  REPEATED_ACTIVE_LANE_PROBLEM,
  activeLanesFileFor,
  projectHash,
  readActiveLanesChoice,
} from '../server/active-lanes.js'
import { createBridge } from '../server/index.js'
import { createClient } from '../src/control/client.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix = 'mr-lanes-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {}
  })
  return dir
}

const SAMPLE_LANES = {
  orchestrator: {
    name: 'Orchestrator',
    harness: 'Claude Code',
    cli: { harness: 'claude', model: 'opus' },
  },
  hermes: {
    name: 'Hermes',
    harness: 'Hermes',
    retired: true,
    cli: { harness: 'hermes', model: 'deepseek/deepseek-v4.1-flash-1017' },
  },
  opencode: {
    name: 'OpenCode',
    harness: 'OpenCode',
    cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
  },
  opencode2: {
    name: 'OpenCode 2',
    harness: 'OpenCode',
    cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
  },
  claude: {
    name: 'Claude Code',
    harness: 'Claude Code',
    cli: { harness: 'claude', model: 'sonnet' },
  },
}

async function startTestBridge({
  projectRoot = tempDir('mr-proj-'),
  runsFolder = tempDir('mr-runs-'),
  lanes = SAMPLE_LANES,
} = {}) {
  mkdirSync(runsFolder, { recursive: true })
  mkdirSync(join(projectRoot, 'docs', 'agents'), { recursive: true })
  const lanesFile = join(projectRoot, 'docs', 'agents', 'lanes.json')
  writeFileSync(lanesFile, JSON.stringify(lanes, null, 2))
  writeFileSync(
    join(projectRoot, 'docs', 'agents', 'TASKS.md'),
    '## Open work\n\n**T1. First task (OpenCode).** Test.\n'
  )

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
    runnerCommand: { file: process.execPath, args: ['-e', 'process.exit(0)'] },
    env: {},
  })

  const { url } = await bridge.start()
  cleanups.push(() => bridge.stop())
  return { bridge, url, projectRoot, runsFolder, lanesFile }
}

async function getJson(url, options = {}) {
  const res = await fetch(url, options)
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

describe('active lanes file and hash', () => {
  it('computes project hash and path to active lanes file', () => {
    const root = tempDir('mr-hash-')
    const runs = tempDir('mr-runs-')
    const hash = projectHash(root)
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
    const file = activeLanesFileFor(root, runs)
    expect(file).toBe(join(runs, `active-lanes-${hash}.json`))
  })

  it('reads active lanes choice when file exists and returns null when missing', () => {
    const runs = tempDir('mr-choice-')
    const file = join(runs, 'active-lanes-sample.json')
    expect(readActiveLanesChoice(file)).toBeNull()
    writeFileSync(file, JSON.stringify(['opencode', 'claude']))
    expect(readActiveLanesChoice(file)).toEqual(['opencode', 'claude'])
  })
})

describe('active lanes route', () => {
  it('answers every eligible lane in order with chosen false before saving', async () => {
    const { url } = await startTestBridge()
    const { status, body } = await getJson(`${url}/api/lanes`)
    expect(status).toBe(200)
    expect(body.chosen).toBe(false)
    expect(body.max).toBe(3)
    expect(body.lanes).toEqual([
      { key: 'opencode', name: 'OpenCode', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', active: true, working: false },
      { key: 'opencode2', name: 'OpenCode 2', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', active: true, working: false },
      { key: 'claude', name: 'Claude Code', harness: 'claude', model: 'sonnet', active: true, working: false },
    ])
  })

  it('refuses POST without page Origin with 403', async () => {
    const { url } = await startTestBridge()
    const { status, body } = await getJson(`${url}/api/lanes/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lanes: ['opencode'], confirmed: true }),
    })
    expect(status).toBe(403)
    expect(body.error).toBe(OWNER_ACTIVE_LANES_PROBLEM)
  })

  it('refuses unconfirmed POST with 400', async () => {
    const { url } = await startTestBridge()
    const { status, body } = await getJson(`${url}/api/lanes/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lanes: ['opencode'] }),
    })
    expect(status).toBe(400)
    expect(body.error).toBe(CONFIRM_ACTIVE_LANES_PROBLEM)
  })

  it('refuses empty lanes list with 400', async () => {
    const { url } = await startTestBridge()
    const { status, body } = await getJson(`${url}/api/lanes/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lanes: [], confirmed: true }),
    })
    expect(status).toBe(400)
    expect(body.error).toBe(EMPTY_ACTIVE_LANES_PROBLEM)
  })

  it('refuses repeated lane key with 400', async () => {
    const { url } = await startTestBridge()
    const { status, body } = await getJson(`${url}/api/lanes/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lanes: ['opencode', 'opencode'], confirmed: true }),
    })
    expect(status).toBe(400)
    expect(body.error).toBe(REPEATED_ACTIVE_LANE_PROBLEM)
  })

  it('refuses unknown, retired or orchestrator lane with 400', async () => {
    const { url } = await startTestBridge()
    const post = (lanes) =>
      getJson(`${url}/api/lanes/active`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: url },
        body: JSON.stringify({ lanes, confirmed: true }),
      })

    const res1 = await post(['unknown-lane'])
    expect(res1.status).toBe(400)
    expect(res1.body.error).toBe('The lane unknown-lane is not known.')

    const res2 = await post(['hermes'])
    expect(res2.status).toBe(400)
    expect(res2.body.error).toBe('The lane hermes is not known.')

    const res3 = await post(['orchestrator'])
    expect(res3.status).toBe(400)
    expect(res3.body.error).toBe('The lane orchestrator is not known.')
  })

  it('saves active lanes choice, sets chosen true, and updates GET /api/lanes', async () => {
    const { url, projectRoot, runsFolder } = await startTestBridge()
    const saveRes = await getJson(`${url}/api/lanes/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lanes: ['opencode', 'claude'], confirmed: true }),
    })
    expect(saveRes.status).toBe(200)
    expect(saveRes.body.ok).toBe(true)

    const file = activeLanesFileFor(projectRoot, runsFolder)
    const content = JSON.parse(readFileSync(file, 'utf8'))
    expect(content).toEqual(['opencode', 'claude'])

    const { status, body } = await getJson(`${url}/api/lanes`)
    expect(status).toBe(200)
    expect(body.chosen).toBe(true)
    expect(body.max).toBe(3)
    expect(body.lanes.find((lane) => lane.key === 'opencode').active).toBe(true)
    expect(body.lanes.find((lane) => lane.key === 'opencode2').active).toBe(false)
    expect(body.lanes.find((lane) => lane.key === 'claude').active).toBe(true)
  })
})

describe('agents list filtering and run refusal', () => {
  it('filters /api/agents to only active lanes after choice while keeping orchestrator', async () => {
    const { url } = await startTestBridge()

    const before = await getJson(`${url}/api/agents`)
    expect(before.status).toBe(200)
    const beforeKeys = before.body.map((agent) => agent.key)
    expect(beforeKeys).toContain('orchestrator')
    expect(beforeKeys).toContain('opencode')
    expect(beforeKeys).toContain('opencode2')
    expect(beforeKeys).toContain('claude')

    await getJson(`${url}/api/lanes/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lanes: ['opencode'], confirmed: true }),
    })

    const after = await getJson(`${url}/api/agents`)
    expect(after.status).toBe(200)
    const afterKeys = after.body.map((agent) => agent.key)
    expect(afterKeys).toContain('orchestrator')
    expect(afterKeys).toContain('opencode')
    expect(afterKeys).not.toContain('opencode2')
    expect(afterKeys).not.toContain('claude')
  })

  it('refuses POST /api/control/runs for an inactive lane with 400', async () => {
    const { url } = await startTestBridge()

    await getJson(`${url}/api/lanes/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lanes: ['opencode'], confirmed: true }),
    })

    const res = await getJson(`${url}/api/control/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lane: 'opencode2', task: 'Do work', allowDirty: true, confirmed: true }),
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('The lane opencode2 is not active. Add it in Agents first.')
  })

  it('allows POST /api/control/runs for an active lane', async () => {
    const { url } = await startTestBridge()

    await getJson(`${url}/api/lanes/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lanes: ['opencode'], confirmed: true }),
    })

    const res = await getJson(`${url}/api/control/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lane: 'opencode', task: 'Do work', allowDirty: true, confirmed: true }),
    })
    expect(res.status).toBe(202)
    expect(res.body.lane).toBe('opencode')
  })
})

describe('client and mock integration', () => {
  it('manages active lanes through createClient', async () => {
    const { url } = await startTestBridge()
    const client = createClient({
      baseUrl: url,
      fetchImpl: (input, init) =>
        fetch(input, { ...init, headers: { ...init?.headers, origin: 'http://localhost:5173' } }),
    })

    const initial = await client.lanes()
    expect(initial.chosen).toBe(false)
    expect(initial.lanes.length).toBe(3)

    const saved = await client.setActiveLanes({ lanes: ['opencode', 'claude'], confirmed: true })
    expect(saved.ok).toBe(true)

    const updated = await client.lanes()
    expect(updated.chosen).toBe(true)
    expect(updated.lanes.find((l) => l.key === 'opencode').active).toBe(true)
    expect(updated.lanes.find((l) => l.key === 'opencode2').active).toBe(false)
  })
})
