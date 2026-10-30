import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLaneLock, releaseLaneLock, takeLaneLock, writeLaneChild } from '../scripts/lane-lock.mjs'
import { takeRoomLock } from '../server/orchestrator.js'
import { laneLockText } from '../src/briefs/run.js'
import { makeTempDir } from './helpers/tempRoot.js'

const DEAD_PID = 2147483647

function deadPid() {
  return DEAD_PID
}

function lockPath(folder, lane = 'hermes') {
  return join(folder, `${lane}.lock`)
}

function takeoverPath(folder, lane = 'hermes') {
  return `${lockPath(folder, lane)}.takeover`
}

function sentence(lane, holder, path) {
  return `The ${lane} lane is already running (process ${holder}). Wait for that run to end, or delete ${path} if no run is going.`
}

describe('lane lock', () => {
  it('takes a free lock', () => {
    const folder = makeTempDir('lane-lock-')
    const path = takeLaneLock(folder, 'hermes')
    expect(path).toBe(lockPath(folder))
    expect(readFileSync(path, 'utf8')).toBe(laneLockText({ pid: process.pid }))
    expect(readLaneLock(path)).toEqual({ pid: process.pid, child: null, folder: '' })
  })

  it('writes the worktree beside the pid and the harness child after it starts', () => {
    const folder = makeTempDir('lane-lock-')
    const path = takeLaneLock(folder, 'hermes', { worktree: 'C:\\work\\hermes' })
    expect(readLaneLock(path)).toEqual({ pid: process.pid, child: null, folder: 'C:\\work\\hermes' })
    expect(writeLaneChild(path, 4242)).toBe(true)
    expect(readLaneLock(path)).toEqual({ pid: process.pid, child: 4242, folder: 'C:\\work\\hermes' })
    expect(writeLaneChild(path, 0)).toBe(false)
    const other = lockPath(folder, 'other')
    writeFileSync(other, laneLockText({ pid: process.ppid }))
    expect(writeLaneChild(other, 4242)).toBe(false)
    expect(readLaneLock(other)).toEqual({ pid: process.ppid, child: null, folder: '' })
  })

  it('reads a lock in the old plain pid format', () => {
    const folder = makeTempDir('lane-lock-')
    const path = lockPath(folder)
    writeFileSync(path, String(process.pid))
    expect(readLaneLock(path)).toEqual({ pid: process.pid, child: null, folder: '' })
    expect(readLaneLock(join(folder, 'missing.lock'))).toEqual({ pid: null, child: null, folder: '' })
    writeFileSync(path, 'not a lock')
    expect(readLaneLock(path)).toEqual({ pid: null, child: null, folder: '' })
  })

  it('refuses a lock held by a live process', () => {
    const folder = makeTempDir('lane-lock-')
    const path = lockPath(folder)
    writeFileSync(path, String(process.pid))
    expect(() => takeLaneLock(folder, 'hermes')).toThrow(sentence('hermes', process.pid, path))
    expect(readFileSync(path, 'utf8')).toBe(String(process.pid))
  })

  it('takes a stale lock and leaves no takeover file', () => {
    const folder = makeTempDir('lane-lock-')
    const path = lockPath(folder)
    writeFileSync(path, String(deadPid()))
    const taken = takeLaneLock(folder, 'hermes')
    expect(taken).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe(laneLockText({ pid: process.pid }))
    expect(existsSync(takeoverPath(folder))).toBe(false)
  })

  it('refuses a stale lock that another runner takes between the read and the second try', () => {
    const folder = makeTempDir('lane-lock-')
    const path = lockPath(folder)
    writeFileSync(path, String(deadPid()))
    const other = process.ppid
    const take = () => takeLaneLock(folder, 'hermes', { beforeRetry: () => writeFileSync(path, String(other)) })
    expect(take).toThrow(sentence('hermes', other, path))
    expect(readFileSync(path, 'utf8')).toBe(String(other))
    expect(existsSync(takeoverPath(folder))).toBe(false)
  })

  it('lets exactly one of two takers replace a stale lock', () => {
    const folder = makeTempDir('lane-lock-')
    const path = lockPath(folder)
    writeFileSync(path, String(deadPid()))
    let winner = null
    const first = () => takeLaneLock(folder, 'hermes', {
      beforeRetry: () => {
        winner = takeLaneLock(folder, 'hermes')
      },
    })
    expect(first).toThrow(sentence('hermes', process.pid, path))
    expect(winner).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe(laneLockText({ pid: process.pid }))
    expect(existsSync(takeoverPath(folder))).toBe(false)
  })

  it('refuses a takeover file held by a live process', () => {
    const folder = makeTempDir('lane-lock-')
    const path = lockPath(folder)
    const takeover = takeoverPath(folder)
    const dead = deadPid()
    writeFileSync(path, String(dead))
    writeFileSync(takeover, String(process.pid))
    expect(() => takeLaneLock(folder, 'hermes')).toThrow(sentence('hermes', process.pid, path))
    expect(readFileSync(path, 'utf8')).toBe(String(dead))
    expect(existsSync(takeover)).toBe(true)
  })

  it('removes a stale takeover file and refuses the start', () => {
    const folder = makeTempDir('lane-lock-')
    const path = lockPath(folder)
    const takeover = takeoverPath(folder)
    const dead = deadPid()
    writeFileSync(path, String(dead))
    writeFileSync(takeover, String(dead))
    expect(() => takeLaneLock(folder, 'hermes')).toThrow('Another start of the hermes lane stopped half way. Start it again.')
    expect(existsSync(takeover)).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(String(dead))
  })

  it('removes only its own lock', () => {
    const folder = makeTempDir('lane-lock-')
    const path = takeLaneLock(folder, 'hermes')
    releaseLaneLock(path)
    expect(existsSync(path)).toBe(false)

    writeFileSync(path, String(process.ppid))
    releaseLaneLock(path)
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe(String(process.ppid))
  })

  it('takes a lock when holder was created after lock file last change plus 2 seconds on Windows', () => {
    const folder = makeTempDir('lane-lock-stale-')
    const path = lockPath(folder)
    writeFileSync(path, String(process.pid))
    const taken = takeLaneLock(folder, 'hermes', {
      platform: 'win32',
      stat: () => ({ mtimeMs: 10000 }),
      list: () => [{ pid: process.pid, created: 13000 }],
    })
    expect(taken).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe(laneLockText({ pid: process.pid }))
  })

  it('refuses a lock when holder was created before lock file last change on Windows', () => {
    const folder = makeTempDir('lane-lock-held-')
    const path = lockPath(folder)
    writeFileSync(path, String(process.pid))
    expect(() =>
      takeLaneLock(folder, 'hermes', {
        platform: 'win32',
        stat: () => ({ mtimeMs: 10000 }),
        list: () => [{ pid: process.pid, created: 9000 }],
      }),
    ).toThrow(sentence('hermes', process.pid, path))
  })

  it('refuses a lock when process listing fails on Windows', () => {
    const folder = makeTempDir('lane-lock-fail-')
    const path = lockPath(folder)
    writeFileSync(path, String(process.pid))
    expect(() =>
      takeLaneLock(folder, 'hermes', {
        platform: 'win32',
        stat: () => ({ mtimeMs: 10000 }),
        list: () => [],
      }),
    ).toThrow(sentence('hermes', process.pid, path))
  })

  it('refuses a lock without listing processes away from Windows', () => {
    const folder = makeTempDir('lane-lock-linux-')
    const path = lockPath(folder)
    writeFileSync(path, String(process.pid))
    let listCalled = false
    expect(() =>
      takeLaneLock(folder, 'hermes', {
        platform: 'linux',
        list: () => {
          listCalled = true
          return []
        },
      }),
    ).toThrow(sentence('hermes', process.pid, path))
    expect(listCalled).toBe(false)
  })
})

describe('room lock', () => {
  it('takes a room lock when holder was created after lock file last change plus 2 seconds on Windows', () => {
    const folder = makeTempDir('room-lock-stale-')
    const path = join(folder, 'room.lock')
    writeFileSync(path, String(process.pid))
    const taken = takeRoomLock(path, {
      platform: 'win32',
      stat: () => ({ mtimeMs: 10000 }),
      list: () => [{ pid: process.pid, created: 13000 }],
    })
    expect(taken).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe(String(process.pid))
  })

  it('refuses a room lock when holder was created before lock file last change on Windows', () => {
    const folder = makeTempDir('room-lock-held-')
    const path = join(folder, 'room.lock')
    writeFileSync(path, String(process.pid))
    expect(() =>
      takeRoomLock(path, {
        platform: 'win32',
        stat: () => ({ mtimeMs: 10000 }),
        list: () => [{ pid: process.pid, created: 9000 }],
      }),
    ).toThrow(/Another room is already running on this project/)
  })

  it('refuses a room lock when process listing fails on Windows', () => {
    const folder = makeTempDir('room-lock-fail-')
    const path = join(folder, 'room.lock')
    writeFileSync(path, String(process.pid))
    expect(() =>
      takeRoomLock(path, {
        platform: 'win32',
        stat: () => ({ mtimeMs: 10000 }),
        list: () => [],
      }),
    ).toThrow(/Another room is already running on this project/)
  })

  it('refuses a room lock without listing processes away from Windows', () => {
    const folder = makeTempDir('room-lock-linux-')
    const path = join(folder, 'room.lock')
    writeFileSync(path, String(process.pid))
    let listCalled = false
    expect(() =>
      takeRoomLock(path, {
        platform: 'linux',
        list: () => {
          listCalled = true
          return []
        },
      }),
    ).toThrow(/Another room is already running on this project/)
    expect(listCalled).toBe(false)
  })
})
