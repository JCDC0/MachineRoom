import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { commitAuthorFor, commitMessage, formatQueueSummary, parseQueue, parseQueueArgs, runQueue, QUEUE_SUBJECT_LIMIT, QUEUE_TASK_LIMIT, QUEUE_TASK_TEXT_LIMIT } from '../src/briefs/queue.js'
import { DEFAULT_MINUTES } from '../src/briefs/run.js'
import { harnessByKey } from '../src/harnesses/index.js'
import { gitPath } from '../server/programPath.js'
import { createReviewsApi } from '../server/reviews.js'
import { releaseLaneLock } from '../scripts/lane-lock.mjs'
import { takeProjectLock, printedRunsFolder } from '../scripts/run-lane.mjs'
import { killTree } from '../server/processTree.js'
import { makeTempDir, processTempRoot, removeTempDir } from './helpers/tempRoot.js'

const RUN_LANE_SCRIPT = fileURLToPath(new URL('../scripts/run-lane.mjs', import.meta.url))
const FLEET_DIR = fileURLToPath(new URL('../docs/agents', import.meta.url))
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

function writeFakeLane(folder, files = {}) {
  const writes = Object.entries(files).map(([name, content]) => (
    `writeFileSync(join(process.cwd(), ${JSON.stringify(name)}), ${JSON.stringify(content)})`
  ))
  writeFileSync(join(folder, 'run'), [
    "const { writeFileSync } = require('node:fs')",
    "const { join } = require('node:path')",
    "writeFileSync(join(process.cwd(), 'lane-note.txt'), 'The fake lane wrote this file.\\n')",
    ...writes,
    "console.log(JSON.stringify({ type: 'text', timestamp: Date.now(), sessionID: 'ses_fake_lane', part: { id: 'prt_fake_lane_1', type: 'text', text: 'The fake lane wrote its files.' } }))",
    '',
  ].join('\n'))
}

function fakeLaneFile(parent) {
  const file = join(parent, 'lanes.json')
  writeFileSync(file, `${JSON.stringify({
    fake: {
      name: 'Fake lane',
      harness: 'OpenCode',
      worktree: join(parent, 'worktree'),
      cli: { harness: 'opencode', bin: process.execPath, model: 'opencode/fake' },
    },
  }, null, 2)}\n`)
  return file
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
    head: () => git(folder, ['rev-parse', 'HEAD']).trim(),
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
      env: { ...process.env, ...GIT_ENV, MACHINEROOM_LANES_DIR: FLEET_DIR, ...extra },
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
    const twenty = Array.from({ length: QUEUE_TASK_LIMIT }, (_, index) => `Task ${index + 1}.`).join('\n---\n')
    expect(parseQueue(twenty)).toHaveLength(QUEUE_TASK_LIMIT)
    expect(() => parseQueue(`${twenty}\n---\nTask ${QUEUE_TASK_LIMIT + 1}.`)).toThrow(`A queue holds at most ${QUEUE_TASK_LIMIT} tasks.`)
  })

  it('takes a task of 4000 characters and refuses 4001', () => {
    expect(parseQueue('x'.repeat(QUEUE_TASK_TEXT_LIMIT))).toEqual(['x'.repeat(QUEUE_TASK_TEXT_LIMIT)])
    expect(() => parseQueue('x'.repeat(QUEUE_TASK_TEXT_LIMIT + 1))).toThrow(`Write each task in 1 to ${QUEUE_TASK_TEXT_LIMIT} characters.`)
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
    expect(message.split('\n')[0]).toBe('a'.repeat(QUEUE_SUBJECT_LIMIT))
    expect(message).toContain('Task 1 of 1, run by MachineRoom on the hermes lane.')
  })

  it('ends the message with the harness trailer', () => {
    expect(commitMessage('Add the parser', 1, 1, 'opencode', { label: 'OpenCode', address: 'noreply@opencode.ai', model: 'opencode/fake' })).toBe(
      'Add the parser\n\nTask 1 of 1, run by MachineRoom on the opencode lane.\n\nCo-Authored-By: OpenCode (opencode/fake) <noreply@opencode.ai>'
    )
  })

  it('leaves the trailer off without an author and when the model is unknown', () => {
    expect(commitMessage('Add the parser', 1, 1, 'acp')).toBe('Add the parser\n\nTask 1 of 1, run by MachineRoom on the acp lane.')
    const message = commitMessage('Add the parser', 1, 1, 'opencode', { label: 'OpenCode', address: 'noreply@opencode.ai', model: '' })
    expect(message.endsWith('Co-Authored-By: OpenCode <noreply@opencode.ai>')).toBe(true)
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
      lane: 'opencode', dryRun: true, minutes: DEFAULT_MINUTES,
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

  it('keeps the commit the lane made and records its sha', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      let laneSha = ''
      const result = await runQueue({
        tasks: ['Commit it yourself'],
        git: adapter(repo),
        runTask: async () => {
          writeFileSync(join(repo, 'lane-file.txt'), 'The lane wrote and committed this.\n')
          git(repo, ['add', '-A'])
          git(repo, ['commit', '-m', '0.4.0: Let the lane commit'])
          laneSha = git(repo, ['rev-parse', 'HEAD']).trim()
          return { code: 0 }
        },
        runTests: async () => ({ ok: true }),
      })

      expect(result.results).toEqual([{ number: 1, task: 'Commit it yourself', status: 'committed', sha: laneSha }])
      expect(git(repo, ['rev-list', '--count', `refs/heads/main..refs/heads/${QUEUE_BRANCH}`]).trim()).toBe('1')
      expect(git(repo, ['rev-parse', `refs/heads/${QUEUE_BRANCH}`]).trim()).toBe(laneSha)
      expect(git(repo, ['log', '-1', '--format=%s']).trim()).toBe('0.4.0: Let the lane commit')
      expect(git(repo, ['log', '-1', '--format=%B'])).not.toContain('Task 1 of 1')
    } finally {
      remove(parent)
    }
  })

  it('commits the rest when the lane committed and left more changes', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const result = await runQueue({
        tasks: ['Finish the work'],
        git: adapter(repo),
        runTask: async () => {
          writeFileSync(join(repo, 'lane-file.txt'), 'The lane wrote and committed this.\n')
          git(repo, ['add', '-A'])
          git(repo, ['commit', '-m', '0.4.0: Let the lane commit'])
          writeFileSync(join(repo, 'rest.txt'), 'The lane left this.\n')
          return { code: 0 }
        },
        runTests: async () => ({ ok: true }),
      })

      expect(result.results.map((item) => item.status)).toEqual(['committed'])
      expect(git(repo, ['rev-list', '--count', `refs/heads/main..refs/heads/${QUEUE_BRANCH}`]).trim()).toBe('2')
      expect(git(repo, ['log', '-1', '--format=%s']).trim()).toBe('Finish the work')
      expect(git(repo, ['show', 'HEAD:rest.txt']).trim()).toBe('The lane left this.')
      expect(git(repo, ['log', '-2', '--format=%s']).trim().split(/\r?\n/)).toEqual(['Finish the work', '0.4.0: Let the lane commit'])
    } finally {
      remove(parent)
    }
  })

  it('signs its own commit with the harness trailer', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const result = await runQueue({
        tasks: ['Leave the change to the queue'],
        git: adapter(repo),
        author: commitAuthorFor(harnessByKey.opencode, 'opencode/fake'),
        runTask: async () => {
          writeFileSync(join(repo, 'lane-file.txt'), 'The lane left this.\n')
          return { code: 0 }
        },
        runTests: async () => ({ ok: true }),
      })

      expect(result.results.map((item) => item.status)).toEqual(['committed'])
      const message = git(repo, ['log', '-1', '--format=%B']).trim()
      expect(message).toContain('Task 1 of 1, run by MachineRoom on the opencode lane.')
      expect(message.endsWith('Co-Authored-By: OpenCode (opencode/fake) <noreply@opencode.ai>')).toBe(true)
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

  it('runs the test script that a task adds to package.json', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const runs = join(parent, 'machineroom-runs')
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'Add the test script.\n')
      writeFakeLane(repo, {
        'package.json': `${JSON.stringify({ scripts: { test: 'node test-runner.cjs' } })}\n`,
        'test-runner.cjs': "require('node:fs').writeFileSync('tests-ran.txt', 'yes')\n",
      })
      git(repo, ['add', '-A'])
      git(repo, ['commit', '-m', 'the fake lane program'])
      const result = await runLane(['fake', '--project', repo, '--queue', file], {
        TEMP: parent,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: fakeLaneFile(parent),
      })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('1. committed')
      expect(result.stdout).toContain('tests: npm test')
      expect(git(repo, ['show', 'HEAD:tests-ran.txt']).trim()).toBe('yes')
    } finally {
      remove(parent)
    }
  }, 60000)

  it('runs an explicit --test instead of the script a task adds', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const runs = join(parent, 'machineroom-runs')
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'Add the test script.\n')
      writeFileSync(join(repo, 'explicit-test.cjs'), "require('node:fs').writeFileSync('explicit-ran.txt', 'yes')\n")
      writeFakeLane(repo, {
        'package.json': `${JSON.stringify({ scripts: { test: 'node auto-test.cjs' } })}\n`,
        'auto-test.cjs': "require('node:fs').writeFileSync('auto-ran.txt', 'yes')\n",
      })
      git(repo, ['add', '-A'])
      git(repo, ['commit', '-m', 'the fake lane program'])
      const result = await runLane(['fake', '--project', repo, '--queue', file, '--test', 'node explicit-test.cjs'], {
        TEMP: parent,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: fakeLaneFile(parent),
      })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('1. committed')
      expect(result.stdout).toContain('tests: node explicit-test.cjs')
      expect(git(repo, ['show', 'HEAD:explicit-ran.txt']).trim()).toBe('yes')
      expect(existsSync(join(repo, 'auto-ran.txt'))).toBe(false)
    } finally {
      remove(parent)
    }
  }, 60000)

  it('keeps the commit the fake lane made and records its sha', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const runs = join(parent, 'machineroom-runs')
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'Let the lane commit.\n')
      const gitFile = JSON.stringify(gitPath())
      writeFileSync(join(repo, 'run'), [
        "const { writeFileSync } = require('node:fs')",
        "const { spawnSync } = require('node:child_process')",
        "writeFileSync('lane-commit.txt', 'The fake lane committed this.\\n')",
        `const added = spawnSync(${gitFile}, ['add', '-A'], { encoding: 'utf8' })`,
        `const made = spawnSync(${gitFile}, ['-c', 'user.name=Fake Lane', '-c', 'user.email=lane@example.com', 'commit', '-m', '0.4.0: The fake lane commits'], { encoding: 'utf8' })`,
        'if (added.status !== 0 || made.status !== 0) process.exit(2)',
        "console.log(JSON.stringify({ type: 'text', timestamp: Date.now(), sessionID: 'ses_fake', part: { id: 'prt_1', type: 'text', text: 'done' } }))",
        '',
      ].join('\n'))
      git(repo, ['add', 'run'])
      git(repo, ['commit', '-m', 'the fake lane program'])
      const result = await runLane(['fake', '--project', repo, '--queue', file], {
        TEMP: parent,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: fakeLaneFile(parent),
      })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain(`1. committed ${git(repo, ['rev-parse', 'HEAD']).trim()}`)
      expect(git(repo, ['rev-list', '--count', 'refs/heads/main..HEAD']).trim()).toBe('1')
      expect(git(repo, ['log', '-1', '--format=%s']).trim()).toBe('0.4.0: The fake lane commits')
      expect(git(repo, ['log', '-1', '--format=%B'])).not.toContain('Task 1 of 1')
      expect(git(repo, ['status', '--porcelain']).trim()).toBe('')
    } finally {
      remove(parent)
    }
  }, 60000)

  it('signs the queue commit with the fake lane harness trailer', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const runs = join(parent, 'machineroom-runs')
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'Leave the change to the queue.\n')
      writeFakeLane(repo)
      git(repo, ['add', '-A'])
      git(repo, ['commit', '-m', 'the fake lane program'])
      const result = await runLane(['fake', '--project', repo, '--queue', file], {
        TEMP: parent,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: fakeLaneFile(parent),
      })
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('1. committed')
      const message = git(repo, ['log', '-1', '--format=%B']).trim()
      expect(message).toContain('Task 1 of 1, run by MachineRoom on the fake lane.')
      expect(message.endsWith('Co-Authored-By: OpenCode (opencode/fake) <noreply@opencode.ai>')).toBe(true)
    } finally {
      remove(parent)
    }
  }, 60000)

  it('fails the task when it breaks package.json instead of committing it', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const runs = join(parent, 'machineroom-runs')
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'Break the package file.\n')
      writeFakeLane(repo, {
        'package.json': '{ not json\n',
      })
      git(repo, ['add', '-A'])
      git(repo, ['commit', '-m', 'the fake lane program'])
      const before = git(repo, ['rev-parse', 'HEAD']).trim()
      const result = await runLane(['fake', '--project', repo, '--queue', file], {
        TEMP: parent,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: fakeLaneFile(parent),
      })
      expect(result.code).toBe(1)
      expect(result.stdout).toContain('1. failed: tests')
      const masked = printedRunsFolder(join(repo, 'package.json'), { TEMP: parent, TMP: parent })
      const output = `${result.stdout}\n${result.stderr}`
      expect(output).toContain(`The package.json at ${masked} could not be read, so the tests cannot run.`)
      expect(output).not.toContain(process.execPath)
      expect(git(repo, ['rev-parse', 'HEAD']).trim()).toBe(before)
    } finally {
      remove(parent)
    }
  }, 60000)

  it('prints the broken package.json sentence on a dry run tests line', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      writeFileSync(join(repo, 'package.json'), '{ not json\n')
      git(repo, ['add', '-A'])
      git(repo, ['commit', '-m', 'Break the package file'])
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'Break the package file.\n')
      const result = await runLane(['fake', '--project', repo, '--queue', file, '--dry-run'], {
        TEMP: parent,
        MACHINEROOM_LANES_FILE: fakeLaneFile(parent),
      })
      expect(result.code).toBe(0)
      const masked = printedRunsFolder(join(repo, 'package.json'), { TEMP: parent, TMP: parent })
      expect(result.stdout).toContain(`tests: The package.json at ${masked} could not be read, so the tests cannot run.`)
      expect(result.stdout).not.toContain(process.execPath)
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
      expect(result.stderr).toContain(`The project folder ${printedRunsFolder(folder)} is not a git folder. A queue needs one.`)
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
        expect(result.stderr).toContain('Another run is already going on ')
        expect(result.stderr).toContain(`${basename(repo)};`)
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

describe('a queue that stops', () => {
  function laneFile(parent, lane) {
    const file = join(parent, 'lanes.json')
    writeFileSync(file, `${JSON.stringify({ [lane.name]: lane })}\n`)
    return file
  }

  function failingLane(folder, failText) {
    writeFileSync(join(folder, 'run'), [
      "const { writeFileSync } = require('node:fs')",
      "const args = process.argv.join(' ')",
      "writeFileSync('lane-note.txt', 'The fake lane wrote this file.\\n')",
      `if (args.includes(${JSON.stringify(failText)})) process.exit(3)`,
      "console.log(JSON.stringify({ type: 'text', timestamp: Date.now(), sessionID: 'ses_fake', part: { id: 'prt_fake', type: 'text', text: 'done' } }))",
      '',
    ].join('\n'))
  }

  it('refuses a lane with no command line before it makes the queue branch', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const runs = join(parent, 'machineroom-runs')
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'One task.\n')
      const lanes = laneFile(parent, { name: 'bad', worktree: join(parent, 'worktree') })
      const result = await runLane(['bad', '--project', repo, '--queue', file], {
        TEMP: parent,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: lanes,
      })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('The lane bad has no command line, so the runner cannot start it.')
      expect(git(repo, ['branch', '--show-current']).trim()).toBe('main')
      expect(git(repo, ['branch', '--list', 'machineroom/queue-*']).trim()).toBe('')
      expect(existsSync(join(runs, 'runs.jsonl'))).toBe(false)
    } finally {
      remove(parent)
    }
  }, 40000)

  it('writes a failed task record when the tests fail after the harness exits well', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const runs = join(parent, 'machineroom-runs')
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'Write the lane note.\n')
      copyFileSync(fileURLToPath(new URL('fixtures/fake-lane.cjs', import.meta.url)), join(repo, 'run'))
      git(repo, ['add', 'run'])
      git(repo, ['commit', '-m', 'the fake lane program'])
      const head = git(repo, ['rev-parse', 'HEAD']).trim()
      const lanes = laneFile(parent, {
        name: 'fake',
        worktree: join(parent, 'worktree'),
        cli: { harness: 'opencode', bin: process.execPath, model: 'opencode/fake' },
      })
      const result = await runLane(['fake', '--project', repo, '--queue', file, '--test', 'node -e "process.exit(1)"'], {
        TEMP: parent,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: lanes,
      })
      expect(result.code).toBe(1)
      expect(result.stdout).toContain('1. failed: tests')
      const records = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line))
      expect(records.at(-1)).toMatchObject({ lane: 'fake', exitCode: 1, queueStatus: 'failed: tests', base: head, tests: 'failed', queueSize: 1, queueRemaining: [] })
      expect(records.at(-1)).not.toHaveProperty('head')
      expect(records.at(-1).commits).toEqual([])
      const meta = JSON.parse(readFileSync(records.at(-1).log.replace(/\.log$/i, '.meta.json'), 'utf8'))
      expect(meta.base).toBe(head)
    } finally {
      remove(parent)
    }
  }, 60000)

  it('keeps head on a failed test record when the working tree matches HEAD', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const runs = join(parent, 'machineroom-runs')
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'Check the repo.\n')
      writeFileSync(join(repo, 'run'), "console.log(JSON.stringify({ type: 'text', timestamp: Date.now(), sessionID: 'ses_fake', part: { id: 'prt_1', type: 'text', text: 'ok' } }))\n")
      git(repo, ['add', 'run'])
      git(repo, ['commit', '-m', 'no-op fake lane'])
      const head = git(repo, ['rev-parse', 'HEAD']).trim()
      const lanes = laneFile(parent, {
        name: 'fake',
        worktree: join(parent, 'worktree'),
        cli: { harness: 'opencode', bin: process.execPath, model: 'opencode/fake' },
      })
      const result = await runLane(['fake', '--project', repo, '--queue', file, '--test', 'node -e "process.exit(1)"'], {
        TEMP: parent,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: lanes,
      })
      expect(result.code).toBe(1)
      expect(result.stdout).toContain('1. failed: tests')
      const records = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line))
      expect(records.at(-1)).toMatchObject({ lane: 'fake', exitCode: 1, queueStatus: 'failed: tests', base: head, head, tests: 'failed' })
    } finally {
      remove(parent)
    }
  }, 60000)

  it('keeps H passed and merges it after a failing second task has its edits discarded', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const room = join(parent, 'room')
      cpSync(TEMPLATE_REPO, room, { recursive: true })
      const lanes = join(room, 'lanes.json')
      writeFileSync(lanes, `${JSON.stringify({
        fake: {
          name: 'Fake lane',
          harness: 'OpenCode',
          worktree: join(parent, 'unused-worktree'),
          cli: { harness: 'opencode', bin: process.execPath, model: 'opencode/fake' },
        },
      }, null, 2)}\n`)
      git(room, ['add', 'lanes.json'])
      git(room, ['commit', '-m', 'Add lanes file'])

      const runs = join(parent, 'machineroom-runs')
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'First task.\n---\nSecond task.\n')
      writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ scripts: { test: 'node check.cjs' } })}\n`)
      writeFileSync(join(repo, 'check.cjs'), "if (require('node:fs').existsSync('broken.txt')) process.exit(1)\n")
      writeFileSync(join(repo, 'run'), [
        "const { writeFileSync } = require('node:fs')",
        "const args = process.argv.join(' ')",
        "if (args.includes('Second task')) writeFileSync('broken.txt', 'bad\\n')",
        "else writeFileSync('good.txt', 'ok\\n')",
        "console.log(JSON.stringify({ type: 'text', timestamp: Date.now(), sessionID: 'ses_fake', part: { id: 'prt_1', type: 'text', text: 'done' } }))",
        '',
      ].join('\n'))
      git(repo, ['add', '-A'])
      git(repo, ['commit', '-m', 'Add test check and fake lane'])
      const startHead = git(repo, ['rev-parse', 'HEAD']).trim()

      const result = await runLane(['fake', '--project', repo, '--worktree', '--queue', file], {
        TEMP: parent,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: lanes,
      })
      expect(result.code).toBe(1)
      expect(result.stdout).toContain('1. committed')
      expect(result.stdout).toContain('2. failed: tests')

      const worktree = join(repo, '.worktrees', 'fake')
      const madeHead = git(worktree, ['rev-parse', 'HEAD']).trim()
      expect(madeHead).not.toBe(startHead)
      expect(git(worktree, ['status', '--porcelain']).trim()).toContain('broken.txt')

      const records = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line))
      expect(records).toHaveLength(2)
      expect(records[0]).toMatchObject({ lane: 'fake', exitCode: 0, head: madeHead, tests: 'passed' })
      expect(records[1]).toMatchObject({ lane: 'fake', exitCode: 1, queueStatus: 'failed: tests', tests: 'failed' })
      expect(records[1]).not.toHaveProperty('head')

      git(worktree, ['checkout', '--', '.'])
      git(worktree, ['clean', '-fd'])
      expect(git(worktree, ['status', '--porcelain']).trim()).toBe('')
      expect(git(worktree, ['rev-parse', 'HEAD']).trim()).toBe(madeHead)

      const answers = []
      let body = null
      const api = createReviewsApi({
        projectRoot: repo,
        briefsDir: room,
        runsFolder: runs,
        sendJson: (req, res, status, payload) => answers.push({ status, payload }),
        readJsonBody: async () => body,
        orchestrators: () => null,
      })
      await api.handle(
        { method: 'GET', headers: { origin: 'http://localhost:5173' } },
        {},
        new URL('http://127.0.0.1/api/control/reviews')
      )
      const list = answers.at(-1)
      expect(list.status).toBe(200)
      expect(list.payload.lanes).toHaveLength(1)
      expect(list.payload.lanes[0]).toMatchObject({
        lane: 'fake',
        head: madeHead,
        base: 'main',
        baseHead: startHead,
        strategy: 'fast-forward',
        dirty: false,
        checks: 'passed',
      })

      body = { confirmed: true, head: madeHead, base: 'main', baseHead: startHead }
      await api.handle(
        { method: 'POST', headers: { origin: 'http://localhost:5173' } },
        {},
        new URL('http://127.0.0.1/api/control/reviews/fake/merge')
      )
      const merged = answers.at(-1)
      expect(merged.status).toBe(200)
      expect(merged.payload).toMatchObject({ ok: true, lane: 'fake', head: madeHead, commit: madeHead })
      expect(git(repo, ['rev-parse', 'refs/heads/main']).trim()).toBe(madeHead)
      expect(git(repo, ['show', 'HEAD:good.txt']).trim()).toBe('ok')
    } finally {
      remove(parent)
    }
  }, 60000)

  it('writes head and tests: none when the project has no test command, and omits tests on harness exit', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const runs = join(parent, 'machineroom-runs')
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'Write a file.\n')
      writeFakeLane(repo)
      git(repo, ['add', '-A'])
      git(repo, ['commit', '-m', 'the fake lane program'])
      const okResult = await runLane(['fake', '--project', repo, '--queue', file], {
        TEMP: parent,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: fakeLaneFile(parent),
      })
      expect(okResult.code).toBe(0)
      let records = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line))
      expect(records.at(-1)).toMatchObject({
        lane: 'fake',
        head: git(repo, ['rev-parse', 'HEAD']).trim(),
        tests: 'none',
      })

      git(repo, ['switch', 'main'])
      writeFileSync(join(repo, 'run'), 'process.exit(2)\n')
      git(repo, ['add', 'run'])
      git(repo, ['commit', '-m', 'fail the fake lane'])
      const headBeforeFail = git(repo, ['rev-parse', 'HEAD']).trim()
      const failResult = await runLane(['fake', '--project', repo, '--queue', file], {
        TEMP: parent,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: fakeLaneFile(parent),
      })
      expect(failResult.code).toBe(1)
      records = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line))
      expect(records.at(-1)).toMatchObject({ lane: 'fake', exitCode: 2, head: headBeforeFail })
      expect(records.at(-1)).not.toHaveProperty('tests')
    } finally {
      remove(parent)
    }
  }, 60000)

  it('records the failure when a queue throws before its first task starts', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const runs = join(parent, 'machineroom-runs')
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'First task.\n')
      copyFileSync(fileURLToPath(new URL('fixtures/fake-lane.cjs', import.meta.url)), join(repo, 'run'))
      git(repo, ['add', 'run'])
      git(repo, ['commit', '-m', 'the fake lane program'])
      const head = git(repo, ['rev-parse', 'HEAD']).trim()
      const lanes = laneFile(parent, {
        name: 'fake',
        worktree: join(parent, 'worktree'),
        cli: { harness: 'opencode', bin: process.execPath, model: 'opencode/fake' },
      })
      const gitDir = join(repo, '.git')
      writeFileSync(join(gitDir, 'HEAD.lock'), 'locked')
      try {
        const result = await runLane(['fake', '--project', repo, '--queue', file], {
          TEMP: parent,
          MACHINEROOM_RUNS: runs,
          MACHINEROOM_LANES_FILE: lanes,
        })
        expect(result.code).toBe(1)
      } finally {
        try { unlinkSync(join(gitDir, 'HEAD.lock')) } catch {}
      }
      const records = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line))
      expect(records.length).toBeGreaterThanOrEqual(1)
      expect(records.at(-1)).toMatchObject({ lane: 'fake', exitCode: 1, queueStatus: 'failed: the queue stopped', head, queueSize: 1, queueRemaining: [] })
      expect(records.at(-1)).not.toHaveProperty('tests')
    } finally {
      remove(parent)
    }
  }, 60000)

  it('records queueSize on every task and the tasks left after a failed one', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const runs = join(parent, 'machineroom-runs')
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'First task.\n---\nBreak the second task.\n---\nThe third task waits.\n')
      failingLane(repo, 'Break the second task.')
      git(repo, ['add', 'run'])
      git(repo, ['commit', '-m', 'the fake lane program'])
      const lanes = laneFile(parent, {
        name: 'fake',
        worktree: join(parent, 'worktree'),
        cli: { harness: 'opencode', bin: process.execPath, model: 'opencode/fake' },
      })
      const result = await runLane(['fake', '--project', repo, '--queue', file], {
        TEMP: parent,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: lanes,
      })
      expect(result.code).toBe(1)
      const records = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line))
      expect(records).toHaveLength(2)
      expect(records[0]).toMatchObject({ lane: 'fake', queueIndex: 1, queueSize: 3 })
      expect(records[0]).not.toHaveProperty('queueRemaining')
      expect(records[1]).toMatchObject({
        lane: 'fake',
        exitCode: 3,
        queueStatus: 'failed',
        queueIndex: 2,
        queueSize: 3,
        queueRemaining: ['The third task waits.'],
      })
    } finally {
      remove(parent)
    }
  }, 60000)

  it('records no queueRemaining when the queue ends well', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const runs = join(parent, 'machineroom-runs')
      const file = join(parent, 'queue.txt')
      writeFileSync(file, 'First task.\n---\nSecond task.\n')
      writeFakeLane(repo)
      git(repo, ['add', '-A'])
      git(repo, ['commit', '-m', 'the fake lane program'])
      const result = await runLane(['fake', '--project', repo, '--queue', file], {
        TEMP: parent,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: fakeLaneFile(parent),
      })
      expect(result.code).toBe(0)
      const records = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line))
      expect(records).toHaveLength(2)
      for (const record of records) {
        expect(record.queueSize).toBe(2)
        expect(record).not.toHaveProperty('queueRemaining')
      }
    } finally {
      remove(parent)
    }
  }, 60000)

  it('masks a key in a task that did not run', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const runs = join(parent, 'machineroom-runs')
      const file = join(parent, 'queue.txt')
      const key = `sk-${'a'.repeat(32)}`
      writeFileSync(file, `First task.\n---\nBreak the second task.\n---\nUse OPENROUTER_API_KEY=${key} in the last task.\n`)
      failingLane(repo, 'Break the second task.')
      git(repo, ['add', 'run'])
      git(repo, ['commit', '-m', 'the fake lane program'])
      const lanes = laneFile(parent, {
        name: 'fake',
        worktree: join(parent, 'worktree'),
        cli: { harness: 'opencode', bin: process.execPath, model: 'opencode/fake' },
      })
      const result = await runLane(['fake', '--project', repo, '--queue', file], {
        TEMP: parent,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: lanes,
      })
      expect(result.code).toBe(1)
      const records = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line))
      expect(records.at(-1).queueRemaining).toEqual(['Use OPENROUTER_API_KEY=[key] in the last task.'])
      expect(JSON.stringify(records.at(-1))).not.toContain(key)
    } finally {
      remove(parent)
    }
  }, 60000)

  it('hides the home folder in a task that did not run', async () => {
    const parent = makeTempDir('machine-room-queue-')
    try {
      const repo = initRepo(parent)
      const runs = join(parent, 'machineroom-runs')
      const file = join(parent, 'queue.txt')
      const home = homedir()
      const note = join(home, 'queue-notes', 'todo.txt')
      writeFileSync(file, `First task.\n---\nBreak the second task.\n---\nRead ${note} in the last task.\n`)
      failingLane(repo, 'Break the second task.')
      git(repo, ['add', 'run'])
      git(repo, ['commit', '-m', 'the fake lane program'])
      const lanes = laneFile(parent, {
        name: 'fake',
        worktree: join(parent, 'worktree'),
        cli: { harness: 'opencode', bin: process.execPath, model: 'opencode/fake' },
      })
      const result = await runLane(['fake', '--project', repo, '--queue', file], {
        TEMP: parent,
        MACHINEROOM_RUNS: runs,
        MACHINEROOM_LANES_FILE: lanes,
      })
      expect(result.code).toBe(1)
      const records = readFileSync(join(runs, 'runs.jsonl'), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line))
      expect(records.at(-1).queueRemaining).toHaveLength(1)
      expect(records.at(-1).queueRemaining[0]).not.toContain(home)
      expect(records.at(-1).queueRemaining[0]).toContain(process.platform === 'win32' ? '%USERPROFILE%' : '~')
      expect(JSON.stringify(records.at(-1))).not.toContain(home)
    } finally {
      remove(parent)
    }
  }, 60000)
})
