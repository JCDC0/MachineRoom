import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { chatFileFor } from '../server/orchestrator.js'
import { modelUnavailableProblem } from '../server/model-list.js'
import { getJson } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const lanes = {
  orchestrator: { name: 'Orchestrator', cli: { harness: 'claude', bin: process.execPath, model: 'opus' } },
  opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' } },
  opencode2: { name: 'OpenCode 2', cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' } },
}
const rigs = []

afterEach(async () => {
  for (const rig of rigs.splice(0)) {
    if (rig.bridge) await rig.bridge.stop()
    removeTempDir(rig.base)
  }
})

function sub(overrides = {}) {
  return {
    id: 'frontend',
    name: 'Frontend',
    harness: 'opencode',
    model: '',
    lanes: ['opencode'],
    scope: ['src/ui/**'],
    restricted: true,
    setBy: 'owner',
    ...overrides,
  }
}

function makeRig(saved = null) {
  const base = makeTempDir('mr-ladder-model-')
  const runs = join(base, 'runs')
  mkdirSync(runs)
  writeActiveLanes(activeLanesFileFor(base, runs), ['opencode', 'opencode2'])
  if (saved) {
    const chat = { project: base, sessionId: null, state: 'idle', messages: [], pending: [], ladder: saved }
    writeFileSync(chatFileFor(base, runs, 'orchestrator'), `${JSON.stringify(chat)}\n`)
  }
  const rig = { base, runs }
  rigs.push(rig)
  return rig
}

async function start(rig) {
  rig.bridge = createBridge({
    projectRoot: rig.base,
    port: 0,
    env: {},
    briefsDir: join(root, 'docs', 'agents'),
    lanesFile: join(root, 'docs', 'agents', 'lanes.json'),
    lanesSource: { folder: rig.runs, lanes, pollMs: 20, quietMs: 60000 },
    orchestratorHarnessAvailable: () => true,
  })
  rig.url = (await rig.bridge.start()).url
}

function saveLadder(url, subs) {
  return getJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify({ ladder: { subs }, by: 'owner', confirmed: true }),
  })
}

it('refuses a new OpenCode sub with a model its harness does not list', async () => {
  const rig = makeRig()
  await start(rig)

  const res = await saveLadder(`${rig.url}/api/orchestrator/ladder`, [sub({ model: 'opencode-go/not-a-model' })])

  expect(res.status).toBe(400)
  expect(res.body.problems).toEqual([modelUnavailableProblem('opencode-go/not-a-model', 'opencode')])
})

it('refuses a new Direct API sub with no model', async () => {
  const rig = makeRig()
  await start(rig)

  const res = await saveLadder(`${rig.url}/api/orchestrator/ladder`, [sub({ harness: 'machineroom', model: '' })])

  expect(res.status).toBe(400)
  expect(res.body.problems).toEqual([modelUnavailableProblem('', 'machineroom')])
})

it('saves a new OpenCode sub with no model as Harness default', async () => {
  const rig = makeRig()
  await start(rig)

  const res = await saveLadder(`${rig.url}/api/orchestrator/ladder`, [sub({ model: '' })])

  expect(res.status).toBe(200)
  expect(res.body.ladder.subs[0]).toMatchObject({ id: 'frontend', harness: 'opencode', model: '' })
})

it('does not check a saved sub whose model did not change', async () => {
  const legacy = sub({ id: 'legacy', model: 'opencode-go/not-a-model' })
  const rig = makeRig({ subs: [legacy] })
  await start(rig)

  const res = await saveLadder(`${rig.url}/api/orchestrator/ladder`, [
    legacy,
    sub({ id: 'backend', lanes: ['opencode2'], model: 'opencode/deepseek-v4.1-flash-free' }),
  ])

  expect(res.status).toBe(200)
  expect(res.body.ladder.subs.map((entry) => entry.id)).toEqual(['legacy', 'backend'])
})
