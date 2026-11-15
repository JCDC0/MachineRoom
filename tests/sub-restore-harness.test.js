import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { chatFileFor } from '../server/orchestrator.js'
import { getJson, waitFor } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const rigs = []

afterEach(async () => {
  for (const rig of rigs.splice(0)) {
    if (rig.bridge) await rig.bridge.stop()
    removeTempDir(rig.base)
  }
})

const LANES = {
  orchestrator: {
    name: 'Orchestrator',
    harness: 'Claude Code',
    cli: { harness: 'claude', bin: process.execPath, model: 'opus' },
  },
  claude: {
    name: 'Claude Code',
    harness: 'Claude Code',
    cli: { harness: 'claude', bin: process.execPath, model: 'sonnet' },
  },
  codex: {
    name: 'Codex',
    harness: 'Codex',
    cli: { harness: 'codex', bin: process.execPath, model: 'gpt-6.1-terra' },
  },
}

const FAKE_CLAUDE = [
  "import { appendFileSync } from 'node:fs'",
  'const args = process.argv.slice(2)',
  "appendFileSync(process.env.MR_CALLS, JSON.stringify({ args }) + '\\n')",
  "console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }))",
  "console.log(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Kept.' }] } }))",
  "console.log(JSON.stringify({ type: 'result', subtype: 'success', result: 'Kept.', total_cost_usd: 0.01, usage: { input_tokens: 1, output_tokens: 1 } }))",
].join('\n')

async function start() {
  const base = makeTempDir('mr-sub-restore-')
  const runs = join(base, 'runs')
  mkdirSync(runs)
  writeActiveLanes(activeLanesFileFor(base, runs), ['claude', 'codex'])
  const calls = join(base, 'calls.jsonl')
  const script = join(base, 'fake-claude.mjs')
  writeFileSync(script, FAKE_CLAUDE)
  const bridge = createBridge({
    projectRoot: base,
    port: 0,
    env: {},
    orchestratorSpawn: (source, args, options) => {
      const env = { ...(options.env ?? process.env), MR_CALLS: calls }
      return spawn(process.execPath, [script, ...args], { ...options, env })
    },
    lanesSource: { folder: runs, lanes: LANES, pollMs: 20, quietMs: 60000 },
  })
  const { url } = await bridge.start()
  const rig = { base, runs, bridge, url, calls }
  rigs.push(rig)
  return rig
}

function pagePost(url, body) {
  return getJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  })
}

function tokenPost(url, body, token) {
  return getJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-MachineRoom-Orchestrator': token },
    body: JSON.stringify(body),
  })
}

function sub(overrides = {}) {
  return {
    id: 'backend',
    name: 'Backend',
    harness: 'claude',
    model: 'sonnet',
    lanes: ['claude'],
    scope: ['server/**'],
    restricted: false,
    setBy: 'owner',
    ...overrides,
  }
}

function readCalls(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function readChat(rig, id) {
  return JSON.parse(readFileSync(chatFileFor(rig.base, rig.runs, id), 'utf8'))
}

it('keeps a new Claude sub when a removed Codex sub had the same id', async () => {
  const rig = await start()
  const codex = sub({ harness: 'codex', model: 'gpt-6.1-terra', lanes: ['codex'] })
  const created = await pagePost(`${rig.url}/api/orchestrator/ladder`, {
    ladder: { subs: [codex] },
    by: 'owner',
    confirmed: true,
  })
  expect(created.status).toBe(200)
  expect((await getJson(`${rig.url}/api/orchestrator?id=backend`)).body.harness).toBe('codex')

  const saved = readChat(rig, 'backend')
  saved.sessionId = 'codex-session'
  saved.mode = 'plan'
  writeFileSync(chatFileFor(rig.base, rig.runs, 'backend'), `${JSON.stringify(saved, null, 2)}\n`)

  const removed = await pagePost(`${rig.url}/api/orchestrator/ladder`, {
    ladder: { subs: [] },
    by: 'owner',
    confirmed: true,
  })
  expect(removed.status).toBe(200)

  const token = rig.bridge.orchestrators().token('orchestrator')
  const added = await tokenPost(
    `${rig.url}/api/orchestrator/ladder`,
    { ladder: { subs: [sub()] }, by: 'orchestrator', confirmed: true },
    token
  )
  expect(added.status).toBe(200)

  const answer = (await getJson(`${rig.url}/api/orchestrator?id=backend`)).body
  expect(answer.harness).toBe('claude')
  expect(answer.model).toBe('claude-sonnet-5-5')
  const restored = readChat(rig, 'backend')
  expect(restored.harness).toBe('claude')
  expect(restored.model).toBe('claude-sonnet-5-5')
  expect(restored.sessionId).toBeNull()
  expect(restored.mode).not.toBe('plan')
})

it('keeps a sub session when it is restored on its own harness', async () => {
  const rig = await start()
  writeFileSync(
    chatFileFor(rig.base, rig.runs, 'backend'),
    `${JSON.stringify({
      project: rig.base,
      harness: 'claude',
      sessionId: 'kept-session',
      model: 'sonnet',
      state: 'idle',
      messages: [],
    })}\n`
  )

  const added = await pagePost(`${rig.url}/api/orchestrator/ladder`, {
    ladder: { subs: [sub()] },
    by: 'owner',
    confirmed: true,
  })
  expect(added.status).toBe(200)

  const token = rig.bridge.orchestrators().token('orchestrator')
  const sent = await tokenPost(
    `${rig.url}/api/orchestrator/messages`,
    { id: 'backend', text: 'Continue.', from: 'orchestrator', confirmed: true },
    token
  )
  expect(sent.status).toBe(202)

  await waitFor(() => readCalls(rig.calls).length === 1, { what: 'the sub turn to start' })
  const args = readCalls(rig.calls)[0].args
  expect(args[args.indexOf('--resume') + 1]).toBe('kept-session')
})
