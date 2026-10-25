import { describe, expect, it } from 'vitest'
import {
  ABERRATION_MAX_PX,
  aberrationChannels,
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
