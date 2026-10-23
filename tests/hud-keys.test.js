import { describe, expect, it } from 'vitest'
import { hudKeyBlocked } from '../src/ui/Hud.jsx'

const target = (...names) => ({
  closest: (selector) => (names.some((name) => selector.includes(name)) ? {} : null),
})

describe('hudKeyBlocked', () => {
  it('blocks the HUD keys whose target is inside a dialog', () => {
    expect(hudKeyBlocked(target('[role="dialog"]'))).toBe(true)
  })

  it('blocks the keys in a field as before', () => {
    expect(hudKeyBlocked(target('input'))).toBe(true)
    expect(hudKeyBlocked(target('textarea'))).toBe(true)
    expect(hudKeyBlocked(target('select'))).toBe(true)
  })

  it('leaves the keys alone in the room and on the HUD', () => {
    expect(hudKeyBlocked(target('.hud'))).toBe(false)
    expect(hudKeyBlocked(null)).toBe(false)
  })
})
