import { afterEach, describe, expect, it, vi } from 'vitest'
import { cardClickEndsFollow, createLater, followAfterSeek } from '../src/engine/room.js'

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
