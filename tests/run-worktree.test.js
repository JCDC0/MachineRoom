import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prepareWorktree, takeProjectLock, worktreePlan } from '../scripts/run-lane.mjs'
import { releaseLaneLock } from '../scripts/lane-lock.mjs'
import { gitPath } from '../server/programPath.js'
import { parseRunArgs, worktreeFor, worktreeProblems } from '../src/briefs/run.js'
import { withLanePrograms } from './helpers/lanePrograms.js'
import { makeTempDir } from './helpers/tempRoot.js'

const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const FAKE_LANE = fileURLToPath(new URL('fixtures/fake-lane.cjs', import.meta.url))
const cleanups = []
let repoTemplate = ''
let repoTemplateRoot = ''

beforeAll(() => {
  repoTemplateRoot = makeTempDir('mr-worktree-template-')
  repoTemplate = join(repoTemplateRoot, 'Other')
  mkdirSync(repoTemplate)
  git(repoTemplate, ['init', '-q', '-b', 'main'])
  git(repoTemplate, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(repoTemplate, 'readme.txt'), 'start\n')
  git(repoTemplate, ['add', '-A'])
  git(repoTemplate, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'start'])
})

afterAll(() => {
  rmSync(repoTemplateRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

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
  cpSync(repoTemplate, folder, { recursive: true })
  return folder
}

function runLane(args, extra = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [RUN_LANE_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...withLanePrograms(process.env, tempDir('mr-lane-programs-')), ...extra },
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
  it('puts the worktree in the .worktrees folder of the project under the lane name', () => {
    const project = join('work', 'Other')
    expect(worktreeFor(project, 'opencode')).toBe(join('work', 'Other', '.worktrees', 'opencode'))
    expect(worktreeFor(`${project}${sep}`, 'claude')).toBe(join('work', 'Other', '.worktrees', 'claude'))
    expect(worktreeFor(`${project}${sep}${sep}`, 'opencode')).toBe(join('work', 'Other', '.worktrees', 'opencode'))
    expect(worktreeFor(project, 'opencode10')).toBe(join('work', 'Other', '.worktrees', 'opencode10'))
  })

  it('keeps the separator style of the project path on Windows', () => {
    if (process.platform !== 'win32') return
    expect(worktreeFor('C:\\GitHub\\Other', 'opencode')).toBe('C:\\GitHub\\Other\\.worktrees\\opencode')
    expect(worktreeFor('C:/GitHub/Other', 'opencode')).toBe('C:/GitHub/Other/.worktrees/opencode')
    expect(worktreeFor('C:\\GitHub\\Other\\', 'opencode')).toBe('C:\\GitHub\\Other\\.worktrees\\opencode')
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
    writeFileSync(join(path, 'readme.txt'), 'changed\n')
    expect(() => worktreePlan(project, 'opencode')).toThrow(`The worktree ${path} has uncommitted changes. Commit or discard them first.`)
    expect(() => prepareWorktree(project, 'opencode')).toThrow(path)
    git(path, ['checkout', '--', 'readme.txt'])
    expect(prepareWorktree(project, 'opencode')).toEqual({ path, made: false })
  })

  it('refuses a worktree that belongs to another project', () => {
    const base = tempDir()
    const project = initRepo(base)
    const other = initRepo(base, 'Other2')
    const path = worktreeFor(project, 'opencode')
    git(other, ['worktree', 'add', '--detach', path, 'HEAD'])
    expect(() => worktreePlan(project, 'opencode')).toThrow(`The worktree ${path} belongs to another project.`)
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
  it('prints the worktree, the queue branch and the task, and creates nothing', async () => {
    const base = tempDir()
    const project = initRepo(base)
    const path = worktreeFor(project, 'opencode')
    const result = await runLane(['opencode', '--project', project, '--task', 'Fix it.', '--worktree', '--dry-run'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`worktree: ${path}`)
    expect(result.stdout).toContain('worktree: would be made')
    expect(result.stdout).toContain('branch: machineroom/queue-opencode-')
    expect(result.stdout).toContain('1. Fix it.')
    expect(result.stdout).not.toContain('cwd:')
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
    expect(result.stdout).toContain('branch: machineroom/queue-opencode-')
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

describe('run-lane --worktree with one task', { timeout: 30000 }, () => {
  it('commits the task on a queue branch and writes that branch to the record', async () => {
    const base = tempDir()
    const project = initRepo(base)
    copyFileSync(FAKE_LANE, join(project, 'run'))
    writeFileSync(join(project, 'package.json'), `${JSON.stringify({ scripts: { test: 'node --version' } })}\n`)
    git(project, ['add', '-A'])
    git(project, ['commit', '-q', '-m', 'Add the fake lane'])
    const head = git(project, ['rev-parse', 'HEAD']).trim()
    const runs = join(base, 'machineroom-runs')
    mkdirSync(runs)
    const lanesFile = join(base, 'lanes.json')
    writeFileSync(lanesFile, `${JSON.stringify({
      opencode: {
        name: 'Fake lane',
        harness: 'OpenCode',
        cli: { harness: 'opencode', bin: process.execPath, model: 'opencode/fake' },
      },
    }, null, 2)}\n`)

    const result = await runLane(
      ['opencode', '--project', project, '--task', 'Write the lane note.', '--worktree'],
      { TEMP: base, MACHINEROOM_RUNS: runs, MACHINEROOM_LANES_FILE: lanesFile }
    )
    expect(result.code).toBe(0)
    const path = worktreeFor(project, 'opencode')
    const branch = git(path, ['branch', '--show-current']).trim()
    expect(branch.startsWith('machineroom/queue-opencode-')).toBe(true)
    expect(git(path, ['rev-list', '--count', `${head}..HEAD`]).trim()).toBe('1')
    expect(git(path, ['status', '--porcelain']).trim()).toBe('')
    expect(git(path, ['show', '--format=', '--name-only', 'HEAD']).trim()).toBe('lane-note.txt')
    expect(result.stdout).toContain(`The worktree ${path} stays on ${branch}.`)
    expect(git(project, ['branch', '--show-current']).trim()).toBe('main')

    const record = JSON.parse(readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim())
    expect(record.branch).toBe(branch)
    expect(record.queue).toBe(branch)
    expect(record.queueIndex).toBe(1)
    expect(cleanPath(record.project)).toBe(cleanPath(path))
    expect(record.task).toBe('Write the lane note.')
  })
})

describe('the worktree project lock', () => {
  it('locks the worktree folder, so a project lock does not stop it', async () => {
    const base = tempDir()
    const project = initRepo(base)
    const path = prepareWorktree(project, 'opencode').path
    writeFileSync(join(path, 'readme.txt'), 'changed\n')
    const runs = join(base, 'machineroom-runs')
    mkdirSync(runs)
    const lock = takeProjectLock(runs, project)
    try {
      const result = await runLane(['opencode', '--project', project, '--task', 'Fix it.', '--worktree'], { TEMP: base })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(`The worktree ${path} has uncommitted changes.`)
      expect(result.stderr).not.toContain('Another run is already going on')
    } finally {
      releaseLaneLock(lock)
    }
  })

  it('refuses a worktree run while its own worktree lock is held', async () => {
    const base = tempDir()
    const project = initRepo(base)
    const path = prepareWorktree(project, 'opencode').path
    const runs = join(base, 'machineroom-runs')
    mkdirSync(runs)
    const lock = takeProjectLock(runs, path)
    try {
      const result = await runLane(['opencode', '--project', project, '--task', 'Fix it.', '--worktree'], { TEMP: base })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(`Another run is already going on ${path};`)
      expect(result.stdout).not.toContain('exit code:')
    } finally {
      releaseLaneLock(lock)
    }
  })
})
