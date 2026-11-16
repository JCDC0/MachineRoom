import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBridge } from '../server/index.js'
import { clearRunsCache } from '../server/runs.js'
import { gitPath } from '../server/programPath.js'
import { startLane } from '../scripts/run-lane.mjs'
import Inspector from '../src/ui/Inspector.jsx'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'
import { settle, withDom } from './helpers/uiDom.js'

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'MachineRoom Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'MachineRoom Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
}

const FAKE_RUN = [
  "console.log('{\"type\":\"step_finish\",\"part\":{\"cost\":0,\"tokens\":{\"input\":1,\"output\":1}}}')",
  '',
].join('\n')

const BRIEF = { id: 'P462X', title: 'Checkpoint test brief', text: 'Do it.\n\nFiles: note.txt\n' }

const cleanups = []

afterEach(async () => {
  clearRunsCache()
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    await fn()
  }
})

function tempDir(prefix) {
  const dir = makeTempDir(prefix)
  cleanups.push(() => removeTempDir(dir))
  return dir
}

function gitIn(folder, args) {
  const result = spawnSync(gitPath(), ['-c', 'commit.gpgsign=false', ...args], {
    cwd: folder,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...GIT_IDENTITY },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${folder}: ${String(result.stderr ?? '').trim()}`)
  return String(result.stdout ?? '').trim()
}

function makeRepo(folder) {
  mkdirSync(folder, { recursive: true })
  gitIn(folder, ['init', '-q', '-b', 'main'])
  writeFileSync(join(folder, 'readme.txt'), 'start\n')
  writeFileSync(join(folder, 'run'), FAKE_RUN)
  gitIn(folder, ['config', 'user.name', 'MachineRoom Test'])
  gitIn(folder, ['config', 'user.email', 'test@example.invalid'])
  gitIn(folder, ['add', '-A'])
  gitIn(folder, ['commit', '-q', '-m', 'Start the repository'])
}

function readRecords(runs) {
  const file = join(runs, 'runs.jsonl')
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function laneFor(worktree) {
  return {
    name: 'OpenCode',
    worktree,
    cli: { harness: 'opencode', bin: process.execPath, model: 'fake/model' },
  }
}

async function runLane({ worktree, runs, name, continueFrom = '' }) {
  const lane = laneFor(worktree)
  const saved = process.env.MACHINEROOM_RUNS
  process.env.MACHINEROOM_RUNS = runs
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    return await startLane({
      options: { lane: 'opencode', minutes: 1, ...(continueFrom ? { continueFrom } : {}) },
      lane,
      lanes: { opencode: lane },
      wanted: [BRIEF],
      prompt: 'Do the task.',
      logPath: join(runs, `${name}.log`),
      usageFile: join(runs, `${name}.usage.json`),
      name,
      ...(continueFrom ? {} : { project: worktree }),
    })
  } finally {
    spy.mockRestore()
    if (saved === undefined) delete process.env.MACHINEROOM_RUNS
    else process.env.MACHINEROOM_RUNS = saved
  }
}

function rowValue(container, label) {
  const row = container.querySelectorAll('.mr-inspector-row').find((item) => item.querySelector('dt')?.textContent === label)
  return row ? row.querySelector('dd')?.textContent ?? null : null
}

describe('a lane run checkpoint', { timeout: 60000 }, () => {
  it('records a clean worktree head and branch with dirty false', async () => {
    const base = tempDir('mr-run-checkpoint-clean-')
    const worktree = join(base, 'worktree')
    const runs = join(base, 'runs')
    makeRepo(worktree)
    mkdirSync(runs, { recursive: true })
    const head = gitIn(worktree, ['rev-parse', 'HEAD'])
    const branch = gitIn(worktree, ['branch', '--show-current'])

    const result = await runLane({ worktree, runs, name: 'opencode-checkpoint-clean' })
    expect(result.code).toBe(0)

    const records = readRecords(runs)
    expect(records).toHaveLength(1)
    expect(records[0].checkpoint).toEqual({
      head,
      branch,
      dirty: false,
      dirtyFiles: [],
      dirtyCount: 0,
      untrackedCount: 0,
    })
  })

  it('records the dirty files and a recovery commit without touching the worktree', async () => {
    const base = tempDir('mr-run-checkpoint-dirty-')
    const worktree = join(base, 'worktree')
    const runs = join(base, 'runs')
    makeRepo(worktree)
    mkdirSync(runs, { recursive: true })
    writeFileSync(join(worktree, 'readme.txt'), 'edited\n')
    writeFileSync(join(worktree, 'wip.txt'), 'partial work\n')
    const before = gitIn(worktree, ['status', '--porcelain'])

    const result = await runLane({ worktree, runs, name: 'opencode-checkpoint-dirty' })
    expect(result.code).toBe(0)

    const record = readRecords(runs)[0]
    expect(record.checkpoint.dirty).toBe(true)
    expect(record.checkpoint.dirtyFiles).toEqual(['readme.txt', 'wip.txt'])
    expect(record.checkpoint.dirtyCount).toBe(2)
    expect(record.checkpoint.recovery).toMatch(/^[0-9a-f]{40}$/)
    expect(gitIn(worktree, ['cat-file', '-t', record.checkpoint.recovery])).toBe('commit')
    expect(gitIn(worktree, ['status', '--porcelain'])).toBe(before)
    expect(readFileSync(join(worktree, 'readme.txt'), 'utf8')).toBe('edited\n')
    expect(readFileSync(join(worktree, 'wip.txt'), 'utf8')).toBe('partial work\n')
    expect(gitIn(worktree, ['stash', 'list'])).toBe('')
  })

  it('records a continuation its own checkpoint of the work carried in', async () => {
    const base = tempDir('mr-run-checkpoint-continue-')
    const worktree = join(base, 'worktree')
    const runs = join(base, 'runs')
    makeRepo(worktree)
    mkdirSync(runs, { recursive: true })
    const firstBranch = 'machineroom/queue-opencode-checkpoint'
    gitIn(worktree, ['switch', '-c', firstBranch])
    const firstHead = gitIn(worktree, ['rev-parse', 'HEAD'])
    const firstName = 'opencode-checkpoint-20261116-120000'
    writeFileSync(join(runs, `${firstName}.log`), '')
    writeFileSync(
      join(runs, 'runs.jsonl'),
      `${JSON.stringify({
        lane: 'opencode',
        briefs: ['P462X'],
        model: 'fake/model',
        startedAt: '2026-11-16T12:00:00.000Z',
        minutes: 0.1,
        exitCode: 1,
        killed: true,
        log: join(runs, `${firstName}.log`),
        branch: firstBranch,
        base: firstHead,
        commits: [],
        checkpoint: { head: firstHead, branch: firstBranch, dirty: false, dirtyFiles: [], dirtyCount: 0 },
      })}\n`
    )
    writeFileSync(join(worktree, 'carried.txt'), 'committed\n')
    gitIn(worktree, ['add', 'carried.txt'])
    gitIn(worktree, ['commit', '-q', '-m', 'Work before the continuation'])
    const nextHead = gitIn(worktree, ['rev-parse', 'HEAD'])
    writeFileSync(join(worktree, 'readme.txt'), 'carried in\n')
    writeFileSync(join(worktree, 'wip.txt'), 'carried work\n')

    const result = await runLane({
      worktree,
      runs,
      name: 'opencode-checkpoint-20261116-120001',
      continueFrom: firstName,
    })
    expect(result.code).toBe(0)

    const records = readRecords(runs)
    expect(records).toHaveLength(2)
    const continuation = records[1]
    expect(continuation.continues).toBe(firstName)
    expect(continuation.checkpoint.head).toBe(nextHead)
    expect(continuation.checkpoint.head).not.toBe(firstHead)
    expect(continuation.checkpoint.branch).toBe(firstBranch)
    expect(continuation.checkpoint.dirty).toBe(true)
    expect(continuation.checkpoint.dirtyFiles).toEqual(['readme.txt', 'wip.txt'])
    expect(continuation.checkpoint.dirtyCount).toBe(2)
    expect(continuation.checkpoint.recovery).toMatch(/^[0-9a-f]{40}$/)
  })

  it('serves the checkpoint in the run entry', async () => {
    const base = tempDir('mr-run-checkpoint-served-')
    const worktree = join(base, 'worktree')
    const runs = join(base, 'runs')
    makeRepo(worktree)
    mkdirSync(runs, { recursive: true })
    const checkpoint = {
      head: 'abcdef1234567890',
      branch: 'main',
      dirty: true,
      dirtyFiles: ['readme.txt', 'wip.txt'],
      dirtyCount: 2,
      recovery: '1234567890abcdef',
    }
    writeFileSync(
      join(runs, 'runs.jsonl'),
      `${JSON.stringify({ lane: 'opencode', project: worktree, startedAt: '2026-11-16T12:00:00.000Z', exitCode: 0, checkpoint })}\n`
    )
    const bridge = createBridge({ projectRoot: worktree, port: 0, env: {}, runsFolder: runs })
    cleanups.push(() => bridge.stop())
    const { url } = await bridge.start()

    const response = await fetch(`${url}/api/control/runs`, { signal: AbortSignal.timeout(10000) })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.last).toHaveLength(1)
    expect(body.last[0].checkpoint).toEqual(checkpoint)
  })

  it('shows one Checkpoint row and no row for an older record', async () => {
    const checkpoint = {
      head: 'abcdef1234567890',
      branch: 'feat/x',
      dirty: true,
      dirtyFiles: ['readme.txt', 'wip.txt', 'other.txt'],
      dirtyCount: 3,
      recovery: '1234567890abcdef',
    }
    const lane = { key: 'opencode', name: 'OpenCode', harness: 'opencode', model: 'fake/model', status: 'idle', openCalls: 0 }
    const newer = { lane: 'opencode', startedAt: '2026-11-16T12:00:00.000Z', checkpoint }
    const older = { lane: 'opencode', startedAt: '2026-11-16T11:00:00.000Z' }

    await withDom(async ({ container, root }) => {
      let answer = { running: [], last: [newer] }
      const client = { runs: async () => answer }
      await act(async () => {
        root.render(
          createElement(Inspector, {
            target: { kind: 'agent', id: 'opencode' },
            live: true,
            bridge: true,
            client,
            lanes: [lane],
            liveRuns: [],
            tasks: [],
            log: [],
          })
        )
      })
      await settle(20)
      expect(rowValue(container, 'Checkpoint')).toBe('Checkpoint: abcdef1 on feat/x, 3 changed files kept as 1234567')

      answer = { running: [], last: [older] }
      await act(async () => {
        root.render(
          createElement(Inspector, {
            target: { kind: 'agent', id: 'opencode' },
            live: true,
            bridge: true,
            client: { runs: async () => answer },
            lanes: [lane],
            liveRuns: [],
            tasks: [],
            log: [],
          })
        )
      })
      await settle(20)
      expect(rowValue(container, 'Checkpoint')).toBeNull()
    })
  })
})
