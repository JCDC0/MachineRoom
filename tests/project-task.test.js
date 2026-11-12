import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { activeLanesFileFor, createActiveLanesApi, writeActiveLanes } from '../server/active-lanes.js'
import { createBridge } from '../server/index.js'
import { gitPath } from '../server/programPath.js'
import { createRunsApi, notGitProblem } from '../server/runs.js'
import { getJson, waitFor } from './helpers/bridge.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const REAL_REPO_ROOT = realpathSync.native(REPO_ROOT)
const LANES_FILE = join(REPO_ROOT, 'docs', 'agents', 'lanes.json')
const cleanups = []

afterEach(async () => {
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

function gitProject(prefix) {
  const dir = tempDir(prefix)
  execFileSync(gitPath(), ['init'], { cwd: dir, stdio: 'ignore' })
  return dir
}

function writeRunner(dir, callsFile, { waitFile = '', exitCode = 0 } = {}) {
  const path = join(dir, 'runner.mjs')
  const lines = [
    "import { appendFileSync, existsSync } from 'node:fs'",
    'const args = process.argv.slice(2)',
    `appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(args) + '\\n')`,
  ]
  if (waitFile) {
    lines.push('const deadline = Date.now() + 10000')
    lines.push(`while (!existsSync(${JSON.stringify(waitFile)}) && Date.now() < deadline) {`)
    lines.push('  await new Promise((resolveWait) => setTimeout(resolveWait, 20))')
    lines.push('}')
  }
  if (exitCode !== 0) lines.push(`process.exit(${exitCode})`)
  writeFileSync(path, lines.join('\n'))
  return path
}

function readCalls(callsFile) {
  if (!existsSync(callsFile)) return []
  return readFileSync(callsFile, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

function buildApi({
  projectRoot,
  runnerPath,
  runsDir = tempDir('mr-project-task-runs-'),
  activeLanes = { isChosen: () => true, isLaneActive: () => true },
  notify = () => {},
  onMessage = () => {},
}) {
  const api = createRunsApi({
    projectRoot,
    runnerCommand: { file: process.execPath, args: [runnerPath] },
    sendJson: () => {},
    readJsonBody: async () => null,
    runsFolder: runsDir,
    lanesFile: LANES_FILE,
    activeLanes,
    notify,
    onMessage,
  })
  cleanups.push(async () => {
    api.stopAll()
    await waitFor(() => !api.isRunning(), { what: 'running lanes to stop' }).catch(() => {})
  })
  return api
}

describe('startProjectTask', () => {
  it('passes --worktree to the runner for a git project with worktree: true', async () => {
    const project = gitProject('mr-project-task-')
    const runnerDir = tempDir('mr-project-task-runner-')
    const callsFile = join(runnerDir, 'calls.jsonl')
    const api = buildApi({ projectRoot: project, runnerPath: writeRunner(runnerDir, callsFile) })

    const res = await api.startProjectTask({ lane: 'opencode', task: 'Fix the typo.', worktree: true })
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ lane: 'opencode', briefs: [] })

    const calls = await waitFor(() => (readCalls(callsFile).length === 1 ? readCalls(callsFile) : null), {
      what: 'runner arguments',
    })
    expect(calls[0]).toEqual(['opencode', '--project', project, '--task', 'Fix the typo.', '--worktree'])
    await waitFor(() => !api.isRunning('opencode'), { what: 'the run to end' })
  })

  it('runs without --worktree on a project that is not git and refuses worktree: true there', async () => {
    const project = tempDir('mr-project-task-')
    const runnerDir = tempDir('mr-project-task-runner-')
    const callsFile = join(runnerDir, 'calls.jsonl')
    const api = buildApi({ projectRoot: project, runnerPath: writeRunner(runnerDir, callsFile) })

    const res = await api.startProjectTask({ lane: 'opencode', task: 'Fix the typo.' })
    expect(res.status).toBe(202)

    const calls = await waitFor(() => (readCalls(callsFile).length === 1 ? readCalls(callsFile) : null), {
      what: 'runner arguments',
    })
    expect(calls[0]).toEqual(['opencode', '--project', project, '--task', 'Fix the typo.'])
    expect(calls[0]).not.toContain('--worktree')
    await waitFor(() => !api.isRunning('opencode'), { what: 'the run to end' })

    const refused = await api.startProjectTask({ lane: 'opencode', task: 'Fix the typo.', worktree: true })
    expect(refused.status).toBe(400)
    expect(refused.body).toEqual({ error: notGitProblem(project) })
    expect(readCalls(callsFile)).toHaveLength(1)
  })

  it('refuses a dirty git project with the dirty sentence and starts nothing', async () => {
    const project = gitProject('mr-project-task-')
    writeFileSync(join(project, 'notes.txt'), 'uncommitted\n')
    const runnerDir = tempDir('mr-project-task-runner-')
    const callsFile = join(runnerDir, 'calls.jsonl')
    const api = buildApi({ projectRoot: project, runnerPath: writeRunner(runnerDir, callsFile) })

    const res = await api.startProjectTask({ lane: 'opencode', task: 'Fix it.', worktree: true })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: `The project folder ${project} has uncommitted changes. Commit or discard them, or pass --allow-dirty.`,
    })
    expect(readCalls(callsFile)).toEqual([])
    expect(api.isRunning('opencode')).toBe(false)
  })

  it('refuses the project when it is this repository', async () => {
    const runnerDir = tempDir('mr-project-task-runner-')
    const callsFile = join(runnerDir, 'calls.jsonl')
    const api = buildApi({ projectRoot: REPO_ROOT, runnerPath: writeRunner(runnerDir, callsFile) })

    const res = await api.startProjectTask({ lane: 'opencode', task: 'Fix it.', worktree: true })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: `The project folder ${REAL_REPO_ROOT} is this checkout. Run on another project.`,
    })
    expect(readCalls(callsFile)).toEqual([])
    expect(api.isRunning('opencode')).toBe(false)
  })

  it('refuses an inactive or unknown lane and starts nothing', async () => {
    const project = tempDir('mr-project-task-')
    const runsDir = tempDir('mr-project-task-runs-')
    const runnerDir = tempDir('mr-project-task-runner-')
    const callsFile = join(runnerDir, 'calls.jsonl')
    const activeLanes = createActiveLanesApi({
      projectRoot: project,
      runsFolder: runsDir,
      lanesFile: LANES_FILE,
    })
    const api = buildApi({
      projectRoot: project,
      runsDir,
      runnerPath: writeRunner(runnerDir, callsFile),
      activeLanes,
    })

    const unchosen = await api.startProjectTask({ lane: 'opencode', task: 'Fix it.' })
    expect(unchosen.status).toBe(400)
    expect(unchosen.body).toEqual({ error: 'Pick the lanes for this project first.' })

    writeActiveLanes(activeLanesFileFor(project, runsDir), ['opencode2'])

    const inactive = await api.startProjectTask({ lane: 'opencode', task: 'Fix it.' })
    expect(inactive.status).toBe(400)
    expect(inactive.body).toEqual({ error: 'The lane opencode is not active. Add it in Agents first.' })

    const unknown = await api.startProjectTask({ lane: 'unknown-lane', task: 'Fix it.' })
    expect(unknown.status).toBe(400)
    expect(unknown.body).toEqual({ error: 'Choose a lane from the list.' })

    const retired = await api.startProjectTask({ lane: 'hermes', task: 'Fix it.' })
    expect(retired.status).toBe(400)
    expect(retired.body).toEqual({ error: 'The hermes lane is retired.' })

    const orchestrator = await api.startProjectTask({ lane: 'orchestrator', task: 'Fix it.' })
    expect(orchestrator.status).toBe(400)
    expect(orchestrator.body).toEqual({ error: 'The orchestrator lane runs from the room, not as a lane run.' })

    expect(readCalls(callsFile)).toEqual([])
    expect(api.isRunning()).toBe(false)
  })

  it('answers 409 on a second start while the lane is already running', async () => {
    const project = tempDir('mr-project-task-')
    const runnerDir = tempDir('mr-project-task-runner-')
    const callsFile = join(runnerDir, 'calls.jsonl')
    const waitFile = join(runnerDir, 'release')
    const api = buildApi({
      projectRoot: project,
      runnerPath: writeRunner(runnerDir, callsFile, { waitFile }),
    })

    const first = await api.startProjectTask({ lane: 'opencode', task: 'First task.' })
    expect(first.status).toBe(202)
    expect(api.isRunning('opencode')).toBe(true)

    await waitFor(() => readCalls(callsFile).length === 1, { what: 'first runner call' })

    const second = await api.startProjectTask({ lane: 'opencode', task: 'Second task.' })
    expect(second.status).toBe(409)
    expect(second.body).toEqual({ error: 'That lane is already running.' })

    writeFileSync(waitFile, 'go\n')
    await waitFor(() => !api.isRunning('opencode'), { what: 'the first run to end' })
    expect(readCalls(callsFile)).toHaveLength(1)
  })

  it('answers 202 once on a good start and passes --started-by orchestrator when asked', async () => {
    const project = tempDir('mr-project-task-')
    const runnerDir = tempDir('mr-project-task-runner-')
    const callsFile = join(runnerDir, 'calls.jsonl')
    const notices = []
    const messages = []
    const api = buildApi({
      projectRoot: project,
      runnerPath: writeRunner(runnerDir, callsFile),
      notify: (event) => notices.push(event),
      onMessage: (message, text) => messages.push({ message, text }),
    })

    const res = await api.startProjectTask({
      lane: 'opencode',
      task: 'Fix the typo.',
      startedBy: 'orchestrator',
    })
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ lane: 'opencode', briefs: [], lastLines: [] })
    expect(typeof res.body.startedAt).toBe('string')
    expect(notices).toEqual([{ topic: 'runs' }])
    expect(messages).toEqual([
      { message: { from: 'orchestrator', to: 'opencode', kind: 'dispatch' }, text: 'Fix the typo.' },
    ])

    const calls = await waitFor(() => (readCalls(callsFile).length === 1 ? readCalls(callsFile) : null), {
      what: 'first runner call',
    })
    expect(calls[0]).toEqual([
      'opencode',
      '--project',
      project,
      '--task',
      'Fix the typo.',
      '--started-by',
      'orchestrator',
    ])
    await waitFor(() => !api.isRunning('opencode'), { what: 'the first run to end' })

    const plain = await api.startProjectTask({ lane: 'opencode', task: 'Second task.' })
    expect(plain.status).toBe(202)
    const nextCalls = await waitFor(() => (readCalls(callsFile).length === 2 ? readCalls(callsFile) : null), {
      what: 'second runner call',
    })
    expect(nextCalls[1]).toEqual(['opencode', '--project', project, '--task', 'Second task.'])
    expect(messages).toHaveLength(1)
    await waitFor(() => !api.isRunning('opencode'), { what: 'the second run to end' })
  })

  it('passes --worktree and --started-by orchestrator through startLaneTask on a git project', async () => {
    const project = gitProject('mr-project-task-')
    const base = tempDir('mr-project-task-bridge-')
    const runs = join(base, 'runs')
    mkdirSync(runs, { recursive: true })
    const callsFile = join(base, 'calls.jsonl')
    const runnerPath = writeRunner(base, callsFile)
    const promptFile = join(base, 'orchestrator-agent.md')
    writeFileSync(promptFile, 'project={{PROJECT}}\nruns={{RUNS}}\n')
    const lanes = JSON.parse(readFileSync(LANES_FILE, 'utf8'))
    writeActiveLanes(activeLanesFileFor(project, runs), ['opencode'])

    const bridge = createBridge({
      projectRoot: project,
      port: 0,
      env: {},
      briefsDir: join(REPO_ROOT, 'docs', 'agents'),
      lanesFile: LANES_FILE,
      runsFolder: runs,
      runnerCommand: { file: process.execPath, args: [runnerPath] },
      orchestratorPrompt: promptFile,
      lanesSource: { folder: runs, lanes, pollMs: 20, quietMs: 60000 },
      orchestratorSpawn: () => {
        throw new Error('orchestrator should not spawn during direct lane dispatch')
      },
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const res = await getJson(`${url}/api/orchestrator/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url },
      body: JSON.stringify({ to: 'opencode', text: 'Fix the typo.' }),
    })
    expect(res.status).toBe(202)
    expect(res.body).toEqual({ ok: true, started: true })

    const calls = await waitFor(() => (readCalls(callsFile).length === 1 ? readCalls(callsFile) : null), {
      what: 'chat dispatch runner call',
    })
    expect(calls[0]).toEqual([
      'opencode',
      '--project',
      project,
      '--task',
      'Fix the typo.',
      '--worktree',
      '--started-by',
      'orchestrator',
    ])
    await waitFor(async () => (await getJson(`${url}/api/control/runs`)).body.running.length === 0, {
      what: 'chat dispatch run to end',
    })
  })
})
