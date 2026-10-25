import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { createLanesSource, laneAgents } from '../server/lanes-source.js'
import { chatFileFor, chatLockFileFor, createOrchestrator, contextTokensFromLog, COMPACTED_MESSAGE, COMPACT_PROMPT, RESTART_MESSAGE } from '../server/orchestrator.js'
import { briefProblems } from '../src/briefs/run.js'
import { getJson, postJson } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

function pagePostJson(url, body) {
  return getJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  })
}

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ORCHESTRATOR_LANE = {
  name: 'Orchestrator',
  harness: 'Claude Code',
  cli: { harness: 'claude', bin: 'claude', model: 'opus' },
}
const OPENCODE_LANE = {
  name: 'Orchestrator',
  harness: 'OpenCode',
  cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
}
const LANES = { orchestrator: ORCHESTRATOR_LANE }
const OPENCODE_LANES = { orchestrator: OPENCODE_LANE }
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
  "const keyReply = 'I read OPENROUTER_API_KEY=' + 'sk-or-v1-' + 'q'.repeat(24) + ' in the file.'",
  "const reply = mode === 'empty' ? '' : mode === 'fail' ? 'You have hit your session limit.' : mode === 'key' ? keyReply : 'Reply: ' + prompt.split('\\n').join(' / ').slice(0, 200)",
  "const input = Number(process.env.MR_INPUT ?? 12)",
  "const cacheRead = Number(process.env.MR_CACHE_READ ?? 0)",
  "const cacheWrite = Number(process.env.MR_CACHE_WRITE ?? 0)",
  "console.log(JSON.stringify({ type: 'result', subtype: 'success', result: reply, total_cost_usd: 0.125, usage: { input_tokens: input, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, output_tokens: 3 } }))",
  "if (mode === 'fail') process.exitCode = 3",
].join('\n')

const FAKE_OPENCODE = [
  "import { appendFileSync, existsSync } from 'node:fs'",
  'const args = process.argv.slice(2)',
  "const calls = String(process.env.MR_CALLS ?? '')",
  "if (calls) appendFileSync(calls, JSON.stringify({ pid: process.pid, args, cwd: process.cwd() }) + '\\n')",
  "const at = args.indexOf('--session')",
  "const sessionId = at === -1 ? 'ses_fake_first' : String(args[at + 1] ?? '')",
  "const prompt = String(args.at(-1) ?? '')",
  "console.log(JSON.stringify({ type: 'step_start', timestamp: 1, sessionID: sessionId, part: { type: 'step-start' } }))",
  "console.log(JSON.stringify({ type: 'tool_use', timestamp: 2, sessionID: sessionId, part: { id: 'prt_1', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'src/math.js' } } } }))",
  "const mode = String(process.env.MR_MODE ?? 'reply')",
  "if (mode === 'hold') {",
  "  while (!existsSync(String(process.env.MR_RELEASE ?? ''))) {",
  '    await new Promise((done) => setTimeout(done, 20))',
  '  }',
  '}',
  "console.log(JSON.stringify({ type: 'text', timestamp: 3, sessionID: sessionId, part: { type: 'text', text: 'Working.' } }))",
  "const reply = mode === 'fail' ? '' : 'Reply: ' + prompt.split('\\n').join(' / ').slice(0, 200)",
  "console.log(JSON.stringify({ type: 'text', timestamp: 4, sessionID: sessionId, part: { type: 'text', text: reply } }))",
  "const input = Number(process.env.MR_INPUT ?? 12)",
  "const cacheRead = Number(process.env.MR_CACHE_READ ?? 0)",
  "const cacheWrite = Number(process.env.MR_CACHE_WRITE ?? 0)",
  "console.log(JSON.stringify({ type: 'step_finish', timestamp: 5, sessionID: sessionId, part: { type: 'step-finish', cost: 0.25, tokens: { input, output: 3, cache: { read: cacheRead, write: cacheWrite } } } }))",
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

function makeRig({ prompt = PROMPT, mode = 'reply', lanes = LANES, harness = 'claude', project = true } = {}) {
  const base = makeTempDir('mr-orchestrator-')
  const runs = join(base, 'runs')
  const projectRoot = project ? join(base, 'project') : ''
  mkdirSync(runs, { recursive: true })
  if (projectRoot) mkdirSync(projectRoot, { recursive: true })
  const script = join(base, harness === 'opencode' ? 'fake-opencode.mjs' : 'fake-claude.mjs')
  writeFileSync(script, harness === 'opencode' ? FAKE_OPENCODE : FAKE_CLAUDE)
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
      MR_INPUT: String(behaviour.input ?? 12),
      MR_CACHE_READ: String(behaviour.cacheRead ?? 0),
      MR_CACHE_WRITE: String(behaviour.cacheWrite ?? 0),
    }
    return spawn(process.execPath, [script, ...args], { ...options, env })
  }
  const notices = []
  const masked = { total: 0 }
  const orchestrator = createOrchestrator({
    projectRoot,
    runsFolder: runs,
    lanes,
    spawn: spawnFake,
    promptFile,
    bridgeUrl: () => 'http://127.0.0.1:5999',
    onNotice: (event) => notices.push(event),
    onMasked: (count) => {
      masked.total += count
    },
  })
  const rig = {
    base,
    runs,
    projectRoot,
    script,
    callsFile,
    releaseFile,
    promptFile,
    lanes,
    harness,
    behaviour,
    notices,
    masked,
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

function restoreRig(rig, { mode = 'reply', file = 'calls-restored.jsonl' } = {}) {
  const callsFile = join(rig.base, file)
  const spawnFake = (source, args, options) => {
    const env = {
      ...(options.env ?? process.env),
      MR_CALLS: callsFile,
      MR_MODE: mode,
      MR_RELEASE: join(rig.base, 'no-release'),
    }
    return spawn(process.execPath, [rig.script, ...args], { ...options, env })
  }
  const masked = { total: 0 }
  const orchestrator = createOrchestrator({
    projectRoot: rig.projectRoot,
    runsFolder: rig.runs,
    lanes: rig.lanes,
    spawn: spawnFake,
    promptFile: rig.promptFile,
    bridgeUrl: () => 'http://127.0.0.1:5999',
    onMasked: (count) => {
      masked.total += count
    },
  })
  cleanups.push(async () => orchestrator.close())
  return {
    orchestrator,
    callsFile,
    calls: () => readLines(callsFile),
    answer: () => orchestrator.answer(),
    masked,
  }
}

function stateFile(rig) {
  const file = readdirSync(rig.runs).find((name) => /^orchestrator-[0-9a-f]{8}\.json$/.test(name))
  return JSON.parse(readFileSync(join(rig.runs, file), 'utf8'))
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
      cli: { harness: 'claude', bin: 'claude', model: 'opus', contextWindow: 200000 },
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
    expect(recordsOf(rig).at(-1)).toMatchObject({ lane: 'orchestrator', exitCode: 0, killed: false, costUsd: 0.125, inputTokens: 12, outputTokens: 3 })
    expect(rig.notices.length).toBeGreaterThan(0)
    expect(rig.notices.every((event) => event.topic === 'orchestrator')).toBe(true)
  })

  it('runs an OpenCode turn with the instructions first, then the same session', async () => {
    const rig = makeRig({ harness: 'opencode', lanes: OPENCODE_LANES })
    expect(rig.answer()).toMatchObject({ state: 'idle', model: 'opencode-go/deepseek-v4.1-flash' })
    rig.send('Build the room.')
    await waitIdle(rig, 1)

    const calls = rig.calls()
    expect(calls).toHaveLength(1)
    const first = calls[0].args
    expect(rig.spawned[0].file).toBe('opencode')
    expect(rig.spawned[0].shell).toBe(false)
    expect(rig.spawned[0].cwd).toBe(rig.projectRoot)
    expect(first.slice(0, 5)).toEqual(['run', '--format', 'json', '--model', 'opencode-go/deepseek-v4.1-flash'])
    expect(first).toContain('--auto')
    const title = valueAfter(first, '--title')
    expect(title).toMatch(/^orchestrator-chat-/)
    expect(first).not.toContain('--session')
    const prompt = first.at(-1)
    expect(prompt.startsWith(`project=${rig.projectRoot}`)).toBe(true)
    expect(prompt).toContain(`bridge=http://127.0.0.1:5999`)
    expect(prompt.endsWith('Build the room.')).toBe(true)

    const reply = rig.answer().messages.at(-1)
    expect(reply.from).toBe('orchestrator')
    expect(reply.text.startsWith('Reply: project=')).toBe(true)
    expect(reply.text).not.toBe('Working.')

    const saved = stateFile(rig)
    expect(saved.sessionId).toBe('ses_fake_first')
    expect(saved.state).toBe('idle')
    const record = recordsOf(rig).at(-1)
    expect(record).toMatchObject({
      lane: 'orchestrator',
      model: 'opencode-go/deepseek-v4.1-flash',
      exitCode: 0,
      killed: false,
      costUsd: 0.25,
      inputTokens: 12,
      outputTokens: 3,
    })
    expect(basename(record.log, '.log')).toBe(title)
    const meta = JSON.parse(readFileSync(record.log.replace(/\.log$/, '.meta.json'), 'utf8'))
    expect(meta).toEqual({ project: rig.projectRoot, sessionId: 'ses_fake_first' })

    rig.send('And then run the tests.')
    await waitIdle(rig, 2)
    const second = rig.calls()[1].args
    expect(valueAfter(second, '--session')).toBe('ses_fake_first')
    expect(second.at(-1)).toBe('And then run the tests.')
    expect(second.at(-1)).not.toContain('project=')
    expect(recordsOf(rig).at(-1)).toMatchObject({ costUsd: 0.25 })
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

describe('the context use', () => {
  it('reads the last top-level Claude result usage with both cache counts', () => {
    const log = [
      JSON.stringify({ type: 'result', usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 } }),
      JSON.stringify({ type: 'result', parent_tool_use_id: 'tool-1', usage: { input_tokens: 900 } }),
      JSON.stringify({ type: 'result', usage: { input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 } }),
    ].join('\n')
    expect(contextTokensFromLog('claude', log)).toBe(150)
  })

  it('reads the last OpenCode step tokens with both cache counts', () => {
    const log = [
      JSON.stringify({ type: 'step_finish', part: { tokens: { input: 1, output: 2, cache: { read: 3, write: 4 } } } }),
      JSON.stringify({ type: 'step_finish', part: { tokens: { input: 100, output: 2, cache: { read: 20, write: 30 } } } }),
    ].join('\n')
    expect(contextTokensFromLog('opencode', log)).toBe(150)
  })

  it('reports no context use when the log has no usage', () => {
    expect(contextTokensFromLog('claude', 'not json\n')).toBeNull()
    expect(contextTokensFromLog('opencode', JSON.stringify({ type: 'text', part: { text: 'Hello' } }))).toBeNull()
  })

  it('takes the window from the lane cli block or the 200000 default', () => {
    const configured = makeRig({
      lanes: {
        orchestrator: {
          ...ORCHESTRATOR_LANE,
          cli: { ...ORCHESTRATOR_LANE.cli, contextWindow: 120000 },
        },
      },
    })
    expect(configured.answer()).toMatchObject({ contextTokens: null, contextWindow: 120000, autocompact: true })
    const plain = makeRig()
    expect(plain.answer()).toMatchObject({ contextTokens: null, contextWindow: 200000, autocompact: true })
  })
})

describe('autocompact', () => {
  it('compacts a session at 80 percent and starts the next turn from the summary', async () => {
    const rig = makeRig()
    rig.behaviour.input = 160000
    rig.send('Build the room.')
    await waitFor(() => rig.calls().length === 2 && rig.answer().state === 'idle', 15000, 'the compacted session')

    const calls = rig.calls()
    const sessionId = valueAfter(calls[0].args, '--session-id')
    expect(calls[1].args).toContain('--resume')
    expect(valueAfter(calls[1].args, '--resume')).toBe(sessionId)
    expect(calls[1].args[1]).toBe(COMPACT_PROMPT)
    expect(rig.answer().messages.some((message) => message.from === 'room' && message.text === COMPACTED_MESSAGE)).toBe(true)
    expect(rig.answer()).toMatchObject({ contextTokens: null, contextWindow: 200000, autocompact: true })
    const saved = stateFile(rig)
    expect(saved.sessionId).toBeNull()
    expect(saved.summary).toContain('Reply: Write a summary')

    rig.behaviour.input = 12
    rig.behaviour.cacheRead = 0
    rig.behaviour.cacheWrite = 0
    rig.send('And then run the tests.')
    await waitFor(() => rig.calls().length === 3 && rig.answer().state === 'idle', 15000, 'the turn after compaction')
    const next = rig.calls()[2].args
    expect(next).not.toContain('--resume')
    const nextSession = valueAfter(next, '--session-id')
    expect(nextSession).not.toBe(sessionId)
    expect(next[1].startsWith('Reply: Write a summary')).toBe(true)
    expect(next[1]).toContain('And then run the tests.')
  })

  it('keeps the same session when autocompact is off', async () => {
    const rig = makeRig()
    expect(rig.orchestrator.setAutocompact({ on: false, confirmed: true })).toEqual({
      status: 200,
      body: { id: 'orchestrator', autocompact: false, autocompactPercent: 80 },
    })
    rig.behaviour.input = 180000
    rig.send('Build the room.')
    await waitFor(() => rig.calls().length === 1 && rig.answer().state === 'idle', 15000, 'the turn to end')
    expect(rig.calls()).toHaveLength(1)
    expect(rig.answer()).toMatchObject({ contextTokens: 180000, autocompact: false, autocompactPercent: 80 })
    expect(rig.answer().messages.some((message) => message.text === COMPACTED_MESSAGE)).toBe(false)
    expect(stateFile(rig).sessionId).toBe(valueAfter(rig.calls()[0].args, '--session-id'))
  })

  it('autocompacts at a custom percent set by the owner', async () => {
    const rig = makeRig()
    expect(rig.orchestrator.setAutocompact({ on: true, percent: 60, confirmed: true })).toEqual({
      status: 200,
      body: { id: 'orchestrator', autocompact: true, autocompactPercent: 60 },
    })
    rig.behaviour.input = 130000
    rig.send('Build the room.')
    await waitFor(() => rig.calls().length === 2 && rig.answer().state === 'idle', 15000, 'the compacted session')
    expect(rig.calls()).toHaveLength(2)
    expect(rig.answer().autocompactPercent).toBe(60)
  })

  it('runs compact now with keep text and refuses while running or with no session', async () => {
    const rig = makeRig()
    expect(rig.orchestrator.compact({ confirmed: true })).toEqual({
      status: 400,
      body: { error: 'The orchestrator has no session yet.' },
    })

    rig.behaviour.mode = 'hold'
    rig.send('Start turn')
    await waitFor(() => rig.answer().state === 'working', 5000, 'turn to start')

    expect(rig.orchestrator.compact({ confirmed: true })).toEqual({
      status: 409,
      body: { error: 'A turn is already running.' },
    })

    writeFileSync(rig.releaseFile, 'go')
    await waitIdle(rig, 1)

    expect(rig.orchestrator.compact({ confirmed: true, keep: 'a'.repeat(2001) })).toEqual({
      status: 400,
      body: { error: 'Write at most 2000 characters to keep.' },
    })

    const compacted = rig.orchestrator.compact({ confirmed: true, keep: 'Keep the tests and bridge passing.' })
    expect(compacted).toEqual({ status: 200, body: { ok: true } })
    await waitIdle(rig, 2)

    const calls = rig.calls()
    expect(calls).toHaveLength(2)
    expect(calls[1].args[1]).toContain(COMPACT_PROMPT)
    expect(calls[1].args[1]).toContain('Keep these in the summary:\nKeep the tests and bridge passing.')
    expect(rig.answer().messages.some((message) => message.from === 'room' && message.text === COMPACTED_MESSAGE)).toBe(true)
  })

  it('sets a model listed for its harness and refuses unlisted models', async () => {
    const rig = makeRig()
    expect(rig.orchestrator.setModel({ model: 'unlisted-model', confirmed: true })).toEqual({
      status: 400,
      body: { error: 'Choose a model listed for this harness.' },
    })
    expect(rig.orchestrator.setModel({ model: 'opencode/deepseek-v4.1-flash-free', confirmed: true })).toEqual({
      status: 400,
      body: { error: 'Choose a model listed for this harness.' },
    })

    expect(rig.orchestrator.setModel({ model: 'claude-sonnet-5-5', confirmed: true })).toEqual({
      status: 200,
      body: { id: 'orchestrator', model: 'claude-sonnet-5-5' },
    })
    expect(rig.answer().model).toBe('claude-sonnet-5-5')

    rig.send('Check the model.')
    await waitIdle(rig, 1)
    const turnArgs = rig.calls()[0].args
    expect(valueAfter(turnArgs, '--model')).toBe('claude-sonnet-5-5')
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

  it('kills a running turn on close, saves the working state and says the room restarted', async () => {
    const rig = makeRig()
    rig.behaviour.mode = 'hold'
    rig.send('A long job')
    await waitFor(() => rig.calls().length === 1)
    const pid = rig.calls()[0].pid
    rig.orchestrator.close()
    await waitFor(() => {
      try {
        process.kill(pid, 0)
        return false
      } catch {
        return true
      }
    })
    expect(stateFile(rig).state).toBe('working')

    const restored = restoreRig(rig)
    expect(restored.answer().state).toBe('idle')
    expect(restored.answer().messages.at(-1)).toMatchObject({ from: 'room', text: RESTART_MESSAGE })
    await sleep(80)
    expect(restored.calls()).toHaveLength(0)
  })

  it('writes the killed turn record on close but adds no message, notice or turn', async () => {
    const rig = makeRig()
    rig.behaviour.mode = 'hold'
    rig.send('A long job')
    await waitFor(() => rig.calls().length === 1)
    const messagesBefore = rig.answer().messages.length
    const noticesBefore = rig.notices.length
    rig.orchestrator.close()
    expect(rig.notices.length).toBe(noticesBefore + 1)
    await waitFor(() => recordsOf(rig).length === 1, 15000, 'the killed turn record')
    await sleep(150)
    expect(rig.answer().messages).toHaveLength(messagesBefore)
    expect(rig.notices.length).toBe(noticesBefore + 1)
    expect(rig.calls()).toHaveLength(1)
    expect(recordsOf(rig)[0]).toMatchObject({ lane: 'orchestrator', killed: true })
    expect(stateFile(rig).messages).toHaveLength(messagesBefore)
  })

  it('keeps an owner message that waited for the next turn and runs it after a restart', async () => {
    const rig = makeRig()
    rig.behaviour.mode = 'hold'
    rig.send('First job')
    await waitFor(() => rig.calls().length === 1)
    rig.send('Second job')
    await sleep(120)
    expect(rig.calls()).toHaveLength(1)
    const pid = rig.calls()[0].pid
    rig.orchestrator.close()
    await waitFor(() => {
      try {
        process.kill(pid, 0)
        return false
      } catch {
        return true
      }
    })

    const saved = stateFile(rig)
    expect(saved.state).toBe('working')
    expect(saved.pending).toHaveLength(1)
    expect(saved.messages.find((message) => message.id === saved.pending[0])).toMatchObject({
      from: 'owner',
      text: 'Second job',
    })

    const restored = restoreRig(rig)
    await waitFor(() => restored.calls().length === 1, 15000, 'the waiting message to start')
    await waitFor(() => restored.answer().state === 'idle')
    const args = restored.calls()[0].args
    expect(args[1]).toBe('Second job')
    expect(valueAfter(args, '--resume')).toBe(saved.sessionId)
    expect(restored.answer().messages.some((message) => message.text === RESTART_MESSAGE)).toBe(true)
  })
})

describe('the orchestrator chat file', () => {
  it('masks a key in the owner message and the reply, and counts each mask', async () => {
    const rig = makeRig()
    const secret = 'sk-or-v1-' + 'q'.repeat(24)
    const setting = 'OPENROUTER_API_KEY='
    rig.behaviour.mode = 'key'
    const sent = rig.send(`Read this: ${setting}${secret}`)
    expect(sent.status).toBe(202)
    await waitIdle(rig, 1)
    const texts = rig.answer().messages.map((message) => message.text).join('\n')
    expect(texts).toContain('[key]')
    expect(texts).not.toContain(secret)
    const saved = readFileSync(chatFileFor(rig.projectRoot, rig.runs), 'utf8')
    expect(saved).toContain('[key]')
    expect(saved).not.toContain(secret)
    expect(rig.masked.total).toBe(2)
  })

  it('masks a key in a chat file it restores', () => {
    const rig = makeRig()
    rig.orchestrator.close()
    const secret = 'sk-or-v1-' + 'q'.repeat(24)
    const setting = 'OPENROUTER_API_KEY='
    const file = chatFileFor(rig.projectRoot, rig.runs)
    writeFileSync(
      file,
      `${JSON.stringify({
        project: rig.projectRoot,
        sessionId: null,
        state: 'idle',
        messages: [{ id: 'm1', from: 'room', text: `The file holds ${setting}${secret}`, at: '2026-10-25T12:00:00.000Z' }],
        pending: [],
      })}\n`
    )
    const restored = restoreRig(rig)
    expect(restored.answer().messages[0].text).toContain('[key]')
    expect(restored.answer().messages[0].text).not.toContain(secret)
    expect(restored.masked.total).toBe(1)
    expect(readFileSync(file, 'utf8')).not.toContain(secret)
  })

  it('keeps a chat file that fails to parse as .bad', () => {
    const rig = makeRig()
    rig.orchestrator.close()
    const file = chatFileFor(rig.projectRoot, rig.runs)
    const broken = '{"state":"wor'
    writeFileSync(file, broken)
    const restored = restoreRig(rig)
    expect(readFileSync(`${file}.bad`, 'utf8')).toBe(broken)
    expect(restored.answer().messages).toEqual([])
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved.messages).toEqual([])
    expect(saved.roomTurns).toEqual([])
  })

  it('keeps the last good chat file when the write fails', async () => {
    const rig = makeRig()
    rig.send('Keep me')
    await waitIdle(rig, 1)
    rig.orchestrator.close()
    const file = chatFileFor(rig.projectRoot, rig.runs)
    const before = readFileSync(file, 'utf8')
    mkdirSync(`${file}.tmp`)
    const restored = restoreRig(rig)
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(restored.answer().messages.some((message) => message.text === 'Keep me')).toBe(true)
  })

  it('refuses a second orchestrator on the same project and takes a stale lock', () => {
    const rig = makeRig()
    const options = { projectRoot: rig.projectRoot, runsFolder: rig.runs, lanes: rig.lanes, promptFile: rig.promptFile }
    const lock = chatLockFileFor(rig.projectRoot, rig.runs)
    expect(readFileSync(lock, 'utf8')).toBe(String(process.pid))
    expect(() => createOrchestrator(options)).toThrow(/Another room is already running on this project/)
    rig.orchestrator.close()
    writeFileSync(lock, '99999999')
    const restored = createOrchestrator(options)
    cleanups.push(async () => restored.close())
    expect(readFileSync(lock, 'utf8')).toBe(String(process.pid))
    expect(restored.answer().state).toBe('idle')
  })

  it('writes a failed record for the turn that was running when the room ended', () => {
    const rig = makeRig()
    rig.orchestrator.close()
    const file = chatFileFor(rig.projectRoot, rig.runs)
    writeFileSync(
      file,
      `${JSON.stringify({
        project: rig.projectRoot,
        sessionId: 'session-1',
        state: 'working',
        messages: [{ id: 'm1', from: 'owner', text: 'Build it', at: '2026-10-25T12:00:00.000Z' }],
        pending: [],
      })}\n`
    )
    const log = join(rig.runs, 'orchestrator-chat-20261025-120000-000.log')
    writeFileSync(log, 'a log\n')
    const restored = restoreRig(rig)
    expect(restored.answer().state).toBe('idle')
    expect(restored.answer().messages.at(-1)).toMatchObject({ from: 'room', text: RESTART_MESSAGE })
    const records = recordsOf(rig)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ lane: 'orchestrator', log, exitCode: null, killed: true })
    expect(records[0].startedAt).toBe(new Date(2026, 9, 25, 12, 0, 0, 0).toISOString())
  })

  it('saves the room turn times and drops the ones older than the hour', async () => {
    const nowMs = Date.parse('2026-10-25T12:00:00.000Z')
    const rig = makeRig()
    rig.orchestrator.close()
    const file = chatFileFor(rig.projectRoot, rig.runs)
    const recent = Array.from({ length: 30 }, (_, index) => nowMs - (index + 1) * 60000)
    const old = nowMs - 2 * 60 * 60 * 1000
    writeFileSync(
      file,
      `${JSON.stringify({
        project: rig.projectRoot,
        sessionId: 'session-1',
        state: 'idle',
        messages: [{ id: 'm1', from: 'owner', text: 'Hello', at: '2026-10-25T12:00:00.000Z' }],
        pending: [],
        roomTurns: [...recent, old],
      })}\n`
    )
    const orchestrator = createOrchestrator({
      projectRoot: rig.projectRoot,
      runsFolder: rig.runs,
      lanes: rig.lanes,
      promptFile: rig.promptFile,
      now: () => nowMs,
      spawn: () => {
        throw new Error('No turn should start while the cap is full.')
      },
    })
    cleanups.push(async () => orchestrator.close())
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved.roomTurns).toHaveLength(30)
    expect(saved.roomTurns).not.toContain(old)
    expect(Math.min(...saved.roomTurns)).toBeGreaterThan(nowMs - 60 * 60 * 1000)

    orchestrator.onFrame(frame('run-opencode7-cap-saved', 'succeeded'))
    await sleep(150)
    expect(orchestrator.answer().messages.filter((message) => message.from === 'orchestrator')).toEqual([])
    expect(orchestrator.answer().messages.some((message) => message.text.includes('cap-saved'))).toBe(true)
  })

  it('writes each room turn time beside the messages', async () => {
    const rig = makeRig()
    rig.send('Start')
    await waitIdle(rig, 1)
    rig.orchestrator.onFrame(frame('run-opencode7-saved-time', 'succeeded'))
    await waitIdle(rig, 2)
    const saved = stateFile(rig)
    expect(saved.roomTurns).toHaveLength(1)
    expect(typeof saved.roomTurns[0]).toBe('number')
  })
})

describe('the orchestrator routes', () => {
  it('refuses a message without a confirmation, a bad text and a stop without a confirmation', async () => {
    const rig = makeRig()
    rig.orchestrator.close()
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

    expect((await pagePostJson(`${url}/api/orchestrator/messages`, { text: 'Build it' })).body).toEqual({
      error: 'Confirm the message first.',
    })
    expect((await pagePostJson(`${url}/api/orchestrator/messages`, { text: 'Build it', confirmed: false })).status).toBe(400)
    expect((await pagePostJson(`${url}/api/orchestrator/messages`, { text: '   ', confirmed: true })).body).toEqual({
      error: 'Write a message from 1 to 8000 characters.',
    })
    expect((await pagePostJson(`${url}/api/orchestrator/messages`, { text: 'x'.repeat(8001), confirmed: true })).status).toBe(400)
    expect((await pagePostJson(`${url}/api/orchestrator/messages`, { text: 42, confirmed: true })).status).toBe(400)
    expect((await postJson(`${url}/api/orchestrator/stop`, {})).body).toEqual({
      error: 'Confirm the stop first.',
    })
    expect((await postJson(`${url}/api/orchestrator/stop`, { confirmed: true })).body).toEqual({ ok: true })
    expect((await getJson(`${url}/api/orchestrator`)).body.state).toBe('paused')
  })

  it('adds the orchestrator mask count to the health masked total', async () => {
    const rig = makeRig()
    rig.orchestrator.close()
    const bridge = createBridge({
      paperclipUrl: DEAD_PAPERCLIP,
      companyId: 'comp-orchestrator-mask',
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
    const secret = 'sk-or-v1-' + 'q'.repeat(24)
    const setting = 'OPENROUTER_API_KEY='
    expect((await getJson(`${url}/api/health`)).body.masked.total).toBe(0)
    const sent = await pagePostJson(`${url}/api/orchestrator/messages`, { text: `Use ${setting}${secret}`, confirmed: true })
    expect(sent.status).toBe(202)
    await waitFor(async () => (await getJson(`${url}/api/health`)).body.masked.total === 1, 15000, 'the masked total')
    const chat = await getJson(`${url}/api/orchestrator`)
    expect(JSON.stringify(chat.body)).not.toContain(secret)
    expect(chat.body.messages.some((message) => message.text.includes('[key]'))).toBe(true)
    const file = readdirSync(rig.runs).find((name) => /^orchestrator-[0-9a-f]{8}\.json$/.test(name))
    expect(readFileSync(join(rig.runs, file), 'utf8')).not.toContain(secret)
  })

  it('answers 409 with no project folder and is absent when the lane source is off', async () => {
    const rig = makeRig({ project: false })
    rig.orchestrator.close()
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
    expect((await pagePostJson(`${url}/api/orchestrator/messages`, { text: 'Build it', confirmed: true })).status).toBe(409)
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

  it('shows an OpenCode turn with the OpenCode parser', async () => {
    const rig = makeRig({ harness: 'opencode', lanes: OPENCODE_LANES })
    expect(laneAgents(OPENCODE_LANES)[0]).toMatchObject({ key: 'orchestrator', parser: 'opencode' })
    const frames = []
    const source = createLanesSource({
      folder: rig.runs,
      projectRoot: rig.projectRoot,
      repoRoot: rig.projectRoot,
      lanes: OPENCODE_LANES,
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
      'the lane source to end the OpenCode turn'
    )
    expect(
      frames.some((item) => item.type === 'heartbeat.run.log' && String(item.payload.chunk).includes('"type":"tool_use"'))
    ).toBe(true)
  })
})
