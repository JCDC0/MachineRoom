import { describe, expect, it } from 'vitest'
import { createSessionsSource } from '../server/sessions-source.js'

function fakeReader(key, sessions) {
  return () => ({
    agent: { id: `agent-${key}`, key, name: key },
    tick: () => {},
    stop: () => {},
    sessions: () => sessions,
  })
}

describe('createSessionsSource sessionWorking', () => {
  it('returns true only when a reader for that key has a live session run', () => {
    const claudeSessions = new Map([['s1', { run: null }]])
    const opencodeSessions = new Map([['o1', { run: null }]])
    const source = createSessionsSource({
      projectRoot: '.',
      readers: [fakeReader('claude-session', claudeSessions), fakeReader('opencode-session', opencodeSessions)],
    })

    expect(source.sessionWorking('claude-session')).toBe(false)
    expect(source.sessionWorking('opencode-session')).toBe(false)
    expect(source.sessionWorking('missing')).toBe(false)

    claudeSessions.set('s1', { run: { runId: 'r1', open: true } })
    expect(source.sessionWorking('claude-session')).toBe(true)
    expect(source.sessionWorking('opencode-session')).toBe(false)

    claudeSessions.set('s1', { run: { runId: 'r1', open: false } })
    expect(source.sessionWorking('claude-session')).toBe(false)

    claudeSessions.set('s2', { run: { runId: 'r2' } })
    expect(source.sessionWorking('claude-session')).toBe(true)
  })
})
