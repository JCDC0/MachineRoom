import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createBridge } from '../server/index.js'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { runsFolder } from '../server/lanes-source.js'
import { gitPath } from '../server/programPath.js'
import { BRIEF_PROJECT_PROBLEM, QUEUE_DIRTY_PROBLEM, RUN_KIND_PROBLEM, TASK_PROBLEM, TASK_SEPARATOR_PROBLEM, TASKS_PROBLEM, createRunsApi, writeQueue } from '../server/runs.js'
import { createMockClient } from '../src/control/mock.js'
import {
  PROJECT_CONFIRM_LIMIT,
  projectRunConfirm,
  projectRunLanes,
  projectTaskProblem,
} from '../src/ui/panels/runs.js'
import { getJson, postJson, waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

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
