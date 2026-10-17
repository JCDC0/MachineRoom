import { describe, expect, it } from 'vitest'
import {
  addToHistory,
  BLOCKED_MASK,
  clampPosition,
  DOCK_BREAKPOINT,
  formatCommandLine,
  getBlockedCommandLine,
  getBlockedHistoryEntry,
  getBlockedSay,
  getDefaultPosition,
  isDocked,
  MAX_HISTORY,
  stepHistory,
} from '../src/ui/assistantHistory.js'

describe('history ring', () => {
  it('appends items up to 20', () => {
    let history = []
    for (let i = 1; i <= 20; i++) {
      history = addToHistory(history, `line-${i}`)
    }
    expect(history).toHaveLength(20)
    expect(history[0]).toBe('line-1')
    expect(history[19]).toBe('line-20')
  })

  it('drops the oldest item when exceeding 20 lines', () => {
    let history = []
    for (let i = 1; i <= 25; i++) {
      history = addToHistory(history, `cmd-${i}`)
    }
    expect(history).toHaveLength(MAX_HISTORY)
    expect(history[0]).toBe('cmd-6')
    expect(history[19]).toBe('cmd-25')
  })

  it('ignores empty lines and whitespace but preserves [hidden]', () => {
    const start = ['one']
    expect(addToHistory(start, '')).toEqual(['one'])
    expect(addToHistory(start, '   ')).toEqual(['one'])
    expect(addToHistory(start, null)).toEqual(['one'])
    expect(addToHistory(start, undefined)).toEqual(['one'])
    expect(addToHistory(start, BLOCKED_MASK)).toEqual(['one', BLOCKED_MASK])
  })

  it('navigates history backward with up and forward with down', () => {
    const history = ['first', 'second', 'third']

    const step1 = stepHistory(history, -1, 'up', 'my draft')
    expect(step1).toEqual({ index: 2, value: 'third' })

    const step2 = stepHistory(history, step1.index, 'up', 'my draft')
    expect(step2).toEqual({ index: 1, value: 'second' })

    const step3 = stepHistory(history, step2.index, 'up', 'my draft')
    expect(step3).toEqual({ index: 0, value: 'first' })

    const step4 = stepHistory(history, step3.index, 'up', 'my draft')
    expect(step4).toEqual({ index: 0, value: 'first' })

    const down1 = stepHistory(history, step4.index, 'down', 'my draft')
    expect(down1).toEqual({ index: 1, value: 'second' })

    const down2 = stepHistory(history, down1.index, 'down', 'my draft')
    expect(down2).toEqual({ index: 2, value: 'third' })

    const down3 = stepHistory(history, down2.index, 'down', 'my draft')
    expect(down3).toEqual({ index: -1, value: 'my draft' })

    const down4 = stepHistory(history, down3.index, 'down', 'my draft')
    expect(down4).toEqual({ index: -1, value: 'my draft' })
  })

  it('handles empty history navigation safely', () => {
    expect(stepHistory([], -1, 'up', 'draft')).toEqual({ index: -1, value: 'draft' })
    expect(stepHistory([], -1, 'down', 'draft')).toEqual({ index: -1, value: 'draft' })
  })

  it('preserves draft when stepping down from index -1 with non-empty history', () => {
    const history = ['alpha', 'beta']
    expect(stepHistory(history, -1, 'down', 'current input')).toEqual({
      index: -1,
      value: 'current input',
    })
  })
})

describe('position clamp', () => {
  const size = { width: 380, height: 320 }
  const win = { windowWidth: 1280, windowHeight: 800 }

  it('keeps positions inside viewport bounds', () => {
    expect(clampPosition({ x: 100, y: 100 }, size, win)).toEqual({ x: 100, y: 100 })
  })

  it('clamps negative coordinates to zero', () => {
    expect(clampPosition({ x: -50, y: -20 }, size, win)).toEqual({ x: 0, y: 0 })
  })

  it('clamps right and bottom edges to window boundaries', () => {
    expect(clampPosition({ x: 2000, y: 1500 }, size, win)).toEqual({
      x: 1280 - 380,
      y: 800 - 320,
    })
  })

  it('handles small window sizes where terminal exceeds viewport', () => {
    const smallWin = { windowWidth: 300, windowHeight: 200 }
    expect(clampPosition({ x: 50, y: 50 }, size, smallWin)).toEqual({ x: 0, y: 0 })
  })

  it('calculates a valid default position', () => {
    const pos = getDefaultPosition(size, win)
    expect(pos.x).toBe(1280 - 380 - 24)
    expect(pos.y).toBe(72)
  })

  it('identifies dock threshold under 900px', () => {
    expect(isDocked(899)).toBe(true)
    expect(isDocked(900)).toBe(false)
    expect(isDocked(1024)).toBe(false)
    expect(DOCK_BREAKPOINT).toBe(900)
  })

  it('falls back to DEFAULT_TERMINAL_SIZE when width or height is zero or invalid', () => {
    const zeroSize = { width: 0, height: 0 }
    expect(clampPosition({ x: 2000, y: 1500 }, zeroSize, win)).toEqual({
      x: 1280 - 380,
      y: 800 - 320,
    })
    expect(getDefaultPosition(zeroSize, win)).toEqual({
      x: 1280 - 380 - 24,
      y: 72,
    })
  })
})

describe('blocked result helpers', () => {
  it('returns [hidden] as the blocked history entry', () => {
    expect(getBlockedHistoryEntry()).toBe('[hidden]')
    expect(getBlockedCommandLine()).toBe('[hidden]')
  })

  it('returns say from result or a safe fallback', () => {
    expect(getBlockedSay({ say: 'Key blocked.' })).toBe('Key blocked.')
    expect(getBlockedSay(null)).toBe('That looks like a key. I never read keys.')
  })

  it('masks command text only when blocked', () => {
    expect(formatCommandLine('what is agy doing', false)).toBe('what is agy doing')
    expect(formatCommandLine('secret-token-1234567890', true)).toBe('[hidden]')
  })
})
