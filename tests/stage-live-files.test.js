import { describe, expect, it } from 'vitest'
import { afterIdle, touchedFiles } from '../src/Stage.jsx'

describe('the paths a live frame hands to the pipeline', () => {
  it('keeps only the file touches, each once', () => {
    const activities = [
      {
        type: 'tool.start',
        touches: [
          { kind: 'file', path: 'src/a.js' },
          { kind: 'dir', path: 'src' },
          { kind: 'file', path: 'src/a.js' },
          { kind: 'file', path: 'src/b.js' },
        ],
      },
      { type: 'tool.end', touches: [{ kind: 'file', path: 'src/c.js' }] },
      { type: 'run.start' },
    ]
    expect(touchedFiles(activities)).toEqual(['src/a.js', 'src/b.js'])
    expect(touchedFiles([])).toEqual([])
  })
})

describe('warming the pipeline after the first frame', () => {
  it('uses an idle callback when the window has one', () => {
    const calls = []
    const win = {
      requestIdleCallback(callback, options) {
        calls.push(options)
        callback()
        return 7
      },
      cancelIdleCallback(id) {
        calls.push(id)
      },
    }
    const stop = afterIdle(() => calls.push('warm'), win)
    expect(calls).toEqual([{ timeout: 2000 }, 'warm'])
    stop()
    expect(calls).toEqual([{ timeout: 2000 }, 'warm', 7])
  })

  it('uses a timer when the window has no idle callback', () => {
    const calls = []
    const win = {
      setTimeout(callback) {
        calls.push(callback)
        return 3
      },
      clearTimeout(id) {
        calls.push(id)
      },
    }
    const stop = afterIdle(() => calls.push('warm'), win)
    expect(calls).toHaveLength(1)
    calls[0]()
    expect(calls).toContain('warm')
    stop()
    expect(calls).toContain(3)
  })

  it('does nothing without a window', () => {
    expect(afterIdle(() => {}, null)).toBeTypeOf('function')
  })
})
