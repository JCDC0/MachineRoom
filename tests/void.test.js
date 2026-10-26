import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DRIFT_SPEED,
  DRIFT_WANDER,
  DUST,
  DUST_INNER,
  DUST_OUTER,
  MOTE_INNER,
  MOTE_OUTER,
  bouncePoint,
  bounceRadius,
  createVoid,
  driftPoint,
  driftSpecks,
  dustPoints,
  motePoints,
} from '../src/engine/void.js'

function pointLayers(space) {
  const layers = []
  space.group.traverse((object) => {
    if (object.isPoints) layers.push(object)
  })
  return layers
}

function snapshot(layers) {
  return layers.map((layer) => Array.from(layer.geometry.attributes.position.array))
}

function radii(layer) {
  const values = layer.geometry.attributes.position.array
  const out = []
  for (let index = 0; index < values.length; index += 3) {
    out.push(Math.hypot(values[index], values[index + 1], values[index + 2]))
  }
  return out
}

describe('bounceRadius', () => {
  it('leaves a radius inside the shell alone', () => {
    expect(bounceRadius(MOTE_INNER, MOTE_INNER, MOTE_OUTER)).toBe(MOTE_INNER)
    expect(bounceRadius(MOTE_OUTER, MOTE_INNER, MOTE_OUTER)).toBe(MOTE_OUTER)
    expect(bounceRadius(3000, MOTE_INNER, MOTE_OUTER)).toBe(3000)
  })

  it('turns a radius back at each edge instead of letting it leave', () => {
    expect(bounceRadius(MOTE_INNER - 1, MOTE_INNER, MOTE_OUTER)).toBeCloseTo(MOTE_INNER + 1)
    expect(bounceRadius(MOTE_OUTER + 1, MOTE_INNER, MOTE_OUTER)).toBeCloseTo(MOTE_OUTER - 1)
    expect(bounceRadius(MOTE_INNER - 3, MOTE_INNER, MOTE_OUTER)).toBeCloseTo(MOTE_INNER + 3)
  })

  it('keeps every radius inside either shell, however far it wanders', () => {
    for (let radius = -50000; radius <= 50000; radius += 137) {
      const near = bounceRadius(radius, MOTE_INNER, MOTE_OUTER)
      expect(near).toBeGreaterThanOrEqual(MOTE_INNER)
      expect(near).toBeLessThanOrEqual(MOTE_OUTER)
      const far = bounceRadius(radius, DUST_INNER, DUST_OUTER)
      expect(far).toBeGreaterThanOrEqual(DUST_INNER)
      expect(far).toBeLessThanOrEqual(DUST_OUTER)
    }
  })

  it('falls back to the inner radius for a shell with no thickness', () => {
    expect(bounceRadius(500, 400, 400)).toBe(400)
    expect(bounceRadius(Number.NaN, 400, 6000)).toBe(400)
  })
})

describe('bouncePoint', () => {
  it('keeps a skewed point inside the shell', () => {
    const out = bouncePoint(0, 0, 90000, MOTE_INNER, MOTE_OUTER)
    expect(out[0]).toBeCloseTo(0, 6)
    expect(out[1]).toBeCloseTo(0, 6)
    expect(out[2]).toBeCloseTo(MOTE_INNER, 6)
  })

  it('places the centre of the shell on the inner radius', () => {
    expect(bouncePoint(0, 0, 0, MOTE_INNER, MOTE_OUTER)).toEqual([MOTE_INNER, 0, 0])
  })
})

describe('driftSpecks', () => {
  it('gives the same specks for the same seed', () => {
    expect(driftSpecks(5, 31)).toEqual(driftSpecks(5, 31))
    expect(driftSpecks(5, 31)).not.toEqual(driftSpecks(5, 32))
  })

  it('keeps every speed and wander within the slow bounds', () => {
    for (const speck of driftSpecks(200, 7)) {
      expect(Math.hypot(speck.vx, speck.vy, speck.vz)).toBeLessThanOrEqual(DRIFT_SPEED + 1e-9)
      expect(Math.hypot(speck.wx, speck.wy, speck.wz)).toBeCloseTo(1, 6)
      expect(speck.wander).toBeGreaterThan(0)
      expect(speck.wander).toBeLessThanOrEqual(DRIFT_WANDER)
    }
  })
})

describe('driftPoint', () => {
  const base = [2200, -700, 1300]
  const speck = driftSpecks(1, 41)[0]

  it('gives the same position for the same input', () => {
    expect(driftPoint(base, 0, speck, 4.2)).toEqual(driftPoint(base, 0, speck, 4.2))
    expect(driftPoint(base, 0, speck, 4.2)).not.toEqual(driftPoint(base, 0, speck, 9.1))
  })

  it('equals the start at zero seconds', () => {
    expect(driftPoint(base, 0, speck, 0)).toEqual(base)
  })

  it('moves slowly, a few units a second at most', () => {
    const start = driftPoint(base, 0, speck, 0)
    const next = driftPoint(base, 0, speck, 1)
    const step = Math.hypot(next[0] - start[0], next[1] - start[1], next[2] - start[2])
    expect(step).toBeGreaterThan(0)
    expect(step).toBeLessThanOrEqual(DRIFT_SPEED + DRIFT_WANDER * 0.6 + 1e-9)
  })

  it('keeps every mote inside the fine shell at any time', () => {
    const points = motePoints(120, 9)
    const specks = driftSpecks(points.length, 51)
    const out = new Float32Array(3)
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index]
      for (const seconds of [0, 0.5, 8, 240, 3600, 86400]) {
        const basePoints = [start.x, start.y, start.z]
        driftPoint(basePoints, 0, specks[index], seconds, out)
        const radius = Math.hypot(out[0], out[1], out[2])
        expect(radius).toBeGreaterThanOrEqual(MOTE_INNER - 1e-3)
        expect(radius).toBeLessThanOrEqual(MOTE_OUTER + 1e-3)
      }
    }
  })

  it('keeps every far dust speck inside its own shell', () => {
    const points = dustPoints(120, 13)
    const specks = driftSpecks(points.length, 61, { inner: DUST_INNER, outer: DUST_OUTER })
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index]
      for (const seconds of [0, 12, 720, 36000]) {
        const basePoints = [start.x, start.y, start.z]
        const point = driftPoint(basePoints, 0, specks[index], seconds)
        const radius = Math.hypot(point[0], point[1], point[2])
        expect(radius).toBeGreaterThanOrEqual(DUST_INNER - 1e-3)
        expect(radius).toBeLessThanOrEqual(DUST_OUTER + 1e-3)
      }
    }
  })
})

describe('void drift', () => {
  let savedDoc
  let savedWindow

  beforeEach(() => {
    savedDoc = globalThis.document
    savedWindow = globalThis.window
    const context2d = {
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      strokeStyle: '',
      globalAlpha: 1,
      measureText: (text) => ({ width: String(text).length * 10 }),
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      fillText: () => {},
    }
    globalThis.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => context2d,
      }),
    }
  })

  afterEach(() => {
    globalThis.document = savedDoc
    globalThis.window = savedWindow
  })

  it('does not move a speck while still is true', () => {
    const mql = { matches: true }
    globalThis.window = { matchMedia: () => mql }
    const scene = new THREE.Scene()
    const space = createVoid(scene, null)
    const layers = pointLayers(space)
    expect(layers).toHaveLength(4)
    const start = snapshot(layers)
    space.update(0.1)
    space.update(0.1)
    expect(snapshot(layers)).toEqual(start)
    space.dispose()
  })

  it('moves every layer on a throttle and freezes it where it is when still turns on', () => {
    const mql = { matches: false }
    globalThis.window = { matchMedia: () => mql }
    const scene = new THREE.Scene()
    const space = createVoid(scene, null)
    const layers = pointLayers(space)
    const start = snapshot(layers)
    space.update(0.05)
    expect(snapshot(layers)).toEqual(start)
    space.update(0.05)
    const moved = snapshot(layers)
    expect(moved).not.toEqual(start)
    for (const layer of layers) {
      const far = layer.geometry.attributes.position.count === DUST
      const inner = far ? DUST_INNER : MOTE_INNER
      const outer = far ? DUST_OUTER : MOTE_OUTER
      for (const radius of radii(layer)) {
        expect(radius).toBeGreaterThanOrEqual(inner - 1e-2)
        expect(radius).toBeLessThanOrEqual(outer + 1e-2)
      }
    }

    mql.matches = true
    const frozen = snapshot(layers)
    space.update(0.1)
    space.update(0.1)
    expect(snapshot(layers)).toEqual(frozen)
    space.dispose()
  })

  it('disposes the group and its layers', () => {
    globalThis.window = { matchMedia: () => ({ matches: false }) }
    const scene = new THREE.Scene()
    const space = createVoid(scene, null)
    expect(scene.children).toHaveLength(1)
    space.dispose()
    expect(scene.children).toHaveLength(0)
  })
})
