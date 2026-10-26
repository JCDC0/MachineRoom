import { describe, expect, it } from 'vitest'
import {
  ABERRATION_MAX_PX,
  ABERRATION_REACH,
  RADIAL_MAP_SIZE,
  aberrationChannels,
  mapPlacement,
  radialMapDataUrl,
  radialMapPixels,
  radialMapValue,
} from '../src/ui/aberration.js'

describe('radial aberration map', () => {
  it('leaves the centre of the lens neutral', () => {
    expect(radialMapValue(0, 0)).toEqual({ r: 127.5, g: 127.5, radius: 0 })
  })

  it('grows the offset from the centre toward the edge', () => {
    const quarter = radialMapValue(0.25, 0)
    const half = radialMapValue(0.5, 0)
    const edge = radialMapValue(1, 0)

    expect(quarter.r).toBeCloseTo(159.375)
    expect(half.r).toBeCloseTo(191.25)
    expect(edge.r).toBeCloseTo(255)
    expect(quarter.g).toBeCloseTo(127.5)
    expect(edge.g).toBeCloseTo(127.5)
  })

  it('points along the diagonal at a corner', () => {
    const corner = radialMapValue(1, 1)

    expect(corner.radius).toBe(1)
    expect(corner.r).toBeCloseTo(217.656, 3)
    expect(corner.g).toBeCloseTo(corner.r, 6)
  })

  it('writes a square, opaque RGBA map', () => {
    const { size, data } = radialMapPixels(8)

    expect(size).toBe(8)
    expect(data).toHaveLength(8 * 8 * 4)
    const pixel = (x, y) => {
      const at = (y * size + x) * 4
      return { r: data[at], g: data[at + 1], b: data[at + 2], a: data[at + 3] }
    }

    expect(pixel(0, 0).a).toBe(255)
    expect(pixel(0, 0).b).toBe(0)
    expect(Math.abs(pixel(3, 3).r - 128)).toBeLessThan(20)
    expect(pixel(7, 3).r).toBe(239)
    expect(pixel(7, 3).g).toBe(112)
  })

  it('draws the map once and reuses its data url', () => {
    let draws = 0
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        createImageData: (width, height) => {
          draws += 1
          return { data: new Uint8ClampedArray(width * height * 4) }
        },
        putImageData: () => {},
      }),
      toDataURL: () => 'data:image/png;base64,radial',
    }
    const doc = { createElement: () => canvas }

    expect(radialMapDataUrl(doc, 6)).toBe('data:image/png;base64,radial')
    expect(radialMapDataUrl(doc, 6)).toBe('data:image/png;base64,radial')
    expect(draws).toBe(1)
    expect(canvas.width).toBe(6)
    expect(canvas.height).toBe(6)
  })

  it('needs a document to draw the map', () => {
    expect(radialMapDataUrl(null)).toBe('')
  })
})

describe('aberration map placement', () => {
  it('centres the map on the middle of the lens', () => {
    const placed = mapPlacement({ width: 1280, height: 800, centerX: 640, centerY: 400 })
    const side = 2 * Math.hypot(640, 400)

    expect(placed.width).toBeCloseTo(side, 6)
    expect(placed.height).toBeCloseTo(side, 6)
    expect(placed.x + placed.width / 2).toBeCloseTo(640, 6)
    expect(placed.y + placed.height / 2).toBeCloseTo(400, 6)
  })

  it('centres the map on a corner', () => {
    const placed = mapPlacement({ width: 1280, height: 800, centerX: 0, centerY: 0 })
    const side = 2 * Math.hypot(1280, 800)

    expect(placed.width).toBeCloseTo(side, 6)
    expect(placed.height).toBeCloseTo(side, 6)
    expect(placed.x + placed.width / 2).toBeCloseTo(0, 6)
    expect(placed.y + placed.height / 2).toBeCloseTo(0, 6)
  })

  it('grows the side to reach every corner of the lens', () => {
    const placed = mapPlacement({ width: 740, height: 520, centerX: 690, centerY: 40 })
    const side = 2 * Math.hypot(690, 480)

    expect(placed.width).toBeCloseTo(side, 6)
    expect(placed.x).toBeLessThanOrEqual(0)
    expect(placed.y).toBeLessThanOrEqual(0)
    expect(placed.x + placed.width).toBeGreaterThanOrEqual(740)
    expect(placed.y + placed.height).toBeGreaterThanOrEqual(520)
    expect(placed.x + placed.width / 2).toBeCloseTo(690, 6)
    expect(placed.y + placed.height / 2).toBeCloseTo(40, 6)
  })

  it('answers the map size for a zero-size region', () => {
    expect(mapPlacement({ width: 0, height: 0, centerX: 0, centerY: 0 })).toEqual({
      x: -RADIAL_MAP_SIZE / 2,
      y: -RADIAL_MAP_SIZE / 2,
      width: RADIAL_MAP_SIZE,
      height: RADIAL_MAP_SIZE,
    })
    expect(mapPlacement({ width: 0, height: 0, centerX: 120, centerY: 80 })).toEqual({
      x: 120 - RADIAL_MAP_SIZE / 2,
      y: 80 - RADIAL_MAP_SIZE / 2,
      width: RADIAL_MAP_SIZE,
      height: RADIAL_MAP_SIZE,
    })
  })
})

describe('aberration map placement on the ring', () => {
  it('keeps a ring at the middle of the lens in place and still covers the lens', () => {
    const placed = mapPlacement({ width: 1247, height: 460, centerX: 623.5, centerY: 230, radius: 300 })
    const side = 2 * 300 * ABERRATION_REACH

    expect(placed.width).toBeCloseTo(side, 6)
    expect(placed.height).toBeCloseTo(side, 6)
    expect(placed.x + placed.width / 2).toBeCloseTo(623.5, 6)
    expect(placed.y + placed.height / 2).toBeCloseTo(230, 6)
    expect(placed.x).toBeLessThanOrEqual(0)
    expect(placed.y).toBeLessThanOrEqual(0)
    expect(placed.x + placed.width).toBeGreaterThanOrEqual(1247)
    expect(placed.y + placed.height).toBeGreaterThanOrEqual(460)
  })

  it('caps the square at the limit and pulls it back over a ring far to the right', () => {
    const width = 1247
    const height = 460
    const placed = mapPlacement({ width, height, centerX: 3383, centerY: 42329, radius: 9000 })
    const cap = 2 * Math.hypot(width, height)

    expect(placed.width).toBeCloseTo(cap, 6)
    expect(placed.height).toBeCloseTo(cap, 6)
    expect(placed.x).toBeLessThanOrEqual(0)
    expect(placed.x + placed.width).toBeGreaterThanOrEqual(width)
    expect(placed.x).toBeCloseTo(0, 6)
    expect(placed.x + placed.width / 2).toBeCloseTo(cap / 2, 6)
  })

  it('pulls a ring below the lens back up over it at the limit', () => {
    const width = 1247
    const height = 460
    const placed = mapPlacement({ width, height, centerX: 620, centerY: 3300, radius: 9000, limit: 1.5 })
    const cap = 1.5 * Math.hypot(width, height)

    expect(placed.width).toBeCloseTo(cap, 6)
    expect(placed.y).toBeLessThanOrEqual(0)
    expect(placed.y + placed.height).toBeGreaterThanOrEqual(height)
    expect(placed.y).toBeCloseTo(0, 6)
    expect(placed.y + placed.height / 2).toBeCloseTo(cap / 2, 6)
    expect(placed.x + placed.width / 2).toBeCloseTo(620, 6)
  })

  it('falls back to the lens-covering square with no ring radius', () => {
    const size = { width: 740, height: 520, centerX: 690, centerY: 40 }
    const placed = mapPlacement({ ...size, radius: 0 })
    const side = 2 * Math.hypot(690, 480)

    expect(placed).toEqual(mapPlacement(size))
    expect(placed.width).toBeCloseTo(side, 6)
    expect(placed.height).toBeCloseTo(side, 6)
    expect(placed.x).toBeCloseTo(690 - side / 2, 6)
    expect(placed.y).toBeCloseTo(40 - side / 2, 6)
  })

  it('keeps the lens-covering square while the ring is small on screen', () => {
    const placed = mapPlacement({ width: 1247, height: 460, centerX: 623.5, centerY: 230, radius: 90 })
    const side = 2 * Math.hypot(623.5, 230)

    expect(placed.width).toBeCloseTo(side, 6)
    expect(placed.height).toBeCloseTo(side, 6)
    expect(placed.x).toBeLessThanOrEqual(0)
    expect(placed.y).toBeLessThanOrEqual(0)
    expect(placed.x + placed.width).toBeGreaterThanOrEqual(1247)
    expect(placed.y + placed.height).toBeGreaterThanOrEqual(460)
  })
})

describe('aberration channel scales', () => {
  it('moves red outward and blue inward with no shift at rest', () => {
    expect(aberrationChannels(0)).toEqual({ red: 0, green: 0, blue: 0 })

    const half = aberrationChannels(0.5)
    expect(half.red).toBe(-ABERRATION_MAX_PX / 2)
    expect(half.green).toBe(0)
    expect(half.blue).toBe(ABERRATION_MAX_PX / 2)
  })

  it('clamps the strength to the full displacement', () => {
    expect(aberrationChannels(1)).toEqual({ red: -ABERRATION_MAX_PX, green: 0, blue: ABERRATION_MAX_PX })
    expect(aberrationChannels(4)).toEqual({ red: -ABERRATION_MAX_PX, green: 0, blue: ABERRATION_MAX_PX })
    expect(aberrationChannels(-2)).toEqual({ red: 0, green: 0, blue: 0 })
    expect(aberrationChannels('nope')).toEqual({ red: 0, green: 0, blue: 0 })
  })
})
