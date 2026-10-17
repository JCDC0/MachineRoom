import * as THREE from 'three'

const MIN_DIST = 500
const MAX_DIST = 26000

export const OVERVIEW = { x: 0, y: 200, z: 450, yaw: 0, pitch: 0.72, dist: 4300 }

export function fitDistance(extent, aspect) {
  const narrow = Math.max(1, 1.33 / aspect)
  return Math.max(OVERVIEW.dist, extent * 2.0 * narrow)
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

  function down(event) {
    if (event.target.closest('.hud, .mr-term')) return
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
      window.removeEventListener('pointerup', up)
      surface.removeEventListener('wheel', wheel)
    },
  }
}
