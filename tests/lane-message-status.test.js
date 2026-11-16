import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { chatFileFor } from '../server/orchestrator.js'
import { getJson, waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
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
  const base = makeTempDir('mr-lane-status-')
  const runs = join(base, 'runs')
  const projectRoot = join(base, 'project')
  mkdirSync(runs, { recursive: true })
  mkdirSync(projectRoot, { recursive: true })
  const promptFile = join(base, 'orchestrator-agent.md')
  writeFileSync(promptFile, PROMPT)
  if (ladder) {
    writeFileSync(
      chatFileFor(projectRoot, runs, 'orchestrator'),
      `${JSON.stringify({ project: projectRoot, sessionId: null, state: 'idle', messages: [], pending: [], ladder })}\n`
    )
  }
  const runner = join(base, 'lane-runner.mjs')
  const calls = join(base, 'lane-runner.jsonl')
  const release = join(base, 'lane-release')
  writeFileSync(runner, LANE_RUNNER)
  cleanups.push(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return {
    base,
    runs,
    projectRoot,
    promptFile,
    calls,
    release,
    runnerCommand: { file: process.execPath, args: [runner, calls, release] },
  }
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
  return { ...files, bridge, url, token: (id = 'orchestrator') => bridge.orchestrators().token(id) }
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

function laneGet(url, ticket) {
  return getJson(`${url}/api/orchestrator/messages`, { headers: { 'X-MachineRoom-Lane': ticket } })
}

async function startRun(rig, lane, extra = {}) {
  const started = await pagePost(rig.url, '/api/control/runs', { lane, task: 'Fix the typo.', confirmed: true, ...extra })
  expect(started.status).toBe(202)
  const call = await waitFor(() => readLines(rig.calls).find((entry) => entry.args[0] === lane), 15000, `the ${lane} runner`)
  return call.ticket
}

async function releaseRuns(rig) {
  writeFileSync(rig.release, 'go\n')
  await waitFor(
    async () => (await getJson(`${rig.url}/api/control/runs`)).body.running.length === 0,
    15000,
    'the runs to end'
  )
}

describe('a lane message id', () => {
  it('answers the id of a message sent from a token and from another lane, and the inbox carries it', async () => {
    const rig = await makeBridge(makeBase({ ladder: { subs: [FRONTEND, BACKEND] } }))
    const other = await startRun(rig, 'opencode2')
    const sender = await startRun(rig, 'opencode')

    const fromToken = await tokenPost(rig.url, '/api/orchestrator/messages', { to: 'lane:opencode2', text: 'Which header?' }, rig.token())
    expect(fromToken.status).toBe(202)
    expect(fromToken.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/) })

    const fromLane = await lanePost(rig.url, '/api/orchestrator/messages', sender, { to: 'lane:opencode2', text: 'The field is ready.' })
    expect(fromLane.status).toBe(202)
    expect(fromLane.body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    expect(fromLane.body.id).not.toBe(fromToken.body.id)

    const read = await laneGet(rig.url, other)
    expect(read.status).toBe(200)
    expect(read.body.messages).toEqual([
      { id: fromToken.body.id, from: 'orchestrator', text: 'Which header?', at: expect.any(String) },
      { id: fromLane.body.id, from: 'lane:opencode', text: 'The field is ready.', at: expect.any(String) },
    ])
    await releaseRuns(rig)
  })
})
