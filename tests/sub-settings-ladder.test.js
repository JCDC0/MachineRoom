import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { getJson } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const rigs = []
const sub = { id: 'sub', name: 'Sub', harness: 'codex', model: 'gpt-6.1-terra', effort: 'medium', lanes: ['codex'], scope: ['src/**'], restricted: false, setBy: 'owner' }
const lanes = {
  orchestrator: { name: 'Main', cli: { harness: 'claude', bin: process.execPath, model: 'sonnet' } },
  codex: { name: 'Codex', cli: { harness: 'codex', bin: process.execPath, model: 'gpt-6.1-terra' } },
  claude: { name: 'Claude', cli: { harness: 'claude', bin: process.execPath, model: 'sonnet' } },
}

afterEach(async () => {
  for (const rig of rigs.splice(0)) {
    rig.child?.emit('close', 0)
    await rig.bridge.stop()
    removeTempDir(rig.base)
  }
})

async function start() {
  const base = makeTempDir('mr-sub-settings-')
  const runs = join(base, 'runs')
  mkdirSync(runs)
  writeActiveLanes(activeLanesFileFor(base, runs), ['codex', 'claude'])
  const child = new EventEmitter()
  const bridge = createBridge({ projectRoot: base, port: 0, env: {}, lanesSource: { folder: runs, lanes, pollMs: 20, quietMs: 60000 }, orchestratorHarnessAvailable: () => true, orchestratorSpawn: () => child })
  const { url } = await bridge.start()
  const rig = { base, bridge, url, child }
  rigs.push(rig)
  expect((await save(rig, sub)).status).toBe(200)
  return rig
}

function post(rig, path, body) {
  return getJson(rig.url + '/api/orchestrator/' + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: JSON.stringify({ id: 'sub', confirmed: true, ...body }) })
}

function save(rig, entry) {
  return post(rig, 'ladder', { ladder: { subs: [entry] }, by: 'owner' })
}

it('keeps the changed effort when the scope is saved', async () => {
  const rig = await start()
  expect((await post(rig, 'effort', { effort: 'high' })).status).toBe(200)
  const { effort, ...entry } = rig.bridge.orchestrators().getLadder().subs[0]
  const saved = await save(rig, { ...entry, scope: ['server/**'] })
  expect(saved.status).toBe(200)
  expect(saved.body.ladder.subs[0].effort).toBe('high')
  expect(rig.bridge.orchestrators().find('sub').answer().effort).toBe('high')
})

it('keeps the changed model when the scope is saved', async () => {
  const rig = await start()
  expect((await post(rig, 'model', { model: 'gpt-6.1-sol' })).status).toBe(200)
  const entry = rig.bridge.orchestrators().getLadder().subs[0]
  const saved = await save(rig, { ...entry, scope: ['server/**'] })
  expect(saved.status).toBe(200)
  expect(saved.body.ladder.subs[0].model).toBe('gpt-6.1-sol')
  expect(rig.bridge.orchestrators().find('sub').answer().model).toBe('gpt-6.1-sol')
})

it('keeps a working turn when its unchanged ladder is saved after a harness change', async () => {
  const rig = await start()
  expect((await post(rig, 'effort', { effort: 'xhigh' })).status).toBe(200)
  expect((await post(rig, 'mode', { mode: 'bypass' })).status).toBe(200)
  const changed = await post(rig, 'harness', { harness: 'claude', model: 'claude-sonnet-5-5' })
  expect(changed.status).toBe(200)
  expect(changed.body).toMatchObject({ effort: 'xhigh', mode: 'auto' })
  const registry = rig.bridge.orchestrators()
  const instance = registry.find('sub')
  expect(instance.send({ text: 'Work', confirmed: true }).status).toBe(202)
  expect(instance.answer().state).toBe('working')
  const saved = await save(rig, registry.getLadder().subs[0])
  expect(saved.status).toBe(200)
  expect(registry.find('sub') === instance).toBe(true)
  expect(instance.answer().state).toBe('working')
  expect(registry.getLadder().subs[0]).toMatchObject({ harness: 'claude', model: 'claude-sonnet-5-5' })
})
