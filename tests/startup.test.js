import { describe, expect, it } from 'vitest'
import { PROXY_BASE, chooseRoute, connectionFrom, recordingName } from '../src/startup.js'
import { replayFiles } from '../src/model/replay.js'

const saved = { source: 'bridge', bridge: 'http://127.0.0.1:5174', paperclip: '/paperclip', company: '', speed: 2 }
const at = (query) => new URLSearchParams(query)

describe('chooseRoute', () => {
  it('shows the connect screen on the first visit', () => {
    expect(chooseRoute(at(''), saved, false).mode).toBe('connect')
  })

  it('reconnects with the saved connection on a later visit', () => {
    const route = chooseRoute(at(''), saved, true)
    expect(route.mode).toBe('live')
    expect(route.connection.bridge).toBe('http://127.0.0.1:5174')
  })

  it('opens the replay when asked, even on a first visit', () => {
    expect(chooseRoute(at('replay'), saved, false).mode).toBe('replay')
  })

  it('opens the connect screen on request, even when a connection is saved', () => {
    expect(chooseRoute(at('connect'), saved, true).mode).toBe('connect')
  })

  it('lets an explicit live address skip the connect screen', () => {
    for (const query of ['live', 'bridge=http://127.0.0.1:9', 'simulate']) {
      expect(chooseRoute(at(query), saved, false).mode, query).toBe('live')
    }
  })

  it('prefers replay over a live address when both are present', () => {
    expect(chooseRoute(at('live&replay'), saved, true).mode).toBe('replay')
  })

  it('opens the replay for a recording address', () => {
    expect(chooseRoute(at('recording=hermes-T8-20261019-233640'), saved, true).mode).toBe('replay')
  })
})

describe('recordingName', () => {
  it('takes a plain recording name', () => {
    expect(recordingName(at('recording=hermes-T8-20261019-233640'))).toBe('hermes-T8-20261019-233640')
    expect(recordingName(at('recording=run.v2'))).toBe('run.v2')
  })

  it('refuses a name that could leave the recordings folder', () => {
    for (const name of ['', '..', '../fixtures/sandbox', '..%2Fx', 'a/b', 'a\\b', '.hidden', 'a..b', 'x?y', 'x y']) {
      expect(recordingName(at(`recording=${encodeURIComponent(name)}`)), name).toBeNull()
    }
    expect(recordingName(at(''))).toBeNull()
  })

  it('maps a recording to its three files and no recording to the sandbox fixtures', () => {
    expect(replayFiles('opencode-T5')).toEqual({ run: 'recordings/opencode-T5-run.jsonl', agents: 'recordings/opencode-T5-agents.json', tree: 'recordings/opencode-T5-tree.json' })
    expect(replayFiles(null).run).toBe('fixtures/sandbox-run.jsonl')
  })
})

describe('connectionFrom', () => {
  it('uses the saved connection when the address says nothing', () => {
    expect(connectionFrom(at(''), saved)).toEqual(saved)
  })

  it('takes the bridge from the address', () => {
    const connection = connectionFrom(at('bridge=http://127.0.0.1:9000'), saved)
    expect(connection).toMatchObject({ source: 'bridge', bridge: 'http://127.0.0.1:9000' })
  })

  it('goes straight to Paperclip through the proxy for a bare live address', () => {
    expect(connectionFrom(at('live'), saved)).toMatchObject({ source: 'paperclip', paperclip: PROXY_BASE, company: '' })
  })

  it('reads the company and Paperclip address from a live address', () => {
    const connection = connectionFrom(at('live&company=abc&paperclip=http://localhost:3100'), saved)
    expect(connection).toMatchObject({ source: 'paperclip', paperclip: 'http://localhost:3100', company: 'abc' })
  })

  it('plays the demo for a simulate address', () => {
    expect(connectionFrom(at('simulate'), saved).source).toBe('demo')
  })

  it('keeps the other saved settings', () => {
    expect(connectionFrom(at('simulate'), saved).speed).toBe(2)
  })
})
