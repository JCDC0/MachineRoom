import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { commitMessage, formatQueueSummary, parseQueue, parseQueueArgs, runQueue } from '../src/briefs/queue.js'
import { gitPath } from '../server/programPath.js'
import { releaseLaneLock } from '../scripts/lane-lock.mjs'
import { takeProjectLock } from '../scripts/run-lane.mjs'
import { killTree } from '../server/processTree.js'
import { makeTempDir, processTempRoot, removeTempDir } from './helpers/tempRoot.js'

const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const QUEUE_BRANCH = 'machineroom/queue-opencode-20261024-120000'
const NO_GIT_CONFIG = join(processTempRoot(), 'no-git-config')
let templateCleanup = null
const GIT_ENV = {
  GIT_CONFIG_SYSTEM: NO_GIT_CONFIG,
  GIT_CONFIG_GLOBAL: NO_GIT_CONFIG,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'commit.gpgsign',
  GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'core.autocrlf',
  GIT_CONFIG_VALUE_1: 'false',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'MachineRoom Queue',
  GIT_AUTHOR_EMAIL: 'queue@example.com',
  GIT_COMMITTER_NAME: 'MachineRoom Queue',
  GIT_COMMITTER_EMAIL: 'queue@example.com',
}

function git(folder, args) {
  const result = spawnSync(gitPath(), args, {
    cwd: folder,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...GIT_ENV },
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').trim()
    if (stderr !== '') throw new Error(stderr)
    throw new Error(`git ${args.join(' ')} failed in ${folder} with exit ${result.status} and signal ${result.signal ?? 'none'}.`)
  }
  return String(result.stdout ?? '')
}

function initRepo(parent) {
  const folder = join(parent, 'project')
  cpSync(TEMPLATE_REPO, folder, { recursive: true })
  return folder
}

function queueTemplate() {
  const base = makeTempDir('machine-room-queue-template-')
  templateCleanup = () => removeTempDir(base)
  const folder = join(base, 'project')
  mkdirSync(folder)
  git(folder, ['init', '-b', 'main'])
  writeFileSync(join(folder, 'readme.txt'), 'start\n')
  git(folder, ['add', '-A'])
  git(folder, ['commit', '-m', 'start'])
  return folder
}

const TEMPLATE_REPO = queueTemplate()

afterAll(() => {
  templateCleanup?.()
  templateCleanup = null
})

function adapter(folder, branch = QUEUE_BRANCH, lane = 'opencode') {
  return {
    branch,
    lane,
    exists: (name) => {
      const result = spawnSync(gitPath(), ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], {
        cwd: folder,
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, ...GIT_ENV },
      })
      return result.status === 0
    },
    create: (name) => {
      git(folder, ['switch', '-c', name])
    },
    status: () => git(folder, ['status', '--porcelain']),
    add: () => {
      git(folder, ['add', '-A'])
    },
    commit: (message) => {
      git(folder, ['commit', '-m', message])
      return git(folder, ['rev-parse', '--short', 'HEAD']).trim()
    },
  }
}

function remove(folder) {
  removeTempDir(folder)
}

function runLane(args, extra = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [RUN_LANE_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ...GIT_ENV, ...extra },
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, 25000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      rejectRun(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        rejectRun(new Error(`run-lane did not exit. stderr: ${stderr}`))
        return
      }
      resolveRun({ code, stdout, stderr })
    })
  })
}

describe('parseQueue', () => {
  it('reads tasks separated by a line that holds only ---', () => {
    expect(parseQueue('First task.\n---\nSecond task.\n')).toEqual(['First task.', 'Second task.'])
    expect(parseQueue('  ---\r\nOnly one.  \r\n')).toEqual(['Only one.'])
  })

  it('trims each task and drops empty ones', () => {
    expect(parseQueue('\n\n  One\n line  \n---\n\n---\n  \n---\nTwo  \n\n')).toEqual(['One\n line', 'Two'])
  })

  it('keeps a dash line that is not a separator inside a task', () => {
    expect(parseQueue('Run this\n--\nand that')).toEqual(['Run this\n--\nand that'])
    expect(parseQueue('Run this\n----\nand that')).toEqual(['Run this\n----\nand that'])
  })

  it('gives an empty list for a file with no tasks', () => {
    expect(parseQueue('')).toEqual([])
    expect(parseQueue('---\n---\n')).toEqual([])
  })

  it('takes 20 tasks and refuses 21', () => {
    const twenty = Array.from({ length: 20 }, (_, index) => `Task ${index + 1}.`).join('\n---\n')
    expect(parseQueue(twenty)).toHaveLength(20)
    expect(() => parseQueue(`${twenty}\n---\nTask 21.`)).toThrow('A queue holds at most 20 tasks.')
  })

  it('takes a task of 4000 characters and refuses 4001', () => {
    expect(parseQueue('x'.repeat(4000))).toEqual(['x'.repeat(4000)])
    expect(() => parseQueue('x'.repeat(4001))).toThrow('Write each task in 1 to 4000 characters.')
  })
})

describe('commitMessage', () => {
  it('builds a subject from the first line and a body with the position', () => {
    expect(commitMessage('Add the parser\nMore detail.', 2, 5, 'opencode')).toBe(
      'Add the parser\n\nTask 2 of 5, run by MachineRoom on the opencode lane.'
    )
  })

  it('cuts the subject to 72 characters', () => {
    const message = commitMessage(`${'a'.repeat(100)}\nMore detail.`, 1, 1, 'hermes')
    expect(message.split('\n')[0]).toBe('a'.repeat(72))
    expect(message).toContain('Task 1 of 1, run by MachineRoom on the hermes lane.')
  })
})

describe('parseQueueArgs', () => {
  it('is not a queue command without --queue', () => {
    expect(parseQueueArgs(['opencode', 'S8'])).toBeNull()
    expect(parseQueueArgs(['opencode', '--project', 'C:\\work'])).toBeNull()
  })

  it('reads the lane, the project, the file, the test and the minutes', () => {
    expect(parseQueueArgs(['opencode', '--project', 'C:\\work', '--queue', 'queue.txt', '--test', 'npm test', '--minutes', '20'])).toEqual({
      lane: 'opencode', briefs: [], project: 'C:\\work', queue: 'queue.txt', test: 'npm test', dryRun: false, minutes: 20,
    })
    expect(parseQueueArgs(['--queue=queue.txt', '--project=C:\\work', 'opencode', '--dry-run'])).toMatchObject({
      lane: 'opencode', dryRun: true, minutes: 100,
    })
  })

  it('refuses the single task options and a brief id', () => {
    const base = ['opencode', '--project', 'C:\\work', '--queue', 'queue.txt']
    expect(() => parseQueueArgs([...base, '--task', 'One'])).toThrow('Drop --task.')
    expect(() => parseQueueArgs([...base, '--task-file', 'task.md'])).toThrow('Drop --task-file.')
    expect(() => parseQueueArgs([...base, '--allow-dirty'])).toThrow('does not take --allow-dirty')
    expect(() => parseQueueArgs([...base, 'S8'])).toThrow('A queue takes no brief id.')
  })
})

describe('runQueue', { timeout: 30000 }, () => {
  it('commits three tasks on a new branch and leaves main untouched', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const mainSha = git(repo, ['rev-parse', 'refs/heads/main']).trim()
      const result = await runQueue({
        tasks: ['Add one', 'Add two', 'Add three'],
        git: adapter(repo),
        runTask: async (task, number) => {
          writeFileSync(join(repo, `task-${number}.txt`), `${task}\n`)
          return { code: 0 }
        },
        runTests: async () => ({ ok: true }),
      })

      expect(result.branch).toBe(QUEUE_BRANCH)
      expect(result.results.map((item) => item.status)).toEqual(['committed', 'committed', 'committed'])
      expect(git(repo, ['branch', '--show-current']).trim()).toBe(QUEUE_BRANCH)
      expect(git(repo, ['rev-parse', 'refs/heads/main']).trim()).toBe(mainSha)
      expect(git(repo, ['rev-list', '--count', `refs/heads/main..refs/heads/${QUEUE_BRANCH}`]).trim()).toBe('3')
      expect(git(repo, ['status', '--porcelain']).trim()).toBe('')
      const log = git(repo, ['log', '--format=%s%n%b%x00', `refs/heads/main..refs/heads/${QUEUE_BRANCH}`])
      expect(log).toContain('Add one')
      expect(log).toContain('Task 1 of 3, run by MachineRoom on the opencode lane.')
      expect(log).toContain('Task 3 of 3, run by MachineRoom on the opencode lane.')
    } finally {
      remove(parent)
    }
  })

  it('notes a task with no change and goes on', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const result = await runQueue({
        tasks: ['Write one', 'Do nothing', 'Write two'],
        git: adapter(repo),
        runTask: async (task, number) => {
          if (number !== 2) writeFileSync(join(repo, `task-${number}.txt`), task)
          return { code: 0 }
        },
        runTests: async () => ({ ok: true }),
      })

      expect(result.results.map((item) => item.status)).toEqual(['committed', 'no change', 'committed'])
      expect(git(repo, ['rev-list', '--count', `refs/heads/main..refs/heads/${QUEUE_BRANCH}`]).trim()).toBe('2')
    } finally {
      remove(parent)
    }
  })

  it('stops on a failed task and leaves its change uncommitted', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const result = await runQueue({
        tasks: ['One', 'Two', 'Three'],
        git: adapter(repo),
        runTask: async (task, number) => {
          writeFileSync(join(repo, `task-${number}.txt`), task)
          return { code: number === 2 ? 3 : 0 }
        },
        runTests: async () => ({ ok: true }),
      })

      expect(result.results.map((item) => item.status)).toEqual(['committed', 'failed: lane exit 3', 'not run'])
      expect(git(repo, ['rev-list', '--count', `refs/heads/main..HEAD`]).trim()).toBe('1')
      expect(git(repo, ['status', '--porcelain'])).toContain('task-2.txt')
    } finally {
      remove(parent)
    }
  })

  it('stops on a killed task and leaves its change uncommitted', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const result = await runQueue({
        tasks: ['One', 'Two'],
        git: adapter(repo),
        runTask: async (task, number) => {
          writeFileSync(join(repo, `task-${number}.txt`), task)
          return { code: null, killed: number === 1 }
        },
        runTests: async () => ({ ok: true }),
      })

      expect(result.results.map((item) => item.status)).toEqual(['failed: lane killed', 'not run'])
      expect(git(repo, ['status', '--porcelain'])).toContain('task-1.txt')
    } finally {
      remove(parent)
    }
  })

  it('stops on a failed test and leaves its change uncommitted', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const result = await runQueue({
        tasks: ['One', 'Two', 'Three'],
        git: adapter(repo),
        runTask: async (task, number) => {
          writeFileSync(join(repo, `task-${number}.txt`), task)
          return { code: 0 }
        },
        runTests: async (task, number) => ({ ok: number !== 2 }),
      })

      expect(result.results.map((item) => item.status)).toEqual(['committed', 'failed: tests', 'not run'])
      expect(git(repo, ['rev-list', '--count', `refs/heads/main..HEAD`]).trim()).toBe('1')
      expect(git(repo, ['status', '--porcelain'])).toContain('task-2.txt')
    } finally {
      remove(parent)
    }
  })

  it('refuses a branch that already exists and runs nothing', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      git(repo, ['branch', QUEUE_BRANCH])
      let ran = false
      await expect(runQueue({
        tasks: ['One'],
        git: adapter(repo),
        runTask: async () => {
          ran = true
          return { code: 0 }
        },
        runTests: async () => ({ ok: true }),
      })).rejects.toThrow(/already exists/)
      expect(ran).toBe(false)
      expect(git(repo, ['branch', '--show-current']).trim()).toBe('main')
    } finally {
      remove(parent)
    }
  })

  it('refuses a dirty start and makes no branch', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      writeFileSync(join(repo, 'untracked.txt'), 'not committed\n')
      await expect(runQueue({
        tasks: ['One'],
        git: adapter(repo),
        runTask: async () => ({ code: 0 }),
        runTests: async () => ({ ok: true }),
      })).rejects.toThrow(/clean start/)
      expect(git(repo, ['branch', '--format=%(refname:short)'])).not.toContain(QUEUE_BRANCH)
      expect(git(repo, ['branch', '--show-current']).trim()).toBe('main')
    } finally {
      remove(parent)
    }
  })
})

describe('formatQueueSummary', () => {
  it('prints the branch, the tests and one line per task', () => {
    expect(formatQueueSummary({
      branch: QUEUE_BRANCH,
      tests: 'npm test',
      results: [
        { number: 1, status: 'committed', sha: 'a1b2c3d' },
        { number: 2, status: 'no change' },
        { number: 3, status: 'failed: tests' },
        { number: 4, status: 'not run' },
      ],
    })).toEqual([
      `branch: ${QUEUE_BRANCH}`,
      '1. committed a1b2c3d',
      '2. no change',
      '3. failed: tests',
      '4. not run',
      'tests: npm test',
      `The project stays on ${QUEUE_BRANCH}. Run git switch - to go back.`,
    ])
  })

  it('says the project has no tests when there is no test command', () => {
    expect(formatQueueSummary({ branch: QUEUE_BRANCH, results: [] }).at(-2)).toBe('tests: none, the project has no tests')
  })

  it('names the worktree and its branch when the branch is in a worktree', () => {
    const worktree = join('C:\\work', 'Other', '.worktrees', 'opencode')
    const lines = formatQueueSummary({ branch: QUEUE_BRANCH, results: [], tests: 'npm test', worktree })
    expect(lines.at(-1)).toBe(`The worktree ${worktree} stays on ${QUEUE_BRANCH}.`)
    expect(lines.join('\n')).not.toContain('git switch -')
  })
})

describe('scripts/run-lane.mjs with --queue', { timeout: 30000 }, () => {
  it('prints the tasks, the branch and the test command with --dry-run and changes nothing', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'First task.\n---\nSecond task.\n')
      const result = await runLane(['opencode', '--project', repo, '--queue', file, '--dry-run'])
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('branch: machineroom/queue-opencode-')
      expect(result.stdout).toContain('tests: none, the project has no tests')
      expect(result.stdout).toContain('1. First task.')
      expect(result.stdout).toContain('2. Second task.')
      expect(git(repo, ['branch', '--show-current']).trim()).toBe('main')
      expect(git(repo, ['status', '--porcelain']).trim()).toBe('')
    } finally {
      remove(parent)
    }
  })

  it('takes npm test from the project package.json', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ scripts: { test: 'node test.mjs' } })}\n`)
      git(repo, ['add', '-A'])
      git(repo, ['commit', '-m', 'Add the test script'])
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'Only task.\n')
      const result = await runLane(['opencode', '--project', repo, '--queue', file, '--dry-run'])
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('tests: npm test')
    } finally {
      remove(parent)
    }
  })

  it('refuses --queue with a task, a task file, --allow-dirty or a brief id', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'One task.\n')
      const base = ['opencode', '--project', repo, '--queue', file, '--dry-run']
      const task = await runLane([...base, '--task', 'One task.'])
      expect(task.code).toBe(1)
      expect(task.stderr).toContain('Drop --task.')
      expect(task.stdout).not.toContain('branch:')
      const taskFile = await runLane([...base, '--task-file', file])
      expect(taskFile.code).toBe(1)
      expect(taskFile.stderr).toContain('Drop --task-file.')
      const dirty = await runLane([...base, '--allow-dirty'])
      expect(dirty.code).toBe(1)
      expect(dirty.stderr).toContain('does not take --allow-dirty')
      const brief = await runLane([...base, 'S8'])
      expect(brief.code).toBe(1)
      expect(brief.stderr).toContain('A queue takes no brief id.')
      expect(git(repo, ['branch', '--show-current']).trim()).toBe('main')
    } finally {
      remove(parent)
    }
  })

  it('refuses a queue on a folder that is not a git checkout', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const folder = join(parent, 'Plain')
      mkdirSync(folder)
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'One task.\n')
      const result = await runLane(['opencode', '--project', folder, '--queue', file, '--dry-run'])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(`The project folder ${folder} is not a git folder. A queue needs one.`)
      expect(result.stdout).not.toContain('branch:')
    } finally {
      remove(parent)
    }
  })

  it('refuses a queue while another run holds the project', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const runs = join(parent, 'machineroom-runs')
      mkdirSync(runs)
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'One task.\n')
      const lock = takeProjectLock(runs, repo)
      try {
        const result = await runLane(['opencode', '--project', repo, '--queue', file], { TEMP: parent, MACHINEROOM_RUNS: runs })
        expect(result.code).toBe(1)
        expect(result.stderr).toContain(`Another run is already going on ${repo};`)
        expect(git(repo, ['branch', '--show-current']).trim()).toBe('main')
        expect(git(repo, ['status', '--porcelain']).trim()).toBe('')
      } finally {
        releaseLaneLock(lock)
      }
    } finally {
      remove(parent)
    }
  })

  it('refuses a queue with no tasks', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const file = join(parent, 'queue.txt')
      writeFileSync(file, '\n---\n\n')
      const result = await runLane(['opencode', '--project', repo, '--queue', file, '--dry-run'])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('The queue file has no tasks.')
    } finally {
      remove(parent)
    }
  })
})
