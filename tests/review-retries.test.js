import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { gitPath } from '../server/programPath.js'
import { createReviewsApi, defaultGitRunner } from '../server/reviews.js'
import { makeTempDir, processTempRoot, removeTempDir } from './helpers/tempRoot.js'

const NO_GIT_CONFIG = join(processTempRoot(), 'no-git-config')
const GIT_ENV = {
  GIT_CONFIG_SYSTEM: NO_GIT_CONFIG,
  GIT_CONFIG_GLOBAL: NO_GIT_CONFIG,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'commit.gpgsign',
  GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'core.autocrlf',
  GIT_CONFIG_VALUE_1: 'false',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'MachineRoom Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'MachineRoom Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
}
const cleanups = []
const savedGitEnv = new Map()

for (const [key, value] of Object.entries(GIT_ENV)) {
  savedGitEnv.set(key, process.env[key])
  process.env[key] = value
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

afterAll(() => {
  for (const [key, value] of savedGitEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function freshDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => removeTempDir(dir))
  return dir
}

function git(cwd, args) {
  return execFileSync(gitPath(), args, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...GIT_ENV },
  })
}

function head(cwd) {
  return git(cwd, ['rev-parse', 'HEAD']).trim()
}

function makeRoom(lanes) {
  const dir = freshDir('mr-review-retries-')
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  git(repo, ['init', '-b', 'main'])
  git(repo, ['config', 'user.name', 'MachineRoom Test'])
  git(repo, ['config', 'user.email', 'test@example.invalid'])
  git(repo, ['config', 'commit.gpgsign', 'false'])
  git(repo, ['config', 'core.autocrlf', 'false'])
  writeFileSync(join(repo, 'notes.txt'), 'first\n')
  git(repo, ['add', 'notes.txt'])
  git(repo, ['commit', '-m', 'first'])

  const worktrees = {}
  const heads = {}
  const config = {}
  for (const [lane, spec] of Object.entries(lanes)) {
    const worktree = join(dir, `lane-${lane}`)
    git(repo, ['worktree', 'add', '-b', spec.branch, worktree])
    writeFileSync(join(worktree, `${lane}.txt`), `${lane} work\n`)
    git(worktree, ['add', `${lane}.txt`])
    git(worktree, ['commit', '-m', `${lane} work`])
    worktrees[lane] = worktree
    heads[lane] = head(worktree)
    config[lane] = { name: lane, worktree, cli: { harness: spec.harness, bin: spec.harness } }
  }

  const agentsDir = join(dir, 'docs', 'agents')
  mkdirSync(agentsDir, { recursive: true })
  writeFileSync(join(agentsDir, 'lanes.json'), JSON.stringify(config))
  const runsDir = join(dir, 'runs')
  mkdirSync(runsDir, { recursive: true })
  return { dir, repo, runsDir, worktrees, heads, agentsDir }
}

async function reviews(room, records) {
  const answers = []
  const api = createReviewsApi({
    projectRoot: room.dir,
    briefsDir: room.agentsDir,
    runsFolder: room.runsDir,
    sendJson: (_req, _res, status, payload) => answers.push({ status, body: payload }),
    readJsonBody: async () => null,
    orchestrators: () => null,
    readRuns: () => records,
    gitRunner: defaultGitRunner,
  })
  const url = new URL('http://127.0.0.1/api/control/reviews')
  const handled = await api.handle({ method: 'GET', headers: {} }, {}, url)
  expect(handled).toBe(true)
  expect(answers[0].status).toBe(200)
  return answers[0].body
}

describe('review linkedRuns includes retries and plain repair runs', { timeout: 30000 }, () => {
  it('includes a retried run and its retry in the review runs and totals while ignoring older branches and other lanes', async () => {
    const room = makeRoom({ opencode: { branch: 'feat/p470', harness: 'opencode' } })
    const answer = await reviews(room, [
      {
        lane: 'opencode',
        model: 'opencode/grok-code',
        startedAt: '2026-11-16T09:00:00.000Z',
        branch: 'feat/older',
        log: join(room.runsDir, 'older.log'),
        minutes: 10,
        costUsd: 5,
        inputTokens: 9000,
        outputTokens: 3000,
      },
      {
        lane: 'claude',
        model: 'claude-sonnet',
        startedAt: '2026-11-16T09:30:00.000Z',
        branch: 'feat/p470',
        log: join(room.runsDir, 'claude-other.log'),
        minutes: 7,
        costUsd: 2,
        inputTokens: 4000,
        outputTokens: 1000,
      },
      {
        lane: 'opencode',
        model: 'opencode/grok-code',
        startedAt: '2026-11-16T10:00:00.000Z',
        branch: 'feat/p470',
        log: join(room.runsDir, 'first.log'),
        retried: true,
        minutes: 0.5,
        costUsd: 0.05,
        inputTokens: 100,
        outputTokens: 20,
      },
      {
        lane: 'opencode',
        model: 'opencode/grok-code',
        startedAt: '2026-11-16T10:01:00.000Z',
        branch: 'feat/p470',
        log: join(room.runsDir, 'first-retry.log'),
        head: room.heads.opencode,
        tests: 'passed',
        minutes: 2.5,
        costUsd: 0.25,
        inputTokens: 400,
        outputTokens: 150,
      },
    ])

    const entry = answer.lanes[0]
    expect(entry.runs.map((run) => run.startedAt)).toEqual([
      '2026-11-16T10:00:00.000Z',
      '2026-11-16T10:01:00.000Z',
    ])
    expect(entry.runTotals).toEqual({
      runs: 2,
      runMinutes: 3,
      costUsd: 0.3,
      inputTokens: 500,
      outputTokens: 170,
      partial: false,
    })
  })

  it('includes earlier plain repair runs on the same task branch and excludes main branch runs', async () => {
    const room = makeRoom({ opencode: { branch: 'feat/p470', harness: 'opencode' } })
    const answer = await reviews(room, [
      {
        lane: 'opencode',
        startedAt: '2026-11-16T09:00:00.000Z',
        branch: 'main',
        log: join(room.runsDir, 'on-main.log'),
        minutes: 6,
        costUsd: 1,
        inputTokens: 1000,
        outputTokens: 500,
      },
      {
        lane: 'opencode',
        startedAt: '2026-11-16T10:00:00.000Z',
        branch: 'feat/p470',
        log: join(room.runsDir, 'repair-1.log'),
        tests: 'failed',
        minutes: 3,
        costUsd: 0.4,
        inputTokens: 200,
        outputTokens: 60,
      },
      {
        lane: 'opencode',
        startedAt: '2026-11-16T10:20:00.000Z',
        branch: 'feat/p470',
        log: join(room.runsDir, 'repair-2.log'),
        head: room.heads.opencode,
        tests: 'passed',
        minutes: 1.5,
        costUsd: 0.15,
        inputTokens: 80,
        outputTokens: 30,
      },
    ])

    const entry = answer.lanes[0]
    expect(entry.runs.map((run) => run.startedAt)).toEqual([
      '2026-11-16T10:00:00.000Z',
      '2026-11-16T10:20:00.000Z',
    ])
    expect(entry.runTotals).toEqual({
      runs: 2,
      runMinutes: 4.5,
      costUsd: 0.55,
      inputTokens: 280,
      outputTokens: 90,
      partial: false,
    })
  })

  it('keeps unknown values null in runs and totals across retried attempts', async () => {
    const room = makeRoom({ opencode: { branch: 'feat/p470', harness: 'opencode' } })
    const answer = await reviews(room, [
      {
        lane: 'opencode',
        startedAt: '2026-11-16T10:00:00.000Z',
        branch: 'feat/p470',
        log: join(room.runsDir, 'first.log'),
        retried: true,
        minutes: 1,
        costUsd: null,
        inputTokens: null,
        outputTokens: 10,
      },
      {
        lane: 'opencode',
        startedAt: '2026-11-16T10:02:00.000Z',
        branch: 'feat/p470',
        log: join(room.runsDir, 'first-retry.log'),
        head: room.heads.opencode,
        tests: 'passed',
        minutes: 2,
        costUsd: null,
        inputTokens: 90,
        outputTokens: null,
      },
    ])

    const entry = answer.lanes[0]
    expect(entry.runs).toHaveLength(2)
    expect(entry.runs[0].costUsd).toBeNull()
    expect(entry.runs[0].inputTokens).toBeNull()
    expect(entry.runs[1].costUsd).toBeNull()
    expect(entry.runs[1].outputTokens).toBeNull()
    expect(entry.runTotals).toEqual({
      runs: 2,
      runMinutes: 3,
      costUsd: null,
      inputTokens: 90,
      outputTokens: 10,
      partial: true,
    })
  })

  it('includes earlier retries on the primary lane before a failover and links retried logs missing a branch', async () => {
    const room = makeRoom({
      hermes: { branch: 'feat/b', harness: 'claude' },
      opencode: { branch: 'feat/a', harness: 'opencode' },
    })
    const failedAt = '2026-11-16T10:01:00.000Z'
    const answer = await reviews(room, [
      {
        lane: 'hermes',
        startedAt: '2026-11-16T09:59:00.000Z',
        branch: '',
        log: join(room.runsDir, 'hermes-1.log'),
        retried: true,
        minutes: 1,
        costUsd: 0.1,
        inputTokens: 50,
        outputTokens: 10,
      },
      {
        lane: 'hermes',
        startedAt: failedAt,
        branch: 'feat/b',
        log: join(room.runsDir, 'hermes-1-retry.log'),
        minutes: 2,
        costUsd: 0.2,
        inputTokens: 100,
        outputTokens: 20,
      },
      {
        lane: 'opencode',
        startedAt: '2026-11-16T10:05:00.000Z',
        branch: 'feat/a',
        log: join(room.runsDir, 'opencode-backup.log'),
        head: room.heads.opencode,
        tests: 'passed',
        minutes: 3,
        costUsd: 0.3,
        inputTokens: 150,
        outputTokens: 30,
        failoverFrom: { lane: 'hermes', startedAt: failedAt },
      },
    ])

    const backup = answer.lanes.find((row) => row.lane === 'opencode')
    expect(backup.runs.map((run) => run.startedAt)).toEqual([
      '2026-11-16T09:59:00.000Z',
      failedAt,
      '2026-11-16T10:05:00.000Z',
    ])
    expect(backup.runTotals).toEqual({
      runs: 3,
      runMinutes: 6,
      costUsd: 0.6,
      inputTokens: 300,
      outputTokens: 60,
      partial: false,
    })
  })
})
