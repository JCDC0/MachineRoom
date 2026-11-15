import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { modelUnavailableProblem } from '../server/model-list.js'
import { chatFileFor, createOrchestrator } from '../server/orchestrator.js'
import { makeTempDir } from './helpers/tempRoot.js'

const LANES = {
  orchestrator: {
    name: 'Orchestrator',
    harness: 'Claude Code',
    cli: { harness: 'claude', bin: 'claude', model: 'opus' },
  },
  opencode: {
    name: 'OpenCode',
    harness: 'OpenCode',
    cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/qwen3.8-flash' },
  },
}

const ENDPOINTS = {
  endpoints: [
    {
      name: 'Work',
      provider: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      keyName: 'openrouter',
      models: ['alpha/model'],
    },
  ],
}

const rigs = []

afterEach(async () => {
  for (const rig of rigs.splice(0)) {
    rig.orchestrator.close()
    await new Promise((resolve) => setTimeout(resolve, 50))
    rmSync(rig.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

function makeRig({ endpoints = false } = {}) {
  const base = makeTempDir('mr-orchestrator-harness-default-')
  const runs = join(base, 'runs')
  mkdirSync(runs)
  if (endpoints) writeFileSync(join(runs, 'endpoints.json'), JSON.stringify(ENDPOINTS), 'utf8')
  const orchestrator = createOrchestrator({
    projectRoot: base,
    runsFolder: runs,
    lanes: LANES,
    harness: 'claude',
    model: 'opus',
  })
  const rig = { base, runs, orchestrator }
  rigs.push(rig)
  return rig
}

describe('a harness switch with no model', () => {
  it('saves an empty model for OpenCode', () => {
    const rig = makeRig()

    const result = rig.orchestrator.setHarness({ harness: 'opencode', model: '', confirmed: true })

    expect(result.status).toBe(200)
    expect(rig.orchestrator.answer().model).toBe('')
    const saved = JSON.parse(readFileSync(chatFileFor(rig.base, rig.runs, 'orchestrator'), 'utf8'))
    expect(saved.model).toBe('')
  })

  it('refuses an empty model for Direct API', () => {
    const rig = makeRig({ endpoints: true })

    const result = rig.orchestrator.setHarness({ harness: 'machineroom', model: '', confirmed: true })

    expect(result.status).toBe(400)
    expect(result.body.error).toBe(modelUnavailableProblem('', 'machineroom'))
    expect(rig.orchestrator.answer().harness).toBe('claude')
  })

  it('still refuses an unknown model', () => {
    const rig = makeRig()

    const result = rig.orchestrator.setHarness({
      harness: 'opencode',
      model: 'opencode-go/not-a-model',
      confirmed: true,
    })

    expect(result.status).toBe(400)
    expect(result.body.error).toBe(modelUnavailableProblem('opencode-go/not-a-model', 'opencode'))
    expect(rig.orchestrator.answer().harness).toBe('claude')
  })
})
