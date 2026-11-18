import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { gitPath } from '../server/programPath.js'
import { startLane } from '../scripts/run-lane.mjs'
import { laneLockText } from '../src/briefs/run.js'
import { makeTempDir } from './helpers/tempRoot.js'

it.each([
  [{ lane: 'other', briefs: ['P1'], branch: 'saved' }, 'lane'],
  [{ lane: 'lane', briefs: ['P2'], branch: 'saved' }, 'brief ids'],
  [{ lane: 'lane', briefs: ['P1'], branch: 'saved', project: 'project' }, 'project kind'],
  [{ lane: 'lane', briefs: ['P1'], branch: 'saved' }, 'branch'],
])('refuses a continuation with different %s before opening a log', async (saved, reason) => {
  const root = makeTempDir('mr-continue-')
  try {
    writeFileSync(join(root, 'runs.jsonl'), JSON.stringify({ ...saved, log: 'old.log' }) + '\n')
    const logPath = join(root, 'new.log')
    await expect(startLane({ options: { lane: 'lane', continueFrom: 'old', runs: root }, lane: { worktree: root, cli: {} }, lanes: {}, wanted: [{ id: 'P1' }], prompt: '', logPath, name: 'new' })).rejects.toThrow(reason)
    expect(existsSync(logPath)).toBe(false)
    expect(existsSync(join(root, 'new.meta.json'))).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it.each(['current', 'legacy'])('continues from a %s sidecar without an end record', async (kind) => {
  const root = makeTempDir('mr-continue-lost-')
  const runs = join(root, 'runs')
  const worktree = join(root, 'worktree')
  const old = 'lane-P1-20261118-131340'
  const brief = { id: 'P1', title: 'Do the work' }
  const lane = { worktree, cli: { harness: 'opencode', bin: process.execPath, model: 'fake/model' } }
  const git = (...args) => {
    const result = spawnSync(gitPath(), args, { cwd: worktree, encoding: 'utf8', windowsHide: true })
    expect(result.status, result.error?.message ?? result.stderr).toBe(0)
    return result.stdout.trim()
  }
  const run = (name, options, extra) => startLane({
    options: { lane: 'lane', runs, minutes: 1, ...options }, lane, lanes: { lane }, wanted: [brief], prompt: 'Test prompt.',
    logPath: join(runs, `${name}.log`), usageFile: join(runs, `${name}.usage.json`), name, ...extra,
  })
  vi.stubEnv('MACHINEROOM_RUNS', runs)
  try {
    mkdirSync(runs)
    mkdirSync(worktree)
    git('init', '-q', '-b', 'main')
    writeFileSync(join(worktree, 'run'), 'console.log(\'{"type":"step_finish","part":{"cost":0}}\')\n')
    git('add', 'run')
    git('-c', 'user.name=MachineRoom Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Start')
    const base = git('rev-parse', 'HEAD')
    const startedAt = '2026-11-18T05:13:40.000Z'
    const sidecar = join(runs, `${old}.meta.json`)
    const lostLog = join(runs, `${old}.log`)
    if (kind === 'current') {
      await expect(run(old, {}, {
        startedAt: Date.parse(startedAt),
        openLog: (file) => {
          writeFileSync(file, 'interrupted\n')
          throw new Error('Run cut short')
        },
      })).rejects.toThrow('Run cut short')
      expect(JSON.parse(readFileSync(sidecar, 'utf8'))).toMatchObject({ lane: 'lane', briefs: ['P1'], branch: '', base, startedAt })
    } else {
      writeFileSync(sidecar, JSON.stringify({ lane: 'lane', base }))
      writeFileSync(lostLog, 'interrupted\n')
    }
    expect(existsSync(join(runs, 'runs.jsonl'))).toBe(false)
    writeFileSync(join(runs, 'lane.lock'), laneLockText({ pid: 2147483647 }))
    git('switch', '-c', 'feat/p1-do-the-work')
    writeFileSync(join(worktree, 'partial.txt'), 'work in progress')

    await expect(run('lane-next', { continueFrom: old }, { openLog: (file) => {
      expect(file).toBe(join(runs, 'lane-next.log'))
      throw new Error('Continuation reached its log')
    } })).rejects.toThrow('Continuation reached its log')
    const lost = JSON.parse(readFileSync(join(runs, 'runs.jsonl'), 'utf8'))
    expect(lost).toMatchObject({ lane: 'lane', briefs: ['P1'], log: lostLog, base, finishedAt: null, exitCode: null, killed: true, stopReason: 'lost' })
    if (kind === 'current') expect(lost.startedAt).toBe(startedAt)
    expect(JSON.parse(readFileSync(join(runs, 'lane-next.meta.json'), 'utf8'))).toMatchObject({ continues: old, branch: 'feat/p1-do-the-work', base })
    expect(readFileSync(join(worktree, 'partial.txt'), 'utf8')).toBe('work in progress')
  } finally {
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  }
}, 20000)

it.each([
  { pid: process.pid },
  { pid: 2147483647, child: process.pid },
])('refuses to continue an unrecorded run with a live lock', async (holder) => {
  const root = makeTempDir('mr-continue-live-')
  try {
    const name = 'lane-P1-20261118-131340'
    writeFileSync(join(root, `${name}.meta.json`), JSON.stringify({ lane: 'lane', briefs: ['P1'], branch: '' }))
    writeFileSync(join(root, `${name}.log`), '')
    writeFileSync(join(root, 'lane.lock'), laneLockText(holder))
    const logPath = join(root, 'new.log')
    await expect(startLane({
      options: { lane: 'lane', continueFrom: name, runs: root }, lane: { worktree: root, cli: {} },
      lanes: {}, wanted: [{ id: 'P1' }], prompt: '', logPath, name: 'new',
    })).rejects.toThrow('The lane lane still holds its run lock.')
    expect(existsSync(join(root, 'runs.jsonl'))).toBe(false)
    expect(existsSync(logPath)).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
