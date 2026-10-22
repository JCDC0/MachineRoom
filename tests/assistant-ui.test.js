import { describe, expect, it } from 'vitest'
import { appendEntries, MAX_ENTRIES } from '../src/ui/Assistant.jsx'
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
  const size = { width: 380, height: 280 }
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
      y: 800 - 280,
    })
  })

  it('handles small window sizes where terminal exceeds viewport', () => {
    const smallWin = { windowWidth: 300, windowHeight: 200 }
    expect(clampPosition({ x: 50, y: 50 }, size, smallWin)).toEqual({ x: 0, y: 0 })
  })

  it('calculates a valid default position above the transport bar on the right', () => {
    const pos = getDefaultPosition(size, win)
    expect(pos.x).toBe(1280 - 380 - 16)
    expect(pos.y).toBe(800 - 280 - 88)

    const smallerPos = getDefaultPosition(size, { windowWidth: 1024, windowHeight: 768 })
    expect(smallerPos.x).toBe(1024 - 380 - 16)
    expect(smallerPos.y).toBe(768 - 280 - 88)
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
      y: 800 - 280,
    })
    expect(getDefaultPosition(zeroSize, win)).toEqual({
      x: 1280 - 380 - 16,
      y: 800 - 280 - 88,
    })
  })
})

describe('assistant log entries', () => {
  it('keeps the order of the entries it is given', () => {
    const list = [{ id: 'a' }, { id: 'b' }]
    expect(appendEntries(list, { id: 'c' }, { id: 'd' })).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      { id: 'd' },
    ])
  })

  it('drops the oldest entries past the limit', () => {
    expect(MAX_ENTRIES).toBe(200)
    const list = Array.from({ length: MAX_ENTRIES }, (_, i) => ({ id: `old-${i}` }))
    const next = appendEntries(list, { id: 'new-1' }, { id: 'new-2' })
    expect(next).toHaveLength(MAX_ENTRIES)
    expect(next[0]).toEqual({ id: 'old-2' })
    expect(next[MAX_ENTRIES - 2]).toEqual({ id: 'new-1' })
    expect(next[MAX_ENTRIES - 1]).toEqual({ id: 'new-2' })
  })

  it('drops the oldest entries of a list that is already past the limit', () => {
    const list = Array.from({ length: MAX_ENTRIES + 50 }, (_, i) => ({ id: `old-${i}` }))
    const next = appendEntries(list)
    expect(next).toHaveLength(MAX_ENTRIES)
    expect(next[0]).toEqual({ id: 'old-50' })
    expect(next[MAX_ENTRIES - 1]).toEqual({ id: 'old-249' })
  })

  it('does not change the list it is given', () => {
    const list = [{ id: 'a' }]
    const next = appendEntries(list, { id: 'b' })
    expect(list).toEqual([{ id: 'a' }])
    expect(next).not.toBe(list)
    expect(next).toHaveLength(2)
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
