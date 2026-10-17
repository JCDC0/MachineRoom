import { describe, expect, it } from 'vitest'
import { OVERVIEW, fitDistance } from '../src/engine/camera.js'

describe('fitDistance', () => {
  it('never goes closer than the default overview', () => {
    expect(fitDistance(500, 1.78)).toBe(OVERVIEW.dist)
  })

  it('backs off as the room grows', () => {
    expect(fitDistance(6000, 1.78)).toBeGreaterThan(fitDistance(3000, 1.78))
  })

  it('backs off further on a narrow window', () => {
    expect(fitDistance(6000, 0.8)).toBeGreaterThan(fitDistance(6000, 1.78))
  })

  it('does not count a very wide window as a reason to move closer', () => {
    expect(fitDistance(6000, 3)).toBe(fitDistance(6000, 1.33))
  })
})
