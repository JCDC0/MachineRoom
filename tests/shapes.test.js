import { describe, expect, it } from 'vitest'
import {
  ORCHESTRATOR_PULSE_SCALE,
  PULSE_BANDS,
  PULSE_SCALE,
  SUB_PULSE_SCALE,
  bandForPoint,
  vertexOffset,
} from '../src/engine/shapes.js'
import { BAND_COUNT } from '../src/ui/sound.js'

describe('the pulse bands on a shape', () => {
  it('picks a band from where the point sits, so a repeated corner keeps one band', () => {
    expect(bandForPoint(-1, -0.0001, PULSE_BANDS)).toBe(0)
    expect(bandForPoint(1, 0, PULSE_BANDS)).toBe(2)
    expect(bandForPoint(-1, 0, PULSE_BANDS)).toBe(4)
    expect(bandForPoint(0, 1, PULSE_BANDS)).toBe(3)
    expect(bandForPoint(0, -1, PULSE_BANDS)).toBe(1)
    expect(bandForPoint(3, 4, PULSE_BANDS)).toBe(3)
    expect(bandForPoint(1, 1, 0)).toBe(0)
  })

  it('uses the same count as the sound bands', () => {
    expect(PULSE_BANDS).toBe(BAND_COUNT)
  })
})

describe('the pulse vertex offset', () => {
  it('moves a vertex out by at most PULSE_SCALE of its distance', () => {
    expect(vertexOffset(0, 1)).toBe(0)
    expect(vertexOffset(-4, 1)).toBe(0)
    expect(vertexOffset(100, 1)).toBeCloseTo(100 * PULSE_SCALE, 8)
    expect(vertexOffset(100, 0.5)).toBeCloseTo(50 * PULSE_SCALE, 8)
    expect(vertexOffset(100, 1.4)).toBeCloseTo(100 * PULSE_SCALE, 8)
    expect(vertexOffset(100, -1)).toBe(0)
    expect(vertexOffset(100, 1, ORCHESTRATOR_PULSE_SCALE)).toBeCloseTo(100 * ORCHESTRATOR_PULSE_SCALE, 8)
  })

  it('gives the orchestrator and its subs less', () => {
    expect(ORCHESTRATOR_PULSE_SCALE).toBeLessThan(SUB_PULSE_SCALE)
    expect(SUB_PULSE_SCALE).toBeLessThan(PULSE_SCALE)
  })
})
