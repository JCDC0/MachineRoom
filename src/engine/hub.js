import * as THREE from 'three'
import { sectorArcs } from '../model/hierarchy.js'
import { minTextScale } from './camera.js'
import { isOrchestrator, isSubOrchestrator } from './shapes.js'
import { WHITE, lineMaterial, still, textSprite } from './sprites.js'

export const HUB_RADIUS = 300
export const HUB_Y = 200
export const PARK_LIFT = 90
export const ORCHESTRATOR_LIFT = 360
export const HUB_CENTER = new THREE.Vector3(0, HUB_Y, 0)
export const ORCHESTRATOR_HOME = new THREE.Vector3(HUB_CENTER.x, HUB_Y + ORCHESTRATOR_LIFT, HUB_CENTER.z)

export const RING_OPACITY = 0.32
export const SECTOR_ARC_HALF_WIDTH = 9
export const SECTOR_ARC_GAP = 0.055
export const SECTOR_ARC_OPACITY = Object.freeze({ main: 0.52, sub: 0.88 })
export const SECTOR_LABEL_BASE = 0.9
export const SECTOR_LABEL_FONT = 28
export const SECTOR_LABEL_MIN = 12
export const SECTOR_LABEL_OUT = 220
export const SECTOR_LABEL_SPREAD = 60
export const SECTOR_LABEL_DROP = 180
export const SECTOR_LABEL_OPACITY = 0.45
export const SECTOR_LABEL_COLOR = `rgba(255,255,255,${SECTOR_LABEL_OPACITY})`

const TICKS = 120
const DASHES = 72
const SLOT_RADIUS = 46
const ARC_STEPS = 96
const SECTOR_EPSILON = 0.0001
const labelWorld = new THREE.Vector3()

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

export function arcDrawSpan(start, end, gap = SECTOR_ARC_GAP) {
  const from = Number(start)
  const to = Number(end)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return { start: 0, end: 0 }
  const span = to - from
  const pad = Math.min(Math.max(0, Number(gap) || 0), span * 0.2)
  return { start: from + pad, end: to - pad }
}

export function sectorLabelScale(depth, focal, base = SECTOR_LABEL_BASE) {
  const distance = Number(depth)
  const focus = Number(focal)
  if (!(distance > 0) || !(focus > 0)) return 1
  return minTextScale((focus / distance) * base, SECTOR_LABEL_FONT, SECTOR_LABEL_MIN)
}

export function sectorLabelRadius(radius = HUB_RADIUS, sectors = 1) {
  const ring = Number(radius)
  const count = Number.isFinite(Number(sectors)) ? Math.max(1, Math.floor(Number(sectors))) : 1
  const base = Number.isFinite(ring) && ring > 0 ? ring : HUB_RADIUS
  return base + SECTOR_LABEL_OUT + (count - 1) * SECTOR_LABEL_SPREAD
}

export function sectorLabelPoint(angle, radius = HUB_RADIUS, sectors = 1, out = new THREE.Vector3()) {
  const mid = Number(angle)
  const theta = Number.isFinite(mid) ? mid : 0
  const distance = sectorLabelRadius(radius, sectors)
  return out.set(Math.cos(theta) * distance, -SECTOR_LABEL_DROP, Math.sin(theta) * distance)
}

export function sectorArcTone(main) {
  const center = main ? SECTOR_ARC_OPACITY.main : SECTOR_ARC_OPACITY.sub
  return { center, edge: center * 0.6 }
}

export function sectorArcRadii(radius = HUB_RADIUS) {
  return [radius - SECTOR_ARC_HALF_WIDTH, radius, radius + SECTOR_ARC_HALF_WIDTH]
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
  const labels = []
  if (!ladder) return { lines, labels }
  const arcs = sectorArcs(ladder, parkedKeys)
  for (const arc of arcs) {
    const span = arc.end - arc.start
    if (!(span > SECTOR_EPSILON)) continue
    const draw = arcDrawSpan(arc.start, arc.end)
    const main = arc.id === 'orchestrator'
    const tone = sectorArcTone(main)
    const sector = new THREE.Group()
    sector.name = `sector:${arc.id}`
    sectorArcRadii().forEach((radius, index) => {
      const points = []
      for (let i = 0; i <= ARC_STEPS; i++) {
        const angle = draw.start + ((draw.end - draw.start) * i) / ARC_STEPS
        points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius))
      }
      const opacity = index === 1 ? tone.center : tone.edge
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial(WHITE, opacity))
      line.userData.baseOpacity = opacity
      sector.add(line)
      lines.push(line)
    })
    const mid = (arc.start + arc.end) / 2
    const label = textSprite(String(arc.name).toUpperCase(), { scale: SECTOR_LABEL_BASE, color: SECTOR_LABEL_COLOR })
    label.position.copy(sectorLabelPoint(mid, HUB_RADIUS, arcs.length))
    label.userData.base = { x: label.scale.x, y: label.scale.y }
    label.userData.factor = 1
    sector.add(label)
    labels.push(label)
    group.add(sector)
  }
  return { lines, labels }
}

export function createHub(scene, agentsOrCount, ladder = null) {
  const roster = Array.isArray(agentsOrCount) ? agentsOrCount : null
  const parkedKeys = roster
    ? roster.filter((agent) => !isOrchestrator(agent) && !isSubOrchestrator(agent)).map((agent) => agent.key)
    : []
  const count = roster ? parkedKeys.length : Number(agentsOrCount) || 0
  const group = new THREE.Group()
  group.position.y = HUB_Y

  const main = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(HUB_RADIUS, 192)), lineMaterial(WHITE, RING_OPACITY))
  main.name = 'ring'
  main.userData.baseOpacity = RING_OPACITY
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
  let sectorLabels = []
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
    const built = buildSectors(currentLadder, parkedKeys, sectorGroup)
    sectorLines = built.lines
    sectorLabels = built.labels
    main.visible = !currentLadder
    ringLines = currentLadder ? sectorLines : [main]
    for (const line of ringLines) {
      line.material.color.setHex(WHITE)
      line.material.opacity = line.userData.baseOpacity ?? RING_OPACITY
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

  function update(time, delta, camera = null, viewportHeight = 0) {
    const isStill = still()
    boost = Math.max(0, boost - delta * 1.2)
    for (const line of ringLines) {
      const base = line.userData.baseOpacity ?? RING_OPACITY
      line.material.opacity = Math.min(1, base + boost * 0.5)
      if (boost <= 0.01) line.material.color.setHex(WHITE)
    }
    if (camera && viewportHeight > 0) {
      const focal = viewportHeight / 2 / Math.tan(((camera.fov || 50) * Math.PI) / 360)
      for (const label of sectorLabels) {
        label.getWorldPosition(labelWorld)
        const factor = sectorLabelScale(camera.position.distanceTo(labelWorld), focal)
        if (Math.abs(factor - label.userData.factor) > 0.01) {
          label.userData.factor = factor
          label.scale.set(label.userData.base.x * factor, label.userData.base.y * factor, 1)
        }
      }
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
