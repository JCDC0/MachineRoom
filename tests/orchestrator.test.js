import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { createLanesSource, laneAgents } from '../server/lanes-source.js'
import {
  chatFileFor,
  chatLockFileFor,
  createOrchestrator,
  contextTokensFromLog,
  compactPrompt,
  BRANCH_INDEX_PROBLEM,
  BRANCH_TRANSCRIPT_INTRO,
  BRANCH_TRANSCRIPT_LIMIT,
  COMPACTED_MESSAGE,
  COMPACT_FAILED_MESSAGE,
  CHAT_SAVE_PROBLEM,
  COMPACT_PROMPT,
  CONFIRM_SESSION_PROBLEM,
  DEFAULT_COMPACT_RULES,
  AUTOCOMPACT_MODE_PROBLEM,
  AUTOCOMPACT_PERCENT_PROBLEM,
  AUTOCOMPACT_TOKENS_PROBLEM,
  LOG_TAIL_BYTES,
  quotedTranscript,
  readTail,
  AUTOCOMPACT_RULES_PROBLEM,
  NO_NEW_REPORT,
  NO_REPORT,
  RESTART_MESSAGE,
  ORCHESTRATOR_ROOM_WINDOW_MS,
  SESSION_PENDING_PROBLEM,
  SESSION_ARCHIVED_PROBLEM,
  SESSION_UNREAD_PROBLEM,
  SESSIONS_FULL_PROBLEM,
  AUTOCOMPACT_PROBLEM,
  APPROVAL_PROMPT_TOOL,
  COMPACT_KEEP_PROBLEM,
  COMPACT_RUNNING_PROBLEM,
  CONFIRM_AUTOCOMPACT_PROBLEM,
  CONFIRM_EFFORT_PROBLEM,
  CONFIRM_MESSAGE_PROBLEM,
  CONFIRM_STOP_PROBLEM,
  CURRENT_SESSION_KEY,
  CURRENT_SESSION_PROBLEM,
  EFFORT_PROBLEM,
  EMPTY_REPLY,
  MESSAGE_PROBLEM,
  MODEL_PROBLEM,
  NO_SESSION_PROBLEM,
} from '../server/orchestrator.js'
import { briefProblems } from '../src/briefs/run.js'
import { gitPath } from '../server/programPath.js'
import { getJson } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'
import { isHarnessAvailable } from '../server/agents-config.js'
const assumeInstalled = (key, options) => key === 'claude' || key === 'opencode' || isHarnessAvailable(key, options)

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
const AGY_LANE = {
  name: 'Orchestrator',
  harness: 'AGY',
  cli: { harness: 'agy', bin: 'agy', model: 'gemini-3.8-flash-high' },
}
const MACHINEROOM_LANE = {
  name: 'Orchestrator',
  harness: 'MachineRoom',
  cli: { harness: 'machineroom', bin: 'node', model: 'work/alpha' },
}
const LANES = { orchestrator: ORCHESTRATOR_LANE }
const OPENCODE_LANES = { orchestrator: OPENCODE_LANE }
const AGY_LANES = { orchestrator: AGY_LANE }
const MACHINEROOM_LANES = { orchestrator: MACHINEROOM_LANE }
const CODEX_LANES = {
  orchestrator: {
    name: 'Orchestrator',
    harness: 'Codex',
    cli: { harness: 'codex', bin: 'codex', model: 'gpt-6.1-sol' },
  },
}
const PROMPT = 'project={{PROJECT}}\nmachineroom={{MACHINEROOM}}\nruns={{RUNS}}\nbridge={{BRIDGE}}'

const FAKE_CLAUDE = [
  "import { appendFileSync, existsSync } from 'node:fs'",
  'const args = process.argv.slice(2)',
  "const at = args.indexOf('-p')",
  "const prompt = at === -1 ? '' : String(args[at + 1] ?? '')",
  "const calls = String(process.env.MR_CALLS ?? '')",
  "if (calls) appendFileSync(calls, JSON.stringify({ pid: process.pid, args, cwd: process.cwd() }) + '\\n')",
  "console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }))",
  "const extraAssistant = String(process.env.MR_ASSISTANT_LINES ?? '')",
  "if (extraAssistant) {",
  "  for (const line of JSON.parse(extraAssistant)) console.log(JSON.stringify(line))",
  "}",
  "console.log(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Working.' }] } }))",
  "const mode = String(process.env.MR_MODE ?? 'reply')",
  "if (mode === 'quota') {",
  "  console.log(JSON.stringify({ type: 'error', error: { type: 'provider.quota', message: 'Free usage limit reached. Please upgrade your plan or try again later.' } }))",
  "  process.exit(1)",
  "}",
  "if (mode === 'hold') {",
  "  while (!existsSync(String(process.env.MR_RELEASE ?? ''))) {",
  '    await new Promise((done) => setTimeout(done, 20))',
  '  }',
  '}',
  "const keyReply = 'I read OPENROUTER_API_KEY=' + 'sk-or-v1-' + 'q'.repeat(24) + ' in the file.'",
  "const reply = mode === 'empty' ? '' : mode === 'no_report' ? 'NO_REPORT' : mode === 'fail' ? 'You have hit your session limit.' : mode === 'key' ? keyReply : 'Reply: ' + prompt.split('\\n').join(' / ').slice(0, 200)",
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
  "const sessionId = at === -1 ? (String(process.env.MR_SESSION_ID || '') || 'ses_fake_first') : String(args[at + 1] ?? '')",
  "const prompt = String(args.at(-1) ?? '')",
  "console.log(JSON.stringify({ type: 'step_start', timestamp: 1, sessionID: sessionId, part: { type: 'step-start' } }))",
  "console.log(JSON.stringify({ type: 'tool_use', timestamp: 2, sessionID: sessionId, part: { id: 'prt_1', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'src/math.js' } } } }))",
  "const mode = String(process.env.MR_MODE ?? 'reply')",
  "if (mode === 'quota') {",
  "  console.log(JSON.stringify({ type: 'error', error: { type: 'provider.quota', message: 'Free usage limit reached. Please upgrade your plan or try again later.' } }))",
  "  process.exit(1)",
  "}",
  "if (mode === 'hold') {",
  "  while (!existsSync(String(process.env.MR_RELEASE ?? ''))) {",
  '    await new Promise((done) => setTimeout(done, 20))',
  '  }',
  '}',
  "console.log(JSON.stringify({ type: 'text', timestamp: 3, sessionID: sessionId, part: { type: 'text', text: 'Working.' } }))",
  "const reply = mode === 'fail' ? '' : mode === 'no_report' ? 'NO_REPORT' : 'Reply: ' + prompt.split('\\n').join(' / ').slice(0, 200)",
  "console.log(JSON.stringify({ type: 'text', timestamp: 4, sessionID: sessionId, part: { type: 'text', text: reply } }))",
  "const input = Number(process.env.MR_INPUT ?? 12)",
  "const cacheRead = Number(process.env.MR_CACHE_READ ?? 0)",
  "const cacheWrite = Number(process.env.MR_CACHE_WRITE ?? 0)",
  "console.log(JSON.stringify({ type: 'step_finish', timestamp: 5, sessionID: sessionId, part: { type: 'step-finish', cost: 0.25, tokens: { input, output: 3, cache: { read: cacheRead, write: cacheWrite } } } }))",
  "if (mode === 'fail') process.exitCode = 3",
].join('\n')

const SLOW_GIT = [
  "const { existsSync, writeFileSync } = require('node:fs')",
  "const { join } = require('node:path')",
  "const folder = join(process.cwd(), '.git')",
  "writeFileSync(join(folder, 'check-started'), '1')",
  'const stopAt = Date.now() + 60000',
  'const wait = () => {',
  "  if (existsSync(join(folder, 'check-release')) || Date.now() > stopAt) {",
  "    console.log(join(folder, 'MERGE_HEAD'))",
  '    return',
  '  }',
  '  setTimeout(wait, 10)',
  '}',
  'wait()',
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

const FAKE_AGENT_SCRIPT = [
  "import { appendFileSync } from 'node:fs'",
  'const args = process.argv.slice(2)',
  "const calls = String(process.env.MR_CALLS ?? '')",
  "if (calls) appendFileSync(calls, JSON.stringify({ pid: process.pid, args, cwd: process.cwd() }) + '\\n')",
  "const at = args.indexOf('--prompt')",
  "const prompt = at === -1 ? '' : String(args[at + 1] ?? '')",
  "const stderrLine = String(process.env.MR_STDERR ?? '')",
  "if (stderrLine) process.stderr.write(stderrLine + '\\n')",
  "if (String(process.env.MR_MODE ?? 'reply') !== 'quiet') console.log('Fake reply for: ' + prompt.slice(-40).split('\\n').join(' '))",
  "const exitCode = Number(process.env.MR_EXIT ?? 0)",
  'if (exitCode !== 0) process.exitCode = exitCode',
].join('\n')

function makeRig({ prompt = PROMPT, mode = 'reply', lanes = LANES, harness = 'claude', model = '', bin = '', contextWindow = 0, harnesses = undefined, project = true, id = undefined, mergeWaitMs = undefined, gitSpawn = undefined, gitTimeoutMs = undefined, env = undefined, platform = undefined, extraInstructions = undefined } = {}) {
  const base = makeTempDir('mr-orchestrator-')
  const runs = join(base, 'runs')
  const projectRoot = project ? join(base, 'project') : ''
  mkdirSync(runs, { recursive: true })
  if (projectRoot) mkdirSync(projectRoot, { recursive: true })
  const script = join(
    base,
    harness === 'opencode' ? 'fake-opencode.mjs' : harness === 'fake' ? 'fake-agent.mjs' : 'fake-claude.mjs'
  )
  writeFileSync(script, harness === 'opencode' ? FAKE_OPENCODE : harness === 'fake' ? FAKE_AGENT_SCRIPT : FAKE_CLAUDE)
  const promptFile = join(base, 'orchestrator-agent.md')
  if (prompt !== null) writeFileSync(promptFile, prompt)
  const callsFile = join(base, 'calls.jsonl')
  const releaseFile = join(base, 'release')
  const behaviour = { mode, stderr: '', exit: 0 }
  const spawned = []
  const spawnFake = (file, args, options) => {
    const mcpArg = args.indexOf('--mcp-config')
    const mcpPath = mcpArg !== -1 ? args[mcpArg + 1] : (options.env?.OPENCODE_CONFIG || '')
    const mcpExistedDuringTurn = mcpPath ? existsSync(mcpPath) : false
    const mcpContentDuringTurn = mcpExistedDuringTurn ? readFileSync(mcpPath, 'utf8') : null
    spawned.push({ file, args: [...args], shell: options.shell, cwd: options.cwd, env: options.env, mcpPath, mcpExistedDuringTurn, mcpContentDuringTurn })
    const env = {
      ...(options.env ?? process.env),
      MR_CALLS: callsFile,
      MR_MODE: behaviour.mode,
      MR_RELEASE: releaseFile,
      MR_INPUT: String(behaviour.input ?? 12),
      MR_CACHE_READ: String(behaviour.cacheRead ?? 0),
      MR_CACHE_WRITE: String(behaviour.cacheWrite ?? 0),
      MR_STDERR: String(behaviour.stderr ?? ''),
      MR_EXIT: String(behaviour.exit ?? 0),
      MR_SESSION_ID: String(behaviour.sessionId ?? ''),
      MR_ASSISTANT_LINES: behaviour.assistantLines ? JSON.stringify(behaviour.assistantLines) : '',
    }
    return spawn(process.execPath, [script, ...args], { ...options, env })
  }
  const notices = []
  const masked = { total: 0 }
  const orchestrator = createOrchestrator({
    ...(id ? { id } : {}),
    projectRoot,
    runsFolder: runs,
    lanes,
    harness,
    model,
    bin,
    contextWindow,
    spawn: spawnFake,
    promptFile,
    env,
    platform,
    bridgeUrl: () => 'http://127.0.0.1:5999',
    onNotice: (event) => notices.push(event),
    onMasked: (count) => {
      masked.total += count
    },
    ...(harnesses ? { harnesses } : {}),
    ...(mergeWaitMs ? { mergeWaitMs } : {}),
    ...(extraInstructions ? { extraInstructions } : {}),
    ...(gitSpawn ? { gitSpawn } : {}),
    ...(gitTimeoutMs ? { gitTimeoutMs } : {}),
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

async function waitIdle(rig, count, timeoutMs = 15000) {
  try {
    await waitFor(() => rig.answer().state === 'idle' && rig.calls().length === count, timeoutMs, `turn ${count} to end`)
  } catch (error) {
    error.message += ` State ${rig.answer().state}, ${rig.calls().length} calls.`
    throw error
  }
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

function seedChat(rig, { sessions, messages = [] }) {
  const file = chatFileFor(rig.projectRoot, rig.runs)
  rig.orchestrator.close()
  const state = JSON.parse(readFileSync(file, 'utf8'))
  state.sessions = sessions
  state.messages = messages
  state.currentSessionId = null
  state.currentTitle = null
  state.summary = ''
  state.pending = []
  state.state = 'idle'
  writeFileSync(file, JSON.stringify(state, null, 2))
  return file
}

function pinnedSession(index, baseTime) {
  const startedAt = new Date(baseTime + index * 60000).toISOString()
  return {
    id: `pinned-${index}`,
    title: `Pinned ${index}`,
    startedAt,
    endedAt: new Date(baseTime + index * 60000 + 30000).toISOString(),
    pinned: true,
    starred: false,
    sessionId: `ses_${index}`,
    opencodeSessionId: null,
    summary: '',
    messages: [{ id: `pinned-message-${index}`, from: 'owner', text: `Pinned ${index}`, at: startedAt }],
  }
}

function emitterChild() {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => {}
  return child
}

function branchSetup(tag) {
  const base = makeTempDir(tag)
  const runs = join(base, 'runs')
  const projectRoot = join(base, 'project')
  mkdirSync(runs, { recursive: true })
  mkdirSync(projectRoot, { recursive: true })
  const promptFile = join(base, 'orchestrator-agent.md')
  writeFileSync(promptFile, PROMPT)
  const transcript = `${BRANCH_TRANSCRIPT_INTRO}\n\n> Owner: First task\n> Orchestrator: Reply: First task`
  const conversation = chatFileFor(projectRoot, runs)
  const at = new Date().toISOString()
  writeFileSync(
    conversation,
    `${JSON.stringify({
      project: projectRoot,
      harness: 'claude',
      model: 'opus',
      sessionId: null,
      state: 'idle',
      messages: [
        { id: 'branch-owner', from: 'owner', text: 'First task', at },
        { id: 'branch-reply', from: 'orchestrator', text: 'Reply: First task', at },
      ],
      pending: [],
      branchTranscript: transcript,
    }, null, 2)}\n`
  )
  return {
    runs,
    projectRoot,
    promptFile,
    conversation,
    transcript,
    make(spawn) {
      const orchestrator = createOrchestrator({
        projectRoot,
        runsFolder: runs,
        lanes: LANES,
        promptFile,
        spawn,
      })
      cleanups.push(async () => {
        orchestrator.close()
        await sleep(20)
        rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      })
      return orchestrator
    },
  }
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

function gitInit(dir) {
  const result = spawnSync(gitPath(), ['init', '-q'], {
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.error || result.status !== 0) throw new Error(`git init failed: ${String(result.stderr ?? '').trim()}`)
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
    expect(valueAfter(calls[0].args, '--permission-mode')).toBe('auto')
    expect(calls[0].args).not.toContain('--dangerously-skip-permissions')
    expect(calls[0].args).not.toContain('--resume')
    const sessionId = valueAfter(calls[0].args, '--session-id')
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(typeof rig.orchestrator.token).toBe('string')
    expect(rig.orchestrator.token).toHaveLength(32)
    expect(rig.answer().token).toBeUndefined()
    expect(valueAfter(calls[0].args, '--append-system-prompt')).toBe(
      `project=${rig.projectRoot}\nmachineroom=${REPO_ROOT}\nruns=${rig.runs}\nbridge=http://127.0.0.1:5999\nSend the header X-MachineRoom-Orchestrator: ${rig.orchestrator.token} on every bridge request.\n\nSpawn subagents at most 2 levels deep. A subagent at depth 2 spawns none.`
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

  it('leaves two messages and one folded line of five steps for a turn of five tool calls', async () => {
    const rig = makeRig()
    rig.behaviour.assistantLines = [
      'Read src/a.js',
      'Read src/b.js',
      'Edit src/c.js',
      'Bash npm test',
      'Read src/d.js',
    ].map((entry, index) => {
      const [name, ...target] = entry.split(' ')
      const input = name === 'Bash' ? { command: target.join(' ') } : { file_path: target.join(' ') }
      return {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: `call-${index}`, name, input }],
        },
      }
    })
    rig.send('Do the work.')
    await waitIdle(rig, 1)

    const answer = rig.answer()
    expect(answer.messages).toHaveLength(2)
    const [owner, reply] = answer.messages
    expect(owner).toMatchObject({ from: 'owner', text: 'Do the work.' })
    expect(owner.work.steps).toHaveLength(5)
    expect(owner.work.steps[0]).toEqual({ tool: 'read', target: 'src/a.js' })
    expect(owner.work.steps[3]).toEqual({ tool: 'shell', target: 'npm test' })
    expect(Number.isFinite(owner.work.seconds)).toBe(true)
    expect(reply.from).toBe('orchestrator')
    expect(reply.work).toBeUndefined()
    expect(stateFile(rig).messages[0].work.steps).toHaveLength(5)
  })

  it('shows the turn as working with the newest step before it ends', async () => {
    const rig = makeRig()
    rig.behaviour.mode = 'hold'
    rig.behaviour.assistantLines = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'one', name: 'Read', input: { file_path: 'src/one.js' } },
            { type: 'tool_use', id: 'two', name: 'Edit', input: { file_path: 'src/two.js' } },
          ],
        },
      },
    ]
    rig.send('Go.')
    await waitFor(
      () => rig.answer().messages[0]?.work?.steps?.length === 2,
      15000,
      'the working line to reach its second step'
    )
    const work = rig.answer().messages[0].work
    expect(work.state).toBe('working')
    expect(work.steps.at(-1)).toEqual({ tool: 'edit', target: 'src/two.js' })
    writeFileSync(rig.releaseFile, 'go')
    await waitIdle(rig, 1)
    expect(rig.answer().messages[0].work.state).toBeUndefined()
    expect(rig.answer().messages[0].work.steps).toHaveLength(2)
  })

  it('starts a Codex orchestrator from the app program when codex is not on PATH', async () => {
    const localAppData = makeTempDir('mr-orchestrator-codex-')
    cleanups.push(() => rmSync(localAppData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
    const program = join(localAppData, 'OpenAI', 'Codex', 'bin', '0123456789abcdef', 'codex.exe')
    mkdirSync(dirname(program), { recursive: true })
    writeFileSync(program, '')
    const env = { ...process.env, LOCALAPPDATA: localAppData, PATH: '', Path: '' }
    const rig = makeRig({ harness: 'codex', lanes: CODEX_LANES, env, platform: 'win32' })

    rig.send('Build the room.')
    await waitIdle(rig, 1)

    expect(rig.spawned[0].file).toBe(program)
    expect(rig.spawned[0].args.slice(0, 2)).toEqual(['exec', '--json'])
  })

  it('starts a Codex sub orchestrator from the app program when its bin is codex', async () => {
    const localAppData = makeTempDir('mr-sub-orchestrator-codex-')
    cleanups.push(() => rmSync(localAppData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
    const program = join(localAppData, 'OpenAI', 'Codex', 'bin', '0123456789abcdef', 'codex.exe')
    mkdirSync(dirname(program), { recursive: true })
    writeFileSync(program, '')
    const env = { ...process.env, LOCALAPPDATA: localAppData, PATH: '', Path: '' }
    const rig = makeRig({ id: 'codexsub', harness: 'codex', lanes: CODEX_LANES, bin: 'codex', env, platform: 'win32' })

    rig.send('Build the room.')
    await waitIdle(rig, 1)

    expect(rig.spawned[0].file).toBe(program)
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
    expect(first.slice(0, 6)).toEqual(['run', '--standalone', '--format', 'json', '--model', 'opencode-go/deepseek-v4.1-flash'])
    expect(first).toContain('--standalone')
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
    expect(rig.answer().messages.at(-1).text).toBe(EMPTY_REPLY)

    rig.behaviour.mode = 'fail'
    rig.send('Fail now')
    await waitIdle(rig, 2)
    expect(rig.answer().messages.at(-1).text).toBe('The orchestrator stopped: You have hit your session limit.')
  })

  it('shows "No new report." and starts nothing when the reply is NO_REPORT', async () => {
    const rig = makeRig()
    rig.behaviour.mode = 'no_report'
    rig.send('Any work left')
    await waitIdle(rig, 1)
    expect(rig.answer().messages.at(-1).text).toBe(NO_NEW_REPORT)
    expect(rig.calls()).toHaveLength(1)
    expect(rig.answer().state).toBe('idle')
  })

  it('shows the quota error message for a failed OpenCode turn', async () => {
    const rig = makeRig({ harness: 'opencode' })
    rig.behaviour.mode = 'quota'
    rig.send('Do work')
    await waitIdle(rig, 1)
    expect(rig.answer().messages.at(-1).text).toBe(
      'The orchestrator stopped: Free usage limit reached. Please upgrade your plan or try again later.'
    )
  })

  it('uses the fallback when the prompt file is missing', async () => {
    const rig = makeRig({ prompt: null })
    rig.send('Hello')
    await waitIdle(rig, 1)
    const instruction = valueAfter(rig.calls()[0].args, '--append-system-prompt')
    expect(instruction).toContain(rig.projectRoot)
    expect(instruction).toContain('Never push')
    expect(instruction).toContain(`Send the header X-MachineRoom-Orchestrator: ${rig.orchestrator.token}`)
    expect(instruction).toContain('Spawn subagents at most 2 levels deep. A subagent at depth 2 spawns none.')
    expect(instruction.split(/\.\s+/)).toHaveLength(6)
  })

  it('fills the bridge address in the instruction lines a sub adds', async () => {
    const rig = makeRig({ extraInstructions: () => 'To message any orchestrator, POST {{BRIDGE}}/api/orchestrator/messages.' })
    rig.send('Hello')
    await waitIdle(rig, 1)
    const instruction = valueAfter(rig.calls()[0].args, '--append-system-prompt')
    expect(instruction).toContain('POST http://127.0.0.1:5999/api/orchestrator/messages.')
    expect(instruction).not.toContain('{{BRIDGE}}')
  })

  it('fills the scratch folder in the guide and makes it before the turn', async () => {
    const guide = readFileSync(new URL('../docs/agents/ORCHESTRATOR-AGENT.md', import.meta.url), 'utf8')
    const rig = makeRig({ prompt: guide })
    const scratch = join(rig.runs, 'scratch-orchestrator')
    expect(existsSync(scratch)).toBe(false)

    rig.send('Plan the work.')
    await waitFor(() => existsSync(scratch), 15000, 'the scratch folder')
    await waitIdle(rig, 1)

    const instruction = valueAfter(rig.calls()[0].args, '--append-system-prompt')
    expect(instruction).toContain(scratch)
    expect(instruction).toContain(`${rig.runs}/runs.jsonl`)
    expect(instruction).not.toContain('{{RUNS}}/start-')
    expect(instruction).not.toContain('{{SCRATCH}}')
    expect(instruction).toContain('Read the lanes from http://127.0.0.1:5999/api/lanes; start only the active ones.')
    expect(instruction).not.toContain('opencode10')
    expect(existsSync(scratch)).toBe(true)
  })

  it('tells the orchestrator to leave a merge it did not start alone', () => {
    const guide = readFileSync(new URL('../docs/agents/ORCHESTRATOR-AGENT.md', import.meta.url), 'utf8')
    expect(guide).toContain(
      'Never abort, reset or finish a merge, rebase or cherry-pick you did not start; if one is in progress, say so and wait.'
    )
  })

  it('passes enabled MCP servers to Claude turns and removes the config file when the turn ends', async () => {
    const rig = makeRig()
    writeFileSync(join(rig.runs, 'mcp.json'), JSON.stringify({
      servers: [
        { name: 'browser', transport: 'http', url: 'https://example.com/mcp', enabled: true },
        { name: 'db', transport: 'stdio', command: 'node', args: ['db.js'], env: { SECRET_KEY: 'topsecret' }, enabled: true },
        { name: 'disabled_srv', transport: 'stdio', command: 'node', enabled: false },
      ],
    }))

    rig.send('Use MCP')
    await waitIdle(rig, 1)

    const call = rig.calls()[0]
    expect(call.args).toContain('--mcp-config')
    expect(call.args).not.toContain('--strict-mcp-config')
    const configPath = valueAfter(call.args, '--mcp-config')
    expect(configPath).toMatch(/\.mcp\.json$/)
    expect(rig.spawned[0].mcpExistedDuringTurn).toBe(true)
    expect(JSON.parse(rig.spawned[0].mcpContentDuringTurn)).toEqual({
      mcpServers: {
        browser: { type: 'http', url: 'https://example.com/mcp' },
        db: { command: 'node', args: ['db.js'], env: { SECRET_KEY: 'topsecret' } },
      },
    })
    expect(existsSync(configPath)).toBe(false)
  })

  it('passes enabled MCP servers to OpenCode turns in env and removes the config file when the turn ends', async () => {
    const rig = makeRig({ harness: 'opencode', lanes: OPENCODE_LANES })
    writeFileSync(join(rig.runs, 'mcp.json'), JSON.stringify({
      servers: [
        { name: 'browser', transport: 'http', url: 'https://example.com/mcp', enabled: true },
        { name: 'db', transport: 'stdio', command: 'node', args: ['db.js'], env: { SECRET_KEY: 'topsecret' }, enabled: true },
      ],
    }))

    rig.send('Use OpenCode MCP')
    await waitIdle(rig, 1)

    const spawnedEnv = rig.spawned[0].env
    expect(spawnedEnv).toBeDefined()
    expect(spawnedEnv.OPENCODE_CONFIG).toBeDefined()
    const configPath = spawnedEnv.OPENCODE_CONFIG
    expect(configPath).toMatch(/\.mcp\.json$/)
    expect(rig.spawned[0].mcpExistedDuringTurn).toBe(true)
    expect(JSON.parse(rig.spawned[0].mcpContentDuringTurn)).toEqual({
      mcp: {
        browser: { type: 'remote', url: 'https://example.com/mcp', enabled: true },
        db: { type: 'local', command: ['node', 'db.js'], environment: { SECRET_KEY: 'topsecret' }, enabled: true },
      },
    })
    expect(existsSync(configPath)).toBe(false)
  })

  it('writes no MCP config when no servers are enabled', async () => {
    const rig = makeRig()
    writeFileSync(join(rig.runs, 'mcp.json'), JSON.stringify({
      servers: [
        { name: 'disabled_srv', transport: 'stdio', command: 'node', enabled: false },
      ],
    }))

    rig.send('No MCP')
    await waitIdle(rig, 1)

    const call = rig.calls()[0]
    expect(call.args).not.toContain('--mcp-config')
    const spawnedEnv = rig.spawned[0].env
    expect(spawnedEnv?.OPENCODE_CONFIG).toBeUndefined()
    expect(rig.spawned[0].mcpExistedDuringTurn).toBe(false)
  })
})

describe('the orchestrator permission modes', () => {
  it('passes the Claude permission mode on every turn', async () => {
    const rig = makeRig()
    expect(rig.answer().mode).toBe('auto')
    let turns = 0

    rig.send('Auto turn')
    turns += 1
    await waitIdle(rig, turns)
    expect(valueAfter(rig.calls()[turns - 1].args, '--permission-mode')).toBe('auto')
    expect(rig.calls()[turns - 1].args).not.toContain('--dangerously-skip-permissions')

    for (const [mode, flag] of [['plan', 'plan'], ['edits', 'acceptEdits']]) {
      expect(rig.orchestrator.setMode({ mode, confirmed: true }).status).toBe(200)
      rig.send(`${mode} turn`)
      turns += 1
      await waitIdle(rig, turns)
      expect(valueAfter(rig.calls()[turns - 1].args, '--permission-mode')).toBe(flag)
      expect(rig.calls()[turns - 1].args).not.toContain('--dangerously-skip-permissions')
    }

    expect(rig.orchestrator.setMode({ mode: 'bypass', confirmed: true }).status).toBe(200)
    rig.send('Bypass turn')
    turns += 1
    await waitIdle(rig, turns)
    expect(rig.calls()[turns - 1].args).toContain('--dangerously-skip-permissions')
    expect(rig.calls()[turns - 1].args).not.toContain('--permission-mode')
  })

  it('passes the OpenCode plan agent and the edits bash guard with the MCP config', async () => {
    const rig = makeRig({ harness: 'opencode', lanes: OPENCODE_LANES })
    writeFileSync(join(rig.runs, 'mcp.json'), JSON.stringify({
      servers: [{ name: 'browser', transport: 'http', url: 'https://example.com/mcp', enabled: true }],
    }))
    const mcp = { browser: { type: 'remote', url: 'https://example.com/mcp', enabled: true } }
    let turns = 0

    rig.send('Auto turn')
    turns += 1
    await waitIdle(rig, turns)
    expect(rig.calls()[turns - 1].args).not.toContain('--agent')
    expect(JSON.parse(rig.spawned[turns - 1].mcpContentDuringTurn)).toEqual({ mcp })

    expect(rig.orchestrator.setMode({ mode: 'plan', confirmed: true }).status).toBe(200)
    rig.send('Plan turn')
    turns += 1
    await waitIdle(rig, turns)
    expect(valueAfter(rig.calls()[turns - 1].args, '--agent')).toBe('plan')
    expect(JSON.parse(rig.spawned[turns - 1].mcpContentDuringTurn)).toEqual({
      mcp,
      permission: { edit: 'deny', bash: 'deny' },
    })

    expect(rig.orchestrator.setMode({ mode: 'edits', confirmed: true }).status).toBe(200)
    rig.send('Edits turn')
    turns += 1
    await waitIdle(rig, turns)
    expect(rig.calls()[turns - 1].args).toContain('--auto')
    expect(rig.calls()[turns - 1].args).not.toContain('--agent')
    expect(JSON.parse(rig.spawned[turns - 1].mcpContentDuringTurn)).toEqual({
      mcp,
      permission: { bash: 'deny' },
    })

    expect(rig.orchestrator.setMode({ mode: 'auto', confirmed: true }).status).toBe(200)
    rig.send('Auto again')
    turns += 1
    await waitIdle(rig, turns)
    expect(JSON.parse(rig.spawned[turns - 1].mcpContentDuringTurn)).toEqual({ mcp })
  })

  it('passes the AGY mode on each turn', async () => {
    const rig = makeRig({ harness: 'agy', lanes: AGY_LANES })
    expect(rig.answer().mode).toBe('auto')
    let turns = 0

    for (const [mode, flag] of [['auto', 'auto'], ['plan', 'plan'], ['edits', 'accept-edits']]) {
      expect(rig.orchestrator.setMode({ mode, confirmed: true }).status).toBe(200)
      rig.send(`${mode} turn`)
      turns += 1
      await waitIdle(rig, turns)
      expect(valueAfter(rig.calls()[turns - 1].args, '--mode')).toBe(flag)
      expect(rig.calls()[turns - 1].args).not.toContain('--dangerously-skip-permissions')
    }

    expect(rig.orchestrator.setMode({ mode: 'bypass', confirmed: true }).status).toBe(200)
    rig.send('Bypass turn')
    turns += 1
    await waitIdle(rig, turns)
    expect(rig.calls()[turns - 1].args).toContain('--dangerously-skip-permissions')
    expect(rig.calls()[turns - 1].args).not.toContain('--mode')
  })

  it('sets the MachineRoom permission mode in the spawn env', async () => {
    const rig = makeRig({ harness: 'machineroom', lanes: MACHINEROOM_LANES })
    let turns = 0

    rig.send('Auto turn')
    turns += 1
    await waitIdle(rig, turns)
    expect(rig.spawned[turns - 1].env.MACHINEROOM_PERMISSION_MODE).toBe('auto')

    expect(rig.orchestrator.setMode({ mode: 'plan', confirmed: true }).status).toBe(200)
    rig.send('Plan turn')
    turns += 1
    await waitIdle(rig, turns)
    expect(rig.spawned[turns - 1].env.MACHINEROOM_PERMISSION_MODE).toBe('plan')
  })

  it('runs Claude in ask with the permission prompt tool and the approve server', async () => {
    const rig = makeRig()
    writeFileSync(join(rig.runs, 'mcp.json'), JSON.stringify({
      servers: [{ name: 'browser', transport: 'http', url: 'https://example.com/mcp', enabled: true }],
    }))
    expect(rig.orchestrator.setMode({ mode: 'ask', confirmed: true }).status).toBe(200)

    rig.send('Ask turn')
    await waitIdle(rig, 1)

    const args = rig.calls()[0].args
    expect(valueAfter(args, '--permission-mode')).toBe('manual')
    expect(valueAfter(args, '--permission-prompt-tool')).toBe(APPROVAL_PROMPT_TOOL)
    expect(args).not.toContain('--dangerously-skip-permissions')

    const config = JSON.parse(rig.spawned[0].mcpContentDuringTurn)
    expect(Object.keys(config.mcpServers).sort()).toEqual(['browser', 'machineroom-approve'])
    const server = config.mcpServers['machineroom-approve']
    expect(server.command).toBe(process.execPath)
    expect(server.args[0]).toMatch(/scripts[\\/]mr-approve\.mjs$/)
    expect(server.env.MACHINEROOM_BRIDGE).toBe('http://127.0.0.1:5999')
    expect(server.env.MACHINEROOM_ORCHESTRATOR_ID).toBe('orchestrator')
    expect(typeof server.env.MACHINEROOM_ORCHESTRATOR_TOKEN).toBe('string')
    expect(server.env.MACHINEROOM_ORCHESTRATOR_TOKEN.length).toBeGreaterThan(20)
  })

  it('passes the approval bridge env to the MachineRoom harness in ask mode', async () => {
    const rig = makeRig({ harness: 'machineroom', lanes: MACHINEROOM_LANES })
    expect(rig.orchestrator.setMode({ mode: 'ask', confirmed: true }).status).toBe(200)

    rig.send('Ask turn')
    await waitIdle(rig, 1)

    const env = rig.spawned[0].env
    expect(env.MACHINEROOM_PERMISSION_MODE).toBe('ask')
    expect(env.MACHINEROOM_BRIDGE).toBe('http://127.0.0.1:5999')
    expect(env.MACHINEROOM_ORCHESTRATOR_ID).toBe('orchestrator')
    expect(env.MACHINEROOM_ORCHESTRATOR_TOKEN.length).toBeGreaterThan(20)
  })
})

describe('the context use', () => {
  it('reads the last top-level assistant call rather than the result sum', () => {
    const log = [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [], usage: { input_tokens: 5000, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500 } } }),
      JSON.stringify({ type: 'assistant', parent_tool_use_id: 'tool-sub', message: { role: 'assistant', content: [], usage: { input_tokens: 999999 } } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [], usage: { input_tokens: 60000, cache_read_input_tokens: 7000, cache_creation_input_tokens: 491 } } }),
      JSON.stringify({ type: 'result', usage: { input_tokens: 700000, cache_read_input_tokens: 25000, cache_creation_input_tokens: 456 } }),
    ].join('\n')
    expect(contextTokensFromLog('claude', log)).toBe(67491)
  })

  it('falls back to the last entry of result usage iterations when assistant has no usage', () => {
    const log = [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] } }),
      JSON.stringify({
        type: 'result',
        usage: {
          input_tokens: 500,
          iterations: [
            { input_tokens: 100, cache_creation_input_tokens: 10, cache_read_input_tokens: 10 },
            { input_tokens: 200, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 },
          ],
        },
      }),
    ].join('\n')
    expect(contextTokensFromLog('claude', log)).toBe(250)
  })

  it('keeps the iterations count when a later result line has no iterations and skips trailing empty iterations', () => {
    const log = [
      JSON.stringify({
        type: 'result',
        usage: {
          input_tokens: 500,
          iterations: [
            { input_tokens: 100, cache_creation_input_tokens: 10, cache_read_input_tokens: 10 },
            { input_tokens: 200, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 },
            { output_tokens: 50 },
          ],
        },
      }),
      JSON.stringify({
        type: 'result',
        usage: {
          input_tokens: 800,
        },
      }),
    ].join('\n')
    expect(contextTokensFromLog('claude', log)).toBe(250)
  })

  it('ignores subagent assistant lines with parent_tool_use_id', () => {
    const log = [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [], usage: { input_tokens: 120 } } }),
      JSON.stringify({ type: 'assistant', parent_tool_use_id: 'sub-call-1', message: { role: 'assistant', content: [], usage: { input_tokens: 900 } } }),
      JSON.stringify({ type: 'result', parent_tool_use_id: 'sub-call-1', usage: { input_tokens: 900 } }),
      JSON.stringify({ type: 'result', usage: { input_tokens: 1200 } }),
    ].join('\n')
    expect(contextTokensFromLog('claude', log)).toBe(120)
  })

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
    expect(calls[1].args[1]).toBe(compactPrompt())
    expect(rig.answer().messages.some((message) => message.from === 'room' && message.text === COMPACTED_MESSAGE)).toBe(true)
    expect(rig.answer()).toMatchObject({
      contextTokens: null,
      contextWindow: 200000,
      autocompact: true,
      autocompactMode: 'percent',
      autocompactValue: 80,
      compactRules: '',
    })
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
      body: { id: 'orchestrator', autocompact: false, autocompactMode: 'percent', autocompactValue: 80, compactRules: '', autocompactPercent: 80 },
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
      body: { id: 'orchestrator', autocompact: true, autocompactMode: 'percent', autocompactValue: 60, compactRules: '', autocompactPercent: 60 },
    })
    rig.behaviour.input = 130000
    rig.send('Build the room.')
    await waitFor(() => rig.calls().length === 2 && rig.answer().state === 'idle', 15000, 'the compacted session')
    expect(rig.calls()).toHaveLength(2)
    expect(rig.answer().autocompactValue).toBe(60)
  })

  it('autocompacts in tokens mode when contextTokens reaches the token threshold', async () => {
    const rig = makeRig()
    expect(
      rig.orchestrator.setAutocompact({ on: true, mode: 'tokens', value: 30000, confirmed: true })
    ).toEqual({
      status: 200,
      body: { id: 'orchestrator', autocompact: true, autocompactMode: 'tokens', autocompactValue: 30000, compactRules: '', autocompactPercent: 15 },
    })
    expect(rig.answer()).toMatchObject({ autocompactMode: 'tokens', autocompactValue: 30000 })
    rig.behaviour.input = 35000
    rig.send('Build the room in tokens mode.')
    await waitFor(() => rig.calls().length === 2 && rig.answer().state === 'idle', 15000, 'the compacted tokens session')
    expect(rig.calls()).toHaveLength(2)
  })

  it('compacts the main orchestrator on claude at 500,000 and not at 499,999, and its next turn starts a new session from the summary', async () => {
    const rig = makeRig()
    expect(
      rig.orchestrator.setAutocompact({ on: true, mode: 'tokens', value: 500000, confirmed: true })
    ).toEqual({
      status: 200,
      body: { id: 'orchestrator', autocompact: true, autocompactMode: 'tokens', autocompactValue: 500000, compactRules: '', autocompactPercent: 250 },
    })

    rig.behaviour.input = 499999
    rig.send('Claude turn at 499,999 tokens.')
    await waitIdle(rig, 1)

    expect(rig.calls()).toHaveLength(1)
    expect(rig.answer()).toMatchObject({ contextTokens: 499999, autocompact: true })
    expect(rig.answer().messages.some((message) => message.text === COMPACTED_MESSAGE)).toBe(false)
    const firstSessionId = valueAfter(rig.calls()[0].args, '--session-id')
    expect(firstSessionId).toBeTruthy()

    rig.behaviour.input = 500000
    rig.send('Claude turn reaching 500,000 tokens.')
    await waitFor(() => rig.calls().length === 3 && rig.answer().state === 'idle', 15000, 'the compacted Claude session')

    const calls = rig.calls()
    expect(calls).toHaveLength(3)
    expect(calls[1].args).toContain('--resume')
    expect(valueAfter(calls[1].args, '--resume')).toBe(firstSessionId)
    expect(calls[2].args).toContain('--resume')
    expect(valueAfter(calls[2].args, '--resume')).toBe(firstSessionId)
    expect(calls[2].args[1]).toBe(compactPrompt())
    expect(rig.answer().messages.some((message) => message.from === 'room' && message.text === COMPACTED_MESSAGE)).toBe(true)
    const saved = stateFile(rig)
    expect(saved.sessionId).toBeNull()
    expect(saved.summary).toContain('Reply: Write a summary')

    rig.behaviour.input = 12
    rig.send('Turn after Claude compaction.')
    await waitFor(() => rig.calls().length === 4 && rig.answer().state === 'idle', 15000, 'the turn after compaction')

    const nextCalls = rig.calls()
    expect(nextCalls).toHaveLength(4)
    const nextArgs = nextCalls[3].args
    expect(nextArgs).not.toContain('--resume')
    expect(nextArgs).toContain('--session-id')
    const nextSessionId = valueAfter(nextArgs, '--session-id')
    expect(nextSessionId).not.toBe(firstSessionId)
    expect(nextArgs[1].startsWith('Reply: Write a summary')).toBe(true)
    expect(nextArgs[1]).toContain('Turn after Claude compaction.')
  })

  it('starts autocompact from the last call context and keeps the turn total in the run record', async () => {
    const rig = makeRig()
    rig.orchestrator.setAutocompact({ on: true, mode: 'tokens', value: 100000, confirmed: true })

    rig.behaviour.assistantLines = [
      { type: 'assistant', message: { role: 'assistant', content: [], usage: { input_tokens: 20000 } } },
      { type: 'assistant', message: { role: 'assistant', content: [], usage: { input_tokens: 67491 } } },
    ]
    rig.behaviour.input = 725456

    rig.send('First turn with multiple calls summing past 100,000 tokens.')
    await waitFor(() => rig.calls().length === 1 && rig.answer().state === 'idle', 15000, 'the first turn to finish')

    expect(rig.calls()).toHaveLength(1)
    expect(rig.answer()).toMatchObject({
      contextTokens: 67491,
      autocompact: true,
      autocompactMode: 'tokens',
      autocompactValue: 100000,
    })
    expect(rig.answer().messages.some((message) => message.text === COMPACTED_MESSAGE)).toBe(false)

    const runsLines = readFileSync(join(rig.runs, 'runs.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    expect(runsLines.at(-1)?.inputTokens).toBe(725456)

    rig.behaviour.assistantLines = [
      { type: 'assistant', message: { role: 'assistant', content: [], usage: { input_tokens: 120000 } } },
    ]
    rig.behaviour.input = 800000

    rig.send('Second turn whose last call passes the threshold.')
    await waitFor(() => rig.calls().length === 3 && rig.answer().state === 'idle', 15000, 'the compacted turn')

    expect(rig.calls()).toHaveLength(3)
    expect(rig.calls()[1].args).toContain('--resume')
    expect(rig.answer().messages.some((message) => message.text === COMPACTED_MESSAGE)).toBe(true)
  })

  it('compacts the main orchestrator on opencode at 500,000 tokens and not at 499,999, where the session id is OpenCodes sessionID', async () => {
    const rig = makeRig({ harness: 'opencode', lanes: OPENCODE_LANES })
    expect(
      rig.orchestrator.setAutocompact({ on: true, mode: 'tokens', value: 500000, confirmed: true })
    ).toEqual({
      status: 200,
      body: { id: 'orchestrator', autocompact: true, autocompactMode: 'tokens', autocompactValue: 500000, compactRules: '', autocompactPercent: 250 },
    })

    rig.behaviour.input = 499999
    rig.send('OpenCode turn at 499,999 tokens.')
    await waitIdle(rig, 1)

    expect(rig.calls()).toHaveLength(1)
    expect(rig.calls()[0].args).not.toContain('--session')
    expect(rig.answer()).toMatchObject({ contextTokens: 499999, autocompact: true })
    expect(rig.answer().messages.some((message) => message.text === COMPACTED_MESSAGE)).toBe(false)
    const firstSessionId = stateFile(rig).sessionId
    expect(firstSessionId).toBe('ses_fake_first')

    rig.behaviour.input = 500000
    rig.send('OpenCode turn reaching 500,000 tokens.')
    await waitFor(() => rig.calls().length === 3 && rig.answer().state === 'idle', 15000, 'the compacted OpenCode session')

    const calls = rig.calls()
    expect(calls).toHaveLength(3)
    expect(calls[1].args).toContain('--session')
    expect(valueAfter(calls[1].args, '--session')).toBe('ses_fake_first')
    expect(calls[2].args).toContain('--session')
    expect(valueAfter(calls[2].args, '--session')).toBe('ses_fake_first')
    expect(calls[2].args.at(-1)).toBe(compactPrompt())
    expect(rig.answer().messages.some((message) => message.from === 'room' && message.text === COMPACTED_MESSAGE)).toBe(true)
    const saved = stateFile(rig)
    expect(saved.sessionId).toBeNull()
    expect(saved.summary).toContain('Reply: Write a summary')

    rig.behaviour.input = 12
    rig.behaviour.sessionId = 'ses_fake_second'
    rig.send('Turn after OpenCode compaction.')
    await waitFor(() => rig.calls().length === 4 && rig.answer().state === 'idle', 15000, 'the turn after OpenCode compaction')

    const nextCalls = rig.calls()
    expect(nextCalls).toHaveLength(4)
    const nextArgs = nextCalls[3].args
    expect(nextArgs).not.toContain('--session')
    expect(nextArgs.at(-1)).toContain('Reply: Write a summary')
    expect(nextArgs.at(-1)).toContain('Turn after OpenCode compaction.')
    const nextSessionId = stateFile(rig).sessionId
    expect(nextSessionId).toBe('ses_fake_second')
  })

  it('uses default rules or owner rules in compactPrompt', async () => {
    expect(compactPrompt()).toBe(`${COMPACT_PROMPT}\n\nKeep these in the summary:\n${DEFAULT_COMPACT_RULES}`)
    expect(compactPrompt('', 'Keep decisions and test results.')).toBe(
      `${COMPACT_PROMPT}\n\nKeep these in the summary:\nKeep decisions and test results.`
    )
    expect(compactPrompt('Manual keep only.', 'Owner rules ignored.')).toBe(
      `${COMPACT_PROMPT}\n\nKeep these in the summary:\nManual keep only.`
    )

    const rig = makeRig()
    rig.orchestrator.setAutocompact({ rules: 'Track open runs and PRs.', confirmed: true })
    rig.behaviour.input = 165000
    rig.send('Work on the project.')
    await waitFor(() => rig.calls().length === 2 && rig.answer().state === 'idle', 15000, 'the compacted session')
    expect(rig.calls()[1].args[1]).toBe(`${COMPACT_PROMPT}\n\nKeep these in the summary:\nTrack open runs and PRs.`)
  })

  it('reads a chat file holding the old autocompactPercent as percent mode with that value', () => {
    const base = makeTempDir('mr-orchestrator-old-')
    const runs = join(base, 'runs')
    const projectRoot = join(base, 'project')
    mkdirSync(runs, { recursive: true })
    mkdirSync(projectRoot, { recursive: true })
    const oldFile = chatFileFor(projectRoot, runs, 'orchestrator')
    writeFileSync(
      oldFile,
      JSON.stringify({
        project: projectRoot,
        sessionId: null,
        state: 'idle',
        messages: [],
        pending: [],
        autocompact: true,
        autocompactPercent: 72,
      })
    )
    const orchestrator = createOrchestrator({
      projectRoot,
      runsFolder: runs,
      lanes: LANES,
    })
    expect(orchestrator.answer()).toMatchObject({
      autocompact: true,
      autocompactMode: 'percent',
      autocompactValue: 72,
      compactRules: '',
      autocompactPercent: 72,
    })
  })

  it('refuses autocompact mode, value and rules out of range with 400 and one sentence', () => {
    const rig = makeRig()
    expect(rig.orchestrator.setAutocompact({ confirmed: false })).toEqual({
      status: 400,
      body: { error: CONFIRM_AUTOCOMPACT_PROBLEM },
    })
    expect(rig.orchestrator.setAutocompact({ confirmed: true })).toEqual({
      status: 400,
      body: { error: AUTOCOMPACT_PROBLEM },
    })
    expect(rig.orchestrator.setAutocompact({ confirmed: true, on: 'yes' })).toEqual({
      status: 400,
      body: { error: AUTOCOMPACT_PROBLEM },
    })
    expect(rig.orchestrator.setAutocompact({ confirmed: true, mode: 'characters' })).toEqual({
      status: 400,
      body: { error: AUTOCOMPACT_MODE_PROBLEM },
    })
    expect(rig.orchestrator.setAutocompact({ confirmed: true, mode: 'percent', value: 0 })).toEqual({
      status: 400,
      body: { error: AUTOCOMPACT_PERCENT_PROBLEM },
    })
    expect(rig.orchestrator.setAutocompact({ confirmed: true, mode: 'percent', value: 100.1 })).toEqual({
      status: 400,
      body: { error: AUTOCOMPACT_PERCENT_PROBLEM },
    })
    expect(rig.orchestrator.setAutocompact({ confirmed: true, percent: 0 })).toEqual({
      status: 400,
      body: { error: AUTOCOMPACT_PERCENT_PROBLEM },
    })
    expect(rig.orchestrator.setAutocompact({ confirmed: true, mode: 'tokens', value: 999 })).toEqual({
      status: 400,
      body: { error: AUTOCOMPACT_TOKENS_PROBLEM },
    })
    expect(rig.orchestrator.setAutocompact({ confirmed: true, mode: 'tokens', value: 10000001 })).toEqual({
      status: 400,
      body: { error: AUTOCOMPACT_TOKENS_PROBLEM },
    })
    expect(rig.orchestrator.setAutocompact({ confirmed: true, mode: 'tokens', value: 5000.5 })).toEqual({
      status: 400,
      body: { error: AUTOCOMPACT_TOKENS_PROBLEM },
    })
    expect(rig.orchestrator.setAutocompact({ confirmed: true, rules: 'x'.repeat(2001) })).toEqual({
      status: 400,
      body: { error: AUTOCOMPACT_RULES_PROBLEM },
    })
    expect(
      rig.orchestrator.setAutocompact({ confirmed: true, mode: 'tokens', value: 50000, rules: 'Valid rules.' })
    ).toEqual({
      status: 200,
      body: {
        id: 'orchestrator',
        autocompact: true,
        autocompactMode: 'tokens',
        autocompactValue: 50000,
        compactRules: 'Valid rules.',
        autocompactPercent: 25,
      },
    })
  })

  it('enforces the no-loop rule: a compact turn never starts another compact turn', async () => {
    const rig = makeRig()
    rig.behaviour.input = 170000
    rig.send('Turn 1: initial message.')
    await waitFor(() => rig.calls().length === 2 && rig.answer().state === 'idle', 15000, 'initial compaction')

    expect(rig.calls()).toHaveLength(2)
    await sleep(200)
    expect(rig.calls()).toHaveLength(2)
    expect(rig.answer().state).toBe('idle')

    rig.behaviour.input = 12
    rig.send('Turn 3: next owner turn.')
    await waitFor(() => rig.calls().length === 3 && rig.answer().state === 'idle', 15000, 'turn after compaction')
    expect(rig.calls()).toHaveLength(3)
  })

  it('runs compact now with keep text and refuses while running or with no session', async () => {
    const rig = makeRig()
    expect(rig.orchestrator.compact({ confirmed: true })).toEqual({
      status: 400,
      body: { error: NO_SESSION_PROBLEM },
    })

    rig.behaviour.mode = 'hold'
    rig.send('Start turn')
    await waitFor(() => rig.answer().state === 'working', 5000, 'turn to start')

    expect(rig.orchestrator.compact({ confirmed: true })).toEqual({
      status: 409,
      body: { error: COMPACT_RUNNING_PROBLEM },
    })

    writeFileSync(rig.releaseFile, 'go')
    await waitIdle(rig, 1)

    expect(rig.orchestrator.compact({ confirmed: true, keep: 'a'.repeat(2001) })).toEqual({
      status: 400,
      body: { error: COMPACT_KEEP_PROBLEM },
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

  it('keeps the open session and says so when a compact fails', async () => {
    const rig = makeRig()
    rig.send('First turn')
    await waitIdle(rig, 1)
    const sessionId = valueAfter(rig.calls()[0].args, '--session-id')
    expect(sessionId).toBeTruthy()

    rig.behaviour.mode = 'fail'
    expect(rig.orchestrator.compact({ confirmed: true })).toEqual({ status: 200, body: { ok: true } })
    await waitIdle(rig, 2)

    const messages = rig.answer().messages
    expect(messages.some((message) => message.from === 'room' && message.text === COMPACT_FAILED_MESSAGE)).toBe(true)
    expect(messages.some((message) => message.text === COMPACTED_MESSAGE)).toBe(false)

    rig.behaviour.mode = 'reply'
    rig.send('After the failed compact')
    await waitIdle(rig, 3)
    const resume = rig.calls()[2].args
    expect(resume).toContain('--resume')
    expect(valueAfter(resume, '--resume')).toBe(sessionId)
  })

  it('sets a model listed for its harness and refuses unlisted models', async () => {
    const rig = makeRig()
    expect(rig.orchestrator.setModel({ model: 'unlisted-model', confirmed: true })).toEqual({
      status: 400,
      body: { error: MODEL_PROBLEM },
    })
    expect(rig.orchestrator.setModel({ model: 'opencode/deepseek-v4.1-flash-free', confirmed: true })).toEqual({
      status: 400,
      body: { error: MODEL_PROBLEM },
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
  it('wakes a sub with no goal yet for a run credited to it by name, and not the main for an unnamed run', async () => {
    const write = (rig, name, startedBy) => {
      const log = join(rig.runs, `${name}.log`)
      writeFileSync(log, 'a log\n')
      appendFileSync(
        join(rig.runs, 'runs.jsonl'),
        `${JSON.stringify({ lane: 'opencode7', model: 'm', startedAt: '2026-10-29T12:00:00.000Z', minutes: 1, exitCode: 0, killed: false, log, ...(startedBy ? { startedBy } : {}) })}\n`
      )
    }
    const sub = makeRig({ id: 'team-1' })
    write(sub, 'opencode7-queue-20261029-120000-1', 'team-1')
    sub.orchestrator.onFrame(frame('run-opencode7-queue-20261029-120000-1', 'succeeded'))
    await waitFor(() => sub.calls().length === 1, 15000, 'the sub turn to start')

    const main = makeRig()
    write(main, 'opencode7-queue-20261029-120001-1', '')
    main.orchestrator.onFrame(frame('run-opencode7-queue-20261029-120001-1', 'succeeded'))
    await sleep(300)
    expect(main.calls()).toHaveLength(0)
  })

  it('never wakes an orchestrator on a session reader run or a run without a record that the room started', async () => {
    const rig = makeRig()
    rig.send('Hello')
    await waitIdle(rig, 1)
    const callsBefore = rig.calls().length
    const messagesBefore = rig.answer().messages.length

    rig.orchestrator.onFrame(frame('session-1:1', 'succeeded', 'opencode-session'))
    rig.orchestrator.onFrame(frame('session-2:1', 'succeeded', 'claude-session'))
    rig.orchestrator.onFrame(frame('non-room-1', 'succeeded', 'unrecorded-agent'))
    await sleep(300)

    expect(rig.calls().length).toBe(callsBefore)
    expect(rig.answer().messages.length).toBe(messagesBefore)
  })

  it('wakes the main orchestrator when startedBy names a sub that no longer exists', async () => {
    const main = makeRig()
    const log = join(main.runs, 'opencode7-del-1.log')
    writeFileSync(log, 'done\n')
    appendFileSync(
      join(main.runs, 'runs.jsonl'),
      `${JSON.stringify({ lane: 'opencode7', model: 'm', startedAt: '2026-10-30T12:00:00.000Z', minutes: 1, exitCode: 0, killed: false, log, startedBy: 'deleted-team' })}\n`
    )

    main.orchestrator.onFrame(frame('run-opencode7-del-1', 'succeeded'))
    await waitFor(() => main.calls().length === 1, 15000, 'the main orchestrator to wake for deleted sub run')
    await waitIdle(main, 1)

    const roomMessage = main.answer().messages.find((m) => m.from === 'room' && m.text.includes('Run opencode7-del-1 on lane opencode7 ended: succeeded.'))
    expect(roomMessage).toBeDefined()
    expect(roomMessage.text).toContain('started by removed sub deleted-team')
  })

  it('waits a room turn while a merge is in progress and starts it when the merge ends', async () => {
    const rig = makeRig({ mergeWaitMs: 40 })
    gitInit(rig.projectRoot)
    rig.send('Ready')
    await waitIdle(rig, 1)
    const mergeHead = join(rig.projectRoot, '.git', 'MERGE_HEAD')
    writeFileSync(mergeHead, `${'a'.repeat(40)}\n`)

    rig.orchestrator.onFrame(frame('run-opencode7-merge-wait', 'succeeded'))
    await waitFor(
      () => rig.answer().messages.some((m) => m.from === 'room' && m.text.includes('Run opencode7-merge-wait')),
      15000,
      'the room turn after the merge'
    )

    expect(rig.calls()).toHaveLength(1)
    expect(rig.answer().messages.some((m) => m.from === 'room' && m.text.includes('Run opencode7-merge-wait'))).toBe(true)
    expect(stateFile(rig).pending).toHaveLength(1)

    rmSync(mergeHead, { force: true })
    await waitFor(() => rig.calls().length === 2, 5000, 'the room turn after the merge')
    await waitIdle(rig, 2)
  })

  it('starts an owner message at once while a merge is in progress', async () => {
    const rig = makeRig({ mergeWaitMs: 60000 })
    gitInit(rig.projectRoot)
    writeFileSync(join(rig.projectRoot, '.git', 'MERGE_HEAD'), `${'b'.repeat(40)}\n`)

    rig.send('Go now')
    await waitIdle(rig, 1)

    expect(rig.calls()).toHaveLength(1)
  })

  it('answers a timer and a request while a slow merge check runs, and starts one check for two wakes', async () => {
    let checks = 0
    const slowGit = (file, args, options) => {
      checks += 1
      return spawn(process.execPath, ['-e', SLOW_GIT], options)
    }
    const rig = makeRig({ mergeWaitMs: 40, gitSpawn: slowGit })
    gitInit(rig.projectRoot)
    rig.send('Ready')
    await waitIdle(rig, 1)

    let ticks = 0
    const ticker = setInterval(() => {
      ticks += 1
    }, 10)
    try {
      rig.orchestrator.onFrame(frame('run-opencode7-slow-check', 'succeeded'))
      await waitFor(
        () => existsSync(join(rig.projectRoot, '.git', 'check-started')),
        15000,
        'the slow merge check to start'
      )

      await sleep(100)
      expect(ticks).toBeGreaterThan(1)
      expect(rig.orchestrator.answer().state).toBe('idle')
      rig.orchestrator.deliver('room', 'A second wake')
      await sleep(100)
      expect(checks).toBe(1)
      expect(rig.calls()).toHaveLength(1)

      writeFileSync(join(rig.projectRoot, '.git', 'check-release'), '1')
      await waitFor(() => rig.calls().length === 2, 5000, 'the room turn after the slow check')
      await waitIdle(rig, 2)
      expect(checks).toBe(1)
    } finally {
      clearInterval(ticker)
    }
  })

  it('starts the room turn when the merge check fails', async () => {
    let checks = 0
    const child = emitterChild()
    const failGit = () => {
      checks += 1
      return child
    }
    const rig = makeRig({ gitSpawn: failGit })
    gitInit(rig.projectRoot)
    rig.send('Ready')
    await waitIdle(rig, 1)

    rig.orchestrator.onFrame(frame('run-opencode7-failed-check', 'succeeded'))
    await waitFor(() => checks === 1, 5000, 'the merge check to start')
    child.emit('close', 128)

    await waitFor(() => rig.calls().length === 2, 5000, 'the room turn after a failed check')
    await waitIdle(rig, 2)
  })

  it('starts the room turn when the merge check times out', async () => {
    const rig = makeRig({ gitSpawn: () => emitterChild(), gitTimeoutMs: 30 })
    gitInit(rig.projectRoot)
    rig.send('Ready')
    await waitIdle(rig, 1)

    rig.orchestrator.onFrame(frame('run-opencode7-check-timeout', 'succeeded'))
    await waitFor(() => rig.calls().length === 2, 5000, 'the room turn after a timed out check')
    await waitIdle(rig, 2)
  })

  it('wakes once for each real end when a run reopens, and suppresses duplicate turns for the same outcome', async () => {
    const rig = makeRig()
    rig.send('Ready')
    await waitIdle(rig, 1)
    expect(rig.calls()).toHaveLength(1)

    const log1 = join(rig.runs, 'opencode7-reopen-1.log')
    writeFileSync(log1, 'partial\n')

    rig.orchestrator.onFrame({
      type: 'heartbeat.run.status',
      payload: { runId: 'run-opencode7-reopen-1', agentId: 'agent-opencode7', status: 'failed', error: 'no record' },
    })
    await waitFor(() => rig.calls().length === 2, 15000, 'the failed no record turn to start')
    await waitIdle(rig, 2)

    appendFileSync(
      join(rig.runs, 'runs.jsonl'),
      `${JSON.stringify({ lane: 'opencode7', model: 'm', startedAt: '2026-10-30T12:00:00.000Z', minutes: 1, exitCode: 1, killed: false, log: log1 })}\n`
    )

    rig.orchestrator.onFrame({
      type: 'heartbeat.run.status',
      payload: { runId: 'run-opencode7-reopen-1', agentId: 'agent-opencode7', status: 'failed' },
    })
    await waitFor(
      () => rig.answer().messages.some((m) => m.text.includes('Run opencode7-reopen-1 on lane opencode7 ended: failed.')),
      15000,
      'the failed run end on the room message'
    )
    expect(rig.calls()).toHaveLength(2)
    const messages = rig.answer().messages.filter((m) => m.from === 'room')
    expect(messages.some((m) => m.text.includes('Run opencode7-reopen-1 on lane opencode7 ended: failed.'))).toBe(true)

    const log2 = join(rig.runs, 'opencode7-reopen-2.log')
    writeFileSync(log2, 'partial\n')
    rig.orchestrator.onFrame({
      type: 'heartbeat.run.status',
      payload: { runId: 'run-opencode7-reopen-2', agentId: 'agent-opencode7', status: 'failed', error: 'no record' },
    })
    await waitFor(() => rig.calls().length === 3, 15000, 'the failed no record turn for run 2')
    await waitIdle(rig, 3)

    appendFileSync(
      join(rig.runs, 'runs.jsonl'),
      `${JSON.stringify({ lane: 'opencode7', model: 'm', startedAt: '2026-10-30T12:05:00.000Z', minutes: 1, exitCode: 0, killed: false, log: log2 })}\n`
    )

    rig.orchestrator.onFrame({
      type: 'heartbeat.run.status',
      payload: { runId: 'run-opencode7-reopen-2', agentId: 'agent-opencode7', status: 'succeeded' },
    })
    await waitFor(() => rig.calls().length === 4, 15000, 'the succeeded turn after reopen')
    await waitIdle(rig, 4)
    expect(rig.answer().messages.some((m) => m.from === 'room' && m.text.includes('Run opencode7-reopen-2 on lane opencode7 ended: succeeded.'))).toBe(true)
  })

  it('reads only the last 64 KB of the log on a failed run wake or finished turn (S37)', async () => {
    const rig = makeRig()
    rig.send('Ready')
    await waitIdle(rig, 1)

    const log = join(rig.runs, 'opencode7-big-1.log')
    const padding = 'x'.repeat(100 * 1024)
    const errorLine = JSON.stringify({ type: 'error', error: { message: 'bounded tail error' } })
    writeFileSync(log, `${padding}\n${errorLine}\n`)

    expect(LOG_TAIL_BYTES).toBe(64 * 1024)
    const tail = readTail(log)
    expect(tail.length).toBeLessThan(100 * 1024)
    expect(tail).toContain('bounded tail error')

    appendFileSync(
      join(rig.runs, 'runs.jsonl'),
      `${JSON.stringify({ lane: 'opencode7', model: 'm', startedAt: '2026-10-30T12:00:00.000Z', minutes: 1, exitCode: 1, killed: false, log })}\n`
    )

    rig.orchestrator.onFrame(frame('run-opencode7-big-1', 'failed'))
    await waitFor(() => rig.calls().length === 2, 15000, 'the failed run turn to start')
    await waitIdle(rig, 2)

    const roomMessage = rig.answer().messages.find((m) => m.from === 'room' && m.text.includes('Run opencode7-big-1'))
    expect(roomMessage).toBeDefined()
    expect(roomMessage.text).toContain('Error: bounded tail error')
  })

  it('keeps at most the newest 200 completed runs (S37)', async () => {
    const rig = makeRig()
    rig.send('Ready')
    await waitIdle(rig, 1)

    for (let index = 0; index < 210; index += 1) {
      rig.orchestrator.onFrame(frame(`run-fill-${index}`, 'succeeded'))
    }
    const chat = JSON.parse(readFileSync(chatFileFor(rig.projectRoot, rig.runs), 'utf8'))
    expect(chat.completedRuns).toHaveLength(200)
    expect(chat.completedRuns[0][0]).toBe('run-fill-10')
    expect(chat.completedRuns.at(-1)[0]).toBe('run-fill-209')
  })

  it('remembers a reported run end across a restart and adds no duplicate line', async () => {
    const rig = makeRig()
    rig.send('Ready')
    await waitIdle(rig, 1)

    const log = join(rig.runs, 'opencode7-restart-1.log')
    writeFileSync(log, 'done\n')
    appendFileSync(
      join(rig.runs, 'runs.jsonl'),
      `${JSON.stringify({ lane: 'opencode7', model: 'm', startedAt: '2026-10-30T12:00:00.000Z', minutes: 1, exitCode: 0, killed: false, log })}\n`
    )
    rig.orchestrator.onFrame(frame('run-opencode7-restart-1', 'succeeded'))
    await waitIdle(rig, 2)
    const line = (message) => message.from === 'room' && message.text.includes('Run opencode7-restart-1')
    expect(rig.answer().messages.filter(line)).toHaveLength(1)

    rig.orchestrator.close()
    const restored = restoreRig(rig)
    restored.orchestrator.onFrame(frame('run-opencode7-restart-1', 'succeeded'))
    await sleep(300)

    expect(restored.calls()).toHaveLength(0)
    expect(restored.answer().messages.filter(line)).toHaveLength(1)
  })

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

  it('keeps a run end that arrives while paused and runs it after the next owner message', async () => {
    const rig = makeRig()
    rig.send('Start')
    await waitIdle(rig, 1)
    rig.orchestrator.stop({ confirmed: true })

    const log = join(rig.runs, 'opencode7-paused-1.log')
    writeFileSync(log, 'done\n')
    appendFileSync(
      join(rig.runs, 'runs.jsonl'),
      `${JSON.stringify({ lane: 'opencode7', model: 'm', startedAt: '2026-10-30T12:00:00.000Z', minutes: 1, exitCode: 0, killed: false, log })}\n`
    )
    rig.orchestrator.onFrame(frame('run-opencode7-paused-1', 'succeeded'))
    await waitFor(
      () => rig.answer().messages.some((message) => message.from === 'room' && message.text.includes('Run opencode7-paused-1')),
      15000,
      'the kept run end while paused'
    )

    expect(rig.calls()).toHaveLength(1)
    expect(rig.answer().state).toBe('paused')
    expect(rig.answer().messages.some((message) => message.from === 'room' && message.text.includes('Run opencode7-paused-1'))).toBe(true)

    rig.send('Resume the room')
    await waitIdle(rig, 2)
    const prompt = rig.calls()[1].args[1]
    expect(prompt).toContain('Run opencode7-paused-1 on lane opencode7 ended: succeeded.')
    expect(prompt).toContain('Resume the room')
  })

  it('adds an Error line to the wake message when a failed run has an error in its log', async () => {
    const rig = makeRig()
    rig.send('Hello')
    await waitIdle(rig, 1)

    const longKeyError = 'Free usage limit reached. key sk-ant-api03-' + 'x'.repeat(24) + ' ' + 'more text '.repeat(40)
    const log = join(rig.runs, 'opencode-failed-run.log')
    writeFileSync(
      log,
      JSON.stringify({
        type: 'error',
        error: { type: 'provider.quota', message: longKeyError },
      }) + '\n'
    )
    appendFileSync(
      join(rig.runs, 'runs.jsonl'),
      `${JSON.stringify({
        lane: 'opencode',
        briefs: ['T1'],
        model: 'm',
        startedAt: '2026-10-24T12:00:00.000Z',
        minutes: 1,
        exitCode: 1,
        killed: false,
        log,
      })}\n`
    )
    rig.orchestrator.onFrame(frame('run-opencode-failed-run', 'failed'))
    await waitFor(() => rig.calls().length === 2)
    await waitIdle(rig, 2)

    const prompt = rig.calls()[1].args[1]
    expect(prompt).toContain('Run opencode-failed-run on lane opencode ended: failed.')
    expect(prompt).toContain('exit 1')
    expect(prompt).toContain('Error: Free usage limit reached. key [key]')
    expect(prompt).not.toContain('sk-ant-api03-')
    const errorLine = prompt.split('\n').find((line) => line.startsWith('Error: '))
    expect(errorLine).toBeDefined()
    expect(errorLine.slice('Error: '.length)).toHaveLength(300)

    const noErrorLog = join(rig.runs, 'opencode-plain-fail.log')
    writeFileSync(noErrorLog, 'some output without json error\n')
    appendFileSync(
      join(rig.runs, 'runs.jsonl'),
      `${JSON.stringify({
        lane: 'opencode',
        briefs: ['T2'],
        model: 'm',
        startedAt: '2026-10-24T12:05:00.000Z',
        minutes: 1,
        exitCode: 2,
        killed: false,
        log: noErrorLog,
      })}\n`
    )
    rig.orchestrator.onFrame(frame('run-opencode-plain-fail', 'failed'))
    await waitFor(() => rig.calls().length === 3)
    await waitIdle(rig, 3)

    const nextPrompt = rig.calls()[2].args[1]
    expect(nextPrompt).toContain('exit 2')
    expect(nextPrompt).not.toContain('Error:')
  })

  it('reads a failed run log only when it resolves inside the runs folder', async () => {
    const rig = makeRig()
    rig.send('Start')
    await waitFor(() => rig.calls().length === 1)
    await waitIdle(rig, 1)

    const outsideLog = join(rig.base, 'outside-secret.log')
    writeFileSync(
      outsideLog,
      JSON.stringify({
        type: 'error',
        error: { type: 'secret', message: 'LEAKED_SECRET_VALUE' },
      }) + '\n'
    )

    appendFileSync(
      join(rig.runs, 'runs.jsonl'),
      `${JSON.stringify({
        lane: 'opencode',
        briefs: ['T3'],
        model: 'm',
        startedAt: '2026-10-24T12:10:00.000Z',
        minutes: 1,
        exitCode: 1,
        killed: false,
        log: outsideLog,
      })}\n`
    )
    rig.orchestrator.onFrame(frame('run-opencode-traversal', 'failed'))
    await waitFor(() => rig.calls().length === 2)
    await waitIdle(rig, 2)

    const prompt1 = rig.calls()[1].args[1]
    expect(prompt1).toContain('Run opencode-traversal on lane opencode7 ended: failed.')
    expect(prompt1).not.toContain('LEAKED_SECRET_VALUE')
    expect(prompt1).not.toContain('Error:')

    rig.orchestrator.onFrame(frame('run-../outside-secret', 'failed'))
    await waitFor(() => rig.calls().length === 3)
    await waitIdle(rig, 3)

    const prompt2 = rig.calls()[2].args[1]
    expect(prompt2).not.toContain('LEAKED_SECRET_VALUE')
    expect(prompt2).not.toContain('Error:')
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

  it('keeps the queued messages that a long turn could not fit and runs them next', async () => {
    const rig = makeRig()
    rig.behaviour.mode = 'hold'
    rig.send('Start')
    await waitFor(() => rig.calls().length === 1, 5000, 'the held turn')
    const long = (tag) => `${tag} ${'a'.repeat(7996)}`
    for (const tag of ['Q1', 'Q2', 'Q3', 'Q4']) rig.send(long(tag))
    writeFileSync(rig.releaseFile, 'go')
    await waitIdle(rig, 3)

    const second = rig.calls()[1].args[1]
    expect(second).toContain('Q1')
    expect(second).toContain('Q2')
    expect(second).not.toContain('Q3')
    expect(second).not.toContain('Q4')

    const third = rig.calls()[2].args[1]
    expect(third).toContain('Q3')
    expect(third).toContain('Q4')
    expect(third).not.toContain('Q1')
    expect(third).not.toContain('Q2')
  })

  it('does not report a stopped turn when stop lands after the child exited well', async () => {
    const base = makeTempDir('mr-stop-race-')
    const runs = join(base, 'runs')
    const projectRoot = join(base, 'project')
    mkdirSync(runs, { recursive: true })
    mkdirSync(projectRoot, { recursive: true })
    const promptFile = join(base, 'orchestrator-agent.md')
    writeFileSync(promptFile, PROMPT)
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => {}
    const orchestrator = createOrchestrator({
      projectRoot,
      runsFolder: runs,
      lanes: LANES,
      promptFile,
      spawn: () => child,
    })
    cleanups.push(async () => {
      orchestrator.close()
      await sleep(20)
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    })

    expect(orchestrator.send({ text: 'Finish first', confirmed: true }).status).toBe(202)
    child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }) + '\n')
    child.stdout.write(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'All done.',
        usage: { input_tokens: 12, output_tokens: 3 },
      }) + '\n'
    )
    child.emit('close', 0)
    expect(orchestrator.stop({ confirmed: true })).toEqual({ status: 200, body: { ok: true } })

    await waitFor(() => orchestrator.answer().messages.some((message) => message.from === 'orchestrator'))
    expect(orchestrator.answer().messages.at(-1).text).toBe('All done.')
    expect(orchestrator.answer().messages.some((message) => /^The orchestrator stopped/.test(message.text))).toBe(false)
    expect(readLines(join(runs, 'runs.jsonl')).at(-1)).toMatchObject({ exitCode: 0, killed: false })
  })

  it('does not report a stopped turn when stop races right before close with complete output', async () => {
    const base = makeTempDir('mr-stop-race-before-')
    const runs = join(base, 'runs')
    const projectRoot = join(base, 'project')
    mkdirSync(runs, { recursive: true })
    mkdirSync(projectRoot, { recursive: true })
    const promptFile = join(base, 'orchestrator-agent.md')
    writeFileSync(promptFile, PROMPT)
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => {}
    const orchestrator = createOrchestrator({
      projectRoot,
      runsFolder: runs,
      lanes: LANES,
      promptFile,
      spawn: () => child,
    })
    cleanups.push(async () => {
      orchestrator.close()
      await sleep(20)
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    })

    expect(orchestrator.send({ text: 'Finish first', confirmed: true }).status).toBe(202)
    child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }) + '\n')
    child.stdout.write(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'All done.',
        usage: { input_tokens: 12, output_tokens: 3 },
      }) + '\n'
    )
    expect(orchestrator.stop({ confirmed: true })).toEqual({ status: 200, body: { ok: true } })
    child.emit('close', 0)

    await waitFor(() => orchestrator.answer().messages.some((message) => message.from === 'orchestrator'))
    expect(orchestrator.answer().messages.at(-1).text).toBe('All done.')
    expect(orchestrator.answer().messages.some((message) => /^The orchestrator stopped/.test(message.text))).toBe(false)
    expect(readLines(join(runs, 'runs.jsonl')).at(-1)).toMatchObject({ exitCode: 0, killed: false })
  })

  it('says in the room when a chat run record cannot be saved', async () => {
    const base = makeTempDir('mr-record-fail-')
    const runs = join(base, 'runs')
    const projectRoot = join(base, 'project')
    mkdirSync(runs, { recursive: true })
    mkdirSync(projectRoot, { recursive: true })
    const promptFile = join(base, 'orchestrator-agent.md')
    writeFileSync(promptFile, PROMPT)
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => {}
    const error = new Error('no space left on device')
    error.code = 'ENOSPC'
    const orchestrator = createOrchestrator({
      projectRoot,
      runsFolder: runs,
      lanes: LANES,
      promptFile,
      spawn: () => child,
      appendRecord: () => {
        throw error
      },
    })
    cleanups.push(async () => {
      orchestrator.close()
      await sleep(20)
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    })

    expect(orchestrator.send({ text: 'Save it', confirmed: true }).status).toBe(202)
    child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }) + '\n')
    child.stdout.write(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'All done.',
        usage: { input_tokens: 12, output_tokens: 3 },
      }) + '\n'
    )
    child.emit('close', 0)

    await waitFor(() => orchestrator.answer().messages.some((message) => message.from === 'orchestrator'))
    const said = orchestrator.answer().messages.filter((message) => message.text === 'The chat run record was not saved (ENOSPC).')
    expect(said).toHaveLength(1)
    expect(said[0].from).toBe('room')
    expect(existsSync(join(runs, 'runs.jsonl'))).toBe(false)
  })

  it('starts the waiting room turn when the hourly cap frees a slot', async () => {
    const base = makeTempDir('mr-room-cap-')
    const runs = join(base, 'runs')
    const projectRoot = join(base, 'project')
    mkdirSync(runs, { recursive: true })
    mkdirSync(projectRoot, { recursive: true })
    const promptFile = join(base, 'orchestrator-agent.md')
    writeFileSync(promptFile, PROMPT)
    const started = Date.now()
    const roomTurns = Array.from({ length: 30 }, (_, index) => started - ORCHESTRATOR_ROOM_WINDOW_MS + 300 + index)
    writeFileSync(
      chatFileFor(projectRoot, runs),
      `${JSON.stringify({ project: projectRoot, sessionId: 'session-1', state: 'idle', messages: [], pending: [], roomTurns })}\n`
    )
    let spawned = false
    const spawnFake = () => {
      spawned = true
      const child = new EventEmitter()
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.kill = () => {}
      setTimeout(() => {
        child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }) + '\n')
        child.stdout.write(
          JSON.stringify({ type: 'result', subtype: 'success', result: 'Room turn done.', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n'
        )
        child.emit('close', 0)
      }, 10)
      return child
    }
    const orchestrator = createOrchestrator({ projectRoot, runsFolder: runs, lanes: LANES, promptFile, spawn: spawnFake })
    cleanups.push(async () => {
      orchestrator.close()
      await sleep(20)
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    })

    orchestrator.onFrame(frame('run-opencode7-cap-wait', 'succeeded'))
    expect(spawned).toBe(false)
    await waitFor(() => spawned, 5000, 'the capped room turn to start')
  })

  it('kills the turn on stop, pauses and clears the pause on the next owner message', async () => {
    const rig = makeRig()
    rig.behaviour.mode = 'hold'
    rig.send('A long job')
    await waitFor(() => rig.calls().length === 1)
    const pid = rig.calls()[0].pid
    expect(rig.orchestrator.stop({})).toEqual({ status: 400, body: { error: CONFIRM_STOP_PROBLEM } })
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

  it('clears pause and starts a turn on a delivered main orchestrator message to a sub', async () => {
    const rig = makeRig({ id: 'sub-backend' })
    rig.orchestrator.stop({ confirmed: true })
    expect(rig.answer().state).toBe('paused')
    rig.orchestrator.deliver('orchestrator', 'Resume sub')
    await waitIdle(rig, 1)
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

  it('keeps agent messages and lane replies through a restart and a fork', () => {
    const fleet = { ...LANES, opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode', model: 'x' } } }
    const rig = makeRig({ lanes: fleet })
    const order = rig.orchestrator.recordAgentMessage({
      from: 'orchestrator',
      to: 'opencode',
      kind: 'order',
      text: 'Build the page',
      lanes: fleet,
    })
    const reply = rig.orchestrator.addLaneReply('opencode', 'The page builds.')
    expect(order).toBeTruthy()
    expect(reply).toBeTruthy()
    expect(rig.answer().messages.some((message) => message.from === 'agent' && message.agent?.text === 'Build the page')).toBe(true)
    expect(rig.answer().messages.some((message) => message.from === 'opencode' && message.text === 'The page builds.')).toBe(true)
    rig.orchestrator.close()

    const restarted = restoreRig(rig)
    const afterRestart = restarted.answer().messages
    expect(
      afterRestart.some(
        (message) =>
          message.from === 'agent' &&
          message.agent?.from === 'orchestrator' &&
          message.agent?.to === 'opencode' &&
          message.agent?.kind === 'order' &&
          message.agent?.text === 'Build the page'
      )
    ).toBe(true)
    expect(afterRestart.some((message) => message.from === 'opencode' && message.text === 'The page builds.')).toBe(true)

    expect(restarted.orchestrator.branchSession({ index: afterRestart.length, confirmed: true }).status).toBe(200)
    const afterFork = restarted.answer().messages
    expect(afterFork.some((message) => message.from === 'agent' && message.agent?.text === 'Build the page')).toBe(true)
    expect(afterFork.some((message) => message.from === 'opencode' && message.text === 'The page builds.')).toBe(true)
    restarted.orchestrator.close()

    const forked = restoreRig(rig, { file: 'calls-forked.jsonl' })
    const afterBoth = forked.answer().messages
    expect(afterBoth.some((message) => message.from === 'agent' && message.agent?.text === 'Build the page')).toBe(true)
    expect(afterBoth.some((message) => message.from === 'opencode' && message.text === 'The page builds.')).toBe(true)
  })

  it('gives a resumed OpenCode session its new token once after a restart', async () => {
    const rig = makeRig({ harness: 'opencode', lanes: OPENCODE_LANES })
    rig.send('Remember me')
    await waitIdle(rig, 1)
    rig.send('Again')
    await waitIdle(rig, 2)
    expect(rig.calls()[1].args.at(-1)).not.toContain('X-MachineRoom-Orchestrator')
    rig.orchestrator.close()

    const callsFile = join(rig.base, 'calls-restored.jsonl')
    const spawnFake = (source, args, options) => {
      const env = { ...(options.env ?? process.env), MR_CALLS: callsFile, MR_MODE: 'reply', MR_RELEASE: join(rig.base, 'no-release') }
      return spawn(process.execPath, [rig.script, ...args], { ...options, env })
    }
    const restored = createOrchestrator({
      projectRoot: rig.projectRoot,
      runsFolder: rig.runs,
      lanes: OPENCODE_LANES,
      harness: 'opencode',
      spawn: spawnFake,
      promptFile: rig.promptFile,
      token: 'fresh-token',
    })
    cleanups.push(async () => restored.close())
    restored.send({ text: 'After the restart', confirmed: true })
    await waitFor(() => readLines(callsFile).length === 1 && restored.answer().state === 'idle')
    const resumed = readLines(callsFile)[0].args
    expect(resumed).toContain('--session')
    expect(resumed.at(-1)).toContain('X-MachineRoom-Orchestrator: fresh-token')
    restored.send({ text: 'Once more', confirmed: true })
    await waitFor(() => readLines(callsFile).length === 2 && restored.answer().state === 'idle')
    expect(readLines(callsFile)[1].args.at(-1)).not.toContain('fresh-token')
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

  it('keeps a waiting message from a sub or the room as well as the owner after restart', async () => {
    const rig = makeRig()
    rig.orchestrator.setLadder({ subs: [{ id: 'team-1', name: 'Team 1', lanes: [] }] })
    rig.behaviour.mode = 'hold'
    rig.send('First job')
    await waitFor(() => rig.calls().length === 1)
    rig.orchestrator.deliver('sub:team-1', 'Report from team-1')
    rig.orchestrator.deliver('room', 'Wake from room')
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
    expect(saved.pending).toHaveLength(2)
    const pendingMessages = saved.pending.map((id) => saved.messages.find((m) => m.id === id))
    expect(pendingMessages.some((m) => m.from === 'sub:team-1' && m.text === 'Report from team-1')).toBe(true)
    expect(pendingMessages.some((m) => m.from === 'room' && m.text === 'Wake from room')).toBe(true)

    const restored = restoreRig(rig)
    await waitFor(() => restored.calls().length === 1, 15000, 'the restored waiting message to start')
    await waitFor(() => restored.answer().state === 'idle')
    const prompt = restored.calls()[0].args[1]
    expect(prompt).toContain('Report from team-1')
    expect(prompt).toContain('Wake from room')
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

  it('masks a key in an agent order or report in the chat, its metadata and the saved file', () => {
    const secret = 'sk-or-v1-' + 'q'.repeat(24)
    const setting = 'OPENROUTER_API_KEY='
    const fleet = {
      ...LANES,
      opencode: { name: `OpenCode ${setting}${secret}`, cli: { harness: 'opencode', bin: 'opencode', model: 'x' } },
    }
    const rig = makeRig({ lanes: fleet })
    for (const kind of ['order', 'report']) {
      const message = rig.orchestrator.recordAgentMessage({
        from: 'orchestrator',
        to: 'opencode',
        kind,
        text: `Read ${setting}${secret}`,
        lanes: fleet,
      })
      expect(message).toBeTruthy()
      expect(message.agent.text).toContain('[key]')
      expect(message.agent.text).not.toContain(secret)
      expect(message.agent.toName).toContain('[key]')
      expect(message.agent.toName).not.toContain(secret)
      expect(message.text).not.toContain(secret)
    }
    const chat = JSON.stringify(rig.answer().messages)
    expect(chat).toContain('[key]')
    expect(chat).not.toContain(secret)
    const saved = readFileSync(chatFileFor(rig.projectRoot, rig.runs), 'utf8')
    expect(saved).toContain('[key]')
    expect(saved).not.toContain(secret)
  })

  it('masks a key in a saved-session agent message it restores', () => {
    const secret = 'sk-or-v1-' + 'q'.repeat(24)
    const setting = 'OPENROUTER_API_KEY='
    const fleet = { ...LANES, opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode', model: 'x' } } }
    const rig = makeRig({ lanes: fleet })
    rig.orchestrator.recordAgentMessage({
      from: 'orchestrator',
      to: 'opencode',
      kind: 'report',
      text: `Done with ${setting}${secret}`,
      lanes: fleet,
    })
    rig.orchestrator.addLaneReply('opencode', `Report sent with ${setting}${secret}`)
    expect(rig.orchestrator.newSession({ confirmed: true }).status).toBe(200)
    const savedId = rig.orchestrator.listSessions()[0].id
    rig.orchestrator.close()

    const restored = restoreRig(rig)
    expect(restored.answer().messages).toEqual([])
    const session = restored.orchestrator.getSession(savedId)
    expect(session.status).toBe(200)
    expect(session.body.messages.some((message) => message.from === 'agent' && message.agent?.text.includes('[key]'))).toBe(true)
    expect(session.body.messages.some((message) => message.from === 'opencode' && message.text.includes('[key]'))).toBe(true)
    const text = JSON.stringify(session.body.messages)
    expect(text).toContain('[key]')
    expect(text).not.toContain(secret)
    expect(readFileSync(chatFileFor(rig.projectRoot, rig.runs), 'utf8')).not.toContain(secret)
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

  it('masks a profile path and a key in a renamed current or saved title', async () => {
    const rig = makeRig()
    rig.send('First conversation')
    await waitIdle(rig, 1)
    const secret = 'sk-or-v1-' + 'q'.repeat(24)
    const profile = process.env.USERPROFILE || process.env.HOME || homedir()
    const rawTitle = `Trace ${join(profile, 'x')} ${secret}`
    expect(rawTitle.length).toBeLessThanOrEqual(80)

    const changed = rig.orchestrator.updateSession(CURRENT_SESSION_KEY, { title: rawTitle, confirmed: true })
    expect(changed.status).toBe(200)
    expect(changed.body.title).toContain('[key]')
    expect(changed.body.title).not.toContain(secret)
    expect(changed.body.title).not.toContain(profile)

    expect(rig.orchestrator.newSession({ confirmed: true }).status).toBe(200)
    const saved = rig.orchestrator.listSessions()[0]
    expect(saved.title).toBe(changed.body.title)
    const renamed = rig.orchestrator.updateSession(saved.id, { title: rawTitle, confirmed: true })
    expect(renamed.status).toBe(200)
    expect(renamed.body.title).toBe(changed.body.title)

    const file = readFileSync(chatFileFor(rig.projectRoot, rig.runs), 'utf8')
    expect(file).toContain('[key]')
    expect(file).not.toContain(secret)
    expect(file).not.toContain(profile)
    expect(JSON.parse(file).sessions[0].title).toBe(changed.body.title)
  })

  it('masks a raw title, compact rules and both summaries in a chat file it restores', () => {
    const rig = makeRig()
    rig.orchestrator.close()
    const secret = 'sk-or-v1-' + 'q'.repeat(24)
    const profile = process.env.USERPROFILE || process.env.HOME || homedir()
    const profilePath = join(profile, 'project', 'trace.log')
    const rawTitle = `Trace ${profilePath} ${secret}`
    const rawRules = `Rules at ${profilePath} for ${secret}`
    const currentSummary = `Current summary at ${profilePath} for ${secret}`
    const savedSummary = `Saved summary at ${profilePath} for ${secret}`
    const file = chatFileFor(rig.projectRoot, rig.runs)
    writeFileSync(
      file,
      `${JSON.stringify({
        project: rig.projectRoot,
        sessionId: null,
        state: 'idle',
        currentSessionId: 's1',
        currentTitle: rawTitle,
        compactRules: rawRules,
        summary: currentSummary,
        sessions: [
          {
            id: 's1',
            title: rawTitle,
            startedAt: '2026-11-13T12:00:00.000Z',
            endedAt: '2026-11-13T12:00:00.000Z',
            summary: savedSummary,
            messages: [],
          },
        ],
        messages: [],
        pending: [],
      })}\n`
    )

    const restored = restoreRig(rig)
    const title = restored.orchestrator.currentSessionInfo().title
    expect(title).toContain('[key]')
    expect(title).not.toContain(secret)
    expect(title).not.toContain(profile)
    const rules = restored.answer().compactRules
    expect(rules).toContain('[key]')
    expect(rules).not.toContain(secret)
    expect(rules).not.toContain(profile)

    const afterRestore = JSON.parse(readFileSync(file, 'utf8'))
    for (const text of [afterRestore.currentTitle, afterRestore.compactRules, afterRestore.summary, afterRestore.sessions[0].summary]) {
      expect(text).toContain('[key]')
      expect(text).not.toContain(secret)
      expect(text).not.toContain(profile)
    }

    expect(restored.orchestrator.newSession({ confirmed: true }).status).toBe(200)
    const afterSave = readFileSync(file, 'utf8')
    expect(afterSave).not.toContain(secret)
    expect(afterSave).not.toContain(profile)
    const saved = JSON.parse(afterSave)
    expect(saved.compactRules).toContain('[key]')
    expect(saved.sessions[0].summary).toContain('[key]')
    expect(saved.sessions[0].summary).not.toContain(secret)
    expect(saved.sessions[0].summary).not.toContain(profile)
  })

  it('masks a key and a profile path in compact rules saved live', () => {
    const rig = makeRig()
    const secret = 'sk-or-v1-' + 'q'.repeat(24)
    const setting = 'OPENROUTER_API_KEY='
    const profile = process.env.USERPROFILE || process.env.HOME || homedir()
    const profilePath = join(profile, 'project', 'trace.log')
    const rawRules = `Rules at ${profilePath} for ${setting}${secret}`

    const saved = rig.orchestrator.setAutocompact({ rules: rawRules, confirmed: true })
    expect(saved.status).toBe(200)
    expect(saved.body.compactRules).toContain('[key]')
    expect(saved.body.compactRules).not.toContain(secret)
    expect(saved.body.compactRules).not.toContain(profile)
    expect(rig.answer().compactRules).toBe(saved.body.compactRules)

    const file = readFileSync(chatFileFor(rig.projectRoot, rig.runs), 'utf8')
    expect(file).toContain('[key]')
    expect(file).not.toContain(secret)
    expect(file).not.toContain(profile)
    expect(JSON.parse(file).compactRules).toBe(saved.body.compactRules)
  })

  it('masks a quoted Windows profile path with a space and leaves a word that only starts like it', () => {
    const fleet = { ...LANES, opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode', model: 'x' } } }
    const rig = makeRig({ lanes: fleet })
    const original = process.env.USERPROFILE
    const profile = 'C:\\Users\\Some Name'
    const near = 'C:\\Users\\Some Namesake\\x.log'
    process.env.USERPROFILE = profile
    let message
    try {
      message = rig.orchestrator.recordAgentMessage({
        from: 'orchestrator',
        to: 'opencode',
        kind: 'report',
        text: `Trace "${profile}\\project\\x.log" and "c:\\users\\some name\\x.log" and ${near}`,
        lanes: fleet,
      })
    } finally {
      if (original === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = original
    }
    expect(message).toBeTruthy()
    expect(message.agent.text).toContain('"%USERPROFILE%\\project\\x.log"')
    expect(message.agent.text).toContain('"%USERPROFILE%\\x.log"')
    expect(message.agent.text).toContain(near)
    expect(message.agent.text).not.toContain(`${profile}\\project`)
    expect(message.agent.text).not.toContain(`${profile}\\x.log`)
    expect(message.agent.text).not.toContain('some name')
    const file = readFileSync(chatFileFor(rig.projectRoot, rig.runs), 'utf8')
    expect(file).toContain('%USERPROFILE%')
    expect(file).not.toContain('some name')
    expect(file).toContain('Some Namesake')
    expect(JSON.parse(file).messages.at(-1).agent.text).toBe(message.agent.text)
  })

  it('masks a key in a work step of the current conversation', async () => {
    const rig = makeRig()
    const secret = 'sk-or-v1-' + 'q'.repeat(24)
    rig.behaviour.assistantLines = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: `src/${secret}.js` } }],
        },
      },
    ]
    rig.send('Read the file.')
    await waitIdle(rig, 1)
    const owner = rig.answer().messages[0]
    expect(owner.work.steps[0].target).toContain('[key]')
    expect(owner.work.steps[0].target).not.toContain(secret)
    expect(JSON.stringify(rig.answer().messages)).not.toContain(secret)
    expect(readFileSync(chatFileFor(rig.projectRoot, rig.runs), 'utf8')).not.toContain(secret)
  })

  it('masks a key in a saved work step before the chat answer and the saved file', () => {
    const rig = makeRig()
    rig.orchestrator.close()
    const secret = 'sk-or-v1-' + 'q'.repeat(24)
    const file = chatFileFor(rig.projectRoot, rig.runs)
    writeFileSync(
      file,
      `${JSON.stringify({
        project: rig.projectRoot,
        sessionId: null,
        state: 'idle',
        messages: [
          {
            id: 'm1',
            from: 'owner',
            text: 'Run the saved step',
            at: '2026-10-25T12:00:00.000Z',
            work: { steps: [{ tool: 'Read', target: `src/${secret}.js` }], seconds: 3 },
          },
        ],
        pending: [],
      })}\n`
    )
    const restored = restoreRig(rig)
    const message = restored.answer().messages[0]
    expect(message.work.steps[0].target).toContain('[key]')
    expect(message.work.steps[0].target).not.toContain(secret)
    expect(JSON.stringify(restored.answer().messages)).not.toContain(secret)
    expect(readFileSync(file, 'utf8')).not.toContain(secret)
  })

  it('masks a key at offset 61 of a saved agent name before the 80 character cap', () => {
    const fleet = { ...LANES, opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode', model: 'x' } } }
    const rig = makeRig({ lanes: fleet })
    rig.orchestrator.close()
    const secret = 'sk-or-v1-' + 'q'.repeat(24)
    const fromName = `${'a'.repeat(60)} ${secret}`
    const file = chatFileFor(rig.projectRoot, rig.runs)
    writeFileSync(
      file,
      `${JSON.stringify({
        project: rig.projectRoot,
        sessionId: null,
        state: 'idle',
        messages: [
          {
            id: 'm1',
            from: 'agent',
            text: 'Order',
            at: '2026-10-25T12:00:00.000Z',
            agent: { from: 'orchestrator', to: 'opencode', kind: 'order', text: 'Do it', fromName, toName: 'OpenCode' },
          },
        ],
        pending: [],
      })}\n`
    )
    const restored = restoreRig(rig)
    const agent = restored.answer().messages[0].agent
    expect(agent.fromName).toContain('[key]')
    expect(agent.fromName).not.toContain(secret)
    expect(agent.fromName.length).toBeLessThanOrEqual(80)
    expect(readFileSync(file, 'utf8')).not.toContain(secret)
  })

  it('masks a profile path in an agent report in the chat and the saved file', () => {
    const fleet = { ...LANES, opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode', model: 'x' } } }
    const rig = makeRig({ lanes: fleet })
    const profile = process.env.USERPROFILE || process.env.HOME || homedir()
    const profilePath = join(profile, 'project', 'trace.log')
    const message = rig.orchestrator.recordAgentMessage({
      from: 'orchestrator',
      to: 'opencode',
      kind: 'report',
      text: `Trace at ${profilePath}`,
      lanes: fleet,
    })
    expect(message).toBeTruthy()
    expect(message.agent.text).not.toContain(profile)
    expect(message.agent.text).toContain(process.platform === 'win32' ? '%USERPROFILE%' : '~')
    expect(JSON.stringify(rig.answer().messages)).not.toContain(profile)
    expect(readFileSync(chatFileFor(rig.projectRoot, rig.runs), 'utf8')).not.toContain(profile)
  })

  it.skipIf(process.platform !== 'win32' || !process.env.APPDATA)('masks a roaming AppData path in an agent report', () => {
    const fleet = { ...LANES, opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode', model: 'x' } } }
    const rig = makeRig({ lanes: fleet })
    const roamingPath = join(process.env.APPDATA, 'tool', 'trace.log')
    const message = rig.orchestrator.recordAgentMessage({
      from: 'orchestrator',
      to: 'opencode',
      kind: 'report',
      text: `Trace at ${roamingPath}`,
      lanes: fleet,
    })
    expect(message.agent.text).toContain('%APPDATA%')
    expect(message.agent.text).not.toContain(process.env.APPDATA)
    expect(readFileSync(chatFileFor(rig.projectRoot, rig.runs), 'utf8')).not.toContain(process.env.APPDATA)
  })

  it('drops a saved sub or agent sender whose identity does not exist', () => {
    const rig = makeRig()
    rig.orchestrator.close()
    const file = chatFileFor(rig.projectRoot, rig.runs)
    writeFileSync(
      file,
      `${JSON.stringify({
        project: rig.projectRoot,
        sessionId: null,
        state: 'idle',
        ladder: { subs: [{ id: 'team-1', name: 'Team 1', lanes: [] }] },
        messages: [
          { id: 'm1', from: 'sub:team-1', text: 'Real sub report', at: '2026-10-25T12:00:00.000Z' },
          { id: 'm2', from: 'sub-ghost', text: 'Invented sub report', at: '2026-10-25T12:00:00.000Z' },
          {
            id: 'm3',
            from: 'agent',
            text: 'Agent order',
            at: '2026-10-25T12:00:00.000Z',
            agent: { from: 'orchestrator', to: 'made-up', kind: 'order', text: 'Unknown lane' },
          },
        ],
        pending: [],
      })}\n`
    )
    const restored = restoreRig(rig)
    const texts = restored.answer().messages.map((message) => message.text)
    expect(texts).toContain('Real sub report')
    expect(texts).not.toContain('Invented sub report')
    expect(texts).not.toContain('Agent order')
    expect(readFileSync(file, 'utf8')).not.toContain('Invented sub report')
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

  it('reports a chat file that could not be saved and clears the error on the next save', () => {
    const base = makeTempDir('mr-save-error-')
    const runs = join(base, 'runs')
    const projectRoot = join(base, 'project')
    mkdirSync(runs, { recursive: true })
    mkdirSync(projectRoot, { recursive: true })
    const promptFile = join(base, 'orchestrator-agent.md')
    writeFileSync(promptFile, PROMPT)
    let failing = true
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => {}
    const orchestrator = createOrchestrator({
      projectRoot,
      runsFolder: runs,
      lanes: LANES,
      promptFile,
      spawn: () => child,
      rename: (from, to) => {
        if (failing) {
          const error = new Error('EPERM: operation not permitted')
          error.code = 'EPERM'
          throw error
        }
        renameSync(from, to)
      },
    })
    cleanups.push(async () => {
      orchestrator.close()
      await sleep(20)
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    })

    const sent = orchestrator.send({ text: 'Keep me', confirmed: true })

    expect(sent.status).toBe(202)
    expect(sent.body).toEqual({ id: sent.body.id, saveError: CHAT_SAVE_PROBLEM })
    expect(orchestrator.answer().saveError).toBe(CHAT_SAVE_PROBLEM)

    failing = false
    expect(orchestrator.setAutocompact({ on: true, confirmed: true }).status).toBe(200)
    expect(orchestrator.answer().saveError).toBeNull()
  })

  it('retries a failed rename on EPERM and EBUSY and removes the temporary on failure', () => {
    const rig = makeRig()
    rig.orchestrator.close()
    const file = chatFileFor(rig.projectRoot, rig.runs)
    const tmpFile = `${file}.tmp`

    let attempts = 0
    const renameRetryThenSucceed = (from, to) => {
      attempts += 1
      if (attempts < 3) {
        const error = new Error('EBUSY: resource busy or locked')
        error.code = 'EBUSY'
        throw error
      }
      renameSync(from, to)
    }

    const retryingOrchestrator = createOrchestrator({
      projectRoot: rig.projectRoot,
      runsFolder: rig.runs,
      lanes: rig.lanes,
      promptFile: rig.promptFile,
      rename: renameRetryThenSucceed,
    })
    cleanups.push(async () => retryingOrchestrator.close())
    expect(attempts).toBe(3)
    expect(existsSync(file)).toBe(true)
    expect(existsSync(tmpFile)).toBe(false)
    retryingOrchestrator.close()

    let failingAttempts = 0
    const renameAlwaysFails = () => {
      failingAttempts += 1
      const error = new Error('EPERM: operation not permitted')
      error.code = 'EPERM'
      throw error
    }

    const failingOrchestrator = createOrchestrator({
      projectRoot: rig.projectRoot,
      runsFolder: rig.runs,
      lanes: rig.lanes,
      promptFile: rig.promptFile,
      rename: renameAlwaysFails,
    })
    cleanups.push(async () => failingOrchestrator.close())
    expect(failingAttempts).toBe(5)
    expect(existsSync(tmpFile)).toBe(false)
    expect(failingOrchestrator.answer().saveError).toBe(CHAT_SAVE_PROBLEM)
    failingOrchestrator.close()
  })

  it('refuses a second orchestrator on the same project and takes a stale lock', () => {
    const rig = makeRig()
    const options = { projectRoot: rig.projectRoot, runsFolder: rig.runs, lanes: rig.lanes, promptFile: rig.promptFile }
    const lock = chatLockFileFor(rig.projectRoot, rig.runs)
    expect(readFileSync(lock, 'utf8')).toBe(String(process.pid))
    expect(() => createOrchestrator(options)).toThrow(
      `Another room is already running on this project (process ${process.pid}). Wait for it to end.`
    )
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
    writeFileSync(
      join(rig.runs, 'orchestrator-chat-20261025-120000-000.meta.json'),
      `${JSON.stringify({ project: rig.projectRoot, sessionId: 'session-1' })}\n`
    )
    const restored = restoreRig(rig)
    expect(restored.answer().state).toBe('idle')
    expect(restored.answer().messages.at(-1)).toMatchObject({ from: 'room', text: RESTART_MESSAGE })
    const records = recordsOf(rig)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ lane: 'orchestrator', log, exitCode: null, killed: true })
    expect(records[0].startedAt).toBe(new Date(2026, 9, 25, 12, 0, 0, 0).toISOString())
  })

  it('saves the active turn log name and recovers only that log when two projects share a runs folder', () => {
    const base = makeTempDir('mr-shared-recovery-')
    const runs = join(base, 'runs')
    const projectA = join(base, 'project-a')
    const projectB = join(base, 'project-b')
    mkdirSync(runs, { recursive: true })
    mkdirSync(projectA, { recursive: true })
    mkdirSync(projectB, { recursive: true })
    const promptFile = join(base, 'orchestrator-agent.md')
    writeFileSync(promptFile, PROMPT)
    const tA = new Date(2026, 9, 25, 12, 0, 0, 0).getTime()
    const tB = new Date(2026, 9, 25, 12, 5, 0, 0).getTime()
    let orchA = createOrchestrator({
      projectRoot: projectA,
      runsFolder: runs,
      lanes: LANES,
      promptFile,
      now: () => tA,
      spawn: () => emitterChild(),
    })
    let orchB = null
    let restoredA = null
    cleanups.push(async () => {
      orchA?.close()
      orchB?.close()
      restoredA?.close()
      await sleep(20)
      rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    })

    expect(orchA.send({ text: 'Job A', confirmed: true }).status).toBe(202)
    const chatA = JSON.parse(readFileSync(chatFileFor(projectA, runs), 'utf8'))
    expect(chatA.state).toBe('working')
    expect(chatA.turnLog).toBe('orchestrator-chat-20261025-120000-000.log')
    orchA.close()
    orchA = null

    orchB = createOrchestrator({
      projectRoot: projectB,
      runsFolder: runs,
      lanes: LANES,
      promptFile,
      now: () => tB,
      spawn: () => emitterChild(),
    })
    expect(orchB.send({ text: 'Job B', confirmed: true }).status).toBe(202)
    const chatB = JSON.parse(readFileSync(chatFileFor(projectB, runs), 'utf8'))
    expect(chatB.state).toBe('working')
    expect(chatB.turnLog).toBe('orchestrator-chat-20261025-120500-000.log')
    expect(readLines(join(runs, 'runs.jsonl'))).toHaveLength(0)

    restoredA = createOrchestrator({
      projectRoot: projectA,
      runsFolder: runs,
      lanes: LANES,
      promptFile,
      spawn: () => emitterChild(),
    })
    expect(restoredA.answer().state).toBe('idle')
    expect(restoredA.answer().messages.at(-1)).toMatchObject({ from: 'room', text: RESTART_MESSAGE })
    const afterA = JSON.parse(readFileSync(chatFileFor(projectA, runs), 'utf8'))
    expect(afterA.turnLog).toBeNull()

    const logA = join(runs, 'orchestrator-chat-20261025-120000-000.log')
    const logB = join(runs, 'orchestrator-chat-20261025-120500-000.log')
    const records = readLines(join(runs, 'runs.jsonl'))
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ lane: 'orchestrator', log: logA, exitCode: null, killed: true })
    expect(records[0].startedAt).toBe(new Date(tA).toISOString())
    expect(records.some((record) => record.log === logB)).toBe(false)
  })

  it('writes no record when a saved turn log is missing even if another project has an unfinished log', () => {
    const rig = makeRig()
    rig.orchestrator.close()
    const file = chatFileFor(rig.projectRoot, rig.runs)
    writeFileSync(
      file,
      `${JSON.stringify({
        project: rig.projectRoot,
        sessionId: 'session-1',
        state: 'working',
        turnLog: 'orchestrator-chat-20261025-120000-000.log',
        messages: [{ id: 'm1', from: 'owner', text: 'Build it', at: '2026-10-25T12:00:00.000Z' }],
        pending: [],
      })}\n`
    )
    writeFileSync(join(rig.runs, 'orchestrator-chat-20261025-120500-000.log'), 'other log\n')
    writeFileSync(
      join(rig.runs, 'orchestrator-chat-20261025-120500-000.meta.json'),
      `${JSON.stringify({ project: join(rig.base, 'other-project'), sessionId: 'session-2' })}\n`
    )
    const restored = restoreRig(rig)
    expect(restored.answer().state).toBe('idle')
    expect(restored.answer().messages.at(-1)).toMatchObject({ from: 'room', text: RESTART_MESSAGE })
    expect(recordsOf(rig)).toHaveLength(0)
  })

  it('filters old chat file recovery by metadata project and skips ambiguous or unattributed matches', () => {
    const rig = makeRig()
    rig.orchestrator.close()
    const file = chatFileFor(rig.projectRoot, rig.runs)
    const oldChat = {
      project: rig.projectRoot,
      sessionId: 'session-1',
      state: 'working',
      messages: [{ id: 'm1', from: 'owner', text: 'Build it', at: '2026-10-25T12:00:00.000Z' }],
      pending: [],
    }
    writeFileSync(file, `${JSON.stringify(oldChat)}\n`)

    const ownLog = join(rig.runs, 'orchestrator-chat-20261025-120000-000.log')
    const otherLog = join(rig.runs, 'orchestrator-chat-20261025-120500-000.log')
    const noMetaLog = join(rig.runs, 'orchestrator-chat-20261025-121000-000.log')
    writeFileSync(ownLog, 'own\n')
    writeFileSync(
      join(rig.runs, 'orchestrator-chat-20261025-120000-000.meta.json'),
      `${JSON.stringify({ project: rig.projectRoot, sessionId: 'session-1' })}\n`
    )
    writeFileSync(otherLog, 'other\n')
    writeFileSync(
      join(rig.runs, 'orchestrator-chat-20261025-120500-000.meta.json'),
      `${JSON.stringify({ project: join(rig.base, 'other-project'), sessionId: 'session-2' })}\n`
    )
    writeFileSync(noMetaLog, 'no meta\n')

    const first = restoreRig(rig)
    expect(first.answer().state).toBe('idle')
    expect(recordsOf(rig)).toHaveLength(1)
    expect(recordsOf(rig)[0]).toMatchObject({ lane: 'orchestrator', log: ownLog, exitCode: null, killed: true })
    first.orchestrator.close()

    rmSync(join(rig.runs, 'runs.jsonl'), { force: true })
    writeFileSync(file, `${JSON.stringify(oldChat)}\n`)
    const secondOwnLog = join(rig.runs, 'orchestrator-chat-20261025-121500-000.log')
    writeFileSync(secondOwnLog, 'second own\n')
    writeFileSync(
      join(rig.runs, 'orchestrator-chat-20261025-121500-000.meta.json'),
      `${JSON.stringify({ project: rig.projectRoot, sessionId: 'session-1' })}\n`
    )

    const second = restoreRig(rig)
    expect(second.answer().state).toBe('idle')
    expect(second.answer().messages.at(-1)).toMatchObject({ from: 'room', text: RESTART_MESSAGE })
    expect(recordsOf(rig)).toHaveLength(0)
    second.orchestrator.close()

    rmSync(ownLog, { force: true })
    rmSync(join(rig.runs, 'orchestrator-chat-20261025-120000-000.meta.json'), { force: true })
    rmSync(secondOwnLog, { force: true })
    rmSync(join(rig.runs, 'orchestrator-chat-20261025-121500-000.meta.json'), { force: true })
    writeFileSync(file, `${JSON.stringify(oldChat)}\n`)

    const third = restoreRig(rig)
    expect(third.answer().state).toBe('idle')
    expect(recordsOf(rig)).toHaveLength(0)
  })

  it('clears the saved turn log after a turn completes', async () => {
    const rig = makeRig()
    rig.send('Quick job')
    await waitIdle(rig, 1)
    expect(stateFile(rig).turnLog).toBeNull()
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
    await waitFor(
      () => orchestrator.answer().messages.some((message) => message.text.includes('cap-saved')),
      15000,
      'the refused cap turn message'
    )
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

describe('orchestrator reasoning effort and sessions', () => {
  it('passes effort to claude and opencode turns and rejects unknown levels', async () => {
    const claudeRig = makeRig()
    const setClaude = claudeRig.orchestrator.setEffort({ effort: 'xhigh', confirmed: true })
    expect(setClaude.status).toBe(200)
    expect(setClaude.body).toEqual({ id: 'orchestrator', effort: 'xhigh' })
    expect(claudeRig.orchestrator.answer().effort).toBe('xhigh')

    claudeRig.send('Claude effort turn')
    await waitIdle(claudeRig, 1)
    const claudeArgs = claudeRig.calls()[0].args
    expect(claudeArgs).toContain('--effort')
    expect(valueAfter(claudeArgs, '--effort')).toBe('xhigh')

    claudeRig.orchestrator.setEffort({ effort: null, confirmed: true })
    expect(claudeRig.orchestrator.answer().effort).toBeNull()

    const badClaude = claudeRig.orchestrator.setEffort({ effort: 'extreme', confirmed: true })
    expect(badClaude.status).toBe(400)
    expect(badClaude.body).toEqual({ error: EFFORT_PROBLEM })

    const unconfirmed = claudeRig.orchestrator.setEffort({ effort: 'high' })
    expect(unconfirmed.status).toBe(400)
    expect(unconfirmed.body).toEqual({ error: CONFIRM_EFFORT_PROBLEM })

    const opencodeRig = makeRig({ harness: 'opencode', lanes: OPENCODE_LANES })
    const setOpenCode = opencodeRig.orchestrator.setEffort({ effort: 'max', confirmed: true })
    expect(setOpenCode.status).toBe(200)
    expect(opencodeRig.orchestrator.answer().effort).toBe('max')

    opencodeRig.send('OpenCode effort turn')
    await waitIdle(opencodeRig, 1)
    const opencodeArgs = opencodeRig.calls()[0].args
    expect(valueAfter(opencodeArgs, '--model')).toBe('opencode-go/deepseek-v4.1-flash#max')

    const opencodeNoXhigh = opencodeRig.orchestrator.setEffort({ effort: 'xhigh', confirmed: true })
    expect(opencodeNoXhigh.status).toBe(400)
  })

  it('refuses a model or effort change while a turn runs and credits the turn to its own model', async () => {
    const rig = makeRig()
    rig.behaviour.mode = 'hold'
    rig.send('A running turn')
    await waitFor(() => rig.calls().length === 1, 5000, 'the held turn')

    expect(rig.orchestrator.setModel({ model: 'claude-sonnet-5-5', confirmed: true })).toEqual({
      status: 409,
      body: { error: COMPACT_RUNNING_PROBLEM },
    })
    expect(rig.orchestrator.setEffort({ effort: 'high', confirmed: true })).toEqual({
      status: 409,
      body: { error: COMPACT_RUNNING_PROBLEM },
    })

    writeFileSync(rig.releaseFile, 'go')
    await waitIdle(rig, 1)
    expect(rig.answer().model).toBe('opus')
    expect(recordsOf(rig).at(-1)).toMatchObject({ model: 'opus' })
  })

  it('archives sessions, lists pinned first, resumes an open session, and updates fields', async () => {
    const rig = makeRig()
    rig.send('First conversation task')
    await waitIdle(rig, 1)

    const firstSessionId = valueAfter(rig.calls()[0].args, '--session-id')
    expect(rig.orchestrator.currentSessionInfo().title).toBe('First conversation task')

    const created = rig.orchestrator.newSession({ confirmed: true })
    expect(created.status).toBe(200)
    expect(rig.orchestrator.answer().messages).toHaveLength(0)

    const list1 = rig.orchestrator.listSessions()
    expect(list1).toHaveLength(1)
    expect(list1[0].title).toBe('First conversation task')
    expect(list1[0].count).toBe(2)

    rig.send('Second conversation task that is much longer to test the sixty character title cutting limit')
    await waitIdle(rig, 2)
    const secondSessionId = valueAfter(rig.calls()[1].args, '--session-id')
    expect(secondSessionId).not.toBe(firstSessionId)

    rig.orchestrator.newSession({ confirmed: true })
    const list2 = rig.orchestrator.listSessions()
    expect(list2).toHaveLength(2)
    expect(list2[0].title).toBe('Second conversation task that is much longer to test the six')
    expect(list2[0].title).toHaveLength(60)

    const updated = rig.orchestrator.updateSession(list1[0].id, {
      title: 'Renamed first task',
      pinned: true,
      starred: true,
      confirmed: true,
    })
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({ title: 'Renamed first task', pinned: true, starred: true })

    const list3 = rig.orchestrator.listSessions()
    expect(list3[0].id).toBe(list1[0].id)
    expect(list3[0].pinned).toBe(true)

    const opened = rig.orchestrator.openSession(list1[0].id, { confirmed: true })
    expect(opened.status).toBe(200)
    expect(rig.orchestrator.answer().messages).toHaveLength(2)

    rig.send('Resume first conversation')
    await waitIdle(rig, 3)
    const thirdArgs = rig.calls()[2].args
    expect(thirdArgs).toContain('--resume')
    expect(valueAfter(thirdArgs, '--resume')).toBe(firstSessionId)

    const single = rig.orchestrator.getSession(list2[0].id)
    expect(single.status).toBe(200)
    expect(single.body.id).toBe(list2[0].id)
    expect(Array.isArray(single.body.messages)).toBe(true)

    const deleted = rig.orchestrator.deleteSession(list2[0].id, { confirmed: true })
    expect(deleted.status).toBe(200)
    expect(rig.orchestrator.listSessions().some((s) => s.id === list2[0].id)).toBe(false)
  })

  it('keeps unread and archived beside pinned, clears unread when opened, and locks the current row', async () => {
    const rig = makeRig()
    rig.send('First conversation')
    await waitIdle(rig, 1)
    rig.orchestrator.newSession({ confirmed: true })
    const first = rig.orchestrator.listSessions()[0]
    expect(first).toMatchObject({ pinned: false, starred: false, unread: false, archived: false })

    expect(rig.orchestrator.updateSession(first.id, { unread: true, confirmed: true }).body).toMatchObject({
      unread: true,
      archived: false,
    })
    expect(rig.orchestrator.updateSession(first.id, { archived: true, confirmed: true }).status).toBe(200)
    expect(rig.orchestrator.listSessions()[0]).toMatchObject({ unread: true, archived: true })

    rig.orchestrator.close()
    const restored = restoreRig(rig)
    expect(restored.orchestrator.listSessions()[0]).toMatchObject({ unread: true, archived: true })

    expect(restored.orchestrator.openSession(first.id, { confirmed: true }).status).toBe(200)
    expect(restored.orchestrator.listSessions()[0]).toMatchObject({ unread: false, archived: false })

    expect(restored.orchestrator.updateSession(first.id, { archived: true, confirmed: true })).toEqual({
      status: 409,
      body: { error: CURRENT_SESSION_PROBLEM },
    })
    expect(restored.orchestrator.updateSession(first.id, { unread: 'yes', confirmed: true })).toEqual({
      status: 400,
      body: { error: SESSION_UNREAD_PROBLEM },
    })
    expect(restored.orchestrator.updateSession(first.id, { archived: 'yes', confirmed: true })).toEqual({
      status: 400,
      body: { error: SESSION_ARCHIVED_PROBLEM },
    })
  })

  it('pins, renames and marks the current conversation from its own row', async () => {
    const rig = makeRig()
    rig.send('Live conversation')
    await waitIdle(rig, 1)
    expect(rig.orchestrator.currentSessionInfo()).toMatchObject({
      id: CURRENT_SESSION_KEY,
      pinned: false,
      unread: false,
    })

    const changed = rig.orchestrator.updateSession(CURRENT_SESSION_KEY, {
      title: 'Live renamed',
      pinned: true,
      unread: true,
      confirmed: true,
    })
    expect(changed.status).toBe(200)
    expect(changed.body).toMatchObject({
      id: CURRENT_SESSION_KEY,
      title: 'Live renamed',
      pinned: true,
      unread: true,
      archived: false,
    })
    expect(rig.orchestrator.currentSessionInfo()).toMatchObject({
      id: CURRENT_SESSION_KEY,
      title: 'Live renamed',
      pinned: true,
      unread: true,
    })

    expect(rig.orchestrator.updateSession(CURRENT_SESSION_KEY, { archived: true, confirmed: true })).toEqual({
      status: 409,
      body: { error: CURRENT_SESSION_PROBLEM },
    })
    expect(rig.orchestrator.deleteSession(CURRENT_SESSION_KEY, { confirmed: true })).toEqual({
      status: 409,
      body: { error: CURRENT_SESSION_PROBLEM },
    })
    expect(rig.orchestrator.updateSession(CURRENT_SESSION_KEY, { archived: 'yes', confirmed: true })).toEqual({
      status: 400,
      body: { error: SESSION_ARCHIVED_PROBLEM },
    })

    rig.orchestrator.newSession({ confirmed: true })
    expect(rig.orchestrator.listSessions()[0]).toMatchObject({
      title: 'Live renamed',
      pinned: true,
      unread: true,
      archived: false,
    })
  })

  it('takes the current row flags and title from its saved record on restore', async () => {
    const rig = makeRig()
    rig.send('First conversation')
    await waitIdle(rig, 1)
    rig.orchestrator.newSession({ confirmed: true })
    const first = rig.orchestrator.listSessions()[0]
    expect(rig.orchestrator.openSession(first.id, { confirmed: true }).status).toBe(200)
    expect(
      rig.orchestrator.updateSession(CURRENT_SESSION_KEY, {
        title: 'Kept title',
        pinned: true,
        unread: true,
        confirmed: true,
      }).status
    ).toBe(200)
    rig.orchestrator.close()

    const file = chatFileFor(rig.projectRoot, rig.runs)
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    delete saved.currentTitle
    delete saved.currentPinned
    delete saved.currentStarred
    delete saved.currentUnread
    writeFileSync(file, `${JSON.stringify(saved)}\n`)

    const restored = restoreRig(rig)
    expect(restored.orchestrator.currentSessionInfo()).toMatchObject({
      id: CURRENT_SESSION_KEY,
      title: 'Kept title',
      pinned: true,
      unread: true,
    })
    expect(restored.orchestrator.newSession({ confirmed: true }).status).toBe(200)
    expect(restored.orchestrator.listSessions()[0]).toMatchObject({
      id: first.id,
      title: 'Kept title',
      pinned: true,
      unread: true,
      archived: false,
    })
  })

  it('keeps the current conversation id across restarts and the 200-message cap and rotates it on new, open, and branch', async () => {
    const rig = makeRig()
    const initialId = rig.orchestrator.currentSessionInfo().sessionId
    expect(typeof initialId).toBe('string')
    expect(initialId.length).toBeGreaterThan(0)

    rig.send('Start conversation')
    await waitIdle(rig, 1)
    expect(rig.orchestrator.currentSessionInfo().sessionId).toBe(initialId)

    expect(rig.orchestrator.updateSession(CURRENT_SESSION_KEY, { title: 'Pinned name', confirmed: true }).status).toBe(200)
    expect(rig.orchestrator.currentSessionInfo().sessionId).toBe(initialId)
    rig.orchestrator.close()

    const file = chatFileFor(rig.projectRoot, rig.runs)
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved.currentConversationId).toBe(initialId)
    const padded = []
    for (let index = 0; index < 198; index += 1) {
      const at = new Date(Date.UTC(2026, 9, 20, 0, Math.floor(index / 60), index % 60)).toISOString()
      padded.push({
        id: `pad-${index}`,
        from: index % 2 === 0 ? 'owner' : 'orchestrator',
        text: `History ${index}`,
        at,
      })
    }
    saved.messages = [...padded, ...saved.messages]
    writeFileSync(file, `${JSON.stringify(saved)}\n`)

    const restored = restoreRig(rig)
    expect(restored.orchestrator.answer().messages).toHaveLength(200)
    const beforeCap = restored.orchestrator.currentSessionInfo()
    expect(beforeCap.sessionId).toBe(initialId)

    restored.orchestrator.send({ text: 'Turn past limit', confirmed: true })
    await waitIdle(restored, 1)
    const afterCap = restored.orchestrator.currentSessionInfo()
    expect(restored.orchestrator.answer().messages).toHaveLength(200)
    expect(afterCap.startedAt).not.toBe(beforeCap.startedAt)
    expect(afterCap.sessionId).toBe(initialId)

    expect(restored.orchestrator.newSession({ confirmed: true }).status).toBe(200)
    const afterNew = restored.orchestrator.currentSessionInfo().sessionId
    expect(typeof afterNew).toBe('string')
    expect(afterNew.length).toBeGreaterThan(0)
    expect(afterNew).not.toBe(initialId)

    restored.orchestrator.send({ text: 'Second conversation', confirmed: true })
    await waitIdle(restored, 2)
    expect(restored.orchestrator.currentSessionInfo().sessionId).toBe(afterNew)

    const firstArchived = restored.orchestrator.listSessions()[0]
    expect(restored.orchestrator.openSession(firstArchived.id, { confirmed: true }).status).toBe(200)
    const afterOpen = restored.orchestrator.currentSessionInfo().sessionId
    expect(typeof afterOpen).toBe('string')
    expect(afterOpen.length).toBeGreaterThan(0)
    expect(afterOpen).not.toBe(afterNew)
    expect(afterOpen).not.toBe(initialId)

    const branchResult = restored.orchestrator.branchSession({ index: 1, confirmed: true })
    expect(branchResult.status).toBe(200)
    const afterBranch = restored.orchestrator.currentSessionInfo().sessionId
    expect(typeof afterBranch).toBe('string')
    expect(afterBranch.length).toBeGreaterThan(0)
    expect(afterBranch).not.toBe(afterOpen)
    expect(afterBranch).not.toBe(afterNew)
    expect(afterBranch).not.toBe(initialId)
  })

  it('refuses a session switch while messages wait and archives a conversation with no owner line', async () => {
    const rig = makeRig()
    rig.send('Start')
    await waitIdle(rig, 1)
    rig.orchestrator.stop({ confirmed: true })
    const log = join(rig.runs, 'opencode7-waiting-1.log')
    writeFileSync(log, 'done\n')
    appendFileSync(
      join(rig.runs, 'runs.jsonl'),
      `${JSON.stringify({ lane: 'opencode7', model: 'm', startedAt: '2026-10-30T12:00:00.000Z', minutes: 1, exitCode: 0, killed: false, log })}\n`
    )
    rig.orchestrator.onFrame(frame('run-opencode7-waiting-1', 'succeeded'))
    expect(rig.orchestrator.newSession({ confirmed: true })).toEqual({
      status: 409,
      body: { error: SESSION_PENDING_PROBLEM },
    })
    expect(rig.answer().messages.some((message) => message.text.includes('Run opencode7-waiting-1'))).toBe(true)
    rig.orchestrator.close()

    const file = chatFileFor(rig.projectRoot, rig.runs)
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    saved.messages = [{ id: 'm1', from: 'room', text: 'A room wake', at: '2026-10-25T12:00:00.000Z' }]
    saved.pending = []
    saved.state = 'idle'
    writeFileSync(file, `${JSON.stringify(saved)}\n`)
    const restored = restoreRig(rig)
    expect(restored.orchestrator.newSession({ confirmed: true }).status).toBe(200)
    const list = restored.orchestrator.listSessions()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('A room wake')
    expect(list[0].count).toBe(1)
  })

  it('refuses to delete the open conversation until another starts', async () => {
    const rig = makeRig()
    rig.send('The conversation to delete')
    await waitIdle(rig, 1)
    rig.orchestrator.newSession({ confirmed: true })
    const archived = rig.orchestrator.listSessions()[0]
    expect(rig.orchestrator.openSession(archived.id, { confirmed: true }).status).toBe(200)
    expect(rig.answer().messages).toHaveLength(2)

    expect(rig.orchestrator.deleteSession(archived.id, { confirmed: true })).toEqual({
      status: 409,
      body: { error: CURRENT_SESSION_PROBLEM },
    })
    expect(rig.orchestrator.listSessions()).toHaveLength(1)
    expect(rig.answer().messages).toHaveLength(2)

    rig.orchestrator.newSession({ confirmed: true })
    expect(rig.orchestrator.deleteSession(archived.id, { confirmed: true }).status).toBe(200)
    expect(rig.orchestrator.listSessions()).toHaveLength(0)
    expect(rig.answer().messages).toHaveLength(0)

    rig.send('A new clean start')
    await waitIdle(rig, 2)
    expect(rig.calls()[1].args).not.toContain('--resume')
    expect(rig.calls()[1].args).toContain('--session-id')

    rig.orchestrator.newSession({ confirmed: true })
    const list = rig.orchestrator.listSessions()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('A new clean start')
  })

  it('evicts the oldest unpinned session when reaching 50 sessions', async () => {
    const rig = makeRig()
    const filePath = chatFileFor(rig.projectRoot, rig.runs)
    const initialSessions = []
    const baseTime = Date.now() - 100000000
    for (let index = 0; index < 50; index += 1) {
      initialSessions.push({
        id: `sess-${index}`,
        title: `Session ${index}`,
        startedAt: new Date(baseTime + index * 60000).toISOString(),
        endedAt: new Date(baseTime + index * 60000 + 30000).toISOString(),
        pinned: index === 0,
        starred: false,
        sessionId: `ses_${index}`,
        opencodeSessionId: null,
        summary: '',
        messages: [{ id: `m-${index}`, from: 'owner', text: `Session ${index}`, at: new Date().toISOString() }],
      })
    }
    rig.orchestrator.close()
    const state = JSON.parse(readFileSync(filePath, 'utf8'))
    state.sessions = initialSessions
    writeFileSync(filePath, JSON.stringify(state, null, 2))

    const restored = restoreRig(rig)
    expect(restored.orchestrator.listSessions()).toHaveLength(50)

    restored.orchestrator.send({ text: 'One more session to trigger eviction', confirmed: true })
    await waitIdle(restored, 1, 25000)
    const archived = restored.orchestrator.newSession({ confirmed: true })
    expect(archived.status).toBe(200)

    const list = restored.orchestrator.listSessions()
    expect(list).toHaveLength(50)
    expect(list.some((s) => s.id === 'sess-0')).toBe(true)
    expect(list.some((s) => s.id === 'sess-1')).toBe(false)
  }, 30000)

  it('refuses a new session when the saved list is full of pinned conversations', () => {
    const rig = makeRig()
    const baseTime = Date.now() - 100000000
    const currentAt = new Date().toISOString()
    seedChat(rig, {
      sessions: Array.from({ length: 50 }, (_, index) => pinnedSession(index, baseTime)),
      messages: [
        { id: 'current-owner', from: 'owner', text: 'Keep this conversation', at: currentAt },
        { id: 'current-reply', from: 'orchestrator', text: 'Reply: Keep this conversation', at: currentAt },
      ],
    })
    const restored = restoreRig(rig)
    expect(restored.orchestrator.listSessions()).toHaveLength(50)
    expect(restored.orchestrator.answer().messages).toHaveLength(2)

    expect(restored.orchestrator.newSession({ confirmed: true })).toEqual({
      status: 409,
      body: { error: SESSIONS_FULL_PROBLEM },
    })
    expect(restored.orchestrator.answer().messages.map((m) => m.id)).toEqual([
      'current-owner',
      'current-reply',
    ])
    expect(restored.orchestrator.currentSessionInfo()).toMatchObject({
      title: 'Keep this conversation',
      count: 2,
    })
    const list = restored.orchestrator.listSessions()
    expect(list).toHaveLength(50)
    expect(list.some((s) => s.title === 'Keep this conversation')).toBe(false)
  })

  it('drops an older unpinned conversation to archive when the rest are pinned', () => {
    const rig = makeRig()
    const baseTime = Date.now() - 100000000
    const currentAt = new Date().toISOString()
    const older = {
      ...pinnedSession(0, baseTime),
      id: 'older-unpinned',
      title: 'Older unpinned',
      startedAt: new Date(baseTime - 60000).toISOString(),
      endedAt: new Date(baseTime - 30000).toISOString(),
      pinned: false,
      sessionId: 'ses_older',
      messages: [
        {
          id: 'older-message',
          from: 'owner',
          text: 'Older unpinned',
          at: new Date(baseTime - 60000).toISOString(),
        },
      ],
    }
    seedChat(rig, {
      sessions: [...Array.from({ length: 49 }, (_, index) => pinnedSession(index, baseTime)), older],
      messages: [{ id: 'current-owner', from: 'owner', text: 'Keep this conversation', at: currentAt }],
    })
    const restored = restoreRig(rig)
    expect(restored.orchestrator.listSessions()).toHaveLength(50)

    expect(restored.orchestrator.newSession({ confirmed: true }).status).toBe(200)
    const list = restored.orchestrator.listSessions()
    expect(list).toHaveLength(50)
    expect(list.some((s) => s.id === 'older-unpinned')).toBe(false)
    expect(list.some((s) => s.title === 'Keep this conversation')).toBe(true)
    expect(restored.orchestrator.answer().messages).toHaveLength(0)
  })

  it('refuses to open or branch when the saved list is full of pinned conversations', () => {
    const rig = makeRig()
    const baseTime = Date.now() - 100000000
    const currentAt = new Date().toISOString()
    seedChat(rig, {
      sessions: Array.from({ length: 50 }, (_, index) => pinnedSession(index, baseTime)),
      messages: [
        { id: 'current-owner', from: 'owner', text: 'Keep this conversation', at: currentAt },
        { id: 'current-reply', from: 'orchestrator', text: 'Reply: Keep this conversation', at: currentAt },
      ],
    })
    const restored = restoreRig(rig)
    const before = restored.orchestrator.currentSessionInfo()

    expect(restored.orchestrator.openSession('pinned-7', { confirmed: true })).toEqual({
      status: 409,
      body: { error: SESSIONS_FULL_PROBLEM },
    })
    expect(restored.orchestrator.answer().messages.map((m) => m.id)).toEqual([
      'current-owner',
      'current-reply',
    ])
    expect(restored.orchestrator.currentSessionInfo()).toMatchObject({
      sessionId: before.sessionId,
      title: 'Keep this conversation',
      count: 2,
    })

    expect(restored.orchestrator.branchSession({ index: 2, confirmed: true })).toEqual({
      status: 409,
      body: { error: SESSIONS_FULL_PROBLEM },
    })
    expect(restored.orchestrator.answer().messages.map((m) => m.id)).toEqual([
      'current-owner',
      'current-reply',
    ])
    expect(restored.orchestrator.currentSessionInfo()).toMatchObject({
      sessionId: before.sessionId,
      title: 'Keep this conversation',
      count: 2,
    })
    expect(restored.orchestrator.listSessions()).toHaveLength(50)
    expect(restored.orchestrator.listSessions().some((s) => s.title.endsWith('(branch)'))).toBe(false)
  })

  it('keeps a quoted transcript inside the prompt budget', () => {
    const sample = quotedTranscript([
      { from: 'owner', text: 'Build the page.' },
      { from: 'orchestrator', text: 'It is built.' },
    ])
    expect(sample).toContain(BRANCH_TRANSCRIPT_INTRO)
    expect(sample).toContain('> Owner: Build the page.')
    expect(sample).toContain('> Orchestrator: It is built.')

    const many = Array.from({ length: 60 }, (_, index) => ({
      from: index % 2 === 0 ? 'owner' : 'orchestrator',
      text: `Message ${index} ${'x'.repeat(1200)}`,
    }))
    const text = quotedTranscript(many)
    expect(text.length).toBeLessThanOrEqual(BRANCH_TRANSCRIPT_LIMIT)
    expect(text).toContain('Message 59')
    expect(text).not.toContain('Message 0 ')
  })

  it('branches a conversation and quotes its earlier messages for a fresh session', async () => {
    const rig = makeRig()
    rig.send('First task')
    await waitIdle(rig, 1)
    rig.send('Second task')
    await waitIdle(rig, 2)
    expect(rig.answer().messages).toHaveLength(4)

    expect(rig.orchestrator.branchSession({ index: 1 })).toEqual({
      status: 400,
      body: { error: CONFIRM_SESSION_PROBLEM },
    })
    expect(rig.orchestrator.branchSession({ index: 0, confirmed: true })).toEqual({
      status: 400,
      body: { error: BRANCH_INDEX_PROBLEM },
    })
    expect(rig.orchestrator.branchSession({ index: 9, confirmed: true })).toEqual({
      status: 400,
      body: { error: BRANCH_INDEX_PROBLEM },
    })

    const branched = rig.orchestrator.branchSession({ index: 3, confirmed: true })
    expect(branched.status).toBe(200)
    expect(branched.body).toMatchObject({ ok: true, title: 'First task (branch)', count: 3 })
    expect(rig.answer().messages).toHaveLength(3)
    expect(rig.orchestrator.listSessions()).toHaveLength(1)
    expect(rig.orchestrator.listSessions()[0]).toMatchObject({ title: 'First task', count: 4 })

    rig.send('Carry on')
    await waitIdle(rig, 3)
    const args = rig.calls()[2].args
    expect(args).toContain('--session-id')
    expect(args).not.toContain('--resume')
    const prompt = valueAfter(args, '-p')
    expect(prompt).toContain(BRANCH_TRANSCRIPT_INTRO)
    expect(prompt).toContain('> Owner: First task')
    expect(prompt).toContain('> Orchestrator: Reply: First task')
    expect(prompt).toContain('> Owner: Second task')
    expect(prompt.endsWith('Carry on')).toBe(true)
  })

  it('keeps a branch transcript when another conversation opens first', async () => {
    const rig = makeRig()
    rig.send('First task')
    await waitIdle(rig, 1)
    expect(rig.orchestrator.branchSession({ index: 2, confirmed: true }).status).toBe(200)
    expect(rig.orchestrator.newSession({ confirmed: true }).status).toBe(200)
    const branch = rig.orchestrator.listSessions().find((entry) => entry.title === 'First task (branch)')
    expect(branch).toBeDefined()
    rig.orchestrator.close()

    const restored = restoreRig(rig)
    expect(restored.orchestrator.openSession(branch.id, { confirmed: true }).status).toBe(200)
    restored.orchestrator.send({ text: 'Carry on', confirmed: true })
    await waitIdle(restored, 1)
    const firstPrompt = valueAfter(restored.calls()[0].args, '-p')
    expect(firstPrompt).toContain(BRANCH_TRANSCRIPT_INTRO)
    expect(firstPrompt).toContain('> Owner: First task')
    expect(firstPrompt).toContain('> Orchestrator: Reply: First task')
    expect(firstPrompt.endsWith('Carry on')).toBe(true)

    restored.orchestrator.send({ text: 'Once more', confirmed: true })
    await waitIdle(restored, 2)
    const secondPrompt = valueAfter(restored.calls()[1].args, '-p')
    expect(secondPrompt).not.toContain(BRANCH_TRANSCRIPT_INTRO)
    expect(secondPrompt.endsWith('Once more')).toBe(true)
  })

  it('keeps a branch transcript when the first start fails', async () => {
    const branch = branchSetup('mr-branch-start-error-')
    const argsSeen = []
    let calls = 0
    const spawnFake = (file, args, options) => {
      calls += 1
      argsSeen.push([...args])
      if (calls === 1) {
        return spawn(join(branch.projectRoot, 'no-such-agent.exe'), [], options)
      }
      const child = emitterChild()
      setTimeout(() => {
        child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }) + '\n')
        child.stdout.write(
          JSON.stringify({ type: 'result', subtype: 'success', result: 'Carried on.', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n'
        )
        child.emit('close', 0)
      }, 10)
      return child
    }
    const orchestrator = branch.make(spawnFake)

    expect(orchestrator.send({ text: 'Carry on', confirmed: true }).status).toBe(202)
    await waitFor(() => calls === 1 && orchestrator.answer().state === 'idle', 5000, 'the failed start')
    const saved = JSON.parse(readFileSync(branch.conversation, 'utf8'))
    expect(saved.branchTranscript).toBe(branch.transcript)
    expect(saved.sessionId).toBe(null)
    expect(valueAfter(argsSeen[0], '-p')).toContain(BRANCH_TRANSCRIPT_INTRO)

    expect(orchestrator.send({ text: 'Try again', confirmed: true }).status).toBe(202)
    await waitFor(() => calls === 2 && orchestrator.answer().state === 'idle', 5000, 'the retried start')
    const retried = valueAfter(argsSeen[1], '-p')
    expect(argsSeen[1]).toContain('--session-id')
    expect(argsSeen[1]).not.toContain('--resume')
    expect(retried).toContain(BRANCH_TRANSCRIPT_INTRO)
    expect(retried).toContain('> Owner: First task')
    expect(retried.endsWith('Try again')).toBe(true)
    const after = JSON.parse(readFileSync(branch.conversation, 'utf8'))
    expect(after.branchTranscript).toBeUndefined()
  })

  it('clears a provisional session id when setup fails and carries the transcript next time', async () => {
    const branch = branchSetup('mr-branch-setup-error-')
    const argsSeen = []
    let calls = 0
    const spawnFake = (file, args, options) => {
      calls += 1
      argsSeen.push([...args])
      const child = emitterChild()
      setTimeout(() => {
        child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }) + '\n')
        child.stdout.write(
          JSON.stringify({ type: 'result', subtype: 'success', result: 'Carried on.', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n'
        )
        child.emit('close', 0)
      }, 10)
      return child
    }
    const orchestrator = branch.make(spawnFake)
    const blocker = join(branch.runs, 'scratch-orchestrator')
    writeFileSync(blocker, 'not a folder')
    expect(orchestrator.send({ text: 'Carry on', confirmed: true }).status).toBe(202)
    await waitFor(() => orchestrator.answer().state === 'idle', 5000, 'the failed setup')
    expect(calls).toBe(0)
    const saved = JSON.parse(readFileSync(branch.conversation, 'utf8'))
    expect(saved.sessionId).toBe(null)
    expect(saved.branchTranscript).toBe(branch.transcript)

    rmSync(blocker, { force: true })
    expect(orchestrator.send({ text: 'Try again', confirmed: true }).status).toBe(202)
    await waitFor(() => calls === 1 && orchestrator.answer().state === 'idle', 5000, 'the retried start')
    expect(argsSeen[0]).toContain('--session-id')
    expect(argsSeen[0]).not.toContain('--resume')
    const retried = valueAfter(argsSeen[0], '-p')
    expect(retried).toContain(BRANCH_TRANSCRIPT_INTRO)
    expect(retried).toContain('> Owner: First task')
    expect(retried.endsWith('Try again')).toBe(true)
  })

  it('clears a branch transcript once its first child starts', async () => {
    const branch = branchSetup('mr-branch-start-clear-')
    const children = []
    const argsSeen = []
    const spawnFake = (file, args) => {
      argsSeen.push([...args])
      const child = emitterChild()
      children.push(child)
      return child
    }
    const orchestrator = branch.make(spawnFake)

    expect(orchestrator.send({ text: 'Carry on', confirmed: true }).status).toBe(202)
    const first = children[0]
    expect(valueAfter(argsSeen[0], '-p')).toContain(BRANCH_TRANSCRIPT_INTRO)
    expect(JSON.parse(readFileSync(branch.conversation, 'utf8')).branchTranscript).toBe(branch.transcript)
    first.emit('spawn')
    await waitFor(
      () => JSON.parse(readFileSync(branch.conversation, 'utf8')).branchTranscript === undefined,
      5000,
      'the started branch to clear'
    )
    expect(orchestrator.answer().state).toBe('working')
    first.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }) + '\n')
    first.stdout.write(
      JSON.stringify({ type: 'result', subtype: 'success', result: 'Carried on.', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n'
    )
    first.emit('close', 0)
    await waitFor(() => orchestrator.answer().state === 'idle', 5000, 'the first turn')
    expect(JSON.parse(readFileSync(branch.conversation, 'utf8')).branchTranscript).toBeUndefined()

    expect(orchestrator.send({ text: 'Once more', confirmed: true }).status).toBe(202)
    const second = children[1]
    second.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake' }) + '\n')
    second.stdout.write(
      JSON.stringify({ type: 'result', subtype: 'success', result: 'Done.', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n'
    )
    second.emit('close', 0)
    await waitFor(() => orchestrator.answer().state === 'idle', 5000, 'the second turn')
    expect(valueAfter(argsSeen[1], '-p')).not.toContain(BRANCH_TRANSCRIPT_INTRO)
  })

  it('refuses a branch while a turn runs', async () => {
    const rig = makeRig()
    rig.behaviour.mode = 'hold'
    rig.send('Active running task')
    await waitFor(() => rig.calls().length === 1)
    expect(rig.orchestrator.branchSession({ index: 1, confirmed: true })).toEqual({
      status: 409,
      body: { error: COMPACT_RUNNING_PROBLEM },
    })
    writeFileSync(rig.releaseFile, 'go')
    await waitIdle(rig, 1)
  })

  it('refuses new and open while a turn runs with 409', async () => {
    const rig = makeRig()
    rig.behaviour.mode = 'hold'
    rig.send('Active running task')
    await waitFor(() => rig.calls().length === 1)

    const newAttempt = rig.orchestrator.newSession({ confirmed: true })
    expect(newAttempt.status).toBe(409)
    expect(newAttempt.body).toEqual({ error: COMPACT_RUNNING_PROBLEM })

    const openAttempt = rig.orchestrator.openSession('some-id', { confirmed: true })
    expect(openAttempt.status).toBe(409)
    expect(openAttempt.body).toEqual({ error: COMPACT_RUNNING_PROBLEM })

    writeFileSync(rig.releaseFile, 'go')
    await waitIdle(rig, 1)
  })
})

describe('the orchestrator routes', () => {
  it('refuses a message without a confirmation, a bad text and a stop without a confirmation', async () => {
    const rig = makeRig()
    rig.orchestrator.close()
    const bridge = createBridge({
      projectRoot: rig.projectRoot,
      port: 0,
      env: {},
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
      error: CONFIRM_MESSAGE_PROBLEM,
    })
    expect((await pagePostJson(`${url}/api/orchestrator/messages`, { text: 'Build it', confirmed: false })).status).toBe(400)
    expect((await pagePostJson(`${url}/api/orchestrator/messages`, { text: '   ', confirmed: true })).body).toEqual({
      error: MESSAGE_PROBLEM,
    })
    expect((await pagePostJson(`${url}/api/orchestrator/messages`, { text: 'x'.repeat(8001), confirmed: true })).status).toBe(400)
    expect((await pagePostJson(`${url}/api/orchestrator/messages`, { text: 42, confirmed: true })).status).toBe(400)
    expect((await pagePostJson(`${url}/api/orchestrator/stop`, {})).body).toEqual({
      error: CONFIRM_STOP_PROBLEM,
    })
    expect((await pagePostJson(`${url}/api/orchestrator/stop`, { confirmed: true })).body).toEqual({ ok: true })
    expect((await getJson(`${url}/api/orchestrator`)).body.state).toBe('paused')
  })

  it('adds the orchestrator mask count to the health masked total', async () => {
    const rig = makeRig()
    rig.orchestrator.close()
    const bridge = createBridge({
      projectRoot: rig.projectRoot,
      port: 0,
      env: {},
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
      projectRoot: '',
      port: 0,
      env: {},
      lanesSource: { folder: rig.runs, lanes: LANES, pollMs: 20, quietMs: 60000 },
      orchestratorSpawn: () => {
        throw new Error('No turn should start in this test.')
      },
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()
    expect((await pagePostJson(`${url}/api/orchestrator/messages`, { text: 'Build it', confirmed: true })).status).toBe(409)
    expect((await getJson(`${url}/api/orchestrator`)).body.project).toBe('')

    const off = createBridge({ projectRoot: rig.projectRoot, port: 0, env: {} })
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

  describe('the context window', () => {
    it('uses the model contextWindow when listed in models.js', () => {
      const rig = makeRig({ model: 'claude-haiku-5-5' })
      expect(rig.answer().contextWindow).toBe(1000000)
    })

    it('falls back to cli.contextWindow or 200000 when model has no window listed', () => {
      const rigWithLaneWindow = makeRig({
        model: 'opus',
        lanes: {
          orchestrator: {
            name: 'Orchestrator',
            harness: 'Claude Code',
            cli: { harness: 'claude', bin: 'claude', model: 'opus', contextWindow: 350000 },
          },
        },
      })
      expect(rigWithLaneWindow.answer().contextWindow).toBe(350000)

      const rigDefault = makeRig({
        model: 'opus',
        lanes: {
          orchestrator: {
            name: 'Orchestrator',
            harness: 'Claude Code',
            cli: { harness: 'claude', bin: 'claude', model: 'opus' },
          },
        },
      })
      expect(rigDefault.answer().contextWindow).toBe(200000)
    })

    it('starts the first turn of a sub on an order from the main orchestrator, and not on a room message', async () => {
      const rig = makeRig({ id: 'team-1' })
      rig.orchestrator.deliver('room', 'A lane ended.')
      await sleep(200)
      expect(rig.spawned).toHaveLength(0)
      rig.orchestrator.deliver('orchestrator', 'Add slugify to src/text.js.')
      await waitFor(() => rig.spawned.length === 1, 15000, 'the sub turn to spawn')
    })

    it('fills the scratch folder from its own id for a sub', async () => {
      const guide = readFileSync(new URL('../docs/agents/ORCHESTRATOR-AGENT.md', import.meta.url), 'utf8')
      const rig = makeRig({ id: 'frontend', prompt: guide })
      rig.orchestrator.deliver('orchestrator', 'Add a button.')
      await waitFor(() => rig.spawned.length === 1, 15000, 'the sub turn to spawn')
      const instruction = valueAfter(rig.spawned[0].args, '--append-system-prompt')
      expect(instruction).toContain(join(rig.runs, 'scratch-frontend'))
      expect(existsSync(join(rig.runs, 'scratch-frontend'))).toBe(true)
    })

    it('runs the program of its new harness after a harness change', async () => {
      const rig = makeRig({
        lanes: {
          orchestrator: { name: 'Orchestrator', harness: 'Claude Code', cli: { harness: 'claude', bin: 'claude-program', model: 'opus' } },
          opencode: { name: 'OpenCode', harness: 'OpenCode', cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/qwen3.8-flash' } },
        },
      })
      expect(rig.orchestrator.setHarness({ harness: 'opencode', model: 'opencode-go/qwen3.8-flash', confirmed: true }).status).toBe(200)
      rig.send('Hello')
      await waitFor(() => rig.spawned.length === 1, 15000, 'the turn to spawn')
      expect(rig.spawned[0].file).toBe(process.execPath)
      expect(rig.spawned[0].args[0]).toBe('run')
    })

    it('changes the window when the model changes', () => {
      const rig = makeRig({
        model: 'opus',
        lanes: {
          orchestrator: {
            name: 'Orchestrator',
            harness: 'Claude Code',
            cli: { harness: 'claude', bin: process.execPath, model: 'opus' },
          },
          opencode: {
            name: 'OpenCode',
            harness: 'OpenCode',
            cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/qwen3.8-flash' },
          },
        },
      })
      expect(rig.answer().contextWindow).toBe(200000)

      rig.orchestrator.setModel({ model: 'claude-sonnet-5-5', confirmed: true })
      expect(rig.answer().contextWindow).toBe(1000000)

      const opencodeRes = rig.orchestrator.setHarness({ harness: 'opencode', model: 'opencode-go/qwen3.8-flash', confirmed: true })
      expect(opencodeRes.status).toBe(200)
      expect(rig.answer().contextWindow).toBe(200000)

      const claudeRes = rig.orchestrator.setHarness({ harness: 'claude', model: 'claude-opus-5-5', confirmed: true })
      expect(claudeRes.status).toBe(200)
      expect(rig.answer().contextWindow).toBe(1000000)
    })
  })

  describe('a fresh turn through a fake harness', () => {
    const silentHarness = {
      key: 'fake',
      name: 'Fake',
      command({ cli, prompt }) {
        return { file: cli.bin, args: ['--prompt', prompt], cwd: process.cwd() }
      },
      createParser() {
        return { push() { return [] }, flush() { return [] } }
      },
    }

    function makeNoReplyRig(stderr = '', exit = 1) {
      const rig = makeRig({
        harness: 'fake',
        model: 'fake-model',
        harnesses: { fake: silentHarness },
        lanes: { orchestrator: { name: 'Orchestrator', harness: 'Fake', cli: { harness: 'fake', bin: process.execPath, model: 'fake-model' } } },
      })
      rig.behaviour.mode = 'quiet'
      rig.behaviour.stderr = stderr
      rig.behaviour.exit = exit
      return rig
    }

    it('gives the turn the room runs folder', async () => {
      const rig = makeRig({ project: true })
      rig.send('Hello')
      await waitFor(() => rig.spawned.length === 1, 15000, 'the turn to spawn')
      expect(rig.spawned[0].env.MACHINEROOM_RUNS).toBe(rig.runs)
    })

    it('omits bridge API keys for a machineroom turn when model names a saved endpoint', async () => {
      const prevOpenRouter = process.env.OPENROUTER_API_KEY
      const prevMrKey = process.env.MACHINEROOM_API_KEY
      const prevMrUrl = process.env.MACHINEROOM_API_URL
      process.env.OPENROUTER_API_KEY = 'placeholder'
      process.env.MACHINEROOM_API_KEY = 'placeholder'
      process.env.MACHINEROOM_API_URL = 'http://127.0.0.1:9999'

      const machineroomDescriptor = {
        key: 'machineroom',
        name: 'MachineRoom',
        command({ cli, prompt }) {
          return { file: cli.bin, args: ['--prompt', prompt], cwd: process.cwd() }
        },
        createParser() {
          return { push() { return [] }, flush() { return [] } }
        },
      }

      try {
        const rig = makeRig({
          harness: 'machineroom',
          model: 'Custom/my-model',
          harnesses: { machineroom: machineroomDescriptor },
          lanes: { orchestrator: { name: 'Orchestrator', harness: 'MachineRoom', cli: { harness: 'machineroom', bin: process.execPath, model: 'Custom/my-model' } } },
        })
        writeFileSync(join(rig.runs, 'endpoints.json'), JSON.stringify([
          { name: 'Custom', baseUrl: 'http://127.0.0.1:8000', provider: 'Custom', keyName: 'slot1', models: ['my-model'] },
        ]))
        rig.send('Run task')
        await waitFor(() => rig.spawned.length === 1, 15000, 'the turn to spawn')
        expect(rig.spawned[0].env).not.toHaveProperty('OPENROUTER_API_KEY')
        expect(rig.spawned[0].env).not.toHaveProperty('MACHINEROOM_API_KEY')
        expect(rig.spawned[0].env).not.toHaveProperty('MACHINEROOM_API_URL')
      } finally {
        for (const [name, value] of [['OPENROUTER_API_KEY', prevOpenRouter], ['MACHINEROOM_API_KEY', prevMrKey], ['MACHINEROOM_API_URL', prevMrUrl]]) {
          if (value === undefined) delete process.env[name]
          else process.env[name] = value
        }
      }
    })

    it('starts a room turn on a harness with no session once the owner gave it work', async () => {
      const fakeHarness = {
        key: 'fake',
        name: 'Fake',
        command({ cli, prompt }) {
          return { file: cli.bin, args: ['--prompt', prompt], cwd: process.cwd() }
        },
        createParser() {
          return { push() { return [] }, flush() { return [] } }
        },
        reply(log) {
          return String(log ?? '').trim()
        },
      }
      const rig = makeRig({
        harness: 'fake',
        model: 'fake-model',
        harnesses: { fake: fakeHarness },
        lanes: { orchestrator: { name: 'Orchestrator', harness: 'Fake', cli: { harness: 'fake', bin: process.execPath, model: 'fake-model' } } },
      })
      rig.orchestrator.deliver('room', 'A lane ended.')
      await sleep(200)
      expect(rig.calls()).toHaveLength(0)
      rig.send('Start the work')
      await waitFor(() => rig.calls().length === 1 && rig.answer().state === 'idle', 15000, 'the owner turn to finish')
      rig.orchestrator.deliver('room', 'Run x on lane opencode ended: succeeded.')
      await waitFor(() => rig.calls().length === 2, 15000, 'the room turn to start')
    })

    it('runs fresh each time with instructions, summary and last 20 messages', async () => {
      const fakeHarness = {
        key: 'fake',
        name: 'Fake',
        command({ cli, prompt }) {
          return {
            file: cli.bin,
            args: ['--prompt', prompt],
            cwd: process.cwd(),
          }
        },
        createParser() {
          return {
            push() { return [] },
            flush() { return [] },
          }
        },
        reply(log) {
          return String(log ?? '').trim()
        },
        report(log) {
          return [String(log ?? '').trim()]
        },
        usage() {
          return { costUsd: 0.05, inputTokens: 42, outputTokens: 8 }
        },
      }

      const rig = makeRig({
        harness: 'fake',
        model: 'fake-model',
        harnesses: { fake: fakeHarness },
        lanes: {
          orchestrator: {
            name: 'Orchestrator',
            harness: 'Fake',
            cli: { harness: 'fake', bin: process.execPath, model: 'fake-model' },
          },
        },
      })

      rig.send('First question')
      await waitFor(() => rig.answer().state === 'idle', 15000, 'first turn to finish')
      expect(rig.answer().messages).toHaveLength(2)
      expect(rig.answer().messages[1].text).toContain('Fake reply for:')
      expect(rig.calls()).toHaveLength(1)
      const firstPrompt = rig.calls()[0].args[1]
      expect(firstPrompt).toContain('First question')

      rig.send('Second question')
      await waitFor(() => rig.answer().state === 'idle', 15000, 'second turn to finish')
      expect(rig.answer().messages).toHaveLength(4)
      expect(rig.calls()).toHaveLength(2)
      const secondPrompt = rig.calls()[1].args[1]
      expect(secondPrompt).toContain('Owner: First question')
      expect(secondPrompt).toContain('Orchestrator: Fake reply for:')
      expect(secondPrompt).toContain('Second question')
      expect(rig.calls()[1].args).not.toContain('--resume')
      expect(rig.calls()[1].args).not.toContain('--session')
    })

    it('does not start a compact turn at 500,000 tokens for a harness that runs fresh each turn', async () => {
      const fakeHarness = {
        key: 'fake',
        name: 'Fake',
        command({ cli, prompt }) {
          return {
            file: cli.bin,
            args: ['--prompt', prompt],
            cwd: process.cwd(),
          }
        },
        createParser() {
          return {
            push() { return [] },
            flush() { return [] },
          }
        },
        reply(log) {
          return String(log ?? '').trim()
        },
        report(log) {
          return [String(log ?? '').trim()]
        },
        usage() {
          return { costUsd: 0.05, inputTokens: 500000, outputTokens: 8 }
        },
      }

      const rig = makeRig({
        harness: 'fake',
        model: 'fake-model',
        harnesses: { fake: fakeHarness },
        lanes: {
          orchestrator: {
            name: 'Orchestrator',
            harness: 'Fake',
            cli: { harness: 'fake', bin: process.execPath, model: 'fake-model' },
          },
        },
      })

      expect(
        rig.orchestrator.setAutocompact({ on: true, mode: 'tokens', value: 500000, confirmed: true })
      ).toEqual({
        status: 200,
        body: { id: 'orchestrator', autocompact: true, autocompactMode: 'tokens', autocompactValue: 500000, compactRules: '', autocompactPercent: 250 },
      })

      rig.send('Fresh turn consuming 500,000 tokens')
      await waitFor(() => rig.answer().state === 'idle', 15000, 'turn to finish')

      expect(rig.calls()).toHaveLength(1)
      expect(rig.answer().contextTokens).toBe(500000)
      expect(rig.answer().messages.some((message) => message.text === COMPACTED_MESSAGE)).toBe(false)
      expect(stateFile(rig).sessionId).toBeNull()

      const compactAttempt = rig.orchestrator.compact({ confirmed: true })
      expect(compactAttempt.status).toBe(400)
      expect(compactAttempt.body).toEqual({ error: NO_SESSION_PROBLEM })

      rig.send('Next fresh turn')
      await waitFor(() => rig.answer().state === 'idle', 15000, 'second turn to finish')
      expect(rig.calls()).toHaveLength(2)
      expect(rig.calls()[1].args).not.toContain('--resume')
      expect(rig.calls()[1].args).not.toContain('--session')
      expect(rig.calls()[1].args[1]).toContain('Owner: Fresh turn consuming 500,000 tokens')
      expect(rig.calls()[1].args[1]).toContain('Next fresh turn')
    })

    it('says the last stderr line of a failed turn with no reply', async () => {
      const rig = makeNoReplyRig('A warning line.\nThe endpoint TestRun1 was not found.\n\n', 1)
      rig.send('Build the room')
      await waitIdle(rig, 1)
      expect(rig.answer().messages.at(-1).text).toBe('The orchestrator stopped: The endpoint TestRun1 was not found.')
    })

    it('masks a key in the last stderr line of a failed turn', async () => {
      const rig = makeNoReplyRig(`The key sk-or-v1-${'q'.repeat(24)} was rejected.`, 1)
      rig.send('Build the room')
      await waitIdle(rig, 1)
      expect(rig.answer().messages.at(-1).text).toBe('The orchestrator stopped: The key [key] was rejected.')
    })

    it('still says exit 1 when a failed turn wrote nothing to stderr', async () => {
      const rig = makeNoReplyRig('', 1)
      rig.send('Build the room')
      await waitIdle(rig, 1)
      expect(rig.answer().messages.at(-1).text).toBe('The orchestrator stopped: exit 1.')
    })
  })
})

describe('stopping a running lane tells its head orchestrator', () => {
  it('saves the room note in the sector sub orchestrator or Main and carries it first in the next turn', async () => {
    const base = makeTempDir('mr-stop-head-')
    cleanups.push(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
    const projectRoot = join(base, 'project')
    const runs = join(base, 'runs')
    mkdirSync(projectRoot, { recursive: true })
    mkdirSync(runs, { recursive: true })
    const lanes = {
      orchestrator: ORCHESTRATOR_LANE,
      opencode: {
        name: 'OpenCode',
        harness: 'OpenCode',
        cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
      },
      opencode2: {
        name: 'OpenCode 2',
        harness: 'OpenCode',
        cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
      },
    }
    const lanesFile = join(base, 'lanes.json')
    writeFileSync(lanesFile, JSON.stringify(lanes))
    writeActiveLanes(activeLanesFileFor(projectRoot, runs), ['opencode', 'opencode2'])

    const claudeScript = join(base, 'fake-claude.mjs')
    writeFileSync(claudeScript, FAKE_CLAUDE)
    const promptFile = join(base, 'prompt.md')
    writeFileSync(promptFile, PROMPT)
    const callsFile = join(base, 'calls.jsonl')

    const stopRunner = join(base, 'runner.mjs')
    const startedFlag = join(base, 'lane-started')
    writeFileSync(
      stopRunner,
      [
        "import { writeFileSync } from 'node:fs'",
        'const args = process.argv.slice(2)',
        "if (args[0] === '--stop') {",
        "  console.log('stopped: ' + args[1])",
        '  process.exit(0)',
        '}',
        `writeFileSync(${JSON.stringify(startedFlag)}, args.join(' '))`,
        'await new Promise((resolve) => setTimeout(resolve, 5000))',
      ].join('\n')
    )

    const spawnClaude = (file, args, options) =>
      spawn(process.execPath, [claudeScript, ...args], {
        ...options,
        env: { ...(options.env ?? process.env), MR_CALLS: callsFile, MR_MODE: 'reply' },
      })

    const bridge = createBridge({
      projectRoot,
      port: 0,
      orchestratorHarnessAvailable: assumeInstalled,
      env: {},
      runsFolder: runs,
      lanesFile,
      runnerCommand: { file: process.execPath, args: [stopRunner] },
      lanesSource: { folder: runs, lanes, pollMs: 20, quietMs: 60000 },
      orchestratorPrompt: promptFile,
      orchestratorSpawn: spawnClaude,
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const ladderRes = await pagePostJson(`${url}/api/orchestrator/ladder`, {
      ladder: {
        subs: [
          {
            id: 'frontend',
            name: 'Frontend',
            harness: 'claude',
            model: 'sonnet',
            lanes: ['opencode2'],
            scope: ['src/ui/**'],
            restricted: true,
            setBy: 'owner',
          },
        ],
      },
      by: 'owner',
      confirmed: true,
    })
    expect(ladderRes.status).toBe(200)

    const subRun = await pagePostJson(`${url}/api/control/runs`, {
      lane: 'opencode2',
      task: 'Fix button alignment',
      allowDirty: true,
      confirmed: true,
    })
    expect(subRun.status).toBe(202)
    await waitFor(() => existsSync(startedFlag), 5000, 'sub lane runner to start')

    const subStop = await pagePostJson(`${url}/api/control/runs/stop`, {
      lane: 'opencode2',
      startedAt: subRun.body.startedAt,
      confirmed: true,
    })
    expect(subStop.status).toBe(200)
    expect(subStop.body.output).toBe('stopped: opencode2')

    const subChat = await getJson(`${url}/api/orchestrator?id=frontend`)
    const subNote = subChat.body.messages.find((m) => m.from === 'room')
    expect(subNote).toBeDefined()
    expect(subNote.text).toMatch(/^The owner stopped opencode2's run on Fix button alignment at .+\.$/)

    const mainChat = await getJson(`${url}/api/orchestrator`)
    expect(mainChat.body.messages.some((m) => m.text.includes('opencode2'))).toBe(false)
    expect(readLines(callsFile)).toHaveLength(0)

    const subChatFile = chatFileFor(projectRoot, runs, 'frontend')
    const savedSub = JSON.parse(readFileSync(subChatFile, 'utf8'))
    expect(savedSub.messages.at(-1)).toMatchObject({ from: 'room', text: subNote.text })
    expect(savedSub.pending[0]).toBe(subNote.id)

    const nextSubTurn = await pagePostJson(`${url}/api/orchestrator/messages`, {
      id: 'frontend',
      text: 'Pick another fix.',
      confirmed: true,
    })
    expect(nextSubTurn.status).toBe(202)
    await waitFor(async () => (await getJson(`${url}/api/orchestrator?id=frontend`)).body.state === 'idle' && readLines(callsFile).length === 1, 15000, 'frontend turn to finish')
    const subPrompt = readLines(callsFile)[0].args[readLines(callsFile)[0].args.indexOf('-p') + 1]
    expect(subPrompt).toBe(`Room: ${subNote.text}\n\nOwner: Pick another fix.`)

    rmSync(startedFlag, { force: true })
    const mainRun = await pagePostJson(`${url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Audit the logs',
      allowDirty: true,
      confirmed: true,
    })
    expect(mainRun.status).toBe(202)
    await waitFor(() => existsSync(startedFlag), 5000, 'main lane runner to start')

    const mainStop = await pagePostJson(`${url}/api/control/runs/stop`, {
      lane: 'opencode',
      startedAt: mainRun.body.startedAt,
      confirmed: true,
    })
    expect(mainStop.status).toBe(200)

    const mainAfter = await getJson(`${url}/api/orchestrator`)
    const mainNote = mainAfter.body.messages.find((m) => m.from === 'room')
    expect(mainNote).toBeDefined()
    expect(mainNote.text).toMatch(/^The owner stopped opencode's run on Audit the logs at .+\.$/)

    await bridge.stop()

    const restarted = createBridge({
      projectRoot,
      port: 0,
      env: {},
      runsFolder: runs,
      lanesFile,
      runnerCommand: { file: process.execPath, args: [stopRunner] },
      lanesSource: { folder: runs, lanes, pollMs: 20, quietMs: 60000 },
      orchestratorPrompt: promptFile,
      orchestratorSpawn: spawnClaude,
    })
    cleanups.push(() => restarted.stop())
    const { url: restartedUrl } = await restarted.start()

    const nextMainTurn = await pagePostJson(`${restartedUrl}/api/orchestrator/messages`, {
      text: 'Carry on.',
      confirmed: true,
    })
    expect(nextMainTurn.status).toBe(202)
    await waitFor(async () => (await getJson(`${restartedUrl}/api/orchestrator`)).body.state === 'idle' && readLines(callsFile).length === 2, 15000, 'main turn after restart')
    const mainPrompt = readLines(callsFile)[1].args[readLines(callsFile)[1].args.indexOf('-p') + 1]
    expect(mainPrompt.split('\n')[0]).toBe(`Room: ${mainNote.text}`)
    expect(mainPrompt).toContain('Owner: Carry on.')
  })
})
