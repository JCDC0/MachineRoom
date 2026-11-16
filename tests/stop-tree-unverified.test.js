import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { killTree } from '../server/processTree.js'
import { createRunsApi } from '../server/runs.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const LANES = {
  inside1: {
    name: 'Inside 1',
    harness: 'OpenCode',
    cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
  },
}

const FAKE_RUNNER = [
  "import { spawn } from 'node:child_process'",
  "import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'",
  "import { join } from 'node:path'",
  'const args = process.argv.slice(2)',
  'const state = JSON.parse(readFileSync(args[0], "utf8"))',
  'const rest = args.slice(1)',
  'const stopIndex = rest.indexOf("--stop")',
  'if (stopIndex !== -1) {',
  '  const lane = rest[stopIndex + 1]',
  '  const pidFile = join(state.pidDir, lane + ".pid")',
  '  if (existsSync(pidFile)) {',
  '    const pid = Number(readFileSync(pidFile, "utf8").trim())',
  '    if (Number.isInteger(pid) && pid > 0) {',
  '      try { process.kill(pid) } catch {}',
  '    }',
  '    try { rmSync(join(state.runs, lane + ".lock"), { force: true }) } catch {}',
  '  }',
  '  console.log("stopped: " + lane)',
  '  process.exit(0)',
  '}',
  'const lane = rest[0]',
  'const pidFile = join(state.pidDir, lane + ".pid")',
  'writeFileSync(pidFile, String(process.pid))',
  'if (state.spawnSurvivor && state.survivorScript) {',
  '  const child = spawn(process.execPath, [state.survivorScript, state.survivorPidFile], { detached: true, stdio: "ignore", windowsHide: true })',
  '  child.unref()',
  '  while (!existsSync(state.survivorPidFile)) await new Promise((done) => setTimeout(done, 15))',
  '}',
  'while (!existsSync(state.runRelease)) await new Promise((done) => setTimeout(done, 20))',
].join('\n')

const SURVIVOR_SCRIPT = [
  "import { writeFileSync } from 'node:fs'",
  'writeFileSync(process.argv[2], String(process.pid))',
  'setTimeout(() => {}, 60000)',
].join('\n')

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

async function waitFor(check, timeoutMs = 10000, what = 'the condition') {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`)
    await new Promise((done) => setTimeout(done, 20))
  }
}

function makeRig({ list, spawnSurvivor = false } = {}) {
  const base = makeTempDir('mr-stop-unverified-')
  const runs = join(base, 'runs')
  const project = join(base, 'project')
  const pidDir = join(base, 'pids')
  mkdirSync(runs, { recursive: true })
  mkdirSync(project, { recursive: true })
  mkdirSync(pidDir, { recursive: true })

  const lanesFile = join(base, 'lanes.json')
  writeFileSync(lanesFile, JSON.stringify(LANES))
  writeActiveLanes(activeLanesFileFor(project, runs), ['inside1'])

  const runner = join(base, 'fake-runner.mjs')
  const stateFile = join(base, 'state.json')
  const runRelease = join(base, 'run-release')
  const survivorScript = join(base, 'survivor.mjs')
  const survivorPidFile = join(base, 'survivor.pid')
  writeFileSync(runner, FAKE_RUNNER)
  writeFileSync(survivorScript, SURVIVOR_SCRIPT)
  writeFileSync(
    stateFile,
    JSON.stringify({
      runs,
      pidDir,
      runRelease,
      spawnSurvivor,
      survivorScript,
      survivorPidFile,
    })
  )

  let answer = null
  const api = createRunsApi({
    projectRoot: project,
    lanesFile,
    runsFolder: runs,
    runnerCommand: { file: process.execPath, args: [runner, stateFile] },
    activeLanes: { isChosen: () => true, isLaneActive: () => true, hiddenKeySet: () => new Set() },
    orchestrators: () => ({ idForToken: () => 'orchestrator', sectorForLane: () => null }),
    readJsonBody: async () => ({ lane: 'inside1', task: 'Do work', allowDirty: true, confirmed: true }),
    sendJson: (_req, _res, status, body) => {
      answer = { status, body }
    },
    list,
  })

  cleanups.push(() => {
    try {
      writeFileSync(runRelease, '1')
    } catch {}
    if (existsSync(survivorPidFile)) {
      const pid = Number(readFileSync(survivorPidFile, 'utf8').trim())
      if (Number.isInteger(pid) && pid > 0) killTree({ pid })
    }
    api.stopAll()
    removeTempDir(base)
  })

  return {
    api,
    pidDir,
    survivorPidFile,
    async startInside() {
      const handled = await api.handle(
        { method: 'POST', headers: { origin: 'http://localhost:5173' } },
        {},
        new URL('http://127.0.0.1/api/control/runs')
      )
      expect(handled).toBe(true)
      expect(answer.status).toBe(202)
      await waitFor(() => existsSync(join(pidDir, 'inside1.pid')), 10000, 'runner pid file')
    },
  }
}

describe('stopSectorLanes with an unreadable process list', () => {
  it('puts a stopped lane in stillRunning when the process list returns zero rows', async () => {
    const rig = makeRig({ list: () => [], spawnSurvivor: true })
    await rig.startInside()
    await waitFor(() => existsSync(rig.survivorPidFile), 10000, 'survivor pid file')

    const result = await rig.api.stopSectorLanes({ targetLanes: new Set(['inside1']) })
    expect(result.stoppedLanes).toEqual([])
    expect(result.stillRunning).toEqual(['inside1'])
  })

  it('puts a lane in stillRunning when reading the process list throws', async () => {
    const rig = makeRig({
      list: () => {
        throw new Error('process query denied')
      },
    })
    await rig.startInside()

    const result = await rig.api.stopSectorLanes({ targetLanes: new Set(['inside1']) })
    expect(result.stoppedLanes).toEqual([])
    expect(result.stillRunning).toEqual(['inside1'])
  })

  it('puts a lane in stillRunning when the post-stop list returns null after a valid pre-stop list', async () => {
    let calls = 0
    const rig = makeRig({
      list: () => {
        calls += 1
        if (calls === 1) return [{ pid: process.pid, ppid: 0, command: 'node' }]
        return null
      },
    })
    await rig.startInside()

    const result = await rig.api.stopSectorLanes({ targetLanes: new Set(['inside1']) })
    expect(result.stoppedLanes).toEqual([])
    expect(result.stillRunning).toEqual(['inside1'])
  })

  it('reports the lane stopped if the settle retry reads a valid process list with no survivor', async () => {
    let calls = 0
    const rig = makeRig({
      list: () => {
        calls += 1
        if (calls === 2) return []
        return [{ pid: process.pid, ppid: 0, command: 'node' }]
      },
    })
    await rig.startInside()

    const result = await rig.api.stopSectorLanes({ targetLanes: new Set(['inside1']) })
    expect(result.stoppedLanes).toEqual(['inside1'])
    expect(result.stillRunning).toEqual([])
  })
})
