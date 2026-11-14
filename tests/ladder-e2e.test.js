import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { createBridge } from '../server/index.js'
import { killTree } from '../server/processTree.js'
import { gitPath } from '../server/programPath.js'
import { worktreeFor } from '../src/briefs/run.js'
import { getJson, waitFor } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const dirs = []
const servers = []
const children = []

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  dirs.push(dir)
  return dir
}

function fakeCodexLaneScript(git) {
  return `'use strict'
const { execFileSync } = require('node:child_process')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
const prompt = args[args.length - 1] || ''
const outFile = join(process.cwd(), 'ladder-work.txt')
const existing = (() => {
  try { return readFileSync(outFile, 'utf8') } catch { return '' }
})()
writeFileSync(outFile, existing + prompt + '\\n')
execFileSync(${JSON.stringify(git)}, ['add', 'ladder-work.txt'], { cwd: process.cwd() })
execFileSync(${JSON.stringify(git)}, ['commit', '-m', 'Fake codex lane commit'], { cwd: process.cwd() })
const lines = [
  { type: 'thread.started', thread_id: 'thr_lane_1' },
  { type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: 'apply edit', status: 'in_progress' } },
  { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'apply edit', aggregated_output: 'ok', exit_code: 0, status: 'completed' } },
  { type: 'item.completed', item: { id: 'item_2', type: 'file_change', changes: [{ path: 'ladder-work.txt', kind: 'add' }], status: 'completed' } },
  { type: 'item.completed', item: { id: 'item_3', type: 'agent_message', text: 'Codex lane completed the task and committed ladder-work.txt.' } },
  { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 25 } },
]
for (const line of lines) process.stdout.write(JSON.stringify(line) + '\\n')
`
}

function fakeOpencodeLaneScript(git) {
  return `'use strict'
const { execFileSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const outFile = join(process.cwd(), 'opencode-work.txt')
writeFileSync(outFile, 'opencode output\\n')
execFileSync(${JSON.stringify(git)}, ['add', 'opencode-work.txt'], { cwd: process.cwd() })
execFileSync(${JSON.stringify(git)}, ['commit', '-m', 'Fake opencode lane commit'], { cwd: process.cwd() })
const sid = 'ses_lane_opencode'
const lines = [
  { type: 'step_start', timestamp: 1, sessionID: sid, part: { type: 'step-start' } },
  { type: 'tool_use', timestamp: 2, sessionID: sid, part: { id: 'prt_1', type: 'tool', tool: 'write', state: { status: 'completed', input: { filePath: 'opencode-work.txt' } } } },
  { type: 'text', timestamp: 3, sessionID: sid, part: { type: 'text', text: 'OpenCode lane completed the task.' } },
  { type: 'step_finish', timestamp: 4, sessionID: sid, part: { type: 'step-finish', cost: 0.01, tokens: { input: 20, output: 8 } } },
]
for (const line of lines) process.stdout.write(JSON.stringify(line) + '\\n')
`
}

function fakeOrchestratorScript() {
  return `import { appendFileSync } from 'node:fs'

const args = process.argv.slice(2)
const kind = args[0]
const prompt = args[args.length - 1] || ''
const logPath = process.env.FAKE_LADDER_LOG

function record(entry) {
  if (logPath) appendFileSync(logPath, JSON.stringify(entry) + '\\n')
}

function parseField(re) {
  const m = re.exec(prompt)
  return m ? m[1] : null
}

async function postRun(bridgeUrl, token, lane, task) {
  const res = await fetch(bridgeUrl + '/api/control/runs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-MachineRoom-Orchestrator': token,
    },
    body: JSON.stringify({ lane, tasks: [task], worktree: true, confirmed: true }),
  })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch {}
  return { status: res.status, body }
}

async function postMessage(bridgeUrl, token, payload) {
  const res = await fetch(bridgeUrl + '/api/orchestrator/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-MachineRoom-Orchestrator': token,
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch {}
  return { status: res.status, body }
}

function emitOpencode(sessionId, text, toolCall) {
  const lines = [
    { type: 'step_start', timestamp: 1, sessionID: sessionId, part: { type: 'step-start' } },
  ]
  if (toolCall) lines.push(toolCall)
  lines.push({ type: 'text', timestamp: 3, sessionID: sessionId, part: { type: 'text', text } })
  lines.push({ type: 'step_finish', timestamp: 4, sessionID: sessionId, part: { type: 'step-finish', cost: 0.01, tokens: { input: 15, output: 5 } } })
  for (const line of lines) process.stdout.write(JSON.stringify(line) + '\\n')
}

function emitCodex(threadId, text, command) {
  const lines = [
    { type: 'thread.started', thread_id: threadId },
  ]
  if (command) {
    lines.push({ type: 'item.started', item: { id: 'cmd_1', type: 'command_execution', command, status: 'in_progress' } })
    lines.push({ type: 'item.completed', item: { id: 'cmd_1', type: 'command_execution', command, aggregated_output: 'ok', exit_code: 0, status: 'completed' } })
  }
  lines.push({ type: 'item.completed', item: { id: 'msg_1', type: 'agent_message', text } })
  lines.push({ type: 'turn.completed', usage: { input_tokens: 90, cached_input_tokens: 0, output_tokens: 20 } })
  for (const line of lines) process.stdout.write(JSON.stringify(line) + '\\n')
}

async function main() {
  const bridgeUrl = parseField(/(http:\\/\\/127\\.0\\.0\\.1:\\d+)/)
  const token = parseField(/X-MachineRoom-Orchestrator:\\s*([^\\s\`'"]+)/)
  const subId = parseField(/Your id is \`([^\`]+)\`/)

  if (kind === 'run') {
    const isFollowup = args.includes('--session')
    record({
      role: 'main',
      harness: 'opencode',
      isFollowup,
      argsPrefix: args.slice(0, 6),
      receivedSubFinal: prompt.includes('FINAL_SUB_REPORT'),
    })
    if (!isFollowup && bridgeUrl && token) {
      const sent = await postMessage(bridgeUrl, token, {
        id: 'coder',
        from: 'orchestrator',
        text: 'Check outside lane, start a codex task, and report when the run ends.',
        confirmed: true,
      })
      record({ role: 'main', action: 'message_sub', sent })
      emitOpencode(
        'ses_main_1',
        'Delegated task to sub coder.',
        { type: 'tool_use', timestamp: 2, sessionID: 'ses_main_1', part: { id: 'prt_m1', type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'post message to coder' } } } },
      )
      return
    }
    emitOpencode('ses_main_1', prompt.includes('FINAL_SUB_REPORT') ? 'MAIN_ACK: received FINAL_SUB_REPORT' : 'MAIN_ACK: update')
    return
  }

  if (kind === 'exec') {
    const isWake = prompt.includes('ended: succeeded') || (prompt.includes('Run ') && prompt.includes(' ended:'))
    record({ role: 'sub', harness: 'codex', subId, isWake, argsPrefix: args.slice(0, 5) })
    if (!isWake && bridgeUrl && token) {
      const outside = await postRun(bridgeUrl, token, 'opencode', 'Outside sector task')
      record({ role: 'sub', action: 'outside_run', outside })
      const started = await postRun(bridgeUrl, token, 'codex', 'Write ladder output in worktree')
      record({ role: 'sub', action: 'inside_run', lane: 'codex', started })
      const second = prompt.includes('ALSO_SECOND_LANE')
        ? await postRun(bridgeUrl, token, 'codex2', 'Second sector lane task')
        : null
      if (second) record({ role: 'sub', action: 'inside_run_second', lane: 'codex2', second })
      emitCodex('thr_sub_1', 'Started lane codex run.', 'POST /api/control/runs')
      return
    }
    emitCodex('thr_sub_1', 'FINAL_SUB_REPORT: codex lane run finished cleanly.')
    return
  }

  record({ role: 'unknown', argsPrefix: args.slice(0, 4) })
  process.exitCode = 1
}

await main()
`
}

function makeProject() {
  const root = tempDir('mr-ladder-')
  const project = join(root, 'repo')
  const runs = join(root, 'runs')
  mkdirSync(project, { recursive: true })
  mkdirSync(runs, { recursive: true })
  const git = gitPath()
  execFileSync(git, ['init', '-b', 'main'], { cwd: project })
  execFileSync(git, ['config', 'user.name', 'Test'], { cwd: project })
  execFileSync(git, ['config', 'user.email', 'test@example.com'], { cwd: project })
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'ladder-test', private: true }, null, 2))
  writeFileSync(join(project, 'README.md'), 'ladder test project\n')
  writeFileSync(join(project, 'exec'), fakeCodexLaneScript(git))
  writeFileSync(join(project, 'run'), fakeOpencodeLaneScript(git))
  execFileSync(git, ['add', '.'], { cwd: project })
  execFileSync(git, ['commit', '-m', 'Initial commit'], { cwd: project })
  return { root, project, runs, git }
}

function readRecords(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function postAsPage(url, path, body) {
  return getJson(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: url },
    body: JSON.stringify(body),
  })
}

async function attachCodexSub(url) {
  const res = await postAsPage(url, '/api/orchestrator/ladder', {
    ladder: {
      subs: [
        {
          id: 'coder',
          name: 'Backend',
          harness: 'codex',
          model: 'gpt-5.3-codex',
          lanes: ['codex', 'codex2'],
          scope: ['ladder-work.txt'],
          setBy: 'owner',
        },
      ],
    },
    by: 'owner',
    confirmed: true,
  })
  expect(res.status).toBe(200)
}

async function setupLadderRig() {
  const { root, project, runs } = makeProject()
  const orchScript = join(root, 'fake-orchestrator.mjs')
  const orchLog = join(root, 'orch-turns.jsonl')
  writeFileSync(orchScript, fakeOrchestratorScript())

  const lanesFile = join(root, 'lanes.json')
  const spawns = []
  const lanes = {
    orchestrator: {
      name: 'OpenCode',
      harness: 'OpenCode',
      cli: { harness: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' },
    },
    codex: {
      name: 'Codex',
      harness: 'Codex',
      cli: { harness: 'codex', bin: process.execPath, model: 'gpt-5.3-codex' },
    },
    codex2: {
      name: 'Codex Two',
      harness: 'Codex',
      cli: { harness: 'codex', bin: process.execPath, model: 'gpt-5.3-codex' },
    },
    opencode: {
      name: 'OpenCode Lane',
      harness: 'OpenCode',
      cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' },
    },
  }
  writeFileSync(lanesFile, JSON.stringify(lanes, null, 2))
  writeActiveLanes(activeLanesFileFor(project, runs), ['codex', 'codex2', 'opencode'])

  const bridge = createBridge({
    projectRoot: project,
    port: 0,
    env: {},
    runsFolder: runs,
    lanesFile,
    orchestratorFolder: runs,
    orchestratorSpawn(program, args, options) {
      const entry = { file: program, firstArg: args[0], jsonFlag: args.includes('--json') }
      spawns.push(entry)
      const child = spawn(process.execPath, [orchScript, ...args], {
        ...options,
        env: { ...(options?.env ?? {}), FAKE_LADDER_LOG: orchLog },
      })
      children.push(child)
      return child
    },
    lanesSource: {
      folder: runs,
      lanes,
      repoRoot: project,
      pollMs: 20,
      quietMs: 60000,
      primeMs: 600000,
    },
  })
  servers.push(bridge)
  const { url } = await bridge.start()
  return { root, project, runs, url, orchLog, spawns }
}

afterEach(async () => {
  while (children.length > 0) await killTree(children.pop())
  while (servers.length > 0) await servers.pop().stop()
  while (dirs.length > 0) removeTempDir(dirs.pop())
})

describe('ladder end to end on non-Claude harnesses', () => {
  it('runs main -> codex sub -> sector lane -> wake -> sub:ID answer and refuses outside lane with 403', async () => {
    const { url, project, runs, orchLog, spawns } = await setupLadderRig()
    await attachCodexSub(url)

    const rosterRes = await getJson(`${url}/api/orchestrators`)
    expect(rosterRes.status).toBe(200)
    const subConfig = rosterRes.body.find((entry) => entry.id === 'coder')
    expect(subConfig).toEqual(expect.objectContaining({ harness: 'codex', lanes: ['codex', 'codex2'] }))

    const sendRes = await postAsPage(url, '/api/orchestrator/messages', {
      from: 'owner',
      text: 'Start the backend ladder check.',
      confirmed: true,
    })
    expect(sendRes.status).toBe(202)

    await waitFor(() => {
      const entries = readRecords(orchLog)
      return entries.some((entry) => entry.role === 'sub' && entry.action === 'inside_run')
    }, { timeoutMs: 12000, what: 'codex sub starts sector lane run' })

    const recordsAfterStart = readRecords(orchLog)
    const outsideAttempt = recordsAfterStart.find((entry) => entry.role === 'sub' && entry.action === 'outside_run')
    expect(outsideAttempt.outside).toEqual(expect.objectContaining({ status: 403 }))
    const insideAttempt = recordsAfterStart.find((entry) => entry.role === 'sub' && entry.action === 'inside_run')
    expect(insideAttempt.started).toEqual(expect.objectContaining({ status: 202 }))
    const subFirstTurn = recordsAfterStart.find((entry) => entry.role === 'sub' && entry.isWake === false)
    expect(subFirstTurn.subId).toBe('coder')
    expect(subFirstTurn.argsPrefix.slice(0, 2)).toEqual(['exec', '--json'])

    await waitFor(() => {
      const entries = readRecords(orchLog)
      return entries.some((entry) => entry.role === 'sub' && entry.isWake === true)
    }, { timeoutMs: 15000, what: 'lane run end wakes codex sub' })

    const worktreeFile = join(worktreeFor(project, 'codex'), 'ladder-work.txt')
    expect(existsSync(worktreeFile)).toBe(true)

    await waitFor(async () => {
      const mainState = await getJson(`${url}/api/orchestrator`)
      const hasSubAnswer = mainState.body?.messages?.some(
        (msg) => msg.from === 'sub:coder' && msg.text.includes('FINAL_SUB_REPORT'),
      )
      const hasMainAck = mainState.body?.messages?.some(
        (msg) => msg.from === 'orchestrator' && msg.text.includes('MAIN_ACK: received FINAL_SUB_REPORT'),
      )
      return Boolean(hasSubAnswer && hasMainAck)
    }, { timeoutMs: 15000, what: 'sub:coder final answer reaches main orchestrator' })

    const mainState = await getJson(`${url}/api/orchestrator`)
    const subState = await getJson(`${url}/api/orchestrator?id=coder`)
    expect(subState.body.messages.some((msg) => msg.from === 'room' && msg.text.includes('ended: succeeded'))).toBe(true)
    expect(mainState.body.messages.filter((msg) => msg.from === 'room')).toEqual([])
    expect(mainState.body.messages.some((msg) => msg.from === 'sub:coder' && msg.text.includes('FINAL_SUB_REPORT'))).toBe(true)

    const runsRecords = readRecords(join(runs, 'runs.jsonl'))
    const laneRecord = runsRecords.find((record) => record.lane === 'codex')
    expect(laneRecord).toEqual(
      expect.objectContaining({
        lane: 'codex',
        startedBy: 'coder',
        exitCode: 0,
        inputTokens: 100,
        outputTokens: 25,
      }),
    )

    expect(spawns.some((entry) => entry.firstArg === 'run')).toBe(true)
    expect(spawns.some((entry) => entry.firstArg === 'exec' && entry.jsonFlag)).toBe(true)
    expect(spawns.some((entry) => entry.firstArg === '-p')).toBe(false)
  })

  it('allows the second lane in the sub sector and refuses a lane outside the sector with 403', async () => {
    const { url, project, runs, orchLog } = await setupLadderRig()
    await attachCodexSub(url)

    const subPromptRes = await postAsPage(url, '/api/orchestrator/messages', {
      id: 'coder',
      from: 'owner',
      text: 'ALSO_SECOND_LANE',
      confirmed: true,
    })
    expect(subPromptRes.status).toBe(202)

    await waitFor(() => {
      const entries = readRecords(orchLog)
      return entries.some((entry) => entry.role === 'sub' && entry.action === 'inside_run_second')
    }, { timeoutMs: 12000, what: 'codex sub starts both sector lanes' })

    const entries = readRecords(orchLog)
    const outsideAttempt = entries.find((entry) => entry.role === 'sub' && entry.action === 'outside_run')
    const firstAttempt = entries.find((entry) => entry.role === 'sub' && entry.action === 'inside_run')
    const secondAttempt = entries.find((entry) => entry.role === 'sub' && entry.action === 'inside_run_second')
    expect(outsideAttempt.outside).toEqual(expect.objectContaining({ status: 403 }))
    expect(firstAttempt.started).toEqual(expect.objectContaining({ status: 202 }))
    expect(secondAttempt.second).toEqual(expect.objectContaining({ status: 202 }))

    await waitFor(() => {
      const fileA = join(worktreeFor(project, 'codex'), 'ladder-work.txt')
      const fileB = join(worktreeFor(project, 'codex2'), 'ladder-work.txt')
      const runsRecords = readRecords(join(runs, 'runs.jsonl'))
      return (
        existsSync(fileA) &&
        existsSync(fileB) &&
        runsRecords.some((r) => r.lane === 'codex' && r.startedBy === 'coder' && r.exitCode === 0) &&
        runsRecords.some((r) => r.lane === 'codex2' && r.startedBy === 'coder' && r.exitCode === 0)
      )
    }, { timeoutMs: 15000, what: 'both sector lane worktrees complete their runs' })
  })
})
