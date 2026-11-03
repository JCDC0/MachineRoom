import { describe, expect, it } from 'vitest'
import {
  ORCHESTRATOR_PULSE_SCALE,
  PULSE_BANDS,
  PULSE_SCALE,
  SUB_PULSE_SCALE,
  bandForVertex,
  vertexOffset,
} from '../src/engine/shapes.js'
import { BAND_COUNT } from '../src/ui/sound.js'

describe('the pulse bands on a shape', () => {
  it('picks a band from the vertex index and wraps', () => {
    expect(bandForVertex(0, 5)).toBe(0)
    expect(bandForVertex(4, 5)).toBe(4)
    expect(bandForVertex(5, 5)).toBe(0)
    expect(bandForVertex(12, 5)).toBe(2)
    expect(bandForVertex(-1, 5)).toBe(4)
    expect(bandForVertex(7, 0)).toBe(0)
  })

  it('uses the same count as the sound bands', () => {
    expect(PULSE_BANDS).toBe(BAND_COUNT)
  })
})

describe('the pulse vertex offset', () => {
  it('moves a vertex out by at most 12 percent of its distance', () => {
    expect(vertexOffset(0, 1)).toBe(0)
    expect(vertexOffset(-4, 1)).toBe(0)
    expect(vertexOffset(100, 1)).toBeCloseTo(100 * PULSE_SCALE, 8)
    expect(vertexOffset(100, 0.5)).toBeCloseTo(50 * PULSE_SCALE, 8)
    expect(vertexOffset(100, 1.4)).toBeCloseTo(100 * PULSE_SCALE, 8)
    expect(vertexOffset(100, -1)).toBe(0)
    expect(vertexOffset(100, 1, 0.04)).toBeCloseTo(4, 8)
  })

  it('gives the orchestrator and its subs less', () => {
    expect(ORCHESTRATOR_PULSE_SCALE).toBeLessThan(SUB_PULSE_SCALE)
    expect(SUB_PULSE_SCALE).toBeLessThan(PULSE_SCALE)
  })
})
