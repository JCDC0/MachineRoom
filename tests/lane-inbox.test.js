import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { chatFileFor } from '../server/orchestrator.js'
import { LANE_ENDED_PROBLEM, LANE_LIMIT_PROBLEM } from '../server/orchestrators.js'
import { getJson } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

function noRunProblem(key) {
  return `The lane ${key} has no run that can read a message now.`
}

const PROMPT = 'project={{PROJECT}}\nmachineroom={{MACHINEROOM}}\nruns={{RUNS}}\nbridge={{BRIDGE}}'
const LANES = {
  orchestrator: { name: 'Orchestrator', harness: 'Claude Code', cli: { harness: 'claude', bin: 'claude', model: 'opus' } },
  opencode: { name: 'OpenCode', harness: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
  opencode2: { name: 'OpenCode 2', harness: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode', model: 'opencode-go/deepseek-v4.1-flash' } },
}
const FRONTEND = {
  id: 'frontend',
  name: 'Frontend',
  harness: 'claude',
  model: 'sonnet',
  lanes: ['opencode'],
  scope: ['src/ui/**'],
  restricted: true,
  setBy: 'owner',
}
const BACKEND = {
  id: 'backend',
  name: 'Backend',
  harness: 'claude',
  model: 'sonnet',
  lanes: ['opencode2'],
  scope: ['server/**'],
  restricted: true,
  setBy: 'owner',
}

const LANE_RUNNER = [
  "import { appendFileSync, existsSync } from 'node:fs'",
  'const args = process.argv.slice(2)',
  "const calls = String(args[0] ?? '')",
  "const release = String(args[1] ?? '')",
  "appendFileSync(calls, JSON.stringify({ args: args.slice(2), ticket: process.env.MACHINEROOM_LANE_TICKET ?? '' }) + '\\n')",
  "while (release && !existsSync(release)) await new Promise((done) => setTimeout(done, 20))",
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

function makeBase({ ladder = null } = {}) {
  const base = makeTempDir('mr-lane-inbox-')
  const runs = join(base, 'runs')
  const projectRoot = join(base, 'project')
  mkdirSync(runs, { recursive: true })
  mkdirSync(projectRoot, { recursive: true })
  const promptFile = join(base, 'orchestrator-agent.md')
  writeFileSync(promptFile, PROMPT)
  const runner = join(base, 'lane-runner.mjs')
  const calls = join(base, 'lane-runner.jsonl')
  const release = join(base, 'lane-release')
  writeFileSync(runner, LANE_RUNNER)
  if (ladder) {
    writeFileSync(
      chatFileFor(projectRoot, runs, 'orchestrator'),
      `${JSON.stringify({ project: projectRoot, sessionId: null, state: 'idle', messages: [], pending: [], ladder })}\n`
    )
  }
  const files = {
    base,
    runs,
    projectRoot,
    promptFile,
    calls,
    release,
    runnerCommand: { file: process.execPath, args: [runner, calls, release] },
    chat: (id = 'orchestrator') => {
      try {
        return JSON.parse(readFileSync(chatFileFor(projectRoot, runs, id), 'utf8'))
      } catch {
        return null
      }
    },
  }
  cleanups.push(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return files
}

async function makeBridge(files, extra = {}) {
  writeActiveLanes(activeLanesFileFor(files.projectRoot, files.runs), Object.keys(LANES).filter((key) => key !== 'orchestrator'))
  const bridge = createBridge({
    projectRoot: files.projectRoot,
    port: 0,
    env: {},
    briefsDir: join(REPO_ROOT, 'docs', 'agents'),
    lanesFile: join(REPO_ROOT, 'docs', 'agents', 'lanes.json'),
    orchestratorPrompt: files.promptFile,
    lanesSource: { folder: files.runs, lanes: LANES, pollMs: 20, quietMs: 60000 },
    runnerCommand: files.runnerCommand,
    ...extra,
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { ...files, bridge, url, token: (id) => bridge.orchestrators().token(id) }
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

function lanePost(url, path, ticket, body) {
  return getJson(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-MachineRoom-Lane': ticket },
    body: JSON.stringify(body),
  })
}

function laneGet(url, ticket, headers = {}) {
  return getJson(`${url}/api/orchestrator/messages`, { headers: { 'X-MachineRoom-Lane': ticket, ...headers } })
}

async function startRun(rig, lane, extra = {}) {
  const started = await pagePost(rig.url, '/api/control/runs', { lane, task: 'Fix the typo.', confirmed: true, ...extra })
  expect(started.status).toBe(202)
  const call = await waitFor(() => readLines(rig.calls).find((entry) => entry.args[0] === lane), 15000, `the ${lane} runner`)
  return call.ticket
}

async function releaseRun(rig) {
  writeFileSync(rig.release, 'go\n')
  await waitFor(
    async () => (await getJson(`${rig.url}/api/control/runs`)).body.running.length === 0,
    15000,
    'the run to end'
  )
}

describe('a lane inbox', () => {
  it('takes an orchestrator message for a running lane', async () => {
    const rig = await makeBridge(makeBase({ ladder: { subs: [FRONTEND] } }))
    const ticket = await startRun(rig, 'opencode')

    const sent = await tokenPost(rig.url, '/api/orchestrator/messages', { to: 'lane:opencode', text: 'Which header?' }, rig.token('orchestrator'))
    expect(sent.status).toBe(202)

    const read = await laneGet(rig.url, ticket)
    expect(read.status).toBe(200)
    expect(Object.keys(read.body)).toEqual(['messages'])
    expect(read.body.messages).toEqual([
      { from: 'orchestrator', text: 'Which header?', at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
    ])
    expect(Object.keys(read.body.messages[0])).toEqual(['from', 'text', 'at'])

    const team = rig.chat('orchestrator').messages.filter((message) => message.from === 'agent' && message.agent?.kind === 'message')
    expect(team).toEqual([
      expect.objectContaining({
        agent: expect.objectContaining({ from: 'orchestrator', to: 'opencode', kind: 'message', text: 'Which header?' }),
      }),
    ])
    await releaseRun(rig)
  })

  it('takes a sub message as sub:ID', async () => {
    const rig = await makeBridge(makeBase({ ladder: { subs: [FRONTEND] } }))
    const ticket = await startRun(rig, 'opencode', { startedBy: 'frontend' })

    const sent = await tokenPost(rig.url, '/api/orchestrator/messages', { to: 'lane:opencode', text: 'Use the new header.' }, rig.token('frontend'))
    expect(sent.status).toBe(202)

    const read = await laneGet(rig.url, ticket)
    expect(read.body.messages).toEqual([
      { from: 'sub:frontend', text: 'Use the new header.', at: expect.any(String) },
    ])
    await releaseRun(rig)
  })

  it('takes a lane message as lane:KEY and counts it toward its four', async () => {
    const rig = await makeBridge(makeBase({ ladder: { subs: [FRONTEND, BACKEND] } }))
    const sender = await startRun(rig, 'opencode')
    const other = await startRun(rig, 'opencode2')

    const first = await lanePost(rig.url, '/api/orchestrator/messages', sender, { to: 'lane:opencode2', text: 'The field is ready.' })
    expect(first.status).toBe(202)
    const read = await laneGet(rig.url, other)
    expect(read.body.messages).toEqual([
      { from: 'lane:opencode', text: 'The field is ready.', at: expect.any(String) },
    ])

    for (let index = 2; index <= 4; index += 1) {
      const sent = await lanePost(rig.url, '/api/orchestrator/messages', sender, { to: 'lane:opencode2', text: `Note ${index}` })
      expect(sent.status, String(index)).toBe(202)
    }
    const fifth = await lanePost(rig.url, '/api/orchestrator/messages', sender, { to: 'lane:opencode2', text: 'Note 5' })
    expect(fifth.status).toBe(429)
    expect(fifth.body).toEqual({ error: LANE_LIMIT_PROBLEM })
    await releaseRun(rig)
  })

  it('answers 409 when the lane has no run that can read', async () => {
    const rig = await makeBridge(makeBase({ ladder: { subs: [FRONTEND] } }))
    const sent = await tokenPost(rig.url, '/api/orchestrator/messages', { to: 'lane:opencode2', text: 'Anyone there?' }, rig.token('orchestrator'))
    expect(sent.status).toBe(409)
    expect(sent.body).toEqual({ error: noRunProblem('opencode2') })

    const sender = await startRun(rig, 'opencode')
    const fromLane = await lanePost(rig.url, '/api/orchestrator/messages', sender, { to: 'lane:opencode2', text: 'Anyone there?' })
    expect(fromLane.status).toBe(409)
    expect(fromLane.body).toEqual({ error: noRunProblem('opencode2') })
    await releaseRun(rig)
  })

  it('never shows one run the messages of another', async () => {
    const rig = await makeBridge(makeBase({ ladder: { subs: [FRONTEND] } }))
    const first = await startRun(rig, 'opencode')
    const second = await startRun(rig, 'opencode2')

    await tokenPost(rig.url, '/api/orchestrator/messages', { to: 'lane:opencode', text: 'For the first only.' }, rig.token('orchestrator'))

    expect((await laneGet(rig.url, first)).body.messages).toHaveLength(1)
    expect((await laneGet(rig.url, second)).body.messages).toEqual([])
    await releaseRun(rig)
  })

  it('refuses an ended ticket', async () => {
    const rig = await makeBridge(makeBase())
    const ticket = await startRun(rig, 'opencode')
    await releaseRun(rig)

    const read = await laneGet(rig.url, ticket)
    expect(read.status).toBe(403)
    expect(read.body).toEqual({ error: LANE_ENDED_PROBLEM })
  })

  it('takes no Origin and no orchestrator token', async () => {
    const rig = await makeBridge(makeBase())
    const ticket = await startRun(rig, 'opencode')

    const withOrigin = await laneGet(rig.url, ticket, { origin: 'http://localhost:5173' })
    expect(withOrigin.status).toBe(403)

    const withToken = await getJson(`${rig.url}/api/orchestrator/messages`, {
      headers: { 'X-MachineRoom-Orchestrator': rig.token('orchestrator') },
    })
    expect(withToken.status).toBe(403)
    await releaseRun(rig)
  })

  it('keeps the newest 20 messages', async () => {
    let at = Date.parse('2026-11-15T09:00:00.000Z')
    const rig = await makeBridge(makeBase(), { now: () => at })
    const ticket = await startRun(rig, 'opencode')

    for (let index = 1; index <= 22; index += 1) {
      if (index % 6 === 1) at += 11 * 60 * 1000
      const sent = await tokenPost(rig.url, '/api/orchestrator/messages', { to: 'lane:opencode', text: `Note ${index}` }, rig.token('orchestrator'))
      expect(sent.status, String(index)).toBe(202)
    }

    const read = await laneGet(rig.url, ticket)
    expect(read.body.messages).toHaveLength(20)
    expect(read.body.messages[0].text).toBe('Note 3')
    expect(read.body.messages[19].text).toBe('Note 22')
    await releaseRun(rig)
  })

  it('holds no message in a runs response', async () => {
    const rig = await makeBridge(makeBase())
    const ticket = await startRun(rig, 'opencode')
    const sent = await tokenPost(rig.url, '/api/orchestrator/messages', { to: 'lane:opencode', text: 'Secret words for the lane.' }, rig.token('orchestrator'))
    expect(sent.status).toBe(202)
    expect((await laneGet(rig.url, ticket)).body.messages).toHaveLength(1)

    const text = JSON.stringify((await getJson(`${rig.url}/api/control/runs`)).body)
    expect(text).not.toContain('Secret words for the lane.')
    expect(text).not.toContain('inbox')
    expect(text).not.toContain(ticket)
    await releaseRun(rig)
  })
})
