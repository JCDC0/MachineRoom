import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { killTree } from '../server/processTree.js'
import { readLaneLock, releaseLaneLock, takeLaneLock, processAlive } from '../scripts/lane-lock.mjs'
import { isResultLine, startLane, stopLane } from '../scripts/run-lane.mjs'
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
    `setTimeout(() => writeFileSync(${JSON.stringify(mark)}, 'late'), 6000)`,
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

function writeFakeHarnessHoldingStdout(project, mark, started, { holdMs = 8000 } = {}) {
  const late = join(project, 'late.cjs')
  writeFileSync(late, [
    "const { writeFileSync } = require('node:fs')",
    `setTimeout(() => { try { writeFileSync(${JSON.stringify(mark)}, 'late') } catch {} }, ${holdMs})`,
    '',
  ].join('\n'))
  const script = join(project, 'run')
  writeFileSync(script, [
    "const { spawn } = require('node:child_process')",
    "const { writeFileSync } = require('node:fs')",
    `writeFileSync(${JSON.stringify(started)}, 'started')`,
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
    `setTimeout(() => {}, ${holdMs})`,
    '',
  ].join('\n'))
  const script = join(project, 'run')
  writeFileSync(script, [
    "const { spawn } = require('node:child_process')",
    "const { writeFileSync } = require('node:fs')",
    `writeFileSync(${JSON.stringify(started)}, 'started')`,
    `const grandchild = spawn(process.execPath, [${JSON.stringify(late)}, ${JSON.stringify(project)}], { detached: true, stdio: [0, 1, 2], windowsHide: true })`,
    'grandchild.unref()',
    "console.log('{\"event\":\"result\",\"result\":{\"status\":\"SUCCESS\"}}')",
    `setTimeout(() => {}, ${holdMs})`,
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
    expect(lock.folder).toBe(project)
    expect(lock.projectRun).toBe(true)

    const stopped = await runLane(['--stop', 'fake'], env)
    expect(stopped.code).toBe(0)
    expect(stopped.stdout).toContain(`stopped: ${lock.child} (the harness)`)
    expect(stopped.stdout).toContain('leftover: stopped')
    expect(existsSync(join(runs, 'fake.lock'))).toBe(false)
    expect(await waitUntil(() => !processAlive(lock.pid), 5000), `the run ${lock.pid} is still alive`).toBe(true)
    const finished = await run
    expect(finished.code === null || Number.isInteger(finished.code)).toBe(true)
    await sleep(6600)
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
      await sleep(6600)
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
    await sleep(500)
    expect(existsSync(mark)).toBe(false)
  }, 30000)

  it('finishes with exit code 0 when the harness hangs after printing its result line', async () => {
    const { project, runs, env } = setup('mr-run-hang-')
    const started = join(project, 'started.txt')
    writeFakeHangingResultHarness(project, started, { holdMs: 8000 })
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
})
