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
  const dir = freshDir('mr-reviews-evidence-')
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
  const baseHead = head(repo)

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
  return { dir, repo, runsDir, baseHead, worktrees, heads, agentsDir }
}

async function reviews(room, records) {
  const answers = []
  const api = createReviewsApi({
    projectRoot: room.dir,
    briefsDir: room.agentsDir,
    runsFolder: room.runsDir,
    sendJson: (req, res, status, payload) => answers.push({ status, body: payload }),
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

describe('a lane review keeps evidence apart from claims', { timeout: 30000 }, () => {
  it('marks stale checks that ran on an older head and lists no checks', async () => {
    const room = makeRoom({ opencode: { branch: 'feat/x', harness: 'opencode' } })
    const answer = await reviews(room, [
      {
        lane: 'opencode',
        startedAt: '2026-11-16T10:00:00.000Z',
        head: room.baseHead,
        branch: 'feat/x',
        tests: 'passed',
        minutes: 2,
        costUsd: 0.1,
      },
    ])

    const entry = answer.lanes[0]
    expect(entry.head).toBe(room.heads.opencode)
    expect(entry.checks).toBe('unchecked')
    expect(entry.evidence).toEqual({ checkedHead: null, checks: [], stale: true })
  })

  it('shows the exact head, result and time of checks that ran on this head', async () => {
    const room = makeRoom({ opencode: { branch: 'feat/x', harness: 'opencode' } })
    const log = join(room.runsDir, 'opencode-P451.log')
    writeFileSync(log, '{"type":"text","part":{"text":"I changed one file and ran the tests."}}\n')
    const answer = await reviews(room, [
      {
        lane: 'opencode',
        startedAt: '2026-11-16T10:00:00.000Z',
        head: room.heads.opencode,
        branch: 'feat/x',
        tests: 'passed',
        minutes: 3,
        costUsd: 0,
        inputTokens: 11,
        outputTokens: 7,
        log,
      },
    ])

    const entry = answer.lanes[0]
    expect(entry.evidence).toEqual({
      checkedHead: room.heads.opencode,
      checks: [{ command: null, result: 'passed', at: '2026-11-16T10:00:00.000Z' }],
      stale: false,
    })
    expect(entry.claims).toBe('I changed one file and ran the tests.')
    expect(entry.runTotals).toEqual({
      runs: 1,
      runMinutes: 3,
      costUsd: 0,
      inputTokens: 11,
      outputTokens: 7,
      partial: false,
    })
  })

  it('lists both runs of a failover chain on two branches', async () => {
    const room = makeRoom({
      hermes: { branch: 'feat/b', harness: 'claude' },
      opencode: { branch: 'feat/a', harness: 'opencode' },
    })
    const failedAt = '2026-11-16T10:00:00.000Z'
    const records = [
      {
        lane: 'hermes',
        model: 'claude-sonnet-4-5',
        startedAt: failedAt,
        head: room.heads.hermes,
        branch: 'feat/b',
        tests: 'passed',
        minutes: 3,
        costUsd: 0.5,
        inputTokens: 100,
        outputTokens: 50,
      },
      {
        lane: 'opencode',
        model: 'opencode/grok-code',
        startedAt: '2026-11-16T10:10:00.000Z',
        head: room.heads.opencode,
        branch: 'feat/a',
        tests: 'passed',
        minutes: 2,
        costUsd: 0.25,
        inputTokens: 10,
        outputTokens: 5,
        failoverFrom: { lane: 'hermes', startedAt: failedAt },
      },
    ]
    const answer = await reviews(room, records)

    const entry = answer.lanes.find((row) => row.lane === 'opencode')
    expect(entry.runs.map((run) => run.lane)).toEqual(['hermes', 'opencode'])
    expect(entry.runs.map((run) => run.branch)).toEqual(['feat/b', 'feat/a'])
    expect(entry.runs.map((run) => run.harness)).toEqual(['claude', 'opencode'])
    expect(entry.runs.map((run) => run.model)).toEqual(['claude-sonnet-4-5', 'opencode/grok-code'])
    expect(entry.runTotals).toEqual({
      runs: 2,
      runMinutes: 5,
      costUsd: 0.75,
      inputTokens: 110,
      outputTokens: 55,
      partial: false,
    })

    const backup = answer.lanes.find((row) => row.lane === 'hermes')
    expect(backup.runs.map((run) => run.lane)).toEqual(['hermes', 'opencode'])
  })

  it('says the total is partial when a run has no cost and keeps missing values null', async () => {
    const room = makeRoom({ opencode: { branch: 'feat/x', harness: 'opencode' } })
    const answer = await reviews(room, [
      {
        lane: 'opencode',
        startedAt: '2026-11-16T10:00:00.000Z',
        head: room.heads.opencode,
        branch: 'feat/x',
        tests: 'passed',
        minutes: 4,
        costUsd: null,
      },
    ])

    const entry = answer.lanes[0]
    expect(entry.runs).toHaveLength(1)
    expect(entry.runs[0].costUsd).toBeNull()
    expect(entry.runs[0].inputTokens).toBeNull()
    expect(entry.runs[0].outputTokens).toBeNull()
    expect(entry.runTotals).toEqual({
      runs: 1,
      runMinutes: 4,
      costUsd: null,
      inputTokens: null,
      outputTokens: null,
      partial: true,
    })
  })
})
