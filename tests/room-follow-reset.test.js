import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFollowFocus, createLater, createWorkingMaskCache, followAfterSeek, inspectorNamesPath, noteTouch, TOUCH_ENTRY_LIMIT, TOUCH_PATH_LIMIT } from '../src/engine/room.js'

function state(status, focus, recent = []) {
  return {
    files: new Map([['src/engine/room.js', { path: 'src/engine/room.js', exists: true }]]),
    agents: new Map([['opencode', { key: 'opencode', status, focus }]]),
    recent,
  }
}

describe('followAfterSeek', () => {
  it('clears the followed card and the pending path, then aims at the card touched after the seek', () => {
    const working = state('working', ['src/engine/room.js'], ['src/engine/room.js'])
    expect(followAfterSeek(working, 'wide')).toEqual({
      followCard: null,
      pendingFollow: null,
      path: 'src/engine',
    })
    expect(followAfterSeek(working, 'close').path).toBe('src/engine')
  })

  it('keeps the follow target empty when nobody works in the new state', () => {
    const idle = state('done', ['src/engine/room.js'], ['src/engine/room.js'])
    expect(followAfterSeek(idle, 'wide')).toEqual({
      followCard: null,
      pendingFollow: null,
      path: null,
    })
  })

  it('clears both fields when follow mode is off', () => {
    const working = state('working', ['src/engine/room.js'], ['src/engine/room.js'])
    expect(followAfterSeek(working, false)).toEqual({
      followCard: null,
      pendingFollow: null,
      path: null,
    })
  })
})

describe('the working mask', () => {
  const working = (focus, status = 'working', latest = 10) => ({
    latest,
    files: new Map([['src/a.js', { path: 'src/a.js', exists: true }]]),
    agents: new Map([['hermes', { key: 'hermes', status, focus }]]),
  })

  it('builds once over idle frames and again when an agent, a focus or the activity changes', () => {
    const cache = createWorkingMaskCache()
    const state = working(['src/a.js'])
    const mask = cache.of(state)
    expect(mask).toEqual({ dimmed: true, lit: new Set(['', 'src']), targeted: new Set(['src']) })
    for (let frame = 0; frame < 5; frame += 1) expect(cache.of(state)).toBe(mask)
    expect(cache.builds()).toBe(1)
    state.latest = 11
    expect(cache.of(state)).not.toBe(mask)
    expect(cache.builds()).toBe(2)
    state.agents.get('hermes').focus = ['docs/b.md']
    cache.of(state)
    expect(cache.builds()).toBe(3)
    state.agents.get('hermes').status = 'done'
    const idle = cache.of(state)
    expect(idle.dimmed).toBe(false)
    expect(cache.builds()).toBe(4)
    for (let frame = 0; frame < 5; frame += 1) expect(cache.of(state)).toBe(idle)
    expect(cache.builds()).toBe(4)
  })

  it('lights a working path only, not a recent touch or an idle agent', () => {
    const cache = createWorkingMaskCache()
    const state = working(['src/a.js'])
    state.recent = ['docs/b.md']
    state.agents.set('claude', { key: 'claude', status: 'done', focus: ['docs/b.md'] })
    const mask = cache.of(state)
    expect(mask.lit).toEqual(new Set(['', 'src']))
    expect(mask.lit.has('docs')).toBe(false)
    expect(mask.targeted).toEqual(new Set(['src']))
  })
})

describe('the follow focus', () => {
  it('clears the focused agent when focus names no agent view', () => {
    const room = createFollowFocus()
    room.focus('agent3')
    room.focus(null, false)
    expect(room.focused()).toBeNull()
  })

  it('keeps the focused agent when follow is off', () => {
    const room = createFollowFocus()
    room.focus('agent3')
    expect(room.following()).toBe(false)
    expect(room.focused()).toBe('agent3')
  })
})

describe('the touch log', () => {
  const touch = (key = 'a') => ({ key, mode: 'read', time: 1 })

  it('keeps at most the path limit and drops the least recently touched path', () => {
    const log = new Map()
    for (let index = 0; index < TOUCH_PATH_LIMIT; index += 1) noteTouch(log, `src/f${index}.js`, touch())
    expect(log.size).toBe(TOUCH_PATH_LIMIT)
    noteTouch(log, 'src/f0.js', touch())
    noteTouch(log, 'src/fresh.js', touch())
    expect(log.size).toBe(TOUCH_PATH_LIMIT)
    expect(log.has('src/f1.js')).toBe(false)
    expect(log.has('src/f0.js')).toBe(true)
    expect(log.has('src/fresh.js')).toBe(true)
  })

  it('keeps the newest entries for one path', () => {
    const log = new Map()
    for (let index = 0; index < TOUCH_ENTRY_LIMIT + 10; index += 1) {
      noteTouch(log, 'src/a.js', { key: 'a', mode: 'read', time: index })
    }
    const list = log.get('src/a.js')
    expect(list).toHaveLength(TOUCH_ENTRY_LIMIT)
    expect(list[0].time).toBe(10)
    expect(list.at(-1).time).toBe(TOUCH_ENTRY_LIMIT + 9)
  })

  it('takes its own limits for a small test log', () => {
    const log = new Map()
    noteTouch(log, 'a', touch(), 2, 2)
    noteTouch(log, 'b', touch(), 2, 2)
    noteTouch(log, 'a', touch(), 2, 2)
    noteTouch(log, 'c', touch(), 2, 2)
    expect([...log.keys()]).toEqual(['a', 'c'])
  })
})

describe('inspectorNamesPath', () => {
  it('names the card itself, a folder below it and a file on it', () => {
    expect(inspectorNamesPath({ kind: 'folder', id: 'lib/a' }, 'lib/a')).toBe(true)
    expect(inspectorNamesPath({ kind: 'folder', id: 'lib/a/c' }, 'lib/a')).toBe(true)
    expect(inspectorNamesPath({ kind: 'file', id: 'lib/a/x.js' }, 'lib/a')).toBe(true)
    expect(inspectorNamesPath({ kind: 'folder', id: 'lib/a' }, 'lib')).toBe(true)
  })

  it('leaves a sibling, a lookalike name and another kind alone', () => {
    expect(inspectorNamesPath({ kind: 'folder', id: 'lib/b' }, 'lib/a')).toBe(false)
    expect(inspectorNamesPath({ kind: 'file', id: 'lib/ax.js' }, 'lib/a')).toBe(false)
    expect(inspectorNamesPath({ kind: 'agent', id: 'claude' }, 'lib/a')).toBe(false)
    expect(inspectorNamesPath({ kind: 'internet', id: 'internet' }, 'lib/a')).toBe(false)
    expect(inspectorNamesPath(null, 'lib/a')).toBe(false)
  })
})

describe('createLater', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops a scheduled label when a seek clears the pending timers', () => {
    vi.useFakeTimers()
    const calls = []
    const timers = createLater()
    timers.later(() => calls.push('old label'))
    vi.advanceTimersByTime(250)
    expect(calls).toEqual(['old label'])
    timers.later(() => calls.push('stale label'))
    timers.clear()
    vi.advanceTimersByTime(250)
    expect(calls).toEqual(['old label'])
  })
})
