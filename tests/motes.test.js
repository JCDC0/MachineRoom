import { describe, expect, it } from 'vitest'
import { MOTES, MOTE_INNER, MOTE_OUTER, SPECK_BANDS, moteOpacity, motePoints, speckBands } from '../src/engine/void.js'

describe('motePoints', () => {
  it('places every mote in the volume between the inner and outer radius', () => {
    const points = motePoints()
    expect(points).toHaveLength(MOTES)
    for (const point of points) {
      const radius = point.length()
      expect(radius).toBeGreaterThanOrEqual(MOTE_INNER - 1e-6)
      expect(radius).toBeLessThanOrEqual(MOTE_OUTER + 1e-6)
    }
  })

  it('fills the volume, so most motes lie in the outer half of the radius', () => {
    const outer = motePoints().filter((point) => point.length() > (MOTE_INNER + MOTE_OUTER) / 2).length
    expect(outer / MOTES).toBeGreaterThan(0.75)
  })

  it('gives the same motes for the same seed', () => {
    expect(motePoints(20, 7)).toEqual(motePoints(20, 7))
  })
})

describe('moteOpacity', () => {
  it('is zero when the dust is off or has no strength', () => {
    expect(moteOpacity({ on: false, strength: 1 })).toBe(0)
    expect(moteOpacity({ on: true, strength: 0 })).toBe(0)
    expect(moteOpacity({ on: true, strength: Number.NaN })).toBe(0)
  })

  it('stays visible at the default strength and never passes 1', () => {
    expect(moteOpacity({ on: true, strength: 0.2 })).toBeCloseTo(0.4)
    expect(moteOpacity({ on: true, strength: 1 })).toBe(1)
    expect(moteOpacity({ on: true, strength: 5 })).toBe(1)
  })
})

describe('speckBands', () => {
  it('splits the motes into soft specks of three sizes, every mote once', () => {
    const points = motePoints()
    const bands = speckBands(points)
    expect(bands).toHaveLength(SPECK_BANDS.length)
    expect(bands.reduce((sum, band) => sum + band.length, 0)).toBe(points.length)
    expect(Math.max(...bands.map((band) => band.length)) - Math.min(...bands.map((band) => band.length))).toBeLessThanOrEqual(1)
    expect(SPECK_BANDS.map((band) => band.size)).toEqual([...SPECK_BANDS.map((band) => band.size)].sort((a, b) => a - b))
  })
})
