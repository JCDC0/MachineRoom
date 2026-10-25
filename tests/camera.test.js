import { describe, expect, it } from 'vitest'
import { CARD_NAME_FONT, CARD_NAME_MIN, FIT_MIN, FOV, OVERVIEW, fitView, minTextScale, viewBasis } from '../src/engine/camera.js'

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z

const room = [
  { x: 0, y: 200, z: 0, r: 460 },
  { x: -1400, y: 300, z: -200, r: 420 },
  { x: 1500, y: 100, z: 300, r: 260 },
  { x: 200, y: 900, z: -600, r: 240 },
  { x: 900, y: -400, z: 800, r: 300 },
]

function inside(view, spheres, aspect) {
  const { back, right, up } = viewBasis(OVERVIEW.yaw, OVERVIEW.pitch)
  const tan = Math.tan((FOV * Math.PI) / 360)
  return spheres.every((s) => {
    const d = { x: s.x - view.target.x, y: s.y - view.target.y, z: s.z - view.target.z }
    const depth = view.dist - dot(d, back)
    const rx = Number.isFinite(s.rx) ? s.rx : s.r
    const ry = Number.isFinite(s.ry) ? s.ry : s.r
    return Math.abs(dot(d, right)) + rx <= depth * tan * aspect + 1e-6 && Math.abs(dot(d, up)) + ry <= depth * tan + 1e-6
  })
}

const faces = [
  { x: 0, y: 0, z: 0, r: Math.hypot(124, 32), rx: 124, ry: 32 },
  { x: -900, y: 400, z: 300, r: Math.hypot(124, 32), rx: 124, ry: 32 },
  { x: 1100, y: -300, z: -500, r: Math.hypot(170, 60), rx: 170, ry: 60 },
]

describe('viewBasis', () => {
  it('gives three unit vectors at right angles', () => {
    const { back, right, up } = viewBasis(0.42, 0.3)
    for (const v of [back, right, up]) expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1)
    expect(dot(back, right)).toBeCloseTo(0)
    expect(dot(back, up)).toBeCloseTo(0)
    expect(dot(right, up)).toBeCloseTo(0)
  })

  it('keeps right level and up pointing upward', () => {
    const { right, up } = viewBasis(1.1, 0.5)
    expect(right.y).toBe(0)
    expect(up.y).toBeGreaterThan(0)
  })
})

describe('fitView', () => {
  it('falls back to the default overview with nothing to frame', () => {
    expect(fitView([])).toEqual({ target: { x: OVERVIEW.x, y: OVERVIEW.y, z: OVERVIEW.z }, dist: OVERVIEW.dist })
  })

  it('keeps every sphere inside the view', () => {
    for (const aspect of [0.6, 1.33, 1.78, 2.4]) {
      expect(inside(fitView(room, { aspect }), room, aspect)).toBe(true)
    }
  })

  it('never goes closer than the minimum', () => {
    expect(fitView([{ x: 0, y: 0, z: 0, r: 10 }]).dist).toBe(FIT_MIN)
  })

  it('fits the wide lens, not the taller window behind it', () => {
    const lens = fitView(faces, { width: 1280, height: 464, min: 0 })
    const windowView = fitView(faces, { width: 1280, height: 800, min: 0 })
    expect(lens.dist).toBeLessThan(windowView.dist)
    expect(inside(lens, faces, 1280 / 464)).toBe(true)
  })

  it('comes closer than the old 1800 floor for a small room', () => {
    const view = fitView([{ x: 0, y: 200, z: 0, r: 460 }], { width: 1280, height: 464 })
    expect(view.dist).toBeGreaterThanOrEqual(FIT_MIN)
    expect(view.dist).toBeLessThan(1800)
  })

  it('fits a flat card by its face, not its diagonal', () => {
    const sphere = faces.map((s) => ({ x: s.x, y: s.y, z: s.z, r: s.r }))
    const flat = fitView(faces, { width: 1280, height: 464, min: 0 })
    const round = fitView(sphere, { width: 1280, height: 464, min: 0 })
    expect(flat.dist).toBeLessThan(round.dist)
    expect(inside(flat, faces, 1280 / 464)).toBe(true)
  })

  it('keeps flat cards inside a narrow lens too', () => {
    const aspect = 640 / 900
    const view = fitView(faces, { width: 640, height: 900, min: 0 })
    expect(inside(view, faces, aspect)).toBe(true)
  })

  it('backs off on a narrow window', () => {
    expect(fitView(room, { aspect: 0.8 }).dist).toBeGreaterThan(fitView(room, { aspect: 1.78 }).dist)
  })

  it('keeps every sphere inside the view when the lens is short and wide', () => {
    const aspect = 1280 / 464
    expect(inside(fitView(room, { aspect }), room, aspect)).toBe(true)
  })

  it('does not come closer on the lens than on the taller window', () => {
    const lens = fitView(room, { aspect: 1280 / 464 })
    const taller = fitView(room, { aspect: 1280 / 748 })
    expect(lens.dist).toBeGreaterThanOrEqual(taller.dist)
  })

  it('grows a card name to 11 pixels at the lens distance', () => {
    const height = 464
    const view = fitView(room, { aspect: 1280 / height })
    const screenScale = height / (2 * Math.tan((FOV * Math.PI) / 360) * view.dist)
    const scale = minTextScale(screenScale, CARD_NAME_FONT, CARD_NAME_MIN)
    expect(scale).toBeGreaterThan(1)
    expect(CARD_NAME_FONT * screenScale * scale).toBeCloseTo(CARD_NAME_MIN, 5)
    expect(minTextScale(0)).toBe(1)
    expect(minTextScale(1)).toBe(1)
  })

  it('backs off as the room grows', () => {
    const wider = [...room, { x: -3200, y: 200, z: 0, r: 400 }]
    expect(fitView(wider).dist).toBeGreaterThan(fitView(room).dist)
  })

  it('gives the same answer every time', () => {
    expect(fitView(room)).toEqual(fitView(room))
  })
})
