import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { runCheck, TIMEOUT_MESSAGE } from '../server/processTree.js'

function fakeChild() {
  const child = new EventEmitter()
  child.pid = 4242
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

describe('runCheck time limit', () => {
  it('only stops recorded descendants with matching creation times', async () => {
    vi.useFakeTimers()
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      const child = fakeChild()
      const killed = []
      const list = vi.fn()
        .mockReturnValueOnce([
          { pid: 10, ppid: child.pid, created: 100 },
          { pid: 11, ppid: child.pid, created: 200 },
          { pid: 12, ppid: child.pid },
          { pid: 13, ppid: child.pid, created: 300 },
        ])
        .mockReturnValueOnce([
          { pid: 10, ppid: 1, created: 101 },
          { pid: 11, ppid: 1, created: 200 },
          { pid: 12, ppid: 1 },
          { pid: 13, ppid: 1 },
        ])
      const promise = runCheck(['x'], {
        timeoutMs: 2000,
        settleWaitMs: 30,
        spawnChild: () => child,
        kill: () => true,
        list,
        killPid: (pid) => killed.push(pid),
      })
      child.emit('exit', 0)
      await vi.advanceTimersByTimeAsync(2030)
      expect(await promise).toMatchObject({ ok: false, timedOut: true })
      expect(list).toHaveBeenCalledTimes(2)
      expect(killed).toEqual([11])
    } finally {
      Object.defineProperty(process, 'platform', platform)
      vi.useRealTimers()
    }
  })

  it('settles failed within the bounded wait when exit comes but close never does', async () => {
    const child = fakeChild()
    const started = Date.now()
    const promise = runCheck(['x'], {
      timeoutMs: 20,
      settleWaitMs: 60,
      spawnChild: () => child,
      kill: () => {
        child.emit('exit', null, 'SIGKILL')
        return true
      },
    })
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.output).toContain(TIMEOUT_MESSAGE)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('settles failed when cleanup throws', async () => {
    const result = await runCheck(['x'], {
      timeoutMs: 10,
      settleWaitMs: 30,
      spawnChild: fakeChild,
      kill: () => {
        throw new Error('boom')
      },
    })
    expect(result).toMatchObject({ ok: false, timedOut: true })
  })

  it('settles ok on a clean close', async () => {
    const child = fakeChild()
    const promise = runCheck(['x'], { timeoutMs: 1000, spawnChild: () => child })
    child.stdout.emit('data', Buffer.from('hi'))
    child.emit('close', 0)
    expect(await promise).toMatchObject({ ok: true, output: 'hi' })
  })
})
