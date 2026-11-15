import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { writeActiveLanes, activeLanesFileFor } from '../server/active-lanes.js'
import { createOrchestrator } from '../server/orchestrator.js'
import { getJson } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const lanes = {
  orchestrator: { name: 'Orchestrator', cli: { harness: 'claude', bin: process.execPath, model: 'opus' } },
  opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' } },
}
const rigs = []

afterEach(async () => {
  for (const rig of rigs.splice(0)) {
    if (rig.bridge) await rig.bridge.stop()
    removeTempDir(rig.base)
  }
})

function makeRig() {
  const base = makeTempDir('mr-default-restart-')
  const runs = join(base, 'runs')
  mkdirSync(runs)
  writeActiveLanes(activeLanesFileFor(base, runs), ['opencode'])
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

function post(url, body) {
  return getJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  })
}

it('keeps the main harness default after a restart', async () => {
  const rig = makeRig()
  await start(rig)
  expect((await post(`${rig.url}/api/orchestrator/harness`, { harness: 'opencode', model: '', confirmed: true })).status).toBe(200)
  await rig.bridge.stop()
  rig.bridge = null
  await start(rig)
  expect((await getJson(`${rig.url}/api/orchestrator`)).body).toMatchObject({ harness: 'opencode', model: '' })
})

it.each(['', 'opencode/deepseek-v4.1-flash-free'])('keeps a new sub model %j', async (model) => {
  const rig = makeRig()
  await start(rig)
  const sub = { id: 'frontend', name: 'Frontend', harness: 'opencode', model, lanes: ['opencode'], scope: ['src/ui/**'], restricted: true, setBy: 'owner' }
  const saved = await post(`${rig.url}/api/orchestrator/ladder`, { ladder: { subs: [sub] }, by: 'owner', confirmed: true })
  expect(saved.status).toBe(200)
  expect((await getJson(`${rig.url}/api/orchestrators`)).body.find((item) => item.id === 'frontend').model).toBe(model)
})

it('uses the lane model only when the constructor model is absent', () => {
  for (const [model, expected] of [[undefined, 'claude-opus-5-5'], [null, 'claude-opus-5-5'], ['', '']]) {
    const rig = makeRig()
    const orchestrator = createOrchestrator({ projectRoot: rig.base, runsFolder: rig.runs, lanes, model })
    expect(orchestrator.answer().model).toBe(expected)
    orchestrator.close()
  }
})

