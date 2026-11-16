import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gitPath } from '../server/programPath.js'
import { clearRunsCache, createRunsApi } from '../server/runs.js'
import { laneLockText } from '../src/briefs/run.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const runner = vi.hoisted(() => ({ calls: [], active: null }))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    spawn: (file, args, options) => {
      if (file !== 'interrupt-test-runner') return actual.spawn(file, args, options)
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      if (args.includes('--stop')) {
        queueMicrotask(() => {
          rmSync(join(options.env.MACHINEROOM_RUNS, `${args[args.indexOf('--stop') + 1]}.lock`), { force: true })
          runner.active?.emit('close', 0)
          child.emit('close', 0)
        })
      } else {
        runner.calls.push({ args, options })
        runner.active = child
      }
      return child
    },
  }
})

const cleanups = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()()
  runner.calls = []
  runner.active = null
  clearRunsCache()
})

function rig() {
  const base = makeTempDir('mr-interrupt-backup-')
  cleanups.push(() => removeTempDir(base))
  const runs = join(base, 'runs')
  const project = join(base, 'project')
  mkdirSync(runs)
  mkdirSync(project)
  const lanes = {
    primary: { fallback: 'backup', cli: { harness: 'claude', bin: process.execPath, model: 'primary/model', mode: 'bypass' } },
    backup: { cli: { harness: 'opencode', bin: process.execPath, model: 'backup/model', mode: 'plan' } },
  }
  const lanesFile = join(base, 'lanes.json')
  writeFileSync(lanesFile, JSON.stringify(lanes))
  const api = createRunsApi({ projectRoot: project, lanesFile, runsFolder: runs, runnerCommand: { file: 'interrupt-test-runner', args: [] } })
  cleanups.push(() => api.stopAll())
  return { base, runs, project, lanesFile, api }
}

function records(runs) {
  return readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
}

function saveRun(runs, name, record) {
  appendFileSync(join(runs, 'runs.jsonl'), JSON.stringify({ log: join(runs, `${name}.log`), ...record }) + '\n')
}

function lock(runs, lane, name, startedAt) {
  writeFileSync(join(runs, `${lane}.lock`), laneLockText({ pid: process.pid, startedAt, log: `${name}.log` }))
}

function interrupt(api, lane, held) {
  let taken = false
  return api.interruptLane({ lane, held, takeUnseen: () => {
    if (taken) return []
    taken = true
    return [{ from: 'orchestrator', text: 'Keep the partial work.' }]
  } })
}

function git(folder, args) {
  const result = spawnSync(gitPath(), ['-c', 'commit.gpgsign=false', ...args], {
    cwd: folder, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
  })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}

function repository(project) {
  git(project, ['init', '-q', '-b', 'main'])
  writeFileSync(join(project, 'run'), "console.log(JSON.stringify({ type: 'step_finish', part: { cost: 0, tokens: { input: 1, output: 1 } } }))\n")
  writeFileSync(join(project, 'note.txt'), 'original\n')
  git(project, ['add', '.'])
  git(project, ['commit', '-qm', 'Start'])
}

function continueRun(rig, args) {
  const result = spawnSync(process.execPath, [resolve('scripts/run-lane.mjs'), ...args], {
    cwd: resolve('.'), encoding: 'utf8', windowsHide: true, timeout: 45000,
    env: { ...process.env, MACHINEROOM_RUNS: rig.runs, MACHINEROOM_LANES_FILE: rig.lanesFile,
      MACHINEROOM_LANE_TICKET: '', MACHINEROOM_BRIDGE: '',
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
  })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  return result.stdout
}

describe('interrupted backups', () => {
  it('restarts a failed-over Bypass primary with the backup model and fixed Plan mode', async () => {
    const r = rig()
    repository(r.project)
    const primary = r.api.startRun('primary', [], { project: r.project, task: 'Continue.', model: 'primary/model' }, '', '', 'primary/model', 'bypass')
    saveRun(r.runs, 'primary-failed', { lane: 'primary', startedAt: primary.startedAt, failover: { kind: 'quota', to: 'backup' } })
    saveRun(r.runs, 'backup-interrupted', { lane: 'backup', project: r.project, branch: 'main', failoverFrom: { lane: 'primary', startedAt: primary.startedAt } })
    lock(r.runs, 'backup', 'backup-interrupted', new Date().toISOString())

    expect(await interrupt(r.api, 'backup', primary)).toBe(true)
    const restart = runner.calls.at(-1)
    expect(restart.options.env.MACHINEROOM_LANE_TICKET).toBe(runner.calls[0].options.env.MACHINEROOM_LANE_TICKET)
    continueRun(r, restart.args)
    expect(records(r.runs).at(-1)).toMatchObject({ lane: 'backup', model: 'backup/model', mode: 'plan', continues: 'backup-interrupted' })
  }, 60000)

  it('continues in the recorded primary worktree and backup branch with the partial work', () => {
    const r = rig()
    repository(r.project)
    const worktree = join(r.project, '.worktrees', 'primary')
    const branch = 'machineroom/queue-primary-on-backup'
    git(r.project, ['worktree', 'add', '-b', branch, worktree])
    writeFileSync(join(worktree, 'note.txt'), 'partial work\n')
    saveRun(r.runs, 'backup-interrupted', {
      lane: 'backup', project: worktree, branch: 'machineroom/queue-primary', queue: 'machineroom/queue-primary',
      checkpoint: { branch }, failoverFrom: { lane: 'primary', startedAt: new Date().toISOString() },
    })

    const args = ['backup', '--project', r.project, '--worktree', '--task', 'Continue.', '--continue-from', 'backup-interrupted']
    expect(continueRun(r, [...args, '--dry-run'])).toContain(`branch: ${branch}`)
    continueRun(r, args)
    expect(records(r.runs).at(-1)).toMatchObject({ project: worktree, branch, continues: 'backup-interrupted' })
    expect(git(worktree, ['branch', '--show-current'])).toBe(branch)
    expect(readFileSync(join(worktree, 'note.txt'), 'utf8')).toBe('partial work\n')
  }, 60000)

  it('allows only three interrupts on the same ticket across a failover', async () => {
    const r = rig()
    let held = r.api.startRun('primary', [], { project: r.project, task: 'Continue.' })
    for (let index = 0; index < 2; index += 1) {
      lock(r.runs, 'primary', `primary-${index}`, held.startedAt)
      expect(await interrupt(r.api, 'primary', held)).toBe(true)
      const args = runner.calls.at(-1).args
      held = { lane: 'primary', startedAt: args[args.indexOf('--started-at') + 1] }
    }
    saveRun(r.runs, 'primary-failed', { lane: 'primary', startedAt: held.startedAt, continues: 'primary-1', failover: { kind: 'quota', to: 'backup' } })
    saveRun(r.runs, 'backup-interrupted', { lane: 'backup', failoverFrom: { lane: 'primary', startedAt: held.startedAt } })
    lock(r.runs, 'backup', 'backup-interrupted', new Date().toISOString())
    expect(await interrupt(r.api, 'backup', held)).toBe(true)
    const restart = runner.calls.at(-1)
    const backup = { lane: 'backup', startedAt: restart.args[restart.args.indexOf('--started-at') + 1] }
    lock(r.runs, 'backup', 'backup-continuation', backup.startedAt)

    expect(await interrupt(r.api, 'backup', backup)).toBe(false)
    expect(runner.calls).toHaveLength(4)
    expect(new Set(runner.calls.map((call) => call.options.env.MACHINEROOM_LANE_TICKET)).size).toBe(1)
  })
})
