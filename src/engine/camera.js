import * as THREE from 'three'

const MIN_DIST = 500
const MAX_DIST = 26000

export const OVERVIEW = { x: 0, y: 200, z: 0, yaw: 0.42, pitch: 0.3, dist: 2600 }
export const FOV = 50
export const FIT_MIN = 1800
const FIT_MARGIN = { x: 0.8, y: 0.84 }
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

export function fitView(spheres, { yaw = OVERVIEW.yaw, pitch = OVERVIEW.pitch, fov = FOV, aspect = 1.6, min = FIT_MIN } = {}) {
  if (spheres.length === 0) return { target: { x: OVERVIEW.x, y: OVERVIEW.y, z: OVERVIEW.z }, dist: OVERVIEW.dist }
  const { back, right, up } = viewBasis(yaw, pitch)
  const low = { x: Infinity, y: Infinity, z: Infinity }
  const high = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const s of spheres) {
    for (const axis of ['x', 'y', 'z']) {
      low[axis] = Math.min(low[axis], s[axis] - s.r)
      high[axis] = Math.max(high[axis], s[axis] + s.r)
    }
  }
  const middle = { x: (low.x + high.x) / 2, y: (low.y + high.y) / 2, z: (low.z + high.z) / 2 }
  const span = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
  for (const s of spheres) {
    const d = { x: s.x - middle.x, y: s.y - middle.y, z: s.z - middle.z }
    const x = dot(d, right)
    const y = dot(d, up)
    span.x0 = Math.min(span.x0, x - s.r)
    span.x1 = Math.max(span.x1, x + s.r)
    span.y0 = Math.min(span.y0, y - s.r)
    span.y1 = Math.max(span.y1, y + s.r)
  }
  const sx = (span.x0 + span.x1) / 2
  const sy = (span.y0 + span.y1) / 2
  const target = {
    x: middle.x + right.x * sx + up.x * sy,
    y: middle.y + right.y * sx + up.y * sy,
    z: middle.z + right.z * sx + up.z * sy,
  }
  const tanV = Math.tan((fov * Math.PI) / 360) * FIT_MARGIN.y
  const tanH = Math.tan((fov * Math.PI) / 360) * aspect * FIT_MARGIN.x
  let dist = min
  for (const s of spheres) {
    const d = { x: s.x - target.x, y: s.y - target.y, z: s.z - target.z }
    const depth = dot(d, back)
    dist = Math.max(dist, (Math.abs(dot(d, right)) + s.r) / tanH + depth, (Math.abs(dot(d, up)) + s.r) / tanV + depth)
  }
  return { target, dist: Math.min(dist, MAX_DIST) }
}

export function createCameraRig(camera, surface) {
  const view = { target: new THREE.Vector3(OVERVIEW.x, OVERVIEW.y, OVERVIEW.z), yaw: OVERVIEW.yaw, pitch: OVERVIEW.pitch, dist: OVERVIEW.dist }
  const goal = { target: view.target.clone(), yaw: view.yaw, pitch: view.pitch, dist: view.dist }
  const drag = { active: false, moved: 0, x: 0, y: 0 }
  let follow = null
  let onClick = () => {}
  let overviewDist = OVERVIEW.dist
  const overviewTarget = new THREE.Vector3(OVERVIEW.x, OVERVIEW.y, OVERVIEW.z)
  let adjusted = false
  const drift = { x: 0, y: 0, sx: 0, sy: 0 }
  const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function hover(event) {
    const rect = surface.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    drift.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    drift.y = ((event.clientY - rect.top) / rect.height) * 2 - 1
  }

  function down(event) {
    if (event.target.closest('.hud, .mr-term, .mr-card')) return
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
    if (event.target.closest('.hud')) return
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

  function update(delta) {
    if (follow) goal.target.copy(follow())
    if (![goal.target.x, goal.target.y, goal.target.z, goal.dist, goal.yaw, goal.pitch].every(Number.isFinite)) reset()
    const rate = 1 - Math.exp(-delta * 5)
    view.target.lerp(goal.target, rate)
    view.yaw += (goal.yaw - view.yaw) * rate
    view.pitch += (goal.pitch - view.pitch) * rate
    view.dist += (goal.dist - view.dist) * rate
    const horizontal = Math.cos(view.pitch) * view.dist
    camera.position.set(
      view.target.x + Math.sin(view.yaw) * horizontal,
      view.target.y + Math.sin(view.pitch) * view.dist,
      view.target.z + Math.cos(view.yaw) * horizontal
    )
    camera.lookAt(view.target)
    if (!still) {
      drift.sx += (drift.x - drift.sx) * Math.min(1, delta * 3)
      drift.sy += (drift.y - drift.sy) * Math.min(1, delta * 3)
      driftRight.set(1, 0, 0).applyQuaternion(camera.quaternion)
      driftUp.set(0, 1, 0).applyQuaternion(camera.quaternion)
      camera.position.addScaledVector(driftRight, drift.sx * DRIFT_X).addScaledVector(driftUp, -drift.sy * DRIFT_Y)
    }
    camera.updateMatrixWorld()
  }

  function snap() {
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
      follow = position
      goal.dist = dist
      goal.pitch = pitch ?? Math.max(goal.pitch, 0.5)
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
