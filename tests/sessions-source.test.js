import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createOpencodeSessionsReader } from '../server/opencode-sessions.js'
import { createSessionsSource } from '../server/sessions-source.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(() => {
  while (cleanups.length > 0) {
    try {
      cleanups.pop()()
    } catch {}
  }
})

function fakeReader(key, sessions, open) {
  return () => ({
    agent: { id: `agent-${key}`, key, name: key },
    tick: () => {},
    stop: () => {},
    sessions: () => sessions,
    ...(open ? { open: () => open } : {}),
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

  it('reads opencode-session working state from the reader open() map', () => {
    const open = new Map()
    const source = createSessionsSource({
      projectRoot: '.',
      readers: [fakeReader('opencode-session', new Map([['o1', {}]]), open)],
    })

    expect(source.sessionWorking('opencode-session')).toBe(false)

    open.set('o1', { runId: 'o1:run' })
    expect(source.sessionWorking('opencode-session')).toBe(true)

    open.delete('o1')
    expect(source.sessionWorking('opencode-session')).toBe(false)
  })

  it('reports opencode-session working from a real createOpencodeSessionsReader', () => {
    const dir = makeTempDir('mr-ss-oc-')
    cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
    const dbPath = join(dir, 'opencode.db')
    const db = new DatabaseSync(dbPath)
    db.exec('CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, title TEXT, time_updated INTEGER)')
    db.exec(
      'CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, time_updated INTEGER, data TEXT)'
    )
    db.prepare('INSERT INTO session_v2 (id, parent_id, directory, title, time_updated) VALUES (?, ?, ?, ?, ?)').run(
      'sess-1',
      null,
      dir,
      'Work',
      1000
    )
    db.close()

    let clock = 2000
    const reader = createOpencodeSessionsReader({
      projectRoot: dir,
      runsFolder: dir,
      dbPath,
      quietMs: 30000,
      idleSessionPollMs: 0,
      sessionPollMs: 0,
      now: () => clock,
    })
    cleanups.push(() => reader.stop())
    const source = createSessionsSource({ projectRoot: dir, readers: [() => reader] })

    source.tick()
    expect(source.sessionWorking('opencode-session')).toBe(false)

    clock = 3000
    const db2 = new DatabaseSync(dbPath)
    db2.prepare('UPDATE session_v2 SET time_updated = ? WHERE id = ?').run(3000, 'sess-1')
    db2
      .prepare('INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('m1', 'sess-1', 'user', 1, 3000, 3000, '{}')
    db2.close()

    source.tick()
    expect(source.sessionWorking('opencode-session')).toBe(true)

    clock = 4000
    const db3 = new DatabaseSync(dbPath)
    db3.prepare('UPDATE session_v2 SET time_updated = ? WHERE id = ?').run(4000, 'sess-1')
    db3
      .prepare('INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('m2', 'sess-1', 'idle', 2, 4000, 4000, JSON.stringify({ outcome: 'succeeded' }))
    db3.close()

    source.tick()
    expect(source.sessionWorking('opencode-session')).toBe(false)
  })
})
