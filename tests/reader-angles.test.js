import { describe, expect, it } from 'vitest'
import { readerAngles, slotAngle } from '../src/engine/hub.js'

const turn = Math.PI * 2
const distance = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

describe('reader angles', () => {
  it('keeps the old positions without lanes', () => {
    for (let readers = 1; readers <= 3; readers += 1) {
      expect(readerAngles([], readers)).toEqual(Array.from({ length: readers }, (_, index) => slotAngle(index, readers)))
    }
  })

  it('keeps readers clear of lane slots and gives deterministic positions', () => {
    for (let lanes = 1; lanes <= 8; lanes += 1) {
      const angles = Array.from({ length: lanes }, (_, index) => slotAngle(index, lanes))
      for (let readers = 1; readers <= 3; readers += 1) {
        const result = readerAngles(angles, readers)
        expect(result).toHaveLength(readers)
        expect(result).toEqual(readerAngles(angles, readers))
        for (const reader of result) {
          for (const lane of angles) expect(distance(reader, lane)).toBeGreaterThanOrEqual(turn / lanes / 4 - 1e-10)
        }
      }
    }
  })

  it('splits the widest gap evenly when it holds multiple readers', () => {
    expect(readerAngles([0, Math.PI / 2], 2)).toEqual([Math.PI, 3 * Math.PI / 2])
    const result = readerAngles([slotAngle(0, 2), slotAngle(1, 2)], 2)
    for (const angle of result) {
      expect(distance(angle, slotAngle(0, 2))).toBeCloseTo(Math.PI / 2)
      expect(distance(angle, slotAngle(1, 2))).toBeCloseTo(Math.PI / 2)
    }
  })
})
