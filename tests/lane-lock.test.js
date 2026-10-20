import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { releaseLaneLock, takeLaneLock } from '../scripts/lane-lock.mjs'
import { makeTempDir } from './helpers/tempRoot.js'

function deadPid() {
  return spawnSync(process.execPath, ['-e', ''], { windowsHide: true }).pid
}

function lockPath(folder, lane = 'hermes') {
  return join(folder, `${lane}.lock`)
}

function sentence(lane, holder, path) {
  return `The ${lane} lane is already running (process ${holder}). Wait for that run to end, or delete ${path} if no run is going.`
}

describe('lane lock', () => {
  it('takes a free lock', () => {
    const folder = makeTempDir('lane-lock-')
    const path = takeLaneLock(folder, 'hermes')
    expect(path).toBe(lockPath(folder))
    expect(readFileSync(path, 'utf8')).toBe(String(process.pid))
  })

  it('refuses a lock held by a live process', () => {
    const folder = makeTempDir('lane-lock-')
    const path = lockPath(folder)
    writeFileSync(path, String(process.pid))
    expect(() => takeLaneLock(folder, 'hermes')).toThrow(sentence('hermes', process.pid, path))
    expect(readFileSync(path, 'utf8')).toBe(String(process.pid))
  })

  it('takes a stale lock', () => {
    const folder = makeTempDir('lane-lock-')
    const path = lockPath(folder)
    writeFileSync(path, String(deadPid()))
    const taken = takeLaneLock(folder, 'hermes')
    expect(taken).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe(String(process.pid))
  })

  it('refuses a stale lock that another runner takes between the read and the second try', () => {
    const folder = makeTempDir('lane-lock-')
    const path = lockPath(folder)
    writeFileSync(path, String(deadPid()))
    const other = process.ppid
    const take = () => takeLaneLock(folder, 'hermes', { beforeRetry: () => writeFileSync(path, String(other)) })
    expect(take).toThrow(sentence('hermes', other, path))
    expect(readFileSync(path, 'utf8')).toBe(String(other))
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
})
