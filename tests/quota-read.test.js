import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { harnessByKey } from '../src/harnesses/index.js'
import { gitPath } from '../server/programPath.js'
import { quotaForRun, readCodexQuota, startLane } from '../scripts/run-lane.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

const readFault = vi.hoisted(() => ({
  fail: false,
  beforeOpen: null,
  openedFds: [],
  closedFds: [],
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    openSync: (...args) => {
      if (typeof readFault.beforeOpen === 'function') readFault.beforeOpen(...args)
      const fd = actual.openSync(...args)
      readFault.openedFds.push(fd)
      return fd
    },
    closeSync: (fd) => {
      readFault.closedFds.push(fd)
      return actual.closeSync(fd)
    },
    readSync: (...args) => {
      if (readFault.fail) throw new Error('The rollout read failed.')
      return actual.readSync(...args)
    },
  }
})

const RESET = Date.UTC(2026, 10, 14) / 1000

const cleanups = []

afterEach(async () => {
  readFault.fail = false
  readFault.beforeOpen = null
  readFault.openedFds = []
  readFault.closedFds = []
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }))
  return dir
}

function gitIn(folder, args) {
  const result = spawnSync(gitPath(), ['-c', 'user.name=MachineRoom Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd: folder,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr ?? '').trim()}`)
  return String(result.stdout ?? '').trim()
}

function makeRepo(folder) {
  mkdirSync(folder, { recursive: true })
  gitIn(folder, ['init', '-q', '-b', 'main'])
  writeFileSync(join(folder, 'README.md'), 'start\n')
  gitIn(folder, ['add', '-A'])
  gitIn(folder, ['commit', '-q', '-m', 'Start the repo'])
}

function tokenLine(usedPercent, resetsAt, label = 'primary') {
  return JSON.stringify({
    timestamp: '2026-11-13T12:00:00.000Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      rate_limits: {
        [label]: { used_percent: usedPercent, window_minutes: 300, resets_at: resetsAt },
      },
    },
  })
}

function writeFake(folder, rolloutText) {
  const script = join(folder, 'fake-codex.cjs')
  writeFileSync(script, [
    "const { mkdirSync, writeFileSync } = require('node:fs')",
    "const { join } = require('node:path')",
    "const home = process.env.CODEX_HOME",
    "const now = new Date()",
    "const pad = (value) => String(value).padStart(2, '0')",
    "const day = join(home, 'sessions', String(now.getFullYear()), pad(now.getMonth() + 1), pad(now.getDate()))",
    "mkdirSync(day, { recursive: true })",
    `writeFileSync(join(day, 'rollout-2026-11-13T12-00-00-thread-1.jsonl'), ${JSON.stringify(rolloutText)})`,
    "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }))",
    "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }))",
  ].join('\n'))
  return script
}

describe('a codex run record quota', () => {
  it('writes only the newest rollout reading under a temporary CODEX_HOME', async () => {
    const base = tempDir('machine-room-quota-')
    const worktree = join(base, 'repo')
    makeRepo(worktree)
    const runs = join(base, 'runs')
    const codexHome = join(base, 'codex')
    mkdirSync(runs, { recursive: true })
    mkdirSync(codexHome, { recursive: true })
    const older = tokenLine(80, RESET, 'primary')
    const newer = JSON.stringify({
      timestamp: '2026-11-13T12:05:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: {
          primary: { used_percent: 22, window_minutes: 300, resets_at: RESET },
          secondary: { used_percent: 64, window_minutes: 10080, resets_at: RESET + 86400 },
        },
      },
    })
    const script = writeFake(base, `${older}\n${newer}\n`)
    const previousRuns = process.env.MACHINEROOM_RUNS
    const previousHome = process.env.CODEX_HOME
    const previousCommand = harnessByKey.codex.command
    process.env.MACHINEROOM_RUNS = runs
    process.env.CODEX_HOME = codexHome
    harnessByKey.codex.command = ({ folder }) => ({
      file: process.execPath,
      args: [script],
      cwd: folder,
      env: { CODEX_HOME: codexHome },
    })
    cleanups.push(() => {
      harnessByKey.codex.command = previousCommand
      if (previousRuns === undefined) delete process.env.MACHINEROOM_RUNS
      else process.env.MACHINEROOM_RUNS = previousRuns
      if (previousHome === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previousHome
    })
    const result = await startLane({
      options: { lane: 'test-codex', minutes: 1 },
      lane: { name: 'test-codex', worktree, cli: { harness: 'codex', bin: process.execPath, model: 'fake/model' } },
      lanes: {},
      wanted: [{ id: 'T99', title: 'Quota', text: 'Do it.\n' }],
      prompt: 'Do it.',
      logPath: join(runs, 'run.log'),
      usageFile: join(runs, 'run.usage.json'),
      name: 'run-quota',
    })
    expect(result.code).toBe(0)
    const saved = JSON.parse(readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/).at(-1))
    expect(saved.quota).toEqual({
      windows: [
        { label: 'primary', usedPercent: 22, resetsAt: new Date(RESET * 1000).toISOString() },
        { label: 'secondary', usedPercent: 64, resetsAt: new Date((RESET + 86400) * 1000).toISOString() },
      ],
      at: expect.any(String),
    })
    expect(Object.keys(saved.quota).sort()).toEqual(['at', 'windows'])
    expect(new Date(saved.quota.at).toISOString()).toBe(saved.quota.at)
  }, 30000)
})

describe('the codex rollout read', () => {
  it('keeps the newest reading and reads only the last 64 KB', () => {
    const folder = tempDir('machine-room-rollout-')
    const file = join(folder, 'rollout-test.jsonl')
    const newest = JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: {
          primary: { used_percent: 22, window_minutes: 300, resets_at: RESET },
          secondary: { used_percent: 64, window_minutes: 10080, resets_at: RESET + 86400 },
        },
      },
    })
    writeFileSync(file, [tokenLine(80, RESET), newest].join('\n') + '\n')
    expect(readCodexQuota(file)).toEqual({
      windows: [
        { label: 'primary', usedPercent: 22, resetsAt: new Date(RESET * 1000).toISOString() },
        { label: 'secondary', usedPercent: 64, resetsAt: new Date((RESET + 86400) * 1000).toISOString() },
      ],
    })

    writeFileSync(file, `${tokenLine(80, RESET)}\n${'x'.repeat(70 * 1024)}\n`)
    expect(readCodexQuota(file)).toBeNull()
  })

  it('leaves the quota out when the rollout file is missing', () => {
    const folder = tempDir('machine-room-rollout-missing-')
    const log = `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' })}\n`
    expect(quotaForRun({ harness: 'codex', log, env: { CODEX_HOME: folder }, startedAt: Date.now(), now: Date.now() })).toBeNull()
  })

  it('gives no quota when the rollout file links outside the sessions folder', () => {
    const folder = tempDir('machine-room-rollout-link-')
    const now = new Date(2026, 10, 14, 12, 0, 0)
    const day = join(folder, 'sessions', '2026', '11', '14')
    mkdirSync(day, { recursive: true })
    const outside = join(folder, 'outside-rollout.jsonl')
    writeFileSync(outside, `${tokenLine(22, RESET)}\n`)
    symlinkSync(outside, join(day, 'rollout-2026-11-14T12-00-00-thread-7.jsonl'), 'file')
    const log = `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-7' })}\n`
    expect(readCodexQuota(outside)).not.toBeNull()
    expect(quotaForRun({ harness: 'codex', log, env: { CODEX_HOME: folder }, startedAt: now.getTime(), now: now.getTime() })).toBeNull()
  })

  function runWithRolloutReplacedBeforeOpen(prefix, threadId, replace) {
    const folder = tempDir(prefix)
    const now = new Date(2026, 10, 14, 12, 0, 0)
    const day = join(folder, 'sessions', '2026', '11', '14')
    mkdirSync(day, { recursive: true })
    const rollout = join(day, `rollout-2026-11-14T12-00-00-${threadId}.jsonl`)
    writeFileSync(rollout, `${JSON.stringify({ type: 'session_meta', pad: 'a'.repeat(512) })}\n`)
    const realRollout = realpathSync.native(rollout)
    const outside = join(folder, 'outside-rollout.jsonl')
    writeFileSync(outside, `${tokenLine(91, RESET)}\n`)
    const log = `${JSON.stringify({ type: 'thread.started', thread_id: threadId })}\n`
    let replaced = false
    readFault.openedFds = []
    readFault.closedFds = []
    readFault.beforeOpen = (target) => {
      if (replaced || target !== realRollout) return
      replaced = true
      replace(realRollout, outside)
    }
    try {
      const result = quotaForRun({ harness: 'codex', log, env: { CODEX_HOME: folder }, startedAt: now.getTime(), now: now.getTime() })
      return { result, replaced }
    } finally {
      readFault.beforeOpen = null
    }
  }

  it('gives no quota when the rollout is replaced with a different file before open', () => {
    const { result, replaced } = runWithRolloutReplacedBeforeOpen('machine-room-rollout-race-file-', 'thread-8', (target, outside) => {
      renameSync(outside, target)
    })
    expect(result).toBeNull()
    expect(replaced).toBe(true)
    expect(readFault.openedFds).toHaveLength(1)
    expect(readFault.closedFds).toEqual(readFault.openedFds)
  })

  it('gives no quota when the rollout is replaced with a symbolic link before open', () => {
    const { result, replaced } = runWithRolloutReplacedBeforeOpen('machine-room-rollout-race-link-', 'thread-9', (target, outside) => {
      rmSync(target)
      symlinkSync(outside, target, 'file')
    })
    expect(result).toBeNull()
    expect(replaced).toBe(true)
    expect(readFault.closedFds).toEqual(readFault.openedFds)
  })

  it('gives no quota when readCodexQuota receives a symbolic link directly', () => {
    const folder = tempDir('machine-room-rollout-direct-link-')
    const outside = join(folder, 'outside-rollout.jsonl')
    writeFileSync(outside, `${tokenLine(22, RESET)}\n`)
    const link = join(folder, 'rollout-link.jsonl')
    symlinkSync(outside, link, 'file')
    readFault.openedFds = []
    readFault.closedFds = []
    expect(readCodexQuota(link)).toBeNull()
    expect(readFault.openedFds).toEqual([])
  })
})

describe('a codex rollout read that throws', () => {
  it('answers null and still writes the run record', async () => {
    const base = tempDir('machine-room-quota-read-')
    const worktree = join(base, 'repo')
    makeRepo(worktree)
    const runs = join(base, 'runs')
    const codexHome = join(base, 'codex')
    mkdirSync(runs, { recursive: true })
    mkdirSync(codexHome, { recursive: true })
    const script = writeFake(base, `${tokenLine(22, RESET)}\n`)
    const previousRuns = process.env.MACHINEROOM_RUNS
    const previousHome = process.env.CODEX_HOME
    const previousCommand = harnessByKey.codex.command
    process.env.MACHINEROOM_RUNS = runs
    process.env.CODEX_HOME = codexHome
    harnessByKey.codex.command = ({ folder }) => ({
      file: process.execPath,
      args: [script],
      cwd: folder,
      env: { CODEX_HOME: codexHome },
    })
    cleanups.push(() => {
      readFault.fail = false
      harnessByKey.codex.command = previousCommand
      if (previousRuns === undefined) delete process.env.MACHINEROOM_RUNS
      else process.env.MACHINEROOM_RUNS = previousRuns
      if (previousHome === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previousHome
    })
    readFault.fail = true
    try {
      const result = await startLane({
        options: { lane: 'test-codex', minutes: 1 },
        lane: { name: 'test-codex', worktree, cli: { harness: 'codex', bin: process.execPath, model: 'fake/model' } },
        lanes: {},
        wanted: [{ id: 'T99', title: 'Quota', text: 'Do it.\n' }],
        prompt: 'Do it.',
        logPath: join(runs, 'run.log'),
        usageFile: join(runs, 'run.usage.json'),
        name: 'run-quota-read',
      })
      expect(result.code).toBe(0)
    } finally {
      readFault.fail = false
    }
    const saved = JSON.parse(readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/).at(-1))
    expect(saved.lane).toBe('test-codex')
    expect(saved).not.toHaveProperty('quota')
  }, 30000)
})
