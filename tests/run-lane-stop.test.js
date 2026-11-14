import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { descendantProcesses, killTree, leftoverProcesses, listProcesses } from '../server/processTree.js'
import { readLaneLock, releaseLaneLock, takeLaneLock, processAlive } from '../scripts/lane-lock.mjs'
import { isResultLine, startLane, stopLane } from '../scripts/run-lane.mjs'
import { laneLockLog, laneLockStartedAt, laneLockText } from '../src/briefs/run.js'
import { makeTempDir } from './helpers/tempRoot.js'

const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const DEAD_PID = 2147483647
const HARNESS_LATE_WRITE_MS = 30000
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

async function waitUntil(fn, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fn()) return true
    await new Promise((settle) => setTimeout(settle, 50))
  }
  return false
}

function readStartedPid(path) {
  try {
    const pid = Number(readFileSync(path, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : 0
  } catch {
    return 0
  }
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
    `writeFileSync(${JSON.stringify(started)}, String(process.pid))`,
    `setTimeout(() => { try { writeFileSync(${JSON.stringify(mark)}, 'late') } catch {} }, ${HARNESS_LATE_WRITE_MS})`,
    '',
  ].join('\n'))
  const script = join(project, 'run')
  writeFileSync(script, [
    "const { spawn } = require('node:child_process')",
    `const grandchild = spawn(process.execPath, [${JSON.stringify(late)}, ${JSON.stringify(project)}], { detached: true, stdio: 'ignore', windowsHide: true })`,
    'grandchild.unref()',
    stay ? 'setTimeout(() => {}, 60000)' : '',
    "console.log('{\"type\":\"text\",\"part\":{\"type\":\"text\",\"text\":\"fake harness\"}}')",
    '',
  ].join('\n'))
}

function writeFakeHarnessHoldingStdout(project, mark, started, { holdMs = 8000 } = {}) {
  const late = join(project, 'late.cjs')
  writeFileSync(late, [
    "const { writeFileSync } = require('node:fs')",
    `writeFileSync(${JSON.stringify(started)}, String(process.pid))`,
    `setTimeout(() => { try { writeFileSync(${JSON.stringify(mark)}, 'late') } catch {} }, ${holdMs})`,
    '',
  ].join('\n'))
  const script = join(project, 'run')
  writeFileSync(script, [
    "const { spawn } = require('node:child_process')",
    `const grandchild = spawn(process.execPath, [${JSON.stringify(late)}, ${JSON.stringify(project)}], { detached: true, stdio: [0, 1, 2], windowsHide: true })`,
    'grandchild.unref()',
    "console.log('{\"type\":\"text\",\"part\":{\"type\":\"text\",\"text\":\"fake harness\"}}')",
    'process.exit(0)',
  ].join('\n'))
}

function writeFakeHangingResultHarness(project, started, { holdMs = 8000 } = {}) {
  const late = join(project, 'late.cjs')
  writeFileSync(late, [
    "const { writeFileSync } = require('node:fs')",
    `writeFileSync(${JSON.stringify(started)}, String(process.pid))`,
    `setTimeout(() => {}, ${holdMs})`,
    '',
  ].join('\n'))
  const script = join(project, 'run')
  writeFileSync(script, [
    "const { spawn } = require('node:child_process')",
    `const grandchild = spawn(process.execPath, [${JSON.stringify(late)}, ${JSON.stringify(project)}], { detached: true, stdio: [0, 1, 2], windowsHide: true })`,
    'grandchild.unref()',
    "console.log('{\"event\":\"result\",\"result\":{\"status\":\"SUCCESS\"}}')",
    `setTimeout(() => {}, ${holdMs})`,
  ].join('\n'))
}

function startIdleProcess() {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  cleanups.push(() => killTree(child))
  return child
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
    let lock
    let grandchildPid = 0
    const ready = await waitUntil(() => {
      lock = readLaneLock(join(runs, 'fake.lock'))
      if (!Number.isInteger(lock.child) || lock.child <= 0) return false
      grandchildPid = readStartedPid(started)
      if (grandchildPid <= 0 || !processAlive(grandchildPid)) return false
      return descendantProcesses(listProcesses(), { rootPid: lock.child, ownPid: process.pid }).some((item) => item.pid === grandchildPid)
    })
    expect(ready, 'the harness and its grandchild were not in the process list').toBe(true)
    expect(lock.pid).toBeGreaterThan(0)
    expect(lock.child).toBeGreaterThan(0)
    expect(lock.folder).toBe(project)
    expect(lock.projectRun).toBe(true)
    const lockFile = readFileSync(join(runs, 'fake.lock'), 'utf8')
    const lockStart = laneLockStartedAt(lockFile)
    expect(lockStart).not.toBe('')
    expect(laneLockLog(lockFile)).toMatch(/^fake-project-\d{8}-\d{6}\.log$/)
    expect(processAlive(grandchildPid)).toBe(true)

    const stopped = await runLane(['--stop', 'fake'], env)
    if (stopped.code !== 0) {
      console.log(`stop exited ${stopped.code}. stdout:\n${stopped.stdout}\nstderr:\n${stopped.stderr}`)
    }
    expect(stopped.code).toBe(0)
    expect(stopped.stdout).toContain(`stopped: ${lock.child} (the harness)`)
    expect(stopped.stdout).toContain('leftover: stopped')
    expect(existsSync(join(runs, 'fake.lock'))).toBe(false)
    expect(await waitUntil(() => !processAlive(lock.pid), 5000), `the run ${lock.pid} is still alive`).toBe(true)
    expect(await waitUntil(() => !processAlive(grandchildPid), 5000), `the grandchild ${grandchildPid} is still alive`).toBe(true)
    const finished = await run
    expect(finished.code === null || Number.isInteger(finished.code)).toBe(true)
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
      const grandchildPid = readStartedPid(started)
      if (grandchildPid > 0) {
        expect(await waitUntil(() => !processAlive(grandchildPid), 5000), `the grandchild ${grandchildPid} is still alive`).toBe(true)
      } else {
        const harnessPid = readLaneLock(lock).child
        expect(await waitUntil(() => descendantProcesses(listProcesses(), { rootPid: harnessPid, ownPid: process.pid }).length === 0, 5000), 'the harness still has a child').toBe(true)
      }
      expect(existsSync(mark)).toBe(false)
      const record = JSON.parse(readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim())
      expect(record.lane).toBe('fake')
      expect(record.killed).toBe(true)
      expect(record.startedAt).toBe(laneLockStartedAt(readFileSync(lock, 'utf8')))
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
    const began = join(project, 'leftover-started.txt')
    const leftoverScript = `require('node:fs').writeFileSync(${JSON.stringify(began)}, String(process.pid)); setTimeout(() => {}, 60000)`
    const leftover = spawn(process.execPath, ['-e', leftoverScript, project], {
      stdio: 'ignore',
      windowsHide: true,
    })
    cleanups.push(() => killTree(leftover))
    const leftoverReady = await waitUntil(() => existsSync(began) && leftoverProcesses(listProcesses(), { worktree: project, ownPid: process.pid }).some((item) => item.pid === leftover.pid))
    expect(leftoverReady, 'the leftover process was not in the process list').toBe(true)
    const result = await runLane(['fake', '--project', project, '--task', 'Do it.'], env)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`The fake lane still has leftover process ${leftover.pid}; stop it with npm run run-lane -- --stop fake.`)
    expect(result.stdout).not.toContain('exit code:')
  }, 30000)

  it('does not take a process that names a project run without its own worktree', async () => {
    const { project, runs, env } = setup('mr-run-editor-')
    writeFileSync(join(runs, 'fake.lock'), laneLockText({ pid: DEAD_PID }))
    const began = join(project, 'editor-started.txt')
    const editorScript = `require('node:fs').writeFileSync(${JSON.stringify(began)}, String(process.pid)); setTimeout(() => {}, 60000)`
    const editor = spawn(process.execPath, ['-e', editorScript, project], {
      stdio: 'ignore',
      windowsHide: true,
    })
    cleanups.push(() => killTree(editor))
    const editorReady = await waitUntil(() => existsSync(began) && leftoverProcesses(listProcesses(), { worktree: project, ownPid: process.pid }).some((item) => item.pid === editor.pid))
    expect(editorReady, 'the editor process was not in the process list').toBe(true)
    const result = await runLane(['fake', '--project', project, '--task', 'Do it.'], env)
    expect(result.stderr).not.toContain('leftover process')
    expect(result.stdout).not.toContain(`leftover: stopped ${editor.pid}`)
    expect(editor.exitCode).toBe(null)
  }, 30000)

  it('finishes with exit code 0 when the harness exits but a child holds stdout', async () => {
    const { project, runs, env } = setup('mr-run-stdout-')
    const mark = join(project, 'late.txt')
    const started = join(project, 'started.txt')
    writeFakeHarnessHoldingStdout(project, mark, started, { holdMs: 8000 })
    const run = await runLane(['fake', '--project', project, '--task', 'Do it.'], {
      ...env,
      MACHINEROOM_CLOSE_TIMEOUT_MS: '400',
    })
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('exit code: 0 (leftovers were stopped)')
    expect(existsSync(join(runs, 'fake.lock'))).toBe(false)
    const record = JSON.parse(readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim())
    expect(record.lane).toBe('fake')
    expect(record.exitCode).toBe(0)
    expect(record.killed).toBe(false)
    expect(record.note).toBe('leftovers were stopped')
    // Linux gives an orphan to init, so its parent chain no longer reaches the harness.
    if (process.platform === 'win32') expect(record.stoppedLeftovers).toBeGreaterThan(0)
    const grandchildPid = readStartedPid(started)
    if (grandchildPid > 0 && process.platform === 'win32') {
      expect(await waitUntil(() => !processAlive(grandchildPid), 5000), `the grandchild ${grandchildPid} is still alive`).toBe(true)
    } else if (grandchildPid > 0) {
      try {
        process.kill(grandchildPid)
      } catch {}
    }
    expect(existsSync(mark)).toBe(false)
  }, 30000)

  it('finishes with exit code 0 when the harness hangs after printing its result line', async () => {
    const { project, runs, env } = setup('mr-run-hang-')
    const started = join(project, 'started.txt')
    writeFakeHangingResultHarness(project, started, { holdMs: 8000 })
    const run = runLane(['fake', '--project', project, '--task', 'Do it.'], {
      ...env,
      MACHINEROOM_CLOSE_TIMEOUT_MS: '400',
    })
    const aliveBeforeStop = await waitUntil(() => {
      const pid = readStartedPid(started)
      return pid > 0 && processAlive(pid)
    }, 5000)
    expect(aliveBeforeStop, 'the harness grandchild was not alive before the stop').toBe(true)
    const grandchildPid = readStartedPid(started)
    const result = await run
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('exit code: 0 (leftovers were stopped)')
    expect(existsSync(join(runs, 'fake.lock'))).toBe(false)
    const record = JSON.parse(readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim())
    expect(record.lane).toBe('fake')
    expect(record.exitCode).toBe(0)
    expect(record.killed).toBe(false)
    expect(record.note).toBe('leftovers were stopped')
    if (process.platform === 'win32') expect(record.stoppedLeftovers).toBeGreaterThan(0)
    if (process.platform === 'win32') expect(await waitUntil(() => !processAlive(grandchildPid), 5000), `the grandchild ${grandchildPid} is still alive`).toBe(true)
    else
      try {
        process.kill(grandchildPid)
      } catch {}
  }, 30000)

  it('refuses a stop that names an older start time and leaves the newer run alive', async () => {
    const { worktree, runs, env } = setup('mr-run-older-')
    const live = startIdleProcess()
    expect(await waitUntil(() => processAlive(live.pid), 5000), 'the run did not start').toBe(true)
    const current = new Date().toISOString()
    const older = new Date(Date.now() - 60000).toISOString()
    writeFileSync(join(runs, 'fake.lock'), laneLockText({ pid: live.pid, folder: worktree, startedAt: current }))

    const refused = await runLane(['--stop', 'fake', '--started-at', older], env)
    expect(refused.code).toBe(1)
    expect(refused.stdout).toContain('The fake lane is running a different run now, so nothing was stopped.')
    expect(processAlive(live.pid)).toBe(true)
    expect(existsSync(join(runs, 'fake.lock'))).toBe(true)
  }, 30000)

  it('stops the run a stop names by its start time', async () => {
    const { worktree, runs, env } = setup('mr-run-current-')
    const live = startIdleProcess()
    expect(await waitUntil(() => processAlive(live.pid), 5000), 'the run did not start').toBe(true)
    const current = new Date().toISOString()
    writeFileSync(join(runs, 'fake.lock'), laneLockText({ pid: live.pid, folder: worktree, startedAt: current }))

    const stopped = await runLane(['--stop', 'fake', '--started-at', current], env)
    if (stopped.code !== 0) {
      console.log(`stop exited ${stopped.code}. stdout:\n${stopped.stdout}\nstderr:\n${stopped.stderr}`)
    }
    expect(stopped.code).toBe(0)
    expect(await waitUntil(() => !processAlive(live.pid), 5000), `the run ${live.pid} is still alive`).toBe(true)
    expect(existsSync(join(runs, 'fake.lock'))).toBe(false)
  }, 30000)
})

describe('isResultLine helper', () => {
  it('detects AGY result event', () => {
    expect(isResultLine('{"event":"result","result":{"status":"SUCCESS"}}')).toBe(true)
  })

  it('detects Claude and MachineRoom result type', () => {
    expect(isResultLine('{"type":"result","result":"done"}')).toBe(true)
  })

  it('ignores subagent result lines with parent_tool_use_id', () => {
    expect(isResultLine('{"type":"result","result":"sub","parent_tool_use_id":"123"}')).toBe(false)
  })

  it('ignores non-result and non-json lines', () => {
    expect(isResultLine('{"type":"text","part":{"text":"hello"}}')).toBe(false)
    expect(isResultLine('plain text')).toBe(false)
    expect(isResultLine('')).toBe(false)
  })
})

describe('stopLane creation time rules', () => {
  function withEnv(env, fn) {
    const prior = { ...process.env }
    Object.assign(process.env, env)
    try {
      return fn()
    } finally {
      for (const key of Object.keys(env)) {
        if (prior[key] === undefined) delete process.env[key]
        else process.env[key] = prior[key]
      }
    }
  }

  it('stops a process created no later than the lock file last change plus 2 seconds', () => {
    const { runs, env } = setup('mr-stop-rules-')
    const lockPath = join(runs, 'fake.lock')
    writeFileSync(lockPath, laneLockText({ pid: 100, child: 200 }))
    const lockMtime = 10000
    const killed = []
    const lines = []
    const log = console.log
    console.log = (msg) => lines.push(msg)
    try {
      withEnv(env, () => {
        const code = stopLane('fake', {
          platform: 'win32',
          stat: () => ({ mtimeMs: lockMtime }),
          list: () => [
            { pid: 100, ppid: 1, created: 9000 },
            { pid: 200, ppid: 100, created: 11500 },
          ],
          kill: ({ pid }) => {
            killed.push(pid)
            return true
          },
        })
        expect(code).toBe(0)
      })
      expect(killed).toEqual([200, 100])
      expect(lines).toContain('stopped: 200 (the harness)')
      expect(lines).toContain('stopped: 100 (the run)')
    } finally {
      console.log = log
    }
  })

  it('prints stale when created after the lock file last change plus 2 seconds', () => {
    const { runs, env } = setup('mr-stop-stale-')
    const lockPath = join(runs, 'fake.lock')
    writeFileSync(lockPath, laneLockText({ pid: 100, child: 200 }))
    const lockMtime = 10000
    const killed = []
    const lines = []
    const log = console.log
    console.log = (msg) => lines.push(msg)
    try {
      withEnv(env, () => {
        const code = stopLane('fake', {
          platform: 'win32',
          stat: () => ({ mtimeMs: lockMtime }),
          list: () => [
            { pid: 100, ppid: 1, created: 12500 },
            { pid: 200, ppid: 100, created: 13000 },
          ],
          kill: ({ pid }) => {
            killed.push(pid)
            return true
          },
        })
        expect(code).toBe(0)
      })
      expect(killed).toEqual([])
      expect(lines).toContain('stale: 200 was not this run')
      expect(lines).toContain('stale: 100 was not this run')
    } finally {
      console.log = log
    }
  })

  it('treats a process missing from the list as gone', () => {
    const { runs, env } = setup('mr-stop-missing-')
    const lockPath = join(runs, 'fake.lock')
    writeFileSync(lockPath, laneLockText({ pid: 100, child: 200 }))
    const lockMtime = 10000
    const killed = []
    const lines = []
    const log = console.log
    console.log = (msg) => lines.push(msg)
    try {
      withEnv(env, () => {
        const code = stopLane('fake', {
          platform: 'win32',
          stat: () => ({ mtimeMs: lockMtime }),
          list: () => [{ pid: 999, ppid: 1, created: 5000 }],
          kill: ({ pid }) => {
            killed.push(pid)
            return true
          },
        })
        expect(code).toBe(0)
      })
      expect(killed).toEqual([])
      expect(lines).not.toContain('stale: 200 was not this run')
      expect(lines).not.toContain('stale: 100 was not this run')
    } finally {
      console.log = log
    }
  })

  it('keeps what the code does when a row has no created', () => {
    const { runs, env } = setup('mr-stop-nocreated-')
    const lockPath = join(runs, 'fake.lock')
    writeFileSync(lockPath, laneLockText({ pid: 100, child: 200 }))
    const killed = []
    const lines = []
    const log = console.log
    console.log = (msg) => lines.push(msg)
    try {
      withEnv(env, () => {
        const code = stopLane('fake', {
          platform: 'win32',
          stat: () => ({ mtimeMs: 10000 }),
          list: () => [
            { pid: 100, ppid: 1 },
            { pid: 200, ppid: 100 },
          ],
          kill: ({ pid }) => {
            killed.push(pid)
            return true
          },
        })
        expect(code).toBe(0)
      })
      expect(killed).toEqual([200, 100])
      expect(lines).toContain('stopped: 200 (the harness)')
      expect(lines).toContain('stopped: 100 (the run)')
    } finally {
      console.log = log
    }
  })

  it('keeps what the code does when the process list fails', () => {
    const { runs, env } = setup('mr-stop-fail-')
    const lockPath = join(runs, 'fake.lock')
    writeFileSync(lockPath, laneLockText({ pid: 100, child: 200 }))
    const killed = []
    const lines = []
    const log = console.log
    console.log = (msg) => lines.push(msg)
    try {
      withEnv(env, () => {
        const code = stopLane('fake', {
          platform: 'win32',
          stat: () => ({ mtimeMs: 10000 }),
          list: () => [],
          kill: ({ pid }) => {
            killed.push(pid)
            return true
          },
        })
        expect(code).toBe(0)
      })
      expect(killed).toEqual([200, 100])
      expect(lines).toContain('stopped: 200 (the harness)')
      expect(lines).toContain('stopped: 100 (the run)')
    } finally {
      console.log = log
    }
  })

  it('keeps what the code does away from Windows', () => {
    const { runs, env } = setup('mr-stop-linux-')
    const lockPath = join(runs, 'fake.lock')
    writeFileSync(lockPath, laneLockText({ pid: 100, child: 200 }))
    const killed = []
    const lines = []
    const log = console.log
    console.log = (msg) => lines.push(msg)
    try {
      withEnv(env, () => {
        const code = stopLane('fake', {
          platform: 'linux',
          stat: () => ({ mtimeMs: 10000 }),
          list: () => [
            { pid: 100, ppid: 1 },
            { pid: 200, ppid: 100 },
          ],
          kill: ({ pid }) => {
            killed.push(pid)
            return true
          },
        })
        expect(code).toBe(0)
      })
      expect(killed).toEqual([200, 100])
      expect(lines).toContain('stopped: 200 (the harness)')
      expect(lines).toContain('stopped: 100 (the run)')
    } finally {
      console.log = log
    }
  })

  it('passes injected list and kill down to stopDescendants and stopLeftovers', () => {
    const { runs, env } = setup('mr-stop-descendants-')
    const lockPath = join(runs, 'fake.lock')
    const worktreePath = 'C:\\fake\\worktree'
    writeFileSync(lockPath, laneLockText({ pid: 100, child: 200, folder: worktreePath }))
    const killed = []
    const lines = []
    const log = console.log
    console.log = (msg) => lines.push(msg)
    try {
      withEnv(env, () => {
        const code = stopLane('fake', {
          platform: 'win32',
          stat: () => ({ mtimeMs: 10000 }),
          list: () => [
            { pid: 100, ppid: 1, created: 9000 },
            { pid: 200, ppid: 100, created: 9500 },
            { pid: 300, ppid: 200, created: 9600 },
            { pid: 400, ppid: 1, created: 9700, command: 'node C:\\fake\\worktree\\worker.js' },
          ],
          kill: ({ pid }) => {
            killed.push(pid)
            return true
          },
        })
        expect(code).toBe(0)
      })
      expect(killed).toEqual([200, 100, 300, 400])
      expect(lines).toContain('stopped: 200 (the harness)')
      expect(lines).toContain('stopped: 100 (the run)')
      expect(lines).toContain('leftover: stopped 300')
      expect(lines).toContain('leftover: stopped 400')
    } finally {
      console.log = log
    }
  })

  it('keeps the lock when a process could not be stopped', () => {
    const { runs, env } = setup('mr-stop-failed-')
    const lockPath = join(runs, 'fake.lock')
    writeFileSync(lockPath, laneLockText({ pid: 100, child: 200 }))
    const lines = []
    const log = console.log
    console.log = (msg) => lines.push(msg)
    try {
      withEnv(env, () => {
        const code = stopLane('fake', {
          platform: 'win32',
          stat: () => ({ mtimeMs: 10000 }),
          list: () => [
            { pid: 100, ppid: 1, created: 9000 },
            { pid: 200, ppid: 100, created: 9500 },
          ],
          kill: () => false,
          alive: () => true,
        })
        expect(code).toBe(1)
      })
      expect(readFileSync(lockPath, 'utf8')).toContain('"pid":100')
      expect(lines).toContain('could not stop: 200 (the harness)')
      expect(lines).toContain('kept the fake lock: 2 processes could not be stopped, so the lane stays busy')
    } finally {
      console.log = log
    }
  })

  it('treats a process that is gone by the time the kill runs as stopped', () => {
    const { runs, env } = setup('mr-stop-gone-')
    const lockPath = join(runs, 'fake.lock')
    const worktreePath = 'C:\\fake\\worktree'
    writeFileSync(lockPath, laneLockText({ pid: 100, child: 200, folder: worktreePath }))
    const killed = []
    const lines = []
    const log = console.log
    console.log = (msg) => lines.push(msg)
    try {
      withEnv(env, () => {
        const code = stopLane('fake', {
          platform: 'win32',
          stat: () => ({ mtimeMs: 10000 }),
          list: () => [
            { pid: 100, ppid: 1, created: 9000 },
            { pid: 200, ppid: 100, created: 9500 },
            { pid: 300, ppid: 200, created: 9600 },
            { pid: 400, ppid: 1, created: 9700, command: 'node C:\\fake\\worktree\\worker.js' },
          ],
          kill: ({ pid }) => {
            killed.push(pid)
            return false
          },
          alive: () => false,
        })
        expect(code).toBe(0)
      })
      expect(killed).toEqual([200, 100, 300, 400])
      expect(lines).toContain('stopped: 200 (the harness)')
      expect(lines).toContain('stopped: 100 (the run)')
      expect(lines).toContain('leftover: stopped 300')
      expect(lines).toContain('leftover: stopped 400')
      expect(existsSync(lockPath)).toBe(false)
    } finally {
      console.log = log
    }
  })

  it('keeps a newer lock that a run took while the stop ran', () => {
    const { runs, env } = setup('mr-stop-newer-')
    const lockPath = join(runs, 'fake.lock')
    writeFileSync(lockPath, laneLockText({ pid: 100, child: 200 }))
    const lines = []
    const log = console.log
    console.log = (msg) => lines.push(msg)
    try {
      withEnv(env, () => {
        const code = stopLane('fake', {
          platform: 'win32',
          stat: () => ({ mtimeMs: 10000 }),
          list: () => [
            { pid: 100, ppid: 1, created: 9000 },
            { pid: 200, ppid: 100, created: 9500 },
          ],
          kill: () => {
            writeFileSync(lockPath, laneLockText({ pid: 300, child: 400 }))
            return true
          },
        })
        expect(code).toBe(0)
      })
      expect(readFileSync(lockPath, 'utf8')).toContain('"pid":300')
      expect(lines).toContain('kept the fake lock: a newer run took it while the stop ran')
    } finally {
      console.log = log
    }
  })

  it('stops a project run by its descendants and leaves a process that only names the project', () => {
    const { runs, env } = setup('mr-stop-project-')
    const lockPath = join(runs, 'fake.lock')
    const projectPath = 'C:\\fake\\project'
    writeFileSync(lockPath, laneLockText({ pid: 100, child: 200, folder: projectPath, projectRun: true }))
    const killed = []
    const lines = []
    const log = console.log
    console.log = (msg) => lines.push(msg)
    try {
      withEnv(env, () => {
        const code = stopLane('fake', {
          platform: 'win32',
          stat: () => ({ mtimeMs: 10000 }),
          list: () => [
            { pid: 100, ppid: 1, created: 9000 },
            { pid: 200, ppid: 100, created: 9500 },
            { pid: 300, ppid: 200, created: 9600 },
            { pid: 400, ppid: 1, created: 9700, command: 'code C:\\fake\\project' },
          ],
          kill: ({ pid }) => {
            killed.push(pid)
            return true
          },
        })
        expect(code).toBe(0)
      })
      expect(killed).toEqual([200, 100, 300])
      expect(lines).not.toContain('leftover: stopped 400')
    } finally {
      console.log = log
    }
  })

  function runStopWithLists({ prefix, lockFields, lists }) {
    const { runs, env } = setup(prefix)
    const lockPath = join(runs, 'fake.lock')
    writeFileSync(lockPath, laneLockText(lockFields))
    const killed = []
    const lines = []
    let listCalls = 0
    const log = console.log
    console.log = (msg) => lines.push(msg)
    try {
      const code = withEnv(env, () =>
        stopLane('fake', {
          platform: 'win32',
          stat: () => ({ mtimeMs: 10000 }),
          list: () => {
            const index = Math.min(listCalls, lists.length - 1)
            listCalls += 1
            return lists[index]
          },
          kill: ({ pid }) => {
            killed.push(pid)
            return true
          },
        }),
      )
      return { code, killed, lines, listCalls, lockPath }
    } finally {
      console.log = log
    }
  }

  it('does not kill a descendant whose pid is reused by a newer process and removes the lock', () => {
    const { code, killed, lines, listCalls, lockPath } = runStopWithLists({
      prefix: 'mr-stop-reused-desc-',
      lockFields: { pid: 100, child: 200 },
      lists: [
        [
          { pid: 100, ppid: 1, created: 9000 },
          { pid: 200, ppid: 100, created: 9500 },
          { pid: 300, ppid: 200, created: 9600 },
        ],
        [
          { pid: 300, ppid: 1, created: 9900 },
        ],
      ],
    })
    expect(code).toBe(0)
    expect(killed).toEqual([200, 100])
    expect(lines).toContain('stale: 300 was not this run')
    expect(existsSync(lockPath)).toBe(false)
    expect(listCalls).toBe(2)
  })

  it('kills a descendant that is still the same process', () => {
    const { code, killed, lines, listCalls, lockPath } = runStopWithLists({
      prefix: 'mr-stop-same-desc-',
      lockFields: { pid: 100, child: 200 },
      lists: [
        [
          { pid: 100, ppid: 1, created: 9000 },
          { pid: 200, ppid: 100, created: 9500 },
          { pid: 300, ppid: 200, created: 9600 },
        ],
        [
          { pid: 300, ppid: 200, created: 9600 },
        ],
      ],
    })
    expect(code).toBe(0)
    expect(killed).toEqual([200, 100, 300])
    expect(lines).toContain('leftover: stopped 300')
    expect(existsSync(lockPath)).toBe(false)
    expect(listCalls).toBe(2)
  })

  it('checks multiple descendants from one list read and skips gone and reused pids', () => {
    const { code, killed, lines, listCalls, lockPath } = runStopWithLists({
      prefix: 'mr-stop-multi-desc-',
      lockFields: { pid: 100, child: 200, folder: 'C:\\fake\\worktree' },
      lists: [
        [
          { pid: 100, ppid: 1, created: 9000 },
          { pid: 200, ppid: 100, created: 9500 },
          { pid: 300, ppid: 200, created: 9600 },
          { pid: 301, ppid: 200, created: 9601 },
          { pid: 302, ppid: 200, created: 9602 },
        ],
        [
          { pid: 301, ppid: 1, created: 9901 },
          { pid: 302, ppid: 200, created: 9602 },
          { pid: 999, ppid: 1, created: 5000 },
        ],
        [
          { pid: 999, ppid: 1, created: 5000 },
        ],
      ],
    })
    expect(code).toBe(0)
    expect(killed).toEqual([200, 100, 302])
    expect(lines).toContain('leftover: stopped 300')
    expect(lines).toContain('stale: 301 was not this run')
    expect(lines).toContain('leftover: stopped 302')
    expect(existsSync(lockPath)).toBe(false)
    expect(listCalls).toBe(3)
  })

  it('reuses the post-harness process list for leftovers when no descendant is killed', () => {
    const { code, killed, lines, listCalls, lockPath } = runStopWithLists({
      prefix: 'mr-stop-reuse-list-',
      lockFields: { pid: 100, child: 200, folder: 'C:\\fake\\worktree' },
      lists: [
        [
          { pid: 100, ppid: 1, created: 9000 },
          { pid: 200, ppid: 100, created: 9500 },
          { pid: 300, ppid: 200, created: 9600 },
        ],
        [
          { pid: 300, ppid: 1, created: 9900 },
          { pid: 400, ppid: 1, created: 9700, command: 'node C:\\fake\\worktree\\worker.js' },
        ],
      ],
    })
    expect(code).toBe(0)
    expect(killed).toEqual([200, 100, 400])
    expect(lines).toContain('stale: 300 was not this run')
    expect(lines).toContain('leftover: stopped 400')
    expect(existsSync(lockPath)).toBe(false)
    expect(listCalls).toBe(2)
  })
})
