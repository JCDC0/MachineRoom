import { describe, expect, it } from 'vitest'
import { nameLabel } from '../src/engine/agents.js'

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
