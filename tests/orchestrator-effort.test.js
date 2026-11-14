import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { chatFileFor, createOrchestrator } from '../server/orchestrator.js'
import { makeTempDir } from './helpers/tempRoot.js'

const rigs = []
afterEach(async () => {
  for (const rig of rigs.splice(0)) {
    rig.orchestrator.close()
    await new Promise((resolve) => setTimeout(resolve, 50))
    rmSync(rig.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

function makeRig(harness, id = 'sub') {
  const base = makeTempDir('mr-effort-')
  const runs = join(base, 'runs')
  mkdirSync(runs)
  const calls = []
  const options = {
    id, harness, model: 'test-model', projectRoot: base, runsFolder: runs,
    spawn: (file, args, opts) => {
      calls.push(args)
      return spawn(process.execPath, ['-e', ''], opts)
    },
  }
  const rig = { base, calls, options, orchestrator: createOrchestrator(options) }
  rigs.push(rig)
  return rig
}

async function turn(rig) {
  expect(rig.orchestrator.send({ text: 'Work', confirmed: true }).status).toBe(202)
  for (let i = 0; i < 200 && !rig.calls.length; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  expect(rig.calls).toHaveLength(1)
  return rig.calls[0]
}

it.each(['codex', 'machineroom'])('passes high effort to a %s sub turn', async (harness) => {
  const rig = makeRig(harness)
  expect(rig.orchestrator.setEffort({ effort: 'high', confirmed: true }).status).toBe(200)
  const args = await turn(rig)
  if (harness === 'codex') expect(args).toContain('model_reasoning_effort=high')
  else expect(args.slice(args.indexOf('--reasoning'), args.indexOf('--reasoning') + 2)).toEqual(['--reasoning', 'high'])
})

it.each(['codex', 'machineroom'])('leaves the %s command unchanged without effort', async (harness) => {
  const rig = makeRig(harness)
  const args = await turn(rig)
  if (harness === 'codex') {
    expect(args.slice(0, -1)).toEqual(['exec', '--json', '--model', 'test-model', '--sandbox', 'workspace-write', '--skip-git-repo-check'])
  } else {
    expect(args.slice(1, -1)).toEqual(['--model', 'test-model', '--cwd', rig.base])
    expect(args[0]).toMatch(/mr-agent\.mjs$/)
  }
})

it('accepts xhigh for Codex and refuses it for OpenCode', () => {
  expect(makeRig('codex').orchestrator.setEffort({ effort: 'xhigh', confirmed: true }).status).toBe(200)
  expect(makeRig('opencode').orchestrator.setEffort({ effort: 'xhigh', confirmed: true }).status).toBe(400)
})

it('loads valid saved effort and drops an invalid level', () => {
  const rig = makeRig('codex')
  expect(rig.orchestrator.setEffort({ effort: 'xhigh', confirmed: true }).status).toBe(200)
  rig.orchestrator.close()
  rig.orchestrator = createOrchestrator(rig.options)
  expect(rig.orchestrator.answer().effort).toBe('xhigh')
  rig.orchestrator.close()
  const file = chatFileFor(rig.base, rig.options.runsFolder, 'sub')
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  saved.effort = 'max'
  writeFileSync(file, JSON.stringify(saved))
  rig.orchestrator = createOrchestrator(rig.options)
  expect(rig.orchestrator.answer().effort).toBeNull()
})

it('passes effort to a main orchestrator turn', async () => {
  const rig = makeRig('codex', 'orchestrator')
  expect(rig.orchestrator.setEffort({ effort: 'high', confirmed: true }).status).toBe(200)
  expect(await turn(rig)).toContain('model_reasoning_effort=high')
})
