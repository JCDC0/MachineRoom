import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareWorktree, worktreePlan } from '../scripts/run-lane.mjs'
import { gitPath } from '../server/programPath.js'
import { parseRunArgs, worktreeFor, worktreeProblems } from '../src/briefs/run.js'
import { withLanePrograms } from './helpers/lanePrograms.js'
import { makeTempDir } from './helpers/tempRoot.js'

const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    fn()
  }
})

function tempDir(prefix = 'mr-worktree-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function git(folder, args) {
  const result = spawnSync(gitPath(), ['-c', 'user.email=worktree@example.com', '-c', 'user.name=MachineRoom Worktree', ...args], {
    cwd: folder,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(String(result.stderr ?? '').trim() || `git ${args[0]} failed.`)
  return String(result.stdout ?? '')
}

function initRepo(parent, name = 'Other') {
  const folder = join(parent, name)
  mkdirSync(folder)
  git(folder, ['init'])
  git(folder, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(folder, 'readme.txt'), 'start\n')
  git(folder, ['add', '-A'])
  git(folder, ['commit', '-m', 'start'])
  git(folder, ['branch', '-M', 'main'])
  return folder
}

function runLane(args) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [RUN_LANE_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: withLanePrograms(process.env, tempDir('mr-lane-programs-')),
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      fail(new Error(`run-lane did not exit. stderr: ${stderr}`))
    }, 30000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      fail(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      done({ code, stdout, stderr })
    })
  })
}

function cleanPath(value) {
  return String(value ?? '').replace(/\\/g, '/').toLowerCase()
}

describe('worktreeFor', () => {
  it('puts the worktree beside the project with the lane in its name', () => {
    const project = join('work', 'Other')
    expect(worktreeFor(project, 'opencode')).toBe(join('work', 'Other-mr-opencode'))
    expect(worktreeFor(`${project}${sep}`, 'claude')).toBe(join('work', 'Other-mr-claude'))
    expect(worktreeFor(`${project}${sep}${sep}`, 'opencode')).toBe(join('work', 'Other-mr-opencode'))
    expect(worktreeFor(project, 'opencode10')).toBe(join('work', 'Other-mr-opencode10'))
  })

  it('keeps the separator style of the project path on Windows', () => {
    if (process.platform !== 'win32') return
    expect(worktreeFor('C:\\GitHub\\Other', 'opencode')).toBe('C:\\GitHub\\Other-mr-opencode')
    expect(worktreeFor('C:/GitHub/Other', 'opencode')).toBe('C:/GitHub/Other-mr-opencode')
    expect(worktreeFor('C:\\GitHub\\Other\\', 'opencode')).toBe('C:\\GitHub\\Other-mr-opencode')
  })

  it('gives nothing without a project or a lane', () => {
    expect(worktreeFor('', 'opencode')).toBe('')
    expect(worktreeFor('/work/Other', '')).toBe('')
    expect(worktreeFor('/', 'opencode')).toBe('')
  })
})

describe('worktreeProblems', () => {
  it('asks for a project only when --worktree is on', () => {
    expect(worktreeProblems({})).toEqual([])
    expect(worktreeProblems({ project: 'C:\\work' })).toEqual([])
    expect(worktreeProblems({ worktree: true })).toEqual(['--worktree needs --project <folder>.'])
    expect(worktreeProblems({ worktree: true, project: 'C:\\work' })).toEqual([])
  })
})

describe('the --worktree argument', () => {
  it('goes with a project and a task or a task file', () => {
    expect(parseRunArgs(['opencode', '--project', 'C:\\work', '--task', 'Fix it.', '--worktree'])).toMatchObject({
      project: 'C:\\work', task: 'Fix it.', worktree: true,
    })
    expect(parseRunArgs(['opencode', '--project', 'C:\\work', '--task-file', 'task.md', '--worktree'])).toMatchObject({
      project: 'C:\\work', taskFile: 'task.md', worktree: true,
    })
    expect(parseRunArgs(['opencode', '--project', 'C:\\work', '--task', 'Fix it.']).worktree).toBeUndefined()
  })

  it('refuses --worktree without a project', () => {
    expect(() => parseRunArgs(['opencode', '--worktree', '--task', 'Fix it.'])).toThrow('--worktree needs --project <folder>.')
    expect(() => parseRunArgs(['opencode', 'T2', '--worktree'])).toThrow('--worktree needs --project <folder>.')
  })
})

describe('the worktree on a real repository', () => {
  it('makes a detached worktree beside the project and links node_modules', () => {
    const base = tempDir()
    const project = initRepo(base)
    mkdirSync(join(project, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(project, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1\n')
    const path = worktreeFor(project, 'opencode')
    cleanups.push(() => {
      try {
        unlinkSync(join(path, 'node_modules'))
      } catch {}
    })

    expect(worktreePlan(project, 'opencode')).toEqual({ path, made: true })
    expect(existsSync(path)).toBe(false)
    expect(prepareWorktree(project, 'opencode')).toEqual({ path, made: true })
    expect(existsSync(path)).toBe(true)
    expect(git(path, ['rev-parse', '--is-inside-work-tree']).trim()).toBe('true')
    expect(git(path, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('HEAD')
    expect(cleanPath(git(project, ['worktree', 'list', '--porcelain']))).toContain(cleanPath(path))
    expect(readFileSync(join(path, 'node_modules', 'pkg', 'index.js'), 'utf8')).toBe('module.exports = 1\n')
    expect(prepareWorktree(project, 'opencode')).toEqual({ path, made: false })
  })

  it('reuses a clean worktree and refuses a dirty one with its path', () => {
    const base = tempDir()
    const project = initRepo(base)
    const path = prepareWorktree(project, 'opencode').path
    expect(worktreePlan(project, 'opencode')).toEqual({ path, made: false })
    writeFileSync(join(path, 'readme.txt'), 'changed\n')
    expect(() => worktreePlan(project, 'opencode')).toThrow(`The worktree ${path} has uncommitted changes. Commit or discard them first.`)
    expect(() => prepareWorktree(project, 'opencode')).toThrow(path)
    git(path, ['checkout', '--', 'readme.txt'])
    expect(worktreePlan(project, 'opencode')).toEqual({ path, made: false })
  })

  it('moves a reused worktree to the project HEAD, so a new queue starts from the current commit', () => {
    const base = tempDir()
    const project = initRepo(base)
    const path = prepareWorktree(project, 'opencode').path
    git(path, ['switch', '-q', '-c', 'machineroom/queue-old'])
    git(path, ['commit', '-q', '--allow-empty', '-m', 'old task'])
    git(project, ['commit', '-q', '--allow-empty', '-m', 'newer main'])
    prepareWorktree(project, 'opencode')
    expect(git(path, ['rev-parse', 'HEAD']).trim()).toBe(git(project, ['rev-parse', 'HEAD']).trim())
    expect(git(path, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('HEAD')
  })
})

describe('run-lane --worktree --dry-run', () => {
  it('prints the path and that it would be made, and creates nothing', async () => {
    const base = tempDir()
    const project = initRepo(base)
    const path = worktreeFor(project, 'opencode')
    const result = await runLane(['opencode', '--project', project, '--task', 'Fix it.', '--worktree', '--dry-run'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`worktree: ${path}`)
    expect(result.stdout).toContain('worktree: would be made')
    expect(result.stdout).toContain(`cwd: ${path}`)
    expect(existsSync(path)).toBe(false)
    expect(git(project, ['branch', '--show-current']).trim()).toBe('main')
    expect(git(project, ['status', '--porcelain']).trim()).toBe('')
  })

  it('prints the worktree and the branch for a queue', async () => {
    const base = tempDir()
    const project = initRepo(base)
    const file = join(base, 'queue.txt')
    writeFileSync(file, 'First task.\n---\nSecond task.\n')
    const path = worktreeFor(project, 'opencode')
    const result = await runLane(['opencode', '--project', project, '--queue', file, '--worktree', '--dry-run'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`worktree: ${path}`)
    expect(result.stdout).toContain('worktree: would be made')
    expect(result.stdout).toContain('branch: machineroom/queue-')
    expect(result.stdout).toContain('1. First task.')
    expect(result.stdout).toContain('2. Second task.')
    expect(existsSync(path)).toBe(false)
  })

  it('refuses --worktree on a project that is not a git folder', async () => {
    const base = tempDir()
    const project = join(base, 'Plain')
    mkdirSync(project)
    const result = await runLane(['opencode', '--project', project, '--task', 'Fix it.', '--worktree', '--dry-run'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('is not a git folder')
    expect(result.stdout).not.toContain('cwd:')
  })

  it('refuses a queue with --worktree and no project', async () => {
    const base = tempDir()
    const file = join(base, 'queue.txt')
    writeFileSync(file, 'One task.\n')
    const result = await runLane(['opencode', '--queue', file, '--worktree', '--dry-run'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--queue needs --project <folder>.')
  })

  it('says a clean worktree would be reused', async () => {
    const base = tempDir()
    const project = initRepo(base)
    prepareWorktree(project, 'opencode')
    const result = await runLane(['opencode', '--project', project, '--task', 'Fix it.', '--worktree', '--dry-run'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('worktree: would be reused')
  })

  it('refuses a dirty worktree and names it', async () => {
    const base = tempDir()
    const project = initRepo(base)
    const path = prepareWorktree(project, 'opencode').path
    writeFileSync(join(path, 'readme.txt'), 'changed\n')
    const result = await runLane(['opencode', '--project', project, '--task', 'Fix it.', '--worktree', '--dry-run'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(path)
    expect(result.stderr).toContain('has uncommitted changes')
  })
})
