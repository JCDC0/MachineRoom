import { afterEach, describe, expect, it, vi } from 'vitest'
import { cardClickEndsFollow, createFollowFocus, createLater, createWorkingMaskCache, followAfterSeek } from '../src/engine/room.js'

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
})

describe('the follow focus', () => {
  it('clears the focused agent when follow ends', () => {
    const room = createFollowFocus()
    room.focus('agent3')
    room.setFollowing('wide')
    expect(room.focused()).toBe('agent3')
    expect(room.end()).toBe(true)
    expect(room.following()).toBe(false)
    expect(room.focused()).toBeNull()
  })

  it('clears the focused agent when focus names no agent view', () => {
    const room = createFollowFocus()
    room.focus('agent3')
    room.focus(null, false)
    expect(room.focused()).toBeNull()
  })

  it('keeps the focused agent when follow is already off', () => {
    const room = createFollowFocus()
    room.focus('agent3')
    expect(room.end()).toBe(false)
    expect(room.focused()).toBe('agent3')
  })
})

describe('cardClickEndsFollow', () => {
  const target = (...names) => ({
    closest: (selector) => (names.some((name) => selector.includes(name)) ? {} : null),
  })

  it('ends follow on a card head and on a card row', () => {
    expect(cardClickEndsFollow(target('.mr-card-head'))).toBe(true)
    expect(cardClickEndsFollow(target('.mr-item'))).toBe(true)
  })

  it('leaves follow on for a click on the HUD and for no target', () => {
    expect(cardClickEndsFollow(target('.hud'))).toBe(false)
    expect(cardClickEndsFollow(null)).toBe(false)
    expect(cardClickEndsFollow({})).toBe(false)
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
