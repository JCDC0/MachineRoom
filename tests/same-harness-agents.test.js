import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { saveAgentDepth } from '../server/agent-depth.js'
import { readProposals } from '../server/family.js'
import { seatsFileFor, writeSeats } from '../server/seats.js'
import { getJson } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const rigs = []

afterEach(async () => {
  for (const rig of rigs.splice(0)) {
    if (rig.bridge) await rig.bridge.stop()
    removeTempDir(rig.base)
  }
})

const LANES = {
  claude: {
    name: 'Claude Code',
    harness: 'Claude Code',
    cli: { harness: 'claude', bin: process.execPath, model: 'sonnet' },
  },
  opencode: {
    name: 'OpenCode',
    harness: 'OpenCode',
    cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' },
  },
  agy: {
    name: 'AGY',
    custom: true,
    harness: 'AGY',
    cli: { harness: 'agy', bin: process.execPath, model: 'gemini-4-hydrogen-xhigh' },
  },
  codex: {
    name: 'Codex',
    harness: 'Codex',
    cli: { harness: 'codex', bin: process.execPath, model: 'gpt-6.1-terra' },
  },
}

const CLAUDE_LANES = {
  orchestrator: {
    name: 'Orchestrator',
    harness: 'Claude Code',
    cli: { harness: 'claude', bin: process.execPath, model: 'opus' },
  },
  ...LANES,
}

const AGY_LANES = {
  ...CLAUDE_LANES,
  orchestrator: {
    name: 'Orchestrator',
    harness: 'AGY',
    cli: { harness: 'agy', bin: process.execPath, model: 'gemini-4-argon-high' },
  },
}

async function start(lanes) {
  const base = makeTempDir('mr-same-harness-')
  const runs = join(base, 'runs')
  mkdirSync(runs)
  writeActiveLanes(activeLanesFileFor(base, runs), ['claude', 'opencode', 'agy', 'codex'])
  const bridge = createBridge({
    projectRoot: base,
    port: 0,
    env: {},
    lanesSource: { folder: runs, lanes, pollMs: 20, quietMs: 60000 },
  })
  const { url } = await bridge.start()
  const rig = { base, runs, bridge, url }
  rigs.push(rig)
  return rig
}

function post(url, body, { token = '', page = false } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers['x-machineroom-orchestrator'] = token
  if (page) headers.origin = 'http://localhost:5173'
  return getJson(url, { method: 'POST', headers, body: JSON.stringify(body) })
}

function proposal(body) {
  return { parent: 'orchestrator', reason: 'Help with the work.', ...body }
}

function sub(overrides = {}) {
  return {
    id: 'backend',
    name: 'Backend',
    harness: 'codex',
    model: 'gpt-6.1-terra',
    lanes: ['codex'],
    scope: ['server/**'],
    restricted: false,
    setBy: 'orchestrator',
    ...overrides,
  }
}

it('refuses a Claude orchestrator proposing an OpenCode lane', async () => {
  const rig = await start(CLAUDE_LANES)
  const token = rig.bridge.orchestrators().token('orchestrator')

  const res = await post(
    `${rig.url}/api/family/proposals`,
    proposal({ label: 'OpenCode worker', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' }),
    { token }
  )

  expect(res.status).toBe(400)
  expect(res.body.error).toBe('An orchestrator can add agents only on its own harness (claude).')
  expect(readProposals(rig.runs)).toHaveLength(0)
})

it('accepts a Claude orchestrator proposing a Claude lane with another Claude model', async () => {
  const rig = await start(CLAUDE_LANES)
  const token = rig.bridge.orchestrators().token('orchestrator')

  const res = await post(
    `${rig.url}/api/family/proposals`,
    proposal({ label: 'Claude worker', harness: 'claude', model: 'claude-haiku-5-5' }),
    { token }
  )

  expect(res.status).toBe(200)
  expect(res.body).toMatchObject({ harness: 'claude', model: 'claude-haiku-5-5' })
})

it('accepts an AGY orchestrator adding an AGY sub on another model', async () => {
  const rig = await start(AGY_LANES)
  writeSeats(seatsFileFor(rig.base, rig.runs), { rings: [4, 1], grants: { orchestrator: { lanes: 0, subs: 1 } } })
  const token = rig.bridge.orchestrators().token('orchestrator')

  const res = await post(
    `${rig.url}/api/orchestrator/ladder`,
    {
      ladder: {
        subs: [
          sub({ id: 'hydrogen', name: 'Hydrogen', harness: 'agy', model: 'gemini-4-hydrogen-xhigh', lanes: [] }),
        ],
      },
      by: 'orchestrator',
      confirmed: true,
    },
    { token }
  )

  expect(res.status).toBe(200)
  expect(res.body.ladder.subs[0]).toMatchObject({
    id: 'hydrogen',
    harness: 'agy',
    model: 'gemini-4-hydrogen-xhigh',
  })
})

it('refuses an AGY orchestrator adding a Codex sub', async () => {
  const rig = await start(AGY_LANES)
  const token = rig.bridge.orchestrators().token('orchestrator')

  const res = await post(
    `${rig.url}/api/orchestrator/ladder`,
    {
      ladder: { subs: [sub({ lanes: [] })] },
      by: 'orchestrator',
      confirmed: true,
    },
    { token }
  )

  expect(res.status).toBe(409)
  expect(res.body.error).toBe('You can make agents only on your own harness, agy.')
  expect(rig.bridge.orchestrators().getLadder().subs).toHaveLength(0)
})

it('does not check a saved sub again when an orchestrator saves it back', async () => {
  const rig = await start(AGY_LANES)

  const saved = await post(
    `${rig.url}/api/orchestrator/ladder`,
    {
      ladder: { subs: [sub({ setBy: 'owner' })] },
      by: 'owner',
      confirmed: true,
    },
    { page: true }
  )
  expect(saved.status).toBe(200)

  const token = rig.bridge.orchestrators().token('orchestrator')
  const renamed = await post(
    `${rig.url}/api/orchestrator/ladder`,
    {
      ladder: { subs: [sub({ setBy: 'owner', name: 'Backend kept' })] },
      by: 'orchestrator',
      confirmed: true,
    },
    { token }
  )

  expect(renamed.status).toBe(200)
  expect(renamed.body.ladder.subs[0].name).toBe('Backend kept')
})

it('accepts the owner page proposing any harness', async () => {
  const rig = await start(CLAUDE_LANES)

  const res = await post(
    `${rig.url}/api/family/proposals`,
    proposal({ label: 'OpenCode worker', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' }),
    { page: true }
  )

  expect(res.status).toBe(200)
  expect(res.body).toMatchObject({ from: 'owner', harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' })
})

it('creates under a restricted sub and parks the second concurrent lane', async () => {
  const rig = await start(CLAUDE_LANES)
  const scout = sub({ id: 'scout', harness: 'claude', model: 'sonnet', lanes: [], restricted: true })
  expect((await post(`${rig.url}/api/orchestrator/ladder`, { confirmed: true, ladder: { subs: [scout] } }, { page: true })).status).toBe(200)
  writeSeats(seatsFileFor(rig.base, rig.runs), { rings: [4, 2], grants: { scout: { lanes: 2, subs: 0 } } })
  const auth = { token: rig.bridge.orchestrators().token('scout') }
  const create = (name, harness = 'claude') => post(`${rig.url}/api/lanes/create`, { confirmed: true, name, harness }, auth)
  expect(await create('Wrong harness', 'codex')).toEqual({ status: 409, body: { error: 'You can make agents only on your own harness, claude.' } })
  const results = await Promise.all([create('First'), create('Second')])
  expect(results.map((result) => result.status)).toEqual([200, 200])
  const on = results.find((result) => result.body.active).body.key
  const off = results.find((result) => !result.body.active).body.key
  expect(results.filter((result) => result.body.active)).toHaveLength(1)
  expect(results.find((result) => !result.body.active).body.reason).toBe('Ring 1 is full: 2 of 2 seats are taken.')
  const family = (await getJson(`${rig.url}/api/family`)).body.nodes
  for (const key of [on, off]) {
    expect(family.find((node) => node.id === key)).toMatchObject({ parent: 'scout', createdBy: 'scout', active: key === on })
  }
  expect(rig.bridge.orchestrators().sectorForLane(off)?.id).toBe('scout')

  const set = (lanes) => post(`${rig.url}/api/lanes/active`, { confirmed: true, lanes }, auth)
  expect(await set(['opencode'])).toEqual({ status: 409, body: { error: 'You can change only the agents under you.' } })
  expect((await set([on, off])).status).toBe(409)
  const swapped = await set([off])
  expect(swapped.status).toBe(200)
  expect(swapped.body.lanes).toContain('opencode')
  expect(swapped.body.lanes).toContain(off)
  expect(swapped.body.lanes).not.toContain(on)
})

it('adds a nested restricted sub and rejects a concurrent claim on its last seat', async () => {
  const rig = await start(CLAUDE_LANES)
  const scout = sub({ id: 'scout', harness: 'claude', model: 'sonnet', lanes: [], restricted: true, scope: ['server/**', 'tests/*/unit-*.js'] })
  const add = (child, auth) => post(`${rig.url}/api/orchestrator/ladder`, { confirmed: true, ladder: { subs: [child] } }, auth)
  expect((await add(scout, { page: true })).status).toBe(200)
  saveAgentDepth(rig.runs, { limit: 3, unlocked: true })
  writeSeats(seatsFileFor(rig.base, rig.runs), { rings: [4, 2, 1], grants: { scout: { lanes: 0, subs: 2 } } })
  const auth = { token: rig.bridge.orchestrators().token('scout') }
  const child = { ...scout, parent: 'orchestrator', createdBy: 'owner', restricted: false, setBy: 'owner' }
  expect((await add({ ...child, id: 'wide', scope: ['server/**', 'tests/**/unit-*.js'] }, auth)).status).toBe(409)
  expect((await add({ ...child, id: 'bad-model', model: 'missing-model' }, auth)).status).toBe(400)
  const results = await Promise.all([add({ ...child, id: 'first' }, auth), add({ ...child, id: 'second' }, auth)])
  expect(results.map((result) => result.status).sort()).toEqual([200, 409])
  expect(results.find((result) => result.status === 409).body.error).toBe('Ring 2 is full: 1 of 1 seats are taken.')
  const ladder = rig.bridge.orchestrators().getLadder()
  expect(ladder.subs).toHaveLength(2)
  expect(ladder.subs[1]).toMatchObject({ parent: 'scout', createdBy: 'scout', restricted: true, setBy: 'orchestrator' })
  expect(rig.bridge.orchestrators().find(ladder.subs[1].id).answer().parent).toBe('scout')
})

it('requires the owner to confirm a named full ring before writing', async () => {
  const rig = await start(CLAUDE_LANES)
  writeSeats(seatsFileFor(rig.base, rig.runs), { rings: [0, 0], grants: {} })
  const auth = { page: true }
  const laneUrl = `${rig.url}/api/lanes/create`
  const lane = { confirmed: true, name: 'Owner lane', harness: 'claude' }
  expect((await post(laneUrl, lane, auth))).toEqual({ status: 409, body: { error: 'Confirm going past the seats on ring 0.', overRing: 0 } })
  const made = await post(laneUrl, { ...lane, overRing: 0 }, auth)
  expect(made.status).toBe(200)
  const activeUrl = `${rig.url}/api/lanes/active`
  expect((await post(activeUrl, { confirmed: true, lanes: [] }, auth)).status).toBe(200)
  const active = { confirmed: true, lanes: [made.body.key] }
  expect((await post(activeUrl, active, auth)).body.overRing).toBe(0)
  expect((await post(activeUrl, { ...active, overRing: 0 }, auth)).status).toBe(200)
  const ladderUrl = `${rig.url}/api/orchestrator/ladder`
  const ladder = { confirmed: true, ladder: { subs: [sub({ lanes: [] })] } }
  expect((await post(ladderUrl, ladder, auth)).body.overRing).toBe(1)
  expect(rig.bridge.orchestrators().getLadder().subs).toEqual([])
  expect((await post(ladderUrl, { ...ladder, overRing: 1 }, auth)).status).toBe(200)
  const selfParent = { ...ladder, ladder: { subs: [sub({ lanes: [], parent: 'backend' })] } }
  const saved = await post(ladderUrl, selfParent, auth)
  expect(saved.status).toBe(200)
  expect(saved.body.ladder.subs[0].parent).toBe('orchestrator')
})
