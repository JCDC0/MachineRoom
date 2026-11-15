import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { COMPACT_RUNNING_PROBLEM } from '../server/orchestrator.js'
import { availableHarnesses, createOrchestrators } from '../server/orchestrators.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const rigs = []

const HOLD = [
  "import { existsSync } from 'node:fs'",
  'while (!existsSync(process.argv[2])) await new Promise((done) => setTimeout(done, 20))',
].join('\n')

const OPENCODE_LANE = {
  'opencode-one': {
    name: 'OpenCode One',
    harness: 'OpenCode',
    cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
  },
}

afterEach(() => {
  for (const rig of rigs.splice(0)) {
    rig.orchestrators.close()
    removeTempDir(rig.base)
  }
})

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeRig({ lanes = OPENCODE_LANE, hold = false } = {}) {
  const base = makeTempDir('mr-saved-program-')
  const runs = join(base, 'runs')
  mkdirSync(runs)
  const release = join(base, 'release')
  const holdScript = join(base, 'hold.mjs')
  writeFileSync(holdScript, `${HOLD}\n`)
  const calls = []
  const orchestrators = createOrchestrators({
    projectRoot: base,
    runsFolder: runs,
    lanes,
    harnessAvailable: () => true,
    spawn: (file, args, options) => {
      calls.push({ file, args })
      return hold ? spawn(process.execPath, [holdScript, release], options) : spawn(process.execPath, ['-e', ''], options)
    },
  })
  const rig = { base, runs, release, calls, orchestrators }
  rigs.push(rig)
  return rig
}

function saveClaudeProgram(rig) {
  const program = join(rig.base, process.platform === 'win32' ? 'claude-program.exe' : 'claude-program')
  writeFileSync(program, '')
  writeFileSync(join(rig.runs, 'harnesses.json'), `${JSON.stringify({ programs: { claude: program }, off: [] })}\n`)
  return program
}

function claudeSub() {
  return {
    id: 'claude-sub',
    name: 'Claude Sub',
    harness: 'claude',
    model: 'opus',
    lanes: ['opencode-one'],
    scope: ['**'],
    restricted: false,
    setBy: 'owner',
  }
}

function codexSub(effort) {
  return {
    id: 'codex-sub',
    name: 'Codex Sub',
    harness: 'codex',
    model: 'gpt-6.1-terra',
    effort,
    lanes: ['opencode-one'],
    scope: ['**'],
    restricted: false,
    setBy: 'owner',
  }
}

function saveLadder(rig, subs) {
  return rig.orchestrators.ladderChange({ ladder: { subs }, by: 'owner', confirmed: true }, true)
}

async function firstTurn(rig, id = 'orchestrator') {
  const instance = rig.orchestrators.find(id)
  expect(instance).not.toBeNull()
  expect(instance.send({ text: 'Work', confirmed: true }).status).toBe(202)
  for (let index = 0; index < 300 && rig.calls.length === 0; index += 1) {
    await sleep(10)
  }
  expect(rig.calls).toHaveLength(1)
  return rig.calls[0]
}

describe('a saved harness program starts chat and subs', () => {
  it('starts a chat turn from the saved Claude program when no Claude lane names one', async () => {
    const rig = makeRig()
    const program = saveClaudeProgram(rig)

    const turn = await firstTurn(rig)

    expect(turn.file).toBe(program)
  })

  it('starts a sub turn from the saved Claude program when no Claude lane names one', async () => {
    const rig = makeRig()
    const program = saveClaudeProgram(rig)
    expect(saveLadder(rig, [claudeSub()]).status).toBe(200)

    const turn = await firstTurn(rig, 'claude-sub')

    expect(turn.file).toBe(program)
  })

  it('uses the saved program over a lane that names the harness default', async () => {
    const lanes = {
      orchestrator: {
        name: 'Orchestrator',
        harness: 'Claude Code',
        cli: { harness: 'claude', bin: 'claude', model: 'opus' },
      },
      ...OPENCODE_LANE,
    }
    const rig = makeRig({ lanes })
    const program = saveClaudeProgram(rig)

    const turn = await firstTurn(rig)

    expect(turn.file).toBe(program)
  })

  it('keeps a lane custom program ahead of the saved one', async () => {
    const custom = join(makeTempDir('mr-custom-bin-'), process.platform === 'win32' ? 'custom-claude.exe' : 'custom-claude')
    writeFileSync(custom, '')
    const lanes = {
      orchestrator: {
        name: 'Orchestrator',
        harness: 'Claude Code',
        cli: { harness: 'claude', bin: custom, model: 'opus' },
      },
      ...OPENCODE_LANE,
    }
    const rig = makeRig({ lanes })
    saveClaudeProgram(rig)

    const turn = await firstTurn(rig)

    expect(turn.file).toBe(custom)
  })
})

describe('the harness list reads the saved programs', () => {
  it('lists a harness that is ready only through a saved program', () => {
    const rig = makeRig()
    saveClaudeProgram(rig)
    const env = { PATH: '', Path: '' }

    const withoutFolder = availableHarnesses({}, env, process.platform, [])
    expect(withoutFolder.map((entry) => entry.key)).not.toContain('claude')

    const withFolder = availableHarnesses({}, env, process.platform, [], rig.runs)
    expect(withFolder.map((entry) => entry.key)).toContain('claude')
  })
})

describe('an effort-only ladder save reaches the live sub', () => {
  it('changes an idle sub from high to low and its next turn uses low', async () => {
    const rig = makeRig()
    expect(saveLadder(rig, [codexSub('high')]).status).toBe(200)
    const instance = rig.orchestrators.find('codex-sub')
    expect(instance).not.toBeNull()
    expect(instance.answer().effort).toBe('high')

    const saved = saveLadder(rig, [codexSub('low')])

    expect(saved.status).toBe(200)
    expect(rig.orchestrators.find('codex-sub')).toBe(instance)
    expect(rig.orchestrators.list().find((row) => row.id === 'codex-sub').effort).toBe('low')
    const turn = await firstTurn(rig, 'codex-sub')
    expect(turn.args).toContain('model_reasoning_effort=low')
  })

  it('refuses the same save while the sub works and keeps high', async () => {
    const rig = makeRig({ hold: true })
    expect(saveLadder(rig, [codexSub('high')]).status).toBe(200)
    const instance = rig.orchestrators.find('codex-sub')
    expect(instance.send({ text: 'Work', confirmed: true }).status).toBe(202)
    for (let index = 0; index < 300 && instance.answer().state !== 'working'; index += 1) {
      await sleep(10)
    }
    expect(instance.answer().state).toBe('working')

    const refused = saveLadder(rig, [codexSub('low')])

    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe(COMPACT_RUNNING_PROBLEM)
    expect(instance.answer().effort).toBe('high')
    expect(rig.orchestrators.getLadder().subs.find((sub) => sub.id === 'codex-sub').effort).toBe('high')

    writeFileSync(rig.release, 'go')
    for (let index = 0; index < 500 && instance.answer().state !== 'idle'; index += 1) {
      await sleep(10)
    }
    expect(instance.answer().state).toBe('idle')
  })
})
