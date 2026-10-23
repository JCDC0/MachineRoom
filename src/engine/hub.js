import * as THREE from 'three'
import { isOrchestrator } from './shapes.js'
import { WHITE, lineMaterial, still } from './sprites.js'

export const HUB_RADIUS = 300
export const HUB_Y = 200
export const PARK_LIFT = 90
export const ORCHESTRATOR_LIFT = 360
export const HUB_CENTER = new THREE.Vector3(0, HUB_Y, 0)
export const ORCHESTRATOR_HOME = new THREE.Vector3(HUB_CENTER.x, HUB_Y + ORCHESTRATOR_LIFT, HUB_CENTER.z)

const TICKS = 120
const DASHES = 72
const SLOT_RADIUS = 46
const REST_OPACITY = 0.32

export function slotAngle(index, count) {
  return Math.PI / 2 + (index / Math.max(1, count)) * Math.PI * 2
}

export function slotPoint(index, count, out = new THREE.Vector3()) {
  const angle = slotAngle(index, count)
  return out.set(Math.cos(angle) * HUB_RADIUS, HUB_Y, Math.sin(angle) * HUB_RADIUS)
}

function ringPoints(radius, steps, y = 0) {
  return Array.from({ length: steps }, (_, i) => {
    const angle = (i / steps) * Math.PI * 2
    return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
  })
}

function segments(values) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3))
  return geometry
}

export function createHub(scene, agentsOrCount) {
  const count = Array.isArray(agentsOrCount) ? agentsOrCount.filter((agent) => !isOrchestrator(agent)).length : agentsOrCount
  const group = new THREE.Group()
  group.position.y = HUB_Y

  const main = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(HUB_RADIUS, 192)), lineMaterial(WHITE, REST_OPACITY))
  const inner = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(HUB_RADIUS * 0.86, 160)), lineMaterial(WHITE, 0.1))

  const dashValues = []
  for (let i = 0; i < DASHES; i++) {
    const a = (i / DASHES) * Math.PI * 2
    const b = a + (Math.PI * 2) / DASHES / 2.4
    const r = HUB_RADIUS * 1.14
    dashValues.push(Math.cos(a) * r, 0, Math.sin(a) * r, Math.cos(b) * r, 0, Math.sin(b) * r)
  }
  const dashes = new THREE.LineSegments(segments(dashValues), lineMaterial(WHITE, 0.16))

  const slotAngles = Array.from({ length: count }, (_, index) => slotAngle(index, count))
  const tickValues = []
  for (let i = 0; i < TICKS; i++) {
    const a = (i / TICKS) * Math.PI * 2
    const long = i % 10 === 0 ? 34 : 14
    tickValues.push(Math.cos(a) * HUB_RADIUS, 0, Math.sin(a) * HUB_RADIUS, Math.cos(a) * (HUB_RADIUS + long), 0, Math.sin(a) * (HUB_RADIUS + long))
  }
  for (const a of slotAngles) {
    tickValues.push(Math.cos(a) * (HUB_RADIUS - 70), 0, Math.sin(a) * (HUB_RADIUS - 70), Math.cos(a) * (HUB_RADIUS * 1.14), 0, Math.sin(a) * (HUB_RADIUS * 1.14))
  }
  const ticks = new THREE.LineSegments(segments(tickValues), lineMaterial(WHITE, 0.2))

  const centreValues = [-40, 0, 0, 40, 0, 0, 0, 0, -40, 0, 0, 40]
  const centre = new THREE.LineSegments(segments(centreValues), lineMaterial(WHITE, 0.14))
  const centreRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(24, 32)), lineMaterial(WHITE, 0.14))

  const slots = slotAngles.map((a) => {
    const marker = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(SLOT_RADIUS, 40)), lineMaterial(WHITE, 0.3))
    marker.position.set(Math.cos(a) * HUB_RADIUS, 0, Math.sin(a) * HUB_RADIUS)
    group.add(marker)
    return marker
  })

  group.add(main, inner, dashes, ticks, centre, centreRing)
  scene.add(group)

  let boost = 0

  function pulse(color, amount) {
    main.material.color.setHex(color)
    boost = Math.max(boost, amount)
  }

  function setSlot(index, color, opacity) {
    const marker = slots[index]
    if (!marker) return
    marker.material.color.setHex(color)
    marker.material.opacity = opacity
  }

  function update(time, delta) {
    const isStill = still()
    boost = Math.max(0, boost - delta * 1.2)
    main.material.opacity = REST_OPACITY + boost * 0.5
    if (boost <= 0.01) main.material.color.setHex(WHITE)
    if (!isStill) {
      dashes.rotation.y += delta * 0.04
    }
    slots.forEach((marker, index) => {
      marker.scale.setScalar(isStill ? 1 : 1 + 0.04 * Math.sin(time * 1.6 + index))
    })
  }

  function dispose() {
    scene.remove(group)
    group.traverse((object) => {
      object.geometry?.dispose()
      object.material?.dispose()
    })
  }

  return { group, pulse, setSlot, update, dispose }
}
