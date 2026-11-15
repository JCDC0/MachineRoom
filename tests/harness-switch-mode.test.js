import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { chatFileFor, createOrchestrator } from '../server/orchestrator.js'
import { waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const PROMPT = 'project={{PROJECT}}\nmachineroom={{MACHINEROOM}}\nruns={{RUNS}}\nbridge={{BRIDGE}}'
const CODEX_MODEL = 'gpt-6.1-sol'

const LANES = {
  orchestrator: {
    name: 'Orchestrator',
    harness: 'Claude Code',
    cli: { harness: 'claude', bin: 'claude', model: 'claude-opus-5-5' },
  },
  codex: {
    name: 'Codex',
    harness: 'Codex',
    cli: { harness: 'codex', bin: process.execPath, model: CODEX_MODEL },
  },
}

const rigs = []

afterEach(async () => {
  for (const rig of rigs.splice(0)) {
    rig.orchestrator.close()
    await new Promise((resolve) => setTimeout(resolve, 50))
    rmSync(rig.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

function makeRig() {
  const base = makeTempDir('mr-harness-switch-mode-')
  const runs = join(base, 'runs')
  const projectRoot = join(base, 'project')
  mkdirSync(runs, { recursive: true })
  mkdirSync(projectRoot, { recursive: true })
  const promptFile = join(base, 'orchestrator-agent.md')
  writeFileSync(promptFile, PROMPT)
  const calls = []
  const options = {
    projectRoot,
    runsFolder: runs,
    lanes: LANES,
    harness: 'claude',
    model: 'claude-opus-5-5',
    promptFile,
    spawn: (file, args, spawnOptions) => {
      calls.push({ file, args: [...args] })
      return spawn(process.execPath, ['-e', ''], spawnOptions)
    },
  }
  const rig = { base, runs, projectRoot, options, calls, orchestrator: createOrchestrator(options) }
  rigs.push(rig)
  return rig
}

function reload(rig) {
  rig.orchestrator.close()
  rig.orchestrator = createOrchestrator(rig.options)
}

function stateFile(rig) {
  return chatFileFor(rig.projectRoot, rig.runs)
}

function dropSavedMode(rig) {
  rig.orchestrator.close()
  const saved = JSON.parse(readFileSync(stateFile(rig), 'utf8'))
  delete saved.mode
  writeFileSync(stateFile(rig), `${JSON.stringify(saved, null, 2)}\n`)
  rig.orchestrator = createOrchestrator(rig.options)
}

function saveMode(rig, mode) {
  expect(rig.orchestrator.setMode({ mode, confirmed: true }).status).toBe(200)
  reload(rig)
}

async function startTurn(rig) {
  expect(rig.orchestrator.send({ text: 'Work', confirmed: true }).status).toBe(202)
  await waitFor(() => rig.calls.length === 1, { timeoutMs: 15000, what: 'the command' })
  return rig.calls[0]
}

function switchToCodex(rig) {
  const result = rig.orchestrator.setHarness({ harness: 'codex', model: CODEX_MODEL, confirmed: true })
  expect(result.status).toBe(200)
}

describe('a harness switch to Codex', () => {
  it('uses auto for a restored Claude orchestrator with no saved mode', async () => {
    const rig = makeRig()
    dropSavedMode(rig)
    expect(rig.orchestrator.answer().harness).toBe('claude')

    switchToCodex(rig)

    expect(rig.orchestrator.answer().mode).toBe('auto')
    const call = await startTurn(rig)
    expect(call.args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
    expect(call.args).toContain('--sandbox')
  })

  it('does not carry a saved bypass', () => {
    const rig = makeRig()
    saveMode(rig, 'bypass')

    switchToCodex(rig)

    expect(rig.orchestrator.answer().mode).toBe('auto')
  })

  it('keeps a saved plan', () => {
    const rig = makeRig()
    saveMode(rig, 'plan')

    switchToCodex(rig)

    expect(rig.orchestrator.answer().mode).toBe('plan')
  })
})
