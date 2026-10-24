import { describe, expect, it } from 'vitest'
import { chooseRoute, connectionFrom, foreignLinkNotice, linkAddressAllowed, recordingName } from '../src/startup.js'
import { replayFiles } from '../src/model/replay.js'

const saved = { source: 'bridge', bridge: 'http://127.0.0.1:5174', speed: 2 }
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

  it('lets an explicit bridge address skip the connect screen', () => {
    expect(chooseRoute(at('bridge=http://127.0.0.1:9'), saved, false).mode).toBe('live')
    expect(chooseRoute(at('simulate'), saved, false).mode).toBe('live')
  })

  it('does not go live for a bare live address on a first visit', () => {
    expect(chooseRoute(at('live'), saved, false).mode).toBe('connect')
  })

  it('prefers replay over a live address when both are present', () => {
    expect(chooseRoute(at('bridge=http://127.0.0.1:9&replay'), saved, true).mode).toBe('replay')
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

  it('ignores the Paperclip and company parameters of an older link', () => {
    const connection = connectionFrom(at('live&company=abc&paperclip=http://localhost:3100'), saved)
    expect(connection).toEqual(saved)
  })

  it('plays the demo for a simulate address', () => {
    expect(connectionFrom(at('simulate'), saved).source).toBe('demo')
  })

  it('keeps the other saved settings', () => {
    expect(connectionFrom(at('simulate'), saved).speed).toBe(2)
  })
})

describe('addresses in a link', () => {
  const page = 'http://127.0.0.1:5173'

  it('allows a bridge on this computer or on the page origin', () => {
    for (const value of ['http://127.0.0.1:5174', 'http://localhost:5174', 'http://[::1]:5174', 'https://localhost', '/api', page]) {
      expect(linkAddressAllowed(value, page), value).toBe(true)
    }
  })

  it('refuses another host, a protocol relative path and odd schemes', () => {
    const values = [
      'http://example.test:5174',
      'https://192.0.2.7',
      'http://127.0.0.1.example.test',
      'http://localhost@example.test',
      'http://user:pass@localhost:5174',
      '//example.test',
      '/\\example.test',
      'javascript:alert(1)',
      'file:///etc',
      'ws://localhost:3100',
      'http://local host',
      '',
    ]
    for (const value of values) expect(linkAddressAllowed(value, page), value).toBe(false)
    expect(linkAddressAllowed(null, page)).toBe(false)
  })

  it('opens the connect screen with a notice for a bridge on another host', () => {
    const route = chooseRoute(at('bridge=http://example.test:5174'), saved, true, page)
    expect(route.mode).toBe('connect')
    expect(route.connection.bridge).toBe('http://example.test:5174')
    expect(route.notice).toBe(foreignLinkNotice('http://example.test:5174'))
    expect(route.notice).toBe('The link names http://example.test:5174, which is not on this computer. Check the address, then connect.')
  })

  it('keeps the saved connection in a replay whose link names another host', () => {
    const route = chooseRoute(at('replay&bridge=http://example.test:5174'), saved, true, page)
    expect(route.mode).toBe('replay')
    expect(route.connection).toEqual(saved)
  })

  it('still goes live for a bridge on this computer', () => {
    expect(chooseRoute(at('bridge=http://127.0.0.1:9'), saved, false, page)).toMatchObject({ mode: 'live', connection: { bridge: 'http://127.0.0.1:9' } })
    expect(chooseRoute(at(''), saved, true, page).notice).toBeUndefined()
  })
})
