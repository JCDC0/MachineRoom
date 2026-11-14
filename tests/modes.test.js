import { describe, expect, it } from 'vitest'
import { ASK_READY, MODES, defaultMode, legacyMode, modesFor } from '../src/control/modes.js'

describe('permission modes', () => {
  it('lists the five modes from the most closed to the most open', () => {
    expect(MODES.map((mode) => mode.id)).toEqual(['plan', 'ask', 'edits', 'auto', 'bypass'])
    expect(MODES.map((mode) => mode.label)).toEqual(['Plan', 'Ask', 'Edits', 'Auto', 'Bypass'])
    for (const mode of MODES) expect(mode.line.length).toBeGreaterThan(0)
  })

  it('offers each harness only the modes its flags support', () => {
    expect(ASK_READY).toBe(true)
    expect(modesFor('claude').map((mode) => mode.id)).toEqual(['plan', 'ask', 'edits', 'auto', 'bypass'])
    expect(modesFor('machineroom').map((mode) => mode.id)).toEqual(['plan', 'ask', 'edits', 'auto', 'bypass'])
    expect(modesFor('opencode').map((mode) => mode.id)).toEqual(['plan', 'edits', 'auto'])
    expect(modesFor('agy').map((mode) => mode.id)).toEqual(['plan', 'edits', 'auto', 'bypass'])
    expect(modesFor('hermes')).toEqual([])
    expect(modesFor('codex').map((mode) => mode.id)).toEqual(['plan', 'auto'])
    expect(modesFor(undefined)).toEqual([])
  })

  it('names the mode today flags equal and the mode a new chat starts in', () => {
    expect(legacyMode('claude')).toBe('bypass')
    expect(legacyMode('agy')).toBe('bypass')
    expect(legacyMode('machineroom')).toBe('bypass')
    expect(legacyMode('opencode')).toBe('auto')
    expect(legacyMode('codex')).toBe('auto')
    expect(legacyMode('hermes')).toBeNull()
    expect(defaultMode('claude')).toBe('auto')
    expect(defaultMode('agy')).toBe('auto')
    expect(defaultMode('machineroom')).toBe('auto')
    expect(defaultMode('opencode')).toBe('auto')
    expect(defaultMode('codex')).toBe('auto')
    expect(defaultMode('hermes')).toBeNull()
  })
})
