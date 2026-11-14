import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { createBridge } from '../server/index.js'
import { killTree } from '../server/processTree.js'
import { gitPath } from '../server/programPath.js'
import { worktreeFor } from '../src/briefs/run.js'
import { getJson, waitFor } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dirs = []
const servers = []
const children = []

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  dirs.push(dir)
  return dir
}

function fakeOpencodeLaneScript(git) {
  return `'use strict'
const { execFileSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const outFile = join(process.cwd(), 'opencode-work.txt')
writeFileSync(outFile, 'opencode worktree output\\n')
execFileSync(${JSON.stringify(git)}, ['add', 'opencode-work.txt'], { cwd: process.cwd() })
execFileSync(${JSON.stringify(git)}, ['commit', '-m', 'Fake opencode lane commit'], { cwd: process.cwd() })
const sid = 'ses_lane_opencode'
const lines = [
  { type: 'step_start', timestamp: 1, sessionID: sid, part: { type: 'step-start' } },
  { type: 'tool_use', timestamp: 2, sessionID: sid, part: { id: 'prt_1', type: 'tool', tool: 'write', state: { status: 'completed', input: { filePath: 'opencode-work.txt' } } } },
  { type: 'text', timestamp: 3, sessionID: sid, part: { type: 'text', text: 'OpenCode lane completed the task.' } },
  { type: 'step_finish', timestamp: 4, sessionID: sid, part: { type: 'step-finish', cost: 0.01, tokens: { input: 24, output: 10 } } },
]
for (const line of lines) process.stdout.write(JSON.stringify(line) + '\\n')
`
}

function fakeRunnerScript(repoRoot, git) {
  const runLaneUrl = pathToFileURL(join(repoRoot, 'scripts', 'run-lane.mjs')).href
  const runModelUrl = pathToFileURL(join(repoRoot, 'src', 'briefs', 'run.js')).href
  return `import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendRunRecord, prepareWorktree } from ${JSON.stringify(runLaneUrl)}
import { runRecord, worktreeFor } from ${JSON.stringify(runModelUrl)}

const args = process.argv.slice(2)
const lane = String(args[0] ?? '')

function optionValue(flag) {
  const idx = args.indexOf(flag)
  return idx !== -1 && idx + 1 < args.length ? String(args[idx + 1] ?? '') : ''
}

if (!lane.startsWith('agy')) {
  const child = spawn(process.execPath, [${JSON.stringify(join(repoRoot, 'scripts', 'run-lane.mjs'))}, ...args], {
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  })
  child.on('error', (error) => {
    console.error(error)
    process.exit(1)
  })
  child.on('close', (code) => process.exit(code ?? 1))
} else {
  const project = optionValue('--project')
  const queueFile = optionValue('--queue')
  let task = optionValue('--task')
  if (!task && queueFile) {
    try {
      const parsed = JSON.parse(readFileSync(queueFile, 'utf8'))
      if (Array.isArray(parsed) && parsed.length > 0) task = String(parsed[0] ?? '')
    } catch {}
  }
  const startedBy = optionValue('--started-by')
  const startedAt = optionValue('--started-at') || new Date().toISOString()
  const runsDir = process.env.MACHINEROOM_RUNS || ''
  mkdirSync(runsDir, { recursive: true })
  prepareWorktree(project, lane)
  const worktree = worktreeFor(project, lane)
  const stamp = startedAt.replace(/[-:.TZ]/g, '').slice(0, 14) || String(Date.now())
  const branch = 'machineroom/queue-' + lane + '-' + stamp
  execFileSync(${JSON.stringify(git)}, ['switch', '-c', branch], { cwd: worktree })
  writeFileSync(join(worktree, 'agy-work.txt'), 'agy worktree output\\n' + task + '\\n')
  execFileSync(${JSON.stringify(git)}, ['add', 'agy-work.txt'], { cwd: worktree })
  execFileSync(${JSON.stringify(git)}, ['commit', '-m', 'Fake agy lane commit'], { cwd: worktree })
  const logName = lane + '-project-' + stamp
  const logPath = join(runsDir, logName + '.log')
  const events = [
    { event: 'init', session_id: 'ses_lane_' + lane },
    { event: 'tool_use', tool: 'write', input: { filePath: 'agy-work.txt' } },
    { event: 'result', result: { response: 'AGY lane completed the task.', usage: { input_tokens: 80, output_tokens: 20 } } },
  ]
  writeFileSync(logPath, events.map((e) => JSON.stringify(e)).join('\\n') + '\\n')
  const record = runRecord({
    lane,
    model: 'gemini-4-hydrogen-xhigh',
    startedAt,
    minutes: 0.1,
    exitCode: 0,
    inputTokens: 80,
    outputTokens: 20,
    log: logPath,
    branch,
    project,
    task,
    startedBy,
    ...(queueFile ? { queue: { branch, index: 0, size: 1 } } : {}),
  })
  appendRunRecord(record, { file: join(runsDir, 'runs.jsonl') })
}
`
}

function fakeOrchestratorScript() {
  return `import { appendFileSync, existsSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const logPath = process.env.FAKE_OWNER_TREE_LOG
const combined = args.join('\\n')

function readLog() {
  if (!logPath || !existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8')
    .split(/\\r?\\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function hasAction(actor, action) {
  return readLog().some((entry) => entry.actor === actor && entry.action === action)
}

function record(entry) {
  if (logPath) appendFileSync(logPath, JSON.stringify(entry) + '\\n')
}

function parseField(re) {
  const m = re.exec(combined)
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

function emitClaude(sessionId, text) {
  const lines = [
    { type: 'system', subtype: 'init', session_id: sessionId },
    { type: 'assistant', message: { content: [{ type: 'text', text }] } },
    { type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 40, output_tokens: 15 } },
  ]
  for (const line of lines) process.stdout.write(JSON.stringify(line) + '\\n')
}

function emitCodex(threadId, text, command) {
  const lines = [{ type: 'thread.started', thread_id: threadId }]
  if (command) {
    lines.push({ type: 'item.started', item: { id: 'cmd_1', type: 'command_execution', command, status: 'in_progress' } })
    lines.push({ type: 'item.completed', item: { id: 'cmd_1', type: 'command_execution', command, aggregated_output: 'ok', exit_code: 0, status: 'completed' } })
  }
  lines.push({ type: 'item.completed', item: { id: 'msg_1', type: 'agent_message', text } })
  lines.push({ type: 'turn.completed', usage: { input_tokens: 90, cached_input_tokens: 0, output_tokens: 20 } })
  for (const line of lines) process.stdout.write(JSON.stringify(line) + '\\n')
}

function emitMachineroom(sessionId, text) {
  const lines = [
    { type: 'assistant', message: { content: [{ type: 'text', text }] } },
    { type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 55, output_tokens: 18 } },
  ]
  for (const line of lines) process.stdout.write(JSON.stringify(line) + '\\n')
}

async function main() {
  const bridgeUrl = parseField(/(http:\\/\\/127\\.0\\.0\\.1:\\d+)/)
  const token = parseField(/X-MachineRoom-Orchestrator:\\s*([^\\s\`'"]+)/)
  const subId = parseField(/Your id is \`([^\`]+)\`/)

  if (args[0] === '-p') {
    const prompt = String(args[1] ?? '')
    const isFollowup = args.includes('--resume')
    record({
      actor: 'orchestrator',
      role: 'main',
      harness: 'claude',
      isFollowup,
      args,
    })
    if (prompt.includes('SIMPLE_FORM_CHECK') && bridgeUrl && token && !hasAction('orchestrator', 'simple_start')) {
      const started = await postRun(bridgeUrl, token, 'opencode1', 'Simple form lane check')
      record({ actor: 'orchestrator', role: 'main', action: 'simple_start', started })
      emitClaude('ses_main_claude', 'Started opencode1 under simple form.')
      return
    }
    if (prompt.includes('ended: succeeded') && !hasAction('orchestrator', 'simple_wake')) {
      record({ actor: 'orchestrator', role: 'main', action: 'simple_wake' })
      emitClaude('ses_main_claude', 'MAIN_SIMPLE_ACK: received lane end report.')
      return
    }
    if (prompt.includes('Run owner tree check') && bridgeUrl && token && !hasAction('orchestrator', 'delegate_subs')) {
      const sentCodex = await postMessage(bridgeUrl, token, {
        id: 'codex-sub',
        from: 'orchestrator',
        text: 'Start your AGY lane, test cross-sub refusal, and message native-sub.',
        confirmed: true,
      })
      const sentNative = await postMessage(bridgeUrl, token, {
        id: 'native-sub',
        from: 'orchestrator',
        text: 'Start your OpenCode lane, test cross-sub refusal, and message codex-sub.',
        confirmed: true,
      })
      record({ actor: 'orchestrator', role: 'main', action: 'delegate_subs', sentCodex, sentNative })
      emitClaude('ses_main_claude', 'Delegated work to both subs.')
      return
    }
    if ((prompt.includes('FINAL_CODEX_REPORT') || prompt.includes('FINAL_NATIVE_REPORT')) && !hasAction('orchestrator', 'main_ack_' + (prompt.includes('FINAL_CODEX_REPORT') ? 'codex' : 'native'))) {
      if (prompt.includes('FINAL_CODEX_REPORT') && !hasAction('orchestrator', 'main_ack_codex')) {
        record({ actor: 'orchestrator', role: 'main', action: 'main_ack_codex' })
      }
      if (prompt.includes('FINAL_NATIVE_REPORT') && !hasAction('orchestrator', 'main_ack_native')) {
        record({ actor: 'orchestrator', role: 'main', action: 'main_ack_native' })
      }
      emitClaude('ses_main_claude', 'MAIN_ACK: received sub report.')
      return
    }
    emitClaude('ses_main_claude', 'NO_REPORT')
    return
  }

  if (args[0] === 'exec') {
    const prompt = String(args[args.length - 1] ?? '')
    const actor = subId || 'codex-sub'
    const didInit = hasAction(actor, 'init')
    const gotPeer = prompt.includes('PEER_FROM_NATIVE') && !hasAction(actor, 'peer_received')
    const gotWake = prompt.includes('ended: succeeded') && !hasAction(actor, 'wake')
    record({ actor, role: 'sub', harness: 'codex', argsPrefix: args.slice(0, 6), args, gotPeer, gotWake })
    if (!didInit && bridgeUrl && token) {
      const outside = await postRun(bridgeUrl, token, 'opencode1', 'Cross-sector opencode attempt')
      record({ actor, role: 'sub', action: 'outside_run', outside })
      const started = await postRun(bridgeUrl, token, 'agy1', 'Write agy worktree output')
      record({ actor, role: 'sub', action: 'inside_run', lane: 'agy1', started })
      const peer = await postMessage(bridgeUrl, token, { to: 'native-sub', text: 'PEER_FROM_CODEX: started agy1.' })
      record({ actor, role: 'sub', action: 'peer_sent', to: 'native-sub', peer })
      record({ actor, role: 'sub', action: 'init' })
      if (gotPeer) record({ actor, role: 'sub', action: 'peer_received' })
      emitCodex('thr_codex_sub', gotWake ? 'FINAL_CODEX_REPORT: agy1 finished.' : 'NO_REPORT', 'POST /api/control/runs')
      return
    }
    if (gotPeer) record({ actor, role: 'sub', action: 'peer_received' })
    if (gotWake) {
      record({ actor, role: 'sub', action: 'wake' })
      emitCodex('thr_codex_sub', 'FINAL_CODEX_REPORT: agy1 finished cleanly.')
      return
    }
    emitCodex('thr_codex_sub', 'NO_REPORT')
    return
  }

  if (args[0]?.endsWith('mr-agent.mjs')) {
    const prompt = String(args[args.length - 1] ?? '')
    const actor = subId || 'native-sub'
    const didInit = hasAction(actor, 'init')
    const gotPeer = prompt.includes('PEER_FROM_CODEX') && !hasAction(actor, 'peer_received')
    const gotWake = prompt.includes('ended: succeeded') && !hasAction(actor, 'wake')
    record({ actor, role: 'sub', harness: 'machineroom', argsPrefix: args.slice(0, 5), args, gotPeer, gotWake })
    if (!didInit && bridgeUrl && token) {
      const outside = await postRun(bridgeUrl, token, 'agy2', 'Cross-sector agy attempt')
      record({ actor, role: 'sub', action: 'outside_run', outside })
      const started = await postRun(bridgeUrl, token, 'opencode1', 'Write opencode worktree output')
      record({ actor, role: 'sub', action: 'inside_run', lane: 'opencode1', started })
      const peer = await postMessage(bridgeUrl, token, { to: 'codex-sub', text: 'PEER_FROM_NATIVE: started opencode1.' })
      record({ actor, role: 'sub', action: 'peer_sent', to: 'codex-sub', peer })
      record({ actor, role: 'sub', action: 'init' })
      if (gotPeer) record({ actor, role: 'sub', action: 'peer_received' })
      emitMachineroom('ses_native_sub', gotWake ? 'FINAL_NATIVE_REPORT: opencode1 finished.' : 'NO_REPORT')
      return
    }
    if (gotPeer) record({ actor, role: 'sub', action: 'peer_received' })
    if (gotWake) {
      record({ actor, role: 'sub', action: 'wake' })
      emitMachineroom('ses_native_sub', 'FINAL_NATIVE_REPORT: opencode1 finished cleanly.')
      return
    }
    emitMachineroom('ses_native_sub', 'NO_REPORT')
    return
  }

  record({ role: 'unknown', argsPrefix: args.slice(0, 5) })
  process.exitCode = 1
}

await main()
`
}

function makeProject() {
  const root = tempDir('mr-owner-tree-')
  const project = join(root, 'repo')
  const runs = join(root, 'runs')
  mkdirSync(project, { recursive: true })
  mkdirSync(runs, { recursive: true })
  const git = gitPath()
  execFileSync(git, ['init', '-b', 'main'], { cwd: project })
  execFileSync(git, ['config', 'user.name', 'Test'], { cwd: project })
  execFileSync(git, ['config', 'user.email', 'test@example.com'], { cwd: project })
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'owner-tree-test', private: true }, null, 2))
  writeFileSync(join(project, 'README.md'), 'owner tree test project\n')
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

async function setupOwnerTreeRig() {
  const { root, project, runs, git } = makeProject()
  const orchScript = join(root, 'fake-orchestrator.mjs')
  const runnerScript = join(root, 'fake-runner.mjs')
  const orchLog = join(root, 'orch-turns.jsonl')
  writeFileSync(orchScript, fakeOrchestratorScript())
  writeFileSync(runnerScript, fakeRunnerScript(REPO_ROOT, git))

  const lanesFile = join(root, 'lanes.json')
  const spawns = []
  const lanes = {
    orchestrator: {
      name: 'Orchestrator',
      harness: 'Claude Code',
      cli: { harness: 'claude', bin: 'claude', model: 'claude-opus-5-5' },
    },
    agy1: {
      name: 'AGY 1',
      harness: 'AGY',
      custom: true,
      cli: { harness: 'agy', bin: process.execPath, model: 'gemini-4-hydrogen-xhigh' },
    },
    agy2: {
      name: 'AGY 2',
      harness: 'AGY',
      custom: true,
      cli: { harness: 'agy', bin: process.execPath, model: 'gemini-4-hydrogen-xhigh' },
    },
    opencode1: {
      name: 'OpenCode 1',
      harness: 'OpenCode',
      cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' },
    },
    opencode2: {
      name: 'OpenCode 2',
      harness: 'OpenCode',
      cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' },
    },
    opencode3: {
      name: 'OpenCode 3',
      harness: 'OpenCode',
      cli: { harness: 'opencode', bin: process.execPath, model: 'opencode-go/deepseek-v4.1-flash' },
    },
  }
  writeFileSync(lanesFile, JSON.stringify(lanes, null, 2))
  writeActiveLanes(activeLanesFileFor(project, runs), ['agy1', 'agy2', 'opencode1', 'opencode2', 'opencode3'])

  const bridge = createBridge({
    projectRoot: project,
    port: 0,
    env: {},
    runsFolder: runs,
    lanesFile,
    orchestratorFolder: runs,
    orchestratorHarnessAvailable: () => true,
    runnerCommand: { file: process.execPath, args: [runnerScript] },
    orchestratorSpawn(program, args, options) {
      spawns.push({ file: program, firstArg: args[0], args })
      const child = spawn(process.execPath, [orchScript, ...args], {
        ...options,
        env: { ...(options?.env ?? {}), FAKE_OWNER_TREE_LOG: orchLog },
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

async function saveOwnerTestTree(url) {
  const effortRes = await postAsPage(url, '/api/orchestrator/effort', {
    id: 'orchestrator',
    effort: 'high',
    confirmed: true,
  })
  expect(effortRes.status).toBe(200)

  const res = await postAsPage(url, '/api/orchestrator/ladder', {
    ladder: {
      subs: [
        {
          id: 'codex-sub',
          name: 'Codex Sub',
          harness: 'codex',
          model: 'gpt-6.1-terra',
          lanes: ['agy1', 'agy2'],
          scope: ['agy-work.txt'],
          setBy: 'owner',
        },
        {
          id: 'native-sub',
          name: 'Native Sub',
          harness: 'machineroom',
          model: 'z-ai/glm-5.3-flash',
          lanes: ['opencode1', 'opencode2', 'opencode3'],
          scope: ['opencode-work.txt'],
          setBy: 'owner',
        },
      ],
    },
    by: 'owner',
    confirmed: true,
  })
  expect(res.status).toBe(200)
}

afterEach(async () => {
  while (children.length > 0) await killTree(children.pop())
  while (servers.length > 0) await servers.pop().stop()
  while (dirs.length > 0) removeTempDir(dirs.pop())
})

describe("the owner's test tree", () => {
  it('saves the tree, runs both subs and their own lanes, refuses cross-sub lanes, messages between subs, and wakes each owning sub', async () => {
    const { url, project, runs, orchLog, spawns } = await setupOwnerTreeRig()
    await saveOwnerTestTree(url)

    const rosterRes = await getJson(`${url}/api/orchestrators`)
    expect(rosterRes.status).toBe(200)
    expect(rosterRes.body.find((e) => e.id === 'orchestrator')).toEqual(
      expect.objectContaining({ id: 'orchestrator', harness: 'claude', model: 'claude-opus-5-5', effort: 'high' }),
    )
    expect(rosterRes.body.find((e) => e.id === 'codex-sub')).toEqual(
      expect.objectContaining({ id: 'codex-sub', harness: 'codex', model: 'gpt-6.1-terra', lanes: ['agy1', 'agy2'] }),
    )
    expect(rosterRes.body.find((e) => e.id === 'native-sub')).toEqual(
      expect.objectContaining({
        id: 'native-sub',
        harness: 'machineroom',
        model: 'z-ai/glm-5.3-flash',
        lanes: ['opencode1', 'opencode2', 'opencode3'],
      }),
    )

    const startMsg = await postAsPage(url, '/api/orchestrator/messages', {
      from: 'owner',
      text: 'Run owner tree check.',
      confirmed: true,
    })
    expect(startMsg.status).toBe(202)

    await waitFor(() => {
      const entries = readRecords(orchLog)
      const codexDone =
        entries.some((e) => e.actor === 'codex-sub' && e.action === 'wake') &&
        entries.some((e) => e.actor === 'codex-sub' && e.action === 'peer_received')
      const nativeDone =
        entries.some((e) => e.actor === 'native-sub' && e.action === 'wake') &&
        entries.some((e) => e.actor === 'native-sub' && e.action === 'peer_received')
      const mainDone =
        entries.some((e) => e.actor === 'orchestrator' && e.action === 'main_ack_codex') &&
        entries.some((e) => e.actor === 'orchestrator' && e.action === 'main_ack_native')
      return codexDone && nativeDone && mainDone
    }, { timeoutMs: 25000, what: 'both subs start own lanes, exchange peer messages, and report to main' })

    const entries = readRecords(orchLog)
    const codexOutside = entries.find((e) => e.actor === 'codex-sub' && e.action === 'outside_run')
    const nativeOutside = entries.find((e) => e.actor === 'native-sub' && e.action === 'outside_run')
    const codexInside = entries.find((e) => e.actor === 'codex-sub' && e.action === 'inside_run')
    const nativeInside = entries.find((e) => e.actor === 'native-sub' && e.action === 'inside_run')
    const codexPeer = entries.find((e) => e.actor === 'codex-sub' && e.action === 'peer_sent')
    const nativePeer = entries.find((e) => e.actor === 'native-sub' && e.action === 'peer_sent')

    expect(codexOutside.outside.status).toBe(403)
    expect(nativeOutside.outside.status).toBe(403)
    expect(codexInside.started.status).toBe(202)
    expect(nativeInside.started.status).toBe(202)
    expect(codexPeer.peer.status).toBe(202)
    expect(nativePeer.peer.status).toBe(202)

    expect(existsSync(join(worktreeFor(project, 'agy1'), 'agy-work.txt'))).toBe(true)
    expect(existsSync(join(worktreeFor(project, 'opencode1'), 'opencode-work.txt'))).toBe(true)

    const [mainState, codexState, nativeState] = await Promise.all([
      getJson(`${url}/api/orchestrator`),
      getJson(`${url}/api/orchestrator?id=codex-sub`),
      getJson(`${url}/api/orchestrator?id=native-sub`),
    ])

    expect(
      codexState.body.messages.some((m) => m.from === 'room' && m.text.includes('agy1') && m.text.includes('ended: succeeded')),
    ).toBe(true)
    expect(codexState.body.messages.some((m) => m.from === 'room' && m.text.includes('opencode1'))).toBe(false)
    expect(
      codexState.body.messages.some((m) => m.from === 'sub:native-sub' && m.text.includes('PEER_FROM_NATIVE')),
    ).toBe(true)

    expect(
      nativeState.body.messages.some(
        (m) => m.from === 'room' && m.text.includes('opencode1') && m.text.includes('ended: succeeded'),
      ),
    ).toBe(true)
    expect(nativeState.body.messages.some((m) => m.from === 'room' && m.text.includes('agy1'))).toBe(false)
    expect(
      nativeState.body.messages.some((m) => m.from === 'sub:codex-sub' && m.text.includes('PEER_FROM_CODEX')),
    ).toBe(true)

    expect(mainState.body.messages.filter((m) => m.from === 'room')).toEqual([])
    expect(
      mainState.body.messages.some((m) => m.from === 'sub:codex-sub' && m.text.includes('FINAL_CODEX_REPORT')),
    ).toBe(true)
    expect(
      mainState.body.messages.some((m) => m.from === 'sub:native-sub' && m.text.includes('FINAL_NATIVE_REPORT')),
    ).toBe(true)

    const runsRecords = readRecords(join(runs, 'runs.jsonl'))
    expect(runsRecords.find((r) => r.lane === 'agy1')).toEqual(
      expect.objectContaining({ lane: 'agy1', startedBy: 'codex-sub', exitCode: 0 }),
    )
    expect(runsRecords.find((r) => r.lane === 'opencode1')).toEqual(
      expect.objectContaining({ lane: 'opencode1', startedBy: 'native-sub', exitCode: 0 }),
    )

    expect(spawns.some((s) => s.firstArg === '-p' && s.args.includes('claude-opus-5-5') && s.args.includes('--effort'))).toBe(true)
    expect(spawns.some((s) => s.firstArg === 'exec' && s.args.includes('gpt-6.1-terra'))).toBe(true)
    expect(spawns.some((s) => String(s.firstArg).endsWith('mr-agent.mjs') && s.args.includes('z-ai/glm-5.3-flash'))).toBe(true)
  })

  it('saves the simple form and sends a lane report to the main orchestrator', async () => {
    const { url, runs, orchLog } = await setupOwnerTreeRig()
    await saveOwnerTestTree(url)

    const clearRes = await postAsPage(url, '/api/orchestrator/ladder', {
      ladder: { subs: [] },
      by: 'owner',
      confirmed: true,
    })
    expect(clearRes.status).toBe(200)

    const rosterRes = await getJson(`${url}/api/orchestrators`)
    expect(rosterRes.status).toBe(200)
    expect(rosterRes.body.map((entry) => entry.id)).toEqual(['orchestrator'])

    const ownerMsg = await postAsPage(url, '/api/orchestrator/messages', {
      from: 'owner',
      text: 'SIMPLE_FORM_CHECK',
      confirmed: true,
    })
    expect(ownerMsg.status).toBe(202)

    await waitFor(
      () => readRecords(orchLog).some((entry) => entry.actor === 'orchestrator' && entry.action === 'simple_wake'),
      { timeoutMs: 20000, what: 'lane report reaches main orchestrator in simple form' },
    )

    const mainState = await getJson(`${url}/api/orchestrator`)
    expect(
      mainState.body.messages.some(
        (m) => m.from === 'room' && m.text.includes('opencode1') && m.text.includes('ended: succeeded'),
      ),
    ).toBe(true)
    expect(
      mainState.body.messages.some((m) => m.from === 'orchestrator' && m.text.includes('MAIN_SIMPLE_ACK')),
    ).toBe(true)

    const runsRecords = readRecords(join(runs, 'runs.jsonl'))
    expect(runsRecords.find((r) => r.lane === 'opencode1')).toEqual(
      expect.objectContaining({ lane: 'opencode1', startedBy: 'orchestrator', exitCode: 0 }),
    )
  })

  it.fails('passes high reasoning effort to the Codex sub turn command', async () => {
    const { url, orchLog, spawns } = await setupOwnerTreeRig()
    await saveOwnerTestTree(url)

    const effortRes = await postAsPage(url, '/api/orchestrator/effort', {
      id: 'codex-sub',
      effort: 'high',
      confirmed: true,
    })
    expect(effortRes.status).toBe(200)

    const msgRes = await postAsPage(url, '/api/orchestrator/messages', {
      id: 'codex-sub',
      from: 'owner',
      text: 'Check Codex effort flag.',
      confirmed: true,
    })
    expect(msgRes.status).toBe(202)

    await waitFor(
      () => readRecords(orchLog).some((entry) => entry.actor === 'codex-sub'),
      { timeoutMs: 12000, what: 'codex sub turn completes' },
    )

    const codexSpawn = spawns.find((s) => s.firstArg === 'exec')
    expect(codexSpawn.args).toContain('model_reasoning_effort=high')
  })
})
