import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { chatFileFor, createOrchestrator } from '../server/orchestrator.js'
import { makeTempDir } from './helpers/tempRoot.js'

const PROMPT = 'project={{PROJECT}}\nmachineroom={{MACHINEROOM}}\nruns={{RUNS}}\nbridge={{BRIDGE}}'
const KEY = 'sub'

const rigs = []

afterEach(async () => {
  for (const rig of rigs.splice(0)) {
    rig.orchestrator.close()
    await new Promise((resolve) => setTimeout(resolve, 50))
    rmSync(rig.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

function makeRig({ harness = 'claude', model = 'claude-opus-5-5' } = {}) {
  const base = makeTempDir('mr-lane-restore-')
  const runs = join(base, 'runs')
  const projectRoot = join(base, 'project')
  mkdirSync(runs, { recursive: true })
  mkdirSync(projectRoot, { recursive: true })
  const promptFile = join(base, 'orchestrator-agent.md')
  writeFileSync(promptFile, PROMPT)
  const lanes = {
    orchestrator: { name: 'Orchestrator', harness: 'Claude', cli: { harness: 'claude', bin: process.execPath, model: 'claude-opus-5-5' } },
    worker: { name: 'Worker', harness: 'Claude', cli: { harness: 'claude', bin: process.execPath, model: 'claude-opus-5-5' } },
    codex: { name: 'Codex', harness: 'Codex', cli: { harness: 'codex', bin: process.execPath, model: 'gpt-6.1-terra' } },
  }
  const calls = []
  const options = {
    id: KEY,
    harness,
    model,
    projectRoot,
    runsFolder: runs,
    lanes,
    promptFile,
    spawn: (file, args, opts) => {
      calls.push(args)
      return spawn(process.execPath, ['-e', ''], opts)
    },
  }
  const rig = { base, runs, projectRoot, options, calls, orchestrator: createOrchestrator(options) }
  rigs.push(rig)
  return rig
}

function reload(rig) {
  rig.orchestrator.close()
  rig.orchestrator = createOrchestrator(rig.options)
  return rig.orchestrator
}

function stateFile(rig) {
  return JSON.parse(readFileSync(chatFileFor(rig.projectRoot, rig.runs, KEY), 'utf8'))
}

async function turn(rig) {
  expect(rig.orchestrator.send({ text: 'Work', confirmed: true }).status).toBe(202)
  for (let i = 0; i < 200 && !rig.calls.length; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  expect(rig.calls).toHaveLength(1)
  return rig.calls[0]
}

it('restores a current message from a known lane', () => {
  const rig = makeRig()
  rig.orchestrator.addMessage('lane:worker', 'Current message from the worker lane')
  reload(rig)
  const restored = rig.orchestrator.answer().messages
  expect(restored.some((message) => message.from === 'lane:worker' && message.text === 'Current message from the worker lane')).toBe(true)
})

it('restores an archived message from a known lane', () => {
  const rig = makeRig()
  rig.orchestrator.addMessage('lane:worker', 'Archived message from the worker lane')
  expect(rig.orchestrator.newSession({ confirmed: true }).status).toBe(200)
  reload(rig)
  const session = rig.orchestrator.listSessions()[0]
  expect(session).toBeTruthy()
  const messages = rig.orchestrator.getSession(session.id).body.messages
  expect(messages.some((message) => message.from === 'lane:worker' && message.text === 'Archived message from the worker lane')).toBe(true)
})

it('restores a pending message from a known lane', () => {
  const rig = makeRig()
  rig.orchestrator.stop({ confirmed: true })
  const delivered = rig.orchestrator.deliver('lane:worker', 'Pending message from the worker lane')
  expect(delivered).toBeTruthy()
  reload(rig)
  expect(rig.orchestrator.answer().state).toBe('paused')
  const saved = stateFile(rig)
  const waiting = saved.pending.map((id) => saved.messages.find((message) => message.id === id))
  expect(waiting.some((message) => message.from === 'lane:worker' && message.text === 'Pending message from the worker lane')).toBe(true)
})

it('drops a saved message from an unknown lane', () => {
  const rig = makeRig()
  rig.orchestrator.addMessage('lane:ghost', 'Message from an unknown lane')
  reload(rig)
  expect(rig.orchestrator.answer().messages.some((message) => message.from === 'lane:ghost')).toBe(false)
})

it('drops an effort the new harness does not take before a turn', async () => {
  const rig = makeRig()
  expect(rig.orchestrator.setEffort({ effort: 'max', confirmed: true }).status).toBe(200)
  expect(rig.orchestrator.setHarness({ harness: 'codex', model: 'gpt-6.1-terra', confirmed: true }).status).toBe(200)
  expect(rig.orchestrator.answer().effort).toBeNull()
  const args = await turn(rig)
  expect(args.join(' ')).not.toContain('model_reasoning_effort')
})

it('keeps an effort both harnesses take', async () => {
  const rig = makeRig()
  expect(rig.orchestrator.setEffort({ effort: 'high', confirmed: true }).status).toBe(200)
  expect(rig.orchestrator.setHarness({ harness: 'codex', model: 'gpt-6.1-terra', confirmed: true }).status).toBe(200)
  expect(rig.orchestrator.answer().effort).toBe('high')
  const args = await turn(rig)
  expect(args.join(' ')).toContain('model_reasoning_effort=high')
})
