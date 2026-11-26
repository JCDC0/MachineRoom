import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { saveHarnessSettings } from '../server/harness-settings.js'
import { chatFileFor } from '../server/orchestrator.js'
import { gitPath } from '../server/programPath.js'
import { clearRunsCache } from '../server/runs.js'
import { processAlive } from '../scripts/lane-lock.mjs'
import { startLane } from '../scripts/run-lane.mjs'
import { branchFor } from '../src/briefs/briefs.js'
import { parseQueueArgs } from '../src/briefs/queue.js'
import { INTERRUPT_PARAGRAPH, parseRunArgs } from '../src/briefs/run.js'
import { getJson, waitFor } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'
import { slowMs } from './helpers/timeout.js'

const fsHooks = vi.hoisted(() => ({
  onReadRunsFile: null,
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    readFileSync: (...args) => {
      const result = actual.readFileSync(...args)
      if (typeof fsHooks.onReadRunsFile === 'function' && typeof args[0] === 'string' && args[0].endsWith('runs.jsonl')) {
        fsHooks.onReadRunsFile(args[0], actual.appendFileSync)
      }
      return result
    },
  }
})

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const RECORDINGS = join(REPO_ROOT, 'public', 'recordings')
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'MachineRoom Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'MachineRoom Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
}
const BRIEF = { id: 'P438X', title: 'Interrupt test brief', text: 'Do it.\n\nFiles: note.txt\n' }

const cleanups = []

afterEach(async () => {
  fsHooks.onReadRunsFile = null
  clearRunsCache()
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => removeTempDir(dir))
  return dir
}

function gitIn(folder, args) {
  const result = spawnSync(gitPath(), ['-c', 'commit.gpgsign=false', ...args], {
    cwd: folder,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...GIT_IDENTITY },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${folder}: ${String(result.stderr ?? '').trim()}`)
  return String(result.stdout ?? '').trim()
}

function makeRepo(folder, script = '') {
  mkdirSync(folder, { recursive: true })
  gitIn(folder, ['init', '-q', '-b', 'main'])
  gitIn(folder, ['config', 'user.name', GIT_IDENTITY.GIT_AUTHOR_NAME])
  gitIn(folder, ['config', 'user.email', GIT_IDENTITY.GIT_AUTHOR_EMAIL])
  writeFileSync(join(folder, 'readme.txt'), 'start\n')
  if (script !== '') writeFileSync(join(folder, 'run'), script)
  gitIn(folder, ['add', '-A'])
  gitIn(folder, ['commit', '-q', '-m', 'Start the repository'])
}

function readLines(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

function readRecords(runs) {
  return readLines(join(runs, 'runs.jsonl'))
}

function interruptFiles(runs) {
  if (!existsSync(runs)) return []
  return readdirSync(runs).filter((name) => name.endsWith('.interrupt.txt'))
}

function runNameOf(record) {
  return typeof record?.log === 'string' && record.log !== '' ? basename(record.log).replace(/\.log$/i, '') : ''
}

function tokenPost(url, path, body, token) {
  return getJson(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-MachineRoom-Orchestrator': token },
    body: JSON.stringify(body),
  })
}

function pagePost(url, path, body) {
  return getJson(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  })
}

function fakeCliScript({ callsFile, releaseFile, stopAtCall = 0, writeWipOnFirst = false, checkInboxAndSend = false, holdUntilSeenText = '' }) {
  return [
    "const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs')",
    "const { spawnSync } = require('node:child_process')",
    "const { join } = require('node:path')",
    `const callsFile = ${JSON.stringify(callsFile)}`,
    `const releaseFile = ${JSON.stringify(releaseFile)}`,
    `const git = ${JSON.stringify(gitPath() || 'git')}`,
    `const writeWipOnFirst = ${JSON.stringify(writeWipOnFirst)}`,
    `const checkInboxAndSend = ${JSON.stringify(checkInboxAndSend)}`,
    `const holdUntilSeenText = ${JSON.stringify(holdUntilSeenText)}`,
    `const stopAtCall = ${JSON.stringify(stopAtCall)}`,
    "const args = process.argv.slice(2)",
    "const titleIndex = args.indexOf('--title')",
    "const title = titleIndex !== -1 ? args[titleIndex + 1] : ''",
    "const prompt = args[args.length - 1] ?? ''",
    "const branchRes = spawnSync(git, ['branch', '--show-current'], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true })",
    "const branch = String(branchRes.stdout || '').trim()",
    "const prior = existsSync(callsFile) ? readFileSync(callsFile, 'utf8').split(/\\r?\\n/).filter(Boolean).length : 0",
    "const callNumber = prior + 1",
    "if (writeWipOnFirst && callNumber === 1) {",
    "  writeFileSync(join(process.cwd(), 'wip.txt'), 'partial work\\n')",
    "  writeFileSync(join(process.cwd(), 'readme.txt'), 'edited\\n')",
    "}",
    "const wipText = existsSync(join(process.cwd(), 'wip.txt')) ? readFileSync(join(process.cwd(), 'wip.txt'), 'utf8') : null",
    "const readmeText = existsSync(join(process.cwd(), 'readme.txt')) ? readFileSync(join(process.cwd(), 'readme.txt'), 'utf8') : null",
    "async function run() {",
    "  const ticket = process.env.MACHINEROOM_LANE_TICKET ?? ''",
    "  const bridge = process.env.MACHINEROOM_BRIDGE ?? ''",
    "  let inbox = []",
    "  const postStatuses = []",
    "  if (checkInboxAndSend && bridge && ticket) {",
    "    if (callNumber === 1) {",
    "      for (let i = 1; i <= 2; i += 1) {",
    "        const r = await fetch(`${bridge}/api/orchestrator/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-MachineRoom-Lane': ticket }, body: JSON.stringify({ text: `From run 1 #${i}` }) })",
    "        postStatuses.push(r.status)",
    "      }",
    "    } else {",
    "      const g = await fetch(`${bridge}/api/orchestrator/messages`, { headers: { 'X-MachineRoom-Lane': ticket } })",
    "      inbox = (await g.json()).messages ?? []",
    "      for (let i = 1; i <= 3; i += 1) {",
    "        const r = await fetch(`${bridge}/api/orchestrator/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-MachineRoom-Lane': ticket }, body: JSON.stringify({ text: `From run 2 #${i}` }) })",
    "        postStatuses.push(r.status)",
    "      }",
    "    }",
    "  }",
    "  appendFileSync(callsFile, JSON.stringify({ callNumber, pid: process.pid, title, prompt, cwd: process.cwd(), branch, ticket, wipText, readmeText, inbox, postStatuses }) + '\\n')",
    "  if (holdUntilSeenText && bridge && ticket) {",
    "    while (true) {",
    "      const g = await fetch(`${bridge}/api/orchestrator/messages`, { headers: { 'X-MachineRoom-Lane': ticket } })",
    "      const data = await g.json()",
    "      const msgs = data.messages ?? []",
    "      if (msgs.some((m) => String(m.text).includes(holdUntilSeenText))) {",
    "        appendFileSync(callsFile, JSON.stringify({ seenInInbox: msgs, callNumber }) + '\\n')",
    "        break",
    "      }",
    "      if (existsSync(releaseFile)) break",
    "      await new Promise((done) => setTimeout(done, 25))",
    "    }",
    "  } else if (stopAtCall === 0 || callNumber < stopAtCall) {",
    "    while (!existsSync(releaseFile)) await new Promise((done) => setTimeout(done, 25))",
    "  }",
    "  console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
    "}",
    "run().catch((err) => { console.error(err); process.exit(1) })",
    '',
  ].join('\n')
}

async function makeBridgeRig({ laneReplies = 'next-turn', script = '', harness = 'opencode', laneKey = 'opencode', extraLanes = {} } = {}) {
  const base = tempDir('mr-lane-interrupt-')
  const runs = join(base, 'runs')
  const project = join(base, 'project')
  mkdirSync(runs, { recursive: true })
  saveHarnessSettings(runs, { programs: {}, off: [], laneReplies })
  makeRepo(project, script)

  const promptFile = join(base, 'orchestrator-agent.md')
  writeFileSync(promptFile, 'project={{PROJECT}}\nruns={{RUNS}}\nbridge={{BRIDGE}}\n')
  writeFileSync(
    chatFileFor(project, runs, 'orchestrator'),
    `${JSON.stringify({ project, sessionId: null, state: 'idle', messages: [], pending: [] })}\n`
  )
  const lanes = {
    orchestrator: { name: 'Orchestrator', harness: 'Claude Code', cli: { harness: 'claude', bin: 'claude', model: 'opus' } },
    [laneKey]: {
      name: 'Fake CLI Lane',
      harness: harness === 'machineroom' ? 'MachineRoom' : 'OpenCode',
      cli: { harness, bin: process.execPath, model: 'fake/model' },
    },
    ...extraLanes,
  }
  const lanesFile = join(base, 'lanes.json')
  writeFileSync(lanesFile, `${JSON.stringify(lanes, null, 2)}\n`)
  writeActiveLanes(activeLanesFileFor(project, runs), [laneKey, ...Object.keys(extraLanes)])

  const bridge = createBridge({
    projectRoot: project,
    port: 0,
    env: {},
    briefsDir: join(REPO_ROOT, 'docs', 'agents'),
    lanesFile,
    runsFolder: runs,
    orchestratorPrompt: promptFile,
    lanesSource: { folder: runs, lanes, repoRoot: project, pollMs: 20, quietMs: 60000 },
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return {
    base,
    runs,
    project,
    url,
    bridge,
    token: (id = 'orchestrator') => bridge.orchestrators().token(id),
  }
}

describe('interrupting a working CLI lane run', { timeout: slowMs(180000) }, () => {
  const CLI_WAIT_MS = slowMs(30000)
  const CONTINUATION_WAIT_MS = slowMs(45000)
  it('never stops a run when laneReplies is next-turn', async () => {
    const tmp = tempDir('mr-interrupt-next-turn-')
    const callsFile = join(tmp, 'calls.jsonl')
    const releaseFile = join(tmp, 'release')
    const rig = await makeBridgeRig({
      laneReplies: 'next-turn',
      script: fakeCliScript({ callsFile, releaseFile, holdUntilSeenText: 'Wait for next turn.' }),
    })

    const started = await pagePost(rig.url, '/api/control/runs', {
      lane: 'opencode',
      task: 'Do the work.',
      worktree: true,
      confirmed: true,
    })
    expect(started.status).toBe(202)

    const call = await waitFor(() => readLines(callsFile).find((line) => line.callNumber === 1), {
      timeoutMs: CLI_WAIT_MS,
      what: 'first CLI invocation',
    })

    const sent = await tokenPost(
      rig.url,
      '/api/orchestrator/messages',
      { to: 'lane:opencode', text: 'Wait for next turn.' },
      rig.token('orchestrator')
    )
    expect(sent.status).toBe(202)

    const seen = await waitFor(() => readLines(callsFile).find((line) => Array.isArray(line.seenInInbox)), {
      timeoutMs: CLI_WAIT_MS,
      what: 'running lane to read message from inbox',
    })
    expect(seen.seenInInbox.map((m) => m.text)).toEqual(['Wait for next turn.'])

    await waitFor(
      async () => (await getJson(`${rig.url}/api/control/runs`)).body.running.length === 0,
      { timeoutMs: CLI_WAIT_MS, what: 'run to finish' }
    )

    const invocations = readLines(callsFile).filter((line) => line.callNumber && !line.seenInInbox)
    expect(invocations).toHaveLength(1)
    expect(invocations[0].pid).toBe(call.pid)
    expect(interruptFiles(rig.runs)).toEqual([])
    const records = readRecords(rig.runs)
    expect(records).toHaveLength(1)
    expect(records[0].exitCode).toBe(0)
    expect(Object.hasOwn(records[0], 'continues')).toBe(false)
    expect(Object.hasOwn(records[0], 'interruptedBy')).toBe(false)
  })

  it('stops the run, keeps uncommitted work and branch, passes prompt and ticket, and records continues and interruptedBy', async () => {
    const tmp = tempDir('mr-interrupt-continue-')
    const callsFile = join(tmp, 'calls.jsonl')
    const releaseFile = join(tmp, 'release')
    const rig = await makeBridgeRig({
      laneReplies: 'interrupt',
      script: fakeCliScript({ callsFile, releaseFile, stopAtCall: 2, writeWipOnFirst: true, checkInboxAndSend: true }),
    })

    const started = await pagePost(rig.url, '/api/control/runs', {
      lane: 'opencode',
      task: 'Build the widget.',
      worktree: true,
      confirmed: true,
    })
    expect(started.status).toBe(202)

    const firstCall = await waitFor(() => readLines(callsFile).find((line) => line.callNumber === 1), {
      timeoutMs: CLI_WAIT_MS,
      what: 'first CLI invocation',
    })
    expect(firstCall.postStatuses).toEqual([202, 202])

    const sent = await tokenPost(
      rig.url,
      '/api/orchestrator/messages',
      { to: 'lane:opencode', text: 'Use the shared helper.' },
      rig.token('orchestrator')
    )
    expect(sent.status).toBe(202)

    const secondCall = await waitFor(() => readLines(callsFile).find((line) => line.callNumber === 2), {
      timeoutMs: CONTINUATION_WAIT_MS,
      what: 'continuation CLI invocation',
    })

    await waitFor(
      async () => (await getJson(`${rig.url}/api/control/runs`)).body.running.length === 0,
      { timeoutMs: CLI_WAIT_MS, what: 'continuation run to finish' }
    )

    expect(processAlive(firstCall.pid)).toBe(false)
    expect(secondCall.cwd).toBe(firstCall.cwd)
    expect(secondCall.branch).toBe(firstCall.branch)
    expect(secondCall.branch).toMatch(/^machineroom\/queue-opencode-/)
    expect(secondCall.wipText).toBe('partial work\n')
    expect(secondCall.readmeText).toBe('edited\n')
    expect(secondCall.prompt).toContain('Build the widget.')
    expect(secondCall.prompt).toContain(INTERRUPT_PARAGRAPH)
    expect(secondCall.prompt).toContain('orchestrator: Use the shared helper.')
    expect(secondCall.ticket).toBe(firstCall.ticket)
    expect(secondCall.inbox).toEqual([])
    expect(secondCall.postStatuses).toEqual([202, 202, 429])

    const files = interruptFiles(rig.runs)
    expect(files).toHaveLength(1)
    const interruptContent = readFileSync(join(rig.runs, files[0]), 'utf8')
    expect(interruptContent).toContain(INTERRUPT_PARAGRAPH)
    expect(interruptContent).toContain('orchestrator: Use the shared helper.')

    const records = readRecords(rig.runs)
    expect(records).toHaveLength(2)
    const firstName = runNameOf(records[0])
    expect(firstName).not.toBe('')
    expect(records[0].killed).toBe(true)
    expect(Object.hasOwn(records[0], 'interruptedBy')).toBe(false)
    expect(records[1].continues).toBe(firstName)
    expect(records[1].interruptedBy).toBe('orchestrator')
    expect(records[1].exitCode).toBe(0)
    expect(records[1].branch).toBe(firstCall.branch)
    expect(gitIn(secondCall.cwd, ['status', '--porcelain'])).toBe('')
    expect(readFileSync(join(secondCall.cwd, 'wip.txt'), 'utf8')).toBe('partial work\n')
  })

  it('allows at most three interrupts per first run and lets the fourth wait for the next turn', async () => {
    const tmp = tempDir('mr-interrupt-cap-')
    const callsFile = join(tmp, 'calls.jsonl')
    const releaseFile = join(tmp, 'release')
    const script = [
      "const { appendFileSync, existsSync, readFileSync } = require('node:fs')",
      `const callsFile = ${JSON.stringify(callsFile)}`,
      `const releaseFile = ${JSON.stringify(releaseFile)}`,
      "const args = process.argv.slice(2)",
      "const prompt = args[args.length - 1] ?? ''",
      "const prior = existsSync(callsFile) ? readFileSync(callsFile, 'utf8').split(/\\r?\\n/).filter(Boolean).filter((l) => JSON.parse(l).callNumber).length : 0",
      "const callNumber = prior + 1",
      "appendFileSync(callsFile, JSON.stringify({ callNumber, pid: process.pid, prompt, cwd: process.cwd() }) + '\\n')",
      "async function run() {",
      "  const ticket = process.env.MACHINEROOM_LANE_TICKET ?? ''",
      "  const bridge = process.env.MACHINEROOM_BRIDGE ?? ''",
      "  if (callNumber === 4 && bridge && ticket) {",
      "    while (true) {",
      "      const g = await fetch(`${bridge}/api/orchestrator/messages`, { headers: { 'X-MachineRoom-Lane': ticket } })",
      "      const msgs = (await g.json()).messages ?? []",
      "      if (msgs.some((m) => String(m.text).includes('Message 4 waits.'))) {",
      "        appendFileSync(callsFile, JSON.stringify({ fourthSaw: msgs.map((m) => m.text) }) + '\\n')",
      "        break",
      "      }",
      "      if (existsSync(releaseFile)) break",
      "      await new Promise((done) => setTimeout(done, 25))",
      "    }",
      "  } else {",
      "    while (!existsSync(releaseFile)) await new Promise((done) => setTimeout(done, 25))",
      "  }",
      "  console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
      "}",
      "run().catch((err) => { console.error(err); process.exit(1) })",
      '',
    ].join('\n')

    const rig = await makeBridgeRig({
      laneReplies: 'interrupt',
      script,
    })

    const started = await pagePost(rig.url, '/api/control/runs', {
      lane: 'opencode',
      task: 'Chained task.',
      worktree: true,
      confirmed: true,
    })
    expect(started.status).toBe(202)

    for (let step = 1; step <= 3; step += 1) {
      await waitFor(() => readLines(callsFile).find((line) => line.callNumber === step), {
        timeoutMs: CLI_WAIT_MS,
        what: `CLI invocation ${step}`,
      })
      const sent = await tokenPost(
        rig.url,
        '/api/orchestrator/messages',
        { to: 'lane:opencode', text: `Interrupt ${step}.` },
        rig.token('orchestrator')
      )
      expect(sent.status).toBe(202)
      await waitFor(() => readLines(callsFile).find((line) => line.callNumber === step + 1), {
        timeoutMs: CONTINUATION_WAIT_MS,
        what: `continuation CLI invocation ${step + 1}`,
      })
    }

    const call4 = readLines(callsFile).find((line) => line.callNumber === 4)
    expect(call4).toBeDefined()

    const fourth = await tokenPost(
      rig.url,
      '/api/orchestrator/messages',
      { to: 'lane:opencode', text: 'Message 4 waits.' },
      rig.token('orchestrator')
    )
    expect(fourth.status).toBe(202)

    const fourthSeen = await waitFor(() => readLines(callsFile).find((line) => Array.isArray(line.fourthSaw)), {
      timeoutMs: CLI_WAIT_MS,
      what: 'fourth run to read fourth message from inbox',
    })
    expect(fourthSeen.fourthSaw).toContain('Message 4 waits.')

    await waitFor(
      async () => (await getJson(`${rig.url}/api/control/runs`)).body.running.length === 0,
      { timeoutMs: CLI_WAIT_MS, what: 'fourth run to finish' }
    )

    const calls = readLines(callsFile).filter((line) => line.callNumber)
    expect(calls).toHaveLength(4)
    expect(interruptFiles(rig.runs)).toHaveLength(3)

    const records = readRecords(rig.runs)
    expect(records).toHaveLength(4)
    expect(Object.hasOwn(records[0], 'interruptedBy')).toBe(false)
    expect(records[1].continues).toBe(runNameOf(records[0]))
    expect(records[1].interruptedBy).toBe('orchestrator')
    expect(records[2].continues).toBe(runNameOf(records[1]))
    expect(records[2].interruptedBy).toBe('orchestrator')
    expect(records[3].continues).toBe(runNameOf(records[2]))
    expect(records[3].interruptedBy).toBe('orchestrator')
    expect(records[3].exitCode).toBe(0)
  })

  it('continues a brief run on the same branch with uncommitted work via startLane', async () => {
    const base = tempDir('mr-interrupt-brief-')
    const worktree = join(base, '.worktrees', 'opencode')
    const runs = join(base, 'runs')
    const promptOut = join(base, 'continued-prompt.txt')
    const wipOut = join(base, 'seen-wip.txt')
    const script = [
      "const { readFileSync, writeFileSync } = require('node:fs')",
      `writeFileSync(${JSON.stringify(promptOut)}, process.argv[process.argv.length - 1])`,
      `writeFileSync(${JSON.stringify(wipOut)}, readFileSync('wip.txt', 'utf8'))`,
      "writeFileSync('note.txt', 'done\\n')",
      "console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
      '',
    ].join('\n')
    const firstBranch = branchFor(BRIEF)
    makeRepo(worktree, script)
    mkdirSync(runs, { recursive: true })
    gitIn(worktree, ['switch', '-c', firstBranch])
    writeFileSync(join(worktree, 'committed.txt'), 'first\n')
    gitIn(worktree, ['add', '-A'])
    gitIn(worktree, ['commit', '-q', '-m', 'First commit on brief branch'])
    writeFileSync(join(worktree, 'wip.txt'), 'uncommitted brief work\n')

    const firstName = 'opencode-P438X-20261116-120000'
    const firstLog = join(runs, `${firstName}.log`)
    writeFileSync(firstLog, '')
    const runsPath = join(runs, 'runs.jsonl')
    writeFileSync(
      runsPath,
      `${JSON.stringify({
        lane: 'opencode',
        briefs: ['P438X'],
        model: 'fake/model',
        startedAt: '2026-11-16T12:00:00.000Z',
        minutes: 0.1,
        exitCode: 1,
        killed: true,
        log: firstLog,
        branch: firstBranch,
        commits: [],
      })}\n`
    )
    const beforeRaw = readFileSync(runsPath, 'utf8')
    writeFileSync(
      join(runs, `${firstName}.interrupt.txt`),
      `${INTERRUPT_PARAGRAPH}\n\nsub:backend: Keep the existing branch.\n`
    )

    const lanes = {
      opencode: {
        name: 'OpenCode',
        worktree,
        cli: { harness: 'opencode', bin: process.execPath, model: 'fake/model', commits: 'runner' },
      },
    }
    const indexPath = join(RECORDINGS, 'index.json')
    const recordingsExisted = existsSync(RECORDINGS)
    const indexBefore = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null
    const saved = process.env.MACHINEROOM_RUNS
    process.env.MACHINEROOM_RUNS = runs
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const check = { mainCheckout: dirname(runs), lanes, home: join(dirname(runs), 'home'), temp: join(dirname(runs), 'temp'), runs }
      const result = await startLane({
        options: { lane: 'opencode', minutes: 1, continueFrom: firstName, folderCheck: check },
        lane: lanes.opencode,
        lanes,
        wanted: [BRIEF],
        prompt: 'Original brief prompt.',
        logPath: join(runs, 'opencode-P438X-20261116-120001.log'),
        usageFile: join(runs, 'opencode-P438X-20261116-120001.usage.json'),
        name: 'opencode-P438X-20261116-120001',
      })
      expect(result.code).toBe(0)
    } finally {
      spy.mockRestore()
      if (saved === undefined) delete process.env.MACHINEROOM_RUNS
      else process.env.MACHINEROOM_RUNS = saved
      for (const name of [firstName, 'opencode-P438X-20261116-120001']) {
        for (const suffix of ['run.jsonl', 'agents.json', 'tree.json']) {
          rmSync(join(RECORDINGS, `${name}-${suffix}`), { force: true })
        }
      }
      if (!recordingsExisted) rmSync(RECORDINGS, { recursive: true, force: true })
      else if (indexBefore !== null) writeFileSync(indexPath, indexBefore)
      else rmSync(indexPath, { force: true })
    }

    expect(gitIn(worktree, ['branch', '--show-current'])).toBe(firstBranch)
    expect(readFileSync(wipOut, 'utf8')).toBe('uncommitted brief work\n')
    const continuedPrompt = readFileSync(promptOut, 'utf8')
    expect(continuedPrompt).toContain('Original brief prompt.')
    expect(continuedPrompt).toContain(INTERRUPT_PARAGRAPH)
    expect(continuedPrompt).toContain('sub:backend: Keep the existing branch.')

    const afterRaw = readFileSync(runsPath, 'utf8')
    expect(afterRaw.startsWith(beforeRaw)).toBe(true)
    const records = readRecords(runs)
    expect(records).toHaveLength(2)
    expect(Object.hasOwn(records[0], 'interruptedBy')).toBe(false)
    expect(records[1].continues).toBe(firstName)
    expect(records[1].interruptedBy).toBe('sub:backend')
    expect(records[1].branch).toBe(firstBranch)
  })

  it('leaves every earlier line of runs.jsonl byte for byte as it was and keeps a record appended during the interrupt', async () => {
    const base = tempDir('mr-interrupt-append-')
    const worktree = join(base, '.worktrees', 'opencode')
    const runs = join(base, 'runs')
    const script = [
      "const { writeFileSync } = require('node:fs')",
      "writeFileSync('note.txt', 'done\\n')",
      "console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
      '',
    ].join('\n')
    const firstBranch = branchFor(BRIEF)
    makeRepo(worktree, script)
    mkdirSync(runs, { recursive: true })
    gitIn(worktree, ['switch', '-c', firstBranch])

    const firstName = 'opencode-P438X-20261116-120500'
    const firstLog = join(runs, `${firstName}.log`)
    writeFileSync(firstLog, '')
    const runsPath = join(runs, 'runs.jsonl')
    const earlierLine = '{"lane": "agy", "briefs": ["P100"], "startedAt": "2026-11-16T11:00:00.000Z", "exitCode": 0}\n'
    const firstLine = `{"lane": "opencode", "briefs": ["P438X"], "model": "fake/model", "startedAt": "2026-11-16T12:05:00.000Z", "minutes": 0.1, "exitCode": 1, "killed": true, "log": ${JSON.stringify(firstLog)}, "branch": ${JSON.stringify(firstBranch)}, "commits": []}\n`
    writeFileSync(runsPath, `${earlierLine}${firstLine}`)
    const beforeRaw = readFileSync(runsPath, 'utf8')
    writeFileSync(
      join(runs, `${firstName}.interrupt.txt`),
      `${INTERRUPT_PARAGRAPH}\n\nsub:backend: Keep concurrent records.\n`
    )

    let concurrentSeq = 0
    fsHooks.onReadRunsFile = (filePath, append) => {
      if (resolve(filePath) !== resolve(runsPath)) return
      concurrentSeq += 1
      append(
        filePath,
        `${JSON.stringify({
          lane: 'agy2',
          briefs: ['P999'],
          startedAt: `2026-11-16T12:05:0${concurrentSeq}.000Z`,
          exitCode: 0,
          marker: `concurrent-${concurrentSeq}`,
        })}\n`
      )
    }

    const lanes = {
      opencode: {
        name: 'OpenCode',
        worktree,
        cli: { harness: 'opencode', bin: process.execPath, model: 'fake/model', commits: 'runner' },
      },
    }
    const indexPath = join(RECORDINGS, 'index.json')
    const recordingsExisted = existsSync(RECORDINGS)
    const indexBefore = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null
    const saved = process.env.MACHINEROOM_RUNS
    process.env.MACHINEROOM_RUNS = runs
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const check = { mainCheckout: dirname(runs), lanes, home: join(dirname(runs), 'home'), temp: join(dirname(runs), 'temp'), runs }
      const result = await startLane({
        options: { lane: 'opencode', minutes: 1, continueFrom: firstName, folderCheck: check },
        lane: lanes.opencode,
        lanes,
        wanted: [BRIEF],
        prompt: 'Original brief prompt.',
        logPath: join(runs, 'opencode-P438X-20261116-120501.log'),
        usageFile: join(runs, 'opencode-P438X-20261116-120501.usage.json'),
        name: 'opencode-P438X-20261116-120501',
      })
      expect(result.code).toBe(0)
    } finally {
      fsHooks.onReadRunsFile = null
      spy.mockRestore()
      if (saved === undefined) delete process.env.MACHINEROOM_RUNS
      else process.env.MACHINEROOM_RUNS = saved
      for (const name of [firstName, 'opencode-P438X-20261116-120501']) {
        for (const suffix of ['run.jsonl', 'agents.json', 'tree.json']) {
          rmSync(join(RECORDINGS, `${name}-${suffix}`), { force: true })
        }
      }
      if (!recordingsExisted) rmSync(RECORDINGS, { recursive: true, force: true })
      else if (indexBefore !== null) writeFileSync(indexPath, indexBefore)
      else rmSync(indexPath, { force: true })
    }

    const afterRaw = readFileSync(runsPath, 'utf8')
    expect(afterRaw.startsWith(beforeRaw)).toBe(true)
    const records = readRecords(runs)
    expect(concurrentSeq).toBeGreaterThan(0)
    for (let i = 1; i <= concurrentSeq; i += 1) {
      expect(records.some((record) => record.marker === `concurrent-${i}`)).toBe(true)
    }
    const continuation = records.find((record) => record.continues === firstName)
    expect(continuation).toBeDefined()
    expect(continuation.interruptedBy).toBe('sub:backend')
    expect(Object.hasOwn(records[1], 'interruptedBy')).toBe(false)
  })

  it('keeps each interrupt sender on its own continuation record across multiple senders', async () => {
    const tmp = tempDir('mr-interrupt-senders-')
    const callsFile = join(tmp, 'calls.jsonl')
    const releaseFile = join(tmp, 'release')
    const script = [
      "const { appendFileSync, existsSync, readFileSync } = require('node:fs')",
      `const callsFile = ${JSON.stringify(callsFile)}`,
      `const releaseFile = ${JSON.stringify(releaseFile)}`,
      "const args = process.argv.slice(2)",
      "const titleIndex = args.indexOf('--title')",
      "const title = titleIndex !== -1 ? args[titleIndex + 1] : ''",
      "const lane = title.startsWith('helper-') ? 'helper' : 'opencode'",
      "const existing = existsSync(callsFile) ? readFileSync(callsFile, 'utf8').split(/\\r?\\n/).filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.lane === lane).length : 0",
      "const callNumber = existing + 1",
      "appendFileSync(callsFile, JSON.stringify({ lane, callNumber, ticket: process.env.MACHINEROOM_LANE_TICKET ?? '' }) + '\\n')",
      "async function run() {",
      "  if (!(lane === 'opencode' && callNumber === 3)) {",
      "    while (!existsSync(releaseFile)) await new Promise((done) => setTimeout(done, 25))",
      "  }",
      "  console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
      "}",
      "run().catch((err) => { console.error(err); process.exit(1) })",
      '',
    ].join('\n')

    const rig = await makeBridgeRig({
      laneReplies: 'interrupt',
      script,
      extraLanes: {
        helper: {
          name: 'Helper CLI Lane',
          harness: 'OpenCode',
          cli: { harness: 'opencode', bin: process.execPath, model: 'fake/model' },
        },
      },
    })

    try {
      expect((await pagePost(rig.url, '/api/control/runs', { lane: 'opencode', task: 'Main task.', worktree: true, confirmed: true })).status).toBe(202)
      expect((await pagePost(rig.url, '/api/control/runs', { lane: 'helper', task: 'Helper task.', worktree: true, confirmed: true })).status).toBe(202)

      await waitFor(() => readLines(callsFile).find((line) => line.lane === 'opencode' && line.callNumber === 1), {
        timeoutMs: CLI_WAIT_MS,
        what: 'opencode call 1',
      })
      const helperCall = await waitFor(() => readLines(callsFile).find((line) => line.lane === 'helper' && line.callNumber === 1), {
        timeoutMs: CLI_WAIT_MS,
        what: 'helper call 1',
      })

      expect(
        (
          await tokenPost(
            rig.url,
            '/api/orchestrator/messages',
            { to: 'lane:opencode', text: 'First from orchestrator.' },
            rig.token('orchestrator')
          )
        ).status
      ).toBe(202)

      await waitFor(() => readLines(callsFile).find((line) => line.lane === 'opencode' && line.callNumber === 2), {
        timeoutMs: CONTINUATION_WAIT_MS,
        what: 'opencode call 2',
      })

      const firstRecordRaw = await waitFor(
        () => {
          const runsPath = join(rig.runs, 'runs.jsonl')
          if (!existsSync(runsPath)) return null
          const lines = readFileSync(runsPath, 'utf8').split(/\r?\n/).filter(Boolean)
          return lines.find((line) => JSON.parse(line).lane === 'opencode') ?? null
        },
        { timeoutMs: CLI_WAIT_MS, what: 'first opencode record in runs.jsonl' }
      )
      expect(Object.hasOwn(JSON.parse(firstRecordRaw), 'interruptedBy')).toBe(false)

      const fromHelper = await getJson(`${rig.url}/api/orchestrator/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-MachineRoom-Lane': helperCall.ticket },
        body: JSON.stringify({ to: 'lane:opencode', text: 'Second from helper.' }),
      })
      expect(fromHelper.status).toBe(202)

      await waitFor(() => readLines(callsFile).find((line) => line.lane === 'opencode' && line.callNumber === 3), {
        timeoutMs: CONTINUATION_WAIT_MS,
        what: 'opencode call 3',
      })

      writeFileSync(releaseFile, 'go\n')
      await waitFor(
        async () => (await getJson(`${rig.url}/api/control/runs`)).body.running.length === 0,
        { timeoutMs: CLI_WAIT_MS, what: 'all runs to finish' }
      )

      const rawLines = readFileSync(join(rig.runs, 'runs.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean)
      const opencodeRawLines = rawLines.filter((line) => JSON.parse(line).lane === 'opencode')
      expect(opencodeRawLines[0]).toBe(firstRecordRaw)

      const records = readRecords(rig.runs)
      const opencodeRecords = records.filter((record) => record.lane === 'opencode')
      const helperRecords = records.filter((record) => record.lane === 'helper')
      expect(opencodeRecords).toHaveLength(3)
      expect(helperRecords).toHaveLength(1)
      expect(Object.hasOwn(opencodeRecords[0], 'continues')).toBe(false)
      expect(Object.hasOwn(opencodeRecords[0], 'interruptedBy')).toBe(false)
      expect(opencodeRecords[1].continues).toBe(runNameOf(opencodeRecords[0]))
      expect(opencodeRecords[1].interruptedBy).toBe('orchestrator')
      expect(opencodeRecords[2].continues).toBe(runNameOf(opencodeRecords[1]))
      expect(opencodeRecords[2].interruptedBy).toBe('lane:helper')
      expect(helperRecords[0].exitCode).toBe(0)
    } finally {
      writeFileSync(releaseFile, 'go\n')
    }
  })

  it('parses and validates --continue-from for run and queue arguments', () => {
    expect(parseRunArgs(['opencode', 'P438b', '--continue-from', 'opencode-P438b-20261116-120000'])).toMatchObject({
      lane: 'opencode',
      briefs: ['P438b'],
      continueFrom: 'opencode-P438b-20261116-120000',
    })
    expect(parseQueueArgs(['opencode', '--project', 'proj', '--queue', 'q.txt', '--continue-from=run-1'])).toMatchObject({
      lane: 'opencode',
      project: 'proj',
      queue: 'q.txt',
      continueFrom: 'run-1',
    })
    expect(() => parseRunArgs(['opencode', 'P438b', '--continue-from', '../bad'])).toThrow('--continue-from needs a run name.')
    expect(() => parseQueueArgs(['opencode', '--project', 'proj', '--queue', 'q.txt', '--continue-from', ''])).toThrow('--continue-from needs a run name.')
  })

  it('does not stop a machineroom lane when laneReplies is interrupt', async () => {
    const tmp = tempDir('mr-interrupt-native-')
    const callsFile = join(tmp, 'calls.jsonl')
    const releaseFile = join(tmp, 'release')
    const base = tempDir('mr-interrupt-native-rig-')
    const runs = join(base, 'runs')
    const project = join(base, 'project')
    mkdirSync(runs, { recursive: true })
    saveHarnessSettings(runs, { programs: {}, off: [], laneReplies: 'interrupt' })
    makeRepo(project)
    const promptFile = join(base, 'orchestrator-agent.md')
    writeFileSync(promptFile, 'project={{PROJECT}}\nruns={{RUNS}}\nbridge={{BRIDGE}}\n')
    writeFileSync(
      chatFileFor(project, runs, 'orchestrator'),
      `${JSON.stringify({ project, sessionId: null, state: 'idle', messages: [], pending: [] })}\n`
    )
    const runner = join(base, 'native-runner.mjs')
    writeFileSync(
      runner,
      [
        "import { appendFileSync, existsSync } from 'node:fs'",
        `appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ ticket: process.env.MACHINEROOM_LANE_TICKET ?? '' }) + '\\n')`,
        `while (!existsSync(${JSON.stringify(releaseFile)})) await new Promise((done) => setTimeout(done, 25))`,
      ].join('\n')
    )
    const lanes = {
      orchestrator: { name: 'Orchestrator', harness: 'Claude Code', cli: { harness: 'claude', bin: 'claude', model: 'opus' } },
      native: { name: 'Direct API', harness: 'MachineRoom', cli: { harness: 'machineroom', model: 'test/model' } },
    }
    const lanesFile = join(base, 'lanes.json')
    writeFileSync(lanesFile, `${JSON.stringify(lanes, null, 2)}\n`)
    writeActiveLanes(activeLanesFileFor(project, runs), ['native'])

    const bridge = createBridge({
      projectRoot: project,
      port: 0,
      env: {},
      briefsDir: join(REPO_ROOT, 'docs', 'agents'),
      lanesFile,
      runsFolder: runs,
      orchestratorPrompt: promptFile,
      lanesSource: { folder: runs, lanes, repoRoot: project, pollMs: 20, quietMs: 60000 },
      runnerCommand: { file: process.execPath, args: [runner] },
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const started = await pagePost(url, '/api/control/runs', {
      lane: 'native',
      task: 'Run native.',
      confirmed: true,
    })
    expect(started.status).toBe(202)
    const call = await waitFor(() => readLines(callsFile)[0], { timeoutMs: CLI_WAIT_MS, what: 'native runner' })

    const sent = await tokenPost(
      url,
      '/api/orchestrator/messages',
      { to: 'lane:native', text: 'Handle internally.' },
      bridge.orchestrators().token('orchestrator')
    )
    expect(sent.status).toBe(202)
    await new Promise((done) => setTimeout(done, 150))

    expect(interruptFiles(runs)).toEqual([])
    expect(readLines(callsFile)).toHaveLength(1)
    const inbox = await getJson(`${url}/api/orchestrator/messages`, {
      headers: { 'X-MachineRoom-Lane': call.ticket },
    })
    expect(inbox.body.messages.map((m) => m.text)).toEqual(['Handle internally.'])

    writeFileSync(releaseFile, 'go\n')
    await waitFor(
      async () => (await getJson(`${url}/api/control/runs`)).body.running.length === 0,
      { timeoutMs: CLI_WAIT_MS, what: 'native runner to finish' }
    )
  })
})
