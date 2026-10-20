import { describe, expect, it } from 'vitest'
import { STREAM_LIMIT, STREAM_START, createClient } from '../src/control/client.js'

function harness() {
  const sources = []
  const timers = []
  const cleared = []
  class FakeSource {
    constructor(url) {
      this.url = url
      this.readyState = 0
      this.handlers = new Map()
      this.closed = false
      sources.push(this)
    }

    addEventListener(name, handler) {
      const handlers = this.handlers.get(name) ?? []
      handlers.push(handler)
      this.handlers.set(name, handlers)
    }

    emit(name) {
      for (const handler of this.handlers.get(name) ?? []) handler({})
    }

    open() {
      this.readyState = 1
      this.emit('open')
    }

    giveUp() {
      this.readyState = 2
      this.emit('error')
    }

    close() {
      this.closed = true
      this.readyState = 2
    }
  }
  const client = createClient({
    baseUrl: 'http://bridge/',
    EventSourceImpl: FakeSource,
    setTimer: (fn, ms) => {
      const id = timers.length + 1
      timers.push({ id, fn, ms })
      return id
    },
    clearTimer: (id) => cleared.push(id),
  })
  return { client, sources, timers, cleared }
}

describe('control client change stream', () => {
  it('opens the stream again after 1 second, doubling up to 15 seconds', () => {
    const { client, sources, timers } = harness()
    const unsubscribe = client.subscribe(() => {})
    expect(sources.map((source) => source.url)).toEqual(['http://bridge/events'])
    sources[0].giveUp()
    for (let round = 0; round < 5; round += 1) {
      timers.at(-1).fn()
      sources.at(-1).giveUp()
    }
    expect(timers.map((timer) => timer.ms)).toEqual([STREAM_START, 2000, 4000, 8000, STREAM_LIMIT, STREAM_LIMIT])
    expect(sources).toHaveLength(6)
    unsubscribe()
  })

  it('starts at 1 second again after the stream opens', () => {
    const { client, sources, timers } = harness()
    const unsubscribe = client.subscribe(() => {})
    sources[0].giveUp()
    timers.at(-1).fn()
    sources[1].giveUp()
    timers.at(-1).fn()
    sources[2].open()
    sources[2].giveUp()
    expect(timers.map((timer) => timer.ms)).toEqual([1000, 2000, STREAM_START])
    unsubscribe()
  })

  it('does not reopen with no listener', () => {
    const { client, sources, timers } = harness()
    const unsubscribe = client.subscribe(() => {})
    unsubscribe()
    expect(sources[0].closed).toBe(true)
    sources[0].giveUp()
    expect(timers).toEqual([])
    expect(sources).toHaveLength(1)
  })

  it('cancels a waiting reopen when the last listener leaves', () => {
    const { client, sources, timers, cleared } = harness()
    const unsubscribe = client.subscribe(() => {})
    sources[0].giveUp()
    expect(timers).toHaveLength(1)
    unsubscribe()
    expect(cleared).toEqual([timers[0].id])
    timers[0].fn()
    expect(sources).toHaveLength(1)
  })
})
