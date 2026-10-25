import * as THREE from 'three'
import { easeInOut, easeRate, still } from './sprites.js'

const MIN_DIST = 500
const MAX_DIST = 26000

export const OVERVIEW = { x: 0, y: 200, z: 0, yaw: 0.42, pitch: 0.3, dist: 2600 }
export const FOV = 50
export const FIT_MIN = 900
export const CARD_NAME_FONT = 15
export const CARD_NAME_MIN = 11
export const FOLLOW_HOLD_MS = 4000
export const FOLLOW_EASE_MS = 1200
const FOLLOW_WIDE_MIN = 900
const FOLLOW_CLOSE_MIN = 620
const MIDDLE_EDGE = 1 / 6
const FIT_MARGIN = { x: 0.95, y: 0.95 }
const DRIFT_X = 60
const DRIFT_Y = 36
const driftRight = new THREE.Vector3()
const driftUp = new THREE.Vector3()

export function viewBasis(yaw, pitch) {
  const back = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) }
  const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) }
  const up = { x: -Math.sin(pitch) * Math.sin(yaw), y: Math.cos(pitch), z: -Math.sin(pitch) * Math.cos(yaw) }
  return { back, right, up }
}

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const finiteRadius = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null)
const radiusX = (s) => {
  const value = finiteRadius(s?.rx)
  if (value !== null) return value
  return finiteRadius(s?.r) ?? 0
}
const radiusY = (s) => {
  const value = finiteRadius(s?.ry)
  if (value !== null) return value
  return finiteRadius(s?.r) ?? 0
}
const radius = (s) => Math.max(radiusX(s), radiusY(s))

export function fitView(spheres, { yaw = OVERVIEW.yaw, pitch = OVERVIEW.pitch, fov = FOV, aspect = 1.6, width = 0, height = 0, min = FIT_MIN } = {}) {
  if (spheres.length === 0) return { target: { x: OVERVIEW.x, y: OVERVIEW.y, z: OVERVIEW.z }, dist: OVERVIEW.dist }
  const lensAspect = Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : aspect
  const { back, right, up } = viewBasis(yaw, pitch)
  const low = { x: Infinity, y: Infinity, z: Infinity }
  const high = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const s of spheres) {
    const r = radius(s)
    for (const axis of ['x', 'y', 'z']) {
      low[axis] = Math.min(low[axis], s[axis] - r)
      high[axis] = Math.max(high[axis], s[axis] + r)
    }
  }
  const middle = { x: (low.x + high.x) / 2, y: (low.y + high.y) / 2, z: (low.z + high.z) / 2 }
  const span = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
  for (const s of spheres) {
    const d = { x: s.x - middle.x, y: s.y - middle.y, z: s.z - middle.z }
    const x = dot(d, right)
    const y = dot(d, up)
    span.x0 = Math.min(span.x0, x - radiusX(s))
    span.x1 = Math.max(span.x1, x + radiusX(s))
    span.y0 = Math.min(span.y0, y - radiusY(s))
    span.y1 = Math.max(span.y1, y + radiusY(s))
  }
  const sx = (span.x0 + span.x1) / 2
  const sy = (span.y0 + span.y1) / 2
  const target = {
    x: middle.x + right.x * sx + up.x * sy,
    y: middle.y + right.y * sx + up.y * sy,
    z: middle.z + right.z * sx + up.z * sy,
  }
  const tanV = Math.tan((fov * Math.PI) / 360) * FIT_MARGIN.y
  const tanH = Math.tan((fov * Math.PI) / 360) * lensAspect * FIT_MARGIN.x
  let dist = min
  for (const s of spheres) {
    const d = { x: s.x - target.x, y: s.y - target.y, z: s.z - target.z }
    const depth = dot(d, back)
    dist = Math.max(dist, (Math.abs(dot(d, right)) + radiusX(s)) / tanH + depth, (Math.abs(dot(d, up)) + radiusY(s)) / tanV + depth)
  }
  return { target, dist: Math.min(dist, MAX_DIST) }
}

export function minTextScale(screenScale, font = CARD_NAME_FONT, min = CARD_NAME_MIN) {
  const value = Number(screenScale)
  if (!Number.isFinite(value) || value <= 0 || !(font > 0) || !(min > 0)) return 1
  return Math.max(1, min / (font * value))
}

function insideMiddle(frame) {
  if (!frame || !frame.card || !(frame.width > 0) || !(frame.height > 0)) return false
  const card = frame.card
  if (![card.x, card.y, card.width, card.height].every(Number.isFinite)) return false
  const left = frame.width * MIDDLE_EDGE
  const right = frame.width - left
  const top = frame.height * MIDDLE_EDGE
  const bottom = frame.height - top
  return (
    card.x - card.width / 2 >= left &&
    card.x + card.width / 2 <= right &&
    card.y - card.height / 2 >= top &&
    card.y + card.height / 2 <= bottom
  )
}

export function followTarget(previous, next, frame, now) {
  const held = previous && typeof previous.path === 'string' ? previous : null
  const wanted = next && typeof next.path === 'string' ? next : null
  if (!held) {
    if (!wanted) return null
    return { path: wanted.path, at: now, moved: true }
  }
  if (!wanted || wanted.path === held.path) {
    return { path: held.path, at: held.at, moved: false }
  }
  const since = Number.isFinite(held.at) ? held.at : 0
  if (now - since < FOLLOW_HOLD_MS) {
    return { path: held.path, at: held.at, moved: false }
  }
  if (insideMiddle(frame)) {
    return { path: held.path, at: held.at, moved: false }
  }
  return { path: wanted.path, at: now, moved: true }
}

export function createCameraRig(camera, surface) {
  const view = { target: new THREE.Vector3(OVERVIEW.x, OVERVIEW.y, OVERVIEW.z), yaw: OVERVIEW.yaw, pitch: OVERVIEW.pitch, dist: OVERVIEW.dist }
  const goal = { target: view.target.clone(), yaw: view.yaw, pitch: view.pitch, dist: view.dist }
  const drag = { active: false, moved: 0, x: 0, y: 0 }
  let follow = null
  let transition = null
  let onClick = () => {}
  let overviewDist = OVERVIEW.dist
  const overviewTarget = new THREE.Vector3(OVERVIEW.x, OVERVIEW.y, OVERVIEW.z)
  let adjusted = false
  const drift = { x: 0, y: 0, sx: 0, sy: 0 }

  function hover(event) {
    const rect = surface.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    drift.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    drift.y = ((event.clientY - rect.top) / rect.height) * 2 - 1
  }

  function down(event) {
    if (event.target.closest('.hud, .mr-term, .mr-card, .mr-board')) return
    drag.active = true
    drag.moved = 0
    drag.x = event.clientX
    drag.y = event.clientY
  }

  function move(event) {
    if (!drag.active) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    drag.moved += Math.abs(dx) + Math.abs(dy)
    adjusted = true
    drag.x = event.clientX
    drag.y = event.clientY
    goal.yaw -= dx * 0.005
    goal.pitch = THREE.MathUtils.clamp(goal.pitch + dy * 0.004, 0.08, 1.45)
  }

  function up(event) {
    if (!drag.active) return
    drag.active = false
    if (drag.moved < 6) onClick(event)
  }

  function wheel(event) {
    if (event.target.closest('.hud, .mr-board')) return
    adjusted = true
    goal.dist = THREE.MathUtils.clamp(goal.dist * Math.exp(event.deltaY * 0.001), MIN_DIST, MAX_DIST)
  }

  surface.addEventListener('pointerdown', down)
  window.addEventListener('pointermove', move)
  window.addEventListener('pointermove', hover)
  window.addEventListener('pointerup', up)
  surface.addEventListener('wheel', wheel, { passive: true })

  function reset() {
    follow = null
    transition = null
    adjusted = false
    goal.target.copy(overviewTarget)
    goal.yaw = OVERVIEW.yaw
    goal.pitch = OVERVIEW.pitch
    goal.dist = overviewDist
    view.target.copy(goal.target)
    view.yaw = goal.yaw
    view.pitch = goal.pitch
    view.dist = goal.dist
  }

  function startTransition(duration = FOLLOW_EASE_MS) {
    transition = {
      fromTarget: view.target.clone(),
      fromDist: view.dist,
      start: performance.now(),
      duration: still() ? 0 : duration,
    }
  }

  function update(delta) {
    if (follow) {
      const spot = follow()
      goal.target.copy(spot.target)
      goal.dist = spot.dist
    }
    if (![goal.target.x, goal.target.y, goal.target.z, goal.dist, goal.yaw, goal.pitch].every(Number.isFinite)) reset()
    const isStill = still()
    const rate = easeRate(delta, 5, isStill)
    if (transition) {
      if (isStill) {
        view.target.copy(goal.target)
        view.dist = goal.dist
        transition = null
      } else {
        const t = transition.duration <= 0 ? 1 : Math.min(1, (performance.now() - transition.start) / transition.duration)
        const eased = easeInOut(t)
        view.target.lerpVectors(transition.fromTarget, goal.target, eased)
        view.dist = transition.fromDist + (goal.dist - transition.fromDist) * eased
        if (t >= 1) transition = null
      }
    } else {
      view.target.lerp(goal.target, rate)
      view.dist += (goal.dist - view.dist) * rate
    }
    view.yaw += (goal.yaw - view.yaw) * rate
    view.pitch += (goal.pitch - view.pitch) * rate
    const horizontal = Math.cos(view.pitch) * view.dist
    camera.position.set(
      view.target.x + Math.sin(view.yaw) * horizontal,
      view.target.y + Math.sin(view.pitch) * view.dist,
      view.target.z + Math.cos(view.yaw) * horizontal
    )
    camera.lookAt(view.target)
    if (!isStill) {
      drift.sx += (drift.x - drift.sx) * Math.min(1, delta * 3)
      drift.sy += (drift.y - drift.sy) * Math.min(1, delta * 3)
      driftRight.set(1, 0, 0).applyQuaternion(camera.quaternion)
      driftUp.set(0, 1, 0).applyQuaternion(camera.quaternion)
      camera.position.addScaledVector(driftRight, drift.sx * DRIFT_X).addScaledVector(driftUp, -drift.sy * DRIFT_Y)
    }
    camera.updateMatrixWorld()
  }

  function snap() {
    transition = null
    view.target.copy(goal.target)
    view.yaw = goal.yaw
    view.pitch = goal.pitch
    view.dist = goal.dist
  }

  return {
    update,
    snap,
    setClickHandler(handler) {
      onClick = handler
    },
    focus(position, dist = 1500, pitch = null) {
      transition = null
      follow = () => ({ target: position(), dist })
      goal.dist = dist
      goal.pitch = pitch ?? Math.max(goal.pitch, 0.5)
    },
    followSpheres(spheres, mode = 'wide', duration = FOLLOW_EASE_MS) {
      follow = () => {
        const next = fitView(spheres(), {
          yaw: view.yaw,
          pitch: view.pitch,
          fov: camera.fov || FOV,
          aspect: camera.aspect || 1,
          min: mode === 'close' ? FOLLOW_CLOSE_MIN : FOLLOW_WIDE_MIN,
        })
        return { target: next.target, dist: next.dist }
      }
      startTransition(duration)
    },
    stopFollow() {
      follow = null
      transition = null
      goal.target.copy(view.target)
      goal.dist = view.dist
      goal.yaw = view.yaw
      goal.pitch = view.pitch
    },
    setOverviewDistance(distance) {
      overviewDist = THREE.MathUtils.clamp(distance, MIN_DIST, MAX_DIST)
      if (!adjusted && !follow) goal.dist = overviewDist
    },
    setOverviewTarget(position) {
      overviewTarget.copy(position)
      if (!adjusted && !follow) goal.target.copy(overviewTarget)
    },
    overview() {
      follow = null
      transition = null
      adjusted = false
      goal.target.copy(overviewTarget)
      goal.yaw = OVERVIEW.yaw
      goal.pitch = OVERVIEW.pitch
      goal.dist = overviewDist
    },
    dispose() {
      surface.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointermove', hover)
      window.removeEventListener('pointerup', up)
      surface.removeEventListener('wheel', wheel)
    },
  }
}
