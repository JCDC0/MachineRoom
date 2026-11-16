import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import * as program from '../server/programPath.js'
import { defaultGitRunner as runGit } from '../server/git.js'
import { defaultGitRunner as runReviewGit } from '../server/reviews.js'
import { withoutRepoEnv } from './helpers/gitEnv.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const folders = []
afterEach(() => {
  vi.unstubAllEnvs()
  while (folders.length) removeTempDir(folders.pop())
})

function tempFolder() {
  const folder = makeTempDir('mr-git-env-')
  folders.push(folder)
  return folder
}

function repository() {
  const folder = tempFolder()
  const env = { ...withoutRepoEnv(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' }
  const git = (...args) => execFileSync('git', args, { cwd: folder, env, stdio: 'ignore', windowsHide: true })
  git('init')
  writeFileSync(join(folder, 'file'), String(folders.length))
  git('add', 'file')
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'initial')
  return folder
}

it('removes repository variables in any case and keeps other keys', () => {
  const base = { Git_Dir: 'a', git_work_tree: 'b', GIT_Index_File: 'c', git_common_dir: 'd', OTHER: 'kept' }
  expect(program.gitEnv(base)).toEqual({ OTHER: 'kept' })
  expect(Object.keys(base)).toHaveLength(5)
})

it('reviews the worktree HEAD when a foreign common directory is inherited', async () => {
  const repo = repository()
  const own = tempFolder()
  execFileSync('git', ['worktree', 'add', '-b', 'lane', own], { cwd: repo, env: withoutRepoEnv(), stdio: 'ignore', windowsHide: true })
  const other = repository()
  const foreign = tempFolder()
  execFileSync('git', ['worktree', 'add', '-b', 'foreign', foreign], { cwd: other, env: withoutRepoEnv(), stdio: 'ignore', windowsHide: true })
  const foreignGit = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: foreign, env: withoutRepoEnv(), encoding: 'utf8', windowsHide: true }).trim()
  const expected = (await runReviewGit(own, ['rev-parse', 'HEAD'])).trim()
  vi.stubEnv('GIT_COMMON_DIR', foreignGit)
  expect((await runReviewGit(own, ['rev-parse', 'HEAD'])).trim()).toBe(expected)
})

it('rejects a plain folder when a foreign GIT_DIR is inherited', async () => {
  const other = repository()
  const plain = tempFolder()
  vi.stubEnv('GIT_DIR', join(other, '.git'))
  vi.stubEnv('GIT_CEILING_DIRECTORIES', dirname(plain))
  await expect(runGit(plain, ['rev-parse', '--absolute-git-dir'])).rejects.toThrow()
})
