import { describe, expect, it } from 'vitest'
import { distanceFromShare, fitView, shareFromDistance } from '../src/engine/camera.js'
import { RAIL_STEP, multiplierText, railShareFromPointer, railStep } from '../src/ui/lensResize.js'

describe('the zoom rail', () => {
  it('reads a rail share from the pointer, top full and bottom empty', () => {
    const rect = { top: 100, height: 200 }
    expect(railShareFromPointer(100, rect)).toBe(1)
    expect(railShareFromPointer(300, rect)).toBe(0)
    expect(railShareFromPointer(200, rect)).toBe(0.5)
    expect(railShareFromPointer(50, rect)).toBe(1)
    expect(railShareFromPointer(200, { top: 0, height: 0 })).toBe(0)
  })

  it('steps a rail with the keys and ignores others', () => {
    expect(railStep(0.5, 'ArrowUp')).toBeCloseTo(0.5 + RAIL_STEP)
    expect(railStep(0.5, 'ArrowDown')).toBeCloseTo(0.5 - RAIL_STEP)
    expect(railStep(0.5, 'PageUp')).toBeCloseTo(0.5 + RAIL_STEP * 4)
    expect(railStep(0.98, 'PageUp')).toBe(1)
    expect(railStep(0.5, 'Home')).toBe(0)
    expect(railStep(0.5, 'End')).toBe(1)
    expect(railStep(0.5, 'a')).toBeNull()
  })

  it('writes the multiplier under the zoom rail', () => {
    expect(multiplierText(1)).toBe('1.0x')
    expect(multiplierText(2.46)).toBe('2.5x')
    expect(multiplierText(12.4)).toBe('12x')
    expect(multiplierText(0)).toBe('1.0x')
  })

  it('maps the zoom share to a camera distance on a log scale', () => {
    expect(distanceFromShare(0)).toBeCloseTo(8000)
    expect(distanceFromShare(1)).toBeCloseTo(500)
    expect(shareFromDistance(8000)).toBeCloseTo(0)
    expect(shareFromDistance(500)).toBeCloseTo(1)
    expect(shareFromDistance(distanceFromShare(0.37))).toBeCloseTo(0.37)
    expect(distanceFromShare(0.5)).toBeCloseTo(Math.sqrt(500 * 8000))
  })
})

describe('the overview aims at the hub centre', () => {
  it('keeps the target on the given centre and still fits every sphere', () => {
    const spheres = [
      { x: 0, y: 0, z: 0, r: 300 },
      { x: 0, y: -360, z: 0, r: 200 },
      { x: 2000, y: 400, z: -1500, r: 250 },
    ]
    const free = fitView(spheres, { width: 1600, height: 700 })
    const centred = fitView(spheres, { width: 1600, height: 700, center: { x: 0, y: 0, z: 0 } })
    expect(centred.target).toEqual({ x: 0, y: 0, z: 0 })
    expect(free.target).not.toEqual({ x: 0, y: 0, z: 0 })
    expect(centred.dist).toBeGreaterThanOrEqual(free.dist)
  })
})
