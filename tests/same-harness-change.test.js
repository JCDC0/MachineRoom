import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { sameHarnessProblem } from '../server/orchestrators.js'
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

const AGY_LANES = {
  orchestrator: {
    name: 'Orchestrator',
    harness: 'AGY',
    cli: { harness: 'agy', bin: process.execPath, model: 'gemini-4-argon-high' },
  },
  ...LANES,
}

async function start(lanes) {
  const base = makeTempDir('mr-same-harness-change-')
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

function agySub() {
  return {
    id: 'backend',
    name: 'Backend',
    harness: 'agy',
    model: 'gemini-4-hydrogen-xhigh',
    lanes: ['agy'],
    scope: ['server/**'],
    restricted: false,
    setBy: 'owner',
  }
}

function codexSub() {
  return {
    ...agySub(),
    harness: 'codex',
    model: 'gpt-6.1-terra',
    lanes: ['codex'],
  }
}

async function saveAsOwner(url, subs) {
  return post(url + '/api/orchestrator/ladder', { ladder: { subs }, by: 'owner', confirmed: true }, { page: true })
}

it('refuses an AGY orchestrator moving an existing AGY sub to Codex', async () => {
  const rig = await start(AGY_LANES)

  const saved = await saveAsOwner(rig.url, [agySub()])
  expect(saved.status).toBe(200)

  const token = rig.bridge.orchestrators().token('orchestrator')
  const res = await post(
    rig.url + '/api/orchestrator/ladder',
    { ladder: { subs: [codexSub()] }, by: 'orchestrator', confirmed: true },
    { token }
  )

  expect(res.status).toBe(400)
  expect(res.body.error).toBe(sameHarnessProblem('agy'))
  expect(rig.bridge.orchestrators().getLadder().subs[0].harness).toBe('agy')
})

it('lets the page move an existing AGY sub to Codex', async () => {
  const rig = await start(AGY_LANES)

  const saved = await saveAsOwner(rig.url, [agySub()])
  expect(saved.status).toBe(200)

  const res = await saveAsOwner(rig.url, [codexSub()])

  expect(res.status).toBe(200)
  expect(res.body.ladder.subs[0]).toMatchObject({ id: 'backend', harness: 'codex', model: 'gpt-6.1-terra' })
  expect(rig.bridge.orchestrators().getLadder().subs[0].harness).toBe('codex')
})
