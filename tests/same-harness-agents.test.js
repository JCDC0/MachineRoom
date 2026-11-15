import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { readProposals } from '../server/family.js'
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
  const token = rig.bridge.orchestrators().token('orchestrator')

  const res = await post(
    `${rig.url}/api/orchestrator/ladder`,
    {
      ladder: {
        subs: [
          sub({ id: 'hydrogen', name: 'Hydrogen', harness: 'agy', model: 'gemini-4-hydrogen-xhigh', lanes: ['agy'] }),
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
      ladder: { subs: [sub()] },
      by: 'orchestrator',
      confirmed: true,
    },
    { token }
  )

  expect(res.status).toBe(400)
  expect(res.body.error).toBe('An orchestrator can add agents only on its own harness (agy).')
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
