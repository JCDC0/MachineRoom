import { describe, expect, it } from 'vitest'
import { REOPEN_LIMIT, REOPEN_START, discoverBridge, openBridge, probeLive } from '../src/live/bridge.js'

class FakeSource {
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.listeners = new Map()
    this.closed = false
    FakeSource.last = this
  }

  addEventListener(name, handler) {
    this.listeners.set(name, handler)
  }

  emit(name, data) {
    this.listeners.get(name)({ data })
  }

  close() {
    this.closed = true
    this.readyState = 2
  }
}

function reply(body, ok = true) {
  return async () => ({ ok, status: ok ? 200 : 502, json: async () => body })
}

describe('openBridge', () => {
  function harness() {
    const seen = { frames: [], trees: [], statuses: [] }
    const link = openBridge({
      url: 'http://bridge',
      EventSourceImpl: FakeSource,
      onFrame: (frame) => seen.frames.push(frame),
      onTree: (tree) => seen.trees.push(tree),
      onStatus: (status) => seen.statuses.push(status),
    })
    return { seen, link, source: FakeSource.last }
  }

  it('opens the event stream of the bridge', () => {
    const { source, seen } = harness()
    expect(source.url).toBe('http://bridge/events?history=1&tree=folders')
    expect(seen.statuses).toEqual(['connecting'])
  })

  it('reports live once open and reconnecting after a drop', () => {
    const { source, seen } = harness()
    source.onopen()
    source.onerror()
    expect(seen.statuses).toEqual(['connecting', 'live', 'reconnecting'])
  })

  it('reports disconnected when the browser gives up', () => {
    const { source, seen } = harness()
    source.readyState = 2
    source.onerror()
    expect(seen.statuses.at(-1)).toBe('disconnected')
  })

  it('opens the stream again after the browser gives up, waiting longer each time', () => {
    const timers = []
    const sources = []
    class Counting extends FakeSource {
      constructor(url) {
        super(url)
        sources.push(this)
      }
    }
    const statuses = []
    const link = openBridge({
      url: 'http://bridge',
      EventSourceImpl: Counting,
      onFrame: () => {},
      onTree: () => {},
      onStatus: (status) => statuses.push(status),
      setTimer: (fn, ms) => {
        timers.push({ fn, ms })
        return timers.length
      },
      clearTimer: () => {},
    })
    const giveUp = () => {
      const source = sources.at(-1)
      source.readyState = 2
      source.onerror()
    }
    giveUp()
    giveUp()
    expect(timers.map((timer) => timer.ms)).toEqual([REOPEN_START])
    for (let round = 0; round < 6; round += 1) {
      timers.at(-1).fn()
      giveUp()
    }
    expect(sources).toHaveLength(7)
    expect(sources.at(-1).url).toBe('http://bridge/events?history=1&tree=folders')
    expect(timers.map((timer) => timer.ms)).toEqual([1000, 2000, 4000, 8000, REOPEN_LIMIT, REOPEN_LIMIT, REOPEN_LIMIT])
    timers.at(-1).fn()
    sources.at(-1).onopen()
    giveUp()
    expect(timers.at(-1).ms).toBe(REOPEN_START)
    expect(statuses.slice(-3)).toEqual(['connecting', 'live', 'disconnected'])
    link.close()
    expect(sources.at(-1).closed).toBe(true)
  })

  it('does not open the stream again once closed', () => {
    const timers = []
    const link = openBridge({
      url: 'http://bridge',
      EventSourceImpl: FakeSource,
      onFrame: () => {},
      onTree: () => {},
      onStatus: () => {},
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => {},
    })
    link.close()
    FakeSource.last.onerror()
    expect(timers).toEqual([])
  })

  it('passes frames and tree changes on as objects', () => {
    const { source, seen } = harness()
    source.emit('frame', JSON.stringify({ id: 1, type: 'heartbeat.run.queued' }))
    source.emit('tree', JSON.stringify({ root: 'p', files: ['a.js'] }))
    expect(seen.frames).toEqual([{ id: 1, type: 'heartbeat.run.queued' }])
    expect(seen.trees).toEqual([{ root: 'p', files: ['a.js'] }])
  })

  it('skips a message that is not JSON', () => {
    const { source, seen } = harness()
    source.emit('frame', 'not json')
    expect(seen.frames).toEqual([])
  })

  it('closes the stream', () => {
    const { source, link } = harness()
    link.close()
    expect(source.closed).toBe(true)
  })
})

describe('discoverBridge', () => {
  const answers = {
    'http://bridge/api/agents': [
      { id: 'a1', key: 'claude', name: 'Claude Code', adapterType: 'claude_local', parser: 'claude' },
      { id: 'a2', key: 'agy', name: 'agy', adapterType: 'process', parser: 'agy' },
    ],
    'http://bridge/api/tree': { root: 'agent-sandbox', files: ['src/math.js'], created: [] },
  }
  const fetchImpl = async (url) => reply(answers[url])()

  it('returns the agents, the file list and the root name', async () => {
    const found = await discoverBridge({ url: 'http://bridge', fetchImpl })
    expect(found.rootName).toBe('agent-sandbox')
    expect(found.files).toEqual(['src/math.js'])
    expect(found.agents.map((agent) => agent.parser)).toEqual(['claude', 'agy'])
  })

  it('lets the caller override the root name', async () => {
    const found = await discoverBridge({ url: 'http://bridge', root: 'other', fetchImpl })
    expect(found.rootName).toBe('other')
  })

  it('fails when the bridge cannot reach Paperclip', async () => {
    await expect(discoverBridge({ url: 'http://bridge', fetchImpl: reply({}, false) })).rejects.toThrow(/502/)
  })
})

describe('probeLive', () => {
  it('asks the bridge health route when a bridge is set', async () => {
    const asked = []
    const fetchImpl = async (url) => {
      asked.push(url)
      return reply({ ok: true })()
    }
    expect(await probeLive({ bridge: 'http://bridge', fetchImpl })).toBe(true)
    expect(asked).toEqual(['http://bridge/api/health'])
  })

  it('asks Paperclip through the proxy otherwise', async () => {
    const asked = []
    const fetchImpl = async (url) => {
      asked.push(url)
      return reply([])()
    }
    expect(await probeLive({ base: '/paperclip', fetchImpl })).toBe(true)
    expect(asked).toEqual(['/paperclip/api/companies'])
  })

  it('says no when nothing answers', async () => {
    const fetchImpl = async () => {
      throw new Error('refused')
    }
    expect(await probeLive({ base: '/paperclip', fetchImpl })).toBe(false)
  })
})
