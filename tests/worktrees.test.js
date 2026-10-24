import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gitPath } from '../server/programPath.js'
import {
  cleanDecision,
  collectWorktrees,
  lockHolder,
  parseWorktreeList,
  parseWorktreesArgs,
  runWorktrees,
  statusChanges,
  worktreeLane,
  worktreeLine,
} from '../scripts/worktrees.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

const NO_GIT_CONFIG = join(tmpdir(), 'machineroom-worktrees-no-git-config')
const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    fn()
  }
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function git(cwd, args) {
  return execFileSync(gitPath(), args, {
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

function makeProject(prefix) {
  const base = tempDir(prefix)
  const project = join(base, 'sample')
  mkdirSync(project, { recursive: true })
  git(project, ['init', '-b', 'main'])
  git(project, ['config', 'user.name', 'MachineRoom Test'])
  git(project, ['config', 'user.email', 'test@example.invalid'])
  git(project, ['config', 'commit.gpgsign', 'false'])
  git(project, ['config', 'core.autocrlf', 'false'])
  writeFileSync(join(project, 'notes.txt'), 'one\n')
  git(project, ['add', 'notes.txt'])
  git(project, ['commit', '-m', 'first'])
  return { base, project }
}

function addWorktree(project, base, lane, branch) {
  const path = join(base, `sample-mr-${lane}`)
  git(project, ['worktree', 'add', '-b', branch, path])
  return path
}

function makeLaneWorktrees() {
  const { base, project } = makeProject('mr-worktrees-')
  const runs = tempDir('mr-worktrees-runs-')
  const clean = addWorktree(project, base, 'clean', 'feat/clean')
  const dirty = addWorktree(project, base, 'dirty', 'feat/dirty')
  const ahead = addWorktree(project, base, 'ahead', 'feat/ahead')
  writeFileSync(join(dirty, 'notes.txt'), 'changed\n')
  writeFileSync(join(ahead, 'extra.txt'), 'new\n')
  git(ahead, ['add', 'extra.txt'])
  git(ahead, ['commit', '-m', 'ahead'])
  return { base, project, runs, clean, dirty, ahead }
}

describe('parseWorktreeList', () => {
  it('reads the paths, heads, branches, detached, locked and prunable lines', () => {
    const text = [
      'worktree C:/Work/sample',
      'HEAD aaaaaaa',
      'branch refs/heads/main',
      '',
      'worktree C:/Work/sample-mr-opencode8',
      'HEAD bbbbbbb',
      'branch refs/heads/feat/w7',
      'locked another reason',
      '',
      'worktree C:/Work/sample-mr-hermes',
      'HEAD ccccccc',
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n')
    expect(parseWorktreeList(text)).toEqual([
      {
        path: 'C:/Work/sample',
        head: 'aaaaaaa',
        branch: 'main',
        detached: false,
        bare: false,
        locked: false,
        lockReason: '',
        prunable: false,
        prunableReason: '',
      },
      {
        path: 'C:/Work/sample-mr-opencode8',
        head: 'bbbbbbb',
        branch: 'feat/w7',
        detached: false,
        bare: false,
        locked: true,
        lockReason: 'another reason',
        prunable: false,
        prunableReason: '',
      },
      {
        path: 'C:/Work/sample-mr-hermes',
        head: 'ccccccc',
        branch: '',
        detached: true,
        bare: false,
        locked: false,
        lockReason: '',
        prunable: true,
        prunableReason: 'gitdir file points to non-existent location',
      },
    ])
  })

  it('reads an answer that does not end with a blank line', () => {
    expect(parseWorktreeList('worktree C:/Work/sample\nHEAD abc\nbranch refs/heads/main')).toHaveLength(1)
  })
})

describe('worktreeLane', () => {
  it('takes the lane from a folder beside the project', () => {
    expect(worktreeLane('/work/sample', '/work/sample-mr-opencode8', { platform: 'linux' })).toBe('opencode8')
    expect(worktreeLane('C:\\Work\\Sample\\', 'C:\\Work\\Sample-mr-hermes', { platform: 'win32' })).toBe('hermes')
  })

  it('leaves a folder that is not a lane worktree of this project', () => {
    expect(worktreeLane('/work/sample', '/work/other-mr-hermes', { platform: 'linux' })).toBe('')
    expect(worktreeLane('/work/sample', '/work/sample-mr-', { platform: 'linux' })).toBe('')
    expect(worktreeLane('/work/sample', '/work/sample', { platform: 'linux' })).toBe('')
    expect(worktreeLane('C:\\Work\\sample', 'C:\\Work\\Sample-mr-hermes', { platform: 'linux' })).toBe('')
  })
})

describe('statusChanges', () => {
  it('counts a changed or untracked file and skips the node_modules link', () => {
    expect(statusChanges(' M notes.txt\n?? extra.txt\n?? node_modules\n')).toHaveLength(2)
    expect(statusChanges('?? node_modules\n')).toHaveLength(0)
    expect(statusChanges('')).toHaveLength(0)
  })
})

describe('lockHolder', () => {
  it('reads a process id and refuses anything else', () => {
    expect(lockHolder('1234\n')).toBe(1234)
    expect(lockHolder(' 42 ')).toBe(42)
    expect(lockHolder('')).toBeNull()
    expect(lockHolder('opencode')).toBeNull()
    expect(lockHolder('0')).toBeNull()
  })
})

describe('cleanDecision', () => {
  it('removes only a clean worktree with nothing unmerged', () => {
    expect(cleanDecision({ dirty: false, ahead: 0, merged: true })).toEqual({ remove: true, reason: '' })
  })

  it('leaves a running lane, a locked or missing worktree, a dirty one and one ahead', () => {
    expect(cleanDecision({ running: true }).remove).toBe(false)
    expect(cleanDecision({ running: true }).reason).toBe('the lane is running')
    expect(cleanDecision({ locked: true }).reason).toBe('the worktree is locked')
    expect(cleanDecision({ prunable: true }).reason).toBe('the worktree folder is gone')
    expect(cleanDecision({ dirty: true })).toEqual({ remove: false, reason: 'it has uncommitted changes' })
    expect(cleanDecision({ ahead: 2, merged: false })).toEqual({ remove: false, reason: 'it has 2 commits not merged' })
    expect(cleanDecision({ ahead: 1, merged: false }).reason).toBe('it has 1 commit not merged')
    expect(cleanDecision({ ahead: 0, merged: false }).reason).toBe('its commits are not merged')
  })
})

describe('worktreeLine', () => {
  it('prints the lane, path, branch, ahead count, changes and merge state', () => {
    expect(worktreeLine({
      lane: 'opencode8',
      path: 'C:\\Work\\sample-mr-opencode8',
      branch: 'feat/w7',
      ahead: 2,
      dirty: false,
      merged: false,
    })).toBe('opencode8 | C:\\Work\\sample-mr-opencode8 | feat/w7 | 2 ahead | clean | not merged')
    expect(worktreeLine({
      lane: 'hermes',
      path: '/work/sample-mr-hermes',
      branch: 'detached',
      ahead: 0,
      dirty: true,
      merged: true,
    })).toBe('hermes | /work/sample-mr-hermes | detached | 0 ahead | uncommitted changes | merged')
  })

  it('says removed or why it was left', () => {
    expect(worktreeLine({ lane: 'a', path: '/p', branch: 'main', ahead: 0, dirty: false, merged: true, removed: true }))
      .toBe('a | /p | main | 0 ahead | clean | merged | removed')
    expect(worktreeLine({ lane: 'a', path: '/p', branch: 'main', ahead: 0, dirty: true, merged: true, reason: 'it has uncommitted changes' }))
      .toBe('a | /p | main | 0 ahead | uncommitted changes | merged | left: it has uncommitted changes')
  })
})

describe('parseWorktreesArgs', () => {
  it('reads the project, --clean and --json', () => {
    expect(parseWorktreesArgs(['--project', 'C:\\Work\\sample', '--clean', '--json'])).toEqual({
      project: 'C:\\Work\\sample',
      clean: true,
      json: true,
      help: false,
    })
    expect(parseWorktreesArgs(['--project=/work/sample'])).toMatchObject({ project: '/work/sample', clean: false, json: false })
  })

  it('asks for a project and refuses an unknown option', () => {
    expect(() => parseWorktreesArgs([])).toThrow('--project needs a folder.')
    expect(() => parseWorktreesArgs(['--wat'])).toThrow('Unknown option --wat.')
    expect(() => parseWorktreesArgs(['--project'])).toThrow('--project needs a folder.')
  })
})

describe('the lane worktrees of a real project', () => {
  it('lists one clean merged worktree, one dirty and one ahead', () => {
    const { project, runs, base } = makeLaneWorktrees()
    const listed = collectWorktrees({ project, runs })
    expect(listed.branch).toBe('main')
    expect(listed.worktrees.map((row) => row.lane)).toEqual(['ahead', 'clean', 'dirty'])
    expect(listed.worktrees.find((row) => row.lane === 'clean')).toMatchObject({
      path: join(base, 'sample-mr-clean'),
      branch: 'feat/clean',
      ahead: 0,
      dirty: false,
      merged: true,
      running: false,
    })
    expect(listed.worktrees.find((row) => row.lane === 'dirty')).toMatchObject({ ahead: 0, dirty: true, merged: true })
    expect(listed.worktrees.find((row) => row.lane === 'ahead')).toMatchObject({ ahead: 1, dirty: false, merged: false })
  }, 60000)

  it('removes only the clean merged worktree and keeps every branch', () => {
    const { project, runs, clean, dirty, ahead } = makeLaneWorktrees()
    const lines = []
    const code = runWorktrees({ argv: ['--project', project, '--clean'], runs, log: (line) => lines.push(line), error: () => {} })
    expect(code).toBe(0)
    expect(existsSync(clean)).toBe(false)
    expect(existsSync(dirty)).toBe(true)
    expect(existsSync(ahead)).toBe(true)
    expect(lines).toContain('Removed 1 of 3.')
    const cleanLine = lines.find((line) => line.startsWith('clean | '))
    const dirtyLine = lines.find((line) => line.startsWith('dirty | '))
    const aheadLine = lines.find((line) => line.startsWith('ahead | '))
    expect(cleanLine).toMatch(/ \| removed$/)
    expect(dirtyLine).toContain('left: it has uncommitted changes')
    expect(aheadLine).toContain('left: it has 1 commit not merged')
    expect(git(project, ['rev-parse', '--verify', '--quiet', 'refs/heads/feat/clean']).trim()).toHaveLength(40)
    expect(git(project, ['rev-parse', '--verify', '--quiet', 'refs/heads/feat/dirty']).trim()).toHaveLength(40)
    expect(git(project, ['rev-parse', '--verify', '--quiet', 'refs/heads/feat/ahead']).trim()).toHaveLength(40)
    expect(git(project, ['worktree', 'list', '--porcelain'])).not.toContain('sample-mr-clean')
  }, 60000)

  it('leaves a clean worktree whose lane lock names a live process', () => {
    const { project, runs, clean } = makeLaneWorktrees()
    writeFileSync(join(runs, 'clean.lock'), String(process.pid))
    const lines = []
    const code = runWorktrees({ argv: ['--project', project, '--clean'], runs, log: (line) => lines.push(line), error: () => {} })
    expect(code).toBe(0)
    expect(existsSync(clean)).toBe(true)
    expect(lines.find((line) => line.startsWith('clean | '))).toContain(`left: the lane is running (process ${process.pid})`)
    expect(lines).toContain('Removed 0 of 3.')
  }, 60000)

  it('removes the clean worktree after its lock process is gone', () => {
    const { project, runs, clean } = makeLaneWorktrees()
    writeFileSync(join(runs, 'clean.lock'), '99999999')
    const code = runWorktrees({ argv: ['--project', project, '--clean', '--json'], runs, log: () => {}, error: () => {} })
    expect(code).toBe(0)
    expect(existsSync(clean)).toBe(false)
  }, 60000)

  it('prints the rows as JSON', () => {
    const { project, runs } = makeLaneWorktrees()
    const lines = []
    const code = runWorktrees({ argv: ['--project', project, '--json'], runs, log: (line) => lines.push(line), error: () => {} })
    expect(code).toBe(0)
    const answer = JSON.parse(lines.join('\n'))
    expect(answer.branch).toBe('main')
    expect(answer.worktrees).toHaveLength(3)
    expect(answer.worktrees[0]).toMatchObject({ lane: 'ahead', branch: 'feat/ahead', ahead: 1, dirty: false, merged: false })
  }, 60000)

  it('reports a folder that is not a git project', () => {
    const folder = tempDir('mr-worktrees-plain-')
    const errors = []
    const code = runWorktrees({ argv: ['--project', folder], log: () => {}, error: (line) => errors.push(line) })
    expect(code).toBe(1)
    expect(errors[0]).toContain('is not a git project')
  })
})
