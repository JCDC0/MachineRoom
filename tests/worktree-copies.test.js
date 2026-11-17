import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
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
  it('saves distinct offsets and keeps them when lane names change', async () => {
    const root = makeTempDir('mr-offsets-')
    roots.push(root)
    expect(await portOffsetFor('opencode', root)).toBe(0)
    expect(await portOffsetFor('opencode-11', root)).toBe(10)
    expect(await portOffsetFor('alpha', root)).toBe(20)
    expect(await portOffsetFor('opencode', root)).toBe(0)
    expect(JSON.parse(readFileSync(join(root, 'port-offsets.json'), 'utf8'))).toEqual({ opencode: 0, 'opencode-11': 10, alpha: 20 })
  })
  it('reads the assignments after another allocator releases the lock', async () => {
    const root = makeTempDir('mr-offsets-')
    roots.push(root)
    const lock = join(root, '.port-offsets.lock')
    writeFileSync(lock, 'held')
    const pending = portOffsetFor('second', root)
    writeFileSync(join(root, 'port-offsets.json'), JSON.stringify({ first: 0 }))
    rmSync(lock)
    expect(await pending).toBe(10)
  })
  it('takes over a lock left by a dead process', async () => {
    const root = makeTempDir('mr-offsets-')
    roots.push(root)
    const lock = join(root, '.port-offsets.lock')
    writeFileSync(lock, '999999999')
    const old = new Date(Date.now() - 60000)
    utimesSync(lock, old, old)
    expect(await portOffsetFor('after-crash', root)).toBe(0)
    expect(existsSync(lock)).toBe(false)
  })
  it('refuses a new lane when all offsets are saved', async () => {
    const root = makeTempDir('mr-offsets-')
    roots.push(root)
    writeFileSync(join(root, 'port-offsets.json'), JSON.stringify(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`lane${i}`, i * 10]))))
    await expect(portOffsetFor('extra', root)).rejects.toThrow('No free port offset is left; remove old lanes from port-offsets.json.')
    expect(await portOffsetFor('lane0', root)).toBe(0)
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

describe('worktree copy failure', () => {
  it('removes the copied file when the exclude write fails', () => {
    const { folder } = project()
    writeFileSync(join(folder, 'local.env'), 'x')
    rmSync(join(folder, '.git', 'info', 'exclude'), { force: true })
    mkdirSync(join(folder, '.git', 'info', 'exclude'), { recursive: true })
    expect(() => prepareWorktree(folder, 'lane1', { copies: ['local.env'] })).toThrow()
    expect(existsSync(join(folder, '.worktrees', 'lane1', 'local.env'))).toBe(false)
  })
})
