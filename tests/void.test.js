import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DRIFT_SPEED,
  DRIFT_WANDER,
  DUST,
  DUST_INNER,
  DUST_OUTER,
  LATTICE_CELLS,
  LATTICE_LAYER,
  LATTICE_STEP,
  MOTE_INNER,
  MOTE_OUTER,
  bouncePoint,
  bounceRadius,
  createVoid,
  driftPoint,
  driftSpecks,
  dustPoints,
  labelPoints,
  latticeLines,
  latticeTicks,
  motePoints,
  setFineDust,
  speckPulse,
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

describe('lattice', () => {
  const extent = LATTICE_STEP * LATTICE_CELLS
  const low = -LATTICE_LAYER * LATTICE_STEP
  const high = LATTICE_LAYER * LATTICE_STEP
  const layers = [low, high]

  function segments(values) {
    const out = []
    for (let index = 0; index < values.length; index += 6) {
      out.push([values.slice(index, index + 3), values.slice(index + 3, index + 6)])
    }
    return out
  }

  function gridAt(values, y) {
    const rows = segments(values).filter(([a, b]) => a[1] === y && b[1] === y)
    return {
      alongX: rows.filter(([a, b]) => a[0] === -extent && b[0] === extent),
      alongZ: rows.filter(([a, b]) => a[2] === -extent && b[2] === extent),
    }
  }

  function yValues(values) {
    const out = []
    for (let index = 1; index < values.length; index += 3) out.push(values[index])
    return out
  }

  it('keeps one layer above the hub and one below', () => {
    expect(LATTICE_LAYER).toBe(1)
    const levels = [...new Set(yValues(latticeLines()))].sort((a, b) => a - b)
    expect(levels).toEqual(layers)
  })

  it('draws a grid on both layers and none at the hub level', () => {
    const values = latticeLines()
    for (const level of layers) {
      const { alongX, alongZ } = gridAt(values, level)
      expect(alongX).toHaveLength(2 * LATTICE_CELLS + 1)
      expect(alongZ).toHaveLength(2 * LATTICE_CELLS + 1)
    }
    const hub = gridAt(values, 0)
    expect(hub.alongX).toHaveLength(0)
    expect(hub.alongZ).toHaveLength(0)
  })

  it('runs every vertical line from the lower layer to the upper layer and no further', () => {
    const verticals = segments(latticeLines()).filter(([a, b]) => a[0] === b[0] && a[2] === b[2] && a[1] !== b[1])
    expect(verticals).toHaveLength((2 * LATTICE_CELLS + 1) ** 2)
    for (const [a, b] of verticals) {
      expect(Math.min(a[1], b[1])).toBe(low)
      expect(Math.max(a[1], b[1])).toBe(high)
    }
  })

  it('draws ticks only on the two layers', () => {
    const values = latticeTicks()
    const levels = [...new Set(yValues(values))].sort((a, b) => a - b)
    expect(levels).toEqual(layers)
    for (const level of layers) {
      expect(segments(values).some(([a, b]) => a[1] === level && b[1] === level)).toBe(true)
    }
  })

  it('labels only the two layers', () => {
    const points = labelPoints()
    expect(points.length).toBeGreaterThan(0)
    const levels = [...new Set(points.map(([, y]) => y))].sort((a, b) => a - b)
    expect(levels).toEqual(layers)
  })
})

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

  it('keeps every speed, wander rate, phase and pulse within its bounds', () => {
    for (const speck of driftSpecks(200, 7)) {
      const speed = Math.hypot(speck.vx, speck.vy, speck.vz)
      expect(speed).toBeGreaterThan(0)
      expect(speed).toBeLessThanOrEqual(DRIFT_SPEED * 1.3 + 1e-9)
      for (const axis of ['rx', 'ry', 'rz']) {
        expect(speck[axis]).toBeGreaterThanOrEqual(0.4)
        expect(speck[axis]).toBeLessThanOrEqual(1.3 + 1e-9)
      }
      for (const axis of ['px', 'py', 'pz']) {
        expect(speck[axis]).toBeGreaterThanOrEqual(0)
        expect(speck[axis]).toBeLessThan(Math.PI * 2)
      }
      expect(speck.wander).toBeGreaterThan(0)
      expect(speck.wander).toBeLessThanOrEqual(DRIFT_WANDER)
      expect(speck.pulsePhase).toBeGreaterThanOrEqual(0)
      expect(speck.pulsePhase).toBeLessThan(Math.PI * 2)
      expect(speck.pulseRate).toBeGreaterThanOrEqual(0.6)
      expect(speck.pulseRate).toBeLessThanOrEqual(2 + 1e-9)
    }
  })

  it('sends 200 specks in directions that cancel instead of one shared drift', () => {
    const specks = driftSpecks(200, 7)
    let x = 0
    let y = 0
    let z = 0
    for (const speck of specks) {
      const length = Math.hypot(speck.vx, speck.vy, speck.vz)
      x += speck.vx / length
      y += speck.vy / length
      z += speck.vz / length
    }
    expect(Math.hypot(x, y, z) / specks.length).toBeLessThan(0.25)
  })
})

describe('speckPulse', () => {
  it('breathes between dim and full', () => {
    const values = Array.from({ length: 60 }, (_, index) => speckPulse(index / 4))
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.2)
    expect(Math.max(...values)).toBeLessThanOrEqual(1)
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.5)
  })

  it('gives two specks different brightness at the same moment', () => {
    const [a, b] = driftSpecks(2, 7)
    expect(speckPulse(1.7, a.pulsePhase, a.pulseRate)).not.toBeCloseTo(speckPulse(1.7, b.pulsePhase, b.pulseRate), 6)
  })
})

describe('driftPoint', () => {
  const base = [2200, -700, 1300]
  const speck = driftSpecks(1, 41)[0]

  it('gives the same position for the same input', () => {
    expect(driftPoint(base, 0, speck, 4.2)).toEqual(driftPoint(base, 0, speck, 4.2))
    expect(driftPoint(base, 0, speck, 4.2)).not.toEqual(driftPoint(base, 0, speck, 9.1))
  })

  it('equals the start at zero seconds when its phases start at zero', () => {
    const placed = { ...speck, px: 0, py: 0, pz: 0 }
    expect(driftPoint(base, 0, placed, 0)).toEqual(base)
  })

  it('wanders on all three axes as time runs', () => {
    const placed = { ...speck, vx: 0, vy: 0, vz: 0 }
    const atZero = driftPoint(base, 0, placed, 0)
    const later = driftPoint(base, 0, placed, 1.5)
    expect(later[0]).not.toBe(atZero[0])
    expect(later[1]).not.toBe(atZero[1])
    expect(later[2]).not.toBe(atZero[2])
  })

  it('moves every second', () => {
    const start = driftPoint(base, 0, speck, 0)
    const next = driftPoint(base, 0, speck, 1)
    const step = Math.hypot(next[0] - start[0], next[1] - start[1], next[2] - start[2])
    expect(step).toBeGreaterThan(0)
    expect(step).toBeLessThanOrEqual(DRIFT_SPEED * 1.3 + DRIFT_WANDER * 3 + 1e-9)
  })

  it('sends two specks from one point in different directions', () => {
    const [a, b] = driftSpecks(2, 7)
    const pa = driftPoint(base, 0, a, 1)
    const pb = driftPoint(base, 0, b, 1)
    const lengthA = Math.hypot(pa[0] - base[0], pa[1] - base[1], pa[2] - base[2])
    const lengthB = Math.hypot(pb[0] - base[0], pb[1] - base[1], pb[2] - base[2])
    const dot = ((pa[0] - base[0]) * (pb[0] - base[0]) + (pa[1] - base[1]) * (pb[1] - base[1]) + (pa[2] - base[2]) * (pb[2] - base[2])) / (lengthA * lengthB)
    expect(dot).toBeLessThan(0.9)
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
    setFineDust({ on: true, strength: 0.2, pulse: false })
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

  it('does not turn the dust clouds as one group', () => {
    globalThis.window = { matchMedia: () => ({ matches: false }) }
    const scene = new THREE.Scene()
    const space = createVoid(scene, null)
    const layers = pointLayers(space)
    const farDust = layers.find((layer) => layer.geometry.attributes.position.count === DUST)
    const fineDust = layers.find((layer) => layer.geometry.attributes.color)?.parent
    expect(farDust).toBeTruthy()
    expect(fineDust).toBeTruthy()
    space.update(1)
    expect(farDust.rotation.y).toBe(0)
    expect(fineDust.rotation.y).toBe(0)
    expect(fineDust.rotation.x).toBe(0)
    space.dispose()
  })

  it('pulses each fine mote on its own colour when the pulse is on', () => {
    globalThis.window = { matchMedia: () => ({ matches: false }) }
    setFineDust({ on: true, strength: 1, pulse: true })
    const scene = new THREE.Scene()
    const space = createVoid(scene, null)
    const layers = pointLayers(space).filter((layer) => layer.geometry.attributes.color)
    expect(layers).toHaveLength(3)
    for (const layer of layers) expect(layer.material.vertexColors).toBe(true)
    space.update(0.05)
    space.update(0.05)
    const colors = layers[0].geometry.attributes.color.array
    const values = new Set(colors)
    expect(values.size).toBeGreaterThan(1)
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0.2)
      expect(value).toBeLessThanOrEqual(1)
    }
    expect(layers[0].geometry.attributes.color.version).toBeGreaterThan(0)
    space.dispose()
  })

  it('drops the pulse colours back to full when the pulse turns off', () => {
    globalThis.window = { matchMedia: () => ({ matches: false }) }
    setFineDust({ on: true, strength: 1, pulse: true })
    const scene = new THREE.Scene()
    const space = createVoid(scene, null)
    const layers = pointLayers(space).filter((layer) => layer.geometry.attributes.color)
    space.update(0.05)
    space.update(0.05)
    setFineDust({ pulse: false })
    for (const layer of layers) {
      expect(new Set(layer.geometry.attributes.color.array)).toEqual(new Set([1]))
    }
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
