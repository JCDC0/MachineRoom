import { describe, expect, it } from 'vitest'
import { PROXY_BASE, chooseRoute, connectionFrom } from '../src/startup.js'

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
