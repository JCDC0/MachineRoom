import { describe, expect, it } from 'vitest'
import { ORCHESTRATOR_HOME } from '../src/engine/hub.js'
import { INTERNET_HOME, MORPH_SWING, morphOffsets } from '../src/engine/internet.js'

describe('morphOffsets', () => {
  it('gives the same offsets for the same seed, count and time', () => {
    expect(morphOffsets(7, 12, 2.5)).toEqual(morphOffsets(7, 12, 2.5))
  })

  it('keeps every offset within one swing', () => {
    for (const value of morphOffsets(20261025, 64, 5)) {
      expect(Number.isFinite(value)).toBe(true)
      expect(Math.abs(value)).toBeLessThanOrEqual(1)
    }
    expect(MORPH_SWING).toBeGreaterThan(0)
    expect(MORPH_SWING).toBeLessThan(0.25)
  })

  it('breathes over time and gives another seed another shape', () => {
    expect(morphOffsets(7, 8, 0)).not.toEqual(morphOffsets(7, 8, 1))
    expect(morphOffsets(7, 8, 1)).not.toEqual(morphOffsets(8, 8, 1))
  })

  it('gives no offsets for no vertices and reads junk as zero', () => {
    expect(morphOffsets(7, 0, 1)).toEqual([])
    expect(morphOffsets(7, -4, 1)).toEqual([])
    expect(morphOffsets(7, 4, 'x')).toEqual(morphOffsets(7, 4, 0))
  })
})

describe('the internet shape place', () => {
  it('floats over the hub centre and above the orchestrator', () => {
    expect(INTERNET_HOME.x).toBe(0)
    expect(INTERNET_HOME.z).toBe(0)
    expect(INTERNET_HOME.y).toBeGreaterThan(ORCHESTRATOR_HOME.y)
  })
})
