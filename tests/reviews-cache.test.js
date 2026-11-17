import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { createReviewsApi, defaultGitRunner } from '../server/reviews.js'
import { invalidateGitCache } from '../server/git.js'
import { makeTempDir } from './helpers/tempRoot.js'

const root = makeTempDir('reviews-cache-')
afterAll(() => rmSync(root, { recursive: true, force: true }))

it('refreshes only affected reviews and drops the cache on invalidation', async () => {
  const repo = join(root, 'repo')
  const agents = join(repo, 'docs', 'agents')
  mkdirSync(agents, { recursive: true })
  const git = (cwd, args) => execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'none'), GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' } })
  git(repo, ['init', '-b', 'main'])
  writeFileSync(join(repo, 'file.txt'), 'base')
  git(repo, ['add', 'file.txt'])
  git(repo, ['commit', '-m', 'base'])
  const one = join(root, 'one')
  const two = join(root, 'two')
  git(repo, ['worktree', 'add', '-b', 'one', one])
  git(repo, ['worktree', 'add', '-b', 'two', two])
  writeFileSync(join(agents, 'lanes.json'), JSON.stringify({ one: { worktree: one }, two: { worktree: two } }))
  writeFileSync(join(agents, 'TASKS.md'), '')
  const calls = []
  const records = []
  const api = createReviewsApi({ projectRoot: repo, briefsDir: agents, readRuns: () => records, sendJson: () => {}, gitRunner: async (cwd, args, options) => { calls.push({ cwd, command: args[0] }); return defaultGitRunner(cwd, args, options) } })
  const list = () => api.handle({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/control/reviews'))
  const slow = () => calls.filter(({ command }) => ['diff', 'merge-tree', 'log'].includes(command))
  await list()
  expect(slow()).toHaveLength(4)
  calls.length = 0
  await list()
  expect(slow()).toHaveLength(0)
  writeFileSync(join(one, 'file.txt'), 'commit')
  git(one, ['add', 'file.txt'])
  git(one, ['commit', '-m', 'change'])
  await list()
  expect(slow().map(({ cwd }) => cwd)).toEqual([one, one])
  calls.length = 0
  writeFileSync(join(two, 'file.txt'), 'dirty')
  await list()
  expect(slow().map(({ cwd }) => cwd)).toEqual([two, two])
  calls.length = 0
  records.push({ lane: 'one', startedAt: '2026-01-01T00:00:00Z' })
  await list()
  expect(slow().map(({ cwd }) => cwd)).toEqual([one, one])
  calls.length = 0
  invalidateGitCache(repo)
  await list()
  expect(slow()).toHaveLength(4)
})
