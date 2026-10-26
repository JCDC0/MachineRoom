import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ANCHOR_DIST, CARD_NAME_FONT, CARD_NAME_MIN, FIT_MIN, FOV, OVERVIEW, createCameraRig, fitView, minTextScale, viewBasis } from '../src/engine/camera.js'

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

function openRig({ still = false } = {}) {
  const saved = globalThis.window
  const listeners = {}
  globalThis.window = {
    matchMedia: () => ({ matches: still }),
    addEventListener: (type, handler) => {
      if (!listeners[type]) listeners[type] = []
      listeners[type].push(handler)
    },
    removeEventListener: () => {},
  }
  const surfaceListeners = {}
  const surface = {
    addEventListener: (type, handler) => {
      surfaceListeners[type] = handler
    },
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
  }
  const camera = new THREE.PerspectiveCamera()
  const rig = createCameraRig(camera, surface)
  const drag = (dx, dy) => {
    surfaceListeners.pointerdown({ clientX: 500, clientY: 400, target: { closest: () => null } })
    for (const handler of listeners.pointermove ?? []) handler({ clientX: 500 + dx, clientY: 400 + dy })
  }
  const close = () => {
    globalThis.window = saved
  }
  return { rig, drag, close, camera }
}

describe('camera rig yaw and pitch', () => {
  it('starts at the overview yaw and pitch', () => {
    const { rig, close } = openRig()
    try {
      expect(rig.yaw()).toBeCloseTo(OVERVIEW.yaw)
      expect(rig.pitch()).toBeCloseTo(OVERVIEW.pitch)
    } finally {
      close()
    }
  })

  it('follows a drag on both yaw and pitch', () => {
    const { rig, drag, close } = openRig()
    try {
      drag(-100, 50)
      rig.snap()
      expect(rig.yaw()).toBeCloseTo(OVERVIEW.yaw + 0.5)
      expect(rig.pitch()).toBeCloseTo(OVERVIEW.pitch + 0.2)
      expect(rig.pitch()).not.toBeCloseTo(OVERVIEW.pitch)
      drag(40, -25)
      rig.snap()
      expect(rig.yaw()).toBeCloseTo(OVERVIEW.yaw + 0.3)
      expect(rig.pitch()).toBeCloseTo(OVERVIEW.pitch + 0.1)
    } finally {
      close()
    }
  })

  it('clamps pitch to its lowest and highest angle', () => {
    const { rig, drag, close } = openRig()
    try {
      drag(0, 2000)
      rig.snap()
      expect(rig.pitch()).toBe(1.45)
      drag(0, -3000)
      rig.snap()
      expect(rig.pitch()).toBe(0.08)
      for (let step = 0; step < 20; step += 1) drag(0, 200)
      rig.snap()
      expect(rig.pitch()).toBe(1.45)
      for (let step = 0; step < 40; step += 1) drag(0, -200)
      rig.snap()
      expect(rig.pitch()).toBe(0.08)
    } finally {
      close()
    }
  })

  it('returns to the overview yaw and pitch on overview()', () => {
    const { rig, drag, close } = openRig()
    try {
      drag(-400, -20)
      rig.snap()
      expect(rig.yaw()).not.toBeCloseTo(OVERVIEW.yaw)
      expect(rig.pitch()).not.toBeCloseTo(OVERVIEW.pitch)
      rig.overview()
      rig.snap()
      expect(rig.yaw()).toBeCloseTo(OVERVIEW.yaw)
      expect(rig.pitch()).toBeCloseTo(OVERVIEW.pitch)
    } finally {
      close()
    }
  })
})

describe('camera rig hold', () => {
  it('eases into a held point instead of jumping to it', () => {
    const { rig, camera, close } = openRig()
    try {
      const point = new THREE.Vector3(700, 260, -500)
      expect(rig.hold(() => point, ANCHOR_DIST)).toBeUndefined()
      rig.update(0.016)
      expect(camera.position.distanceTo(point)).toBeGreaterThan(ANCHOR_DIST)
    } finally {
      close()
    }
  })

  it('keeps the held point at the anchor distance while it moves', () => {
    const { rig, camera, close } = openRig({ still: true })
    try {
      const point = new THREE.Vector3(700, 260, -500)
      expect(ANCHOR_DIST).toBeGreaterThan(0)
      rig.hold(() => point, ANCHOR_DIST)
      rig.update(0.016)
      expect(camera.position.distanceTo(point)).toBeCloseTo(ANCHOR_DIST, 5)
      point.set(-300, 100, 400)
      rig.update(0.016)
      expect(camera.position.distanceTo(point)).toBeCloseTo(ANCHOR_DIST, 5)
    } finally {
      close()
    }
  })

  it('returns to the overview when overview() clears the hold', () => {
    const { rig, camera, close } = openRig({ still: true })
    try {
      const point = new THREE.Vector3(700, 260, -500)
      rig.hold(() => point, ANCHOR_DIST)
      rig.update(0.016)
      rig.overview()
      rig.update(0.016)
      expect(camera.position.distanceTo(point)).not.toBeCloseTo(ANCHOR_DIST, 0)
      expect(camera.position.distanceTo(new THREE.Vector3(OVERVIEW.x, OVERVIEW.y, OVERVIEW.z))).toBeCloseTo(OVERVIEW.dist, 5)
    } finally {
      close()
    }
  })
})

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
