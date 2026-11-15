import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { chatFileFor, createOrchestrator } from '../server/orchestrator.js'
import { createOrchestrators } from '../server/orchestrators.js'
import { MODEL_ALIASES } from '../server/model-list.js'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

const FAKE_CLAUDE = [
  "import { appendFileSync } from 'node:fs'",
  'const args = process.argv.slice(2)',
  "appendFileSync(process.env.MR_CALLS, JSON.stringify({ args }) + '\\n')",
  "console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }))",
  "console.log(JSON.stringify({ type: 'result', subtype: 'success', result: 'Done.', total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } }))",
].join('\n')

const ALIAS_LANE = {
  name: 'Orchestrator',
  harness: 'Claude Code',
  cli: { harness: 'claude', bin: 'claude', model: 'opus' },
}

const LANES = {
  orchestrator: { name: 'Orchestrator', harness: 'Claude Code', cli: { harness: 'claude', bin: 'claude' } },
  opencode: { name: 'OpenCode', harness: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/qwen3.8-flash' } },
}

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    try {
      fn()
    } catch {}
  }
})

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

async function waitFor(check, timeoutMs = 15000, what = 'the turn') {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`)
    await sleep(15)
  }
}

function readLines(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

function makeOrchestrator(lanes) {
  const base = makeTempDir('mr-model-defaults-')
  const runs = join(base, 'runs')
  const projectRoot = join(base, 'project')
  mkdirSync(runs, { recursive: true })
  mkdirSync(projectRoot, { recursive: true })
  const script = join(base, 'fake-claude.mjs')
  writeFileSync(script, FAKE_CLAUDE)
  const promptFile = join(base, 'orchestrator-agent.md')
  writeFileSync(promptFile, 'project={{PROJECT}}')
  const callsFile = join(base, 'calls.jsonl')
  const orchestrator = createOrchestrator({
    projectRoot,
    runsFolder: runs,
    lanes,
    promptFile,
    spawn: (file, args, options) =>
      spawn(process.execPath, [script, ...args], {
        ...options,
        env: { ...(options.env ?? process.env), MR_CALLS: callsFile },
      }),
  })
  cleanups.push(() => {
    orchestrator.close()
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  return { orchestrator, calls: () => readLines(callsFile) }
}

function makeRegistry() {
  const base = makeTempDir('mr-model-defaults-')
  const runs = join(base, 'runs')
  const projectRoot = join(base, 'project')
  mkdirSync(runs, { recursive: true })
  mkdirSync(projectRoot, { recursive: true })
  const promptFile = join(base, 'orchestrator-agent.md')
  writeFileSync(promptFile, 'project={{PROJECT}}')
  const state = { body: null, answer: null }
  const chatFile = chatFileFor(projectRoot, runs)
  const registry = createOrchestrators({
    projectRoot,
    runsFolder: runs,
    lanes: LANES,
    promptFile,
    harnessAvailable: () => true,
    readJsonBody: async () => state.body,
    sendJson: (req, res, status, body) => {
      state.answer = { status, body }
    },
    spawn: () => {
      throw new Error('No turn should start in this test.')
    },
  })
  cleanups.push(() => {
    registry.close()
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  return { registry, state, chatFile }
}

function filesUnder(folder, found = []) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(folder, entry.name)
    if (entry.isDirectory()) filesUnder(path, found)
    else if (/\.(m?js|cjs|jsx|json)$/i.test(entry.name)) found.push(path)
  }
  return found
}

describe('no model is filled in that the owner did not choose', () => {
  it('starts a fresh orchestrator with an empty model and no model flag', async () => {
    const rig = makeOrchestrator({})
    expect(rig.orchestrator.answer().model).toBe('')
    expect(rig.orchestrator.send({ text: 'Start.', confirmed: true }).status).toBe(202)
    await waitFor(() => rig.orchestrator.answer().state === 'idle' && rig.calls().length === 1)
    const args = rig.calls()[0].args
    expect(args[0]).toBe('-p')
    expect(args).not.toContain('--model')
    expect(rig.orchestrator.answer().model).toBe('')
  })

  it('sets no model on a new sub that has none', async () => {
    const { registry, state, chatFile } = makeRegistry()
    state.body = {
      ladder: {
        subs: [
          { id: 'frontend', name: 'Frontend', harness: 'claude', lanes: ['opencode'], scope: ['src/ui/**'], restricted: false, setBy: 'owner' },
        ],
      },
      by: 'owner',
      confirmed: true,
    }
    await registry.handle(
      { method: 'POST', headers: { origin: 'http://localhost:5173' } },
      {},
      new URL('http://127.0.0.1/api/orchestrator/ladder')
    )
    expect(state.answer.status).toBe(200)
    expect(state.answer.body.ladder.subs[0].model).toBe('')
    expect(registry.getLadder().subs[0].model).toBe('')
    expect(registry.list()[1].model).toBe('')
    expect(JSON.parse(readFileSync(chatFile, 'utf8')).ladder.subs[0].model).toBe('')
  })

  it('reads a lane and a sub saved with an alias as the full model id', async () => {
    expect(MODEL_ALIASES).toEqual({
      opus: 'claude-opus-5-5',
      sonnet: 'claude-sonnet-5-5',
      haiku: 'claude-haiku-5-5',
    })
    const rig = makeOrchestrator({ orchestrator: ALIAS_LANE })
    expect(rig.orchestrator.answer().model).toBe('claude-opus-5-5')

    const { registry, state } = makeRegistry()
    state.body = {
      ladder: {
        subs: [
          { id: 'frontend', name: 'Frontend', harness: 'claude', model: 'opus', lanes: ['opencode'], scope: ['src/ui/**'], restricted: false, setBy: 'owner' },
        ],
      },
      by: 'owner',
      confirmed: true,
    }
    await registry.handle(
      { method: 'POST', headers: { origin: 'http://localhost:5173' } },
      {},
      new URL('http://127.0.0.1/api/orchestrator/ladder')
    )
    expect(state.answer.status).toBe(200)
    expect(registry.getLadder().subs[0].model).toBe('claude-opus-5-5')
  })

  it('writes no bare opus model value under server, src or config', () => {
    const pattern = /\bmodel\b\s*[:=]\s*\{?\s*['"]opus['"]/i
    const found = []
    for (const folder of ['server', 'src', 'config']) {
      for (const file of filesUnder(join(REPO_ROOT, folder))) {
        const lines = readFileSync(file, 'utf8').split(/\r?\n/)
        lines.forEach((line, index) => {
          if (pattern.test(line)) found.push(`${relative(REPO_ROOT, file)}:${index + 1}`)
        })
      }
    }
    expect(found).toEqual([])
  })
})
