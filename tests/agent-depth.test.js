import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AGENT_DEPTH_DEFAULT,
  CONFIRM_DEPTH_PROBLEM,
  LIMIT_DEPTH_PROBLEM,
  ORIGIN_DEPTH_PROBLEM,
  TOKEN_DEPTH_PROBLEM,
  UNLOCK_DEPTH_PROBLEM,
  agentDepthFileFor,
  deepestRing,
  occupiedDepthProblem,
  readAgentDepth,
  saveAgentDepth,
} from '../server/agent-depth.js'
import { createBridge } from '../server/index.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix) {
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
    cli: { harness: 'claude', bin: process.execPath, model: 'opus', contextWindow: 200000 },
  },
  opencode: {
    name: 'OpenCode',
    harness: 'OpenCode',
    cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' },
  },
  opencode2: {
    name: 'OpenCode 2',
    harness: 'OpenCode',
    cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' },
  },
  claude: {
    name: 'Claude Code',
    harness: 'Claude Code',
    cli: { harness: 'claude', bin: process.execPath, model: 'sonnet' },
  },
}

async function startBridge({ withLanes = false } = {}) {
  const projectRoot = tempDir('mr-depth-project-')
  const runsFolder = tempDir('mr-depth-runs-')
  mkdirSync(runsFolder, { recursive: true })
  const extra = {}
  if (withLanes) {
    mkdirSync(join(projectRoot, 'docs', 'agents'), { recursive: true })
    const lanesFile = join(projectRoot, 'docs', 'agents', 'lanes.json')
    writeFileSync(lanesFile, JSON.stringify(SAMPLE_LANES, null, 2))
    writeFileSync(join(projectRoot, 'docs', 'agents', 'TASKS.md'), '## Open work\n\n**T1. Task (Claude Code).** Brief.\n')
    const promptFile = join(runsFolder, 'prompt.txt')
    writeFileSync(promptFile, 'PROMPT')
    extra.lanesFile = lanesFile
    extra.lanesSource = {
      folder: runsFolder,
      lanes: SAMPLE_LANES,
      pollMs: 20,
      quietMs: 60000,
    }
    extra.orchestratorPrompt = promptFile
    extra.orchestratorSpawn = () => {
      throw new Error('No real agent in tests.')
    }
  }
  const bridge = createBridge({ projectRoot, runsFolder, port: 0, env: {}, ...extra })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { bridge, url, runsFolder }
}

async function request(url, { method = 'GET', origin = 'http://localhost:5173', token = '', body = null } = {}) {
  const headers = {}
  if (origin) headers.Origin = origin
  if (token) headers['X-MachineRoom-Orchestrator'] = token
  if (body !== null) headers['Content-Type'] = 'application/json'
  const response = await fetch(url, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

describe('the agent depth file', () => {
  it('reads 2 and locked when there is no file', () => {
    const runs = tempDir('mr-depth-none-')
    expect(readAgentDepth(runs)).toEqual({ limit: AGENT_DEPTH_DEFAULT, unlocked: false })
    expect(existsSync(agentDepthFileFor(runs))).toBe(false)
  })

  it('saves the limit and the unlock in agent-depth.json', () => {
    const runs = tempDir('mr-depth-save-')
    expect(saveAgentDepth(runs, { limit: 3, unlocked: true })).toEqual({ limit: 3, unlocked: true })
    expect(JSON.parse(readFileSync(agentDepthFileFor(runs), 'utf8'))).toEqual({ limit: 3, unlocked: true })
    expect(readAgentDepth(runs)).toEqual({ limit: 3, unlocked: true })
  })

  it('keeps a deep limit only while it is unlocked, and survives a broken file', () => {
    const runs = tempDir('mr-depth-broken-')
    saveAgentDepth(runs, { limit: 4, unlocked: false })
    expect(readAgentDepth(runs)).toEqual({ limit: AGENT_DEPTH_DEFAULT, unlocked: false })

    writeFileSync(agentDepthFileFor(runs), 'not json')
    expect(readAgentDepth(runs)).toEqual({ limit: AGENT_DEPTH_DEFAULT, unlocked: false })
  })
})

describe('GET and POST /api/agent-depth', () => {
  it('answers 2 and locked by default', async () => {
    const { url } = await startBridge()
    const answer = await request(`${url}/api/agent-depth`, { origin: '' })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ limit: AGENT_DEPTH_DEFAULT, unlocked: false, deepest: 0, deepestAgents: 0, rings: [] })
  })

  it('refuses a write without a page Origin', async () => {
    const { url } = await startBridge()
    const answer = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      origin: '',
      body: { limit: 1, unlocked: false, confirmed: true },
    })
    expect(answer.status).toBe(403)
    expect(answer.body.error).toBe(ORIGIN_DEPTH_PROBLEM)
  })

  it('refuses a write from an orchestrator token', async () => {
    const { url } = await startBridge()
    const answer = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      token: 'a-room-token',
      body: { limit: 1, unlocked: false, confirmed: true },
    })
    expect(answer.status).toBe(403)
    expect(answer.body.error).toBe(TOKEN_DEPTH_PROBLEM)
  })

  it('refuses a depth past 2 without an unlock and needs a confirmation', async () => {
    const { url, runsFolder } = await startBridge()
    const deep = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 3, unlocked: false, confirmed: true },
    })
    expect(deep.status).toBe(400)
    expect(deep.body.error).toBe(UNLOCK_DEPTH_PROBLEM)
    expect(existsSync(agentDepthFileFor(runsFolder))).toBe(false)

    const unconfirmed = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 1, unlocked: false },
    })
    expect(unconfirmed.status).toBe(400)
    expect(unconfirmed.body.error).toBe(CONFIRM_DEPTH_PROBLEM)

    const outOfRange = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 5, unlocked: true, confirmed: true },
    })
    expect(outOfRange.status).toBe(400)
    expect(outOfRange.body.error).toBe(LIMIT_DEPTH_PROBLEM)
  })

  it('saves an unlocked 3 or 4 and reads it back', async () => {
    const { url, runsFolder } = await startBridge()
    const saved = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 3, unlocked: true, confirmed: true },
    })
    expect(saved.status).toBe(200)
    expect(saved.body).toEqual({ ok: true, limit: 3, unlocked: true, deepest: 0, deepestAgents: 0, rings: [] })
    expect(JSON.parse(readFileSync(agentDepthFileFor(runsFolder), 'utf8'))).toEqual({ limit: 3, unlocked: true })

    const read = await request(`${url}/api/agent-depth`, { origin: '' })
    expect(read.body).toEqual({ limit: 3, unlocked: true, deepest: 0, deepestAgents: 0, rings: [] })

    const deeper = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 4, unlocked: true, confirmed: true },
    })
    expect(deeper.status).toBe(200)
    expect(deeper.body).toEqual({ ok: true, limit: 4, unlocked: true, deepest: 0, deepestAgents: 0, rings: [] })

    const locked = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: AGENT_DEPTH_DEFAULT, unlocked: false, confirmed: true },
    })
    expect(locked.status).toBe(200)
    expect(locked.body).toEqual({ ok: true, limit: AGENT_DEPTH_DEFAULT, unlocked: false, deepest: 0, deepestAgents: 0, rings: [] })
  })

  it('answers deepest 0 when only the main orchestrator lanes exist and skips off lanes', async () => {
    const { url } = await startBridge({ withLanes: true })
    const inactive = await request(`${url}/api/agent-depth`, { origin: '' })
    expect(inactive.status).toBe(200)
    expect(inactive.body).toEqual({ limit: AGENT_DEPTH_DEFAULT, unlocked: false, deepest: 0, deepestAgents: 0, rings: [] })

    const turnedOn = await request(`${url}/api/lanes/active`, {
      method: 'POST',
      body: { lanes: ['opencode', 'opencode2', 'claude'], confirmed: true },
    })
    expect(turnedOn.status).toBe(200)

    const answer = await request(`${url}/api/agent-depth`, { origin: '' })
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({
      limit: AGENT_DEPTH_DEFAULT,
      unlocked: false,
      deepest: 0,
      deepestAgents: 3,
      rings: [{ ring: 0, agents: 3 }],
    })

    const lowered = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 1, unlocked: false, confirmed: true },
    })
    expect(lowered.status).toBe(200)
    expect(lowered.body).toEqual({
      ok: true,
      limit: 1,
      unlocked: false,
      deepest: 0,
      deepestAgents: 3,
      rings: [{ ring: 0, agents: 3 }],
    })
  })

  it('counts only active agents on an occupied ring and refuses a lower depth unless hideOccupied is true', async () => {
    const { bridge, url, runsFolder } = await startBridge({ withLanes: true })
    const result = bridge.orchestrators().ladderChange(
      {
        confirmed: true,
        by: 'owner',
        ladder: {
          subs: [
            {
              id: 'frontend',
              name: 'Frontend',
              harness: 'opencode',
              model: 'opencode-go/deepseek-v4.1-flash',
              lanes: ['opencode', 'opencode2'],
              scope: ['src/ui/**'],
              restricted: false,
              setBy: 'owner',
            },
          ],
        },
      },
      true
    )
    expect(result.status).toBe(200)

    const onlySub = await request(`${url}/api/agent-depth`, { origin: '' })
    expect(onlySub.status).toBe(200)
    expect(onlySub.body).toEqual({
      limit: AGENT_DEPTH_DEFAULT,
      unlocked: false,
      deepest: 1,
      deepestAgents: 1,
      rings: [{ ring: 1, agents: 1 }],
    })

    const refusedWithOffLanes = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 1, unlocked: false, confirmed: true },
    })
    expect(refusedWithOffLanes.status).toBe(409)
    expect(refusedWithOffLanes.body).toEqual({
      error: 'Ring 1 holds 1 agent. A depth of 1 hides it until you raise it again.',
      deepest: 1,
      deepestAgents: 1,
      rings: [{ ring: 1, agents: 1 }],
    })

    const active = await request(`${url}/api/lanes/active`, {
      method: 'POST',
      body: { lanes: ['opencode', 'opencode2'], confirmed: true },
    })
    expect(active.status).toBe(200)

    const before = await request(`${url}/api/agent-depth`, { origin: '' })
    expect(before.status).toBe(200)
    expect(before.body).toEqual({
      limit: AGENT_DEPTH_DEFAULT,
      unlocked: false,
      deepest: 1,
      deepestAgents: 3,
      rings: [{ ring: 1, agents: 3 }],
    })

    const refused = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 1, unlocked: false, confirmed: true },
    })
    expect(refused.status).toBe(409)
    expect(refused.body).toEqual({
      error: occupiedDepthProblem(1, 3, 1),
      deepest: 1,
      deepestAgents: 3,
      rings: [{ ring: 1, agents: 3 }],
    })
    expect(refused.body.error).toBe('Ring 1 holds 3 agents. A depth of 1 hides them until you raise it again.')
    expect(readAgentDepth(runsFolder)).toEqual({ limit: AGENT_DEPTH_DEFAULT, unlocked: false })

    const forced = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 1, unlocked: false, confirmed: true, hideOccupied: true },
    })
    expect(forced.status).toBe(200)
    expect(forced.body).toEqual({
      ok: true,
      limit: 1,
      unlocked: false,
      deepest: 1,
      deepestAgents: 3,
      rings: [{ ring: 1, agents: 3 }],
    })
    expect(readAgentDepth(runsFolder)).toEqual({ limit: 1, unlocked: false })

    const unlockedAtOne = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 1, unlocked: true, confirmed: true },
    })
    expect(unlockedAtOne.status).toBe(200)
    expect(unlockedAtOne.body).toEqual({
      ok: true,
      limit: 1,
      unlocked: true,
      deepest: 1,
      deepestAgents: 3,
      rings: [{ ring: 1, agents: 3 }],
    })
  })

  it('tracks nested subs across rings and names every hidden ring on a multi-ring drop', async () => {
    const { bridge, url, runsFolder } = await startBridge({ withLanes: true })
    saveAgentDepth(runsFolder, { limit: 4, unlocked: true })
    const result = bridge.orchestrators().ladderChange(
      {
        confirmed: true,
        by: 'owner',
        ladder: {
          subs: [
            {
              id: 'frontend',
              name: 'Frontend',
              harness: 'opencode',
              model: 'opencode-go/deepseek-v4.1-flash',
              lanes: ['opencode', 'opencode2'],
              scope: ['src/ui/**'],
              restricted: false,
              setBy: 'owner',
            },
            {
              id: 'forms',
              name: 'Forms',
              parent: 'frontend',
              harness: 'opencode',
              model: 'opencode-go/deepseek-v4.1-flash',
              lanes: [],
              scope: ['src/ui/**'],
              restricted: false,
              setBy: 'owner',
            },
          ],
        },
      },
      true
    )
    expect(result.status).toBe(200)

    const active = await request(`${url}/api/lanes/active`, {
      method: 'POST',
      body: { lanes: ['opencode', 'opencode2'], confirmed: true },
    })
    expect(active.status).toBe(200)

    const expectedRings = [
      { ring: 1, agents: 3 },
      { ring: 2, agents: 1 },
    ]

    const before = await request(`${url}/api/agent-depth`, { origin: '' })
    expect(before.status).toBe(200)
    expect(before.body).toEqual({ limit: 4, unlocked: true, deepest: 2, deepestAgents: 1, rings: expectedRings })

    const toOne = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 1, unlocked: false, confirmed: true },
    })
    expect(toOne.status).toBe(409)
    expect(toOne.body).toEqual({
      error: 'Rings 1 and 2 hold 4 agents. A depth of 1 hides them until you raise it again.',
      deepest: 2,
      deepestAgents: 1,
      rings: expectedRings,
    })

    const toThree = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 3, unlocked: true, confirmed: true },
    })
    expect(toThree.status).toBe(200)
    expect(toThree.body).toEqual({ ok: true, limit: 3, unlocked: true, deepest: 2, deepestAgents: 1, rings: expectedRings })

    const toTwo = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 2, unlocked: false, confirmed: true },
    })
    expect(toTwo.status).toBe(409)
    expect(toTwo.body).toEqual({
      error: 'Ring 2 holds 1 agent. A depth of 2 hides it until you raise it again.',
      deepest: 2,
      deepestAgents: 1,
      rings: expectedRings,
    })

    const forced = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 2, unlocked: false, confirmed: true, hideOccupied: true },
    })
    expect(forced.status).toBe(200)
    expect(forced.body).toEqual({ ok: true, limit: 2, unlocked: false, deepest: 2, deepestAgents: 1, rings: expectedRings })
  })

  it('computes deepestRing and occupiedDepthProblem directly from a family tree', () => {
    expect(deepestRing([])).toEqual({ deepest: 0, deepestAgents: 0, rings: [] })
    expect(
      deepestRing([
        { id: 'orchestrator', kind: 'orchestrator', parent: null, active: true },
        { id: 'opencode', kind: 'lane', parent: 'orchestrator', active: true },
        { id: 'off-lane', kind: 'lane', parent: 'orchestrator', active: false },
      ])
    ).toEqual({ deepest: 0, deepestAgents: 1, rings: [{ ring: 0, agents: 1 }] })
    expect(
      deepestRing([
        { id: 'orchestrator', kind: 'orchestrator', parent: null, active: true },
        { id: 'sub1', kind: 'sub', parent: 'orchestrator', active: true },
        { id: 'lane1', kind: 'lane', parent: 'sub1', active: true },
        { id: 'lane2', kind: 'lane', parent: 'sub1', active: false },
        { id: 'sub2', kind: 'sub', parent: 'sub1', active: true },
        { id: 'sub3', kind: 'sub', parent: 'sub2', active: false },
      ])
    ).toEqual({
      deepest: 2,
      deepestAgents: 1,
      rings: [
        { ring: 1, agents: 2 },
        { ring: 2, agents: 1 },
      ],
    })
    expect(occupiedDepthProblem(1, 1, 1)).toBe('Ring 1 holds 1 agent. A depth of 1 hides it until you raise it again.')
    expect(occupiedDepthProblem(2, 3, 2)).toBe('Ring 2 holds 3 agents. A depth of 2 hides them until you raise it again.')
    expect(
      occupiedDepthProblem(
        [
          { ring: 0, agents: 2 },
          { ring: 1, agents: 3 },
          { ring: 2, agents: 1 },
        ],
        1
      )
    ).toBe('Rings 1 and 2 hold 4 agents. A depth of 1 hides them until you raise it again.')
    expect(
      occupiedDepthProblem(
        [
          { ring: 0, agents: 2 },
          { ring: 1, agents: 3 },
          { ring: 2, agents: 1 },
        ],
        2
      )
    ).toBe('Ring 2 holds 1 agent. A depth of 2 hides it until you raise it again.')
    expect(
      occupiedDepthProblem(
        [
          { ring: 1, agents: 2 },
          { ring: 2, agents: 1 },
          { ring: 3, agents: 2 },
        ],
        1
      )
    ).toBe('Rings 1, 2 and 3 hold 5 agents. A depth of 1 hides them until you raise it again.')
  })

  it('ignores inactive nodes in deepestRing even when an inactive sub sits deeper than active ones', () => {
    const info = deepestRing([
      { id: 'orchestrator', kind: 'orchestrator', parent: null, active: true },
      { id: 'sub1', kind: 'sub', parent: 'orchestrator', active: true },
      { id: 'off-lane-1', kind: 'lane', parent: 'sub1', active: false },
      { id: 'off-lane-2', kind: 'lane', parent: 'sub1', active: false },
      { id: 'off-sub', kind: 'sub', parent: 'sub1', active: false },
    ])
    expect(info).toEqual({
      deepest: 1,
      deepestAgents: 1,
      rings: [{ ring: 1, agents: 1 }],
    })
    expect(occupiedDepthProblem(info.rings, 1)).toBe(
      'Ring 1 holds 1 agent. A depth of 1 hides it until you raise it again.'
    )
  })

  it('names every occupied ring on a 4 to 1 drop across three rings', async () => {
    const { bridge, url, runsFolder } = await startBridge({ withLanes: true })
    saveAgentDepth(runsFolder, { limit: 4, unlocked: true })
    const result = bridge.orchestrators().ladderChange(
      {
        confirmed: true,
        by: 'owner',
        ladder: {
          subs: [
            {
              id: 'ring1',
              name: 'Ring 1',
              harness: 'opencode',
              model: 'opencode-go/deepseek-v4.1-flash',
              lanes: ['opencode'],
              scope: ['src/**'],
              restricted: false,
              setBy: 'owner',
            },
            {
              id: 'ring2',
              name: 'Ring 2',
              parent: 'ring1',
              harness: 'opencode',
              model: 'opencode-go/deepseek-v4.1-flash',
              lanes: ['opencode2'],
              scope: ['src/**'],
              restricted: false,
              setBy: 'owner',
            },
            {
              id: 'ring3',
              name: 'Ring 3',
              parent: 'ring2',
              harness: 'opencode',
              model: 'opencode-go/deepseek-v4.1-flash',
              lanes: [],
              scope: ['src/**'],
              restricted: false,
              setBy: 'owner',
            },
          ],
        },
      },
      true
    )
    expect(result.status).toBe(200)

    const active = await request(`${url}/api/lanes/active`, {
      method: 'POST',
      body: { lanes: ['claude', 'opencode'], confirmed: true },
    })
    expect(active.status).toBe(200)

    const toOne = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 1, unlocked: false, confirmed: true },
    })
    expect(toOne.status).toBe(409)
    expect(toOne.body).toEqual({
      error: 'Rings 1, 2 and 3 hold 4 agents. A depth of 1 hides them until you raise it again.',
      deepest: 3,
      deepestAgents: 1,
      rings: [
        { ring: 0, agents: 1 },
        { ring: 1, agents: 2 },
        { ring: 2, agents: 1 },
        { ring: 3, agents: 1 },
      ],
    })

    const toTwo = await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 2, unlocked: false, confirmed: true },
    })
    expect(toTwo.status).toBe(409)
    expect(toTwo.body.error).toBe('Rings 2 and 3 hold 2 agents. A depth of 2 hides them until you raise it again.')
  })

  it('sends an agents notice after a write', async () => {
    const { url } = await startBridge()
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
            if (lines.some((line) => line.trim() === 'event: change')) {
              const dataLine = lines.find((line) => line.startsWith('data: '))
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

    await request(`${url}/api/agent-depth`, {
      method: 'POST',
      body: { limit: 1, unlocked: false, confirmed: true },
    })

    const deadline = Date.now() + 10000
    while (!notices.some((notice) => notice.topic === 'agents') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(notices.some((notice) => notice.topic === 'agents')).toBe(true)
  })
})
