import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { killTree } from '../server/processTree.js'
import { readLaneLock, releaseLaneLock, takeLaneLock } from '../scripts/lane-lock.mjs'
import { startLane } from '../scripts/run-lane.mjs'
import { laneLockText } from '../src/briefs/run.js'
import { makeTempDir } from './helpers/tempRoot.js'

const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const DEAD_PID = 2147483647
const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    fn()
  }
})

function tempDir(prefix) {
  const folder = makeTempDir(prefix)
  cleanups.push(() => rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return folder
}

function sleep(ms) {
  return new Promise((settle) => setTimeout(settle, ms))
}

async function waitUntil(fn, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fn()) return true
    await sleep(50)
  }
  return false
}

function runLane(args, env) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [RUN_LANE_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    })
    cleanups.push(() => killTree(child))
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      killTree(child)
      fail(new Error(`run-lane did not exit. stderr: ${stderr}`))
    }, 30000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      fail(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      done({ code, stdout, stderr })
    })
  })
}

function fakeLane(project, worktree) {
  return {
    name: 'Fake',
    harness: 'OpenCode',
    model: 'fake',
    reasoning: 'max',
    cli: { harness: 'opencode', bin: process.execPath, model: 'fake/model' },
    worktree,
  }
}

function writeFakeHarness(project, mark, started, { stay = true } = {}) {
  const late = join(project, 'late.cjs')
  writeFileSync(late, [
    "const { writeFileSync } = require('node:fs')",
    `setTimeout(() => writeFileSync(${JSON.stringify(mark)}, 'late'), 2000)`,
    '',
  ].join('\n'))
  const script = join(project, 'run')
  writeFileSync(script, [
    "const { spawn } = require('node:child_process')",
    "const { writeFileSync } = require('node:fs')",
    `writeFileSync(${JSON.stringify(started)}, 'started')`,
    `const grandchild = spawn(process.execPath, [${JSON.stringify(late)}, ${JSON.stringify(project)}], { detached: true, stdio: 'ignore', windowsHide: true })`,
    'grandchild.unref()',
    stay ? 'setTimeout(() => {}, 60000)' : '',
    "console.log('{\"type\":\"text\",\"part\":{\"type\":\"text\",\"text\":\"fake harness\"}}')",
    '',
  ].join('\n'))
}

function setup(prefix, laneKey = 'fake') {
  const base = tempDir(prefix)
  const project = join(base, 'lane')
  const worktree = join(base, 'worktree')
  const runs = join(base, 'runs')
  mkdirSync(project, { recursive: true })
  mkdirSync(worktree, { recursive: true })
  mkdirSync(runs, { recursive: true })
  const lane = fakeLane(project, worktree)
  const lanesFile = join(base, 'lanes.json')
  writeFileSync(lanesFile, `${JSON.stringify({ [laneKey]: lane })}\n`)
  const env = { MACHINEROOM_LANES_FILE: lanesFile, MACHINEROOM_RUNS: runs, TEMP: base }
  return { base, project, worktree, runs, lane, lanesFile, env }
}

describe('a stopped lane stays stopped', () => {
  it('--stop kills the run, the harness and the grandchild before it writes', async () => {
    const { project, runs, env } = setup('mr-run-stop-')
    const mark = join(project, 'late.txt')
    const started = join(project, 'started.txt')
    writeFakeHarness(project, mark, started)
    const run = runLane(['fake', '--project', project, '--task', 'Do it.'], env)
    expect(await waitUntil(() => existsSync(started) && existsSync(join(runs, 'fake.lock')))).toBe(true)
    const lock = readLaneLock(join(runs, 'fake.lock'))
    expect(lock.pid).toBeGreaterThan(0)
    expect(lock.child).toBeGreaterThan(0)
    expect(lock.folder).toBe('')

    const stopped = await runLane(['--stop', 'fake'], env)
    expect(stopped.code).toBe(0)
    expect(stopped.stdout).toContain(`stopped: ${lock.child} (the harness)`)
    expect(stopped.stdout).toContain(`stopped: ${lock.pid} (the run)`)
    expect(stopped.stdout).toContain('leftover: stopped')
    expect(existsSync(join(runs, 'fake.lock'))).toBe(false)
    expect(await run).toMatchObject({ code: expect.any(Number) })
    await sleep(2600)
    expect(existsSync(mark)).toBe(false)
  }, 40000)

  it('the time limit kills the harness and the grandchild before it writes', async () => {
    const { project, runs, lane } = setup('mr-run-limit-')
    const mark = join(project, 'late.txt')
    const started = join(project, 'started.txt')
    writeFakeHarness(project, mark, started)
    const previous = process.env.MACHINEROOM_RUNS
    process.env.MACHINEROOM_RUNS = runs
    const lock = takeLaneLock(runs, 'fake', { worktree: project })
    try {
      const run = await startLane({
        options: { lane: 'fake', minutes: 0.02 },
        lane,
        lanes: { fake: lane },
        wanted: [],
        prompt: 'Do it.',
        logPath: join(runs, 'fake-limit.log'),
        usageFile: join(runs, 'fake-limit.usage.json'),
        name: 'fake-limit',
        project,
        task: 'Do it.',
        lockPath: lock,
      })
      expect(run.killed).toBe(true)
      await sleep(2600)
      expect(existsSync(mark)).toBe(false)
      const record = JSON.parse(readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim())
      expect(record.lane).toBe('fake')
      expect(record.killed).toBe(true)
    } finally {
      releaseLaneLock(lock)
      if (previous === undefined) delete process.env.MACHINEROOM_RUNS
      else process.env.MACHINEROOM_RUNS = previous
    }
  }, 40000)

  it('refuses a new run while the lock names a live harness child', async () => {
    const { project, runs, env } = setup('mr-run-child-')
    writeFileSync(join(runs, 'fake.lock'), laneLockText({ pid: DEAD_PID, child: process.pid, folder: project }))
    const result = await runLane(['fake', '--project', project, '--task', 'Do it.'], env)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`The fake lane still has harness process ${process.pid}; stop it with npm run run-lane -- --stop fake.`)
    expect(result.stdout).not.toContain('exit code:')
  }, 30000)

  it('refuses a new run while a process still names the worktree the lock recorded', async () => {
    const { project, runs, env } = setup('mr-run-leftover-')
    writeFileSync(join(runs, 'fake.lock'), laneLockText({ pid: DEAD_PID, folder: project }))
    const leftover = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', project], {
      stdio: 'ignore',
      windowsHide: true,
    })
    cleanups.push(() => killTree(leftover))
    const result = await runLane(['fake', '--project', project, '--task', 'Do it.'], env)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`The fake lane still has leftover process ${leftover.pid}; stop it with npm run run-lane -- --stop fake.`)
    expect(result.stdout).not.toContain('exit code:')
  }, 30000)

  it('does not take a process that names a project run without its own worktree', async () => {
    const { project, runs, env } = setup('mr-run-editor-')
    writeFileSync(join(runs, 'fake.lock'), laneLockText({ pid: DEAD_PID }))
    const editor = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', project], {
      stdio: 'ignore',
      windowsHide: true,
    })
    cleanups.push(() => killTree(editor))
    const result = await runLane(['fake', '--project', project, '--task', 'Do it.'], env)
    expect(result.stderr).not.toContain('leftover process')
    expect(result.stdout).not.toContain(`leftover: stopped ${editor.pid}`)
    expect(editor.exitCode).toBe(null)
  }, 30000)
})
