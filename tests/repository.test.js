import { describe, expect, it } from 'vitest'
import {
  BRANCH_EMPTY_PROBLEM,
  BRANCH_EXISTS_PROBLEM,
  BRANCH_FROM_PROBLEM,
  BRANCH_NAME_PROBLEM,
  DIRTY_REASON,
  WORKTREE_REASON,
  branchFromProblem,
  branchRows,
  createConfirmText,
  defaultBranchFrom,
  newBranchProblem,
  repositoryHead,
  repositoryProjectName,
  switchBlockReason,
  switchConfirmText,
  validBranchName,
} from '../src/ui/repository.js'

function gitState(overrides = {}) {
  return {
    git: true,
    branch: 'main',
    detached: false,
    head: '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    dirty: false,
    branches: [
      { name: 'main', head: '1111111', current: true, worktree: false, upstream: 'origin/main', ahead: 0, behind: 0 },
      { name: 'feat/login', head: '2222222', current: false, worktree: false, upstream: 'origin/feat/login', ahead: 2, behind: 1 },
      { name: 'feat/held', head: '3333333', current: false, worktree: true, upstream: null, ahead: null, behind: null },
    ],
    commits: [],
    truncated: false,
    ...overrides,
  }
}

describe('the repository headline', () => {
  it('names the current branch', () => {
    expect(repositoryHead(gitState())).toBe('main')
  })

  it('names a detached head by its short sha', () => {
    expect(repositoryHead(gitState({ branch: null, detached: true }))).toBe('Detached at 1111111')
  })

  it('names a branch that is missing from the list as the current one when it is not detached', () => {
    expect(repositoryHead(gitState({ branch: 'other' }))).toBe('other')
  })

  it('leaves out a value that is not a git state', () => {
    expect(repositoryHead({ git: false })).toBe('')
    expect(repositoryHead(null)).toBe('')
  })
})

describe('the branch rows', () => {
  it('marks the current branch and reads ahead and behind', () => {
    const rows = branchRows(gitState())
    expect(rows.map((row) => row.name)).toEqual(['main', 'feat/login', 'feat/held'])
    expect(rows[0]).toMatchObject({ current: true, ahead: 0, behind: 0, switchable: false })
    expect(rows[1]).toMatchObject({ current: false, ahead: 2, behind: 1, worktree: false, switchable: true })
    expect(rows[2]).toMatchObject({ current: false, ahead: null, behind: null, worktree: true, switchable: false })
  })

  it('marks the branch the state names current even when the entry does not', () => {
    const state = gitState({
      branch: 'feat/login',
      branches: [
        { name: 'main', current: false, worktree: false },
        { name: 'feat/login', current: false, worktree: false },
      ],
    })
    const rows = branchRows(state)
    expect(rows.filter((row) => row.current).map((row) => row.name)).toEqual(['feat/login'])
  })

  it('treats a detached head as no current branch', () => {
    const rows = branchRows(gitState({ branch: null, detached: true }))
    expect(rows.some((row) => row.current)).toBe(false)
  })

  it('skips an entry with no name and a repeated name', () => {
    const rows = branchRows(
      gitState({
        branches: [
          { name: 'main', current: true },
          { name: '  ' },
          null,
          { name: 'main', current: false },
          { name: 'next', current: false },
        ],
      })
    )
    expect(rows.map((row) => row.name)).toEqual(['main', 'next'])
  })

  it('blocks every other branch while the checkout is dirty and says why', () => {
    const rows = branchRows(gitState({ dirty: true }))
    expect(rows[1].reason).toBe(DIRTY_REASON)
    expect(rows[1].switchable).toBe(false)
    expect(rows[0].reason).toBe('')
  })

  it('blocks a branch another worktree holds and says why', () => {
    const rows = branchRows(gitState())
    expect(rows[2].reason).toBe(WORKTREE_REASON)
  })

  it('returns no rows without a git state', () => {
    expect(branchRows({ git: false })).toEqual([])
    expect(branchRows(null)).toEqual([])
  })

  it('keeps two hundred branches', () => {
    const branches = Array.from({ length: 200 }, (_, index) => ({
      name: `branch-${String(index).padStart(3, '0')}`,
      current: index === 0,
      worktree: false,
      ahead: index % 5,
      behind: index % 3,
    }))
    const rows = branchRows(gitState({ branches }))
    expect(rows).toHaveLength(200)
    expect(rows[0].current).toBe(true)
    expect(rows[199].name).toBe('branch-199')
  })
})

describe('the switch guard', () => {
  it('names uncommitted changes before a worktree', () => {
    expect(switchBlockReason({ git: true, dirty: true }, { worktree: true })).toBe(DIRTY_REASON)
    expect(switchBlockReason({ git: true, dirty: false }, { worktree: true })).toBe(WORKTREE_REASON)
    expect(switchBlockReason({ git: true, dirty: false }, { worktree: false })).toBe('')
  })
})

describe('a new branch name', () => {
  it('needs a name', () => {
    expect(newBranchProblem('', gitState())).toBe(BRANCH_EMPTY_PROBLEM)
    expect(newBranchProblem('   ', gitState())).toBe(BRANCH_EMPTY_PROBLEM)
  })

  it('refuses an invalid name', () => {
    for (const name of ['-main', 'a b', 'a..b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', 'a.lock', '/a', 'a/', 'a//b', '@']) {
      expect(newBranchProblem(name, gitState())).toBe(BRANCH_NAME_PROBLEM)
    }
    expect(validBranchName('feat/login-2')).toBe(true)
  })

  it('refuses a name that is already a branch', () => {
    expect(newBranchProblem('main', gitState())).toBe(BRANCH_EXISTS_PROBLEM)
  })

  it('checks the branch to start from', () => {
    expect(branchFromProblem('main', gitState())).toBe('')
    expect(branchFromProblem('gone', gitState())).toBe(BRANCH_FROM_PROBLEM)
    expect(branchFromProblem('', gitState())).toBe(BRANCH_FROM_PROBLEM)
  })

  it('starts from the current branch, or the first branch when detached', () => {
    expect(defaultBranchFrom(gitState())).toBe('main')
    expect(defaultBranchFrom(gitState({ branch: 'feat/login' }))).toBe('feat/login')
    expect(defaultBranchFrom(gitState({ branch: null, detached: true }))).toBe('main')
  })
})

describe('the confirm sentences', () => {
  it('says what a switch changes', () => {
    expect(switchConfirmText('C:\\work\\demo', 'feat/login')).toBe(
      'Switch demo to feat/login? New lanes start from it and reviews compare against it.'
    )
  })

  it('says what a new branch does', () => {
    expect(createConfirmText('feat/new', 'main')).toBe(
      'Create feat/new from main? The new branch is made without switching to it.'
    )
  })

  it('names the project from its path, or Project when there is none', () => {
    expect(repositoryProjectName('C:\\work\\demo')).toBe('demo')
    expect(repositoryProjectName('demo')).toBe('demo')
    expect(repositoryProjectName('')).toBe('Project')
  })
})
