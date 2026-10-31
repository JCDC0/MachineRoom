import { describe, expect, it } from 'vitest'
import {
  ABERRATION_MAX_PX,
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
  it('puts a square of the lens diagonal on the middle of the lens', () => {
    const placed = mapPlacement({ width: 1280, height: 800 })
    const side = Math.hypot(1280, 800)

    expect(placed.width).toBeCloseTo(side, 6)
    expect(placed.height).toBeCloseTo(side, 6)
    expect(placed.x + placed.width / 2).toBeCloseTo(640, 6)
    expect(placed.y + placed.height / 2).toBeCloseTo(400, 6)
  })

  it('covers every corner of a wide lens', () => {
    const width = 1247
    const height = 460
    const placed = mapPlacement({ width, height })
    const side = Math.hypot(width, height)

    expect(placed.width).toBeCloseTo(side, 6)
    expect(placed.height).toBeCloseTo(side, 6)
    expect(placed.x).toBeCloseTo((width - side) / 2, 6)
    expect(placed.y).toBeCloseTo((height - side) / 2, 6)
    expect(placed.x).toBeLessThan(0)
    expect(placed.y).toBeLessThan(0)
    expect(placed.x + placed.width).toBeGreaterThan(width)
    expect(placed.y + placed.height).toBeGreaterThan(height)
  })

  it('stays on the lens when a ring centre and radius are passed', () => {
    const lens = { width: 1247, height: 460 }
    const placed = mapPlacement({ ...lens, centerX: 3383, centerY: 42329, radius: 9000 })

    expect(placed).toEqual(mapPlacement(lens))
    expect(placed.x + placed.width / 2).toBeCloseTo(lens.width / 2, 6)
    expect(placed.y + placed.height / 2).toBeCloseTo(lens.height / 2, 6)
  })

  it('answers the map size for a zero-size region', () => {
    const whole = {
      x: -RADIAL_MAP_SIZE / 2,
      y: -RADIAL_MAP_SIZE / 2,
      width: RADIAL_MAP_SIZE,
      height: RADIAL_MAP_SIZE,
    }

    expect(mapPlacement({ width: 0, height: 0 })).toEqual(whole)
    expect(mapPlacement({ width: 0, height: 720 })).toEqual(whole)
    expect(mapPlacement()).toEqual(whole)
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
