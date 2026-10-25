import { describe, expect, it, vi } from 'vitest'
import {
  LAUNCHER_TIMEOUT_TEXT,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  absolutePathProblem,
  keepWorkingLabel,
  launcherRows,
  launcherSeen,
  markLauncherSeen,
  openingLabel,
  pathName,
  pollProject,
  rootIsGit,
  samePath,
  shouldOpenLauncher,
} from '../src/ui/launcher.js'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
  }
}

describe('launcher flag', () => {
  it('reads and writes machineroom.launcher', () => {
    const storage = memoryStorage()
    expect(launcherSeen(storage)).toBe(false)
    expect(markLauncherSeen(storage)).toBe(true)
    expect(storage.getItem('machineroom.launcher')).toBe('1')
    expect(launcherSeen(storage)).toBe(true)
  })
})

describe('launcher first load', () => {
  it('treats a root as a git checkout from the git flag or the folder list', () => {
    expect(rootIsGit({ current: { path: 'C:\\Work\\One', git: true } })).toBe(true)
    expect(rootIsGit({ current: { path: 'C:\\Work\\One', git: false }, folders: [{ path: 'C:\\Work\\Two' }] })).toBe(false)
    expect(rootIsGit({ current: { path: 'C:\\Work\\One' }, folders: [{ path: 'C:\\Work\\Two' }] })).toBe(true)
    expect(rootIsGit({ current: { path: 'C:\\Work\\One' } })).toBe(false)
    expect(rootIsGit({ current: { path: 'C:\\Work\\One' }, folders: [] })).toBe(false)
    expect(rootIsGit(null)).toBe(false)
  })

  it('opens once in a live room only when the root is not a git checkout', () => {
    const plain = { current: { path: 'C:\\Work\\One', git: false }, folders: [] }
    const git = { current: { path: 'C:\\Work\\One', git: true }, folders: [] }
    expect(shouldOpenLauncher({ live: true, seen: false, projects: plain })).toBe(true)
    expect(shouldOpenLauncher({ live: true, seen: true, projects: plain })).toBe(false)
    expect(shouldOpenLauncher({ live: false, seen: false, projects: plain })).toBe(false)
    expect(shouldOpenLauncher({ live: true, seen: false, projects: git })).toBe(false)
    expect(shouldOpenLauncher({ live: true, seen: false, projects: null })).toBe(false)
  })
})

describe('launcher rows', () => {
  it('keeps the current folder out, puts git checkouts first and removes repeats', () => {
    const rows = launcherRows({
      current: { path: 'C:\\Work\\Current', name: 'Current', git: false },
      recent: [
        { path: 'C:\\Work\\Alpha', name: 'Alpha' },
        { path: 'C:\\Work\\Beta', name: 'Beta' },
        { path: 'C:\\Work\\Current', name: 'Current' },
      ],
      folders: [
        { path: 'C:\\Work\\Gamma', name: 'Gamma', git: true },
        { path: 'C:\\Work\\Alpha', name: 'Alpha', git: true },
        { path: 'C:\\Work\\Delta', name: 'Delta', git: false },
      ],
    })

    expect(rows.map((row) => row.path)).toEqual([
      'C:\\Work\\Alpha',
      'C:\\Work\\Gamma',
      'C:\\Work\\Beta',
      'C:\\Work\\Delta',
    ])
    expect(rows.map((row) => row.git)).toEqual([true, true, false, false])
    expect(rows[0].source).toBe('recent')
    expect(rows[1].source).toBe('folder')
  })

  it('fills a missing name from the path and ignores empty entries', () => {
    const rows = launcherRows({
      current: { path: '/work/current', git: false },
      recent: [{ path: '/work/one' }, { path: '' }, null],
      folders: [{ path: '/work/two/', name: 'Two' }],
    })

    expect(rows.map((row) => row.name)).toEqual(['one', 'Two'])
  })

  it('answers nothing without a project answer', () => {
    expect(launcherRows(null)).toEqual([])
    expect(launcherRows({})).toEqual([])
  })
})

describe('folder path', () => {
  it('accepts absolute Windows, UNC and POSIX paths', () => {
    expect(absolutePathProblem('C:\\Work\\One')).toBeNull()
    expect(absolutePathProblem('C:/Work/One')).toBeNull()
    expect(absolutePathProblem('\\\\server\\share')).toBeNull()
    expect(absolutePathProblem('//server/share')).toBeNull()
    expect(absolutePathProblem('/work/one')).toBeNull()
  })

  it('refuses an empty or relative path', () => {
    expect(absolutePathProblem('')).toBe('Type the path of a folder.')
    expect(absolutePathProblem('   ')).toBe('Type the path of a folder.')
    expect(absolutePathProblem('work/one')).toBe('Type an absolute folder path.')
    expect(absolutePathProblem('.\\one')).toBe('Type an absolute folder path.')
    expect(absolutePathProblem('C:one')).toBe('Type an absolute folder path.')
    expect(absolutePathProblem('~/one')).toBe('Type an absolute folder path.')
    expect(absolutePathProblem('C:\\one\u0000two')).toBe('Type an absolute folder path.')
  })

  it('takes the last part of a path as its name', () => {
    expect(pathName('C:\\Work\\One')).toBe('One')
    expect(pathName('C:\\Work\\One\\')).toBe('One')
    expect(pathName('/work/one/')).toBe('one')
    expect(pathName('')).toBe('')
  })

  it('compares paths by separator and case on Windows', () => {
    expect(samePath('C:\\Work\\One', 'c:/work/one/')).toBe(true)
    expect(samePath('/work/one/', '/work/one')).toBe(true)
    expect(samePath('/work/One', '/work/one')).toBe(false)
    expect(samePath('', '')).toBe(false)
    expect(samePath('C:\\Work\\One', 'C:\\Work\\Two')).toBe(false)
  })

  it('names the rows and the wait', () => {
    expect(keepWorkingLabel('One')).toBe('Keep working in One')
    expect(openingLabel('One')).toBe('Opening One...')
    expect(LAUNCHER_TIMEOUT_TEXT).toBe('The room did not come back. Run machineroom in that folder.')
  })
})

describe('launcher poll', () => {
  it('polls every 500 ms for up to 30 seconds', () => {
    expect(POLL_INTERVAL_MS).toBe(500)
    expect(POLL_TIMEOUT_MS).toBe(30000)
  })

  it('answers when health is back and the current path is the new one', async () => {
    vi.useFakeTimers()
    try {
      const answers = [
        null,
        { current: { path: 'C:\\Work\\Old' } },
        { current: { path: 'C:\\Work\\New' } },
      ]
      const probe = vi.fn(async () => answers.shift() ?? null)
      const result = pollProject({ probe, path: 'c:/work/new/' })
      await vi.advanceTimersByTimeAsync(1500)
      await expect(result).resolves.toMatchObject({ ok: true })
      expect(probe).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps waiting while the probe throws', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const probe = async () => {
        calls += 1
        if (calls < 3) throw new Error('The bridge is not reachable.')
        return { current: { path: '/work/new' } }
      }
      const result = pollProject({ probe, path: '/work/new' })
      await vi.advanceTimersByTimeAsync(1500)
      await expect(result).resolves.toMatchObject({ ok: true })
      expect(calls).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up after 30 seconds', async () => {
    vi.useFakeTimers()
    try {
      const probe = vi.fn(async () => ({ current: { path: '/work/old' } }))
      const result = pollProject({ probe, path: '/work/new' })
      await vi.advanceTimersByTimeAsync(30000)
      await expect(result).resolves.toEqual({ ok: false, reason: 'timeout' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops when the card closes', async () => {
    vi.useFakeTimers()
    try {
      let stop = false
      const probe = vi.fn(async () => null)
      const result = pollProject({ probe, path: '/work/new', shouldStop: () => stop })
      await vi.advanceTimersByTimeAsync(500)
      stop = true
      await vi.advanceTimersByTimeAsync(500)
      await expect(result).resolves.toEqual({ ok: false, reason: 'cancelled' })
    } finally {
      vi.useRealTimers()
    }
  })
})
