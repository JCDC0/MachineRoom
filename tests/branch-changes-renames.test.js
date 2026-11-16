import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gitPath } from '../server/programPath.js'
import { branchChanges } from '../server/orchestrators.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()()
})

function freshDir() {
  const dir = makeTempDir('mr-branch-renames-')
  cleanups.push(() => removeTempDir(dir))
  return dir
}

function git(folder, args) {
  return String(execFileSync(gitPath(), args, {
    cwd: folder,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })).trim()
}

describe('branchChanges and renames', () => {
  it('lists both sides of a move on a lane branch', () => {
    const base = freshDir()
    const project = join(base, 'project')
    mkdirSync(join(project, 'docs'), { recursive: true })
    writeFileSync(join(project, 'docs', 'a.md'), '# a\n')
    git(project, ['init', '-b', 'main'])
    git(project, ['config', 'user.email', 'test@example.invalid'])
    git(project, ['config', 'user.name', 'MachineRoom Test'])
    git(project, ['config', 'commit.gpgsign', 'false'])
    git(project, ['config', 'core.autocrlf', 'false'])
    git(project, ['add', '.'])
    git(project, ['commit', '-m', 'base'])

    const worktree = join(base, 'worktree')
    git(project, ['worktree', 'add', '-b', 'feat/moved', worktree])
    mkdirSync(join(worktree, 'src'), { recursive: true })
    git(worktree, ['mv', 'docs/a.md', 'src/a.md'])
    git(worktree, ['commit', '-m', 'move a'])

    expect(branchChanges({ project: worktree }, {}, { project }).sort()).toEqual(['docs/a.md', 'src/a.md'])
  })
})
