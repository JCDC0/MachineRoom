import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { WHITE, easeInOut, easeRate, lineMaterial, seeded } from '../src/engine/sprites.js'

const SEED_SEVEN = [
  0.23878083983436227,
  0.9134932646993548,
  0.6124916663393378,
  0.9269814591389149,
  0.049341175239533186,
]

describe('seeded', () => {
  it('gives the same run for the same seed', () => {
    const first = seeded(7)
    const again = seeded(7)
    expect(Array.from({ length: SEED_SEVEN.length }, () => first())).toEqual(SEED_SEVEN)
    expect(Array.from({ length: SEED_SEVEN.length }, () => again())).toEqual(SEED_SEVEN)
  })

  it('gives a different run for a different seed', () => {
    expect(seeded(7)()).not.toBe(seeded(8)())
  })

  it('stays between 0 and 1', () => {
    const next = seeded(12345)
    for (let index = 0; index < 1000; index += 1) {
      const value = next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('advances on each call', () => {
    const next = seeded(7)
    expect(next()).not.toBe(next())
  })
})

describe('easeInOut', () => {
  it('holds the ends', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(0.5)).toBe(0.5)
    expect(easeInOut(1)).toBe(1)
  })

  it('is symmetric about the middle', () => {
    for (const t of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
      expect(easeInOut(t) + easeInOut(1 - t)).toBeCloseTo(1, 12)
    }
  })

  it('eases in slowly and out slowly', () => {
    expect(easeInOut(0.25)).toBeCloseTo(0.0625, 12)
    expect(easeInOut(0.75)).toBeCloseTo(0.9375, 12)
  })

  it('rises with time', () => {
    let previous = easeInOut(0)
    for (let step = 1; step <= 20; step += 1) {
      const value = easeInOut(step / 20)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
  })
})

describe('easeRate', () => {
  it('returns all of the change when still', () => {
    expect(easeRate(0.016, 5, true)).toBe(1)
    expect(easeRate(0, 5, true)).toBe(1)
  })

  it('returns none of the change for a zero delta', () => {
    expect(easeRate(0, 5)).toBe(0)
  })

  it('follows the exponential frame share', () => {
    expect(easeRate(0.016, 5)).toBeCloseTo(1 - Math.exp(-0.08), 12)
    expect(easeRate(0.1, 3)).toBeCloseTo(1 - Math.exp(-0.3), 12)
  })

  it('moves further in a longer frame and at a faster rate', () => {
    expect(easeRate(0.02, 5)).toBeGreaterThan(easeRate(0.01, 5))
    expect(easeRate(0.016, 10)).toBeGreaterThan(easeRate(0.016, 5))
    expect(easeRate(10, 5)).toBeLessThanOrEqual(1)
  })
})

describe('lineMaterial', () => {
  it('makes an additive transparent line that writes no depth', () => {
    const material = lineMaterial(WHITE, 0.4)
    expect(material.color.getHex()).toBe(WHITE)
    expect(material.opacity).toBe(0.4)
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(material.blending).toBe(THREE.AdditiveBlending)
    material.dispose()
  })
})
