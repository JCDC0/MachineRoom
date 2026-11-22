import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { chatFileFor } from '../server/orchestrator.js'
import { killTree, listProcesses } from '../server/processTree.js'
import { laneLockText } from '../src/briefs/run.js'
import { getJson } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PROMPT = 'project={{PROJECT}}\nmachineroom={{MACHINEROOM}}\nruns={{RUNS}}\nbridge={{BRIDGE}}'

const LANES = {
  orchestrator: {
    name: 'Orchestrator',
    harness: 'Claude Code',
    cli: { harness: 'claude', bin: 'claude', model: 'opus', contextWindow: 200000 },
  },
  inside1: {
    name: 'Inside 1',
    harness: 'OpenCode',
    fallback: 'inside2',
    cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
  },
  inside2: {
    name: 'Inside 2',
    harness: 'OpenCode',
    cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
  },
  outside: {
    name: 'Outside',
    harness: 'OpenCode',
    fallback: 'inside2',
    cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
  },
}

const FAKE_ORCH_AGENT = [
  "import { appendFileSync, existsSync } from 'node:fs'",
  "const calls = String(process.env.MR_CALLS ?? '')",
  "if (calls) appendFileSync(calls, JSON.stringify({ pid: process.pid, args: process.argv.slice(2) }) + '\\n')",
  "console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }))",
  "console.log(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Working.' }] } }))",
  "while (!existsSync(String(process.env.MR_ORCH_RELEASE ?? ''))) {",
  '  await new Promise((done) => setTimeout(done, 20))',
  '}',
  "console.log(JSON.stringify({ type: 'result', subtype: 'success', result: 'Done.', total_cost_usd: 0.01, usage: { input_tokens: 1, output_tokens: 1 } }))",
].join('\n')

const FAKE_RUNNER = [
  "import { spawn } from 'node:child_process'",
  "import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'",
  "import { join } from 'node:path'",
  'const args = process.argv.slice(2)',
  'const stateFile = args[0]',
  'const rest = args.slice(1)',
  'const state = JSON.parse(readFileSync(stateFile, "utf8"))',
  'const stopIndex = rest.indexOf("--stop")',
  'if (stopIndex !== -1) {',
  '  const lane = rest[stopIndex + 1]',
  '  if (state.stopStarted) appendFileSync(state.stopStarted, lane + "\\n")',
  '  if (state.stopRelease) {',
  '    while (!existsSync(state.stopRelease)) await new Promise((done) => setTimeout(done, 20))',
  '  }',
  '  const pidFile = join(state.pidDir, lane + ".pid")',
  '  if (existsSync(pidFile) && state.stopBehavior !== "ignore-kill") {',
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
  'const startedAt = rest.includes("--started-at") ? rest[rest.indexOf("--started-at") + 1] : new Date().toISOString()',
  'const pidFile = join(state.pidDir, lane + ".pid")',
  'writeFileSync(pidFile, String(process.pid))',
  'if (state.calls) {',
  '  appendFileSync(state.calls, JSON.stringify({ lane, pid: process.pid, startedAt, ticket: process.env.MACHINEROOM_LANE_TICKET ?? "" }) + "\\n")',
  '}',
  'if (state.spawnSurvivorFor === lane && state.survivorScript) {',
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

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

async function waitFor(check, timeoutMs = 15000, what = 'the condition') {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`)
    await sleep(20)
  }
}

function readJsonLines(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

function pagePost(url, path, body) {
  return getJson(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  })
}

function tokenPost(url, path, body, token) {
  return getJson(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-MachineRoom-Orchestrator': token },
    body: JSON.stringify(body),
  })
}

function lanePost(url, path, body, ticket) {
  return getJson(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-MachineRoom-Lane': ticket },
    body: JSON.stringify(body),
  })
}

async function makeRig({ ladder, stopRelease = '', stopBehavior = '', spawnSurvivorFor = '' } = {}) {
  const base = makeTempDir('mr-stop-tree-')
  const runs = join(base, 'runs')
  const projectRoot = join(base, 'project')
  const pidDir = join(base, 'pids')
  mkdirSync(runs, { recursive: true })
  mkdirSync(projectRoot, { recursive: true })
  mkdirSync(pidDir, { recursive: true })

  const promptFile = join(base, 'orchestrator-agent.md')
  writeFileSync(promptFile, PROMPT)

  const orchAgent = join(base, 'fake-orch.mjs')
  const orchCalls = join(base, 'orch-calls.jsonl')
  const orchRelease = join(base, 'orch-release')
  writeFileSync(orchAgent, FAKE_ORCH_AGENT)

  const runner = join(base, 'fake-runner.mjs')
  const stateFile = join(base, 'runner-state.json')
  const calls = join(base, 'runner-calls.jsonl')
  const runRelease = join(base, 'run-release')
  const stopStarted = join(base, 'stop-started.log')
  const survivorScript = join(base, 'survivor.mjs')
  const survivorPidFile = join(base, 'survivor.pid')
  writeFileSync(runner, FAKE_RUNNER)
  writeFileSync(survivorScript, SURVIVOR_SCRIPT)
  writeFileSync(
    stateFile,
    JSON.stringify({
      runs,
      pidDir,
      calls,
      runRelease,
      stopStarted,
      stopRelease,
      stopBehavior,
      spawnSurvivorFor,
      survivorScript,
      survivorPidFile,
    })
  )

  const lanesFile = join(base, 'lanes.json')
  writeFileSync(lanesFile, JSON.stringify(LANES))

  if (ladder) {
    writeFileSync(
      chatFileFor(projectRoot, runs, 'orchestrator'),
      `${JSON.stringify({ project: projectRoot, sessionId: null, state: 'idle', messages: [], pending: [], ladder })}\n`
    )
  }
  writeActiveLanes(activeLanesFileFor(projectRoot, runs), ['inside1', 'inside2', 'outside'])

  const spawnedChildren = []
  const spawnFake = (command, args, options) => {
    const child = spawn(process.execPath, [orchAgent], {
      ...options,
      env: {
        ...options?.env,
        MR_CALLS: orchCalls,
        MR_ORCH_RELEASE: orchRelease,
      },
    })
    spawnedChildren.push(child)
    return child
  }

  const bridge = createBridge({
    projectRoot,
    port: 0,
    env: {},
    briefsDir: join(REPO_ROOT, 'docs', 'agents'),
    lanesFile,
    orchestratorPrompt: promptFile,
    orchestratorSpawn: spawnFake,
    orchestratorHarnessAvailable: () => true,
    lanesSource: { folder: runs, lanes: LANES, pollMs: 20, quietMs: 60000 },
    runnerCommand: { file: process.execPath, args: [runner, stateFile] },
  })
  cleanups.push(async () => {
    writeFileSync(runRelease, '1')
    if (stopRelease) writeFileSync(stopRelease, '1')
    writeFileSync(orchRelease, '1')
    if (existsSync(survivorPidFile)) {
      const pid = Number(readFileSync(survivorPidFile, 'utf8').trim())
      if (Number.isInteger(pid) && pid > 0) killTree({ pid })
    }
    for (const child of spawnedChildren) killTree(child)
    await bridge.stop()
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  const { url } = await bridge.start()
  return {
    base,
    runs,
    projectRoot,
    pidDir,
    url,
    bridge,
    calls,
    orchCalls,
    stopStarted,
    stopRelease,
    runRelease,
    survivorPidFile,
    token: (id) => bridge.orchestrators().token(id),
  }
}

describe('POST /api/orchestrator/stop-tree', () => {
  it('stops a sub turn and its two running lanes while leaving lanes outside the sector running', async () => {
    const ladder = {
      subs: [
        { id: 'scout', name: 'Scout', harness: 'claude', model: 'sonnet', lanes: ['inside1', 'inside2'], scope: ['src/**'], restricted: false, setBy: 'owner' },
        { id: 'other', name: 'Other', harness: 'claude', model: 'sonnet', lanes: ['outside'], scope: ['docs/**'], restricted: false, setBy: 'owner' },
      ],
    }
    const rig = await makeRig({ ladder })

    await pagePost(rig.url, '/api/orchestrator/messages', { id: 'scout', text: 'Hold turn.', confirmed: true })
    await pagePost(rig.url, '/api/orchestrator/messages', { id: 'other', text: 'Hold turn.', confirmed: true })
    await waitFor(() => readJsonLines(rig.orchCalls).length === 2, 10000, 'two orchestrator turns')

    expect((await tokenPost(rig.url, '/api/control/runs', { lane: 'inside1', task: 'Work 1', allowDirty: true, confirmed: true }, rig.token('scout'))).status).toBe(202)
    expect((await tokenPost(rig.url, '/api/control/runs', { lane: 'inside2', task: 'Work 2', allowDirty: true, confirmed: true }, rig.token('scout'))).status).toBe(202)
    expect((await tokenPost(rig.url, '/api/control/runs', { lane: 'outside', task: 'Work 3', allowDirty: true, confirmed: true }, rig.token('other'))).status).toBe(202)
    await waitFor(() => readJsonLines(rig.calls).length === 3, 10000, 'three lanes running')

    const stopped = await tokenPost(rig.url, '/api/orchestrator/stop-tree', { id: 'scout', confirmed: true }, rig.token('scout'))
    expect(stopped.status).toBe(200)
    expect(stopped.body.stoppedOrchestrators).toEqual(['scout'])
    expect([...stopped.body.stoppedLanes].sort()).toEqual(['inside1', 'inside2'])
    expect(stopped.body.stillRunning).toEqual([])

    const scout = await getJson(`${rig.url}/api/orchestrator?id=scout`)
    expect(scout.body.state).toBe('paused')
    const other = await getJson(`${rig.url}/api/orchestrator?id=other`)
    expect(other.body.state).toBe('working')

    const runsState = await getJson(`${rig.url}/api/control/runs`)
    expect(runsState.body.running.map((item) => item.lane)).toEqual(['outside'])
  })

  it('refuses lane starts, work messages and failovers into a stopping sector with 409 and lifts the gate afterward', async () => {
    const baseRelease = makeTempDir('mr-stop-gate-')
    const stopRelease = join(baseRelease, 'release')
    cleanups.push(() => rmSync(baseRelease, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

    const ladder = {
      subs: [
        { id: 'scout', name: 'Scout', harness: 'claude', model: 'sonnet', lanes: ['inside1', 'inside2'], scope: ['src/**'], restricted: false, setBy: 'owner' },
      ],
    }
    const rig = await makeRig({ ladder, stopRelease })

    expect((await tokenPost(rig.url, '/api/control/runs', { lane: 'inside1', task: 'Work 1', allowDirty: true, confirmed: true }, rig.token('scout'))).status).toBe(202)
    expect((await tokenPost(rig.url, '/api/control/runs', { lane: 'outside', task: 'Outside work', allowDirty: true, confirmed: true }, rig.token('orchestrator'))).status).toBe(202)
    await waitFor(() => readJsonLines(rig.calls).length === 2, 10000, 'lanes started')

    const outsideTicket = readJsonLines(rig.calls).find((entry) => entry.lane === 'outside')?.ticket
    expect(outsideTicket).toBeTruthy()

    const stopPromise = tokenPost(rig.url, '/api/orchestrator/stop-tree', { id: 'scout', confirmed: true }, rig.token('scout'))
    await waitFor(() => existsSync(rig.stopStarted), 10000, 'stop command started')

    const racingStart = await tokenPost(rig.url, '/api/control/runs', { lane: 'inside2', task: 'Late start', allowDirty: true, confirmed: true }, rig.token('scout'))
    expect(racingStart.status).toBe(409)
    expect(racingStart.body.error).toBe('That sector is stopping.')

    const racingMessage = await pagePost(rig.url, '/api/orchestrator/messages', { to: 'inside2', text: 'Do work' })
    expect(racingMessage.status).toBe(409)
    expect(racingMessage.body.error).toBe('That sector is stopping.')

    const racingFailover = await lanePost(rig.url, '/api/orchestrator/failover', { lane: 'inside2' }, outsideTicket)
    expect(racingFailover.status).toBe(409)
    expect(racingFailover.body.error).toBe('That sector is stopping.')

    writeFileSync(stopRelease, '1')
    const stopResult = await stopPromise
    expect(stopResult.status).toBe(200)
    expect(stopResult.body.stoppedLanes).toEqual(['inside1'])

    const afterStart = await tokenPost(rig.url, '/api/control/runs', { lane: 'inside2', task: 'After stop', allowDirty: true, confirmed: true }, rig.token('scout'))
    expect(afterStart.status).toBe(202)
  })

  it('refuses a sub token naming another sub or main with 403 and enforces confirmation', async () => {
    const ladder = {
      subs: [
        { id: 'scout', name: 'Scout', harness: 'claude', model: 'sonnet', lanes: ['inside1'], scope: ['src/**'], restricted: false, setBy: 'owner' },
        { id: 'other', name: 'Other', harness: 'claude', model: 'sonnet', lanes: ['outside'], scope: ['docs/**'], restricted: false, setBy: 'owner' },
      ],
    }
    const rig = await makeRig({ ladder })

    const noToken = await getJson(`${rig.url}/api/orchestrator/stop-tree`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'scout', confirmed: true }),
    })
    expect(noToken.status).toBe(403)

    const sibling = await tokenPost(rig.url, '/api/orchestrator/stop-tree', { id: 'other', confirmed: true }, rig.token('scout'))
    expect(sibling.status).toBe(403)

    const parent = await tokenPost(rig.url, '/api/orchestrator/stop-tree', { id: 'orchestrator', confirmed: true }, rig.token('scout'))
    expect(parent.status).toBe(403)

    const unconfirmed = await tokenPost(rig.url, '/api/orchestrator/stop-tree', { id: 'scout' }, rig.token('scout'))
    expect(unconfirmed.status).toBe(400)

    const unknown = await pagePost(rig.url, '/api/orchestrator/stop-tree', { id: 'missing', confirmed: true })
    expect(unknown.status).toBe(404)

    const pageOk = await pagePost(rig.url, '/api/orchestrator/stop-tree', { id: 'scout', confirmed: true })
    expect(pageOk.status).toBe(200)
    expect(pageOk.body.stoppedOrchestrators).toEqual(['scout'])
  })

  it('lets Main stop every orchestrator and every running lane across sectors', async () => {
    const ladder = {
      subs: [
        { id: 'scout', name: 'Scout', harness: 'claude', model: 'sonnet', lanes: ['inside1'], scope: ['src/**'], restricted: false, setBy: 'owner' },
        { id: 'other', name: 'Other', harness: 'claude', model: 'sonnet', lanes: ['inside2'], scope: ['docs/**'], restricted: false, setBy: 'owner' },
      ],
    }
    const rig = await makeRig({ ladder })

    await pagePost(rig.url, '/api/orchestrator/messages', { id: 'orchestrator', text: 'Main hold.', confirmed: true })
    await pagePost(rig.url, '/api/orchestrator/messages', { id: 'scout', text: 'Scout hold.', confirmed: true })
    await pagePost(rig.url, '/api/orchestrator/messages', { id: 'other', text: 'Other hold.', confirmed: true })
    await waitFor(() => readJsonLines(rig.orchCalls).length === 3, 10000, 'all orchestrators working')

    expect((await tokenPost(rig.url, '/api/control/runs', { lane: 'inside1', task: 'Work 1', allowDirty: true, confirmed: true }, rig.token('scout'))).status).toBe(202)
    expect((await tokenPost(rig.url, '/api/control/runs', { lane: 'inside2', task: 'Work 2', allowDirty: true, confirmed: true }, rig.token('other'))).status).toBe(202)
    expect((await pagePost(rig.url, '/api/control/runs', { lane: 'outside', task: 'Work 3', allowDirty: true, confirmed: true })).status).toBe(202)
    await waitFor(() => readJsonLines(rig.calls).length === 3, 10000, 'all three lanes running')

    const stopped = await tokenPost(rig.url, '/api/orchestrator/stop-tree', { id: 'orchestrator', confirmed: true }, rig.token('orchestrator'))
    expect(stopped.status).toBe(200)
    expect([...stopped.body.stoppedOrchestrators].sort()).toEqual(['orchestrator', 'other', 'scout'])
    expect([...stopped.body.stoppedLanes].sort()).toEqual(['inside1', 'inside2', 'outside'])
    expect(stopped.body.stillRunning).toEqual([])

    for (const id of ['orchestrator', 'scout', 'other']) {
      const chat = await getJson(`${rig.url}/api/orchestrator?id=${id}`)
      expect(chat.body.state).toBe('paused')
    }
    const runsState = await getJson(`${rig.url}/api/control/runs`)
    expect(runsState.body.running).toEqual([])
  })

  it('finds and stops an unclaimed failover backup run by its lane', async () => {
    const ladder = {
      subs: [
        { id: 'scout', name: 'Scout', harness: 'claude', model: 'sonnet', lanes: ['inside1', 'inside2'], scope: ['src/**'], restricted: false, setBy: 'owner' },
      ],
    }
    const rig = await makeRig({ ladder })

    const backupScript = join(rig.base, 'backup-run.mjs')
    writeFileSync(backupScript, "setTimeout(() => {}, 60000)\n")
    const backupChild = spawn(process.execPath, [backupScript], { stdio: 'ignore', windowsHide: true })
    cleanups.push(() => killTree(backupChild))

    const backupStamp = '20261116-120000'
    const backupName = `inside2-project-${backupStamp}`
    const backupStartedAt = Date.now()
    writeFileSync(join(rig.pidDir, 'inside2.pid'), String(backupChild.pid))
    writeFileSync(
      join(rig.runs, 'inside2.lock'),
      laneLockText({ pid: backupChild.pid, folder: rig.projectRoot, projectRun: true, startedAt: backupStartedAt, log: `${backupName}.log` })
    )
    writeFileSync(join(rig.runs, `${backupName}.meta.json`), `${JSON.stringify({ lane: 'inside2', project: rig.projectRoot })}\n`)
    writeFileSync(join(rig.runs, `${backupName}.log`), '{"type":"text","part":{"type":"text","text":"backup"}}\n')

    await waitFor(
      async () => (await getJson(`${rig.url}/api/control/live-runs`)).body.runs?.some((r) => r.issueId === backupName),
      10000,
      'lanes source to see backup run'
    )

    const stopped = await tokenPost(rig.url, '/api/orchestrator/stop-tree', { id: 'scout', confirmed: true }, rig.token('scout'))
    expect(stopped.status).toBe(200)
    expect(stopped.body.stoppedLanes).toEqual(['inside2'])
    expect(stopped.body.stillRunning).toEqual([])
    await waitFor(
      () => !listProcesses().some((proc) => proc.pid === backupChild.pid),
      10000,
      'backup process to exit'
    )
  })

  it('reports a lane with a surviving child process in stillRunning even when stop answers ok', async () => {
    const ladder = {
      subs: [
        { id: 'scout', name: 'Scout', harness: 'claude', model: 'sonnet', lanes: ['inside1'], scope: ['src/**'], restricted: false, setBy: 'owner' },
      ],
    }
    const rig = await makeRig({ ladder, spawnSurvivorFor: 'inside1' })

    expect((await tokenPost(rig.url, '/api/control/runs', { lane: 'inside1', task: 'Spawn child', allowDirty: true, confirmed: true }, rig.token('scout'))).status).toBe(202)
    await waitFor(
      () => existsSync(rig.survivorPidFile) && Number(readFileSync(rig.survivorPidFile, 'utf8').trim()) > 0,
      10000,
      'surviving child pid'
    )
    const survivorPid = Number(readFileSync(rig.survivorPidFile, 'utf8').trim())
    expect(Number.isInteger(survivorPid) && survivorPid > 0).toBe(true)

    const stopped = await tokenPost(rig.url, '/api/orchestrator/stop-tree', { id: 'scout', confirmed: true }, rig.token('scout'))
    expect(stopped.status).toBe(200)
    expect(stopped.body.stoppedOrchestrators).toEqual(['scout'])
    expect(stopped.body.stoppedLanes).toEqual([])
    expect(stopped.body.stillRunning).toEqual(['inside1'])
  })
})
