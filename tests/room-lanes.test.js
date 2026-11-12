import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { checkPrerequisites } from '../scripts/merge-lane.mjs'
import { reviewLane } from '../scripts/review-lane.mjs'
import { activeLanesFileFor, writeActiveLanes } from '../server/active-lanes.js'
import { runDoctor, NEXT_STEP } from '../server/doctor.js'
import { createPolicyApi } from '../server/policy.js'
import { createReviewsApi } from '../server/reviews.js'
import { createRunsApi } from '../server/runs.js'
import { makeTempDir } from './helpers/tempRoot.js'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const NO_GIT_CONFIG = join(tmpdir(), 'machineroom-room-lanes-no-git-config')
const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    fn()
  }
})

function makeDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  return dir
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_SYSTEM: NO_GIT_CONFIG,
      GIT_CONFIG_GLOBAL: NO_GIT_CONFIG,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'MachineRoom Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'MachineRoom Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  })
}

function makeRepo(dir) {
  mkdirSync(dir, { recursive: true })
  git(dir, ['init', '-b', 'main'])
  git(dir, ['config', 'user.name', 'MachineRoom Test'])
  git(dir, ['config', 'user.email', 'test@example.invalid'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  git(dir, ['config', 'core.autocrlf', 'false'])
  writeFileSync(join(dir, 'README.md'), 'hello\n')
  git(dir, ['add', 'README.md'])
  git(dir, ['commit', '-m', 'initial'])
}

function makeDist() {
  const dist = join(makeDir('room-lanes-dist-'), 'dist')
  mkdirSync(dist, { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Room</title>')
  return dist
}

function madeAgent(key, name, harness) {
  return { key, name, harness }
}

describe('the room lanes across reviews, Auto and the doctor', () => {
  it('answers 200 for a made lane review diff with the config lanes', async () => {
    const repo = makeDir('room-lanes-repo-')
    makeRepo(repo)
    const worktree = join(repo, '.worktrees', 'worker1')
    git(repo, ['worktree', 'add', '-b', 'feat/worker1', worktree, 'main'])
    writeFileSync(join(worktree, 'worker1.txt'), 'worker one\n')
    git(worktree, ['add', 'worker1.txt'])
    git(worktree, ['commit', '-m', 'worker one work'])

    const runs = makeDir('room-lanes-runs-')
    writeFileSync(join(runs, 'agents.json'), JSON.stringify({ agents: [madeAgent('worker1', 'Worker One', 'opencode')] }))

    const answers = []
    const api = createReviewsApi({
      projectRoot: repo,
      runsFolder: runs,
      sendJson: (req, res, status, body) => {
        answers.push({ status, body })
      },
    })

    const handled = await api.handle({ method: 'GET' }, {}, new URL('http://localhost/api/control/reviews/worker1/diff'))
    expect(handled).toBe(true)
    expect(answers[0].status).toBe(200)
    expect(answers[0].body.lane).toBe('worker1')
    expect(answers[0].body.branch).toBe('feat/worker1')
    expect(answers[0].body.files).toEqual([{ path: 'worker1.txt', added: 1, deleted: 0 }])
  })

  it('reads config/policy.json on MachineRoom and says to make a lane', async () => {
    const runs = makeDir('room-lanes-runs-')
    writeActiveLanes(activeLanesFileFor(REPO_ROOT, runs), [])

    const answers = []
    const policyApi = createPolicyApi({
      projectRoot: REPO_ROOT,
      runsFolder: runs,
      sendJson: (req, res, status, body) => {
        answers.push({ status, body })
      },
      readJsonBody: async () => ({ task: 'Fix a small bug' }),
    })

    const handled = await policyApi.handle({ method: 'POST' }, {}, new URL('http://localhost/api/control/route/lane'))
    expect(handled).toBe(true)
    expect(answers[0].status).toBe(200)
    expect(answers[0].body.lane).toBeNull()
    expect(answers[0].body.reason).toBe('There is no lane for the small tier. Make one in the room.')

    const runAnswers = []
    const runsApi = createRunsApi({
      projectRoot: REPO_ROOT,
      runsFolder: runs,
      sendJson: (req, res, status, body) => {
        runAnswers.push({ status, body })
      },
      readJsonBody: async () => ({ confirmed: true, task: 'Fix a small bug', lane: 'auto' }),
    })

    const runHandled = await runsApi.handle(
      { method: 'POST', headers: { origin: 'http://localhost' } },
      {},
      new URL('http://localhost/api/control/runs')
    )
    expect(runHandled).toBe(true)
    expect(runAnswers[0].status).toBe(409)
    expect(runAnswers[0].body.error).toBe('There is no lane for the small tier. Make one in the room.')
  })

  it('lists the program of a made lane in the doctor report', () => {
    const runs = makeDir('room-lanes-runs-')
    writeFileSync(join(runs, 'agents.json'), JSON.stringify({ agents: [madeAgent('made1', 'Made Lane One', 'claude')] }))

    const report = runDoctor({ projectRoot: REPO_ROOT, runsFolder: runs, dist: makeDist() })
    expect(report.lines.some((line) => line.includes('The Made Lane One lane'))).toBe(true)
    expect(NEXT_STEP).toBe('Press C in the room for Dispatch.')
  })

  it('names the lane file it read in the merge-lane and review-lane errors', async () => {
    const root = makeDir('room-lanes-scripts-')
    makeRepo(root)
    const missing = join(root, 'no-lanes.json')

    expect(checkPrerequisites({ root, lane: 'opencode', lanesPath: missing }).error).toBe(`${missing} could not be read.`)
    expect((await reviewLane({ root, lane: 'opencode', lanesPath: missing })).error).toBe(`${missing} could not be read.`)
  })

  it('reads the development fleet when MACHINEROOM_LANES_DIR names it', async () => {
    const previous = process.env.MACHINEROOM_LANES_DIR
    process.env.MACHINEROOM_LANES_DIR = join(REPO_ROOT, 'docs', 'agents')
    cleanups.push(() => {
      if (previous === undefined) delete process.env.MACHINEROOM_LANES_DIR
      else process.env.MACHINEROOM_LANES_DIR = previous
    })

    const runs = makeDir('room-lanes-runs-')
    writeActiveLanes(activeLanesFileFor(REPO_ROOT, runs), ['opencode2', 'opencode3', 'opencode'])

    const report = runDoctor({ projectRoot: REPO_ROOT, runsFolder: runs, dist: makeDist() })
    expect(report.lines.some((line) => line.includes('The Orchestrator lane'))).toBe(true)

    const answers = []
    const policyApi = createPolicyApi({
      projectRoot: REPO_ROOT,
      runsFolder: runs,
      sendJson: (req, res, status, body) => {
        answers.push({ status, body })
      },
      readJsonBody: async () => ({ task: 'Fix a small bug' }),
    })

    await policyApi.handle({ method: 'POST' }, {}, new URL('http://localhost/api/control/route/lane'))
    expect(answers[0].status).toBe(200)
    expect(answers[0].body.lane).toBe('opencode2')
    expect(answers[0].body.reason).not.toContain('Make one in the room.')
  })
})
