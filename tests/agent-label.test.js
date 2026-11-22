import { describe, expect, it } from 'vitest'
import { doingText, nameLabel } from '../src/engine/agents.js'

describe('agent name label', () => {
  it('answers a short name in capitals', () => {
    expect(nameLabel('Hermes')).toBe('HERMES')
  })

  it('keeps a name of exactly 32 characters', () => {
    const name = 'abcdefghijklmnopqrstuvwxyz012345'
    expect(name).toHaveLength(32)
    expect(nameLabel(name)).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')
  })

  it('cuts a long name to 32 characters with a tilde last', () => {
    const name = 'Claude Code '.repeat(5)
    expect(name).toHaveLength(60)
    const label = nameLabel(name)
    expect(label).toBe('CLAUDE CODE CLAUDE CODE CLAUDE ~')
    expect(label).toHaveLength(32)
  })

  it('answers empty text for a name that is not text', () => {
    expect(nameLabel(null)).toBe('')
  })
})

describe('doingText', () => {
  it('says what an agent is doing, or its state', () => {
    expect(doingText({ status: 'working', label: 'Read src/App.jsx' })).toBe('read src/app.jsx')
    expect(doingText({ status: 'working', label: 'x'.repeat(60) })).toBe(`${'x'.repeat(39)}~`)
    expect(doingText({ status: 'idle' })).toBe('idle')
    expect(doingText({ status: 'done', label: 'done' })).toBe('finished')
    expect(doingText({ status: 'error' })).toBe('failed')
    expect(doingText({})).toBe('')
    expect(doingText(null)).toBe('')
  })

  it('says queued for a queued entry with an old label', () => {
    expect(doingText({ status: 'queued', label: 'done', calls: new Map() })).toBe('queued')
    expect(doingText({ status: 'queued', label: 'Edit src/a.js' })).toBe('queued')
  })

  it('says thinking for a working entry with no open call', () => {
    expect(doingText({ status: 'working', label: 'edit src/a.js', openCalls: new Map(), calls: new Map([['c1', []]]) })).toBe('thinking')
    expect(doingText({ status: 'working', label: 'edit src/a.js', openCalls: new Set(), calls: new Map([['c1', []]]) })).toBe('thinking')
    expect(doingText({ status: 'working', label: 'edit src/a.js', openCalls: 0 })).toBe('thinking')
    expect(doingText({ status: 'working', label: 'edit src/a.js', calls: new Map() })).toBe('thinking')
    expect(doingText({ status: 'working', calls: new Map() })).toBe('thinking')
  })

  it('shows the label for a working entry with an open call', () => {
    const calls = new Map([['c1', []]])
    expect(doingText({ status: 'working', label: 'Edit src/a.js', openCalls: new Map([['c1', { tool: 'edit', label: 'Edit src/a.js', touches: [] }]]), calls })).toBe('edit src/a.js')
    expect(doingText({ status: 'working', label: '', openCalls: new Map([['c1', { tool: 'shell', label: 'npm run dev', touches: [] }]]), calls })).toBe('npm run dev')
    expect(doingText({ status: 'working', label: 'Edit src/a.js', openCalls: new Set(['c1']), calls })).toBe('edit src/a.js')
    expect(doingText({ status: 'working', label: 'Edit src/a.js', calls })).toBe('edit src/a.js')
  })

  it('shows the label for a working entry with no calls at all', () => {
    expect(doingText({ status: 'working', label: 'Edit src/a.js' })).toBe('edit src/a.js')
  })
})
