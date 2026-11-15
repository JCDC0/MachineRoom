import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { refuseRunningLane } from '../scripts/run-lane.mjs'
import { laneStopProblem } from '../src/briefs/run.js'
import { makeTempDir, removeTempDir } from './helpers/tempRoot.js'

const created = []

afterEach(() => {
  vi.unstubAllEnvs()
  while (created.length > 0) removeTempDir(created.pop())
})

function tempRuns() {
  const dir = makeTempDir('mr-leftover-recheck-')
  created.push(dir)
  return dir
}

function snapshotStub(snapshots) {
  const waits = []
  let calls = 0
  const list = () => {
    const result = snapshots[calls] ?? []
    calls += 1
    return result
  }
  const wait = (ms) => {
    waits.push(ms)
  }
  return { list, wait, waits, calls: () => calls }
}

describe('refuseRunningLane leftover recheck', () => {
  it('does not refuse when a leftover from the first list is gone on the second list', async () => {
    const runs = tempRuns()
    const worktree = join(runs, 'opencode')
    const waits = []
    const snapshots = [
      [{ pid: 4141, ppid: 1, command: `node.exe ${join(worktree, 'worker.js')}` }],
      [],
    ]
    let calls = 0
    const list = () => {
      const result = snapshots[calls] ?? []
      calls += 1
      return result
    }
    const wait = (ms) => {
      waits.push(ms)
    }

    await expect(refuseRunningLane('opencode', worktree, runs, { list, wait })).resolves.toBeUndefined()
    expect(calls).toBe(2)
    expect(waits).toEqual([500])
  })

  it('refuses when the same pid and command line stay in both lists and names the program', async () => {
    const runs = tempRuns()
    const worktree = join(runs, 'opencode')
    const waits = []
    const row = { pid: 4141, ppid: 1, command: `node.exe ${join(worktree, 'worker.js')}` }
    let calls = 0
    const list = () => {
      calls += 1
      return [row]
    }
    const wait = (ms) => {
      waits.push(ms)
    }

    await expect(refuseRunningLane('opencode', worktree, runs, { list, wait })).rejects.toThrow(
      'The opencode lane still has leftover process 4141 (node.exe); stop it with npm run run-lane -- --stop opencode.',
    )
    expect(calls).toBe(2)
    expect(waits).toEqual([500])
  })

  it('does not refuse when the same pid appears in the second list with a different command line', async () => {
    const runs = tempRuns()
    const worktree = join(runs, 'opencode')
    const waits = []
    const snapshots = [
      [{ pid: 4141, ppid: 1, command: `node.exe ${join(worktree, 'worker.js')}` }],
      [{ pid: 4141, ppid: 1, command: 'cmd.exe /c echo reused' }],
    ]
    let calls = 0
    const list = () => {
      const result = snapshots[calls] ?? []
      calls += 1
      return result
    }
    const wait = (ms) => {
      waits.push(ms)
    }

    await expect(refuseRunningLane('opencode', worktree, runs, { list, wait })).resolves.toBeUndefined()
    expect(calls).toBe(2)
    expect(waits).toEqual([500])
  })

  it('does not wait or list twice when the first list finds no leftover', async () => {
    const runs = tempRuns()
    const worktree = join(runs, 'opencode')
    const waits = []
    let calls = 0
    const list = () => {
      calls += 1
      return []
    }
    const wait = (ms) => {
      waits.push(ms)
    }

    await expect(refuseRunningLane('opencode', worktree, runs, { list, wait })).resolves.toBeUndefined()
    expect(calls).toBe(1)
    expect(waits).toEqual([])
  })

  it('masks a home folder in a quoted or full program path and skips an exited sibling', async () => {
    const runs = tempRuns()
    const worktree = join(runs, 'opencode')
    const profile = 'C:\\Users\\<name>'
    vi.stubEnv('USERPROFILE', profile)
    const quotedExe = `${profile}\\My Tools\\opencode.exe`
    const snapshots = [
      [
        { pid: 4141, ppid: 1, command: `node.exe ${join(worktree, 'gone.js')}` },
        { pid: 4142, ppid: 1, command: `"${quotedExe}" --dir ${worktree}` },
      ],
      [
        { pid: 4142, ppid: 1, command: `"${quotedExe}" --dir ${worktree}` },
      ],
    ]
    let calls = 0
    const list = () => {
      const result = snapshots[calls] ?? []
      calls += 1
      return result
    }

    await expect(refuseRunningLane('opencode', worktree, runs, { list, wait: () => {} })).rejects.toThrow(
      'The opencode lane still has leftover process 4142 (%USERPROFILE%\\My Tools\\opencode.exe); stop it with npm run run-lane -- --stop opencode.',
    )
  })

  it('refuses and names the replacement pid when a leftover hands off to a worker on the same worktree', async () => {
    const runs = tempRuns()
    const probe = snapshotStub([
      [{ pid: 4141, ppid: 1, command: 'node.exe C:/review-work/parent.js' }],
      [{ pid: 4142, ppid: 1, command: 'node.exe C:/review-work/worker.js' }],
    ])

    await expect(refuseRunningLane('opencode', 'C:/review-work', runs, probe)).rejects.toThrow(
      'The opencode lane still has leftover process 4142 (node.exe); stop it with npm run run-lane -- --stop opencode.',
    )
    expect(probe.calls()).toBe(2)
    expect(probe.waits).toEqual([500])
  })

  it('refuses and names the second program when the same pid changes command but still names the worktree', async () => {
    const runs = tempRuns()
    const probe = snapshotStub([
      [{ pid: 4141, ppid: 1, command: 'node.exe C:/review-work/parent.js' }],
      [{ pid: 4141, ppid: 1, command: 'python.exe C:/review-work/worker.py' }],
    ])

    await expect(refuseRunningLane('opencode', 'C:/review-work', runs, probe)).rejects.toThrow(
      'The opencode lane still has leftover process 4141 (python.exe); stop it with npm run run-lane -- --stop opencode.',
    )
    expect(probe.calls()).toBe(2)
    expect(probe.waits).toEqual([500])
  })

  it('refuses a replacement leftover that names the lock folder when worktree is empty', async () => {
    const runs = tempRuns()
    writeFileSync(join(runs, 'opencode.lock'), JSON.stringify({ pid: 999999, folder: 'C:/project-work' }))
    const probe = snapshotStub([
      [{ pid: 4141, ppid: 1, command: 'node.exe C:/project-work/parent.js' }],
      [{ pid: 4142, ppid: 1, command: 'node.exe C:/project-work/worker.js' }],
    ])

    await expect(refuseRunningLane('opencode', '', runs, probe)).rejects.toThrow(
      'The opencode lane still has leftover process 4142 (node.exe); stop it with npm run run-lane -- --stop opencode.',
    )
    expect(probe.calls()).toBe(2)
    expect(probe.waits).toEqual([500])
  })
})

describe('laneStopProblem', () => {
  it('names a masked program for a leftover and omits empty or harness programs', () => {
    const profile = 'C:\\Users\\<name>'
    vi.stubEnv('USERPROFILE', profile)
    expect(laneStopProblem({ lane: 'opencode', pid: 12, leftover: true, program: `${profile}\\bin\\node.exe` }))
      .toBe('The opencode lane still has leftover process 12 (%USERPROFILE%\\bin\\node.exe); stop it with npm run run-lane -- --stop opencode.')
    expect(laneStopProblem({ lane: 'opencode', pid: 12, leftover: true }))
      .toBe('The opencode lane still has leftover process 12; stop it with npm run run-lane -- --stop opencode.')
    expect(laneStopProblem({ lane: 'opencode', pid: 12, program: 'node.exe' }))
      .toBe('The opencode lane still has harness process 12; stop it with npm run run-lane -- --stop opencode.')
  })
})
