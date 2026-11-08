import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { ownerOf, sectorArcs } from '../model/hierarchy.js'
import { dirname } from '../model/paths.js'
import { CHILD_LIFE_MS } from '../model/state.js'
import { AGENT_RING_BASE, AGENT_RING_GROW, AGENT_RING_MS, AGENT_RING_POOL, HUB_RADIUS, HUB_Y, ORCHESTRATOR_HOME, ORCHESTRATOR_LIFT, PARK_LIFT, RING_MAX_OPACITY, SWAY_LIFT, SWAY_RATE, SWAY_SCALE, danceEnvelope, hasSubs, isSessionReader, parkedKeysFor, readerPoint, ringPulse, sectorSlotAngles, slotAngle, startDanceEnvelope, subRingPlace, writeColor, writeOpacity } from './hub.js'
import { INTERNET_RADIUS } from './internet.js'
import { ORCHESTRATOR_PULSE_SCALE, ORCHESTRATOR_SHAPE, PREFERRED, PULSE_BANDS, PULSE_SCALE, SUB_PULSE_SCALE, bandForPoint, isOrchestrator, isSubOrchestrator, nextSpareShape, shapeGeometry, shapesFor, vertexOffset } from './shapes.js'
import { GREEN, RED, TUNNEL_GREY, WEB, WHITE, agentColor, agentColors, cssColor, easeRate, lineMaterial, paintAgentColor, still, textSprite } from './sprites.js'
import { linkOnPath } from './strings.js'

const STYLE = {
  idle: { color: WHITE, opacity: 0.35, spin: 0.15 },
  queued: { color: WHITE, opacity: 0.6, spin: 0.4 },
  working: { color: WHITE, opacity: 1, spin: 0.9 },
  error: { color: RED, opacity: 1, spin: 0.3 },
  done: { color: GREEN, opacity: 1, spin: 0.25 },
}
export const UNSEEN_OPACITY = 0.35
export const UNSEEN_SCALE = 0.7
export const PRESENCE_GROW_MS = 600
const AIM_HOLD = 4500
const DONE_GLOW_MS = 5000
const CHILD_FADE_MS = 1500
export const CHILD_HOLD_MS = CHILD_LIFE_MS - CHILD_FADE_MS
const STRIP_OPACITY = 0.45
export const TUNNEL_CORE_WIDTH = 2
export const TUNNEL_SHEATH_WIDTH = 9
export const TUNNEL_SHEATH_SHARE = 0.25
export const TUNNEL_IN_SECONDS = 0.3
export const TUNNEL_OUT_SECONDS = 0.6
export const BEAM_OPACITY = 1
export const BEAM_CORE_WIDTH = 1.5
export const BEAM_SHEATH_WIDTH = 7
const MAX_CHAIN = 32
export const CHILD_SCALE = 0.35
export const CHILD_RADIUS = 100
export const CHILD_ORBIT_SCALE = 1.6
export const CHILD_ORBIT_SECONDS = 40
export const CHILD_ORBIT_TILT = Math.PI / 18
export const SUB_ORCHESTRATOR_SCALE = 0.7
export const SUB_ORCHESTRATOR_LIFT = ORCHESTRATOR_LIFT * 0.5
export const SUB_ORCHESTRATOR_RADIUS = HUB_RADIUS * 2.4
export const ORCHESTRATOR_NAME_LIFT = (ORCHESTRATOR_LIFT * 2) / 3
export const ORCHESTRATOR_LINK_OPACITY = 0.1
export const SUB_ORCHESTRATOR_LINK_OPACITY = 0.3
export const DANCE_SCALE = 0.08
export const ORCHESTRATOR_DANCE_SCALE = 0.03
export const THINKING_DELAY_MS = 250
export const THINKING_IN_SECONDS = 0.3
export const THINKING_OUT_SECONDS = 0.6
export const THINKING_TURN_SECONDS = 4
export const THINKING_SPIN = (Math.PI * 2) / THINKING_TURN_SECONDS
export const SPINNER_RADIUS_SCALE = 1.35
export const SPINNER_ARC_SHARE = 0.25
export const SPINNER_PHASE = Math.PI
export const SPINNER_SWEEP_SECONDS = 1
export const SPINNER_RING_OPACITY = 0.22
export const SPINNER_ARC_OPACITY = 0.95

const RUNNING_STATUSES = new Set(['working', 'running'])

export function agentThinking(agent = {}) {
  const status = typeof agent?.status === 'string' ? agent.status.toLowerCase() : ''
  if (!RUNNING_STATUSES.has(status)) return false
  const calls = agent?.calls
  if (calls && typeof calls.size === 'number') return calls.size === 0
  const open = Number(agent?.openCalls ?? agent?.openToolCalls ?? 0)
  return !(Number.isFinite(open) && open > 0)
}

export function thinkingDue(since, now, delay = THINKING_DELAY_MS) {
  const start = Number(since)
  const at = Number(now)
  const wait = Number(delay)
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(at)) return false
  return at - start >= (Number.isFinite(wait) ? Math.max(0, wait) : THINKING_DELAY_MS)
}

export function thinkingLevel(level, on, delta, reduced = false) {
  const value = Number(level)
  const current = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  const target = on ? 1 : 0
  if (reduced) return target
  const seconds = Math.max(0, Number(delta) || 0)
  const step = seconds / (on ? THINKING_IN_SECONDS : THINKING_OUT_SECONDS)
  if (current < target) return Math.min(target, current + step)
  if (current > target) return Math.max(target, current - step)
  return current
}

export function thinkingArc(now, phase = 0, sweep = SPINNER_SWEEP_SECONDS, reduced = false) {
  if (reduced) return 0
  const time = Number(now)
  const rawSweep = Number(sweep)
  const seconds = Number.isFinite(rawSweep) && rawSweep > 0 ? rawSweep : SPINNER_SWEEP_SECONDS
  const offset = Number(phase)
  const full = Math.PI * 2
  const angle = ((Number.isFinite(time) ? time : 0) / 1000 / seconds) * full + (Number.isFinite(offset) ? offset : 0)
  return ((angle % full) + full) % full
}

export const CALLOUT_CROWD_LIMIT = 4
export const CALLOUT_RECENT_KEEP = 2

export function danceScale(pulse, orchestrator = false) {
  const value = Math.min(1, Math.max(0, Number(pulse) || 0))
  return 1 + (orchestrator ? ORCHESTRATOR_DANCE_SCALE : DANCE_SCALE) * value
}

function busyTime(item) {
  const value = Number(item?.since)
  return Number.isFinite(value) ? value : 0
}

function byKey(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

export function fullCalloutKeys(busy, focus = null, hover = null, scratch = null) {
  const list = scratch ? scratch.list : []
  const keys = scratch ? scratch.keys : new Set()
  const kept = scratch ? scratch.kept : new Set()
  const pool = scratch ? scratch.pool : []
  keys.clear()
  kept.clear()
  let count = 0
  for (const item of busy ?? []) {
    const key = item?.key
    if (typeof key !== 'string' || key === '' || keys.has(key)) continue
    keys.add(key)
    const slot = pool[count] ?? (pool[count] = { key: '', since: 0 })
    slot.key = key
    slot.since = busyTime(item)
    list[count] = slot
    count += 1
  }
  list.length = count
  if (count <= CALLOUT_CROWD_LIMIT) return keys
  const ranked = scratch ? scratch.ranked : list.slice()
  if (scratch) {
    ranked.length = count
    for (let index = 0; index < count; index += 1) ranked[index] = list[index]
  }
  ranked.sort((a, b) => busyTime(b) - busyTime(a) || byKey(a.key, b.key))
  for (let index = 0; index < ranked.length && index < CALLOUT_RECENT_KEEP; index += 1) kept.add(ranked[index].key)
  if (typeof focus === 'string' && keys.has(focus)) kept.add(focus)
  if (typeof hover === 'string' && keys.has(hover)) kept.add(hover)
  return kept
}

export function orchestratorNameLift(subCount) {
  const count = Number.isFinite(Number(subCount)) ? Math.max(0, Math.floor(Number(subCount))) : 0
  return count > 0 ? ORCHESTRATOR_NAME_LIFT : 0
}

export function subOrchestratorPlace(arc, out = null) {
  const start = Number(arc?.start)
  const end = Number(arc?.end)
  const mid = Number.isFinite(start) && Number.isFinite(end) ? (start + end) / 2 : 0
  const point = out ?? { x: 0, y: 0, z: 0 }
  point.x = Math.cos(mid) * SUB_ORCHESTRATOR_RADIUS
  point.y = HUB_Y + SUB_ORCHESTRATOR_LIFT
  point.z = Math.sin(mid) * SUB_ORCHESTRATOR_RADIUS
  return point
}

export function agentPresence(agent, everRan = false) {
  const active = agent?.status === 'working' || agent?.status === 'queued'
  const dim = !(active || everRan || isOrchestrator(agent) || isSubOrchestrator(agent))
  return {
    dim,
    opacity: dim ? UNSEEN_OPACITY : 1,
    scale: dim ? UNSEEN_SCALE : 1,
  }
}

export function childFade(sinceEnd, reduced = false) {
  const elapsed = Number.isFinite(sinceEnd) ? Math.max(0, sinceEnd) : 0
  if (elapsed <= CHILD_HOLD_MS) return 1
  if (reduced || elapsed >= CHILD_LIFE_MS) return 0
  return 1 - (elapsed - CHILD_HOLD_MS) / CHILD_FADE_MS
}

export function childEndIsFresh(entry, state) {
  const endedAt = entry?.endedAt ?? 0
  return endedAt > 0 && (state?.latest ?? 0) - endedAt <= CHILD_LIFE_MS
}

export function nameLabel(name) {
  if (typeof name !== 'string') return ''
  const label = name.toUpperCase()
  return label.length > 32 ? `${label.slice(0, 31)}~` : label
}

function labelFor(key, labels) {
  if (!labels) return null
  let value
  if (labels instanceof Map) value = labels.get(key)
  else if (typeof labels === 'object' && Object.hasOwn(labels, key)) value = labels[key]
  return typeof value === 'string' && value ? value : null
}

export function showsNameLabel(agent, sector) {
  if (!isSubOrchestrator(agent)) return true
  const name = typeof agent?.name === 'string' ? agent.name.trim() : ''
  const sectorName = typeof sector?.name === 'string' ? sector.name.trim() : ''
  if (!name || !sectorName) return true
  return name.toLowerCase() !== sectorName.toLowerCase()
}

export function shapeForNewAgent(agent, used = []) {
  const taken = new Set(Array.isArray(used) ? used : [])
  if (isOrchestrator(agent) || isSubOrchestrator(agent)) return ORCHESTRATOR_SHAPE
  const kind = agent?.shape ?? agent?.parser ?? agent?.key
  const wanted = Object.hasOwn(PREFERRED, kind) ? PREFERRED[kind] : null
  if (wanted && !taken.has(wanted)) return wanted
  return nextSpareShape([...taken])
}

export function childOrbit(parentPlace, index = 0, count = 1, time = 0, out = null) {
  const x = Number(parentPlace?.x) || 0
  const y = Number(parentPlace?.y) || 0
  const z = Number(parentPlace?.z) || 0
  const parentRadius = Number(parentPlace?.radius) > 0 ? Number(parentPlace.radius) : CHILD_RADIUS
  const radius = parentRadius * CHILD_ORBIT_SCALE
  const total = Math.max(1, Math.floor(Number(count) || 1))
  const slot = Math.max(0, Math.floor(Number(index) || 0)) % total
  const phase = (slot / total) * Math.PI * 2
  const turn = phase + (Number(time) || 0) * (Math.PI * 2 / CHILD_ORBIT_SECONDS)
  const flatX = Math.cos(turn) * radius
  const flatZ = Math.sin(turn) * radius
  const place = out ?? {}
  place.x = x + flatX
  place.y = y + flatZ * Math.sin(CHILD_ORBIT_TILT)
  place.z = z + flatZ * Math.cos(CHILD_ORBIT_TILT)
  return place
}

export function stripPoints(from, to, out = []) {
  const points = out ?? []
  points.length = 2
  points[0] = points[0] ?? {}
  points[1] = points[1] ?? {}
  points[0].x = from.x
  points[0].y = from.y
  points[0].z = from.z
  points[1].x = to.x
  points[1].y = to.y
  points[1].z = to.z
  return points
}

export function litChain(dir, links, mask, out = [], cache = null) {
  const chain = out ?? []
  chain.length = 0
  const target = typeof dir === 'string' ? dir : ''
  if (!mask?.dimmed || !mask.lit || !mask.lit.has(target)) return chain
  if (!links || links.length === 0) {
    if (target === '') chain.push('')
    return chain
  }
  let parents
  if (cache && cache.links === links && cache.mask === mask && cache.parents) {
    parents = cache.parents
  } else {
    parents = new Map()
    for (const link of links) {
      if (!link || !linkOnPath(link, mask)) continue
      if (!parents.has(link.to)) parents.set(link.to, link.from)
    }
    if (cache) {
      cache.links = links
      cache.mask = mask
      cache.parents = parents
    }
  }
  const back = cache ? (cache.back ??= []) : []
  back.length = 0
  let at = target
  let steps = 0
  while (at !== '') {
    const up = parents.get(at)
    if (up === undefined || steps >= MAX_CHAIN) {
      chain.length = 0
      return chain
    }
    back.push(at)
    at = up
    steps += 1
  }
  chain.push('')
  for (let index = back.length - 1; index >= 0; index -= 1) chain.push(back[index])
  return chain
}

export function speckPolyline(start, chain, anchorOf, end, out = []) {
  const points = out ?? []
  let count = 0
  let routed = Array.isArray(chain) && chain.length > 0
  if (routed) {
    for (let index = 0; index < chain.length; index += 1) {
      const spot = typeof anchorOf === 'function' ? anchorOf(chain[index]) : null
      if (!spot || !Number.isFinite(Number(spot.x)) || !Number.isFinite(Number(spot.y)) || !Number.isFinite(Number(spot.z))) {
        routed = false
        break
      }
    }
  }
  const write = (source) => {
    const point = points[count] ?? { x: 0, y: 0, z: 0 }
    point.x = source.x
    point.y = source.y
    point.z = source.z
    points[count] = point
    count += 1
  }
  write(start)
  if (routed) {
    for (let index = 0; index < chain.length; index += 1) write(anchorOf(chain[index]))
  }
  const last = points[count - 1]
  if (!(routed && last.x === end.x && last.y === end.y && last.z === end.z)) write(end)
  points.length = count
  return points
}

function spanLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
}

export function polylineLengths(points, out = []) {
  const lengths = out ?? []
  const list = Array.isArray(points) ? points : []
  const count = list.length
  lengths.length = count
  if (count === 0) return lengths
  lengths[0] = 0
  let total = 0
  for (let index = 1; index < count; index += 1) {
    total += spanLength(list[index - 1], list[index])
    lengths[index] = total
  }
  return lengths
}

export function samplePolyline(points, t, out = {}, lengths = null) {
  const point = out ?? {}
  const list = Array.isArray(points) ? points : []
  const count = list.length
  const walk = Math.min(1, Math.max(0, Number.isFinite(Number(t)) ? Number(t) : 0))
  if (count === 0) {
    point.x = 0
    point.y = 0
    point.z = 0
    return point
  }
  const first = list[0]
  if (count === 1) {
    point.x = first.x
    point.y = first.y
    point.z = first.z
    return point
  }
  const spans = Array.isArray(lengths) && lengths.length === count ? lengths : null
  let total = 0
  if (spans) {
    const last = Number(spans[count - 1])
    total = Number.isFinite(last) ? last : 0
  } else {
    for (let index = 1; index < count; index += 1) total += spanLength(list[index - 1], list[index])
  }
  if (!(total > 0)) {
    point.x = first.x
    point.y = first.y
    point.z = first.z
    return point
  }
  const left = walk * total
  if (spans) {
    if (left >= total) {
      const last = list[count - 1]
      point.x = last.x
      point.y = last.y
      point.z = last.z
      return point
    }
    let low = 1
    let high = count - 1
    while (low < high) {
      const mid = (low + high) >> 1
      if (spans[mid] > left) high = mid
      else low = mid + 1
    }
    const a = list[low - 1]
    const b = list[low]
    const length = spans[low] - spans[low - 1]
    const fraction = length > 0 ? (left - spans[low - 1]) / length : 0
    point.x = a.x + (b.x - a.x) * fraction
    point.y = a.y + (b.y - a.y) * fraction
    point.z = a.z + (b.z - a.z) * fraction
    return point
  }
  let rest = left
  for (let index = 1; index < count; index += 1) {
    const a = list[index - 1]
    const b = list[index]
    const length = spanLength(a, b)
    if (length > 0 && rest <= length) {
      const fraction = rest / length
      point.x = a.x + (b.x - a.x) * fraction
      point.y = a.y + (b.y - a.y) * fraction
      point.z = a.z + (b.z - a.z) * fraction
      return point
    }
    rest -= length
  }
  const last = list[count - 1]
  point.x = last.x
  point.y = last.y
  point.z = last.z
  return point
}

export function orchestratorLineEnds(from, to, out = []) {
  const points = out ?? []
  points.length = 2
  points[0] = points[0] ?? {}
  points[1] = points[1] ?? {}
  points[0].x = from.x
  points[0].y = from.y
  points[0].z = from.z
  points[1].x = to.x
  points[1].y = to.y
  points[1].z = to.z
  return points
}

export function lineParentKey(key, ladder) {
  if (typeof key !== 'string' || key === '' || key === 'orchestrator' || key.startsWith('sub-')) return 'orchestrator'
  const owner = ownerOf(ladder, key)
  return owner === 'orchestrator' ? 'orchestrator' : `sub-${owner}`
}

export function webTunnelEnd(agentPlace, internetPlace, radius = INTERNET_RADIUS, out = {}) {
  const point = out ?? {}
  const ax = Number.isFinite(Number(agentPlace?.x)) ? Number(agentPlace.x) : 0
  const ay = Number.isFinite(Number(agentPlace?.y)) ? Number(agentPlace.y) : 0
  const az = Number.isFinite(Number(agentPlace?.z)) ? Number(agentPlace.z) : 0
  const ix = Number.isFinite(Number(internetPlace?.x)) ? Number(internetPlace.x) : 0
  const iy = Number.isFinite(Number(internetPlace?.y)) ? Number(internetPlace.y) : 0
  const iz = Number.isFinite(Number(internetPlace?.z)) ? Number(internetPlace.z) : 0
  const dx = ax - ix
  const dy = ay - iy
  const dz = az - iz
  const length = Math.hypot(dx, dy, dz)
  const reach = Math.max(0, Number.isFinite(Number(radius)) ? Number(radius) : 0)
  if (!(length > 0) || reach === 0) {
    point.x = ix
    point.y = iy
    point.z = iz
    return point
  }
  const scale = Math.min(1, reach / length)
  point.x = ix + dx * scale
  point.y = iy + dy * scale
  point.z = iz + dz * scale
  return point
}

function litRootLink(to, links, mask) {
  if (!Array.isArray(links)) return false
  for (const link of links) {
    if (!link) continue
    if ((link.from ?? '') === '' && link.to === to) return linkOnPath(link, mask)
  }
  return false
}

export function tunnelRoute(chain, links, mask, out = []) {
  const route = out ?? []
  route.length = 0
  if (!Array.isArray(chain) || chain.length === 0) return route
  for (let index = 0; index < chain.length; index += 1) {
    const path = chain[index]
    if (path === '' && index + 1 < chain.length && !litRootLink(chain[index + 1], links, mask)) continue
    route.push(path)
  }
  return route
}

export function tunnelLevel(level, on, delta, reduced = false) {
  const value = Number(level)
  const current = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  const target = on ? 1 : 0
  if (reduced) return target
  const seconds = Math.max(0, Number(delta) || 0)
  const step = seconds / (on ? TUNNEL_IN_SECONDS : TUNNEL_OUT_SECONDS)
  if (current < target) return Math.min(target, current + step)
  if (current > target) return Math.max(target, current - step)
  return current
}

function trailMaterial(color, width) {
  return new LineMaterial({
    color,
    linewidth: width,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: true,
    blending: THREE.AdditiveBlending,
  })
}

function createTrail(color, coreWidth, sheathWidth) {
  const geometry = new LineGeometry()
  const core = new Line2(geometry, trailMaterial(color, coreWidth))
  const sheath = new Line2(geometry, trailMaterial(color, sheathWidth))
  core.frustumCulled = false
  sheath.frustumCulled = false
  core.visible = false
  sheath.visible = false
  return { geometry, core, sheath, flat: [] }
}

function setTrailPath(trail, points) {
  const count = points.length
  const size = count * 3
  let flat = trail.flat
  let same = flat.length === size
  for (let index = 0; index < count && same; index += 1) {
    const point = points[index]
    const base = index * 3
    if (flat[base] !== point.x || flat[base + 1] !== point.y || flat[base + 2] !== point.z) same = false
  }
  if (same) return false
  if (flat.length !== size) flat = new Array(size)
  for (let index = 0; index < count; index += 1) {
    const point = points[index]
    const base = index * 3
    flat[base] = point.x
    flat[base + 1] = point.y
    flat[base + 2] = point.z
  }
  trail.flat = flat
  const segments = count - 1
  if (segments <= 0) return true
  const attr = trail.geometry.getAttribute('instanceStart')
  if (attr?.data && attr.data.count === segments) {
    const buffer = attr.data.array
    for (let index = 0; index < segments; index += 1) {
      const from = index * 3
      const to = from + 3
      const base = index * 6
      buffer[base] = flat[from]
      buffer[base + 1] = flat[from + 1]
      buffer[base + 2] = flat[from + 2]
      buffer[base + 3] = flat[to]
      buffer[base + 4] = flat[to + 1]
      buffer[base + 5] = flat[to + 2]
    }
    attr.data.needsUpdate = true
    return true
  }
  trail.geometry.setPositions(flat)
  return true
}

function trailOpacity(trail, opacity) {
  writeOpacity(trail.core.material, opacity)
  writeOpacity(trail.sheath.material, opacity * TUNNEL_SHEATH_SHARE)
}

function trailColor(trail, color) {
  writeColor(trail.core.material, color)
  writeColor(trail.sheath.material, color)
}

function setTrailVisible(trail, visible) {
  trail.core.visible = visible
  trail.sheath.visible = visible
}

const chipNear = new THREE.Vector3()
const traceEnd = new THREE.Vector3()
const webEdgePoint = new THREE.Vector3()
const calloutPos = new THREE.Vector3()
const camUp = new THREE.Vector3()
const rotMatrix = new THREE.Matrix4()

function makeCallout(agentName) {
  const element = document.createElement('div')
  element.className = 'mr-callout'

  const title = document.createElement('div')
  title.className = 'mr-callout-title'
  title.textContent = agentName.toUpperCase()

  const task = document.createElement('div')
  task.className = 'mr-callout-task'

  const cmd = document.createElement('div')
  cmd.className = 'mr-callout-cmd'

  element.append(title, task, cmd)

  const object = new CSS3DObject(element)
  object.visible = false
  return { element, title, task, cmd, object }
}

function lineBetween(material) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), material)
  line.frustumCulled = false
  return line
}

function setEnds(line, a, b) {
  const last = line.userData.ends ?? (line.userData.ends = [0, 0, 0, 0, 0, 0])
  if (
    last[0] === a.x &&
    last[1] === a.y &&
    last[2] === a.z &&
    last[3] === b.x &&
    last[4] === b.y &&
    last[5] === b.z
  ) {
    return false
  }
  const array = line.geometry.attributes.position.array
  array[0] = last[0] = a.x
  array[1] = last[1] = a.y
  array[2] = last[2] = a.z
  array[3] = last[3] = b.x
  array[4] = last[4] = b.y
  array[5] = last[5] = b.z
  line.geometry.attributes.position.needsUpdate = true
  return true
}

function flatRing(radius, opacity, y) {
  const ring = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(new THREE.EllipseCurve(0, 0, radius, radius).getPoints(64)),
    lineMaterial(WHITE, opacity)
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = y
  return ring
}

const SPINNER_SEGMENTS = 64
const SPINNER_ARC_SEGMENTS = 16

function spinnerRing(radius, material) {
  const points = []
  for (let index = 0; index < SPINNER_SEGMENTS; index += 1) {
    const angle = (index / SPINNER_SEGMENTS) * Math.PI * 2
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0))
  }
  const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material)
  ring.frustumCulled = false
  return ring
}

function spinnerArc(radius, material) {
  const points = []
  for (let index = 0; index <= SPINNER_ARC_SEGMENTS; index += 1) {
    const angle = (index / SPINNER_ARC_SEGMENTS) * SPINNER_ARC_SHARE * Math.PI * 2
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0))
  }
  const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material)
  arc.frustumCulled = false
  return arc
}

function createSpinner(radius) {
  const group = new THREE.Group()
  const ringMaterial = lineMaterial(WHITE, SPINNER_RING_OPACITY)
  const arcMaterial = lineMaterial(WHITE, SPINNER_ARC_OPACITY)
  const rings = []
  const arcs = []
  for (let index = 0; index < 2; index += 1) {
    const plane = new THREE.Group()
    if (index === 1) plane.rotation.x = Math.PI / 2
    const ring = spinnerRing(radius, ringMaterial)
    const arc = spinnerArc(radius, arcMaterial)
    plane.add(ring, arc)
    group.add(plane)
    rings.push(ring)
    arcs.push(arc)
  }
  group.visible = false
  return { group, rings, arcs, ringMaterial, arcMaterial }
}

export function createAgents(scene, roster, cssScene = null, options = {}) {
  const onRemove = typeof options.onRemove === 'function' ? options.onRemove : null
  const views = new Map()
  const pickables = []
  const shapes = shapesFor(roster)
  let currentRoster = [...roster]
  let parkedKeys = parkedKeysFor(currentRoster)
  let agentByKey = new Map(currentRoster.map((agent) => [agent.key, agent]))
  let rosterKeys = new Set(currentRoster.map((agent) => agent.key))
  const usedShapes = new Set(shapes)
  let retired = new WeakSet()
  const pendingChipRemovals = new Set()
  let currentLadder = null
  let currentLabels = null
  let swayTarget = 0
  let swayLevel = 0
  let sectorList = []
  let slotAngles = sectorSlotAngles(null, parkedKeys)
  const chainCache = { links: null, mask: null, parents: null, back: [] }
  let pulseSource = null
  const busyList = []
  const busyPool = []
  const endedList = []
  const endedPool = []
  const viewScratch = []
  const focusScratch = { dir: '', file: null }
  const orbitSlotScratch = { index: 0, count: 0 }
  const parentPlaceScratch = { x: 0, y: 0, z: 0, radius: 0 }
  const orbitPlaceScratch = { x: 0, y: 0, z: 0 }
  const calloutScratch = { list: [], keys: new Set(), kept: new Set(), ranked: [], pool: [] }

  function setBands(levels) {
    pulseSource = levels && typeof levels.length === 'number' && levels.length > 0 ? levels : null
  }

  function restorePulse(view) {
    if (!view.pulseApplied) return
    const attribute = view.shape.geometry.getAttribute('position')
    attribute.array.set(view.pulseBase)
    attribute.needsUpdate = true
    view.pulseApplied = false
  }

  function pulseUnchanged(view) {
    if (!view.pulseApplied || view.pulseWrittenScale !== view.pulseScale) return false
    const levels = view.pulseLevels
    const written = view.pulseWrittenLevels
    for (let band = 0; band < levels.length; band += 1) {
      if (levels[band] !== written[band]) return false
    }
    return true
  }

  function applyPulse(view, delta, isStill) {
    const levels = view.pulseLevels
    const source = isStill ? null : pulseSource
    if (!source) {
      levels.fill(0)
      restorePulse(view)
      return
    }
    const ease = easeRate(delta, 14, false)
    let max = 0
    for (let band = 0; band < levels.length; band += 1) {
      const raw = Number(source[band])
      const target = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0
      const next = levels[band] + (target - levels[band]) * ease
      levels[band] = next < 0.0005 ? 0 : next
      if (levels[band] > max) max = levels[band]
    }
    if (max <= 0.0005) {
      restorePulse(view)
      return
    }
    if (pulseUnchanged(view)) return
    const attribute = view.shape.geometry.getAttribute('position')
    const array = attribute.array
    const base = view.pulseBase
    const lengths = view.pulseLengths
    const bands = view.pulseBands
    for (let vertex = 0; vertex < bands.length; vertex += 1) {
      const at = vertex * 3
      const length = lengths[vertex]
      if (!(length > 0)) {
        array[at] = base[at]
        array[at + 1] = base[at + 1]
        array[at + 2] = base[at + 2]
        continue
      }
      const factor = 1 + vertexOffset(length, levels[bands[vertex]], view.pulseScale) / length
      array[at] = base[at] * factor
      array[at + 1] = base[at + 1] * factor
      array[at + 2] = base[at + 2] * factor
    }
    attribute.needsUpdate = true
    view.pulseWrittenLevels.set(levels)
    view.pulseWrittenScale = view.pulseScale
    view.pulseApplied = true
  }

  function subIdOf(agent) {
    const key = String(agent?.key ?? '')
    return key.startsWith('sub-') ? key.slice(4) : key
  }

  function subHome(agent) {
    const id = subIdOf(agent)
    const arc = sectorList.find((entry) => entry.id === id) ?? { start: 0, end: 0 }
    const place = subOrchestratorPlace(arc)
    return new THREE.Vector3(place.x, place.y, place.z)
  }

  function laneHome(key, index) {
    const angle = slotAngles.get(key) ?? slotAngle(index, Math.max(1, parkedKeys.length))
    if (currentLadder && ownerOf(currentLadder, key) !== 'orchestrator') {
      const place = subRingPlace(angle)
      return new THREE.Vector3(place.x, place.y, place.z)
    }
    return new THREE.Vector3(Math.cos(angle) * HUB_RADIUS, HUB_Y + PARK_LIFT, Math.sin(angle) * HUB_RADIUS)
  }

  function orbitSlot(view, out = null) {
    const slot = out ?? { index: 0, count: 0 }
    let index = 0
    let count = 0
    for (const other of views.values()) {
      if (other.parentKey !== view.parentKey) continue
      if (other === view) index = count
      count += 1
    }
    slot.index = index
    slot.count = count
    return slot
  }

  function orbitHome(view, parent, time) {
    const slot = orbitSlot(view, orbitSlotScratch)
    parentPlaceScratch.x = parent.group.position.x
    parentPlaceScratch.y = parent.group.position.y
    parentPlaceScratch.z = parent.group.position.z
    parentPlaceScratch.radius = parent.shellRadius * parent.scale
    const place = childOrbit(parentPlaceScratch, slot.index, slot.count, time, orbitPlaceScratch)
    view.home.set(place.x, place.y, place.z)
  }

  function layoutHomes(ladder) {
    sectorList = hasSubs(ladder) ? sectorArcs(ladder, parkedKeys) : []
    slotAngles = sectorSlotAngles(ladder, parkedKeys)
  }

  let online = true
  let viewportX = 1
  let viewportY = 1

  function applyResolution(trail) {
    trail.core.material.resolution.set(viewportX, viewportY)
    trail.sheath.material.resolution.set(viewportX, viewportY)
  }

  function setViewport(widthValue, heightValue) {
    const nextX = Number(widthValue) > 0 ? Number(widthValue) : 1
    const nextY = Number(heightValue) > 0 ? Number(heightValue) : 1
    viewportX = nextX
    viewportY = nextY
    for (const view of views.values()) {
      applyResolution(view.trail)
      applyResolution(view.beamTrail)
    }
  }

  function hideBeam(view) {
    view.beam.visible = false
    view.beamSheath.visible = false
  }

  function setOnline(next) {
    online = next !== false
    if (!online) {
      for (const view of views.values()) {
        view.web = false
        hideBeam(view)
      }
    }
    return online
  }

  function webStart(key, place) {
    const view = views.get(key)
    if (!view || !online) return false
    view.web = true
    if (place) view.webPlace.set(place.x, place.y, place.z)
    return true
  }

  function webEnd(key) {
    const view = views.get(key)
    if (!view || !view.web) return false
    view.web = false
    view.beam.visible = false
    view.beamSheath.visible = false
    return true
  }

  function webActive() {
    let count = 0
    for (const view of views.values()) {
      if (view.web) count += 1
    }
    return count
  }

  function addView(agent, { index, shapeName, home, scale = 1, parentKey = null, subOrchestrator = false, childIndex = 0, color = agentColor(0) }) {
    const group = new THREE.Group()
    const shape = new THREE.LineSegments(shapeGeometry(shapeName), lineMaterial(WHITE, 0.35))
    shape.geometry.computeBoundingSphere()
    const shellRadius = shape.geometry.boundingSphere?.radius ?? 120
    const orchestrator = parentKey === null && isOrchestrator(agent)
    const sub = parentKey === null && subOrchestrator
    const pulseBase = Float32Array.from(shape.geometry.getAttribute('position').array)
    const pulseVertices = pulseBase.length / 3
    const pulseLengths = new Float32Array(pulseVertices)
    const pulseBands = new Uint8Array(pulseVertices)
    for (let vertex = 0; vertex < pulseVertices; vertex += 1) {
      const at = vertex * 3
      pulseLengths[vertex] = Math.hypot(pulseBase[at], pulseBase[at + 1], pulseBase[at + 2])
      pulseBands[vertex] = bandForPoint(pulseBase[at], pulseBase[at + 2], PULSE_BANDS)
    }
    const pulseScale = orchestrator ? ORCHESTRATOR_PULSE_SCALE : sub ? SUB_PULSE_SCALE : PULSE_SCALE
    const rings = [flatRing(130, 0.2, -110)]
    if (orchestrator) rings.push(flatRing(158, 0.14, -110))
    const beatRings = Array.from({ length: AGENT_RING_POOL }, () => {
      const line = flatRing(1, 0, -110)
      line.name = 'beat-ring'
      line.visible = false
      return { line, start: -Infinity, strength: 0, pulse: { radius: 1, opacity: 0 } }
    })
    const label = textSprite(nameLabel(agent.name), { scale: 1.5, color: 'rgba(255,255,255,.7)' })
    label.position.set(0, -150, 0)
    const picker = new THREE.Mesh(new THREE.SphereGeometry(170, 8, 8), new THREE.MeshBasicMaterial({ visible: false }))
    picker.userData.key = agent.key
    const spinner = createSpinner(shellRadius * SPINNER_RADIUS_SCALE)
    group.add(shape, ...rings, ...beatRings.map((slot) => slot.line), label, picker, spinner.group)
    group.position.copy(home)
    group.scale.setScalar(scale)

    const link = lineBetween(lineMaterial(WHITE, 0.4))
    const trail = createTrail(TUNNEL_GREY, TUNNEL_CORE_WIDTH, TUNNEL_SHEATH_WIDTH)
    const strip = trail.core
    const stripSheath = trail.sheath
    const beamTrail = createTrail(WEB, BEAM_CORE_WIDTH, BEAM_SHEATH_WIDTH)
    applyResolution(trail)
    applyResolution(beamTrail)
    const beam = beamTrail.core
    const beamSheath = beamTrail.sheath
    const beamPath = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]
    const parentLink = parentKey ? lineBetween(lineMaterial(WHITE, 0.3)) : null
    const orchestratorLink = parentKey === null && !orchestrator
      ? lineBetween(lineMaterial(WHITE, sub ? SUB_ORCHESTRATOR_LINK_OPACITY : ORCHESTRATOR_LINK_OPACITY))
      : null
    if (orchestratorLink) orchestratorLink.renderOrder = -1

    const callout = makeCallout(currentLabels && parentKey === null ? labelFor(agent.key, currentLabels) ?? agent.key : agent.name)
    const calloutColor = cssColor(color)
    if (calloutColor) paintAgentColor(callout.element, calloutColor)
    const calloutLine = lineBetween(lineMaterial(WHITE, 0.3))
    calloutLine.visible = false

    scene.add(group, link, strip, stripSheath, beam, beamSheath, calloutLine)
    if (parentLink) scene.add(parentLink)
    if (orchestratorLink) scene.add(orchestratorLink)
    cssScene?.add(callout.object)
    pickables.push(picker)
    const view = {
      key: agent.key,
      name: agent.name,
      index: orchestrator ? -1 : index,
      orchestrator,
      subOrchestrator: sub,
      sessionReader: parentKey === null && isSessionReader(agent),
      readerIndex: 0,
      parentKey,
      childIndex,
      shapeName,
      group,
      shape,
      shellRadius,
      rings,
      spinner,
      thinking: 0,
      thinkingSince: 0,
      beatRings,
      beatNext: 0,
      label,
      picker,
      callout,
      calloutLine,
      link,
      parentLink,
      orchestratorLink,
      orchestratorEnds: [{}, {}],
      scale,
      fadeStart: 0,
      strip,
      stripSheath,
      trail,
      path: [],
      route: [],
      chain: [],
      pathLengths: [],
      stripOpacity: 0,
      stripColor: TUNNEL_GREY,
      color,
      tunnel: 0,
      web: false,
      webPlace: new THREE.Vector3(),
      beam,
      beamSheath,
      beamTrail,
      beamPath,
      home,
      touch: home.clone(),
      aim: null,
      pointer: null,
      side: -1,
      chipSide: 1,
      doneAt: 0,
      busySince: 0,
      calloutCompact: false,
      calloutColor: calloutColor ?? null,
      style: 'idle',
      presence: orchestrator ? 1 : 0,
      presenceReady: false,
      presenceOpacity: 1,
      danceFrom: 0,
      danceTo: 0,
      danceAt: 0,
      danceTurn: 0,
      pulseBase,
      pulseLengths,
      pulseBands,
      pulseLevels: new Float32Array(PULSE_BANDS),
      pulseWrittenLevels: new Float32Array(PULSE_BANDS),
      pulseWrittenScale: 0,
      pulseScale,
      pulseApplied: false,
    }
    views.set(agent.key, view)
    if (view.sessionReader) group.visible = false
    return view
  }

  function removeView(view, chips = null) {
    if (chips) chips.remove?.(view.key)
    else pendingChipRemovals.add(view.key)
    view.callout.object.removeFromParent()
    view.callout.element.remove()
    scene.remove(view.group, view.link, view.strip, view.stripSheath, view.beam, view.beamSheath, view.calloutLine)
    if (view.parentLink) scene.remove(view.parentLink)
    if (view.orchestratorLink) scene.remove(view.orchestratorLink)
    for (const root of [view.group, view.link, view.strip, view.stripSheath, view.beam, view.beamSheath, view.calloutLine, view.parentLink, view.orchestratorLink]) {
      if (!root) continue
      root.traverse((object) => {
        object.geometry?.dispose()
        object.material?.map?.dispose()
        object.material?.dispose()
      })
    }
    const at = pickables.indexOf(view.picker)
    if (at !== -1) pickables.splice(at, 1)
    views.delete(view.key)
    onRemove?.(view.key)
    if (!view.parentKey) return
    for (const other of views.values()) {
      if (other.shapeName === view.shapeName) return
    }
    usedShapes.delete(view.shapeName)
  }

  function childIndex(state, entry) {
    let index = 0
    for (const other of state.agents.values()) {
      if (other === entry) return index
      if (other.parent === entry.parent) index += 1
    }
    return index
  }

  function syncViews(state, chips = null) {
    viewScratch.length = 0
    for (const view of views.values()) viewScratch.push(view)
    for (const view of viewScratch) {
      if (rosterKeys.has(view.key)) continue
      if (!state.agents.has(view.key)) removeView(view, chips)
    }
    for (const entry of state.agents.values()) {
      if (!entry.parent || rosterKeys.has(entry.key) || views.has(entry.key)) continue
      const parentView = views.get(entry.parent)
      if (!parentView) continue
      if (retired.has(entry)) continue
      if (entry.status !== 'working' && entry.status !== 'queued' && !childEndIsFresh(entry, state)) continue
      const shapeName = nextSpareShape([...usedShapes])
      usedShapes.add(shapeName)
      const index = childIndex(state, entry)
      let count = 1
      for (const other of views.values()) {
        if (other.parentKey === entry.parent) count += 1
      }
      const place = childOrbit({ x: parentView.home.x, y: parentView.home.y, z: parentView.home.z, radius: parentView.shellRadius * parentView.scale }, index, count, 0)
      addView(entry, {
        index: -1,
        shapeName,
        home: new THREE.Vector3(place.x, place.y, place.z),
        scale: parentView.scale * CHILD_SCALE,
        parentKey: entry.parent,
        childIndex: index,
        color: parentView.color,
      })
    }
  }

  function placeViews() {
    const readers = [...views.values()].filter((view) => view.sessionReader && !view.parentKey)
    let readerIndex = 0
    for (const view of views.values()) {
      if (view.parentKey) continue
      const agent = agentByKey.get(view.key) ?? { key: view.key, name: view.name }
      if (view.subOrchestrator) {
        const sector = sectorList.find((entry) => entry.id === subIdOf(agent))
        view.label.visible = showsNameLabel(agent, sector)
      } else {
        view.label.visible = true
      }
      if (view.orchestrator) {
        view.index = -1
        view.home.copy(ORCHESTRATOR_HOME)
      } else if (view.subOrchestrator) {
        view.index = -1
        view.home.copy(subHome(agent))
      } else if (view.sessionReader) {
        view.index = -1
        view.readerIndex = readerIndex
        readerPoint(readerIndex, readers.length, view.home)
        readerIndex += 1
      } else {
        view.index = parkedKeys.indexOf(view.key)
        view.home.copy(laneHome(view.key, view.index))
      }
    }
    for (const view of views.values()) {
      if (!view.parentKey) continue
      const parent = views.get(view.parentKey)
      if (!parent) continue
      const slot = orbitSlot(view)
      const place = childOrbit({ x: parent.home.x, y: parent.home.y, z: parent.home.z, radius: parent.shellRadius * parent.scale }, slot.index, slot.count, 0)
      view.home.set(place.x, place.y, place.z)
    }
  }

  function setRoster(next, chips = null) {
    const list = Array.isArray(next) ? next : []
    const nextKeys = new Set(list.map((agent) => agent.key))
    for (const view of [...views.values()]) {
      if (view.parentKey || nextKeys.has(view.key)) continue
      removeView(view, chips)
    }
    let dropped = true
    while (dropped) {
      dropped = false
      for (const view of [...views.values()]) {
        if (!view.parentKey || views.has(view.parentKey)) continue
        removeView(view, chips)
        dropped = true
      }
    }
    currentRoster = [...list]
    agentByKey = new Map(currentRoster.map((agent) => [agent.key, agent]))
    rosterKeys = new Set(currentRoster.map((agent) => agent.key))
    parkedKeys = parkedKeysFor(currentRoster)
    const colors = agentColors(currentRoster)
    const added = []
    currentRoster.forEach((agent, rosterIndex) => {
      const color = colors[rosterIndex] ?? agentColor(0)
      const existing = views.get(agent.key)
      if (existing) {
        existing.color = color
        return
      }
      const sub = isSubOrchestrator(agent)
      const shapeName = shapeForNewAgent(agent, [...usedShapes])
      usedShapes.add(shapeName)
      const view = addView(agent, {
        index: -1,
        shapeName,
        home: new THREE.Vector3(),
        scale: sub ? SUB_ORCHESTRATOR_SCALE : 1,
        subOrchestrator: sub,
        color,
      })
      chips?.ensure?.(agent.key, agent.name, color)
      added.push(view)
    })
    for (const view of views.values()) {
      if (!view.parentKey) continue
      const parent = views.get(view.parentKey)
      if (parent) view.color = parent.color
    }
    layoutHomes(currentLadder)
    placeViews()
    for (const view of added) {
      view.group.position.copy(view.home)
      view.touch.copy(view.home)
    }
  }

  layoutHomes(null)
  const initialColors = agentColors(roster)
  roster.forEach((agent, rosterIndex) => {
    const sub = isSubOrchestrator(agent)
    addView(agent, {
      index: -1,
      shapeName: shapes[rosterIndex],
      home: new THREE.Vector3(),
      scale: sub ? SUB_ORCHESTRATOR_SCALE : 1,
      subOrchestrator: sub,
      color: initialColors[rosterIndex] ?? agentColor(0),
    })
  })
  placeViews()
  for (const view of views.values()) {
    view.group.position.copy(view.home)
    view.touch.copy(view.home)
  }

  function setStatus(view, status, now) {
    if (view.style !== status) {
      if (status === 'queued') view.pointer = null
      if (status === 'working' && view.style !== 'queued') view.pointer = null
      if (status === 'done' || status === 'error') view.doneAt = now
      if (status === 'working' || status === 'queued') view.busySince = now
      if (view.parentKey) {
        if (status === 'working' || status === 'queued') view.fadeStart = 0
        else if (status === 'done' || status === 'error') view.fadeStart = now
      }
    }
    view.style = status
  }

  let currentTasks = null

  function setTasks(tasksMap) {
    currentTasks = tasksMap instanceof Map ? tasksMap : null
  }

  function setLabels(labels) {
    currentLabels = labels instanceof Map || (labels && typeof labels === 'object') ? labels : null
    for (const view of views.values()) {
      const name = currentLabels && !view.parentKey ? labelFor(view.key, currentLabels) ?? view.key : view.name
      view.callout.title.textContent = name.toUpperCase()
      view.label.userData.setText?.(nameLabel(name))
    }
  }

  function aimAt(key, dir, file, now) {
    const view = views.get(key)
    if (!view) return
    view.aim = { dir, file, until: now + AIM_HOLD }
    view.pointer = { dir, file }
  }

  function focusPointer(state, entry, out = null) {
    const path = entry?.focus?.[0]
    if (path === undefined) return null
    const point = out ?? { dir: '', file: null }
    if (state.files.has(path)) {
      point.dir = dirname(path)
      point.file = path
    } else {
      point.dir = path
      point.file = null
    }
    return point
  }

  function aimOrchestratorLine(view, mainView) {
    if (!view.orchestratorLink) return
    const mainAt = mainView ? mainView.group.position : ORCHESTRATOR_HOME
    const parentKey = lineParentKey(view.key, currentLadder)
    const parentView = parentKey === 'orchestrator' ? null : views.get(parentKey)
    const [start, end] = orchestratorLineEnds(parentView ? parentView.group.position : mainAt, view.group.position, view.orchestratorEnds)
    setEnds(view.orchestratorLink, start, end)
  }

  function setSway(level) {
    const value = Number(level)
    swayTarget = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
    return swayTarget
  }

  function beat(strength) {
    const value = Math.min(1, Math.max(0, Number(strength) || 0))
    if (!(value > 0) || still()) return
    const at = performance.now()
    for (const view of views.values()) {
      const next = startDanceEnvelope({ from: view.danceFrom, to: view.danceTo, at: view.danceAt }, value, at)
      view.danceFrom = next.from
      view.danceTo = next.to
      view.danceAt = next.at
      const slot = view.beatRings[view.beatNext]
      view.beatNext = (view.beatNext + 1) % view.beatRings.length
      slot.start = at
      slot.strength = value
      slot.line.visible = true
    }
  }

  function updateBeatRings(view, now, isStill) {
    for (const slot of view.beatRings) {
      if (!slot.line.visible) continue
      if (isStill) {
        slot.line.visible = false
        continue
      }
      const age = now - slot.start
      ringPulse(AGENT_RING_BASE, AGENT_RING_GROW, age, AGENT_RING_MS, slot.strength, RING_MAX_OPACITY, slot.pulse)
      if (age >= AGENT_RING_MS) {
        slot.line.visible = false
        continue
      }
      slot.line.scale.set(slot.pulse.radius, 1, slot.pulse.radius)
      writeOpacity(slot.line.material, slot.pulse.opacity)
    }
  }

  function update(state, delta, now, world, terminals, callout = null) {
    if (world.back && world.right) {
      camUp.crossVectors(world.back, world.right).normalize()
      rotMatrix.makeBasis(world.right, camUp, world.back)
    }
    for (const key of pendingChipRemovals) terminals.remove?.(key)
    pendingChipRemovals.clear()
    const isStill = still()
    swayLevel = isStill ? 0 : swayLevel + (swayTarget - swayLevel) * easeRate(delta, 1.5, false)
    endedList.length = 0
    syncViews(state, terminals)
    let mainView = null
    for (const view of views.values()) {
      if (view.orchestrator) {
        mainView = view
        break
      }
    }
    let subCount = 0
    for (const view of views.values()) {
      if (view.subOrchestrator) subCount += 1
    }
    const nameLift = orchestratorNameLift(subCount)
    let busyCount = 0
    for (const view of views.values()) {
      const entry = state.agents.get(view.key)
      setStatus(view, entry?.status ?? 'idle', now)
      if (view.style === 'working' || view.style === 'queued') {
        const item = busyPool[busyCount] ?? (busyPool[busyCount] = { key: '', since: 0 })
        item.key = view.key
        item.since = view.busySince
        busyList[busyCount] = item
        busyCount += 1
      }
    }
    busyList.length = busyCount
    const full = fullCalloutKeys(busyList, callout?.focus ?? null, callout?.hover ?? null, calloutScratch)

    for (const view of views.values()) {
      const entry = state.agents.get(view.key)
      const status = view.style
      const style = STYLE[status] ?? STYLE.idle
      const fade = view.parentKey ? (view.fadeStart > 0 ? childFade(now - view.fadeStart, isStill) : 1) : 1
      const ran = Boolean(entry) && (entry.status !== 'idle' || (entry.runs ?? 0) > 0 || (entry.lines?.length ?? 0) > 0)
      if (view.sessionReader && !ran) {
        view.group.visible = false
        for (const slot of view.beatRings) slot.line.visible = false
        view.link.visible = false
        view.callout.object.visible = false
        view.calloutLine.visible = false
        if (view.orchestratorLink) view.orchestratorLink.visible = false
        setTrailVisible(view.trail, false)
        hideBeam(view)
        terminals.setVisible?.(view.key, false)
        continue
      }
      view.group.visible = true
      updateBeatRings(view, now, isStill)
      const presence = agentPresence({ status, orchestrator: view.orchestrator || view.subOrchestrator }, ran)
      if (!view.presenceReady) {
        view.presence = presence.dim ? 0 : 1
        view.presenceReady = true
      } else if (presence.dim) {
        view.presence = 0
      } else if (view.presence < 1) {
        view.presence = isStill ? 1 : Math.min(1, view.presence + (delta * 1000) / PRESENCE_GROW_MS)
      }
      const opacityFactor = UNSEEN_OPACITY + (1 - UNSEEN_OPACITY) * view.presence
      const scaleFactor = UNSEEN_SCALE + (1 - UNSEEN_SCALE) * view.presence
      const swayWave = 0.5 + 0.5 * Math.sin(now * SWAY_RATE + Math.atan2(view.home.z, view.home.x))
      const swayScale = isStill ? 1 : 1 + swayLevel * SWAY_SCALE * swayWave
      view.presenceOpacity = opacityFactor
      view.group.scale.setScalar(view.scale * scaleFactor * swayScale)

      const thinking = agentThinking(entry)
      if (!thinking) view.thinkingSince = 0
      else if (view.thinkingSince === 0) view.thinkingSince = now
      const thinkingOn = thinking && thinkingDue(view.thinkingSince, now)
      view.thinking = thinkingLevel(view.thinking, thinkingOn, delta, isStill)

      if (view.parentKey) {
        const parentName = state.agents.get(view.parentKey)?.name ?? view.parentKey
        terminals.ensure?.(view.key, `${parentName} > ${entry?.name ?? view.name}`, view.color)
        terminals.setVisible?.(view.key, true)
        terminals.setFade?.(view.key, fade)
        if (fade <= 0) {
          const item = endedPool[endedList.length] ?? (endedPool[endedList.length] = { view: null, entry: null })
          item.view = view
          item.entry = entry
          endedList.push(item)
        }
      } else {
        terminals.setVisible?.(view.key, !presence.dim)
      }

      const working = (status === 'working' || status === 'queued') && Boolean(entry?.label)
      if (view.parentKey) {
        const parentView = views.get(view.parentKey)
        if (parentView) orbitHome(view, parentView, isStill ? 0 : now / 1000)
      }
      if (!view.group.position.equals(view.home)) {
        if (isStill) view.group.position.copy(view.home)
        else view.group.position.lerp(view.home, easeRate(delta, 4, false))
      }
      view.group.position.y = view.home.y + (isStill ? 0 : swayLevel * SWAY_LIFT * swayWave)
      const parentChipSide = view.parentKey ? views.get(view.parentKey)?.chipSide : null
      view.chipSide = parentChipSide ? -parentChipSide : view.home.x < 0 ? -1 : 1

      const fresh = status === 'done' && now - view.doneAt < DONE_GLOW_MS
      const opacity = status === 'done' ? (fresh ? 1 : 0.6) : style.opacity
      writeColor(view.shape.material, style.color)
      writeOpacity(view.shape.material, opacity * fade * opacityFactor)
      writeOpacity(view.label.material, fade * opacityFactor)
      const ringColor = status === 'working' || status === 'queued' ? view.color : style.color
      for (let index = 0; index < view.rings.length; index += 1) {
        const ring = view.rings[index]
        writeColor(ring.material, ringColor)
        writeOpacity(ring.material, opacity * fade * opacityFactor * (index === 0 ? 0.55 : 0.4))
      }
      if (!isStill) {
        const spin = style.spin + (THINKING_SPIN - style.spin) * view.thinking
        view.shape.rotation.y += delta * spin
        view.shape.rotation.x += delta * style.spin * 0.4
      }
      if (view.thinking > 0.001) {
        const spinnerFade = view.thinking * fade * opacityFactor
        view.spinner.group.visible = true
        writeOpacity(view.spinner.ringMaterial, SPINNER_RING_OPACITY * spinnerFade)
        writeOpacity(view.spinner.arcMaterial, SPINNER_ARC_OPACITY * spinnerFade)
        const arc = thinkingArc(now, 0, SPINNER_SWEEP_SECONDS, isStill)
        view.spinner.arcs[0].rotation.z = arc
        view.spinner.arcs[1].rotation.z = arc + SPINNER_PHASE
      } else {
        view.spinner.group.visible = false
      }
      const dance = isStill ? 0 : danceEnvelope(view.danceFrom, view.danceTo, now - view.danceAt)
      const less = view.orchestrator || view.subOrchestrator
      if (!isStill) {
        const turn = dance - view.danceTurn
        view.shape.rotation.y += turn * (less ? 0.08 : 0.2)
        view.shape.rotation.x += turn * (less ? 0.03 : 0.07)
      }
      view.danceTurn = dance
      let pulse = 0
      if ((status === 'working' || status === 'queued') && !isStill) {
        pulse = 0.05 * (0.5 + 0.5 * Math.sin(now * 0.0022))
      }
      if (!isStill) {
        pulse = Math.max(pulse, danceScale(dance, less) - 1)
      }
      view.shape.scale.setScalar(1 + pulse)
      applyPulse(view, delta, isStill)

      const lastLine = entry?.lines?.[entry.lines.length - 1]
      const lastFailed = lastLine?.tone === 'error'
      const failedFresh = status === 'error' && now - view.doneAt < DONE_GLOW_MS
      let calloutTone = null
      let calloutText = ''
      if (working) {
        calloutTone = lastFailed ? 'error' : 'working'
        calloutText = entry.label
      } else if (failedFresh) {
        calloutTone = 'error'
        calloutText = entry?.error || 'FAILED'
      } else if (fresh) {
        calloutTone = 'done'
        calloutText = 'FINISHED'
      }

      const compact = Boolean(working) && !full.has(view.key)
      const calloutColor = cssColor(view.color)
      if (calloutColor && view.calloutColor !== calloutColor) {
        view.calloutColor = calloutColor
        paintAgentColor(view.callout.element, calloutColor)
      }
      if (view.calloutCompact !== compact) {
        view.calloutCompact = compact
        view.callout.task.style.display = compact ? 'none' : ''
        view.callout.cmd.style.display = compact ? 'none' : ''
      }

      if (calloutTone && fade > 0.01) {
        view.callout.object.visible = true
        if (view.calloutTone !== calloutTone) {
          view.calloutTone = calloutTone
          view.callout.element.className = `mr-callout is-${calloutTone}`
        }
        const taskText = currentTasks?.get(view.key) ?? ''
        if (view.callout.task.textContent !== taskText) {
          view.callout.task.textContent = taskText
        }
        if (view.callout.cmd.textContent !== calloutText) {
          view.callout.cmd.textContent = calloutText
        }

        const calloutSide = -view.chipSide
        calloutPos.copy(view.group.position)
        calloutPos.addScaledVector(world.right, calloutSide * 140)
        calloutPos.addScaledVector(camUp, 180 + (view.orchestrator ? nameLift : 0))
        view.callout.object.position.copy(calloutPos)
        view.callout.object.quaternion.setFromRotationMatrix(rotMatrix)

        setEnds(view.calloutLine, view.group.position, calloutPos)
        writeColor(view.calloutLine.material, WHITE)
        view.calloutLine.visible = true
      } else {
        view.callout.object.visible = false
        view.calloutLine.visible = false
      }

      terminals.edgePoint(view.key, -view.chipSide, chipNear)
      setEnds(view.link, view.group.position, chipNear)
      writeColor(view.link.material, style.color)
      writeOpacity(view.link.material, (working ? 0.6 : status === 'idle' ? 0.18 : 0.4) * fade * opacityFactor)
      view.link.visible = !presence.dim
      if (view.parentLink) {
        const parentView = views.get(view.parentKey)
        if (parentView) {
          setEnds(view.parentLink, parentView.group.position, view.group.position)
          writeColor(view.parentLink.material, parentView.shape.material.color.getHex())
          writeOpacity(view.parentLink.material, 0.3 * fade)
          view.parentLink.visible = fade > 0.01
        } else {
          view.parentLink.visible = false
        }
      }
      if (view.orchestratorLink) {
        aimOrchestratorLine(view, mainView)
        writeColor(view.orchestratorLink.material, WHITE)
        writeOpacity(view.orchestratorLink.material, view.subOrchestrator ? SUB_ORCHESTRATOR_LINK_OPACITY : ORCHESTRATOR_LINK_OPACITY)
        view.orchestratorLink.visible = true
      }

      if (view.web && (!online || (status !== 'working' && status !== 'queued'))) view.web = false
      const webOn = view.web && online && (status === 'working' || status === 'queued')
      const pointer = view.pointer ?? (working ? focusPointer(state, entry, focusScratch) : null)
      let color = null
      if (pointer) {
        if (working && lastFailed) color = RED
        else if (working) color = TUNNEL_GREY
        else if (fresh) color = GREEN
        else if (status === 'error') color = RED
      }
      const stripOn = Boolean(pointer) && color !== null && fade > 0.01
      if (color !== null) view.stripColor = color
      view.tunnel = tunnelLevel(view.tunnel, stripOn, delta, isStill)
      view.stripOpacity = view.tunnel * STRIP_OPACITY
      const stripVisible = view.tunnel > 0.01 && fade > 0.01
      setTrailVisible(view.trail, stripVisible)
      if (pointer) {
        view.side = world.side(pointer.dir)
        const tab = world.anchor?.(pointer.dir)
        if (tab) traceEnd.copy(tab)
        else world.edge(pointer.dir, pointer.file, view.side, traceEnd)
        view.touch.copy(traceEnd)
      } else if (!webOn && !stripVisible) {
        view.touch.copy(view.home)
      }
      if (stripVisible) {
        if (pointer) {
          const chain = litChain(pointer.dir, world.links, world.mask, view.chain, chainCache)
          tunnelRoute(chain, world.links, world.mask, view.route)
        }
        if (view.route.length > 0) {
          speckPolyline(view.group.position, view.route, world.anchor, view.touch, view.path)
        } else {
          stripPoints(view.group.position, view.touch, view.path)
        }
        if (setTrailPath(view.trail, view.path)) polylineLengths(view.path, view.pathLengths)
        trailColor(view.trail, view.stripColor)
        trailOpacity(view.trail, view.stripOpacity * fade)
      }
      if (webOn) {
        webTunnelEnd(view.group.position, view.webPlace, INTERNET_RADIUS, webEdgePoint)
      }
      const beamVisible = webOn && fade > 0.01
      setTrailVisible(view.beamTrail, beamVisible)
      if (beamVisible) {
        view.beamPath[0].x = view.group.position.x
        view.beamPath[0].y = view.group.position.y
        view.beamPath[0].z = view.group.position.z
        view.beamPath[1].x = webEdgePoint.x
        view.beamPath[1].y = webEdgePoint.y
        view.beamPath[1].z = webEdgePoint.z
        setTrailPath(view.beamTrail, view.beamPath)
        trailColor(view.beamTrail, WEB)
        trailOpacity(view.beamTrail, BEAM_OPACITY * fade)
      }
    }
    for (const item of endedList) {
      if (item.entry) retired.add(item.entry)
      terminals.setVisible?.(item.view.key, false)
      terminals.setOpen?.(item.view.key, false)
      removeView(item.view, terminals)
    }
  }

  function snap(state, world) {
    retired = new WeakSet()
    syncViews(state)
    for (const view of views.values()) {
      view.aim = null
      view.pointer = null
      view.side = -1
      view.stripOpacity = 0
      view.tunnel = 0
      setTrailVisible(view.trail, false)
      view.web = false
      hideBeam(view)
      view.group.position.copy(view.home)
      view.touch.copy(view.home)
      view.style = 'idle'
      view.fadeStart = 0
      view.doneAt = 0
      view.presence = 0
      view.presenceReady = false
      view.presenceOpacity = 1
      view.danceFrom = 0
      view.danceTo = 0
      view.danceAt = 0
      view.danceTurn = 0
      view.thinking = 0
      view.thinkingSince = 0
      view.spinner.group.visible = false
      swayTarget = 0
      swayLevel = 0
      view.pulseLevels.fill(0)
      restorePulse(view)
      view.group.scale.setScalar(view.scale)
    }
  }

  function setLadder(ladder) {
    currentLadder = hasSubs(ladder) ? ladder : null
    layoutHomes(currentLadder)
    placeViews()
    if (still()) {
      for (const view of views.values()) {
        view.group.position.copy(view.home)
      }
    }
    let mainView = null
    for (const view of views.values()) {
      if (view.orchestrator) {
        mainView = view
        break
      }
    }
    for (const view of views.values()) aimOrchestratorLine(view, mainView)
  }

  function dispose() {
    for (const view of [...views.values()]) removeView(view)
    pendingChipRemovals.clear()
    views.clear()
    pickables.length = 0
  }

  return { views, pickables, update, snap, aimAt, setTasks, setLadder, setLabels, setRoster, setBands, setViewport, dispose, beat, setSway, webStart, webEnd, webActive, setOnline }
}
