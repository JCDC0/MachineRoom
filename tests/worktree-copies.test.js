import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { portOffsetFor, prepareWorktree } from '../scripts/run-lane.mjs'
import { readHarnessSettings, updateHarnessSettings } from '../server/harness-settings.js'
import { gitPath } from '../server/programPath.js'
import { makeTempDir } from './helpers/tempRoot.js'

const roots = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})
function git(folder, ...args) {
  const result = spawnSync(gitPath(), ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: folder, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}
function project() {
  const root = makeTempDir('mr-copies-')
  roots.push(root)
  const folder = join(root, 'project')
  mkdirSync(folder)
  git(folder, 'init', '-q')
  writeFileSync(join(folder, 'tracked'), 'original')
  git(folder, 'add', 'tracked')
  git(folder, 'commit', '-q', '-m', 'initial')
  return { root, folder }
}

describe('worktree copies', () => {
  it('copies an exact listed file and excludes it from git', () => {
    const { folder } = project()
    mkdirSync(join(folder, 'nested'))
    writeFileSync(join(folder, 'nested', 'local.env'), 'exact\n')
    const plan = prepareWorktree(folder, 'lane', { copies: ['nested/local.env'] })
    expect(readFileSync(join(plan.path, 'nested', 'local.env'), 'utf8')).toBe('exact\n')
    expect(git(plan.path, 'check-ignore', 'nested/local.env')).toBe('nested/local.env')
    expect(git(plan.path, 'status', '--porcelain')).toBe('')
  })
  it('does not copy into a reused worktree', () => {
    const { folder } = project()
    const plan = prepareWorktree(folder, 'lane')
    writeFileSync(join(folder, 'local.env'), 'new')
    prepareWorktree(folder, 'lane', { copies: ['local.env'] })
    expect(existsSync(join(plan.path, 'local.env'))).toBe(false)
  })
  it('does not overwrite an existing tracked file', () => {
    const { folder } = project()
    writeFileSync(join(folder, 'tracked'), 'changed')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const plan = prepareWorktree(folder, 'lane', { copies: ['tracked'] })
    expect(readFileSync(join(plan.path, 'tracked'), 'utf8')).toBe('original')
    expect(log).toHaveBeenCalledWith('worktree copy: skipped tracked (exists)')
  })
  it('refuses links outside the project', () => {
    const { root, folder } = project()
    const outside = join(root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'local.env'), 'outside')
    symlinkSync(outside, join(folder, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => prepareWorktree(folder, 'lane', { copies: ['linked/local.env'] })).toThrow('inside the project')
  })
  it('logs a missing file', () => {
    const { folder } = project()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    prepareWorktree(folder, 'lane', { copies: ['missing'] })
    expect(log).toHaveBeenCalledWith('worktree copy: skipped missing (missing)')
  })
  it('validates saved paths and retains the opt-in list', () => {
    const { root, folder } = project()
    for (const path of ['../x', '/abs', '.git/config', 'tracked/..']) expect(updateHarnessSettings(root, { worktreeCopies: [path] }, folder)).not.toBe('')
    expect(updateHarnessSettings(root, { worktreeCopies: ['.'] }, folder)).not.toBe('')
    expect(updateHarnessSettings(root, { worktreeCopies: Array(21).fill('x') }, folder)).not.toBe('')
    expect(updateHarnessSettings(root, { worktreeCopies: ['local.env'] }, folder)).toBe('')
    expect(readHarnessSettings(root).worktreeCopies).toEqual(['local.env'])
  })
})

describe('port offset', () => {
  it('is stable per lane key and differs between keys', () => {
    expect(portOffsetFor('lane1')).toBe(portOffsetFor('lane1'))
    expect(portOffsetFor('lane1')).not.toBe(portOffsetFor('lane2'))
    expect(portOffsetFor('lane1') % 10).toBe(0)
    expect(portOffsetFor('missing')).toBeLessThan(1000)
  })
})

describe('worktree copy exclude line', () => {
  it('adds the line once for two new lanes', () => {
    const { folder } = project()
    writeFileSync(join(folder, 'local.env'), 'x')
    prepareWorktree(folder, 'lane1', { copies: ['local.env'] })
    prepareWorktree(folder, 'lane2', { copies: ['local.env'] })
    const exclude = readFileSync(join(folder, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude.split('\n').filter((line) => line.trim() === '/local.env')).toHaveLength(1)
  })
  it('adds no line for a path whose copy is refused', () => {
    const { folder } = project()
    mkdirSync(join(folder, 'adir'))
    expect(() => prepareWorktree(folder, 'lane', { copies: ['adir'] })).toThrow('must be files')
    let exclude = ''
    try { exclude = readFileSync(join(folder, '.git', 'info', 'exclude'), 'utf8') } catch {}
    expect(exclude).not.toContain('/adir')
  })
})
