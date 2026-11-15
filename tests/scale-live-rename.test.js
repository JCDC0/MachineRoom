import { describe, expect, it } from 'vitest'
import { renameWithRetry } from '../scripts/scale-live.mjs'

function renameError(code) {
  const error = new Error(`${code}: operation not permitted, rename 'a' -> 'b'`)
  error.code = code
  return error
}

describe('renameWithRetry', () => {
  it('works when a rename fails twice with EPERM', () => {
    const waits = []
    let calls = 0
    const rename = () => {
      calls += 1
      if (calls <= 2) throw renameError('EPERM')
    }
    expect(() => renameWithRetry('a', 'b', { rename, wait: (ms) => waits.push(ms) })).not.toThrow()
    expect(calls).toBe(3)
    expect(waits).toEqual([100, 100])
  })

  it('throws the last EPERM after ten tries', () => {
    const error = renameError('EPERM')
    const waits = []
    let calls = 0
    const rename = () => {
      calls += 1
      throw error
    }
    let caught = null
    try {
      renameWithRetry('a', 'b', { rename, wait: (ms) => waits.push(ms) })
    } catch (thrown) {
      caught = thrown
    }
    expect(caught).toBe(error)
    expect(calls).toBe(10)
    expect(waits).toEqual(Array(9).fill(100))
  })

  it('throws ENOENT at once', () => {
    let calls = 0
    const rename = () => {
      calls += 1
      throw renameError('ENOENT')
    }
    expect(() => renameWithRetry('a', 'b', { rename, wait: () => {} })).toThrow(/ENOENT/)
    expect(calls).toBe(1)
  })
})
