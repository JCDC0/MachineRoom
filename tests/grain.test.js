import { describe, expect, it } from 'vitest'
import { GRAIN_INTERVAL_MS, GRAIN_SIZE, noiseFrame, startGrain } from '../src/ui/grain.js'

function seeded(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

describe('grain noise frame', () => {
  it('fills a frame with single pixel white noise', () => {
    const data = noiseFrame(4, () => 1)

    expect(data).toHaveLength(4 * 4 * 4)
    for (let at = 0; at < data.length; at += 4) {
      expect([data[at], data[at + 1], data[at + 2]]).toEqual([255, 255, 255])
      expect(data[at + 3]).toBe(255)
    }
  })

  it('keeps every pixel monochrome and sets its alpha from the random level', () => {
    const data = noiseFrame(3, () => 0.5)

    for (let at = 0; at < data.length; at += 4) {
      expect(data[at]).toBe(255)
      expect(data[at + 1]).toBe(255)
      expect(data[at + 2]).toBe(255)
      expect(data[at + 3]).toBe(64)
    }
  })

  it('draws the same frame from the same seed and a different one from another', () => {
    const first = noiseFrame(8, seeded(7))
    const again = noiseFrame(8, seeded(7))
    const other = noiseFrame(8, seeded(8))

    expect([...first]).toEqual([...again])
    expect([...other]).not.toEqual([...first])
  })

  it('rounds a size below one pixel up to one', () => {
    expect(noiseFrame(0, () => 1)).toHaveLength(4)
    expect(noiseFrame(-4, () => 1)).toHaveLength(4)
  })

  it('redraws a few times a second', () => {
    expect(GRAIN_SIZE).toBeGreaterThan(0)
    expect(GRAIN_INTERVAL_MS).toBeGreaterThanOrEqual(100)
    expect(GRAIN_INTERVAL_MS).toBeLessThanOrEqual(500)
  })
})

describe('grain redraw', () => {
  it('paints a crisp tile into the node and stops', () => {
    const style = {}
    const node = { style }
    let paint = null
    let cleared = null
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: () => {},
      }),
      toDataURL: () => 'data:image/png;base64,noise',
    }
    const doc = { createElement: () => canvas }
    const stop = startGrain(node, {
      doc,
      size: 4,
      interval: 200,
      random: () => 0.5,
      setTimer: (fn, ms) => {
        paint = fn
        expect(ms).toBe(200)
        return 7
      },
      clearTimer: (timer) => {
        cleared = timer
      },
    })

    expect(canvas.width).toBe(4)
    expect(canvas.height).toBe(4)
    expect(style.backgroundImage).toBe('url("data:image/png;base64,noise")')
    expect(style.backgroundSize).toBe('4px 4px')
    expect(paint).toBeTypeOf('function')

    paint()
    expect(style.backgroundImage).toBe('url("data:image/png;base64,noise")')

    stop()
    expect(cleared).toBe(7)
    expect(style.backgroundImage).toBe('none')
  })

  it('does nothing without a document', () => {
    const stop = startGrain({ style: {} }, { doc: null })

    expect(stop).toBeTypeOf('function')
    expect(stop()).toBeUndefined()
  })
})
