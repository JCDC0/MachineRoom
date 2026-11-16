import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { getJson, waitFor } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const rigs = []

const FAKE_CLAUDE = [
  "console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }))",
  "console.log(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } }))",
  "console.log(JSON.stringify({ type: 'result', subtype: 'success', result: 'Done.', total_cost_usd: 0.01, usage: { input_tokens: 1, output_tokens: 1 } }))",
].join('\n')

afterEach(async () => {
  for (const rig of rigs.splice(0)) {
    if (rig.bridge) await rig.bridge.stop()
    removeTempDir(rig.base)
  }
})

async function start() {
  const base = makeTempDir('mr-sub-settings-live-')
  const runs = join(base, 'runs')
  mkdirSync(runs)
  const codexBin = join(base, 'fake-codex-program')
  const claudeBin = join(base, 'fake-claude-program')
  const script = join(base, 'fake-agent.mjs')
  writeFileSync(codexBin, '')
  writeFileSync(claudeBin, '')
  writeFileSync(script, FAKE_CLAUDE)
  const lanes = {
    orchestrator: { name: 'Main', cli: { harness: 'claude', bin: claudeBin, model: 'claude-sonnet-5-5' } },
    codex: { name: 'Codex', cli: { harness: 'codex', bin: codexBin, model: 'gpt-6.1-terra' } },
    claude: { name: 'Claude', cli: { harness: 'claude', bin: claudeBin, model: 'claude-sonnet-5-5' } },
  }
  writeActiveLanes(activeLanesFileFor(base, runs), ['codex', 'claude'])
  const spawned = []
  const bridge = createBridge({
    projectRoot: base,
    port: 0,
    env: {},
    lanesSource: { folder: runs, lanes, pollMs: 20, quietMs: 60000 },
    orchestratorHarnessAvailable: () => true,
    orchestratorSpawn: (file, args, options) => {
      spawned.push({ file, args: [...args] })
      return spawn(process.execPath, [script, ...args], options)
    },
  })
  const { url } = await bridge.start()
  const rig = { base, runs, codexBin, claudeBin, spawned, bridge, url }
  rigs.push(rig)
  const sub = {
    id: 'sub',
    name: 'Sub',
    harness: 'codex',
    model: 'gpt-6.1-terra',
    effort: 'medium',
    lanes: ['codex'],
    scope: ['src/**'],
    restricted: false,
    setBy: 'owner',
  }
  expect((await save(rig, sub)).status).toBe(200)
  return rig
}

function post(rig, path, body) {
  return getJson(`${rig.url}/api/orchestrator/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify({ id: 'sub', confirmed: true, ...body }),
  })
}

function save(rig, entry) {
  return post(rig, 'ladder', { ladder: { subs: [entry] }, by: 'owner' })
}

it('spawns the new harness program after a route harness change and an unchanged ladder save', async () => {
  const rig = await start()
  const changed = await post(rig, 'harness', { harness: 'claude', model: 'claude-sonnet-5-5' })
  expect(changed.status).toBe(200)

  const registry = rig.bridge.orchestrators()
  const unchanged = await save(rig, registry.getLadder().subs[0])
  expect(unchanged.status).toBe(200)

  const sent = await post(rig, 'messages', { text: 'Work' })
  expect(sent.status).toBe(202)
  await waitFor(() => rig.spawned.length === 1 && registry.find('sub').answer().state === 'idle', {
    what: 'the sub turn to finish',
  })
  expect(rig.spawned[0].file).toBe(rig.claudeBin)
  expect(rig.spawned[0].args).toContain('-p')
})
