import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createLanesSource, laneAgents } from '../server/lanes-source.js'
import { projectHash } from '../server/active-lanes.js'
import { gitPath } from '../server/programPath.js'
import { releaseLaneLock } from '../scripts/lane-lock.mjs'
import { laneRunRecord, laneStartProblem, laneWorktreeStart, projectLockName, takeProjectLock } from '../scripts/run-lane.mjs'
import {
  childEnvironment,
  commandFor,
  DEFAULT_MINUTES,
  laneLockPids,
  laneStats,
  parseRunArgs,
  pathInside,
  projectProblems,
  runListLine,
  runRecord,
  UNATTENDED_NOTE,
} from '../src/briefs/run.js'
import { buildActivities } from '../src/model/pipeline.js'
import { makeTree } from '../src/model/paths.js'
import { waitFor } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const realLanes = JSON.parse(readFileSync(new URL('../docs/agents/lanes.json', import.meta.url), 'utf8'))
const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const env = { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }
const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    fn()
  }
})

function tempDir(prefix = 'mr-project-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function folderIn(base, name) {
  const dir = join(base, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

function pathKey(value) {
  const resolved = resolve(String(value ?? ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function runLane(args, extra = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [RUN_LANE_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, ...process.env, ...extra },
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

function gitIn(cwd, args) {
  const result = spawnSync(gitPath(), args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${String(result.stderr ?? '').trim()}`)
  return String(result.stdout ?? '').trim()
}

function scratchRepo(base) {
  const worktree = folderIn(base, 'lane')
  gitIn(worktree, ['init'])
  gitIn(worktree, ['config', 'user.name', 'Lane'])
  gitIn(worktree, ['config', 'user.email', 'lane@example.com'])
  gitIn(worktree, ['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(worktree, 'notes.txt'), 'base\n')
  gitIn(worktree, ['add', 'notes.txt'])
  gitIn(worktree, ['commit', '-m', 'Base commit'])
  gitIn(worktree, ['branch', '-M', 'main'])
  gitIn(worktree, ['branch', 'stale'])
  return worktree
}

function laneLine(path, id = 'call-1') {
  return JSON.stringify({
    type: 'tool_use',
    timestamp: Date.now(),
    part: { type: 'tool', id, tool: 'read', state: { status: 'completed', input: { path }, output: '' } },
  })
}

function metaPath(logPath) {
  return logPath.replace(/\.log$/i, '.meta.json')
}

function startSource({ runs, projectRoot, lanes, quietMs = 60000, pollMs = 20, repoRoot = projectRoot }) {
  const frames = []
  const source = createLanesSource({
    folder: runs,
    projectRoot,
    repoRoot,
    lanes,
    quietMs,
    pollMs,
    onFrame: (frame) => frames.push(frame),
  })
  cleanups.push(() => source.stop())
  source.start()
  return { source, frames }
}

function logFrames(frames) {
  return frames.filter((frame) => frame.type === 'heartbeat.run.log')
}

describe('parseRunArgs for another project', () => {
  it('takes a folder with task text instead of a brief id', () => {
    expect(parseRunArgs(['opencode', '--project', 'C:\\GitHub\\Other', '--task', 'Fix the test.'])).toEqual({
      lane: 'opencode', briefs: [], dryRun: false, minutes: DEFAULT_MINUTES, list: false, project: 'C:\\GitHub\\Other', task: 'Fix the test.',
    })
    expect(parseRunArgs(['opencode', '--project=C:\\GitHub\\Other', '--task=Fix it.', '--allow-dirty'])).toMatchObject({
      project: 'C:\\GitHub\\Other', task: 'Fix it.', allowDirty: true,
    })
  })

  it('takes a task file instead of task text', () => {
    expect(parseRunArgs(['opencode', '--project', 'C:\\GitHub\\Other', '--task-file', 'task.md'])).toMatchObject({
      project: 'C:\\GitHub\\Other', taskFile: 'task.md',
    })
  })

  it('refuses a brief id and a project together', () => {
    expect(() => parseRunArgs(['opencode', 'T2', '--project', 'C:\\GitHub\\Other', '--task', 'Fix it.']))
      .toThrow('Name a brief id or a --project folder, not both.')
  })

  it('refuses a missing folder, task or task file', () => {
    expect(() => parseRunArgs(['opencode', '--project'])).toThrow('--project needs a folder.')
    expect(() => parseRunArgs(['opencode', '--project', 'C:\\GitHub\\Other'])).toThrow('Name the task with --task or --task-file.')
    expect(() => parseRunArgs(['opencode', '--task', 'Fix it.'])).toThrow('--project needs a folder.')
    expect(() => parseRunArgs(['opencode', '--project', 'C:\\GitHub\\Other', '--task-file'])).toThrow('--task-file needs a path.')
  })

  it('refuses task text and a task file together', () => {
    expect(() => parseRunArgs(['opencode', '--project', 'C:\\GitHub\\Other', '--task', 'Fix it.', '--task-file', 'task.md']))
      .toThrow('Use --task or --task-file, not both.')
  })
})

describe('commandFor on another project', () => {
  it('uses the project folder as the working folder', () => {
    const project = 'C:\\GitHub\\Other'
    const command = commandFor({ lane: realLanes.opencode, prompt: 'Do it.', env, title: 'opencode-project-1', cwd: project })
    expect(command.cwd).toBe(project)
    expect(command.args).toContain('opencode-go/deepseek-v4.1-flash#max')
  })

  it('needs no lane worktree when the project folder is given', () => {
    const lane = { ...realLanes.opencode, worktree: '' }
    expect(commandFor({ lane, prompt: 'Do it.', env, title: 'opencode-project-1', cwd: 'C:\\GitHub\\Other' }).cwd)
      .toBe('C:\\GitHub\\Other')
  })

  it('keeps the lane worktree when no folder is given', () => {
    expect(commandFor({ lane: realLanes.opencode, prompt: 'Do it.', env, title: 'opencode-1' }).cwd)
      .toBe(realLanes.opencode.worktree)
  })
})

describe('projectProblems', () => {
  const base = 'C:\\GitHub'
  const root = `${base}\\MachineRoom-opencode`
  const main = `${base}\\MachineRoom`

  it('refuses this checkout, the main checkout and a lane worktree', () => {
    expect(projectProblems({ project: root, root, mainCheckout: main, lanes: realLanes }))
      .toEqual([`The project folder ${root} is this checkout. Run on another project.`])
    expect(projectProblems({ project: main, root, mainCheckout: main, lanes: realLanes }))
      .toEqual([`The project folder ${main} is this checkout. Run on another project.`])
    const lanes = { opencode3: { worktree: `${base}\\MachineRoom-opencode3` } }
    expect(projectProblems({ project: `${base}\\MachineRoom-opencode3`, root, mainCheckout: main, lanes }))
      .toEqual([`The project folder ${base}\\MachineRoom-opencode3 is the opencode3 lane worktree. Run on another project.`])
  })

  it('refuses a folder that holds this checkout or a lane worktree', () => {
    expect(projectProblems({ project: base, root, mainCheckout: main, lanes: realLanes }))
      .toEqual([`The project folder ${base} holds this checkout. Name one project folder, not a folder of projects.`])
    const lanes = { far: { worktree: 'D:\\lanes\\far' } }
    expect(projectProblems({ project: 'D:\\lanes', root, mainCheckout: main, lanes }))
      .toEqual(['The project folder D:\\lanes is the far lane worktree. Run on another project.'])
    expect(projectProblems({ project: `${base}\\Other`, root, mainCheckout: main, lanes })).toEqual([])
  })

  it('refuses a dirty git folder unless the run allows it', () => {
    const project = `${base}\\Other`
    expect(projectProblems({ project, root, mainCheckout: main, lanes: realLanes, dirty: true }))
      .toEqual([`The project folder ${project} has uncommitted changes. Commit or discard them, or pass --allow-dirty.`])
    expect(projectProblems({ project, root, mainCheckout: main, lanes: realLanes, dirty: true, allowDirty: true })).toEqual([])
    expect(projectProblems({ project, root, mainCheckout: main, lanes: realLanes, dirty: false })).toEqual([])
  })

  it('takes a plain folder', () => {
    expect(projectProblems({ project: `${base}\\Other`, root, mainCheckout: main, lanes: realLanes })).toEqual([])
  })

  it('compares a folder without case on Windows', () => {
    if (process.platform !== 'win32') return
    expect(pathInside(root.toUpperCase(), root.toLowerCase())).toBe(true)
  })

  it('refuses a git checkout that shares this repository', () => {
    const project = 'C:\\src\\clone'
    const common = 'C:\\GitHub\\MachineRoom\\.git'
    expect(projectProblems({ project, root, mainCheckout: main, lanes: realLanes, commonDir: common, repoCommonDir: common }))
      .toEqual([`The project folder ${project} is a git checkout of this repository. Run on another project.`])
    expect(projectProblems({ project, root, mainCheckout: main, lanes: realLanes, commonDir: 'C:\\src\\clone\\.git', repoCommonDir: common }))
      .toEqual([])
  })

  it('refuses the user profile, the OS temp folder and the runs folder', () => {
    const home = 'C:\\Users\\me'
    const temp = 'C:\\Users\\me\\AppData\\Local\\Temp'
    const runs = `${temp}\\machineroom-runs`
    const data = { root, mainCheckout: main, lanes: realLanes, home, temp, runs }

    expect(projectProblems({ ...data, project: home }))
      .toEqual([`The project folder ${home} is the user profile. Run on another project.`])
    expect(projectProblems({ ...data, project: 'C:\\Users' }))
      .toEqual(['The project folder C:\\Users holds the user profile. Name one project folder, not a folder of profiles.'])
    expect(projectProblems({ ...data, project: temp }))
      .toEqual([`The project folder ${temp} is the OS temp folder. Run on another project.`])
    expect(projectProblems({ ...data, project: runs }))
      .toEqual([`The project folder ${runs} is the runs folder or inside it. Run on another project.`])
    expect(projectProblems({ ...data, project: `${runs}\\opencode-20261024-120000` }))
      .toEqual([`The project folder ${runs}\\opencode-20261024-120000 is the runs folder or inside it. Run on another project.`])
  })

  it('allows a folder inside the user profile and inside the temp folder', () => {
    const home = 'C:\\Users\\me'
    const temp = 'C:\\Users\\me\\AppData\\Local\\Temp'
    const runs = `${temp}\\machineroom-runs`
    const data = { root, mainCheckout: main, lanes: realLanes, home, temp, runs }

    expect(projectProblems({ ...data, project: `${home}\\Documents\\Other` })).toEqual([])
    expect(projectProblems({ ...data, project: `${temp}\\Other` })).toEqual([])
  })
})

describe('childEnvironment', () => {
  it('sets PWD and removes OLDPWD and INIT_CWD', () => {
    const child = childEnvironment({ PWD: 'C:\\old', OLDPWD: 'C:\\older', INIT_CWD: 'C:\\init', PATH: 'C:\\bin' }, 'C:\\new')
    expect(child).toEqual({ PWD: 'C:\\new', PATH: 'C:\\bin' })
  })

  it('leaves no PWD when the run has no folder', () => {
    expect(childEnvironment({ PWD: 'C:\\old', OLDPWD: 'C:\\older' }, '')).toEqual({})
  })
})

describe('scripts/run-lane.mjs on another project', () => {
  it('refuses a folder that does not exist', async () => {
    const folder = tempDir()
    const result = await runLane(['opencode', '--project', join(folder, 'missing'), '--task', 'Fix it.', '--dry-run'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('does not exist')
    expect(result.stdout).not.toContain('cwd:')
  })

  it('refuses this checkout', async () => {
    const result = await runLane(['opencode', '--project', REPO_ROOT, '--task', 'Fix it.', '--dry-run'])
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('is this checkout')
    expect(result.stdout).not.toContain('cwd:')
  })

  it('refuses a junction to this checkout', async (context) => {
    const base = tempDir()
    const link = join(base, 'repo-link')
    try {
      symlinkSync(REPO_ROOT, link, 'junction')
    } catch {
      context.skip()
      return
    }
    const result = await runLane(['opencode', '--project', link, '--task', 'Fix it.', '--dry-run'])
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('is this checkout')
    expect(result.stdout).not.toContain('cwd:')
  })

  it('refuses the OS temp folder and the runs folder', async () => {
    const base = tempDir()
    const home = resolve(homedir())
    const temp = resolve(tmpdir())

    const atHome = await runLane(['opencode', '--project', home, '--task', 'Fix it.', '--dry-run'])
    expect(atHome.code).toBe(1)
    expect(atHome.stdout).toMatch(/is the user profile|holds the user profile|holds this checkout/)
    expect(atHome.stdout).not.toContain('cwd:')

    const atTemp = await runLane(['opencode', '--project', temp, '--task', 'Fix it.', '--dry-run'])
    expect(atTemp.code).toBe(1)
    expect(atTemp.stdout).toContain('is the OS temp folder')
    expect(atTemp.stdout).not.toContain('cwd:')

    const runs = join(base, 'machineroom-runs')
    mkdirSync(runs, { recursive: true })
    const atRuns = await runLane(['opencode', '--project', runs, '--task', 'Fix it.', '--dry-run'], { TEMP: base, MACHINEROOM_RUNS: runs })
    expect(atRuns.code).toBe(1)
    expect(atRuns.stdout).toContain('is the runs folder or inside it')
    expect(atRuns.stdout).not.toContain('cwd:')
  })

  it('refuses a dirty git folder and runs it with --allow-dirty', async () => {
    const base = tempDir()
    const project = folderIn(base, 'Other')
    const init = spawnSync(gitPath(), ['init'], { cwd: project, encoding: 'utf8', windowsHide: true })
    expect(init.status).toBe(0)
    writeFileSync(join(project, 'notes.txt'), 'uncommitted\n')

    const refused = await runLane(['opencode', '--project', project, '--task', 'Fix it.'])
    expect(refused.code).toBe(1)
    expect(refused.stdout).toContain('has uncommitted changes')
    expect(refused.stdout).toContain('--allow-dirty')

    const allowed = await runLane(['opencode', '--project', project, '--task', 'Fix it.', '--allow-dirty', '--dry-run'])
    expect(allowed.code).toBe(0)
    const cwd = allowed.stdout.split(/\r?\n/).find((line) => line.startsWith('cwd: '))
    expect(pathKey(cwd.slice('cwd: '.length))).toBe(pathKey(project))
  })

  it('reads the task from a UTF-8 file', async () => {
    const base = tempDir()
    const project = folderIn(base, 'Other')
    const task = 'Réparer le test.'
    const taskFile = join(base, 'task.md')
    writeFileSync(taskFile, task, 'utf8')
    const result = await runLane(['opencode', '--project', project, '--task-file', taskFile, '--dry-run'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`<prompt: ${task.length + 2 + UNATTENDED_NOTE.length} characters>`)
  })

  it('refuses a brief id and a project together before it prints a command', async () => {
    const base = tempDir()
    const project = folderIn(base, 'Other')
    const result = await runLane(['opencode', 'T2', '--project', project, '--task', 'Fix it.', '--dry-run'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('not both')
    expect(result.stdout).not.toContain('cwd:')
  })
})

describe('the project lock', () => {
  it('names the lock from a hash of the resolved folder and holds the pid', () => {
    const base = tempDir()
    const project = folderIn(base, 'Other')
    const runs = folderIn(base, 'machineroom-runs')
    const key = process.platform === 'win32' ? resolve(project).toLowerCase() : resolve(project)
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 8)
    const lock = takeProjectLock(runs, project)
    try {
      expect(projectLockName(project)).toBe(`project-${hash}`)
      expect(lock).toBe(join(runs, `project-${hash}.lock`))
      expect(laneLockPids(readFileSync(lock, 'utf8')).pid).toBe(process.pid)
    } finally {
      releaseLaneLock(lock)
    }
    expect(existsSync(lock)).toBe(false)
  })

  it('refuses a second run on the same project before it starts', async () => {
    const base = tempDir()
    const project = folderIn(base, 'Other')
    const runs = folderIn(base, 'machineroom-runs')
    const lock = takeProjectLock(runs, project)
    try {
      const result = await runLane(['opencode', '--project', project, '--task', 'Fix it.'], { TEMP: base, MACHINEROOM_RUNS: runs })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(`Another run is already going on ${project};`)
      expect(result.stdout).not.toContain('exit code:')
    } finally {
      releaseLaneLock(lock)
    }
  })
})

describe('the record of a project run', () => {
  it('writes project, task, no briefs and the usual fields to runs.jsonl', () => {
    const base = tempDir()
    const runs = folderIn(base, 'machineroom-runs')
    const project = folderIn(base, 'Other')
    const task = `Fix the test. ${'More detail. '.repeat(30)}`.trim()
    const record = runRecord({
      lane: 'opencode',
      briefs: [],
      model: 'opencode-go/deepseek-v4.1-flash',
      reasoning: 'max',
      startedAt: '2026-10-24T12:00:00.000Z',
      minutes: 1.2,
      exitCode: 0,
      killed: false,
      costUsd: 0.01,
      log: join(runs, 'opencode-project-20261024-120000.log'),
      branch: '',
      commits: [],
      project,
      task,
    })
    appendFileSync(join(runs, 'runs.jsonl'), `${JSON.stringify(record)}\n`)
    const written = JSON.parse(readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim())
    expect(written).toMatchObject({
      lane: 'opencode',
      briefs: [],
      project,
      task: task.slice(0, 200),
      log: join(runs, 'opencode-project-20261024-120000.log'),
      branch: '',
      commits: [],
    })
    expect(written.task).toHaveLength(200)
    expect(Object.keys(written)).toEqual([
      'lane', 'briefs', 'model', 'reasoning', 'startedAt', 'minutes', 'exitCode', 'killed', 'costUsd', 'inputTokens', 'outputTokens', 'log', 'branch', 'commits', 'project', 'task',
    ])
    expect(runListLine(written)).toContain('none')
    expect(laneStats([written]).rows[0]).toMatchObject({ lane: 'opencode', runs: 1 })
  })

  it('writes the queue branch to branch as well as queue', () => {
    const branch = 'machineroom/queue-opencode-20261024-120000'
    const record = runRecord({
      lane: 'opencode',
      briefs: [],
      model: 'opencode-go/deepseek-v4.1-flash',
      exitCode: 0,
      branch: '',
      queue: { branch, index: 2 },
    })
    expect(record.branch).toBe(branch)
    expect(record.queue).toBe(branch)
    expect(record.queueIndex).toBe(2)
    expect(runListLine(record)).toContain(branch)
  })

  it('masks a key in the task before it stores it', () => {
    const key = `sk-${'a'.repeat(32)}`
    const record = runRecord({ lane: 'opencode', briefs: [], task: `Use OPENROUTER_API_KEY=${key} and report.` })
    expect(record.task).not.toContain(key)
    expect(record.task).toContain('OPENROUTER_API_KEY=[key]')
    const written = JSON.parse(JSON.stringify(record))
    expect(written.task).toBe(record.task)
  })

  it('still lists a project run with --list and --stats', async () => {
    const base = tempDir()
    const runs = folderIn(base, 'machineroom-runs')
    const project = folderIn(base, 'Other')
    const record = runRecord({
      lane: 'opencode',
      briefs: [],
      model: 'opencode-go/deepseek-v4.1-flash',
      startedAt: '2026-10-24T12:00:00.000Z',
      minutes: 1.2,
      exitCode: 0,
      killed: false,
      log: join(runs, 'opencode-project-20261024-120000.log'),
      project,
      task: 'Fix it.',
    })
    appendFileSync(join(runs, 'runs.jsonl'), `${JSON.stringify(record)}\n`)

    const list = await runLane(['--list'], { TEMP: base, MACHINEROOM_RUNS: runs })
    expect(list.code).toBe(0)
    expect(list.stdout).toContain('opencode')
    expect(list.stdout).toContain('none')

    const stats = await runLane(['--stats'], { TEMP: base, MACHINEROOM_RUNS: runs })
    expect(stats.code).toBe(0)
    expect(stats.stdout).toContain('opencode | opencode-go/deepseek-v4.1-flash | 1 run')
  })
})

describe('a lane starts from the default branch', () => {
  it('moves a worktree on a stale branch with no commits ahead to main before a run uses it', () => {
    const worktree = scratchRepo(tempDir())
    const mainHead = gitIn(worktree, ['rev-parse', 'refs/heads/main'])
    gitIn(worktree, ['switch', 'stale'])

    const start = laneWorktreeStart({ worktree, move: true })

    expect(start).toEqual({ from: 'stale', startBranch: 'main', moved: true })
    expect(gitIn(worktree, ['branch', '--show-current'])).toBe('')
    expect(gitIn(worktree, ['rev-parse', 'HEAD'])).toBe(mainHead)
    expect(gitIn(worktree, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('HEAD')
  })

  it('refuses a worktree on a branch one commit ahead and leaves that work alone', () => {
    const worktree = scratchRepo(tempDir())
    gitIn(worktree, ['switch', '-c', 'feat/another-lane'])
    writeFileSync(join(worktree, 'another.txt'), 'another lane\n')
    gitIn(worktree, ['add', 'another.txt'])
    gitIn(worktree, ['commit', '-m', 'Another lane work'])
    const commit = gitIn(worktree, ['log', '--oneline', 'refs/heads/main..HEAD'])

    let message = ''
    try {
      laneWorktreeStart({ worktree, move: true })
    } catch (error) {
      message = String(error?.message ?? error)
    }
    expect(message).toBe(`The worktree ${worktree} is on the branch feat/another-lane with 1 commit that refs/heads/main does not have (${commit}), so merge it or move the worktree to refs/heads/main first.`)
    expect(gitIn(worktree, ['branch', '--show-current'])).toBe('feat/another-lane')
    expect(gitIn(worktree, ['rev-parse', '--short', 'HEAD'])).toBe(commit.split(' ')[0])
  })

  it('names the branch and the commits in the refusal', () => {
    expect(laneStartProblem({ worktree: 'C:\\lane', branch: 'feat/x', count: 1, commits: ['abc1234 Keep this work'] }))
      .toBe('The worktree C:\\lane is on the branch feat/x with 1 commit that refs/heads/main does not have (abc1234 Keep this work), so merge it or move the worktree to refs/heads/main first.')
    expect(laneStartProblem({ worktree: 'C:\\lane', branch: '', count: 2, commits: ['abc1234 One', 'def5678 Two'] }))
      .toBe('The worktree C:\\lane is on a detached HEAD with 2 commits that refs/heads/main does not have (abc1234 One, def5678 Two), so merge it or move the worktree to refs/heads/main first.')
    expect(laneStartProblem({ worktree: 'C:\\lane', branch: 'feat/x', count: 0, commits: [] })).toBe('')
  })

  it('carries the starting branch in the record, beside the branch the run ended on', () => {
    const record = laneRunRecord({
      lane: 'opencode',
      briefs: ['U74'],
      model: 'opencode-go/deepseek-v4.1-flash',
      startedAt: '2026-10-28T10:00:00.000Z',
      minutes: 1,
      exitCode: 0,
      killed: false,
      log: null,
      branch: 'feat/u74-a-lane-starts',
      commits: ['abc1234 Start from main'],
      startBranch: 'main',
    })
    expect(record.startBranch).toBe('main')
    expect(record.branch).toBe('feat/u74-a-lane-starts')
    expect(runListLine(record)).toContain('feat/u74-a-lane-starts')
    expect(laneRunRecord({ lane: 'opencode', briefs: [] })).not.toHaveProperty('startBranch')
  })
})

describe('the lane source on another project', () => {
  it('shows a meta-file run for the room root with its paths kept', async () => {
    const base = tempDir()
    const runs = folderIn(base, 'runs')
    const projectRoot = folderIn(base, 'Other')
    const worktree = folderIn(base, 'MachineRoom-opencode3')
    const lanes = { ...realLanes, opencode: { ...realLanes.opencode, worktree } }
    const logPath = join(runs, 'opencode-project-20261024-120000.log')
    const inProject = laneLine(`${projectRoot}\\src\\a.js`, 'call-1')
    const inWorktree = laneLine(`${worktree}\\src\\b.js`, 'call-2')
    writeFileSync(logPath, `${inProject}\n${inWorktree}\n`)
    writeFileSync(metaPath(logPath), `${JSON.stringify({ lane: 'opencode', project: projectRoot })}\n`)

    const { frames } = startSource({ runs, projectRoot, lanes })
    await waitFor(() => logFrames(frames).length === 2, { what: 'both project lines' })
    const chunks = logFrames(frames).map((frame) => frame.payload.chunk)
    expect(chunks[0]).toBe(`${inProject}\n`)
    expect(chunks[1]).toBe(`${inWorktree}\n`)

    const agents = laneAgents(lanes).filter((agent) => agent.key === 'opencode')
    const tree = makeTree({ root: basename(projectRoot), files: [] })
    const activities = buildActivities(frames, { agents, tree })
    const started = activities.filter((activity) => activity.type === 'tool.start' && activity.touches?.length > 0)
    expect(started.map((activity) => activity.touches[0].path)).toEqual(['src/a.js'])
  })

  it('skips a meta-file log for another folder and still shows the next one', async () => {
    const base = tempDir()
    const runs = folderIn(base, 'runs')
    const projectRoot = folderIn(base, 'Other')
    const elsewhere = folderIn(base, 'Elsewhere')
    const lanes = { ...realLanes, opencode: { ...realLanes.opencode, worktree: folderIn(base, 'MachineRoom-opencode3') } }

    const skipped = join(runs, 'opencode-project-20261024-120000.log')
    writeFileSync(skipped, `${laneLine(`${elsewhere}\\src\\a.js`)}\n`)
    writeFileSync(metaPath(skipped), `${JSON.stringify({ lane: 'opencode', project: elsewhere })}\n`)

    const { source, frames } = startSource({ runs, projectRoot, lanes })
    source.tick()
    expect(logFrames(frames)).toHaveLength(0)

    const shown = join(runs, 'opencode-project-20261024-121000.log')
    writeFileSync(shown, `${laneLine(`${projectRoot}\\src\\b.js`)}\n`)
    writeFileSync(metaPath(shown), `${JSON.stringify({ lane: 'opencode', project: projectRoot })}\n`)
    await waitFor(() => logFrames(frames).length === 1, { what: 'the shown log' })
    expect(logFrames(frames)[0].payload.chunk).toContain('b.js')
  })

  it('keeps a meta-file run whose project differs only by case on Windows', async () => {
    if (process.platform !== 'win32') return
    const base = tempDir()
    const runs = folderIn(base, 'runs')
    const projectRoot = folderIn(base, 'Other')
    const lanes = { ...realLanes, opencode: { ...realLanes.opencode, worktree: folderIn(base, 'MachineRoom-opencode3') } }
    const logPath = join(runs, 'opencode-project-20261024-122000.log')
    writeFileSync(logPath, `${laneLine(`${projectRoot}\\src\\a.js`)}\n`)
    writeFileSync(metaPath(logPath), `${JSON.stringify({ lane: 'opencode', project: projectRoot.toUpperCase() })}\n`)

    const { frames } = startSource({ runs, projectRoot, lanes })
    await waitFor(() => logFrames(frames).length === 1, { what: 'the case-insensitive log' })
    expect(logFrames(frames)).toHaveLength(1)
    expect(logFrames(frames)[0].payload.chunk).toContain('a.js')
  })

  it('lists the lanes when the project root has no lanes.json', () => {
    const base = tempDir()
    const runs = folderIn(base, 'runs')
    const projectRoot = folderIn(base, 'NoLanes')
    const source = createLanesSource({ folder: runs, projectRoot, pollMs: 20 })
    cleanups.push(() => source.stop())
    expect(source.agents.map((agent) => agent.key)).toEqual(['orchestrator'])
    writeFileSync(
      join(runs, `active-lanes-${projectHash(projectRoot)}.json`),
      JSON.stringify(Object.keys(realLanes).filter((k) => k !== 'orchestrator'))
    )
    expect(source.agents.map((agent) => agent.key)).toEqual(laneAgents(realLanes).map((agent) => agent.key))
    expect(source.agents.length).toBeGreaterThan(0)
  })
})
