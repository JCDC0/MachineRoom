import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

function cliFixture(prefix) {
  const root = makeTempDir(prefix)
  const project = join(root, 'project')
  const runs = join(root, 'runs')
  const calls = join(root, 'calls.txt')
  const git = (...args) => {
    const result = spawnSync(gitPath(), ['-c', 'user.name=MachineRoom Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: project, encoding: 'utf8', windowsHide: true })
    expect(result.status, result.error?.message ?? result.stderr).toBe(0)
    return result.stdout.trim()
  }
  mkdirSync(project, { recursive: true })
  mkdirSync(runs)
  git('init', '-q', '-b', 'main')
  writeFileSync(join(project, 'run'), [
    "const { appendFileSync, writeFileSync } = require('node:fs')",
    `appendFileSync(${JSON.stringify(calls)}, 'x')`,
    "writeFileSync('note-' + Date.now() + '.txt', 'done')",
    "console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
    '',
  ].join('\n'))
  git('add', '-A')
  git('commit', '-q', '-m', 'Start')
  const lanesFile = join(root, 'lanes.json')
  writeFileSync(lanesFile, `${JSON.stringify({ fake: { name: 'Fake', cli: { harness: 'opencode', bin: process.execPath, model: 'fake/model' }, worktree: join(root, 'worktree') } })}\n`)
  mkdirSync(join(root, 'worktree'))
  const cli = (args) => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url)), ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 60000,
    env: { ...process.env, MACHINEROOM_RUNS: runs, MACHINEROOM_LANES_FILE: lanesFile, GIT_AUTHOR_NAME: 'MachineRoom Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'MachineRoom Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
  })
  return { root, project, runs, calls, git, cli }
}

it('lets the command continue a project run that has only a sidecar', () => {
  const { root, project, runs, git, cli } = cliFixture('mr-continue-cli-')
  try {
    const old = 'fake-project-20261118-131340'
    writeFileSync(join(runs, `${old}.meta.json`), JSON.stringify({ lane: 'fake', briefs: [], project: realpathSync.native(project), branch: '', base: git('rev-parse', 'HEAD') }))
    writeFileSync(join(runs, `${old}.log`), 'interrupted\n')
    const result = cli(['fake', '--project', project, '--task', 'Do it.', '--continue-from', old])
    expect(result.stderr).not.toContain('There is no run named')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    const records = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(records[0]).toMatchObject({ lane: 'fake', stopReason: 'lost', killed: true })
    expect(records[0].log).toBe(join(runs, `${old}.log`))
    expect(records.at(-1)).toMatchObject({ continues: old })
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
}, 70000)

it('continues a queue from a sidecar at its saved index and keeps its base', () => {
  const { root, project, runs, calls, git, cli } = cliFixture('mr-continue-queue-')
  try {
    const old = 'fake-queue-20261118-131340-001-2'
    const base = git('rev-parse', 'HEAD')
    const queueBranch = 'machineroom/queue-fake-old'
    git('switch', '-q', '-c', queueBranch)
    writeFileSync(join(project, 'first.txt'), 'first task\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'First task')
    expect(git('rev-parse', 'HEAD')).not.toBe(base)
    writeFileSync(join(runs, `${old}.meta.json`), JSON.stringify({ lane: 'fake', briefs: [], project: realpathSync.native(project), branch: '', base, queue: queueBranch, index: 2 }))
    writeFileSync(join(runs, `${old}.log`), 'interrupted\n')
    const queueFile = join(root, 'queue.txt')
    writeFileSync(queueFile, 'Task one.\n---\nTask two.\n---\nTask three.\n')
    const result = cli(['fake', '--project', project, '--queue', queueFile, '--continue-from', old])
    const out = `${result.stdout}\n${result.stderr}`
    expect(result.status, out).toBe(0)
    expect(result.stdout).not.toContain('task 1 of 3')
    expect(result.stdout).toContain('task 2 of 3')
    expect(result.stdout).toContain('task 3 of 3')
    expect(readFileSync(calls, 'utf8')).toBe('xx')
    const metas = readdirSync(runs).filter((file) => /-2\.meta\.json$/.test(file) && file !== `${old}.meta.json`)
    expect(metas).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(runs, metas[0]), 'utf8'))).toMatchObject({ base, index: 2, continues: old })
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
}, 70000)
