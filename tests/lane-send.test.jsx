import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBridge } from '../server/index.js'
import { createOrchestrators } from '../server/orchestrators.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { saveHarnessSettings } from '../server/harness-settings.js'
import { chatFileFor } from '../server/orchestrator.js'
import { gitPath } from '../server/programPath.js'
import { clearRunsCache } from '../server/runs.js'
import LaneConversation from '../src/ui/LaneConversation.jsx'
import { runClock } from '../src/ui/laneConversation.js'
import { getJson, waitFor } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'
import { slowMs } from './helpers/timeout.js'
import { click, settle, type, withDom } from './helpers/uiDom.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'MachineRoom Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'MachineRoom Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
}

const cleanups = []

afterEach(async () => {
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
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${folder}: ${String(result.stderr ?? '').trim()}`)
  }
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

function pagePost(url, path, body) {
  return getJson(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  })
}

function pageGet(url, path) {
  return getJson(url + path, {
    headers: { origin: 'http://localhost:5173' },
  })
}

function tokenPost(url, path, body, token) {
  return getJson(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-MachineRoom-Orchestrator': token },
    body: JSON.stringify(body),
  })
}

function lanePost(url, path, ticket, body) {
  return getJson(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-MachineRoom-Lane': ticket },
    body: JSON.stringify(body),
  })
}

function fakeCliScript({ callsFile, releaseFile, stopAtCall = 0, holdUntilSeenText = '' }) {
  return [
    "const { appendFileSync, existsSync, readFileSync } = require('node:fs')",
    `const callsFile = ${JSON.stringify(callsFile)}`,
    `const releaseFile = ${JSON.stringify(releaseFile)}`,
    `const stopAtCall = ${JSON.stringify(stopAtCall)}`,
    `const holdUntilSeenText = ${JSON.stringify(holdUntilSeenText)}`,
    "const args = process.argv.slice(2)",
    "const prompt = args[args.length - 1] ?? ''",
    "const prior = existsSync(callsFile) ? readFileSync(callsFile, 'utf8').split(/\\r?\\n/).filter(Boolean).filter((line) => JSON.parse(line).callNumber).length : 0",
    "const callNumber = prior + 1",
    "async function run() {",
    "  const ticket = process.env.MACHINEROOM_LANE_TICKET ?? ''",
    "  const bridge = process.env.MACHINEROOM_BRIDGE ?? ''",
    "  appendFileSync(callsFile, JSON.stringify({ callNumber, pid: process.pid, prompt, ticket }) + '\\n')",
    "  if (holdUntilSeenText && bridge && ticket) {",
    "    while (true) {",
    "      const response = await fetch(`${bridge}/api/orchestrator/messages`, { headers: { 'X-MachineRoom-Lane': ticket } })",
    "      const data = await response.json()",
    "      const messages = data.messages ?? []",
    "      if (messages.some((message) => String(message.text).includes(holdUntilSeenText))) {",
    "        appendFileSync(callsFile, JSON.stringify({ seenInInbox: messages, callNumber }) + '\\n')",
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
    "run().catch((error) => { console.error(error); process.exit(1) })",
    '',
  ].join('\n')
}

async function makeBridgeRig({
  laneReplies = 'next-turn',
  script = '',
  harness = 'opencode',
  laneKey = 'opencode',
  extraLanes = {},
} = {}) {
  const base = tempDir('mr-lane-send-')
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
      name: harness === 'machineroom' ? 'Direct API' : 'OpenCode',
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
  return { base, runs, project, url, bridge }
}

describe('page sends to a running lane', { timeout: slowMs(120000) }, () => {
  const CLI_WAIT_MS = slowMs(30000)
  it('lets the page send to lane:KEY, sets owner as sender, returns an id and answers 409 when idle', async () => {
    const tmp = tempDir('mr-lane-send-owner-')
    const callsFile = join(tmp, 'calls.jsonl')
    const releaseFile = join(tmp, 'release')
    const rig = await makeBridgeRig({
      laneReplies: 'next-turn',
      script: fakeCliScript({ callsFile, releaseFile, holdUntilSeenText: 'Check the header.' }),
    })

    const before = await pagePost(rig.url, '/api/orchestrator/messages', {
      to: 'lane:opencode',
      text: 'Nobody home.',
    })
    expect(before.status).toBe(409)
    expect(before.body).toEqual({ error: 'The lane opencode has no run that can read a message now.' })

    const started = await pagePost(rig.url, '/api/control/runs', {
      lane: 'opencode',
      task: 'Do the work.',
      worktree: true,
      confirmed: true,
    })
    expect(started.status).toBe(202)
    await waitFor(() => readLines(callsFile).find((line) => line.callNumber === 1), {
      timeoutMs: CLI_WAIT_MS,
      what: 'first CLI invocation',
    })

    const sent = await pagePost(rig.url, '/api/orchestrator/messages', {
      to: 'lane:opencode',
      text: 'Check the header.',
    })
    expect(sent.status).toBe(202)
    expect(sent.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/) })

    const queuedOrFetched = await pageGet(rig.url, `/api/orchestrator/messages/status?id=${sent.body.id}`)
    expect(queuedOrFetched.status).toBe(200)
    expect(queuedOrFetched.body.id).toBe(sent.body.id)

    const seen = await waitFor(() => readLines(callsFile).find((line) => Array.isArray(line.seenInInbox)), {
      timeoutMs: CLI_WAIT_MS,
      what: 'lane to read owner message',
    })
    expect(seen.seenInInbox).toEqual([
      {
        id: sent.body.id,
        from: 'owner',
        text: 'Check the header.',
        at: expect.any(String),
      },
    ])

    await waitFor(
      async () => (await getJson(`${rig.url}/api/control/runs`)).body.running.length === 0,
      { timeoutMs: CLI_WAIT_MS, what: 'run to end' }
    )
    const after = await pageGet(rig.url, `/api/orchestrator/messages/status?id=${sent.body.id}`)
    expect(after.status).toBe(200)
    expect(after.body.status).toBe('fetched')
  })

  it('does not interrupt when interrupt is false even if laneReplies is interrupt', async () => {
    const tmp = tempDir('mr-lane-send-no-int-')
    const callsFile = join(tmp, 'calls.jsonl')
    const releaseFile = join(tmp, 'release')
    const rig = await makeBridgeRig({
      laneReplies: 'interrupt',
      script: fakeCliScript({ callsFile, releaseFile, holdUntilSeenText: 'Stay on this turn.' }),
    })

    const started = await pagePost(rig.url, '/api/control/runs', {
      lane: 'opencode',
      task: 'Do the work.',
      worktree: true,
      confirmed: true,
    })
    expect(started.status).toBe(202)
    await waitFor(() => readLines(callsFile).find((line) => line.callNumber === 1), {
      timeoutMs: CLI_WAIT_MS,
      what: 'first CLI invocation',
    })

    const sent = await pagePost(rig.url, '/api/orchestrator/messages', {
      to: 'lane:opencode',
      text: 'Stay on this turn.',
      interrupt: false,
    })
    expect(sent.status).toBe(202)

    await waitFor(() => readLines(callsFile).find((line) => Array.isArray(line.seenInInbox)), {
      timeoutMs: CLI_WAIT_MS,
      what: 'lane to fetch queued message',
    })
    await waitFor(
      async () => (await getJson(`${rig.url}/api/control/runs`)).body.running.length === 0,
      { timeoutMs: CLI_WAIT_MS, what: 'single run to end' }
    )

    const invocations = readLines(callsFile).filter((line) => line.callNumber && !line.seenInInbox)
    expect(invocations).toHaveLength(1)
    const status = await pageGet(rig.url, `/api/orchestrator/messages/status?id=${sent.body.id}`)
    expect(status.body.status).toBe('fetched')
  })

  it('interrupts when interrupt is true even if laneReplies is next-turn', async () => {
    const tmp = tempDir('mr-lane-send-int-')
    const callsFile = join(tmp, 'calls.jsonl')
    const releaseFile = join(tmp, 'release')
    const rig = await makeBridgeRig({
      laneReplies: 'next-turn',
      script: fakeCliScript({ callsFile, releaseFile, stopAtCall: 2 }),
    })

    const started = await pagePost(rig.url, '/api/control/runs', {
      lane: 'opencode',
      task: 'Build widget.',
      worktree: true,
      confirmed: true,
    })
    expect(started.status).toBe(202)
    await waitFor(() => readLines(callsFile).find((line) => line.callNumber === 1), {
      timeoutMs: CLI_WAIT_MS,
      what: 'first CLI invocation',
    })

    const sent = await pagePost(rig.url, '/api/orchestrator/messages', {
      to: 'lane:opencode',
      text: 'Switch to helper.',
      interrupt: true,
    })
    expect(sent.status).toBe(202)

    const second = await waitFor(() => readLines(callsFile).find((line) => line.callNumber === 2), {
      timeoutMs: CLI_WAIT_MS,
      what: 'continuation CLI invocation',
    })
    expect(second.prompt).toContain('owner: Switch to helper.')

    await waitFor(
      async () => (await getJson(`${rig.url}/api/control/runs`)).body.running.length === 0,
      { timeoutMs: CLI_WAIT_MS, what: 'continuation run to end' }
    )
    const status = await pageGet(rig.url, `/api/orchestrator/messages/status?id=${sent.body.id}`)
    expect(status.body.status).toBe('interrupted')
  })

  it('ignores interrupt: true on a machineroom lane as today', async () => {
    const tmp = tempDir('mr-lane-send-native-')
    const callsFile = join(tmp, 'calls.jsonl')
    const releaseFile = join(tmp, 'release')
    const base = tempDir('mr-lane-native-rig-')
    const runs = join(base, 'runs')
    const project = join(base, 'project')
    mkdirSync(runs, { recursive: true })
    saveHarnessSettings(runs, { programs: {}, off: [], laneReplies: 'next-turn' })
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

    const sent = await pagePost(url, '/api/orchestrator/messages', {
      to: 'lane:native',
      text: 'Handle internally.',
      interrupt: true,
    })
    expect(sent.status).toBe(202)
    await new Promise((done) => setTimeout(done, 150))

    expect(readLines(callsFile)).toHaveLength(1)
    const statusBefore = await pageGet(url, `/api/orchestrator/messages/status?id=${sent.body.id}`)
    expect(statusBefore.body.status).toBe('queued')

    const inbox = await getJson(`${url}/api/orchestrator/messages`, {
      headers: { 'X-MachineRoom-Lane': call.ticket },
    })
    expect(inbox.body.messages.map((message) => message.text)).toEqual(['Handle internally.'])

    writeFileSync(releaseFile, 'go\n')
    await waitFor(
      async () => (await getJson(`${url}/api/control/runs`)).body.running.length === 0,
      { timeoutMs: CLI_WAIT_MS, what: 'native runner to finish' }
    )
    const statusAfter = await pageGet(url, `/api/orchestrator/messages/status?id=${sent.body.id}`)
    expect(statusAfter.body.status).toBe('fetched')
  })

  it('ignores interrupt: true from a lane ticket and an orchestrator token when laneReplies is next-turn', async () => {
    const tmp = tempDir('mr-lane-send-nonpage-')
    const callsFile = join(tmp, 'calls.jsonl')
    const releaseFile = join(tmp, 'release')
    const rig = await makeBridgeRig({
      laneReplies: 'next-turn',
      script: fakeCliScript({ callsFile, releaseFile }),
      extraLanes: {
        opencode2: {
          name: 'OpenCode 2',
          harness: 'OpenCode',
          cli: { harness: 'opencode', bin: process.execPath, model: 'fake/model' },
        },
      },
    })

    const startOne = await pagePost(rig.url, '/api/control/runs', {
      lane: 'opencode',
      task: 'Target one.',
      worktree: true,
      confirmed: true,
    })
    expect(startOne.status).toBe(202)
    const callOne = await waitFor(
      () => readLines(callsFile).find((line) => String(line.prompt ?? '').includes('Target one.')),
      { timeoutMs: CLI_WAIT_MS, what: 'opencode invocation' }
    )

    const startTwo = await pagePost(rig.url, '/api/control/runs', {
      lane: 'opencode2',
      task: 'Target two.',
      worktree: true,
      confirmed: true,
    })
    expect(startTwo.status).toBe(202)
    const callTwo = await waitFor(
      () => readLines(callsFile).find((line) => String(line.prompt ?? '').includes('Target two.')),
      { timeoutMs: CLI_WAIT_MS, what: 'opencode2 invocation' }
    )

    const laneSent = await lanePost(rig.url, '/api/orchestrator/messages', callTwo.ticket, {
      to: 'lane:opencode',
      text: 'From lane.',
      interrupt: true,
    })
    expect(laneSent.status).toBe(202)

    const token = rig.bridge.orchestrators().token('orchestrator')
    const tokenSent = await tokenPost(
      rig.url,
      '/api/orchestrator/messages',
      { to: 'lane:opencode2', text: 'From token.', interrupt: true },
      token
    )
    expect(tokenSent.status).toBe(202)

    await new Promise((done) => setTimeout(done, 300))

    const laneInboxOne = await getJson(`${rig.url}/api/orchestrator/messages`, {
      headers: { 'X-MachineRoom-Lane': callOne.ticket },
    })
    expect(laneInboxOne.body.messages.map((message) => message.text)).toEqual(['From lane.'])

    const laneInboxTwo = await getJson(`${rig.url}/api/orchestrator/messages`, {
      headers: { 'X-MachineRoom-Lane': callTwo.ticket },
    })
    expect(laneInboxTwo.body.messages.map((message) => message.text)).toEqual(['From token.'])

    writeFileSync(releaseFile, 'go\n')
    await waitFor(
      async () => (await getJson(`${rig.url}/api/control/runs`)).body.running.length === 0,
      { timeoutMs: CLI_WAIT_MS, what: 'both runs to end' }
    )

    expect(readLines(callsFile).filter((line) => line.callNumber)).toHaveLength(2)
    const laneStatus = await getJson(`${rig.url}/api/orchestrator/messages/status?id=${laneSent.body.id}`, {
      headers: { 'X-MachineRoom-Lane': callTwo.ticket },
    })
    expect(laneStatus.body.status).toBe('fetched')
    const tokenStatus = await getJson(`${rig.url}/api/orchestrator/messages/status?id=${tokenSent.body.id}`, {
      headers: { 'X-MachineRoom-Orchestrator': token },
    })
    expect(tokenStatus.body.status).toBe('fetched')
  })
})

describe('LaneConversation message box and status updates', () => {
  const STARTED = '2026-11-16T10:00:00.000Z'
  const FINISHED = '2026-11-16T09:00:00.000Z'
  const LANES = [{ key: 'opencode', name: 'OpenCode', color: '#ff8c1a' }]

  it('shows the text box, Send and Send and interrupt only for a running lane', async () => {
    const client = {
      runs: async () => ({
        running: [{ lane: 'opencode', startedAt: STARTED, running: true }],
        recent: [{ lane: 'opencode', startedAt: FINISHED, exitCode: 0 }],
      }),
      runConversation: async ({ startedAt }) => ({
        lane: 'opencode',
        startedAt,
        harness: 'opencode',
        running: startedAt === STARTED,
        entries: startedAt === STARTED
          ? [{ role: 'agent', text: 'Working.', at: startedAt }]
          : [{ role: 'result', text: '| Command | Result |\n| --- | --- |\n| `npm run build` | **Passed** |', at: startedAt }],
      }),
      sendLaneMessage: async () => ({ id: 'msg-1' }),
      laneMessageStatus: async () => ({ id: 'msg-1', status: 'queued', at: STARTED }),
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(LaneConversation, {
            client,
            lane: 'opencode',
            laneName: 'OpenCode',
            project: 'MachineRoom',
            lanes: LANES,
            initialStartedAt: FINISHED,
            onRecipientSend: () => {},
          })
        )
      })
      await settle(15)

      expect(container.querySelector('textarea')).toBeNull()
      expect(container.querySelector('button[aria-label="Send"]')).toBeNull()
      expect(container.querySelector('button[aria-label="Lane message options"]')).toBeNull()
      expect(container.querySelector('table').querySelector('td').textContent).toBe('npm run build')
      expect(container.querySelector('.mr-composer-box')).toBeNull()
      const hint = container.querySelector('.mr-composer-history').querySelector('.mr-composer-hint')
      expect(hint?.textContent.trim()).toBe(
        `OpenCode is working on run ${runClock(STARTED)}. Pick that run to message it.`
      )

      await act(async () => {
        const picker = container.querySelector('select[aria-label="Run"]')
        picker.value = STARTED
        picker.dispatchEvent({ type: 'change', bubbles: true })
      })
      await settle(15)

      expect(container.querySelector('textarea')).not.toBeNull()
      expect(container.querySelector('button[aria-label="Send"]')).not.toBeNull()
      expect(container.querySelector('button[aria-label="Lane message options"]')).not.toBeNull()
      expect(container.querySelector('.mr-composer-hint')).toBeNull()
    })
  })

  it('sends with interrupt false on Send and refreshes status every 5 seconds and once more when the run ends', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      let live = true
      const sentCalls = []
      const statusCalls = []
      const statuses = ['queued', 'fetched', 'fetched', 'interrupted']
      const listeners = new Set()
      const client = {
        runs: async () => ({
          running: live ? [{ lane: 'opencode', startedAt: STARTED, running: true }] : [],
          recent: live ? [] : [{ lane: 'opencode', startedAt: STARTED, exitCode: 0 }],
        }),
        runConversation: async ({ startedAt }) => ({
          lane: 'opencode',
          startedAt,
          harness: 'opencode',
          running: live,
          entries: [{ role: 'agent', text: 'Working.', at: startedAt }],
        }),
        sendLaneMessage: async (payload) => {
          sentCalls.push(payload)
          return { id: 'msg-1' }
        },
        laneMessageStatus: async (id) => {
          statusCalls.push(id)
          const next = statuses.shift() ?? 'interrupted'
          return { id, status: next, at: STARTED }
        },
        subscribe: (fn) => {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
      }
      const baseProps = {
        client,
        lane: 'opencode',
        laneName: 'OpenCode',
        project: 'MachineRoom',
        lanes: LANES,
        initialStartedAt: STARTED,
        tick: 0,
      }

      await withDom(async ({ container, root }) => {
        await act(async () => {
          root.render(createElement(LaneConversation, baseProps))
        })
        await settle(15)

        const input = container.querySelector('textarea')
        await type(root, input, 'Check the header.')
        await act(async () => container.querySelector('.mr-composer-box').dispatchEvent({ type: 'submit', bubbles: true, cancelable: true }))
        await settle(10)

        expect(sentCalls).toEqual([{ lane: 'opencode', startedAt: STARTED, text: 'Check the header.', interrupt: false }])
        expect(input.value).toBe('')
        expect(container.textContent).toContain('Check the header.')
        expect(container.textContent).toContain('Queued')
        expect(statusCalls).toEqual(['msg-1'])

        await act(async () => {
          vi.advanceTimersByTime(4999)
        })
        await settle(5)
        expect(statusCalls).toHaveLength(1)

        await act(async () => {
          vi.advanceTimersByTime(1)
        })
        await settle(10)
        expect(statusCalls).toHaveLength(2)
        expect(container.textContent).toContain('Read by the runner')
        expect(container.textContent).not.toMatch(/model\s+(read|acted)/i)

        await act(async () => {
          vi.advanceTimersByTime(5000)
        })
        await settle(10)
        expect(statusCalls).toHaveLength(3)

        live = false
        await act(async () => {
          root.render(createElement(LaneConversation, { ...baseProps, tick: 1 }))
        })
        await settle(15)

        expect(statusCalls).toHaveLength(4)
        expect(container.textContent).toContain('Interrupted the run')
        expect(container.textContent).toContain('Check the header.')
        expect(container.querySelector('button[aria-label="Send"]')).toBeNull()

        await act(async () => {
          vi.advanceTimersByTime(5000)
        })
        await settle(5)
        expect(statusCalls).toHaveLength(4)
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends with interrupt true on Send and interrupt and shows Interrupted the run', async () => {
    const sentCalls = []
    const client = {
      runs: async () => ({
        running: [{ lane: 'opencode', startedAt: STARTED, running: true }],
        recent: [],
      }),
      runConversation: async ({ startedAt }) => ({
        lane: 'opencode',
        startedAt,
        harness: 'opencode',
        running: true,
        entries: [{ role: 'agent', text: 'Working.', at: startedAt }],
      }),
      sendLaneMessage: async (payload) => {
        sentCalls.push(payload)
        return { id: 'msg-int' }
      },
      laneMessageStatus: async (id) => ({ id, status: 'interrupted', at: STARTED }),
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(LaneConversation, {
            client,
            lane: 'opencode',
            laneName: 'OpenCode',
            project: 'MachineRoom',
            lanes: LANES,
            initialStartedAt: STARTED,
          })
        )
      })
      await settle(15)

      await type(root, container.querySelector('textarea'), 'Switch to helper.')
      await click(root, container.querySelector('button[aria-label="Lane message options"]'))
      await click(root, document.querySelector('[role="menuitem"]'))
      await settle(15)

      expect(sentCalls).toEqual([{ lane: 'opencode', startedAt: STARTED, text: 'Switch to helper.', interrupt: true }])
      expect(container.textContent).toContain('Switch to helper.')
      expect(container.textContent).toContain('Interrupted the run')
    })
  })

  it('keeps the draft and shows an error when sending fails', async () => {
    const client = {
      runs: async () => ({
        running: [{ lane: 'opencode', startedAt: STARTED, running: true }],
        recent: [],
      }),
      runConversation: async ({ startedAt }) => ({
        lane: 'opencode',
        startedAt,
        harness: 'opencode',
        running: true,
        entries: [{ role: 'agent', text: 'Working.', at: startedAt }],
      }),
      sendLaneMessage: async () => {
        throw new Error('The lane opencode has no run that can read a message now.')
      },
      laneMessageStatus: async () => ({ id: 'msg-x', status: 'queued', at: STARTED }),
      subscribe: () => () => {},
    }

    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(
          createElement(LaneConversation, {
            client,
            lane: 'opencode',
            laneName: 'OpenCode',
            project: 'MachineRoom',
            lanes: LANES,
            initialStartedAt: STARTED,
          })
        )
      })
      await settle(15)

      const input = container.querySelector('textarea')
      await type(root, input, 'Hold on.')
      await act(async () => container.querySelector('.mr-composer-box').dispatchEvent({ type: 'submit', bubbles: true, cancelable: true }))
      await settle(15)

      expect(input.value).toBe('Hold on.')
      expect(container.querySelector('.mr-orch-error').textContent).toContain(
        'The lane opencode has no run that can read a message now.'
      )
    })
  })
})

describe('a page message to a lane with an ended run and a newer live run', () => {
  const OLD = '2026-11-16T09:00:00.000Z'
  const LIVE = '2026-11-16T10:00:00.000Z'

  it('refuses the ended run, reaches the live run and stores the clock time', async () => {
    const base = tempDir('mr-lane-send-live-')
    const runs = join(base, 'runs')
    const project = join(base, 'project')
    mkdirSync(runs, { recursive: true })
    mkdirSync(project, { recursive: true })
    const held = { lane: 'opencode', startedAt: LIVE, inbox: [] }
    const at = Date.parse('2026-11-16T10:30:00.000Z')
    const registry = createOrchestrators({
      projectRoot: project,
      runsFolder: runs,
      lanes: { opencode: { name: 'OpenCode', harness: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode', model: 'fake/model' } } },
      spawn: () => { throw new Error('no spawn') },
      promptFile: join(base, 'prompt.md'),
      bridgeUrl: () => 'http://127.0.0.1:5999',
      onNotice: () => {},
      harnessAvailable: () => true,
      laneTickets: () => [held],
      now: () => at,
    })
    cleanups.push(() => registry.close())

    const stale = await registry.message({ to: 'lane:opencode', text: 'For the old run.', startedAt: OLD }, true)
    expect(stale).toEqual({ status: 409, body: { error: 'That run is no longer running.' } })
    expect(held.inbox).toHaveLength(0)

    const sent = await registry.message({ to: 'lane:opencode', text: 'For the live run.', startedAt: LIVE }, true)
    expect(sent.status).toBe(202)
    expect(held.inbox).toHaveLength(1)
    expect(held.inbox[0]).toMatchObject({ id: sent.body.id, from: 'owner', text: 'For the live run.', at: new Date(at).toISOString() })
  })
})
