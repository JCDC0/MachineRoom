import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { ANCHOR_DIST, FIT_MIN, FOV, IDLE_SPIN, OVERVIEW, PARK_EASE_MS, createCameraRig, fitView, projectPoint, viewBasis } from '../src/engine/camera.js'

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
  let rectReads = 0
  const surface = {
    addEventListener: (type, handler) => {
      surfaceListeners[type] = handler
    },
    removeEventListener: () => {},
    getBoundingClientRect: () => {
      rectReads += 1
      return { left: 0, top: 0, width: 1000, height: 800 }
    },
  }
  const camera = new THREE.PerspectiveCamera()
  const rig = createCameraRig(camera, surface)
  const drag = (dx, dy) => {
    surfaceListeners.pointerdown({ clientX: 500, clientY: 400, target: { closest: () => null } })
    for (const handler of listeners.pointermove ?? []) handler({ clientX: 500 + dx, clientY: 400 + dy })
  }
  const wheel = (deltaY) => {
    surfaceListeners.wheel({ deltaY, target: { closest: () => null }, preventDefault() {} })
  }
  const rest = () => {
    for (const handler of listeners.pointerup ?? []) handler({ clientX: 500, clientY: 400 })
    for (const handler of listeners.pointermove ?? []) handler({ clientX: 500, clientY: 400 })
  }
  const move = (x, y) => {
    for (const handler of listeners.pointermove ?? []) handler({ clientX: x, clientY: y })
  }
  const scroll = () => {
    for (const handler of listeners.scroll ?? []) handler({ type: 'scroll' })
  }
  const close = () => {
    globalThis.window = saved
  }
  return { rig, drag, wheel, rest, move, scroll, close, camera, rectReads: () => rectReads }
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

function clockAt(start = 1000) {
  let now = start
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => now)
  return {
    advance(ms) {
      now += ms
    },
    restore() {
      spy.mockRestore()
    },
  }
}

describe('camera rig park turn', () => {
  it('does not jump the yaw on the frame after overview()', () => {
    const { rig, drag, close } = openRig()
    const clock = clockAt()
    try {
      drag(-400, -20)
      rig.snap()
      const yaw = rig.yaw()
      const pitch = rig.pitch()
      expect(yaw).toBeCloseTo(OVERVIEW.yaw + 2)
      rig.overview()
      rig.update(0.016)
      expect(rig.yaw()).toBeCloseTo(yaw, 6)
      expect(rig.pitch()).toBeCloseTo(pitch, 6)
      expect(rig.yaw()).not.toBeCloseTo(OVERVIEW.yaw, 3)
    } finally {
      clock.restore()
      close()
    }
  })

  it('arrives at the overview by the end of PARK_EASE_MS', () => {
    const { rig, drag, close } = openRig()
    const clock = clockAt()
    try {
      drag(-400, -20)
      rig.snap()
      const yaw = rig.yaw()
      rig.overview()
      rig.update(0.016)
      clock.advance(PARK_EASE_MS / 2)
      rig.update(0.016)
      expect(rig.yaw()).toBeLessThan(yaw)
      expect(rig.yaw()).toBeGreaterThan(OVERVIEW.yaw)
      clock.advance(PARK_EASE_MS / 2)
      rig.update(0.016)
      expect(rig.yaw()).toBeCloseTo(OVERVIEW.yaw, 6)
      expect(rig.pitch()).toBeCloseTo(OVERVIEW.pitch, 6)
    } finally {
      clock.restore()
      close()
    }
  })

  it('ends the turn when the owner drags during it', () => {
    const { rig, drag, close } = openRig()
    const clock = clockAt()
    try {
      drag(-400, 0)
      rig.snap()
      rig.overview()
      rig.update(0.016)
      clock.advance(400)
      rig.update(0.016)
      drag(-100, 0)
      clock.advance(PARK_EASE_MS)
      for (let step = 0; step < 200; step += 1) rig.update(0.016)
      expect(rig.yaw()).toBeCloseTo(OVERVIEW.yaw + 0.5, 2)
      expect(rig.yaw()).not.toBeCloseTo(OVERVIEW.yaw, 1)
    } finally {
      clock.restore()
      close()
    }
  })

  it('ends the turn when the owner zooms during it', () => {
    const { rig, camera, drag, wheel, close } = openRig()
    const clock = clockAt()
    try {
      const target = new THREE.Vector3(OVERVIEW.x, OVERVIEW.y, OVERVIEW.z)
      drag(-400, 0)
      rig.snap()
      rig.overview()
      rig.update(0.016)
      wheel(-600)
      rig.update(0.016)
      expect(camera.position.distanceTo(target)).toBeLessThan(OVERVIEW.dist - 40)
    } finally {
      clock.restore()
      close()
    }
  })

  it('takes the shortest turn home after several turns', () => {
    const { rig, drag, close } = openRig()
    const clock = clockAt()
    try {
      drag(-8000, 0)
      rig.snap()
      const start = rig.yaw()
      const turns = Math.round((start - OVERVIEW.yaw) / (Math.PI * 2))
      const goal = OVERVIEW.yaw + turns * Math.PI * 2
      expect(turns).toBeGreaterThan(5)
      expect(Math.abs(goal - start)).toBeLessThanOrEqual(Math.PI)
      rig.overview()
      clock.advance(PARK_EASE_MS)
      rig.update(0.016)
      expect(rig.yaw()).toBeCloseTo(goal, 6)
      expect(Math.abs(rig.yaw() - start)).toBeLessThanOrEqual(Math.PI + 1e-6)
      expect(rig.yaw()).not.toBeCloseTo(OVERVIEW.yaw, 3)
    } finally {
      clock.restore()
      close()
    }
  })

  it('jumps home at once under reduced motion', () => {
    const { rig, drag, close } = openRig({ still: true })
    try {
      drag(-400, -20)
      rig.snap()
      expect(rig.yaw()).not.toBeCloseTo(OVERVIEW.yaw)
      rig.overview()
      rig.update(0.016)
      expect(rig.yaw()).toBeCloseTo(OVERVIEW.yaw, 6)
      expect(rig.pitch()).toBeCloseTo(OVERVIEW.pitch, 6)
    } finally {
      close()
    }
  })
})

describe('camera rig park with a moving fit', () => {
  it('keeps the 2200 ms turn and eases to the goal a fit sets during it', () => {
    const { rig, camera, drag, close } = openRig()
    const clock = clockAt()
    try {
      drag(-400, -20)
      rig.snap()
      const yaw = rig.yaw()
      rig.overview()
      rig.update(0.016)
      clock.advance(PARK_EASE_MS / 2)
      rig.update(0.016)
      expect(rig.yaw()).toBeCloseTo((yaw + OVERVIEW.yaw) / 2, 5)
      const target = new THREE.Vector3(120, 240, -80)
      rig.setFit(target, 3000)
      rig.update(0.016)
      expect(rig.yaw()).toBeCloseTo((yaw + OVERVIEW.yaw) / 2, 5)
      clock.advance(PARK_EASE_MS / 2)
      rig.update(0.016)
      expect(rig.yaw()).toBeCloseTo(OVERVIEW.yaw, 6)
      expect(camera.position.distanceTo(target)).toBeCloseTo(3000, 1)
      expect(rig.zoomMultiplier()).toBeCloseTo(1, 6)
    } finally {
      clock.restore()
      close()
    }
  })

  it('keeps the view still in the frame after a mid-turn setFit', () => {
    const { rig, camera, drag, rest, close } = openRig()
    const clock = clockAt()
    try {
      drag(-400, -20)
      rest()
      rig.update(1)
      rig.snap()
      rig.overview()
      rig.update(0.016)
      clock.advance(PARK_EASE_MS / 2)
      rig.update(0.016)
      const before = camera.position.clone()
      const yaw = rig.yaw()
      const pitch = rig.pitch()
      rig.setFit(new THREE.Vector3(60, 210, -40), 2700)
      rig.update(0.016)
      expect(camera.position.distanceTo(before)).toBeLessThan(0.001)
      expect(rig.yaw()).toBeCloseTo(yaw, 8)
      expect(rig.pitch()).toBeCloseTo(pitch, 8)
    } finally {
      clock.restore()
      close()
    }
  })

  it('moves the view by a small bound in the frame after a mid-turn setFit', () => {
    const { rig, camera, close } = openRig()
    const clock = clockAt()
    try {
      rig.overview()
      rig.update(0.016)
      clock.advance(PARK_EASE_MS / 2)
      rig.update(0.016)
      const before = camera.position.clone()
      rig.setFit(new THREE.Vector3(60, 210, -40), 2700)
      clock.advance(16)
      rig.update(0.016)
      expect(camera.position.distanceTo(before)).toBeLessThan(8)
    } finally {
      clock.restore()
      close()
    }
  })

  it('keeps the view still in the frame after a mid-turn target or distance change', () => {
    const { rig, camera, drag, rest, close } = openRig()
    const clock = clockAt()
    try {
      drag(-400, -20)
      rest()
      rig.update(1)
      rig.snap()
      rig.overview()
      rig.update(0.016)
      clock.advance(PARK_EASE_MS / 2)
      rig.update(0.016)
      const before = camera.position.clone()
      rig.setOverviewTarget(new THREE.Vector3(30, 240, -20))
      rig.update(0.016)
      expect(camera.position.distanceTo(before)).toBeLessThan(0.001)
      const targetMoved = camera.position.clone()
      rig.setOverviewDistance(3200)
      rig.update(0.016)
      expect(camera.position.distanceTo(targetMoved)).toBeLessThan(0.001)
    } finally {
      clock.restore()
      close()
    }
  })

  it('keeps the turn when two fits change the goal in a row', () => {
    const { rig, drag, close } = openRig()
    const clock = clockAt()
    try {
      drag(-400, 0)
      rig.snap()
      const yaw = rig.yaw()
      rig.overview()
      rig.update(0.016)
      clock.advance(PARK_EASE_MS / 4)
      rig.setOverviewTarget(new THREE.Vector3(0, 300, 0))
      rig.setOverviewDistance(3200)
      rig.update(0.016)
      clock.advance(PARK_EASE_MS / 4)
      rig.setFit(new THREE.Vector3(0, 180, 0), 2800)
      rig.update(0.016)
      expect(rig.yaw()).toBeLessThan(yaw)
      expect(rig.yaw()).toBeGreaterThan(OVERVIEW.yaw)
      clock.advance(PARK_EASE_MS / 2)
      rig.update(0.016)
      expect(rig.yaw()).toBeCloseTo(OVERVIEW.yaw, 6)
    } finally {
      clock.restore()
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

  it('zooms while a card is held and keeps the held point', () => {
    const { rig, camera, wheel, close } = openRig({ still: true })
    try {
      const point = new THREE.Vector3(700, 260, -500)
      rig.hold(() => point, ANCHOR_DIST)
      rig.update(0.016)
      expect(camera.position.distanceTo(point)).toBeCloseTo(ANCHOR_DIST, 5)

      wheel(-600)
      rig.update(0.016)
      const zoomed = camera.position.distanceTo(point)
      expect(zoomed).toBeLessThan(ANCHOR_DIST)
      const facing = new THREE.Vector3()
      camera.getWorldDirection(facing)
      expect(facing.dot(point.clone().sub(camera.position).normalize())).toBeCloseTo(1, 5)

      rig.setZoomShare(0.5)
      rig.update(0.016)
      expect(camera.position.distanceTo(point)).not.toBeCloseTo(zoomed, 3)
      camera.getWorldDirection(facing)
      expect(facing.dot(point.clone().sub(camera.position).normalize())).toBeCloseTo(1, 5)
    } finally {
      close()
    }
  })
})

describe('camera idle spin', () => {
  it('is free at rest and stops being free under a hold or a follow', () => {
    const { rig, close } = openRig()
    try {
      expect(rig.free()).toBe(true)
      rig.hold(() => new THREE.Vector3(0, 200, 0), ANCHOR_DIST)
      expect(rig.free()).toBe(false)
      rig.stopFollow()
      expect(rig.free()).toBe(true)
      rig.focus(() => new THREE.Vector3(0, 200, 0), 1200)
      expect(rig.free()).toBe(false)
    } finally {
      close()
    }
  })

  it('turns the yaw while the rig is free', () => {
    const { rig, close } = openRig()
    try {
      const start = rig.yaw()
      rig.setSpin(true)
      for (let step = 0; step < 60; step += 1) rig.update(1 / 60)
      rig.snap()
      expect(rig.yaw()).toBeGreaterThan(start)
      expect(rig.yaw() - start).toBeCloseTo(IDLE_SPIN, 5)
    } finally {
      close()
    }
  })

  it('turns spin off under a hold', () => {
    const { rig, close } = openRig()
    try {
      rig.setSpin(true)
      for (let step = 0; step < 30; step += 1) rig.update(1 / 60)
      rig.hold(() => new THREE.Vector3(700, 260, -500), ANCHOR_DIST)
      expect(rig.free()).toBe(false)
      rig.stopFollow()
      expect(rig.free()).toBe(true)
      rig.snap()
      const yaw = rig.yaw()
      for (let step = 0; step < 60; step += 1) rig.update(1 / 60)
      expect(rig.yaw()).toBeCloseTo(yaw, 6)
    } finally {
      close()
    }
  })

  it('turns spin off under a follow', () => {
    const { rig, close } = openRig()
    try {
      rig.setSpin(true)
      for (let step = 0; step < 30; step += 1) rig.update(1 / 60)
      rig.focus(() => new THREE.Vector3(700, 260, -500), 1200)
      expect(rig.free()).toBe(false)
      rig.stopFollow()
      rig.snap()
      const yaw = rig.yaw()
      for (let step = 0; step < 60; step += 1) rig.update(1 / 60)
      expect(rig.yaw()).toBeCloseTo(yaw, 6)
    } finally {
      close()
    }
  })

  it('eases to a stop without a jump back to the overview', () => {
    const { rig, close } = openRig()
    try {
      rig.setSpin(true)
      for (let step = 0; step < 120; step += 1) rig.update(1 / 60)
      const spun = rig.yaw()
      expect(spun).not.toBeCloseTo(OVERVIEW.yaw)
      rig.setSpin(false)
      for (let step = 0; step < 120; step += 1) rig.update(1 / 60)
      expect(rig.yaw()).toBeGreaterThanOrEqual(spun - 1e-6)
      expect(rig.yaw() - spun).toBeLessThan(0.01)
      expect(Math.abs(rig.yaw() - OVERVIEW.yaw)).toBeGreaterThan(0.05)
    } finally {
      close()
    }
  })

  it('still returns to the overview on overview()', () => {
    const { rig, close } = openRig()
    const clock = clockAt()
    try {
      rig.setSpin(true)
      for (let step = 0; step < 30; step += 1) rig.update(1 / 60)
      rig.overview()
      rig.update(0.016)
      clock.advance(PARK_EASE_MS)
      rig.update(0.016)
      expect(rig.yaw()).toBeCloseTo(OVERVIEW.yaw, 5)
    } finally {
      clock.restore()
      close()
    }
  })

  it('does not set adjusted while it spins', () => {
    const { rig, close } = openRig()
    try {
      rig.setSpin(true)
      for (let step = 0; step < 60; step += 1) rig.update(1 / 60)
      rig.setSpin(false)
      rig.setOverviewDistance(1800)
      expect(rig.zoomMultiplier()).toBeCloseTo(1, 2)
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

describe('projectPoint', () => {
  it('lands a point at the target in the middle of the surface', () => {
    const camera = new THREE.PerspectiveCamera(FOV, 1000 / 800, 1, 60000)
    camera.position.set(0, 0, 2600)
    camera.lookAt(0, 200, 0)

    const point = projectPoint(camera, new THREE.Vector3(0, 200, 0), 1000, 800)
    expect(point.x).toBeCloseTo(500, 5)
    expect(point.y).toBeCloseTo(400, 5)
  })

  it('lands a point to the right of the middle', () => {
    const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 60000)
    camera.position.set(0, 0, 0)
    camera.lookAt(0, 0, -1)

    const point = projectPoint(camera, { x: 100, y: 0, z: -500 }, 800, 600)
    expect(point.x).toBeGreaterThan(400)
    expect(point.y).toBeCloseTo(300, 5)
  })

  it('answers null for a point behind the camera', () => {
    const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 60000)
    camera.position.set(0, 0, 0)
    camera.lookAt(0, 0, -1)

    expect(projectPoint(camera, { x: 0, y: 0, z: 500 }, 800, 600)).toBeNull()
    expect(projectPoint(camera, { x: 100, y: 20, z: 500 }, 800, 600)).toBeNull()
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

  it('caps the fit at 8000', () => {
    const wide = [
      { x: 0, y: 0, z: 0, r: 500 },
      { x: 40000, y: 0, z: 0, r: 500 },
    ]
    expect(fitView(wide, { width: 400, height: 300 }).dist).toBe(8000)
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

  it('backs off as the room grows', () => {
    const wider = [...room, { x: -3200, y: 200, z: 0, r: 400 }]
    expect(fitView(wider).dist).toBeGreaterThan(fitView(room).dist)
  })

  it('gives the same answer every time', () => {
    expect(fitView(room)).toEqual(fitView(room))
  })
})

describe('the pointer hover rect', () => {
  it('reads the surface rect once per resize, not on every move', () => {
    const { rig, move, close, rectReads } = openRig()
    try {
      const reads = rectReads()
      for (let index = 0; index < 10; index += 1) move(500 + index, 400)
      expect(rectReads()).toBe(reads)
      rig.resize()
      expect(rectReads()).toBe(reads + 1)
      for (let index = 0; index < 10; index += 1) move(500, 400 + index)
      expect(rectReads()).toBe(reads + 1)
    } finally {
      close()
    }
  })

  it('reads the surface rect once more after a page scroll', () => {
    const { move, scroll, close, rectReads } = openRig()
    try {
      const reads = rectReads()
      for (let index = 0; index < 10; index += 1) move(500 + index, 400)
      expect(rectReads()).toBe(reads)
      scroll()
      move(500, 400)
      expect(rectReads()).toBe(reads + 1)
      for (let index = 0; index < 10; index += 1) move(500 + index, 400)
      expect(rectReads()).toBe(reads + 1)
    } finally {
      close()
    }
  })
})
