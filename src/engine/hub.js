import * as THREE from 'three'
import { sectorArcs } from '../model/hierarchy.js'
import { isOrchestrator, isSubOrchestrator } from './shapes.js'
import { WHITE, lineMaterial, still, textSprite } from './sprites.js'

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
const SECTOR_LABEL_RADIUS = HUB_RADIUS + 120
const SECTOR_LABEL_Y = 30
const ARC_STEPS = 96
const SECTOR_EPSILON = 0.0001

export function slotAngle(index, count) {
  return Math.PI / 2 + (index / Math.max(1, count)) * Math.PI * 2
}

export function slotPoint(index, count, out = new THREE.Vector3()) {
  const angle = slotAngle(index, count)
  return out.set(Math.cos(angle) * HUB_RADIUS, HUB_Y, Math.sin(angle) * HUB_RADIUS)
}

export function hasSubs(ladder) {
  return Boolean(ladder && Array.isArray(ladder.subs) && ladder.subs.length > 0)
}

function laneKeys(roster) {
  const keys = []
  for (const entry of Array.isArray(roster) ? roster : []) {
    const key = typeof entry === 'string' ? entry : entry && typeof entry.key === 'string' ? entry.key : null
    if (key && !keys.includes(key)) keys.push(key)
  }
  return keys
}

export function sectorSlotAngles(ladder, roster) {
  const keys = laneKeys(roster)
  const angles = new Map()
  if (!hasSubs(ladder)) {
    keys.forEach((key, index) => angles.set(key, slotAngle(index, keys.length)))
    return angles
  }
  for (const arc of sectorArcs(ladder, keys)) {
    const span = arc.end - arc.start
    const count = arc.lanes.length
    arc.lanes.forEach((key, index) => {
      angles.set(key, count > 0 ? arc.start + ((index + 0.5) / count) * span : (arc.start + arc.end) / 2)
    })
  }
  return angles
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

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose()
    child.material?.map?.dispose()
    child.material?.dispose()
  })
}

function clearGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child)
    disposeObject(child)
  }
}

function buildTicks(angles) {
  const values = []
  for (let i = 0; i < TICKS; i++) {
    const a = (i / TICKS) * Math.PI * 2
    const long = i % 10 === 0 ? 34 : 14
    values.push(Math.cos(a) * HUB_RADIUS, 0, Math.sin(a) * HUB_RADIUS, Math.cos(a) * (HUB_RADIUS + long), 0, Math.sin(a) * (HUB_RADIUS + long))
  }
  for (const a of angles) {
    values.push(Math.cos(a) * (HUB_RADIUS - 70), 0, Math.sin(a) * (HUB_RADIUS - 70), Math.cos(a) * (HUB_RADIUS * 1.14), 0, Math.sin(a) * (HUB_RADIUS * 1.14))
  }
  return new THREE.LineSegments(segments(values), lineMaterial(WHITE, 0.2))
}

function buildSlots(angles) {
  return angles.map((a) => {
    const marker = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(SLOT_RADIUS, 40)), lineMaterial(WHITE, 0.3))
    marker.name = 'slot'
    marker.position.set(Math.cos(a) * HUB_RADIUS, 0, Math.sin(a) * HUB_RADIUS)
    return marker
  })
}

function buildSectors(ladder, parkedKeys, group) {
  const lines = []
  if (!ladder) return lines
  for (const arc of sectorArcs(ladder, parkedKeys)) {
    const span = arc.end - arc.start
    if (!(span > SECTOR_EPSILON)) continue
    const points = []
    for (let i = 0; i <= ARC_STEPS; i++) {
      const angle = arc.start + (span * i) / ARC_STEPS
      points.push(new THREE.Vector3(Math.cos(angle) * HUB_RADIUS, 0, Math.sin(angle) * HUB_RADIUS))
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial(WHITE, REST_OPACITY))
    group.add(line)
    lines.push(line)
    const mid = (arc.start + arc.end) / 2
    const label = textSprite(String(arc.name).toUpperCase(), { scale: 0.9, color: 'rgba(255,255,255,.55)' })
    label.position.set(Math.cos(mid) * SECTOR_LABEL_RADIUS, SECTOR_LABEL_Y, Math.sin(mid) * SECTOR_LABEL_RADIUS)
    group.add(label)
  }
  return lines
}

export function createHub(scene, agentsOrCount, ladder = null) {
  const roster = Array.isArray(agentsOrCount) ? agentsOrCount : null
  const parkedKeys = roster
    ? roster.filter((agent) => !isOrchestrator(agent) && !isSubOrchestrator(agent)).map((agent) => agent.key)
    : []
  const count = roster ? parkedKeys.length : Number(agentsOrCount) || 0
  const group = new THREE.Group()
  group.position.y = HUB_Y

  const main = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(HUB_RADIUS, 192)), lineMaterial(WHITE, REST_OPACITY))
  main.name = 'ring'
  const inner = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(HUB_RADIUS * 0.86, 160)), lineMaterial(WHITE, 0.1))

  const dashValues = []
  for (let i = 0; i < DASHES; i++) {
    const a = (i / DASHES) * Math.PI * 2
    const b = a + (Math.PI * 2) / DASHES / 2.4
    const r = HUB_RADIUS * 1.14
    dashValues.push(Math.cos(a) * r, 0, Math.sin(a) * r, Math.cos(b) * r, 0, Math.sin(b) * r)
  }
  const dashes = new THREE.LineSegments(segments(dashValues), lineMaterial(WHITE, 0.16))

  const centreValues = [-40, 0, 0, 40, 0, 0, 0, 0, -40, 0, 0, 40]
  const centre = new THREE.LineSegments(segments(centreValues), lineMaterial(WHITE, 0.14))
  const centreRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(24, 32)), lineMaterial(WHITE, 0.14))

  let currentLadder = hasSubs(ladder) ? ladder : null
  let slotAngles = []
  let slots = []
  let sectorLines = []
  let ringLines = [main]
  let boost = 0

  function anglesFor(ladderValue) {
    if (parkedKeys.length > 0) {
      const angles = sectorSlotAngles(ladderValue, parkedKeys)
      return parkedKeys.map((key) => angles.get(key) ?? 0)
    }
    return Array.from({ length: count }, (_, index) => slotAngle(index, count))
  }

  const tickGroup = new THREE.Group()
  tickGroup.name = 'ticks'
  const sectorGroup = new THREE.Group()
  sectorGroup.name = 'sectors'
  slotAngles = anglesFor(currentLadder)
  slots = buildSlots(slotAngles)
  for (const marker of slots) group.add(marker)
  tickGroup.add(buildTicks(slotAngles))
  group.add(main, inner, dashes, tickGroup, centre, centreRing, sectorGroup)
  scene.add(group)

  function clearSlots() {
    for (const marker of slots) {
      group.remove(marker)
      disposeObject(marker)
    }
    slots = []
  }

  function rebuild() {
    slotAngles = anglesFor(currentLadder)
    clearGroup(tickGroup)
    tickGroup.add(buildTicks(slotAngles))
    clearSlots()
    slots = buildSlots(slotAngles)
    for (const marker of slots) group.add(marker)
    clearGroup(sectorGroup)
    sectorLines = buildSectors(currentLadder, parkedKeys, sectorGroup)
    main.visible = !currentLadder
    ringLines = currentLadder ? sectorLines : [main]
    for (const line of ringLines) {
      line.material.color.setHex(WHITE)
      line.material.opacity = REST_OPACITY
    }
    boost = 0
  }

  function setLadder(next) {
    currentLadder = hasSubs(next) ? next : null
    rebuild()
  }

  function pulse(color, amount) {
    for (const line of ringLines) line.material.color.setHex(color)
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
    for (const line of ringLines) {
      line.material.opacity = REST_OPACITY + boost * 0.5
      if (boost <= 0.01) line.material.color.setHex(WHITE)
    }
    if (!isStill) {
      dashes.rotation.y += delta * 0.04
    }
    slots.forEach((marker, index) => {
      marker.scale.setScalar(isStill ? 1 : 1 + 0.04 * Math.sin(time * 1.6 + index))
    })
  }

  function dispose() {
    scene.remove(group)
    disposeObject(group)
  }

  if (currentLadder) rebuild()

  return { group, pulse, setSlot, setLadder, update, dispose }
}
