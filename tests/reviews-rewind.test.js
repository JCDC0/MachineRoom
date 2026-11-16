import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gitPath } from '../server/programPath.js'
import { createReviewsApi } from '../server/reviews.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const IDENTITY = {
  GIT_AUTHOR_NAME: 'MachineRoom Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'MachineRoom Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
}
const OWNER = { origin: 'http://localhost:5173' }
const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

function git(cwd, args) {
  return execFileSync(gitPath(), ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    windowsHide: true,
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITY },
  }).trim()
}

function setup({ dirty = false, branch = 'feat/rewind' } = {}) {
  const dir = makeTempDir('mr-rewind-')
  cleanups.push(() => removeTempDir(dir))
  const repo = join(dir, 'repo')
  const worktree = join(dir, 'lane')
  const agentsDir = join(dir, 'docs', 'agents')
  const runsFolder = join(dir, 'runs')
  mkdirSync(repo)
  mkdirSync(agentsDir, { recursive: true })
  mkdirSync(runsFolder)
  git(repo, ['init', '-q', '-b', 'main'])
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-qm', 'Start'])
  git(repo, ['worktree', 'add', '-q', '-b', 'feat/rewind', worktree])
  const checkpointHead = git(worktree, ['rev-parse', 'HEAD'])
  writeFileSync(join(worktree, 'b.txt'), 'two\n')
  git(worktree, ['add', '.'])
  git(worktree, ['commit', '-qm', 'Run commit'])
  const head = git(worktree, ['rev-parse', 'HEAD'])
  writeFileSync(join(agentsDir, 'lanes.json'), JSON.stringify({ lane1: { name: 'Lane 1', worktree } }))
  const record = {
    lane: 'lane1',
    startedAt: '2026-11-17T10-00-00.000Z',
    checkpoint: { head: checkpointHead, branch, dirty },
    commits: git(worktree, ['log', '--oneline', `${checkpointHead}..HEAD`]),
  }
  const answers = []
  const messages = []
  const api = createReviewsApi({
    projectRoot: repo,
    briefsDir: agentsDir,
    runsFolder,
    sendJson: (req, res, status, body) => answers.push({ status, body }),
    readJsonBody: async (req) => req.body,
    orchestrators: () => ({
      idForToken: () => null,
      find: () => ({ deliver: (from, text) => messages.push({ from, text }) }),
    }),
    readRuns: () => [record],
  })
  const url = new URL('http://127.0.0.1/api/control/reviews/lane1/rewind')
  const post = async (body, headers = OWNER) => {
    await api.handle({ method: 'POST', headers, body }, {}, url)
    return answers.at(-1)
  }
  const get = async () => {
    await api.handle({ method: 'GET', headers: {} }, {}, url)
    return answers.at(-1)
  }
  return { worktree, repo, runsFolder, checkpointHead, head, messages, post, get }
}

describe('lane rewind', () => {
  it('previews the commits and files a rewind drops', async () => {
    const s = setup()
    const answer = await s.get()
    expect(answer.status).toBe(200)
    expect(answer.body).toMatchObject({ checkpointHead: s.checkpointHead, head: s.head, files: ['b.txt'] })
    expect(answer.body.commits).toHaveLength(1)
    expect(answer.body.recoveryRef).toBe('refs/machineroom/recovery/lane1-2026-11-17T10-00-00.000Z')
  })

  it('moves a clean lane back, keeps the old head in a recovery ref and tells the orchestrator', async () => {
    const s = setup()
    const answer = await s.post({ confirmed: true, expectedHead: s.head })
    expect(answer.status).toBe(200)
    expect(git(s.worktree, ['rev-parse', 'HEAD'])).toBe(s.checkpointHead)
    expect(git(s.worktree, ['rev-parse', answer.body.recoveryRef])).toBe(s.head)
    expect(answer.body.restore).toBe(`git reset --keep ${answer.body.recoveryRef}`)
    expect(s.messages).toEqual([
      {
        from: 'room',
        text: `lane1 was rewound to ${s.checkpointHead.slice(0, 7)}; its last run's commits are kept at ${answer.body.recoveryRef}.`,
      },
    ])
  })

  it('refuses a dirty worktree, an untracked file included', async () => {
    const s = setup()
    writeFileSync(join(s.worktree, 'c.txt'), 'loose\n')
    const answer = await s.post({ confirmed: true, expectedHead: s.head })
    expect(answer).toEqual({ status: 409, body: { error: 'The lane has uncommitted changes, so it was not rewound.' } })
    expect(git(s.worktree, ['rev-parse', 'HEAD'])).toBe(s.head)
  })

  it('refuses a commit made by hand after the run', async () => {
    const s = setup()
    writeFileSync(join(s.worktree, 'hand.txt'), 'hand\n')
    git(s.worktree, ['add', '.'])
    git(s.worktree, ['commit', '-qm', 'By hand'])
    const head = git(s.worktree, ['rev-parse', 'HEAD'])
    const answer = await s.post({ confirmed: true, expectedHead: head })
    expect(answer).toEqual({
      status: 409,
      body: { error: 'The lane has commits that the last run did not make, so it was not rewound.' },
    })
    expect(git(s.worktree, ['rev-parse', 'HEAD'])).toBe(head)
  })

  it('refuses when the head moved since the preview', async () => {
    const s = setup()
    const answer = await s.post({ confirmed: true, expectedHead: s.checkpointHead })
    expect(answer).toEqual({ status: 409, body: { error: 'The lane moved since you read it. Read it again.' } })
    expect(git(s.worktree, ['rev-parse', 'HEAD'])).toBe(s.head)
  })

  it('refuses while a run is going', async () => {
    const s = setup()
    writeFileSync(join(s.runsFolder, 'lane1.lock'), String(process.pid))
    const answer = await s.post({ confirmed: true, expectedHead: s.head })
    expect(answer).toEqual({ status: 409, body: { error: 'The lane has a run going, so stop it first.' } })
    expect(git(s.worktree, ['rev-parse', 'HEAD'])).toBe(s.head)
  })

  it('refuses a run that started on unsaved work', async () => {
    const s = setup({ dirty: true })
    const answer = await s.post({ confirmed: true, expectedHead: s.head })
    expect(answer).toEqual({
      status: 409,
      body: { error: 'The run started on unsaved work, so it cannot be rewound to its start.' },
    })
    expect((await s.get()).body).toMatchObject({ allowed: false })
    expect(git(s.worktree, ['rev-parse', 'HEAD'])).toBe(s.head)
  })

  it('refuses a cross-origin or unconfirmed request', async () => {
    const s = setup()
    expect((await s.post({ confirmed: true, expectedHead: s.head }, {})).status).toBe(403)
    expect((await s.post({ expectedHead: s.head })).status).toBe(400)
    expect((await s.post({ confirmed: true })).status).toBe(400)
    expect(git(s.worktree, ['rev-parse', 'HEAD'])).toBe(s.head)
    expect(s.messages).toEqual([])
  })
})
