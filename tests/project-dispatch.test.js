import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { act, createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import DispatchPanel from '../src/ui/panels/DispatchPanel.jsx'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { runsFolder } from '../server/lanes-source.js'
import { gitPath } from '../server/programPath.js'
import { BRIEF_PROJECT_PROBLEM, QUEUE_DIRTY_PROBLEM, RUN_KIND_PROBLEM, TASK_PROBLEM, TASK_SEPARATOR_PROBLEM, TASKS_PROBLEM, createRunsApi, writeQueue } from '../server/runs.js'
import { parseQueueArgs } from '../src/briefs/queue.js'
import { worktreeFor, CHECK_SHELL_PROBLEM } from '../src/briefs/run.js'
import { createMockClient } from '../src/control/mock.js'
import {
  NO_CODE_LANE_FORM_LINE,
  NO_LANES_FORM_LINE,
  PROJECT_CONFIRM_LIMIT,
  projectFormNotice,
  projectRunConfirm,
  projectRunLanes,
  projectTaskProblem,
} from '../src/ui/panels/runs.js'
import { getJson, waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'
import { settle, withDom } from './helpers/uiDom.js'

function postJson(url, body) {
  return getJson(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: new URL(url).origin }, body: JSON.stringify(body) })
}

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const REAL_REPO_ROOT = realpathSync.native(REPO_ROOT)
const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function gitProject(prefix) {
  const dir = tempDir(prefix)
  execFileSync(gitPath(), ['init'], { cwd: dir, stdio: 'ignore' })
  return dir
}

function writeProject(dir) {
  const agents = join(dir, 'docs', 'agents')
  mkdirSync(agents, { recursive: true })
  writeFileSync(
    join(agents, 'TASKS.md'),
    '**C3e. HUD polish (AGY).** Move the assistant window above the transport bar.'
  )
  writeFileSync(
    join(agents, 'lanes.json'),
    JSON.stringify({
      hermes: { name: 'Hermes', retired: true, cli: { harness: 'hermes', bin: 'hermes.exe', model: 'deepseek/v4.1' } },
      opencode: { name: 'OpenCode', cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/deepseek-v4.1-flash' } },
      opencode2: { name: 'OpenCode 2', cli: { harness: 'opencode', bin: 'opencode.exe', model: 'opencode-go/deepseek-v4.1-flash' } },
      agy: { name: 'agy', cli: { harness: 'agy', bin: 'agy', model: 'gemini-3.8-flash-high' } },
    })
  )
}

function writeRunner(dir, out, waitMs = 0, exitCode = 0) {
  const path = join(dir, 'runner.mjs')
  const lines = [
    "import { writeFileSync } from 'node:fs'",
    'const args = process.argv.slice(2)',
    `writeFileSync(${JSON.stringify(out)}, JSON.stringify(args))`,
    "console.log('args ' + args.join(' '))",
  ]
  if (waitMs > 0) lines.push(`await new Promise((resolve) => setTimeout(resolve, ${waitMs}))`)
  if (exitCode !== 0) lines.push(`process.exit(${exitCode})`)
  writeFileSync(path, lines.join('\n'))
  return path
}

function writeParseRunner(dir, out) {
  const path = join(dir, 'parse-runner.mjs')
  const runUrl = pathToFileURL(join(REPO_ROOT, 'src', 'briefs', 'run.js')).href
  const lines = [
    "import { writeFileSync } from 'node:fs'",
    `import { parseRunArgs } from ${JSON.stringify(runUrl)}`,
    'const args = process.argv.slice(2)',
    'const parsed = parseRunArgs(args)',
    `writeFileSync(${JSON.stringify(out)}, JSON.stringify(parsed))`,
  ]
  writeFileSync(path, lines.join('\n'))
  return path
}

function queueFiles(folder) {
  try {
    return readdirSync(folder).filter((name) => name.endsWith('.queue.txt'))
  } catch {
    return []
  }
}

function readArgs(out) {
  try {
    return JSON.parse(readFileSync(out, 'utf8'))
  } catch {
    return null
  }
}

async function startBridge({ projectRoot, runnerPath }) {
  const runs = runsFolder()
  mkdirSync(runs, { recursive: true })
  writeActiveLanes(activeLanesFileFor(projectRoot, runs), ['opencode', 'opencode2'])
  const bridge = createBridge({
    projectRoot,
    port: 0,
    lanesFile: join(REPO_ROOT, 'docs', 'agents', 'lanes.json'),
    runnerCommand: { file: process.execPath, args: [runnerPath] },
  })
  cleanups.push(() => bridge.stop())
  const { url } = await bridge.start()
  return { url, bridge }
}

describe('the runs route with a task', () => {
  it('writes a failed record when the runner refuses before it writes one', async () => {
    const project = tempDir('mr-project-dispatch-')
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const { url } = await startBridge({ projectRoot: project, runnerPath: writeRunner(runnerDir, out, 0, 3) })
    const res = await postJson(`${url}/api/control/runs`, { lane: 'opencode', task: 'Fix the typo.', confirmed: true })
    expect(res.status).toBe(202)
    await waitFor(async () => (await getJson(`${url}/api/control/runs`)).body.running.length === 0, { what: 'the run to end' })
    const file = join(runsFolder(), 'runs.jsonl')
    const records = readFileSync(file, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line))
    expect(records.at(-1)).toMatchObject({ lane: 'opencode', exitCode: 3, project, task: 'Fix the typo.' })
    expect(records.at(-1).note).toContain('args opencode --project')
  })

  it('writes a failed record when the runner dies by a signal or refuses to start', async () => {
    const project = tempDir('mr-project-dispatch-')
    const runnerDir = tempDir('mr-project-runner-')
    const path = join(runnerDir, 'signal-runner.mjs')
    writeFileSync(path, "process.kill(process.pid, 'SIGKILL')")
    const { url } = await startBridge({ projectRoot: project, runnerPath: path })
    const res = await postJson(`${url}/api/control/runs`, { lane: 'opencode', task: 'Die by signal.', confirmed: true })
    expect(res.status).toBe(202)
    await waitFor(async () => (await getJson(`${url}/api/control/runs`)).body.running.length === 0, { what: 'the run to end' })
    const file = join(runsFolder(), 'runs.jsonl')
    const records = readFileSync(file, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line))
    expect(records.at(-1)).toMatchObject({ lane: 'opencode', exitCode: 1, project, task: 'Die by signal.' })
  })

  it('writes a failed record when the runner binary fails to start', async () => {
    const project = tempDir('mr-project-dispatch-')
    const runs = runsFolder()
    mkdirSync(runs, { recursive: true })
    let answer = null
    const api = createRunsApi({
      projectRoot: project,
      runnerCommand: { file: 'this-binary-does-not-exist-at-all-12345', args: [] },
      sendJson: (req, res, status, body) => { answer = { status, body } },
      readJsonBody: async () => ({ lane: 'opencode', task: 'Spawn failure.', confirmed: true }),
      runsFolder: runs,
      lanesFile: join(REPO_ROOT, 'docs', 'agents', 'lanes.json'),
      activeLanes: { isChosen: () => true, isLaneActive: () => true },
    })
    cleanups.push(() => api.stopAll())
    const handled = await api.handle(
      { method: 'POST', headers: { origin: 'http://localhost:5173' } },
      {},
      new URL('http://127.0.0.1/api/control/runs')
    )
    expect(handled).toBe(true)
    expect(answer.status).toBe(202)
    await waitFor(() => !api.isRunning('opencode'), { what: 'runner error to finish' })
    const file = join(runs, 'runs.jsonl')
    const records = readFileSync(file, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line))
    expect(records.at(-1)).toMatchObject({ lane: 'opencode', exitCode: 1, project, task: 'Spawn failure.' })
    expect(records.at(-1).note).toContain('start failed:')
  })

  it('starts run-lane with --project and --task on the bridge project', async () => {
    const project = tempDir('mr-project-dispatch-')
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const { url } = await startBridge({ projectRoot: project, runnerPath: writeRunner(runnerDir, out) })

    const res = await postJson(`${url}/api/control/runs`, { lane: 'opencode', task: 'Fix the typo.', confirmed: true })
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ lane: 'opencode', briefs: [] })
    expect(res.body.project).toBeUndefined()

    const args = await waitFor(() => readArgs(out), { what: 'the runner arguments' })
    expect(args).toEqual(['opencode', '--project', project, '--task', 'Fix the typo.'])
    await waitFor(async () => (await getJson(`${url}/api/control/runs`)).body.running.length === 0, { what: 'the run to end' })
  })

  it('passes --worktree when the body asks for the project run in a worktree, and refuses a plain folder and the orchestrator lane', async () => {
    const plain = tempDir('mr-project-dispatch-')
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const plainBridge = await startBridge({ projectRoot: plain, runnerPath: writeRunner(runnerDir, out) })
    const refused = await postJson(`${plainBridge.url}/api/control/runs`, { lane: 'opencode', task: 'Fix it.', worktree: true, confirmed: true })
    expect(refused.status).toBe(400)
    expect(refused.body).toEqual({
      error: `The project folder ${plain} is not a git folder. --worktree needs one.`,
    })
    expect(readArgs(out)).toBeNull()

    const project = tempDir('mr-project-dispatch-')
    execFileSync(gitPath(), ['init'], { cwd: project, stdio: 'ignore' })
    const { url } = await startBridge({ projectRoot: project, runnerPath: writeRunner(runnerDir, out) })

    const orchestrator = await postJson(`${url}/api/control/runs`, { lane: 'orchestrator', task: 'Fix it.', confirmed: true })
    expect(orchestrator.status).toBe(400)
    const res = await postJson(`${url}/api/control/runs`, { lane: 'opencode', task: 'Fix it.', worktree: true, confirmed: true })
    expect(res.status).toBe(202)
    const args = await waitFor(() => readArgs(out), { what: 'the runner arguments' })
    expect(args).toEqual(['opencode', '--project', project, '--task', 'Fix it.', '--worktree'])
    await waitFor(async () => (await getJson(`${url}/api/control/runs`)).body.running.length === 0, { what: 'the run to end' })
  })

  it('passes --allow-dirty only when the body allows it', async () => {
    const project = tempDir('mr-project-dispatch-')
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const { url } = await startBridge({ projectRoot: project, runnerPath: writeRunner(runnerDir, out) })

    const res = await postJson(`${url}/api/control/runs`, { lane: 'opencode', task: 'Fix it.', allowDirty: true, confirmed: true })
    expect(res.status).toBe(202)
    const args = await waitFor(() => readArgs(out), { what: 'the runner arguments' })
    expect(args).toEqual(['opencode', '--project', project, '--task', 'Fix it.', '--allow-dirty'])
    await waitFor(async () => (await getJson(`${url}/api/control/runs`)).body.running.length === 0, { what: 'the run to end' })
  })

  it('refuses a task outside 1 to 4000 characters', async () => {
    const project = tempDir('mr-project-dispatch-')
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const { url } = await startBridge({ projectRoot: project, runnerPath: writeRunner(runnerDir, out) })

    for (const task of ['', '   ', 'x'.repeat(4001), 42, null, undefined]) {
      const body = { lane: 'opencode', confirmed: true }
      if (task !== undefined) body.task = task
      const res = await postJson(`${url}/api/control/runs`, body)
      expect(res.status, String(task)).toBe(400)
      expect(res.body, String(task)).toEqual({ error: TASK_PROBLEM })
    }

    const last = await postJson(`${url}/api/control/runs`, { lane: 'opencode', task: 'x'.repeat(4000), confirmed: true })
    expect(last.status).toBe(202)
    const args = await waitFor(() => readArgs(out), { what: 'the runner arguments' })
    expect(args).toEqual(['opencode', '--project', project, '--task', 'x'.repeat(4000)])
    await waitFor(async () => (await getJson(`${url}/api/control/runs`)).body.running.length === 0, { what: 'the run to end' })
  })

  it('refuses a dirty project unless the body allows it', async () => {
    const project = tempDir('mr-project-dispatch-')
    execFileSync(gitPath(), ['init'], { cwd: project, stdio: 'ignore' })
    writeFileSync(join(project, 'notes.txt'), 'uncommitted\n')
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const { url } = await startBridge({ projectRoot: project, runnerPath: writeRunner(runnerDir, out) })

    const refused = await postJson(`${url}/api/control/runs`, { lane: 'opencode', task: 'Fix it.', confirmed: true })
    expect(refused.status).toBe(400)
    expect(refused.body).toEqual({
      error: `The project folder ${project} has uncommitted changes. Commit or discard them, or pass --allow-dirty.`,
    })

    const allowed = await postJson(`${url}/api/control/runs`, { lane: 'opencode', task: 'Fix it.', allowDirty: true, confirmed: true })
    expect(allowed.status).toBe(202)
    const args = await waitFor(() => readArgs(out), { what: 'the runner arguments' })
    expect(args).toEqual(['opencode', '--project', project, '--task', 'Fix it.', '--allow-dirty'])
    await waitFor(async () => (await getJson(`${url}/api/control/runs`)).body.running.length === 0, { what: 'the run to end' })
  })

  it('refuses a room on this checkout', async () => {
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const { url } = await startBridge({ projectRoot: REPO_ROOT, runnerPath: writeRunner(runnerDir, out) })

    const res = await postJson(`${url}/api/control/runs`, { lane: 'opencode', task: 'Fix it.', confirmed: true })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: `The project folder ${REAL_REPO_ROOT} is this checkout. Run on another project.`,
    })
    expect(readArgs(out)).toBeNull()
  })

  it('refuses a junction to this checkout', async (context) => {
    const base = tempDir('mr-project-dispatch-')
    const link = join(base, 'repo-link')
    try {
      symlinkSync(REPO_ROOT, link, 'junction')
    } catch {
      context.skip()
      return
    }
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const { url } = await startBridge({ projectRoot: link, runnerPath: writeRunner(runnerDir, out) })

    const res = await postJson(`${url}/api/control/runs`, { lane: 'opencode', task: 'Fix it.', confirmed: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe(`The project folder ${REAL_REPO_ROOT} is this checkout. Run on another project.`)
    expect(readArgs(out)).toBeNull()
  })

  it('refuses the runs folder', async () => {
    const base = tempDir('mr-project-dispatch-')
    const runs = join(base, 'machineroom-runs')
    mkdirSync(runs, { recursive: true })
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const { url } = await startBridge({ projectRoot: runs, runnerPath: writeRunner(runnerDir, out) })

    const previous = process.env.TEMP
    const previousRuns = process.env.MACHINEROOM_RUNS
    process.env.TEMP = base
    process.env.MACHINEROOM_RUNS = runs
    try {
      const res = await postJson(`${url}/api/control/runs`, { lane: 'opencode', task: 'Fix it.', confirmed: true })
      expect(res.status).toBe(400)
      expect(res.body).toEqual({
        error: `The project folder ${runs} is the runs folder or inside it. Run on another project.`,
      })
      expect(readArgs(out)).toBeNull()
    } finally {
      if (previous === undefined) delete process.env.TEMP
      else process.env.TEMP = previous
      if (previousRuns === undefined) delete process.env.MACHINEROOM_RUNS
      else process.env.MACHINEROOM_RUNS = previousRuns
    }
  })

  it('refuses a brief run on a room whose root is another repository', async () => {
    const project = tempDir('mr-project-dispatch-')
    writeProject(project)
    execFileSync(gitPath(), ['init'], { cwd: project, stdio: 'ignore' })
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const { url } = await startBridge({ projectRoot: project, runnerPath: writeRunner(runnerDir, out) })

    const res = await postJson(`${url}/api/control/runs`, { lane: 'opencode', briefs: ['C3e'], confirmed: true })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: BRIEF_PROJECT_PROBLEM })
    expect(readArgs(out)).toBeNull()
  })
})

describe('the runs route with a starter', () => {
  it('calls onMessage once with the dispatch from the starter to the lane', async () => {
    const project = tempDir('mr-project-dispatch-')
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const messages = []
    let answer = null
    const api = createRunsApi({
      projectRoot: project,
      briefsDir: join(REPO_ROOT, 'docs', 'agents'),
      runnerCommand: { file: process.execPath, args: [writeRunner(runnerDir, out)] },
      sendJson: (req, res, status, body) => {
        answer = { status, body }
      },
      readJsonBody: async () => ({ lane: 'opencode', task: 'Fix it.', startedBy: 'frontend', confirmed: true }),
      lanesFile: join(REPO_ROOT, 'docs', 'agents', 'lanes.json'),
      orchestrators: () => ({
        idForToken: () => null,
        sector: (id) => (id === 'frontend' ? { id, name: 'Frontend', lanes: ['opencode'] } : null),
      }),
      onMessage: (message) => messages.push(message),
    })
    cleanups.push(() => api.stopAll())

    const handled = await api.handle(
      { method: 'POST', headers: { origin: 'http://localhost:5173' } },
      {},
      new URL('http://127.0.0.1/api/control/runs')
    )
    expect(handled).toBe(true)
    expect(answer.status).toBe(202)
    expect(messages).toEqual([{ from: 'sub-frontend', to: 'opencode', kind: 'dispatch' }])
    await waitFor(() => readArgs(out), { what: 'the runner arguments' })
  })
})

describe('the chat lane start with a saved check command', () => {
  it('starts run-lane through parseRunArgs with --test and the saved command', async () => {
    const project = tempDir('mr-chat-dispatch-')
    const runnerDir = tempDir('mr-chat-runner-')
    const base = tempDir('mr-chat-bridge-')
    const runs = join(base, 'runs')
    const out = join(runnerDir, 'parsed.json')
    const promptFile = join(base, 'orchestrator-agent.md')
    mkdirSync(runs, { recursive: true })
    writeFileSync(promptFile, 'project={{PROJECT}}\nruns={{RUNS}}\n')
    const lanes = JSON.parse(readFileSync(join(REPO_ROOT, 'docs', 'agents', 'lanes.json'), 'utf8'))
    writeActiveLanes(activeLanesFileFor(project, runs), ['opencode'])
    const bridge = createBridge({
      projectRoot: project,
      port: 0,
      env: {},
      briefsDir: join(REPO_ROOT, 'docs', 'agents'),
      lanesFile: join(REPO_ROOT, 'docs', 'agents', 'lanes.json'),
      runsFolder: runs,
      runnerCommand: { file: process.execPath, args: [writeParseRunner(runnerDir, out)] },
      orchestratorPrompt: promptFile,
      lanesSource: { folder: runs, lanes, pollMs: 20, quietMs: 60000 },
      orchestratorSpawn: () => {
        throw new Error('the orchestrator should not spawn for a lane dispatch')
      },
    })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const saved = await fetch(`${url}/api/control/project-settings`, {
      method: 'POST',
      headers: { origin: url, 'content-type': 'application/json' },
      body: JSON.stringify({ checkCommand: 'node scripts/check.mjs', confirmed: true }),
    })
    expect(saved.status).toBe(200)

    const res = await fetch(`${url}/api/orchestrator/messages`, {
      method: 'POST',
      headers: { origin: url, 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'opencode', text: 'Fix the typo.' }),
    })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true, started: true })

    const parsed = await waitFor(() => readArgs(out), { what: 'the parsed lane arguments' })
    expect(parsed).toMatchObject({
      lane: 'opencode',
      project,
      task: 'Fix the typo.',
      test: 'node scripts/check.mjs',
      startedBy: 'orchestrator',
    })
    await waitFor(async () => (await getJson(`${url}/api/control/runs`)).body.running.length === 0, {
      what: 'the chat lane run to end',
    })
  })
})

describe('the runs route with a queue', () => {
  it('writes the queue file and starts run-lane with --queue', async () => {
    const project = gitProject('mr-project-dispatch-')
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const temp = tempDir('mr-project-temp-')
    const { url } = await startBridge({ projectRoot: project, runnerPath: writeRunner(runnerDir, out, 400) })
    const previous = process.env.TEMP
    const previousRuns = process.env.MACHINEROOM_RUNS
    process.env.TEMP = temp
    process.env.MACHINEROOM_RUNS = join(temp, 'machineroom-runs')
    try {
      const res = await postJson(`${url}/api/control/runs`, {
        lane: 'opencode',
        tasks: ['  Fix the typo.  ', 'Add a test.'],
        confirmed: true,
      })
      expect(res.status).toBe(202)
      expect(res.body).toMatchObject({ lane: 'opencode', briefs: [], queue: true, tasks: 2 })

      const args = await waitFor(() => readArgs(out), { what: 'the runner arguments' })
      expect(args.slice(0, 4)).toEqual(['opencode', '--project', project, '--queue'])
      const file = args[4]
      expect(basename(file)).toMatch(/^opencode-queue-\d{8}-\d{6}\.queue\.txt$/)
      expect(file).toBe(join(temp, 'machineroom-runs', basename(file)))
      expect(readFileSync(file, 'utf8')).toBe('Fix the typo.\n---\nAdd a test.')

      const entry = await waitFor(
        async () => (await getJson(`${url}/api/control/runs`)).body.running.find((item) => item.lane === 'opencode'),
        { what: 'the queue entry' }
      )
      expect(entry).toMatchObject({ lane: 'opencode', briefs: [], queue: true, tasks: 2 })
      await waitFor(async () => (await getJson(`${url}/api/control/runs`)).body.running.length === 0, { what: 'the run to end' })
      expect(queueFiles(join(temp, 'machineroom-runs'))).toHaveLength(1)
    } finally {
      if (previous === undefined) delete process.env.TEMP
      else process.env.TEMP = previous
      if (previousRuns === undefined) delete process.env.MACHINEROOM_RUNS
      else process.env.MACHINEROOM_RUNS = previousRuns
    }
  })

  it('passes the saved check command to the queue as --test', async () => {
    const project = gitProject('mr-project-dispatch-')
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const temp = tempDir('mr-project-temp-')
    const { url } = await startBridge({ projectRoot: project, runnerPath: writeRunner(runnerDir, out, 400) })
    const previous = process.env.TEMP
    const previousRuns = process.env.MACHINEROOM_RUNS
    process.env.TEMP = temp
    process.env.MACHINEROOM_RUNS = join(temp, 'machineroom-runs')
    try {
      const saved = await fetch(`${url}/api/control/project-settings`, {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ checkCommand: 'node scripts/check.mjs', confirmed: true }),
      })
      expect(saved.status).toBe(200)

      const res = await postJson(`${url}/api/control/runs`, {
        lane: 'opencode',
        tasks: ['Fix the typo.'],
        confirmed: true,
      })
      expect(res.status).toBe(202)

      const args = await waitFor(() => readArgs(out), { what: 'the runner arguments' })
      expect(args).toContain('--test')
      expect(args[args.indexOf('--test') + 1]).toBe('node scripts/check.mjs')
      expect(parseQueueArgs(args)).toMatchObject({ test: 'node scripts/check.mjs' })
      await waitFor(async () => (await getJson(`${url}/api/control/runs`)).body.running.length === 0, { what: 'the run to end' })
    } finally {
      if (previous === undefined) delete process.env.TEMP
      else process.env.TEMP = previous
      if (previousRuns === undefined) delete process.env.MACHINEROOM_RUNS
      else process.env.MACHINEROOM_RUNS = previousRuns
    }
  })

  it('refuses a queue start whose check command uses shell syntax', async () => {
    const project = gitProject('mr-project-dispatch-')
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const { url } = await startBridge({ projectRoot: project, runnerPath: writeRunner(runnerDir, out) })
    const res = await postJson(`${url}/api/control/runs`, {
      lane: 'opencode',
      tasks: ['Fix the typo.'],
      checkCommand: 'npm test && npm run build',
      confirmed: true,
    })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: CHECK_SHELL_PROBLEM })
    expect(existsSync(out)).toBe(false)
  })

  it('accepts twenty tasks of 4000 characters', async () => {
    const project = gitProject('mr-project-dispatch-')
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const temp = tempDir('mr-project-temp-')
    const { url } = await startBridge({ projectRoot: project, runnerPath: writeRunner(runnerDir, out) })
    const previous = process.env.TEMP
    process.env.TEMP = temp
    try {
      const tasks = Array.from({ length: 20 }, (_, index) => `${'x'.repeat(3996)}${String(index).padStart(4, '0')}`)
      const res = await postJson(`${url}/api/control/runs`, { lane: 'opencode', tasks, confirmed: true })
      expect(res.status).toBe(202)
      expect(res.body).toMatchObject({ queue: true, tasks: 20 })

      const args = await waitFor(() => readArgs(out), { what: 'the runner arguments' })
      const text = readFileSync(args[4], 'utf8')
      expect(text.split('\n---\n')).toEqual(tasks)
      await waitFor(async () => (await getJson(`${url}/api/control/runs`)).body.running.length === 0, { what: 'the run to end' })
    } finally {
      if (previous === undefined) delete process.env.TEMP
      else process.env.TEMP = previous
    }
  })

  it('refuses a task list the queue cannot hold', async () => {
    const project = tempDir('mr-project-dispatch-')
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const temp = tempDir('mr-project-temp-')
    const { url } = await startBridge({ projectRoot: project, runnerPath: writeRunner(runnerDir, out) })
    const previous = process.env.TEMP
    process.env.TEMP = temp
    try {
      const cases = [
        { tasks: [], error: TASKS_PROBLEM },
        { tasks: Array.from({ length: 21 }, (_, index) => `Task ${index}`), error: TASKS_PROBLEM },
        { tasks: [''], error: TASKS_PROBLEM },
        { tasks: ['   '], error: TASKS_PROBLEM },
        { tasks: ['x'.repeat(4001)], error: TASKS_PROBLEM },
        { tasks: [42], error: TASKS_PROBLEM },
        { tasks: ['one\n  ---  \ntwo'], error: TASK_SEPARATOR_PROBLEM },
        { tasks: ['one'], task: 'two', error: RUN_KIND_PROBLEM },
        { tasks: ['one'], briefs: ['C3e'], error: RUN_KIND_PROBLEM },
        { tasks: ['one'], allowDirty: true, error: QUEUE_DIRTY_PROBLEM },
      ]
      for (const { error, ...body } of cases) {
        const res = await postJson(`${url}/api/control/runs`, { lane: 'opencode', ...body, confirmed: true })
        expect(res.status, error).toBe(400)
        expect(res.body, error).toEqual({ error })
      }
      expect(readArgs(out)).toBeNull()
      expect(queueFiles(join(temp, 'machineroom-runs'))).toHaveLength(0)
    } finally {
      if (previous === undefined) delete process.env.TEMP
      else process.env.TEMP = previous
    }
  })

  it('refuses a queue on a folder that is not a git checkout before it writes the queue file', async () => {
    const project = tempDir('mr-project-dispatch-')
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const temp = tempDir('mr-project-temp-')
    const { url } = await startBridge({ projectRoot: project, runnerPath: writeRunner(runnerDir, out) })
    const previous = process.env.TEMP
    process.env.TEMP = temp
    try {
      const res = await postJson(`${url}/api/control/runs`, { lane: 'opencode', tasks: ['Fix it.'], confirmed: true })
      expect(res.status).toBe(400)
      expect(res.body).toEqual({
        error: `The project folder ${project} is not a git folder. A queue needs one.`,
      })
      expect(readArgs(out)).toBeNull()
      expect(queueFiles(join(temp, 'machineroom-runs'))).toHaveLength(0)
    } finally {
      if (previous === undefined) delete process.env.TEMP
      else process.env.TEMP = previous
    }
  })

  it('refuses a queue on a dirty project and on this checkout', async () => {
    const dirtyProject = tempDir('mr-project-dispatch-')
    execFileSync(gitPath(), ['init'], { cwd: dirtyProject, stdio: 'ignore' })
    writeFileSync(join(dirtyProject, 'notes.txt'), 'uncommitted\n')
    const runnerDir = tempDir('mr-project-runner-')
    const out = join(runnerDir, 'args.json')
    const { url } = await startBridge({ projectRoot: dirtyProject, runnerPath: writeRunner(runnerDir, out) })

    const dirty = await postJson(`${url}/api/control/runs`, { lane: 'opencode', tasks: ['Fix it.'], confirmed: true })
    expect(dirty.status).toBe(400)
    expect(dirty.body).toEqual({
      error: `The project folder ${dirtyProject} has uncommitted changes. Commit or discard them, or pass --allow-dirty.`,
    })

    const checkout = await startBridge({ projectRoot: REPO_ROOT, runnerPath: writeRunner(runnerDir, out) })
    const refused = await postJson(`${checkout.url}/api/control/runs`, { lane: 'opencode', tasks: ['Fix it.'], confirmed: true })
    expect(refused.status).toBe(400)
    expect(refused.body).toEqual({
      error: `The project folder ${REAL_REPO_ROOT} is this checkout. Run on another project.`,
    })
    expect(readArgs(out)).toBeNull()
  })
})

describe('the mock startRun with a task', () => {
  it('starts a project run and keeps its task in the record', async () => {
    const client = createMockClient({ latencyMs: 0, runMs: 40 })
    await expect(client.startRun('opencode', { task: '   ' })).rejects.toThrow(TASK_PROBLEM)
    await expect(client.startRun('opencode', { task: 'x'.repeat(4001) })).rejects.toThrow(TASK_PROBLEM)

    const entry = await client.startRun('opencode', { task: 'Fix the typo.', allowDirty: true })
    expect(entry).toMatchObject({ lane: 'opencode', briefs: [] })
    expect((await client.runs()).project).toBe('MachineRoom')

    const record = await waitFor(
      async () => (await client.runs()).recent.find((item) => item.lane === 'opencode' && item.task === 'Fix the typo.'),
      { what: 'the mock project record' }
    )
    expect(record).toMatchObject({ lane: 'opencode', briefs: [], project: 'MachineRoom', task: 'Fix the typo.' })
  })
})

describe('the mock startRun with a queue', () => {
  it('starts a queue and keeps its count in the entry and the record', async () => {
    const client = createMockClient({ latencyMs: 0, runMs: 60 })
    await expect(client.startRun('opencode', { tasks: [] })).rejects.toThrow(TASKS_PROBLEM)
    await expect(client.startRun('opencode', { tasks: ['one'], allowDirty: true })).rejects.toThrow(QUEUE_DIRTY_PROBLEM)
    await expect(client.startRun('opencode', { tasks: ['one'], task: 'two' })).rejects.toThrow(RUN_KIND_PROBLEM)
    await expect(client.startRun('opencode', { tasks: ['one\n---\ntwo'] })).rejects.toThrow(TASK_SEPARATOR_PROBLEM)

    const entry = await client.startRun('opencode', { tasks: ['Fix the typo.', 'Add a test.'] })
    expect(entry).toMatchObject({ lane: 'opencode', briefs: [], queue: true, tasks: 2 })
    const running = (await client.runs()).running
    expect(running[0]).toMatchObject({ lane: 'opencode', queue: true, tasks: 2 })

    const record = await waitFor(
      async () => (await client.runs()).recent.find((item) => item.lane === 'opencode' && item.queue === true),
      { what: 'the mock queue record' }
    )
    expect(record).toMatchObject({ lane: 'opencode', briefs: [], project: 'MachineRoom', queue: true, tasks: 2 })
    expect(record.task).toBeUndefined()
  })
})

describe('the project run helpers', () => {
  const AGENTS = [
    { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', role: null },
    { id: 'agent-agy', key: 'agy', name: 'agy', adapterType: 'process', role: null },
    { id: 'agent-claude', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', role: null },
    { id: 'agent-hermes', key: 'hermes', name: 'Hermes', adapterType: 'hermes_local', role: null },
    { id: 'agent-opencode-go', key: 'opencode-go', name: 'OpenCode Go', adapterType: 'opencode_local', role: 'engineer' },
    { id: 'agent-orchestrator', key: 'orchestrator', name: 'Orchestrator', adapterType: 'claude_local', role: 'ceo' },
    { id: 'agent-other', key: 'other', name: 'Other', adapterType: 'custom', role: null },
  ]

  it('lists the lanes that have a command line and no Paperclip role', () => {
    expect(projectRunLanes(AGENTS)).toEqual([
      { key: 'opencode', name: 'OpenCode', running: false },
      { key: 'agy', name: 'agy', running: false },
      { key: 'claude', name: 'Claude Code', running: false },
      { key: 'hermes', name: 'Hermes', running: false },
    ])
    expect(projectRunLanes(null)).toEqual([])
    expect(projectRunLanes([null, 7, 'opencode'])).toEqual([])
  })

  it('marks a lane that is running', () => {
    expect(projectRunLanes(AGENTS, [{ lane: 'opencode' }, { lane: ' hermes ' }, null, 7])).toEqual([
      { key: 'opencode', name: 'OpenCode', running: true },
      { key: 'agy', name: 'agy', running: false },
      { key: 'claude', name: 'Claude Code', running: false },
      { key: 'hermes', name: 'Hermes', running: true },
    ])
    expect(projectRunLanes(AGENTS, [])).toEqual([
      { key: 'opencode', name: 'OpenCode', running: false },
      { key: 'agy', name: 'agy', running: false },
      { key: 'claude', name: 'Claude Code', running: false },
      { key: 'hermes', name: 'Hermes', running: false },
    ])
  })

  it('names the lane, the project folder and the first 120 characters of the task', () => {
    const task = 'a'.repeat(PROJECT_CONFIRM_LIMIT + 50)
    expect(projectRunConfirm({ lane: 'opencode', project: 'Other', task })).toEqual({
      lane: 'opencode',
      project: 'Other',
      task: 'a'.repeat(PROJECT_CONFIRM_LIMIT),
    })
    expect(projectRunConfirm({ lane: 'agy', project: '', task: '  Fix it.  ' })).toEqual({
      lane: 'agy',
      project: 'this project',
      task: 'Fix it.',
    })
    expect(projectRunConfirm()).toEqual({ lane: '', project: 'this project', task: '' })
  })

  it('refuses a task outside 1 to 4000 characters', () => {
    for (const task of [undefined, null, 7, '', '   ', 'x'.repeat(4001)]) {
      expect(projectTaskProblem(task), String(task)).toBe(TASK_PROBLEM)
    }
    expect(projectTaskProblem('x')).toBeNull()
    expect(projectTaskProblem('x'.repeat(4000))).toBeNull()
  })
})

describe('Dispatch when it cannot show the project form', () => {
  function formClient(lanes, agents) {
    return {
      health: async () => ({ lanes }),
      agents: async () => agents,
    }
  }

  async function renderForm(client, agents) {
    let text = ''
    let lanePicker = null
    await withDom(async ({ container, root }) => {
      await act(async () => {
        root.render(createElement(DispatchPanel, { client, initialAgents: agents }))
      })
      await settle()
      text = container.textContent
      lanePicker = container.querySelector('#project-run-lane')
    })
    return { text, lanePicker }
  }

  it('chooses the sentence from lanes mode and the code lanes', () => {
    expect(NO_LANES_FORM_LINE).toBe('Runs start from a room opened with --lanes: npm run serve -- up --lanes.')
    expect(NO_CODE_LANE_FORM_LINE).toBe('No code lane is set up. Add one in Agents, Build a team.')
    expect(projectFormNotice({ lanesMode: false, lanes: [] })).toBe(NO_LANES_FORM_LINE)
    expect(projectFormNotice({ lanesMode: true, lanes: [] })).toBe(NO_CODE_LANE_FORM_LINE)
    expect(projectFormNotice({ lanesMode: true, lanes: [{ key: 'opencode' }] })).toBe('')
  })

  it('says a room without --lanes starts runs from one', async () => {
    const { text, lanePicker } = await renderForm(formClient(false, []), [])
    expect(text).toContain(NO_LANES_FORM_LINE)
    expect(lanePicker).toBeNull()
  })

  it('says a lanes room has no code lane', async () => {
    const { text, lanePicker } = await renderForm(formClient(true, []), [])
    expect(text).toContain(NO_CODE_LANE_FORM_LINE)
    expect(lanePicker).toBeNull()
  })

  it('shows the project form when a code lane is set up', async () => {
    const agents = [
      { id: 'agent-opencode', key: 'opencode', name: 'OpenCode', adapterType: 'opencode_local', role: null },
    ]
    const { text, lanePicker } = await renderForm(formClient(true, agents), agents)
    expect(lanePicker).not.toBeNull()
    expect(text).not.toContain(NO_LANES_FORM_LINE)
    expect(text).not.toContain(NO_CODE_LANE_FORM_LINE)
  })
})

describe('writeQueue', () => {
  it('writes tasks to file and cleans up temporary file on rename failure', () => {
    const dir = tempDir('mr-queue-')
    const file = join(dir, 'test.queue.txt')
    writeQueue(file, ['task 1', 'task 2'])
    expect(readFileSync(file, 'utf8')).toBe('task 1\n---\ntask 2')
    expect(existsSync(`${file}.tmp`)).toBe(false)

    const renameFails = () => {
      throw new Error('disk failure')
    }
    const fallbackFile = join(dir, 'fallback.queue.txt')
    writeQueue(fallbackFile, ['task a', 'task b'], { rename: renameFails })
    expect(readFileSync(fallbackFile, 'utf8')).toBe('task a\n---\ntask b')
    expect(existsSync(`${fallbackFile}.tmp`)).toBe(false)
  })
})

describe('GET /api/control/runs project scoping', () => {
  async function getRuns(projectRoot, runsDir) {
    let answer = null
    const api = createRunsApi({
      projectRoot,
      briefsDir: join(REPO_ROOT, 'docs', 'agents'),
      runsFolder: runsDir,
      lanesFile: join(REPO_ROOT, 'docs', 'agents', 'lanes.json'),
      runnerCommand: { file: process.execPath, args: [] },
      sendJson: (req, res, status, body) => {
        answer = { status, body }
      },
      readJsonBody: async () => ({}),
    })
    cleanups.push(() => api.stopAll())
    const handled = await api.handle(
      { method: 'GET', headers: { origin: 'http://localhost:5173' } },
      {},
      new URL('http://127.0.0.1/api/control/runs')
    )
    expect(handled).toBe(true)
    expect(answer.status).toBe(200)
    return answer.body
  }

  function writeRunRecords(runsDir, records) {
    mkdirSync(runsDir, { recursive: true })
    writeFileSync(join(runsDir, 'runs.jsonl'), `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
  }

  it('returns only project A runs including its worktree, and no project B or brief run', async () => {
    const runsDir = tempDir('mr-runs-scope-')
    const projectA = tempDir('mr-project-a-')
    const projectB = tempDir('mr-project-b-')
    const records = [
      { lane: 'opencode', briefs: [], project: projectA, task: 'Older A task', startedAt: '2026-11-10T01:00:00.000Z', exitCode: 0 },
      { lane: 'opencode2', briefs: [], project: worktreeFor(projectA, 'opencode2'), task: 'Worktree A task', startedAt: '2026-11-10T02:00:00.000Z', exitCode: 0 },
      { lane: 'agy', briefs: ['P1'], startedAt: '2026-11-10T03:00:00.000Z', exitCode: 0 },
      { lane: 'claude', briefs: [], project: projectB, task: 'Project B task', startedAt: '2026-11-10T04:00:00.000Z', exitCode: 0 },
      { lane: 'opencode2', briefs: [], project: worktreeFor(projectB, 'opencode2'), task: 'Worktree B task', startedAt: '2026-11-10T04:05:00.000Z', exitCode: 0 },
    ]
    for (let i = 1; i <= 21; i += 1) {
      records.push({
        lane: 'opencode',
        briefs: [],
        project: projectB,
        task: `Project B task ${i}`,
        startedAt: `2026-11-10T05:${String(i).padStart(2, '0')}:00.000Z`,
        exitCode: 0,
      })
    }
    writeRunRecords(runsDir, records)

    const body = await getRuns(projectA, runsDir)
    expect(body.recent.map((record) => record.task)).toEqual(['Worktree A task', 'Older A task'])
    expect(new Map(body.last.map((record) => [record.lane, record.task]))).toEqual(
      new Map([
        ['opencode', 'Older A task'],
        ['opencode2', 'Worktree A task'],
      ])
    )
  })

  it('matches resolved folders through junctions or symlinks for project A only', async (context) => {
    const runsDir = tempDir('mr-runs-link-')
    const projectA = tempDir('mr-project-a-target-')
    const projectB = tempDir('mr-project-b-other-')
    const aliasDir = tempDir('mr-project-alias-')
    const linkA = join(aliasDir, 'link-a')
    try {
      symlinkSync(projectA, linkA, process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      context.skip()
      return
    }
    writeRunRecords(runsDir, [
      { lane: 'opencode', briefs: [], project: linkA, task: 'Linked A task', startedAt: '2026-11-10T01:00:00.000Z', exitCode: 0 },
      { lane: 'opencode2', briefs: [], project: projectA, task: 'Direct A task', startedAt: '2026-11-10T02:00:00.000Z', exitCode: 0 },
      { lane: 'claude', briefs: [], project: projectB, task: 'Other B task', startedAt: '2026-11-10T03:00:00.000Z', exitCode: 0 },
    ])

    const fromTarget = await getRuns(projectA, runsDir)
    expect(fromTarget.recent.map((record) => record.task)).toEqual(['Direct A task', 'Linked A task'])

    const fromLink = await getRuns(linkA, runsDir)
    expect(fromLink.recent.map((record) => record.task)).toEqual(['Direct A task', 'Linked A task'])
  })

  it('returns only brief runs for this repository and no project A or project B run', async () => {
    const runsDir = tempDir('mr-runs-briefs-')
    const projectA = tempDir('mr-project-a-')
    const projectB = tempDir('mr-project-b-')
    writeRunRecords(runsDir, [
      { lane: 'opencode', briefs: [], project: projectA, task: 'Project A task', startedAt: '2026-11-10T01:00:00.000Z', exitCode: 0 },
      { lane: 'agy', briefs: ['P1'], startedAt: '2026-11-10T02:00:00.000Z', exitCode: 0 },
      { lane: 'opencode2', briefs: [], project: worktreeFor(projectB, 'opencode2'), task: 'Project B task', startedAt: '2026-11-10T03:00:00.000Z', exitCode: 0 },
      { lane: 'claude', briefs: ['P2'], project: '', startedAt: '2026-11-10T04:00:00.000Z', exitCode: 1, note: 'Failed brief' },
    ])

    const body = await getRuns(REPO_ROOT, runsDir)
    expect(body.recent.map((record) => record.briefs)).toEqual([['P2'], ['P1']])
    expect(body.last.map((record) => record.lane).sort()).toEqual(['agy', 'claude'])
  })
})

function writeStopAwareRunner(dir, startOut, stopOut, { waitMs = 5000, stopExit = 0, stopText = 'stopped: 123 (the run)' } = {}) {
  const path = join(dir, 'stop-runner.mjs')
  const lines = [
    "import { writeFileSync } from 'node:fs'",
    'const args = process.argv.slice(2)',
    "if (args[0] === '--stop') {",
    `  writeFileSync(${JSON.stringify(stopOut)}, JSON.stringify(args))`,
    `  console.log(${JSON.stringify(stopText)})`,
    stopExit !== 0 ? `  process.exit(${stopExit})` : '  process.exit(0)',
    '}',
    `writeFileSync(${JSON.stringify(startOut)}, JSON.stringify(args))`,
    "console.log('running ' + args[0])",
    `await new Promise((resolve) => setTimeout(resolve, ${waitMs}))`,
  ]
  writeFileSync(path, lines.join('\n'))
  return path
}

describe('POST /api/control/runs/stop', () => {
  it('stops a matching run via --stop and answers what the stop printed', async () => {
    const project = tempDir('mr-stop-project-')
    const runnerDir = tempDir('mr-stop-runner-')
    const startOut = join(runnerDir, 'start-args.json')
    const stopOut = join(runnerDir, 'stop-args.json')
    const runnerPath = writeStopAwareRunner(runnerDir, startOut, stopOut, {
      waitMs: 5000,
      stopText: 'stopped: 42 (the harness)',
    })
    const { url } = await startBridge({ projectRoot: project, runnerPath })

    const started = await postJson(`${url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Fix the flaky test.',
      allowDirty: true,
      confirmed: true,
    })
    expect(started.status).toBe(202)
    await waitFor(() => readArgs(startOut), { what: 'the lane run to start' })

    const before = await getJson(`${url}/api/control/runs`)
    expect(before.body.running).toHaveLength(1)
    expect(before.body.running[0]).toMatchObject({
      lane: 'opencode',
      startedAt: started.body.startedAt,
      task: 'Fix the flaky test.',
    })

    const stopped = await postJson(`${url}/api/control/runs/stop`, {
      lane: 'opencode',
      startedAt: started.body.startedAt,
      confirmed: true,
    })
    expect(stopped.status).toBe(200)
    expect(stopped.body).toEqual({
      ok: true,
      lane: 'opencode',
      startedAt: started.body.startedAt,
      output: 'stopped: 42 (the harness)',
    })
    expect(readArgs(stopOut)).toEqual(['--stop', 'opencode'])

    const after = await getJson(`${url}/api/control/runs`)
    expect(after.body.running).toEqual([])
    const records = readFileSync(join(runsFolder(), 'runs.jsonl'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line))
    expect(records.at(-1)).toMatchObject({
      lane: 'opencode',
      startedAt: started.body.startedAt,
      killed: true,
      task: 'Fix the flaky test.',
    })
  })

  it('refuses a mismatched start time, an unconfirmed request, a finished run and a bad origin', async () => {
    const project = tempDir('mr-stop-refuse-')
    const runnerDir = tempDir('mr-stop-runner-')
    const startOut = join(runnerDir, 'start-args.json')
    const stopOut = join(runnerDir, 'stop-args.json')
    const runnerPath = writeStopAwareRunner(runnerDir, startOut, stopOut, { waitMs: 5000 })
    const { url } = await startBridge({ projectRoot: project, runnerPath })

    const idle = await postJson(`${url}/api/control/runs/stop`, {
      lane: 'opencode',
      startedAt: '2026-11-13T10:00:00.000Z',
      confirmed: true,
    })
    expect(idle.status).toBe(409)
    expect(idle.body).toEqual({ error: 'No run is running on opencode.' })

    const started = await postJson(`${url}/api/control/runs`, {
      lane: 'opencode',
      task: 'Refactor it.',
      allowDirty: true,
      confirmed: true,
    })
    expect(started.status).toBe(202)
    await waitFor(() => readArgs(startOut), { what: 'the run to begin' })

    const unconfirmed = await postJson(`${url}/api/control/runs/stop`, {
      lane: 'opencode',
      startedAt: started.body.startedAt,
      confirmed: false,
    })
    expect(unconfirmed.status).toBe(400)
    expect(unconfirmed.body).toEqual({ error: 'Confirm the stop first.' })

    const mismatch = await postJson(`${url}/api/control/runs/stop`, {
      lane: 'opencode',
      startedAt: '2026-11-13T00:00:00.000Z',
      confirmed: true,
    })
    expect(mismatch.status).toBe(409)
    expect(mismatch.body).toEqual({ error: 'That start time does not match the running run.' })

    const badOrigin = await fetch(`${url}/api/control/runs/stop`, {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        lane: 'opencode',
        startedAt: started.body.startedAt,
        confirmed: true,
      }),
    })
    expect(badOrigin.status).toBe(403)
    expect(readArgs(stopOut)).toBeNull()

    const allowedOrigin = await fetch(`${url}/api/control/runs/stop`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        lane: 'opencode',
        startedAt: started.body.startedAt,
        confirmed: true,
      }),
    })
    expect(allowedOrigin.status).toBe(200)

    const finished = await postJson(`${url}/api/control/runs/stop`, {
      lane: 'opencode',
      startedAt: started.body.startedAt,
      confirmed: true,
    })
    expect(finished.status).toBe(409)
    expect(finished.body).toEqual({ error: 'No run is running on opencode.' })
  })
})
