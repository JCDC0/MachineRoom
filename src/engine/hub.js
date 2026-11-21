import * as THREE from 'three'
import { SECTOR_GAP, ownerOf } from '../model/hierarchy.js'
import { OVERVIEW, minTextScale } from './camera.js'
import { isOrchestrator, isSubOrchestrator } from './shapes.js'
import { WHITE, YELLOW, easeInOut, lineMaterial, still, textSprite } from './sprites.js'

export const HUB_RADIUS = 300
export const HUB_Y = 200
export const PARK_LIFT = 90
export const SUB_RING_DROP = 260
export const SUB_RING_OPACITY = 0.16
export const RING_LEVEL_MAX = 4
export const RING_FLOOR_Y = -120
export const RING_FLOOR_GAP = 60
export const RING_SLOT_SPACING = 100
export const SUB_STAND_LIFT = PARK_LIFT + 60
export const ORCHESTRATOR_LIFT = 360
export const READER_RADIUS = HUB_RADIUS * 1.4
export const HUB_CENTER = new THREE.Vector3(0, HUB_Y, 0)
export const ORCHESTRATOR_HOME = new THREE.Vector3(HUB_CENTER.x, HUB_Y + ORCHESTRATOR_LIFT, HUB_CENTER.z)

export const RING_OPACITY = 0.32
export const SECTOR_ARC_HALF_WIDTH = 9
export const SECTOR_ARC_GAP = 0.055
export const SECTOR_ARC_OPACITY = Object.freeze({ main: 0.52, sub: 0.88 })
export const SECTOR_LABEL_BASE = 0.9
export const SECTOR_LABEL_FONT = 28
export const SECTOR_LABEL_MIN = 12
export const SECTOR_LABEL_OUT = 300
export const SECTOR_LABEL_SPREAD = 20
export const SECTOR_LABEL_DROP = 40
export const SECTOR_LABEL_INSET = 0.1
export const SECTOR_LABEL_OPACITY = 0.45
export const SECTOR_LABEL_COLOR = `rgba(255,255,255,${SECTOR_LABEL_OPACITY})`
export const SECTOR_GLOW_MS = 1000
export const SEAT_LABEL_SCALE = 1.5
export const SEAT_LABEL_COLOR = 'rgba(255,255,255,1)'
export const SEAT_LABEL_OPACITY = 0.8
export const SEAT_LABEL_OUT = 160

export function writeColor(material, hex) {
  if (!material || !material.color) return false
  if (!material.userData) material.userData = {}
  if (material.userData.mrHex === hex) return false
  material.userData.mrHex = hex
  material.color.setHex(hex)
  return true
}

export function writeOpacity(material, value) {
  if (!material) return false
  if (material.opacity === value) return false
  material.opacity = value
  return true
}

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

export function isSessionReader(agent) {
  if (!agent) return false
  if (agent.sessionReader === true) return true
  return String(agent.key ?? '').endsWith('-session')
}

export function takesHubSlot(agent) {
  if (!agent) return false
  return !isOrchestrator(agent) && !isSubOrchestrator(agent) && !isSessionReader(agent)
}

export function parkedKeysFor(roster) {
  const keys = []
  for (const agent of Array.isArray(roster) ? roster : []) {
    if (!takesHubSlot(agent) || typeof agent.key !== 'string' || agent.key === '') continue
    if (!keys.includes(agent.key)) keys.push(agent.key)
  }
  return keys
}

export function readerAngles(laneAngles, readerCount) {
  if (laneAngles.length === 0) return Array.from({ length: readerCount }, (_, index) => slotAngle(index, readerCount))
  const turn = Math.PI * 2
  const lanes = [...new Set(laneAngles.map((angle) => ((angle % turn) + turn) % turn))].sort((a, b) => a - b)
  const gaps = lanes.map((start, index) => ({
    start,
    width: (lanes[index + 1] ?? lanes[0] + turn) - start,
    count: 0,
  }))
  for (let index = 0; index < readerCount; index += 1) {
    const widest = gaps.reduce((best, gap) => gap.width / (gap.count + 2) > best.width / (best.count + 2) ? gap : best)
    widest.count += 1
  }
  return gaps.flatMap(({ start, width, count }) =>
    Array.from({ length: count }, (_, index) => (start + width * (index + 1) / (count + 1)) % turn))
}

export function readerPoint(index, count, out = new THREE.Vector3(), angle = slotAngle(index, count)) {
  return out.set(Math.cos(angle) * READER_RADIUS, HUB_Y + PARK_LIFT, Math.sin(angle) * READER_RADIUS)
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

export function sectorLabelAngle(arc) {
  const start = Number(arc?.start)
  const end = Number(arc?.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return 0
  return start + (end - start) * SECTOR_LABEL_INSET
}

export function seatRingPoint(ring, layout = null) {
  if (!Number.isInteger(ring) || ring < 0) return null
  const entry = layout?.rings?.[ring]
  if (ring > 0 && !entry) return null
  const radius = entry ? entry.radius : HUB_RADIUS
  const y = entry ? entry.y - HUB_Y : 0
  const angle = -OVERVIEW.yaw
  const distance = radius + SEAT_LABEL_OUT
  return { x: Math.cos(angle) * distance, y, z: Math.sin(angle) * distance }
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

function sectorPlaces(arc) {
  const lanes = Array.isArray(arc?.lanes) ? arc.lanes : []
  const start = Number(arc?.start)
  const end = Number(arc?.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null
  return { lanes, start, span: end - start, sub: Number(arc?.level) > 0 }
}

export function sectorSubAngle(arc) {
  const info = sectorPlaces(arc)
  if (!info) return 0
  if (!info.sub) return info.start + info.span / 2
  const count = info.lanes.length + 1
  const subIndex = Math.floor(info.lanes.length / 2)
  return info.start + ((subIndex + 0.5) / count) * info.span
}

export function sectorLaneAngles(arc) {
  const info = sectorPlaces(arc)
  if (!info || info.lanes.length === 0) return []
  if (!info.sub) {
    return info.lanes.map((_, index) => info.start + ((index + 0.5) / info.lanes.length) * info.span)
  }
  const count = info.lanes.length + 1
  const subIndex = Math.floor(info.lanes.length / 2)
  return info.lanes.map((_, index) => {
    const place = index < subIndex ? index : index + 1
    return info.start + ((place + 0.5) / count) * info.span
  })
}

export function ringDepth(value, fallback = RING_LEVEL_MAX) {
  const raw = value !== null && typeof value === 'object' ? value.depth ?? value.limit : value
  if (raw === undefined || raw === null || raw === '') return fallback
  const number = Number(raw)
  if (!Number.isFinite(number)) return fallback
  return Math.min(RING_LEVEL_MAX, Math.max(1, Math.floor(number)))
}

export function topRingSeats({ topKey = 'orchestrator', extraKeys = [], withOrchestrator = true } = {}) {
  const top = typeof topKey === 'string' && topKey !== 'orchestrator' ? topKey : ''
  const extras = []
  for (const key of Array.isArray(extraKeys) ? extraKeys : []) {
    if (typeof key !== 'string' || key === '' || key === 'orchestrator' || key === top) continue
    if (!extras.includes(key)) extras.push(key)
  }
  const seats = new Map()
  if (top === '') {
    seats.set('orchestrator', 'centre')
    for (const key of extras) seats.set(key, 'reader')
    return { mode: 'centre', top: '', order: ['orchestrator', ...extras], seats }
  }
  const order = [top, ...(withOrchestrator ? ['orchestrator'] : []), ...extras]
  if (order.length === 1) {
    seats.set(top, 'centre')
    return { mode: 'centre', top, order, seats }
  }
  if (order.length === 2) {
    seats.set(top, 'top')
    seats.set(order[1], 'under')
    return { mode: 'stack', top, order, seats }
  }
  for (const key of order) seats.set(key, 'orbit')
  return { mode: 'orbit', top, order, seats }
}

export function topRingPoint(angle, out = new THREE.Vector3()) {
  const theta = Number.isFinite(Number(angle)) ? Number(angle) : 0
  return out.set(Math.cos(theta) * HUB_RADIUS, HUB_Y + PARK_LIFT, Math.sin(theta) * HUB_RADIUS)
}

export function ringLevels(ladder, max = RING_LEVEL_MAX) {
  const subs = Array.isArray(ladder?.subs) ? ladder.subs : []
  const depth = Math.min(RING_LEVEL_MAX, Math.max(1, Math.floor(Number(max)) || RING_LEVEL_MAX))
  const cap = Math.max(1, depth - 1)
  const parentOf = new Map(subs.map((sub) => [sub.id, sub.parent]))
  const levels = new Map()
  for (const sub of subs) {
    const seen = new Set([sub.id])
    let level = 1
    let id = parentOf.get(sub.id)
    while (parentOf.has(id) && !seen.has(id) && level < cap) {
      seen.add(id)
      level += 1
      id = parentOf.get(id)
    }
    levels.set(sub.id, level)
  }
  return levels
}

export function ringDrop(count, floor = RING_FLOOR_Y) {
  if (!(count > 0)) return SUB_RING_DROP
  return Math.max(0, Math.min(SUB_RING_DROP, (HUB_Y - (floor + RING_FLOOR_GAP)) / count))
}

export function ringY(level, count, floor = RING_FLOOR_Y) {
  return HUB_Y - Math.max(0, level) * ringDrop(count, floor)
}

export function ringRadius(level, slots) {
  if (!(level > 0)) return HUB_RADIUS
  return Math.max(HUB_RADIUS, (Math.max(0, Number(slots) || 0) * RING_SLOT_SPACING) / (Math.PI * 2))
}

export function ringArcs(ladder, roster, max = RING_LEVEL_MAX) {
  const keys = laneKeys(roster)
  const subs = hasSubs(ladder) ? ladder.subs : []
  const levels = ringLevels(ladder, max)
  const turn = Math.PI * 2
  const assigned = new Set()
  const perLevel = new Map()
  const arcs = subs.map((sub) => {
    const lanes = keys.filter((key) => !assigned.has(key) && Array.isArray(sub.lanes) && sub.lanes.includes(key))
    for (const lane of lanes) assigned.add(lane)
    const level = levels.get(sub.id)
    perLevel.set(level, (perLevel.get(level) ?? 0) + 1)
    return { id: sub.id, name: typeof sub.name === 'string' && sub.name ? sub.name : sub.id, lanes, level }
  })
  const seen = new Map()
  for (const arc of arcs) {
    const index = seen.get(arc.level) ?? 0
    seen.set(arc.level, index + 1)
    const span = turn / perLevel.get(arc.level)
    const inset = Math.min(SECTOR_GAP, span / 2)
    arc.start = index * span + inset
    arc.end = (index + 1) * span - inset
  }
  if (subs.length > 0) {
    arcs.push({ id: 'orchestrator', name: 'Orchestrator', lanes: keys.filter((key) => !assigned.has(key)), level: 0, start: SECTOR_GAP, end: turn - SECTOR_GAP })
  }
  return arcs
}

export function ringLayout(ladder, roster, max = RING_LEVEL_MAX, floor = RING_FLOOR_Y) {
  const arcs = ringArcs(ladder, roster, max)
  const count = arcs.reduce((most, arc) => Math.max(most, arc.level), 0)
  const slots = Array.from({ length: count + 1 }, () => 0)
  const byKey = new Map()
  for (const arc of arcs) {
    slots[arc.level] += arc.lanes.length + (arc.level > 0 ? 1 : 0)
    for (const key of arc.lanes) byKey.set(key, arc)
  }
  const rings = slots.map((total, level) => ({ level, y: ringY(level, count, floor), radius: ringRadius(level, total) }))
  return { arcs, rings, count, ringOf: (arc) => rings[arc.level], ringOfKey: (key) => rings[byKey.get(key)?.level ?? 0] }
}

export function sectorSlotAngles(ladder, roster, max = RING_LEVEL_MAX) {
  const keys = laneKeys(roster)
  const angles = new Map()
  if (!hasSubs(ladder)) {
    keys.forEach((key, index) => angles.set(key, slotAngle(index, keys.length)))
    return angles
  }
  for (const arc of ringArcs(ladder, keys, max)) {
    const laneAngles = sectorLaneAngles(arc)
    arc.lanes.forEach((key, index) => angles.set(key, laneAngles[index]))
  }
  return angles
}

export function sectorIdForKey(key, ladder) {
  const text = typeof key === 'string' ? key : ''
  if (text.startsWith('sub-')) return text.slice(4)
  if (text === '' || text === 'orchestrator') return 'orchestrator'
  return ownerOf(ladder, text)
}

export function sectorGlow(level, working, delta, reduced = false) {
  if (working) return 1
  if (reduced) return 0
  const current = Math.max(0, Math.min(1, Number(level) || 0))
  const step = (Math.max(0, Number(delta) || 0) * 1000) / SECTOR_GLOW_MS
  return Math.max(0, current - step)
}

export const DANCE_RISE_MS = 90
export const DANCE_SETTLE_MS = 420
export const SWAY_LIFT = 16
export const SWAY_SCALE = 0.05
export const SWAY_RATE = 0.0018
export const HUB_RING_GROW = 400
export const HUB_RING_MS = 1200
export const HUB_RING_POOL = 6
export const AGENT_RING_BASE = 130
export const AGENT_RING_GROW = 130
export const AGENT_RING_MS = 900
export const AGENT_RING_POOL = 3
export const RING_MAX_OPACITY = 0.32
export const AGENT_RING_MAX_OPACITY = 0.8
export const AGENT_RING_OPACITY_FLOOR = 0.35

export function ringPulse(base, grow, age, duration, strength, opacity = RING_MAX_OPACITY, out = null, floor = 0) {
  const target = out ?? {}
  const from = Math.max(0, Number(base) || 0)
  const extra = Math.max(0, Number(grow) || 0)
  const span = Math.max(1, Number(duration) || 1)
  const level = Math.min(1, Math.max(0, Number(strength) || 0))
  const minLevel = Math.min(1, Math.max(0, Number(floor) || 0))
  const effectiveLevel = Math.max(minLevel, level)
  const elapsed = Number(age)
  const t = Number.isFinite(elapsed) ? Math.min(1, Math.max(0, elapsed / span)) : 1
  target.radius = from + extra * (1 - (1 - t) ** 2)
  target.opacity = Math.min(1, Math.max(0, Number(opacity) || 0)) * effectiveLevel * (1 - t)
  return target
}

function danceLevel(value) {
  const level = Number(value)
  if (!Number.isFinite(level)) return 0
  return Math.min(1, Math.max(0, level))
}

export function danceEnvelope(from, to, age, rise = DANCE_RISE_MS, settle = DANCE_SETTLE_MS) {
  const start = danceLevel(from)
  const target = danceLevel(to)
  const elapsed = Number(age)
  if (!Number.isFinite(elapsed) || elapsed <= 0) return start
  const up = Math.max(1, Number(rise) || DANCE_RISE_MS)
  const down = Math.max(1, Number(settle) || DANCE_SETTLE_MS)
  if (elapsed < up) {
    const t = elapsed / up
    return start + (target - start) * (1 - (1 - t) ** 3)
  }
  const t = Math.min(1, (elapsed - up) / down)
  return target * (1 - easeInOut(t))
}

export function startDanceEnvelope(state, strength, now) {
  const at = Number(state?.at)
  const from = Number.isFinite(at) ? at : 0
  const stamp = Number(now)
  const atStamp = Number.isFinite(stamp) ? stamp : from
  const current = danceEnvelope(state?.from, state?.to, atStamp - from)
  return { from: current, to: Math.max(current, danceLevel(strength)), at: atStamp }
}

const NO_KEYS = Object.freeze([])

export function workingKeys(state, previous = NO_KEYS) {
  const before = Array.isArray(previous) ? previous : NO_KEYS
  const agents = state?.agents
  if (!agents || typeof agents.values !== 'function') return before.length === 0 ? before : NO_KEYS
  let count = 0
  let same = true
  for (const agent of agents.values()) {
    if (!agent || agent.status !== 'working') continue
    const key = typeof agent.key === 'string' ? agent.key : ''
    if (key === '') continue
    if (same && before[count] !== key) same = false
    count += 1
  }
  if (same && count === before.length) return before
  const keys = []
  for (const agent of agents.values()) {
    if (!agent || agent.status !== 'working') continue
    const key = typeof agent.key === 'string' ? agent.key : ''
    if (key !== '') keys.push(key)
  }
  return keys
}

function ringPoints(radius, steps, y = 0) {
  return Array.from({ length: steps }, (_, i) => {
    const angle = (i / steps) * Math.PI * 2
    return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
  })
}

function beatRing(name) {
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(1, 96)), lineMaterial(WHITE, 0))
  line.name = name
  line.visible = false
  return line
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

function placeOnRing(layout, key) {
  const ring = layout ? layout.ringOfKey(key) : null
  return ring ? { radius: ring.radius, y: ring.y - HUB_Y } : { radius: HUB_RADIUS, y: 0 }
}

function buildTicks(angles, keys = [], layout = null) {
  const values = []
  for (let i = 0; i < TICKS; i++) {
    const a = (i / TICKS) * Math.PI * 2
    const long = i % 10 === 0 ? 34 : 14
    values.push(Math.cos(a) * HUB_RADIUS, 0, Math.sin(a) * HUB_RADIUS, Math.cos(a) * (HUB_RADIUS + long), 0, Math.sin(a) * (HUB_RADIUS + long))
  }
  angles.forEach((a, index) => {
    const { radius, y } = placeOnRing(layout, keys[index])
    const inner = radius * (1 - 70 / HUB_RADIUS)
    values.push(Math.cos(a) * inner, y, Math.sin(a) * inner, Math.cos(a) * (radius * 1.14), y, Math.sin(a) * (radius * 1.14))
  })
  return new THREE.LineSegments(segments(values), lineMaterial(WHITE, 0.2))
}

function buildSlots(angles, keys = [], layout = null) {
  return angles.map((a, index) => {
    const { radius, y } = placeOnRing(layout, keys[index])
    const marker = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(SLOT_RADIUS, 40)), lineMaterial(WHITE, 0.3))
    marker.name = 'slot'
    marker.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius)
    return marker
  })
}

function ladderKeyOf(ladder, parkedKeys, max = RING_LEVEL_MAX) {
  return ringArcs(ladder, parkedKeys, max)
    .map((arc) => `${arc.id}|${arc.name}|${arc.level}|${arc.lanes.join(',')}|${arc.start}|${arc.end}`)
    .join(';')
}

function buildLevelRings(layout, group) {
  for (const ring of layout ? layout.rings : []) {
    if (ring.level === 0) continue
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(ring.radius, 128)), lineMaterial(WHITE, SUB_RING_OPACITY))
    line.name = 'sub-ring'
    line.position.y = ring.y - HUB_Y
    group.add(line)
  }
}

function buildSectors(layout, group) {
  const lines = []
  const labels = []
  const groups = []
  if (!layout) return { lines, labels, groups }
  const arcs = layout.arcs
  for (const arc of arcs) {
    const span = arc.end - arc.start
    if (!(span > SECTOR_EPSILON)) continue
    const ring = layout.ringOf(arc)
    const draw = arcDrawSpan(arc.start, arc.end)
    const main = arc.id === 'orchestrator'
    const tone = sectorArcTone(main)
    const sector = new THREE.Group()
    sector.name = `sector:${arc.id}`
    sector.userData.id = arc.id
    sector.position.y = ring.y - HUB_Y
    sectorArcRadii(ring.radius).forEach((radius, index) => {
      const points = []
      for (let i = 0; i <= ARC_STEPS; i++) {
        const angle = draw.start + ((draw.end - draw.start) * i) / ARC_STEPS
        points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius))
      }
      const opacity = index === 1 ? tone.center : tone.edge
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial(WHITE, opacity))
      line.userData.baseOpacity = opacity
      line.userData.sector = arc.id
      sector.add(line)
      lines.push(line)
    })
    const label = textSprite(String(arc.name).toUpperCase(), { scale: SECTOR_LABEL_BASE, color: SECTOR_LABEL_COLOR })
    label.position.copy(sectorLabelPoint(sectorLabelAngle(arc), ring.radius, arcs.length))
    label.userData.base = { x: label.scale.x, y: label.scale.y }
    label.userData.factor = 1
    sector.add(label)
    labels.push(label)
    groups.push(sector)
    group.add(sector)
  }
  return { lines, labels, groups }
}

export function createHub(scene, agentsOrCount, ladder = null) {
  const roster = Array.isArray(agentsOrCount) ? agentsOrCount : null
  let parkedKeys = roster ? parkedKeysFor(roster) : []
  let count = roster ? parkedKeys.length : Number(agentsOrCount) || 0
  const group = new THREE.Group()
  group.position.y = HUB_Y

  const main = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(HUB_RADIUS, 192)), lineMaterial(WHITE, RING_OPACITY))
  main.name = 'ring'
  main.userData.baseOpacity = RING_OPACITY
  const inner = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPoints(HUB_RADIUS * 0.86, 160)), lineMaterial(WHITE, 0.1))
  const levelRings = new THREE.Group()
  levelRings.name = 'level-rings'

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
  const beatRings = Array.from({ length: HUB_RING_POOL }, () => ({
    line: beatRing('beat-ring'),
    start: -Infinity,
    strength: 0,
    pulse: { radius: 1, opacity: 0 },
  }))
  let beatNext = 0

  let currentLadder = hasSubs(ladder) ? ladder : null
  let depth = RING_LEVEL_MAX
  let ladderKeyValue = ladderKeyOf(currentLadder, parkedKeys, depth)
  let buildCount = 0
  let slotAngles = []
  let slots = []
  let layout = hasSubs(ladder) ? ringLayout(ladder, parkedKeys, depth) : null
  let sectorLines = []
  let sectorLabels = []
  let sectorGroups = []
  let sectorLevels = new Map()
  let workingSet = new Set()
  const workingSectors = new Set()
  let ringLines = [main]
  let boost = 0
  let danceFrom = 0
  let danceTo = 0
  let danceAt = 0

  function anglesFor(ladderValue) {
    if (parkedKeys.length > 0) {
      const angles = sectorSlotAngles(ladderValue, parkedKeys, depth)
      return parkedKeys.map((key) => angles.get(key) ?? 0)
    }
    return Array.from({ length: count }, (_, index) => slotAngle(index, count))
  }

  const tickGroup = new THREE.Group()
  tickGroup.name = 'ticks'
  const sectorGroup = new THREE.Group()
  sectorGroup.name = 'sectors'
  const seatGroup = new THREE.Group()
  seatGroup.name = 'seat-labels'
  let seatRows = []
  const seatLabels = new Map()
  slotAngles = anglesFor(currentLadder)
  slots = buildSlots(slotAngles, parkedKeys, layout)
  for (const marker of slots) group.add(marker)
  tickGroup.add(buildTicks(slotAngles, parkedKeys, layout))
  group.add(main, inner, levelRings, dashes, tickGroup, centre, centreRing, sectorGroup, seatGroup, ...beatRings.map((slot) => slot.line))
  scene.add(group)

  function seatLimit(limit) {
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0) return null
    return limit
  }

  function seatTaken(value) {
    const raw = Number(value)
    if (!Number.isFinite(raw)) return 0
    return Math.max(0, Math.trunc(raw))
  }

  function syncSeatLabels() {
    const keep = new Set()
    for (const row of seatRows) {
      const ring = Number(row?.ring)
      const limit = seatLimit(row?.limit)
      if (!Number.isInteger(ring) || ring < 0 || limit === null) continue
      const point = seatRingPoint(ring, layout)
      if (!point) continue
      keep.add(ring)
      let sprite = seatLabels.get(ring)
      if (!sprite) {
        sprite = textSprite('', { scale: SEAT_LABEL_SCALE, color: SEAT_LABEL_COLOR })
        sprite.name = 'seat-label'
        sprite.userData.ring = ring
        seatLabels.set(ring, sprite)
        seatGroup.add(sprite)
      }
      const taken = seatTaken(row?.taken)
      sprite.userData.setText(`${taken} / ${limit}`)
      sprite.position.set(point.x, point.y, point.z)
      const full = taken >= limit
      writeColor(sprite.material, full ? YELLOW : WHITE)
      writeOpacity(sprite.material, full ? 1 : SEAT_LABEL_OPACITY)
    }
    for (const [ring, sprite] of [...seatLabels]) {
      if (keep.has(ring)) continue
      seatGroup.remove(sprite)
      disposeObject(sprite)
      seatLabels.delete(ring)
    }
  }

  function setSeatCounts(rows) {
    seatRows = Array.isArray(rows) ? rows : []
    syncSeatLabels()
  }

  function clearSlots() {
    for (const marker of slots) {
      group.remove(marker)
      disposeObject(marker)
    }
    slots = []
  }

  function rebuild() {
    buildCount += 1
    layout = currentLadder ? ringLayout(currentLadder, parkedKeys, depth) : null
    slotAngles = anglesFor(currentLadder)
    clearGroup(tickGroup)
    tickGroup.add(buildTicks(slotAngles, parkedKeys, layout))
    clearSlots()
    slots = buildSlots(slotAngles, parkedKeys, layout)
    for (const marker of slots) group.add(marker)
    clearGroup(sectorGroup)
    clearGroup(levelRings)
    buildLevelRings(layout, levelRings)
    const built = buildSectors(layout, sectorGroup)
    sectorLines = built.lines
    sectorLabels = built.labels
    sectorGroups = built.groups
    sectorLevels = new Map(sectorGroups.map((sector) => [sector.userData.id, 0]))
    main.visible = !currentLadder
    ringLines = currentLadder ? sectorLines : [main]
    for (const line of ringLines) {
      writeColor(line.material, WHITE)
      writeOpacity(line.material, line.userData.baseOpacity ?? RING_OPACITY)
    }
    boost = 0
    danceFrom = 0
    danceTo = 0
    danceAt = 0
    ladderKeyValue = ladderKeyOf(currentLadder, parkedKeys, depth)
    syncSeatLabels()
  }

  function setLadder(next) {
    const ladder = hasSubs(next) ? next : null
    if (ladderKeyOf(ladder, parkedKeys, depth) === ladderKeyValue) return false
    currentLadder = ladder
    rebuild()
    return true
  }

  function setDepth(value) {
    const next = ringDepth(value, RING_LEVEL_MAX)
    if (next === depth) return depth
    depth = next
    if (currentLadder) rebuild()
    return depth
  }

  function setRoster(next) {
    if (!Array.isArray(next)) return
    parkedKeys = parkedKeysFor(next)
    count = parkedKeys.length
    rebuild()
  }

  function setWorking(keys) {
    workingSet = new Set(
      (Array.isArray(keys) ? keys : []).filter((key) => typeof key === 'string' && key !== '')
    )
  }

  function beat(amount) {
    if (still()) return false
    const value = Math.min(1, Math.max(0, Number(amount) || 0))
    if (!(value > 0)) return false
    const at = performance.now()
    const next = startDanceEnvelope({ from: danceFrom, to: danceTo, at: danceAt }, value, at)
    danceFrom = next.from
    danceTo = next.to
    danceAt = next.at
    const slot = beatRings[beatNext]
    beatNext = (beatNext + 1) % beatRings.length
    slot.start = at
    slot.strength = value
    slot.line.visible = true
    return true
  }

  function pulse(color, amount) {
    for (const line of ringLines) writeColor(line.material, color)
    boost = Math.max(boost, amount)
  }

  function setSlot(index, color, opacity) {
    const marker = slots[index]
    if (!marker) return
    writeColor(marker.material, color)
    writeOpacity(marker.material, opacity)
  }

  function update(time, delta, camera = null, viewportHeight = 0) {
    const isStill = still()
    const at = performance.now()
    for (const slot of beatRings) {
      if (!slot.line.visible) continue
      if (isStill) {
        slot.line.visible = false
        continue
      }
      const age = at - slot.start
      ringPulse(HUB_RADIUS, HUB_RING_GROW, age, HUB_RING_MS, slot.strength, RING_MAX_OPACITY, slot.pulse)
      if (age >= HUB_RING_MS) {
        slot.line.visible = false
        continue
      }
      slot.line.scale.set(slot.pulse.radius, 1, slot.pulse.radius)
      writeOpacity(slot.line.material, slot.pulse.opacity)
    }
    boost = Math.max(0, boost - delta * 1.2)
    const danceBoost = isStill ? 0 : danceEnvelope(danceFrom, danceTo, performance.now() - danceAt)
    const extra = Math.max(boost, danceBoost)
    workingSectors.clear()
    for (const key of workingSet) workingSectors.add(sectorIdForKey(key, currentLadder))
    for (const id of sectorLevels.keys()) {
      sectorLevels.set(id, sectorGlow(sectorLevels.get(id), workingSectors.has(id), delta, isStill))
    }
    for (const line of ringLines) {
      const base = line.userData.baseOpacity ?? RING_OPACITY
      const level = line.userData.sector ? sectorLevels.get(line.userData.sector) ?? 0 : 0
      writeOpacity(line.material, Math.min(1, base + extra * 0.5 + (1 - base) * level))
      if (level > 0 || boost <= 0.01) writeColor(line.material, WHITE)
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
    for (let index = 0; index < slots.length; index += 1) {
      const marker = slots[index]
      marker.scale.setScalar(isStill ? 1 : 1 + 0.04 * Math.sin(time * 1.6 + index))
    }
  }

  function dispose() {
    scene.remove(group)
    disposeObject(group)
  }

  if (currentLadder) rebuild()

  return { group, pulse, beat, setSlot, setLadder, setDepth, setRoster, setWorking, setSeatCounts, parkedKeys: () => [...parkedKeys], update, builds: () => buildCount, depth: () => depth, dispose }
}
