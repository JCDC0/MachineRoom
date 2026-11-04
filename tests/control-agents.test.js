import { describe, expect, it } from 'vitest'
import { EFFORTS } from '../src/control/agents.js'

describe('EFFORTS', () => {
  it('lists the allowed reasoning efforts', () => {
    expect(EFFORTS).toEqual(['low', 'medium', 'high'])
  })
})
