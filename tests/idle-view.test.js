import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDLE_AFTER_MS, IDLE_EVENTS, createIdleWatch, idleAllowed, stageClassName } from '../src/ui/idleView.js'

const allowed = {
  width: 1280,
  scrollY: 0,
  panelOpen: false,
  focusedInput: false,
  following: false,
  holding: false,
  still: false,
}

function fakeTarget() {
  const listeners = new Map()
  return {
    addEventListener(type, fn, options) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push({ fn, options })
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type)
      if (!list) return
      const index = list.findIndex((entry) => entry.fn === fn)
      if (index !== -1) list.splice(index, 1)
    },
    emit(type, event = {}) {
      for (const entry of [...(listeners.get(type) ?? [])]) entry.fn(event)
    },
    count() {
      let total = 0
      for (const list of listeners.values()) total += list.length
      return total
    },
    options(type) {
      return listeners.get(type)?.[0]?.options
    },
  }
}

function fakeDoc(hidden = false) {
  const target = fakeTarget()
  return {
    hidden,
    addEventListener: target.addEventListener,
    removeEventListener: target.removeEventListener,
    emit: target.emit,
    count: target.count,
  }
}

function watchWith(target, doc, isAllowed = () => true) {
  const seen = []
  const watch = createIdleWatch({
    isAllowed,
    onIdle: (on) => seen.push(on),
    target,
    doc,
  })
  return { watch, seen }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('idleAllowed', () => {
  it('allows the calm view at 900 pixels and wider with the page at its top', () => {
    expect(idleAllowed(allowed)).toBe(true)
    expect(idleAllowed({ ...allowed, width: 900 })).toBe(true)
  })

  it('refuses each reason', () => {
    expect(idleAllowed()).toBe(false)
    expect(idleAllowed({ ...allowed, width: 899 })).toBe(false)
    expect(idleAllowed({ ...allowed, scrollY: 1 })).toBe(false)
    expect(idleAllowed({ ...allowed, panelOpen: true })).toBe(false)
    expect(idleAllowed({ ...allowed, focusedInput: true })).toBe(false)
    expect(idleAllowed({ ...allowed, following: true })).toBe(false)
    expect(idleAllowed({ ...allowed, holding: true })).toBe(false)
    expect(idleAllowed({ ...allowed, still: true })).toBe(false)
  })

  it('keeps the view for a missing or narrower width', () => {
    expect(idleAllowed({ ...allowed, width: undefined })).toBe(false)
    expect(idleAllowed({ ...allowed, width: 'wide' })).toBe(false)
    expect(idleAllowed({ ...allowed, scrollY: undefined })).toBe(false)
  })
})

describe('stage class', () => {
  it('adds is-idle only to a connected room', () => {
    expect(stageClassName()).toBe('stage')
    expect(stageClassName({ idle: true })).toBe('stage is-idle')
    expect(stageClassName({ idle: true, disconnected: true })).toBe('stage is-disconnected')
    expect(stageClassName({ disconnected: true })).toBe('stage is-disconnected')
  })
})

describe('idle watch', () => {
  it('starts the view after 60 seconds', () => {
    const target = fakeTarget()
    const { watch, seen } = watchWith(target, fakeDoc())
    try {
      vi.advanceTimersByTime(IDLE_AFTER_MS - 1)
      expect(seen).toEqual([])
      vi.advanceTimersByTime(1)
      expect(seen).toEqual([true])
    } finally {
      watch.stop()
    }
  })

  it('listens for every event on the window, in capture and passive', () => {
    const target = fakeTarget()
    const { watch } = watchWith(target, fakeDoc())
    try {
      for (const type of IDLE_EVENTS) {
        const options = target.options(type)
        expect(options?.capture).toBe(true)
        expect(options?.passive).toBe(true)
      }
    } finally {
      watch.stop()
    }
  })

  it('wakes at once on each event and restarts the timer', () => {
    for (const type of IDLE_EVENTS) {
      const target = fakeTarget()
      const { watch, seen } = watchWith(target, fakeDoc())
      try {
        vi.advanceTimersByTime(IDLE_AFTER_MS)
        expect(seen).toEqual([true])
        const event = { type, preventDefault: vi.fn() }
        target.emit(type, event)
        expect(seen).toEqual([true, false])
        expect(event.preventDefault).not.toHaveBeenCalled()
        vi.advanceTimersByTime(IDLE_AFTER_MS - 1)
        expect(seen).toEqual([true, false])
        vi.advanceTimersByTime(1)
        expect(seen).toEqual([true, false, true])
      } finally {
        watch.stop()
      }
    }
  })

  it('starts the timer again when the view is not allowed', () => {
    const target = fakeTarget()
    let open = true
    const { watch, seen } = watchWith(target, fakeDoc(), () => !open)
    try {
      vi.advanceTimersByTime(IDLE_AFTER_MS)
      expect(seen).toEqual([])
      open = false
      vi.advanceTimersByTime(IDLE_AFTER_MS - 1)
      expect(seen).toEqual([])
      vi.advanceTimersByTime(1)
      expect(seen).toEqual([true])
    } finally {
      watch.stop()
    }
  })

  it('removes the listeners and the timer on cleanup', () => {
    const target = fakeTarget()
    const doc = fakeDoc()
    const { watch, seen } = watchWith(target, doc)
    expect(target.count()).toBe(IDLE_EVENTS.length)
    expect(doc.count()).toBe(1)
    watch.stop()
    expect(target.count()).toBe(0)
    expect(doc.count()).toBe(0)
    vi.advanceTimersByTime(IDLE_AFTER_MS)
    expect(seen).toEqual([])
  })

  it('does not turn a hidden page', () => {
    const target = fakeTarget()
    const doc = fakeDoc(true)
    const { watch, seen } = watchWith(target, doc)
    try {
      vi.advanceTimersByTime(IDLE_AFTER_MS)
      expect(seen).toEqual([])
    } finally {
      watch.stop()
    }
  })

  it('wakes a page that goes hidden and starts again when it comes back', () => {
    const target = fakeTarget()
    const doc = fakeDoc()
    const { watch, seen } = watchWith(target, doc)
    try {
      vi.advanceTimersByTime(IDLE_AFTER_MS)
      expect(seen).toEqual([true])
      doc.hidden = true
      doc.emit('visibilitychange')
      expect(seen).toEqual([true, false])
      vi.advanceTimersByTime(IDLE_AFTER_MS)
      expect(seen).toEqual([true, false])
      doc.hidden = false
      doc.emit('visibilitychange')
      vi.advanceTimersByTime(IDLE_AFTER_MS)
      expect(seen).toEqual([true, false, true])
      target.emit('pointermove')
      expect(seen).toEqual([true, false, true, false])
    } finally {
      watch.stop()
    }
  })

  it('arms the timer again when the link returns, with no new input', () => {
    const target = fakeTarget()
    const doc = fakeDoc()
    const { watch, seen } = watchWith(target, doc)
    try {
      vi.advanceTimersByTime(IDLE_AFTER_MS)
      expect(seen).toEqual([true])
      watch.halt()
      expect(seen).toEqual([true, false])
      vi.advanceTimersByTime(IDLE_AFTER_MS * 2)
      expect(seen).toEqual([true, false])
      watch.arm()
      vi.advanceTimersByTime(IDLE_AFTER_MS - 1)
      expect(seen).toEqual([true, false])
      vi.advanceTimersByTime(1)
      expect(seen).toEqual([true, false, true])
    } finally {
      watch.stop()
    }
  })

  it('arms the timer again when the 60 second timer ends while the page is hidden', () => {
    const target = fakeTarget()
    const doc = fakeDoc()
    const { watch, seen } = watchWith(target, doc)
    try {
      vi.advanceTimersByTime(IDLE_AFTER_MS - 1)
      doc.hidden = true
      vi.advanceTimersByTime(1)
      expect(seen).toEqual([])
      vi.advanceTimersByTime(IDLE_AFTER_MS * 2)
      expect(seen).toEqual([])
      doc.hidden = false
      doc.emit('visibilitychange')
      vi.advanceTimersByTime(IDLE_AFTER_MS - 1)
      expect(seen).toEqual([])
      vi.advanceTimersByTime(1)
      expect(seen).toEqual([true])
    } finally {
      watch.stop()
    }
  })

  it('keeps a halted watch halted when the page hides and shows again', () => {
    const target = fakeTarget()
    const doc = fakeDoc()
    const { watch, seen } = watchWith(target, doc)
    try {
      watch.halt()
      doc.hidden = true
      doc.emit('visibilitychange')
      doc.hidden = false
      doc.emit('visibilitychange')
      vi.advanceTimersByTime(IDLE_AFTER_MS * 2)
      expect(seen).toEqual([])
      watch.arm()
      vi.advanceTimersByTime(IDLE_AFTER_MS)
      expect(seen).toEqual([true])
    } finally {
      watch.stop()
    }
  })
})
