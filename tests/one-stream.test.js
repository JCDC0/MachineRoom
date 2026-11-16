import { describe, expect, it } from 'vitest'
import { createClient } from '../src/control/client.js'
import { createNoticeRelay, openBridge } from '../src/live/bridge.js'

function page(url = 'http://bridge') {
  const sources = []
  const timers = []
  class FakeSource {
    constructor(target) {
      this.url = target
      this.readyState = 0
      this.listeners = new Map()
      this.closed = false
      sources.push(this)
    }

    addEventListener(name, handler) {
      const handlers = this.listeners.get(name) ?? []
      handlers.push(handler)
      this.listeners.set(name, handlers)
    }

    emit(name, data) {
      for (const handler of this.listeners.get(name) ?? []) handler({ data })
    }

    close() {
      this.closed = true
      this.readyState = 2
    }
  }
  const notices = createNoticeRelay()
  const link = openBridge({
    url,
    EventSourceImpl: FakeSource,
    onFrame: () => {},
    onTree: () => {},
    onStatus: () => {},
    onNotice: notices.push,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimer: () => {},
  })
  const client = createClient({
    baseUrl: url,
    EventSourceImpl: FakeSource,
    notices,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimer: () => {},
  })
  const seen = []
  const unsubscribe = client.subscribe((event) => seen.push(event))
  return { client, link, notices, seen, sources, timers, unsubscribe }
}

describe('one event stream a page', () => {
  it('opens exactly one EventSource for the frames and the control notices', () => {
    const room = page()
    expect(room.sources).toHaveLength(1)
    expect(room.sources[0].url).toBe('http://bridge/events?history=1&tree=folders')
    room.unsubscribe()
    room.link.close()
  })

  it('reaches the control client from a change notice on the frame stream', () => {
    const room = page()
    room.sources[0].emit('change', JSON.stringify({ topic: 'agents', id: 'agent-1' }))
    expect(room.seen).toEqual([{ topic: 'agents', id: 'agent-1' }])
    room.unsubscribe()
    room.link.close()
  })

  it('keeps notices arriving after the frame stream reconnects', () => {
    const room = page()
    room.sources[0].readyState = 2
    room.sources[0].emit('change', JSON.stringify({ topic: 'git' }))
    room.sources[0].onerror()
    expect(room.sources).toHaveLength(1)
    room.timers.at(-1).fn()
    expect(room.sources).toHaveLength(2)
    room.sources[1].emit('change', JSON.stringify({ topic: 'costs' }))
    expect(room.seen).toEqual([{ topic: 'git' }, { topic: 'costs' }])
    room.unsubscribe()
    room.link.close()
  })

  it('closes the one stream when the page closes it and stops the notices', () => {
    const room = page()
    room.unsubscribe()
    room.link.close()
    expect(room.sources).toHaveLength(1)
    expect(room.sources[0].closed).toBe(true)
    room.sources[0].emit('change', JSON.stringify({ topic: 'agents' }))
    expect(room.seen).toEqual([])
    room.sources[0].onerror()
    expect(room.timers).toEqual([])
  })
})
