import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CONFIRM_ACTIVE_LANES_PROBLEM,
  CONFIRM_HIDE_PROBLEM,
  CONFIRM_SHOW_PROBLEM,
  EMPTY_ACTIVE_LANES_PROBLEM,
  HIDE_ORCHESTRATOR_PROBLEM,
  ORIGIN_ACTIVE_LANES_PROBLEM,
  ORIGIN_HIDE_PROBLEM,
  ORIGIN_SHOW_PROBLEM,
  OWNER_ACTIVE_LANES_PROBLEM,
  REPEATED_ACTIVE_LANE_PROBLEM,
  activeLanesFileFor,
  createActiveLanesApi,
  eligibleLanes,
  hiddenLaneProblem,
  projectHash,
  projectLanesFileFor,
  readActiveLanesChoice,
  readHiddenLanes,
  writeActiveLanes,
  writeHiddenLanes,
} from '../server/active-lanes.js'
import { createBridge } from '../server/index.js'
import { createClient } from '../src/control/client.js'
import { MOCK_LANE_KEYS, createMockClient } from '../src/control/mock.js'
import { makeTempDir } from './helpers/tempRoot.js'
import { isHarnessAvailable } from '../server/agents-config.js'
const assumeInstalled = (key, options) => key === 'claude' || key === 'opencode' || isHarnessAvailable(key, options)

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
  agy: {
    name: 'AGY',
    harness: 'agy',
    cli: { harness: 'agy', model: 'gemini-3.8-flash-high' },
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
    orchestratorHarnessAvailable: assumeInstalled,
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

  it('reads an empty choice only from the lanes object and not a bare empty array', () => {
    const runs = tempDir('mr-choice-')
    const file = join(runs, 'active-lanes-sample.json')
    writeFileSync(file, '[]')
    expect(readActiveLanesChoice(file)).toBeNull()
    writeFileSync(file, JSON.stringify({ lanes: [] }))
    expect(readActiveLanesChoice(file)).toEqual([])
    writeActiveLanes(file, [])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ lanes: [] })
    expect(readActiveLanesChoice(file)).toEqual([])
    writeActiveLanes(file, ['opencode'])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(['opencode'])
  })

  it('cleans up temporary file if writeActiveLanes rename fails', () => {
    const runs = tempDir('mr-choice-')
    const file = join(runs, 'active-lanes-atomic.json')
    const renameFails = () => {
      throw new Error('disk failure')
    }
    writeActiveLanes(file, ['opencode'], { rename: renameFails })
    expect(existsSync(file)).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(['opencode'])
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })
})

describe('eligible lanes', () => {
  it('leaves out an agy lane unless the owner made it', () => {
    const lanes = {
      orchestrator: { name: 'Orchestrator', harness: 'Claude Code', cli: { harness: 'claude', model: 'opus' } },
      opencode: { name: 'OpenCode', harness: 'OpenCode', cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
      opencode2: { name: 'OpenCode 2', harness: 'OpenCode', cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
      claude: { name: 'Claude Code', harness: 'Claude Code', cli: { harness: 'claude', model: 'sonnet' } },
      agy: { name: 'AGY', harness: 'agy', cli: { harness: 'agy', model: 'gemini-3.8-flash-high' } },
      agy2: { name: 'AGY 2', harness: 'agy', cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
      agy3: { name: 'AGY 3', cli: { harness: 'agy', model: 'gemini-3.8-flash-high' } },
      'agy-1': { name: 'AGY Custom', harness: 'agy', custom: true, cli: { harness: 'agy', model: 'gemini-3.8-flash-high' } },
    }
    const keys = eligibleLanes(lanes).map((lane) => lane.key)
    expect(keys).toEqual(['opencode', 'opencode2', 'claude', 'agy-1'])
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
      { key: 'opencode', name: 'OpenCode', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', custom: false, effort: null, active: false, working: false, hidden: false },
      { key: 'opencode2', name: 'OpenCode 2', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash', custom: false, effort: null, active: false, working: false, hidden: false },
      { key: 'claude', name: 'Claude Code', harness: 'claude', model: 'sonnet', custom: false, effort: null, active: false, working: false, hidden: false },
    ])
    expect(body.lanes.map((lane) => lane.key)).not.toContain('agy')
  })

  it('keeps a custom lane on the agy harness eligible', async () => {
    const { url } = await startTestBridge({
      lanes: {
        orchestrator: SAMPLE_LANES.orchestrator,
        opencode: SAMPLE_LANES.opencode,
        agy: SAMPLE_LANES.agy,
        'agy-1': { name: 'AGY Custom', harness: 'agy', custom: true, cli: { harness: 'agy', model: 'gemini-3.8-flash-high' } },
      },
    })
    const { status, body } = await getJson(`${url}/api/lanes`)
    expect(status).toBe(200)
    expect(body.max).toBe(2)
    expect(body.lanes.map((lane) => lane.key)).toEqual(['opencode', 'agy-1'])
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

  it('refuses a lanes list that is not an array with 400', async () => {
    const { url } = await startTestBridge()
    const { status, body } = await getJson(`${url}/api/lanes/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lanes: 'opencode', confirmed: true }),
    })
    expect(status).toBe(400)
    expect(body.error).toBe(EMPTY_ACTIVE_LANES_PROBLEM)
  })

  it('saves an empty lanes list so the last active lane can be turned off', async () => {
    const { url, projectRoot, runsFolder } = await startTestBridge()
    const before = await getJson(`${url}/api/lanes/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lanes: ['opencode'], confirmed: true }),
    })
    expect(before.status).toBe(200)

    const res = await getJson(`${url}/api/lanes/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lanes: [], confirmed: true }),
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, lanes: [] })

    const file = activeLanesFileFor(projectRoot, runsFolder)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ lanes: [] })

    const lanes = await getJson(`${url}/api/lanes`)
    expect(lanes.body.chosen).toBe(true)
    expect(lanes.body.lanes.every((lane) => lane.active === false)).toBe(true)

    const agents = await getJson(`${url}/api/agents`)
    expect(agents.body.map((agent) => agent.key)).toEqual(['orchestrator'])
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

    const res4 = await post(['agy'])
    expect(res4.status).toBe(400)
    expect(res4.body.error).toBe('The lane agy is not known.')
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
    expect(beforeKeys).toEqual(['orchestrator'])

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

  it('refuses POST /api/control/runs on a project with no choice with 400', async () => {
    const { url } = await startTestBridge()

    const res = await getJson(`${url}/api/control/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lane: 'opencode', task: 'Do work', allowDirty: true, confirmed: true }),
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Pick the lanes for this project first.')
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

describe('hidden lanes per project', () => {
  it('refuses hide and show without a page Origin with 403', async () => {
    const { url } = await startTestBridge()

    const hideNoOrigin = await getJson(`${url}/api/lanes/opencode/hide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(hideNoOrigin.status).toBe(403)
    expect(hideNoOrigin.body.error).toBe(ORIGIN_HIDE_PROBLEM)

    const showNoOrigin = await getJson(`${url}/api/lanes/opencode/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(showNoOrigin.status).toBe(403)
    expect(showNoOrigin.body.error).toBe(ORIGIN_SHOW_PROBLEM)
  })

  it('refuses hide and show when confirmed is not true with 400', async () => {
    const { url } = await startTestBridge()

    const hideNotConfirmed = await getJson(`${url}/api/lanes/opencode/hide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: false }),
    })
    expect(hideNotConfirmed.status).toBe(400)
    expect(hideNotConfirmed.body.error).toBe(CONFIRM_HIDE_PROBLEM)

    const showNotConfirmed = await getJson(`${url}/api/lanes/opencode/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({}),
    })
    expect(showNotConfirmed.status).toBe(400)
    expect(showNotConfirmed.body.error).toBe(CONFIRM_SHOW_PROBLEM)
  })

  it('refuses hiding and showing the orchestrator with 400', async () => {
    const { url } = await startTestBridge()

    const hideOrch = await getJson(`${url}/api/lanes/orchestrator/hide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(hideOrch.status).toBe(400)
    expect(hideOrch.body.error).toBe(HIDE_ORCHESTRATOR_PROBLEM)

    const showOrch = await getJson(`${url}/api/lanes/orchestrator/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(showOrch.status).toBe(400)
  })

  it('refuses hiding and showing an unknown lane with 400', async () => {
    const { url } = await startTestBridge()

    const hideUnknown = await getJson(`${url}/api/lanes/ghost/hide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(hideUnknown.status).toBe(400)
    expect(hideUnknown.body.error).toBe('The lane ghost is not known.')

    const showUnknown = await getJson(`${url}/api/lanes/ghost/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(showUnknown.status).toBe(400)
    expect(showUnknown.body.error).toBe('The lane ghost is not known.')
  })

  it('refuses hiding and showing a running lane with 409', async () => {
    const root = tempDir('mr-running-proj-')
    const runs = tempDir('mr-running-runs-')
    const answers = []
    const api = createActiveLanesApi({
      projectRoot: root,
      runsFolder: runs,
      lanes: SAMPLE_LANES,
      isWorking: (key) => key === 'opencode',
      sendJson: (_req, _res, status, body) => answers.push({ status, body }),
      readJsonBody: async () => ({ confirmed: true }),
    })

    const hideHandled = await api.handle(
      { method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } },
      {},
      new URL('http://127.0.0.1/api/lanes/opencode/hide')
    )
    expect(hideHandled).toBe(true)
    expect(answers[0].status).toBe(409)
    expect(answers[0].body.error).toBe('The lane opencode is running.')

    const showHandled = await api.handle(
      { method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } },
      {},
      new URL('http://127.0.0.1/api/lanes/opencode/show')
    )
    expect(showHandled).toBe(true)
    expect(answers[1].status).toBe(409)
    expect(answers[1].body.error).toBe('The lane opencode is running.')
  })

  it('hides a lane, removes it from active lanes, and persists file', async () => {
    const { url, projectRoot, runsFolder } = await startTestBridge()

    await getJson(`${url}/api/lanes/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lanes: ['opencode', 'claude'], confirmed: true }),
    })

    const hideRes = await getJson(`${url}/api/lanes/opencode/hide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(hideRes.status).toBe(200)
    expect(hideRes.body).toEqual({ ok: true, hidden: 'opencode' })

    const hiddenFile = projectLanesFileFor(projectRoot, runsFolder)
    expect(readHiddenLanes(hiddenFile)).toEqual(['opencode'])

    const activeFile = activeLanesFileFor(projectRoot, runsFolder)
    expect(readActiveLanesChoice(activeFile)).toEqual(['claude'])

    const lanesRes = await getJson(`${url}/api/lanes`)
    expect(lanesRes.status).toBe(200)
    const opencodeLane = lanesRes.body.lanes.find((l) => l.key === 'opencode')
    expect(opencodeLane.hidden).toBe(true)
    expect(opencodeLane.active).toBe(false)

    const claudeLane = lanesRes.body.lanes.find((l) => l.key === 'claude')
    expect(claudeLane.hidden).toBe(false)
    expect(claudeLane.active).toBe(true)

    const showRes = await getJson(`${url}/api/lanes/opencode/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })
    expect(showRes.status).toBe(200)
    expect(showRes.body).toEqual({ ok: true, shown: 'opencode' })
    expect(readHiddenLanes(hiddenFile)).toEqual([])

    const afterShow = await getJson(`${url}/api/lanes`)
    expect(afterShow.body.lanes.find((l) => l.key === 'opencode').hidden).toBe(false)
  })

  it('excludes hidden lane from GET /api/agents and GET /api/family', async () => {
    const { url } = await startTestBridge()

    await getJson(`${url}/api/lanes/opencode/hide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })

    const agentsRes = await getJson(`${url}/api/agents`)
    expect(agentsRes.status).toBe(200)
    const agentKeys = agentsRes.body.map((a) => a.key)
    expect(agentKeys).not.toContain('opencode')

    const familyRes = await getJson(`${url}/api/family`)
    expect(familyRes.status).toBe(200)
    const nodeIds = familyRes.body.nodes.map((n) => n.id)
    expect(nodeIds).not.toContain('opencode')
    expect(familyRes.body.nodes.find((n) => n.id === 'orchestrator').children).not.toContain('opencode')
  })

  it('refuses active lanes and control runs for a hidden lane with 400', async () => {
    const { url } = await startTestBridge()

    await getJson(`${url}/api/lanes/opencode/hide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })

    const activeRes = await getJson(`${url}/api/lanes/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lanes: ['opencode'], confirmed: true }),
    })
    expect(activeRes.status).toBe(400)
    expect(activeRes.body.error).toBe(hiddenLaneProblem('opencode'))

    const runRes = await getJson(`${url}/api/control/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ lane: 'opencode', task: 'Do work', allowDirty: true, confirmed: true }),
    })
    expect(runRes.status).toBe(400)
    expect(runRes.body.error).toBe(hiddenLaneProblem('opencode'))
  })

  it('leaves a lane hidden in one project while active in another', async () => {
    const runsFolder = tempDir('mr-runs-shared-')
    const projA = tempDir('mr-proj-a-')
    const projB = tempDir('mr-proj-b-')

    const bridgeA = await startTestBridge({ projectRoot: projA, runsFolder })
    const bridgeB = await startTestBridge({ projectRoot: projB, runsFolder })

    await getJson(`${bridgeA.url}/api/lanes/opencode/hide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: bridgeA.url },
      body: JSON.stringify({ confirmed: true }),
    })

    const lanesA = await getJson(`${bridgeA.url}/api/lanes`)
    expect(lanesA.body.lanes.find((l) => l.key === 'opencode').hidden).toBe(true)

    const lanesB = await getJson(`${bridgeB.url}/api/lanes`)
    expect(lanesB.body.lanes.find((l) => l.key === 'opencode').hidden).toBe(false)
  })

  it('keeps a sub in the ladder working when one of its lanes is hidden', async () => {
    const { url } = await startTestBridge()

    const ladderRes = await getJson(`${url}/api/orchestrator/ladder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({
        confirmed: true,
        by: 'owner',
        ladder: {
          subs: [
            {
              id: 'frontend',
              name: 'Frontend',
              harness: 'claude',
              model: 'sonnet',
              lanes: ['opencode', 'claude'],
              scope: ['src/ui/**'],
              restricted: true,
              setBy: 'owner',
            },
          ],
        },
      }),
    })
    expect(ladderRes.status).toBe(200)

    await getJson(`${url}/api/lanes/claude/hide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ confirmed: true }),
    })

    const orchs = await getJson(`${url}/api/orchestrators`)
    expect(orchs.status).toBe(200)
    const subEntry = orchs.body.find((o) => o.id === 'frontend')
    expect(subEntry).toBeDefined()
    expect(subEntry.lanes).toEqual(['opencode'])

    const mainEntry = orchs.body.find((o) => o.id === 'orchestrator')
    expect(mainEntry.lanes).not.toContain('claude')
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

  it('lists no agy lane by default and writes the ladder against owner-made lane keys', async () => {
    expect(MOCK_LANE_KEYS).not.toContain('agy')
    const client = createMockClient({ latencyMs: 0 })
    const topics = []
    client.subscribe((event) => topics.push(event.topic))
    const created = await client.createLane({
      name: 'Extra',
      harness: 'opencode',
      model: 'opencode/deepseek-v4.1-flash-free',
      confirmed: true,
    })
    const saved = await client.setLadder({
      subs: [
        {
          id: 'extra',
          name: 'Extra',
          harness: 'opencode',
          model: 'opencode-go/deepseek-v4.1-flash',
          lanes: [created.key],
          scope: ['src/**'],
          restricted: true,
          setBy: 'owner',
        },
      ],
    })
    expect(saved.ladder.subs.map((sub) => sub.lanes)).toEqual([[created.key]])
    expect(topics).toContain('orchestrator')
    expect(topics).toContain('family')
  })

  it('hides and shows lanes through client and mock', async () => {
    const { url } = await startTestBridge()
    const client = createClient({
      baseUrl: url,
      fetchImpl: (input, init) =>
        fetch(input, { ...init, headers: { ...init?.headers, origin: 'http://localhost:5173' } }),
    })

    const hideRes = await client.hideLane({ key: 'opencode', confirmed: true })
    expect(hideRes.ok).toBe(true)
    expect(hideRes.hidden).toBe('opencode')

    const lanesAfterHide = await client.lanes()
    expect(lanesAfterHide.lanes.find((l) => l.key === 'opencode').hidden).toBe(true)

    const showRes = await client.showLane({ key: 'opencode', confirmed: true })
    expect(showRes.ok).toBe(true)
    expect(showRes.shown).toBe('opencode')

    const mock = createMockClient({ latencyMs: 0 })
    const mockHide = await mock.hideLane({ key: 'opencode2', confirmed: true })
    expect(mockHide.ok).toBe(true)
    const mockLanes = await mock.lanes()
    expect(mockLanes.lanes.find((l) => l.key === 'opencode2').hidden).toBe(true)
    expect(mockLanes.lanes.find((l) => l.key === 'opencode2').active).toBe(false)

    await expect(mock.setActiveLanes({ lanes: ['opencode2'], confirmed: true })).rejects.toThrow(
      'opencode2 is hidden in this project. Show it in Settings first.'
    )

    await expect(mock.startRun('opencode2', { task: 'do' })).rejects.toThrow(
      'opencode2 is hidden in this project. Show it in Settings first.'
    )

    const mockShow = await mock.showLane({ key: 'opencode2', confirmed: true })
    expect(mockShow.ok).toBe(true)
    const mockLanesAfterShow = await mock.lanes()
    expect(mockLanesAfterShow.lanes.find((l) => l.key === 'opencode2').hidden).toBe(false)
  })
})
