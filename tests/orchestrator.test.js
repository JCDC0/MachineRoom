import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { createLanesSource } from '../server/lanes-source.js'
import { createOrchestrator } from '../server/orchestrator.js'
import { briefProblems } from '../src/briefs/run.js'
import { getJson, postJson } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ORCHESTRATOR_LANE = {
  name: 'Orchestrator',
  harness: 'Claude Code',
  cli: { harness: 'claude', bin: 'claude', model: 'opus' },
}
const LANES = { orchestrator: ORCHESTRATOR_LANE }
const DEAD_PAPERCLIP = 'http://127.0.0.1:3999'
const PROMPT = 'project={{PROJECT}}\nmachineroom={{MACHINEROOM}}\nruns={{RUNS}}\nbridge={{BRIDGE}}'

const FAKE_CLAUDE = [
  "import { appendFileSync, existsSync } from 'node:fs'",
  'const args = process.argv.slice(2)',
  "const at = args.indexOf('-p')",
  "const prompt = at === -1 ? '' : String(args[at + 1] ?? '')",
  "const calls = String(process.env.MR_CALLS ?? '')",
  "if (calls) appendFileSync(calls, JSON.stringify({ pid: process.pid, args, cwd: process.cwd() }) + '\\n')",
  "console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }))",
  "console.log(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Working.' }] } }))",
  "const mode = String(process.env.MR_MODE ?? 'reply')",
  "if (mode === 'hold') {",
  "  while (!existsSync(String(process.env.MR_RELEASE ?? ''))) {",
  '    await new Promise((done) => setTimeout(done, 20))',
  '  }',
  '}',
  "const reply = mode === 'empty' ? '' : mode === 'fail' ? 'You have hit your session limit.' : 'Reply: ' + prompt.split('\\n').join(' / ').slice(0, 200)",
  "console.log(JSON.stringify({ type: 'result', subtype: 'success', result: reply, total_cost_usd: 0.125 }))",
  "if (mode === 'fail') process.exitCode = 3",
].join('\n')

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function sleep(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms))
}

async function waitFor(check, timeoutMs = 15000, what = 'the orchestrator') {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`)
    await sleep(15)
  }
}

function readLines(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function makeRig({ prompt = PROMPT, mode = 'reply', lanes = LANES, project = true } = {}) {
  const base = makeTempDir('mr-orchestrator-')
  const runs = join(base, 'runs')
  const projectRoot = project ? join(base, 'project') : ''
  mkdirSync(runs, { recursive: true })
  if (projectRoot) mkdirSync(projectRoot, { recursive: true })
  const script = join(base, 'fake-claude.mjs')
  writeFileSync(script, FAKE_CLAUDE)
  const promptFile = join(base, 'orchestrator-agent.md')
  if (prompt !== null) writeFileSync(promptFile, prompt)
  const callsFile = join(base, 'calls.jsonl')
  const releaseFile = join(base, 'release')
  const behaviour = { mode }
  const spawned = []
  const spawnFake = (file, args, options) => {
    spawned.push({ file, args: [...args], shell: options.shell, cwd: options.cwd })
    const env = {
      ...(options.env ?? process.env),
      MR_CALLS: callsFile,
      MR_MODE: behaviour.mode,
      MR_RELEASE: releaseFile,
    }
    return spawn(process.execPath, [script, ...args], { ...options, env })
  }
  const notices = []
  const orchestrator = createOrchestrator({
    projectRoot,
    runsFolder: runs,
    lanes,
    spawn: spawnFake,
    promptFile,
    bridgeUrl: () => 'http://127.0.0.1:5999',
    onNotice: (event) => notices.push(event),
  })
  const rig = {
    base,
    runs,
    projectRoot,
    script,
    callsFile,
    releaseFile,
    promptFile,
    behaviour,
    notices,
    orchestrator,
    spawned,
    calls: () => readLines(callsFile),
    answer: () => orchestrator.answer(),
    send(text) {
      return orchestrator.send({ text, confirmed: true })
    },
  }
  cleanups.push(async () => {
    orchestrator.close()
    await sleep(20)
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  return rig
}

async function waitIdle(rig, count) {
  await waitFor(() => rig.answer().state === 'idle' && rig.calls().length === count, 15000, `turn ${count} to end`)
}

function recordsOf(rig) {
  return readLines(join(rig.runs, 'runs.jsonl'))
}

function frame(runId, status, lane = 'opencode7') {
  return {
    type: 'heartbeat.run.status',
    payload: { runId, agentId: `agent-${lane}`, status },
  }
}

function valueAfter(args, flag) {
  return args[args.indexOf(flag) + 1]
}

describe('the orchestrator lane', () => {
  it('is in lanes.json with the Claude command line and is refused by run-lane', () => {
    const lanes = JSON.parse(readFileSync(new URL('../docs/agents/lanes.json', import.meta.url), 'utf8'))
    expect(lanes.orchestrator).toEqual({
      name: 'Orchestrator',
      harness: 'Claude Code',
      cli: { harness: 'claude', bin: 'claude', model: 'opus' },
    })
    expect(briefProblems({ briefs: [], ids: ['K1'], laneKey: 'orchestrator', branchExists: () => false })).toEqual([
      'The orchestrator lane runs from the room, not from run-lane.',
    ])
    const result = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts', 'run-lane.mjs'), 'orchestrator', 'K1', '--dry-run'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('The orchestrator lane runs from the room, not from run-lane.')
  })
})

describe('one orchestrator turn', () => {
  it('starts Claude in the project with the filled prompt, then resumes the same session', async () => {
    const rig = makeRig()
    expect(rig.answer()).toMatchObject({ state: 'idle', model: 'opus', project: rig.projectRoot })
    const first = rig.send('Build the room.')
    expect(first.status).toBe(202)
    expect(typeof first.body.id).toBe('string')
    await waitIdle(rig, 1)

    const calls = rig.calls()
    expect(calls).toHaveLength(1)
    expect(rig.spawned[0].file).toBe('claude')
    expect(rig.spawned[0].shell).toBe(false)
    expect(rig.spawned[0].cwd).toBe(rig.projectRoot)
    expect(calls[0].args[0]).toBe('-p')
    expect(calls[0].args[1]).toBe('Build the room.')
    expect(valueAfter(calls[0].args, '--output-format')).toBe('stream-json')
    expect(calls[0].args).toContain('--verbose')
    expect(valueAfter(calls[0].args, '--model')).toBe('opus')
    expect(calls[0].args).toContain('--dangerously-skip-permissions')
    expect(calls[0].args).not.toContain('--resume')
    const sessionId = valueAfter(calls[0].args, '--session-id')
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(valueAfter(calls[0].args, '--append-system-prompt')).toBe(
      `project=${rig.projectRoot}\nmachineroom=${REPO_ROOT}\nruns=${rig.runs}\nbridge=http://127.0.0.1:5999`
    )
    const reply = rig.answer().messages.at(-1)
    expect(reply.from).toBe('orchestrator')
    expect(reply.text).toContain('Reply: Build the room.')

    rig.send('And then run the tests.')
    await waitIdle(rig, 2)
    const second = rig.calls()[1]
    expect(second.args).not.toContain('--session-id')
    expect(valueAfter(second.args, '--resume')).toBe(sessionId)
    expect(second.args[1]).toBe('And then run the tests.')
    expect(recordsOf(rig).at(-1)).toMatchObject({ lane: 'orchestrator', exitCode: 0, killed: false, costUsd: 0.125 })
    expect(rig.notices.length).toBeGreaterThan(0)
    expect(rig.notices.every((event) => event.topic === 'orchestrator')).toBe(true)
  })

  it('waits a message that arrives during a turn and sends it in the next one', async () => {
    const rig = makeRig()
    rig.behaviour.mode = 'hold'
    rig.send('First job')
    await waitFor(() => rig.calls().length === 1)
    expect(rig.answer().state).toBe('working')

    rig.send('Second job')
    await sleep(120)
    expect(rig.calls()).toHaveLength(1)
    expect(rig.answer().messages.some((message) => message.text === 'Second job')).toBe(true)

    writeFileSync(rig.releaseFile, 'go')
    await waitFor(() => rig.calls().length === 2)
    await waitIdle(rig, 2)
    expect(rig.calls()[1].args[1]).toBe('Second job')
  })

  it('turns a failed exit and an empty reply into plain sentences', async () => {
    const rig = makeRig()
    rig.behaviour.mode = 'empty'
    rig.send('Say nothing')
    await waitIdle(rig, 1)
    expect(rig.answer().messages.at(-1).text).toBe('The orchestrator ended its turn without a reply.')

    rig.behaviour.mode = 'fail'
    rig.send('Fail now')
    await waitIdle(rig, 2)
    expect(rig.answer().messages.at(-1).text).toBe('The orchestrator stopped: You have hit your session limit.')
  })

  it('uses the three-sentence fallback when the prompt file is missing', async () => {
    const rig = makeRig({ prompt: null })
    rig.send('Hello')
    await waitIdle(rig, 1)
    const instruction = valueAfter(rig.calls()[0].args, '--append-system-prompt')
    expect(instruction).toContain(rig.projectRoot)
    expect(instruction).toContain('Never push')
    expect(instruction.split(/\.\s+/)).toHaveLength(3)
  })
})

describe('waking the orchestrator', () => {
  it('adds a room message with the run record and starts a turn', async () => {
    const rig = makeRig()
    rig.send('Hello')
    await waitIdle(rig, 1)

    const log = join(rig.runs, 'opencode7-K1-20261024-120000.log')
    writeFileSync(log, 'a log\n')
    appendFileSync(
      join(rig.runs, 'runs.jsonl'),
      `${JSON.stringify({
        lane: 'opencode7',
        briefs: ['K1'],
        model: 'm',
        startedAt: '2026-10-24T12:00:00.000Z',
        minutes: 4,
        exitCode: 0,
        killed: false,
        costUsd: 0.5,
        log,
        branch: 'feat/k1-the-orchestrator-in',
        commits: ['abc1234 First commit', 'def5678 Second commit'],
      })}\n`
    )
    rig.orchestrator.onFrame(frame('run-opencode7-K1-20261024-120000', 'succeeded'))
    await waitFor(() => rig.calls().length === 2)
    await waitIdle(rig, 2)

    const prompt = rig.calls()[1].args[1]
    expect(prompt).toContain('Run opencode7-K1-20261024-120000 on lane opencode7 ended: succeeded.')
    expect(prompt).toContain('lane opencode7')
    expect(prompt).toContain('briefs K1')
    expect(prompt).toContain('exit 0')
    expect(prompt).toContain('branch feat/k1-the-orchestrator-in')
    expect(prompt).toContain('abc1234 First commit')
    expect(prompt).toContain('0.5000 USD')
    expect(rig.answer().messages.some((message) => message.from === 'room')).toBe(true)

    const queueLog = join(rig.runs, 'opencode2-queue-20261024-120500-2.log')
    writeFileSync(queueLog, 'a log\n')
    appendFileSync(
      join(rig.runs, 'runs.jsonl'),
      `${JSON.stringify({ lane: 'opencode2', briefs: [], exitCode: 0, killed: false, log: queueLog, branch: '', commits: [], project: rig.projectRoot, queue: 'machineroom/queue-20261024-120500', queueIndex: 2 })}\n`
    )
    rig.orchestrator.onFrame(frame('run-opencode2-queue-20261024-120500-2', 'succeeded'))
    await waitFor(() => rig.calls().length === 3)
    await waitIdle(rig, 3)
    const queuePrompt = rig.calls()[2].args[1]
    expect(queuePrompt).toContain('branch machineroom/queue-20261024-120500')
    expect(queuePrompt).toContain('This was task 2 of a queue.')

    rig.orchestrator.onFrame(frame('run-orchestrator-chat-1', 'succeeded', 'orchestrator'))
    await sleep(150)
    expect(rig.calls()).toHaveLength(3)

    rig.orchestrator.stop({ confirmed: true })
    rig.orchestrator.onFrame(frame('run-opencode7-K2-20261024-130000', 'failed'))
    await sleep(150)
    expect(rig.calls()).toHaveLength(3)
  })

  it('starts at most 30 room turns in an hour and waits for the owner after that', async () => {
    const rig = makeRig()
    rig.send('Start')
    await waitIdle(rig, 1)

    for (let index = 0; index < 30; index += 1) {
      rig.orchestrator.onFrame(frame(`run-opencode7-cap-${index}`, 'succeeded'))
      await waitIdle(rig, 2 + index)
    }
    rig.orchestrator.onFrame(frame('run-opencode7-cap-30', 'succeeded'))
    await waitFor(() => rig.answer().messages.some((message) => message.text.includes('cap-30')))
    await sleep(250)
    expect(rig.calls()).toHaveLength(31)
    expect(rig.answer().state).toBe('idle')

    rig.send('The owner is here')
    await waitIdle(rig, 32)
    const prompt = rig.calls()[31].args[1]
    expect(prompt).toContain('Run opencode7-cap-30 on lane opencode7 ended: succeeded.')
    expect(prompt).toContain('The owner is here')
  }, 60000)

  it('kills the turn on stop, pauses and clears the pause on the next owner message', async () => {
    const rig = makeRig()
    rig.behaviour.mode = 'hold'
    rig.send('A long job')
    await waitFor(() => rig.calls().length === 1)
    const pid = rig.calls()[0].pid
    expect(rig.orchestrator.stop({})).toEqual({ status: 400, body: { error: 'Confirm the stop first.' } })
    expect(rig.orchestrator.stop({ confirmed: true })).toEqual({ status: 200, body: { ok: true } })
    expect(rig.answer().state).toBe('paused')
    await waitFor(() => {
      try {
        process.kill(pid, 0)
        return false
      } catch {
        return true
      }
    })
    await waitFor(() => rig.answer().messages.some((message) => /^The orchestrator stopped/.test(message.text)))
    expect(recordsOf(rig).at(-1)).toMatchObject({ lane: 'orchestrator', killed: true })
    expect(rig.answer().state).toBe('paused')

    rig.behaviour.mode = 'reply'
    rig.send('Go on')
    await waitIdle(rig, 2)
    expect(rig.answer().state).toBe('idle')
  })
})

describe('the orchestrator conversation file', () => {
  it('restores the chat and the session after a restart', async () => {
    const rig = makeRig()
    rig.send('Remember me')
    await waitIdle(rig, 1)
    rig.orchestrator.stop({ confirmed: true })
    const sessionId = valueAfter(rig.calls()[0].args, '--session-id')
    const file = readdirSync(rig.runs).find((name) => /^orchestrator-[0-9a-f]{8}\.json$/.test(name))
    expect(file).toBeTruthy()
    const saved = JSON.parse(readFileSync(join(rig.runs, file), 'utf8'))
    expect(saved.sessionId).toBe(sessionId)
    expect(saved.state).toBe('paused')
    expect(saved.messages.some((message) => message.text === 'Remember me')).toBe(true)
    rig.orchestrator.close()

    const callsFile = join(rig.base, 'calls-restored.jsonl')
    const spawnFake = (source, args, options) => {
      const env = {
        ...(options.env ?? process.env),
        MR_CALLS: callsFile,
        MR_MODE: 'reply',
        MR_RELEASE: join(rig.base, 'no-release'),
      }
      return spawn(process.execPath, [rig.script, ...args], { ...options, env })
    }
    const restored = createOrchestrator({
      projectRoot: rig.projectRoot,
      runsFolder: rig.runs,
      lanes: LANES,
      spawn: spawnFake,
      promptFile: rig.promptFile,
    })
    cleanups.push(async () => restored.close())
    const chat = restored.answer()
    expect(chat.state).toBe('paused')
    expect(chat.messages.some((message) => message.text === 'Remember me')).toBe(true)
    expect(chat.messages.some((message) => message.from === 'orchestrator')).toBe(true)

    restored.send({ text: 'Still there?', confirmed: true })
    await waitFor(() => readLines(callsFile).length === 1)
    await waitFor(() => restored.answer().state === 'idle')
    const args = readLines(callsFile)[0].args
    expect(args).not.toContain('--session-id')
    expect(valueAfter(args, '--resume')).toBe(sessionId)
    expect(restored.answer().messages.some((message) => message.text === 'Still there?')).toBe(true)
  })
})

describe('the orchestrator routes', () => {
  it('refuses a message without a confirmation, a bad text and a stop without a confirmation', async () => {
    const rig = makeRig()
    const bridge = createBridge({
      paperclipUrl: DEAD_PAPERCLIP,
      companyId: 'comp-orchestrator',
      projectRoot: rig.projectRoot,
      port: 0,
      env: {},
      surfaceEveryMs: 0,
      reconnectMinMs: 60000,
      reconnectMaxMs: 60000,
      lanesSource: { folder: rig.runs, lanes: LANES, pollMs: 20, quietMs: 60000 },
      orchestratorSpawn: () => {
        throw new Error('No turn should start in this test.')
      },
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const health = await getJson(`${url}/api/health`)
    expect(health.body.orchestrator).toBe(true)
    const chat = await getJson(`${url}/api/orchestrator`)
    expect(chat.status).toBe(200)
    expect(chat.body).toMatchObject({ state: 'idle', model: 'opus', project: rig.projectRoot })
    expect(Array.isArray(chat.body.messages)).toBe(true)

    expect((await postJson(`${url}/api/orchestrator/messages`, { text: 'Build it' })).body).toEqual({
      error: 'Confirm the message first.',
    })
    expect((await postJson(`${url}/api/orchestrator/messages`, { text: 'Build it', confirmed: false })).status).toBe(400)
    expect((await postJson(`${url}/api/orchestrator/messages`, { text: '   ', confirmed: true })).body).toEqual({
      error: 'Write a message from 1 to 8000 characters.',
    })
    expect((await postJson(`${url}/api/orchestrator/messages`, { text: 'x'.repeat(8001), confirmed: true })).status).toBe(400)
    expect((await postJson(`${url}/api/orchestrator/messages`, { text: 42, confirmed: true })).status).toBe(400)
    expect((await postJson(`${url}/api/orchestrator/stop`, {})).body).toEqual({
      error: 'Confirm the stop first.',
    })
    expect((await postJson(`${url}/api/orchestrator/stop`, { confirmed: true })).body).toEqual({ ok: true })
    expect((await getJson(`${url}/api/orchestrator`)).body.state).toBe('paused')
  })

  it('answers 409 with no project folder and is absent when the lane source is off', async () => {
    const rig = makeRig({ project: false })
    const bridge = createBridge({
      paperclipUrl: DEAD_PAPERCLIP,
      companyId: 'comp-orchestrator',
      projectRoot: '',
      port: 0,
      env: {},
      surfaceEveryMs: 0,
      reconnectMinMs: 60000,
      reconnectMaxMs: 60000,
      lanesSource: { folder: rig.runs, lanes: LANES, pollMs: 20, quietMs: 60000 },
      orchestratorSpawn: () => {
        throw new Error('No turn should start in this test.')
      },
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    expect((await postJson(`${url}/api/orchestrator/messages`, { text: 'Build it', confirmed: true })).status).toBe(409)
    expect((await getJson(`${url}/api/orchestrator`)).body.project).toBe('')

    const off = createBridge({ paperclipUrl: DEAD_PAPERCLIP, companyId: 'comp-off', projectRoot: rig.projectRoot, port: 0, env: {}, surfaceEveryMs: 0, reconnectMinMs: 60000, reconnectMaxMs: 60000 })
    cleanups.push(() => off.stop())
    const offUrl = (await off.start()).url
    expect((await getJson(`${offUrl}/api/orchestrator`)).status).toBe(404)
    expect((await getJson(`${offUrl}/api/health`)).body.orchestrator).toBeUndefined()
  })
})

describe('the lane source and the orchestrator turn', () => {
  it('shows the turn from its meta project and ends it on the run record', async () => {
    const rig = makeRig()
    const frames = []
    const source = createLanesSource({
      folder: rig.runs,
      projectRoot: rig.projectRoot,
      repoRoot: rig.projectRoot,
      lanes: LANES,
      pollMs: 20,
      quietMs: 60000,
      onFrame: (item) => frames.push(item),
    })
    cleanups.push(() => source.stop())
    source.start()

    rig.send('Show this turn.')
    await waitFor(
      () =>
        frames.some(
          (item) =>
            item.type === 'heartbeat.run.status' &&
            item.payload.status === 'succeeded' &&
            item.payload.agentId === 'agent-orchestrator'
        ),
      15000,
      'the lane source to end the orchestrator run'
    )
    const running = frames.filter(
      (item) => item.type === 'heartbeat.run.status' && item.payload.status === 'running' && item.payload.agentId === 'agent-orchestrator'
    )
    expect(running).toHaveLength(1)

    const record = recordsOf(rig).at(-1)
    expect(record).toMatchObject({ lane: 'orchestrator', exitCode: 0, killed: false })
    expect(record.log).toMatch(/orchestrator-chat-.+\.log$/)
    const log = readFileSync(record.log, 'utf8')
    expect(log).toContain('"type":"result"')
    const meta = JSON.parse(readFileSync(record.log.replace(/\.log$/, '.meta.json'), 'utf8'))
    expect(meta.project).toBe(rig.projectRoot)
    expect(meta.sessionId).toBe(valueAfter(rig.calls()[0].args, '--session-id'))
  })
})
