import * as THREE from 'three'
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { ownerOf, sectorArcs } from '../model/hierarchy.js'
import { dirname } from '../model/paths.js'
import { CHILD_LIFE_MS } from '../model/state.js'
import { HUB_RADIUS, HUB_Y, ORCHESTRATOR_HOME, ORCHESTRATOR_LIFT, PARK_LIFT, hasSubs, isSessionReader, parkedKeysFor, readerPoint, sectorSlotAngles, slotAngle } from './hub.js'
import { INTERNET_RADIUS } from './internet.js'
import { ORCHESTRATOR_PULSE_SCALE, ORCHESTRATOR_SHAPE, PREFERRED, PULSE_BANDS, PULSE_SCALE, SUB_PULSE_SCALE, bandForVertex, isOrchestrator, isSubOrchestrator, nextSpareShape, shapeGeometry, shapesFor, vertexOffset } from './shapes.js'
import { GREEN, RED, WEB, WHITE, YELLOW, easeRate, lineMaterial, still, textSprite } from './sprites.js'
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
const STRIP_OPACITY = 0.75
export const PACKET_POOL = 24
export const PACKET_DURATION = 450
export const PACKET_INTERVAL = 90
export const PACKET_BURST = 5
const PACKET_BURST_GAP = 30
const PACKET_SIZE = 3
export const BEAM_OPACITY = 1
export const BEAM_PACKET_SIZE = 2
export const BEAM_PACKET_INTERVAL = 160
export const BEAM_PACKET_BURST = 3
const BEAM_PACKET_GAP = 40
const MAX_CHAIN = 32
export const CHILD_SCALE = 0.6
export const CHILD_TURN = Math.PI / 5
export const CHILD_GAP = 120
export const SUB_ORCHESTRATOR_SCALE = 0.7
export const SUB_ORCHESTRATOR_LIFT = ORCHESTRATOR_LIFT * 0.5
export const SUB_ORCHESTRATOR_RADIUS = HUB_RADIUS * 2.4
export const ORCHESTRATOR_NAME_LIFT = (ORCHESTRATOR_LIFT * 2) / 3
export const ORCHESTRATOR_LINK_OPACITY = 0.1
export const SUB_ORCHESTRATOR_LINK_OPACITY = 0.3
export const DANCE_SCALE = 0.08
export const ORCHESTRATOR_DANCE_SCALE = 0.03
const DANCE_DECAY = 5

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

export function fullCalloutKeys(busy, focus = null, hover = null) {
  const list = []
  const keys = new Set()
  for (const item of busy ?? []) {
    const key = item?.key
    if (typeof key !== 'string' || key === '' || keys.has(key)) continue
    keys.add(key)
    list.push({ key, since: busyTime(item) })
  }
  if (list.length <= CALLOUT_CROWD_LIMIT) return keys
  const ranked = [...list].sort((a, b) => busyTime(b) - busyTime(a) || byKey(a.key, b.key))
  const kept = new Set(ranked.slice(0, CALLOUT_RECENT_KEEP).map((item) => item.key))
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

export function childPlace(parentPlace, index = 0) {
  const x = Number(parentPlace?.x) || 0
  const y = Number(parentPlace?.y) || 0
  const z = Number(parentPlace?.z) || 0
  const slot = Math.max(0, Math.floor(Number(index) || 0))
  const side = slot % 2 === 0 ? 1 : -1
  const rank = Math.floor(slot / 2) + 1
  const turn = side * rank * CHILD_TURN
  const radius = Math.hypot(x, z)
  if (radius < 1) {
    return { x: x + Math.cos(turn) * CHILD_GAP * rank, y, z: z + Math.sin(turn) * CHILD_GAP * rank }
  }
  const angle = Math.atan2(z, x) + turn
  return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius }
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
  const back = []
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

export function speckPolyline(start, chain, centerOf, end, out = []) {
  const points = out ?? []
  let count = 0
  let routed = Array.isArray(chain) && chain.length > 0
  if (routed) {
    for (let index = 0; index < chain.length; index += 1) {
      const spot = typeof centerOf === 'function' ? centerOf(chain[index]) : null
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
    for (let index = 0; index < chain.length; index += 1) write(centerOf(chain[index]))
  }
  write(end)
  points.length = count
  return points
}

function spanLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
}

export function samplePolyline(points, t, out = {}) {
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
  let total = 0
  for (let index = 1; index < count; index += 1) total += spanLength(list[index - 1], list[index])
  if (!(total > 0)) {
    point.x = first.x
    point.y = first.y
    point.z = first.z
    return point
  }
  let left = walk * total
  for (let index = 1; index < count; index += 1) {
    const a = list[index - 1]
    const b = list[index]
    const length = spanLength(a, b)
    if (length > 0 && left <= length) {
      const fraction = left / length
      point.x = a.x + (b.x - a.x) * fraction
      point.y = a.y + (b.y - a.y) * fraction
      point.z = a.z + (b.z - a.z) * fraction
      return point
    }
    left -= length
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

export function packetSpots(now, sends, duration = PACKET_DURATION, reduced = false, out = []) {
  const spots = out ?? []
  spots.length = 0
  if (reduced || !Number.isFinite(now) || !(duration > 0)) return spots
  if (!sends || sends.length === 0) return spots
  for (let i = 0; i < sends.length; i += 1) {
    const sent = sends[i]
    const age = now - sent
    if (!(age >= 0) || age > duration) continue
    spots.push(age / duration)
    if (spots.length > PACKET_POOL) spots.shift()
  }
  return spots
}

function packetPoints(size = PACKET_SIZE) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PACKET_POOL * 3), 3))
  geometry.setDrawRange(0, 0)
  const material = new THREE.PointsMaterial({
    color: YELLOW,
    size,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.visible = false
  return points
}

function beamLineMaterial() {
  return new THREE.LineBasicMaterial({
    color: WEB,
    transparent: true,
    opacity: BEAM_OPACITY,
    linewidth: 0.5,
    depthWrite: false,
  })
}

function beamPoints() {
  const points = packetPoints(BEAM_PACKET_SIZE)
  points.material.color.setHex(WEB)
  points.material.blending = THREE.NormalBlending
  return points
}

const chipNear = new THREE.Vector3()
const traceEnd = new THREE.Vector3()
const stripStart = new THREE.Vector3()
const packetPoint = new THREE.Vector3()
const webEdgePoint = new THREE.Vector3()
const webReturnPoint = new THREE.Vector3()
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
  const last = line.userData.ends
  if (
    last &&
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
  array[0] = a.x
  array[1] = a.y
  array[2] = a.z
  array[3] = b.x
  array[4] = b.y
  array[5] = b.z
  line.userData.ends = [a.x, a.y, a.z, b.x, b.y, b.z]
  line.geometry.attributes.position.needsUpdate = true
  return true
}

function setPath(line, points) {
  const count = points.length
  const last = line.userData.path
  if (last && last.length === count * 3) {
    let same = true
    for (let index = 0; index < count && same; index += 1) {
      const point = points[index]
      const base = index * 3
      if (last[base] !== point.x || last[base + 1] !== point.y || last[base + 2] !== point.z) same = false
    }
    if (same) return false
  }
  let attr = line.geometry.getAttribute('position')
  if (!attr || attr.count !== count) {
    line.geometry.dispose()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    line.geometry = geometry
    attr = geometry.getAttribute('position')
  }
  const array = attr.array
  const flat = last && last.length === count * 3 ? last : new Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const point = points[index]
    const base = index * 3
    array[base] = point.x
    array[base + 1] = point.y
    array[base + 2] = point.z
    flat[base] = point.x
    flat[base + 1] = point.y
    flat[base + 2] = point.z
  }
  line.userData.path = flat
  attr.needsUpdate = true
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

export function createAgents(scene, roster, cssScene = null) {
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
  let sectorList = []
  let slotAngles = sectorSlotAngles(null, parkedKeys)
  const chainCache = { links: null, mask: null, parents: null }
  let pulseSource = null

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
    return new THREE.Vector3(Math.cos(angle) * HUB_RADIUS, HUB_Y + PARK_LIFT, Math.sin(angle) * HUB_RADIUS)
  }

  function layoutHomes(ladder) {
    sectorList = hasSubs(ladder) ? sectorArcs(ladder, parkedKeys) : []
    slotAngles = sectorSlotAngles(ladder, parkedKeys)
  }

  function queuePacket(view, at) {
    view.packetSends.push(at)
    if (view.packetSends.length > PACKET_POOL) view.packetSends.shift()
  }

  function hidePackets(view) {
    view.packets.visible = false
    view.packetNextAt = 0
    view.packetSends.length = 0
    view.packetFractions.length = 0
  }

  let online = true

  function queueBeamPacket(view, at) {
    view.beamSends.push(at)
    if (view.beamSends.length > PACKET_POOL) view.beamSends.shift()
  }

  function hideBeamPackets(view) {
    view.beamPackets.visible = false
    view.beamNextAt = 0
    view.beamSends.length = 0
    view.beamFractions.length = 0
  }

  function hideBeam(view) {
    view.beam.visible = false
    hideBeamPackets(view)
  }

  function setOnline(next) {
    online = next !== false
    if (!online) {
      for (const view of views.values()) {
        view.web = false
        view.beamReturnUntil = 0
        hideBeam(view)
      }
    }
    return online
  }

  function webStart(key, place) {
    const view = views.get(key)
    if (!view || !online) return false
    view.web = true
    view.beamReturnUntil = 0
    view.beamSends.length = 0
    view.beamFractions.length = 0
    view.beamNextAt = 0
    if (place) view.webPlace.set(place.x, place.y, place.z)
    return true
  }

  function webEnd(key, now) {
    const view = views.get(key)
    if (!view || !view.web) return false
    view.web = false
    view.beam.visible = false
    view.beamSends.length = 0
    for (let index = 0; index < BEAM_PACKET_BURST; index += 1) {
      view.beamSends.push(now + index * BEAM_PACKET_GAP)
    }
    view.beamFractions.length = 0
    view.beamNextAt = 0
    view.beamReturnUntil = now + PACKET_DURATION + (BEAM_PACKET_BURST - 1) * BEAM_PACKET_GAP
    return true
  }

  function webActive() {
    let count = 0
    for (const view of views.values()) {
      if (view.web) count += 1
    }
    return count
  }

  function beamEdge(view, out) {
    return webTunnelEnd(view.group.position, view.webPlace, INTERNET_RADIUS, out)
  }

  function drawBeamPackets(view, now, fade, forward) {
    const edge = beamEdge(view, webReturnPoint)
    const spots = packetSpots(now, view.beamSends, PACKET_DURATION, false, view.beamFractions)
    const geometry = view.beamPackets.geometry
    const attr = geometry.getAttribute('position')
    const array = attr.array
    const from = forward ? view.group.position : edge
    const to = forward ? edge : view.group.position
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dz = to.z - from.z
    for (let index = 0; index < spots.length; index += 1) {
      const t = spots[index]
      const base = index * 3
      array[base] = from.x + dx * t
      array[base + 1] = from.y + dy * t
      array[base + 2] = from.z + dz * t
    }
    geometry.setDrawRange(0, spots.length)
    attr.needsUpdate = true
    view.beamPackets.material.color.setHex(WEB)
    view.beamPackets.material.opacity = fade
    view.beamPackets.visible = spots.length > 0
  }

  function updatePackets(view, now, fade, sending, path) {
    if (sending && (view.packetNextAt === 0 || now >= view.packetNextAt)) {
      queuePacket(view, now)
      view.packetNextAt = now + PACKET_INTERVAL
    }
    const spots = packetSpots(now, view.packetSends, PACKET_DURATION, false, view.packetFractions)
    const geometry = view.packets.geometry
    const attr = geometry.getAttribute('position')
    const array = attr.array
    for (let i = 0; i < spots.length; i += 1) {
      const point = samplePolyline(path, spots[i], packetPoint)
      const base = i * 3
      array[base] = point.x
      array[base + 1] = point.y
      array[base + 2] = point.z
    }
    geometry.setDrawRange(0, spots.length)
    attr.needsUpdate = true
    view.packets.material.color.setHex(view.stripColor)
    view.packets.material.opacity = view.stripOpacity * fade
    view.packets.visible = true
  }

  function addView(agent, { index, shapeName, home, scale = 1, parentKey = null, subOrchestrator = false, childIndex = 0 }) {
    const group = new THREE.Group()
    const shape = new THREE.LineSegments(shapeGeometry(shapeName), lineMaterial(WHITE, 0.35))
    const orchestrator = parentKey === null && isOrchestrator(agent)
    const sub = parentKey === null && subOrchestrator
    const pulseBase = Float32Array.from(shape.geometry.getAttribute('position').array)
    const pulseVertices = pulseBase.length / 3
    const pulseLengths = new Float32Array(pulseVertices)
    const pulseBands = new Uint8Array(pulseVertices)
    for (let vertex = 0; vertex < pulseVertices; vertex += 1) {
      const at = vertex * 3
      pulseLengths[vertex] = Math.hypot(pulseBase[at], pulseBase[at + 1], pulseBase[at + 2])
      pulseBands[vertex] = bandForVertex(vertex, PULSE_BANDS)
    }
    const pulseScale = orchestrator ? ORCHESTRATOR_PULSE_SCALE : sub ? SUB_PULSE_SCALE : PULSE_SCALE
    const rings = [flatRing(130, 0.2, -110)]
    if (orchestrator) rings.push(flatRing(158, 0.14, -110))
    const label = textSprite(nameLabel(agent.name), { scale: 1.5, color: 'rgba(255,255,255,.7)' })
    label.position.set(0, -150, 0)
    const picker = new THREE.Mesh(new THREE.SphereGeometry(170, 8, 8), new THREE.MeshBasicMaterial({ visible: false }))
    picker.userData.key = agent.key
    group.add(shape, ...rings, label, picker)
    group.position.copy(home)
    group.scale.setScalar(scale)

    const link = lineBetween(lineMaterial(WHITE, 0.4))
    const stripMaterial = lineMaterial(YELLOW, 0)
    const strip = lineBetween(stripMaterial)
    strip.visible = false
    const packets = packetPoints()
    const beam = lineBetween(beamLineMaterial())
    beam.visible = false
    const beamPackets = beamPoints()
    const parentLink = parentKey ? lineBetween(lineMaterial(WHITE, 0.3)) : null
    const orchestratorLink = parentKey === null && !orchestrator
      ? lineBetween(lineMaterial(WHITE, sub ? SUB_ORCHESTRATOR_LINK_OPACITY : ORCHESTRATOR_LINK_OPACITY))
      : null
    if (orchestratorLink) orchestratorLink.renderOrder = -1

    const callout = makeCallout(currentLabels && parentKey === null ? labelFor(agent.key, currentLabels) ?? agent.key : agent.name)
    const calloutLine = lineBetween(lineMaterial(WHITE, 0.3))
    calloutLine.visible = false

    scene.add(group, link, strip, packets, beam, beamPackets, calloutLine)
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
      rings,
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
      path: [],
      chain: [],
      stripMaterial,
      packets,
      packetSends: [],
      packetFractions: [],
      packetNextAt: 0,
      packetBurstAt: -Infinity,
      stripOpacity: 0,
      stripColor: YELLOW,
      web: false,
      webPlace: new THREE.Vector3(),
      beam,
      beamPackets,
      beamSends: [],
      beamFractions: [],
      beamNextAt: 0,
      beamReturnUntil: 0,
      home,
      touch: home.clone(),
      aim: null,
      pointer: null,
      side: -1,
      chipSide: 1,
      doneAt: 0,
      busySince: 0,
      calloutCompact: false,
      style: 'idle',
      presence: orchestrator ? 1 : 0,
      presenceReady: false,
      presenceOpacity: 1,
      dance: 0,
      pulseBase,
      pulseLengths,
      pulseBands,
      pulseLevels: new Float32Array(PULSE_BANDS),
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
    scene.remove(view.group, view.link, view.strip, view.packets, view.beam, view.beamPackets, view.calloutLine)
    if (view.parentLink) scene.remove(view.parentLink)
    if (view.orchestratorLink) scene.remove(view.orchestratorLink)
    for (const root of [view.group, view.link, view.strip, view.packets, view.beam, view.beamPackets, view.calloutLine, view.parentLink, view.orchestratorLink]) {
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
    for (const view of [...views.values()]) {
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
      const place = childPlace(parentView.home, index)
      addView(entry, {
        index: -1,
        shapeName,
        home: new THREE.Vector3(place.x, place.y, place.z),
        scale: parentView.scale * CHILD_SCALE,
        parentKey: entry.parent,
        childIndex: index,
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
      const place = childPlace(parent.home, view.childIndex ?? 0)
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
    const added = []
    for (const agent of currentRoster) {
      if (views.has(agent.key)) continue
      const sub = isSubOrchestrator(agent)
      const shapeName = shapeForNewAgent(agent, [...usedShapes])
      usedShapes.add(shapeName)
      const view = addView(agent, {
        index: -1,
        shapeName,
        home: new THREE.Vector3(),
        scale: sub ? SUB_ORCHESTRATOR_SCALE : 1,
        subOrchestrator: sub,
      })
      chips?.ensure?.(agent.key, agent.name)
      added.push(view)
    }
    layoutHomes(currentLadder)
    placeViews()
    for (const view of added) {
      view.group.position.copy(view.home)
      view.touch.copy(view.home)
    }
  }

  layoutHomes(null)
  roster.forEach((agent, rosterIndex) => {
    const sub = isSubOrchestrator(agent)
    addView(agent, {
      index: -1,
      shapeName: shapes[rosterIndex],
      home: new THREE.Vector3(),
      scale: sub ? SUB_ORCHESTRATOR_SCALE : 1,
      subOrchestrator: sub,
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
    if (now - view.packetBurstAt > 4) {
      view.packetBurstAt = now
      for (let i = 0; i < PACKET_BURST; i += 1) queuePacket(view, now + i * PACKET_BURST_GAP)
    }
  }

  function focusPointer(state, entry) {
    const path = entry?.focus?.[0]
    if (path === undefined) return null
    if (state.files.has(path)) return { dir: dirname(path), file: path }
    return { dir: path, file: null }
  }

  function aimOrchestratorLine(view, mainView) {
    if (!view.orchestratorLink) return
    const mainAt = mainView ? mainView.group.position : ORCHESTRATOR_HOME
    const parentKey = lineParentKey(view.key, currentLadder)
    const parentView = parentKey === 'orchestrator' ? null : views.get(parentKey)
    const [start, end] = orchestratorLineEnds(parentView ? parentView.group.position : mainAt, view.group.position, view.orchestratorEnds)
    setEnds(view.orchestratorLink, start, end)
  }

  function beat(strength) {
    const value = Math.min(1, Math.max(0, Number(strength) || 0))
    if (!(value > 0) || still()) return
    for (const view of views.values()) {
      const less = view.orchestrator || view.subOrchestrator
      view.dance = Math.max(view.dance, value)
      view.shape.rotation.y += (less ? 0.08 : 0.2) * value
      view.shape.rotation.x += (less ? 0.03 : 0.07) * value
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
    const ended = []
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
    const busy = []
    for (const view of views.values()) {
      const entry = state.agents.get(view.key)
      setStatus(view, entry?.status ?? 'idle', now)
      if ((view.style === 'working' || view.style === 'queued') && entry?.label) {
        busy.push({ key: view.key, since: view.busySince })
      }
    }
    const full = fullCalloutKeys(busy, callout?.focus ?? null, callout?.hover ?? null)

    for (const view of views.values()) {
      const entry = state.agents.get(view.key)
      const status = view.style
      const style = STYLE[status] ?? STYLE.idle
      const fade = view.parentKey ? (view.fadeStart > 0 ? childFade(now - view.fadeStart, isStill) : 1) : 1
      const ran = Boolean(entry) && (entry.status !== 'idle' || (entry.runs ?? 0) > 0 || (entry.lines?.length ?? 0) > 0)
      if (view.sessionReader && !ran) {
        view.group.visible = false
        view.link.visible = false
        view.callout.object.visible = false
        view.calloutLine.visible = false
        if (view.orchestratorLink) view.orchestratorLink.visible = false
        view.strip.visible = false
        hidePackets(view)
        hideBeam(view)
        terminals.setVisible?.(view.key, false)
        continue
      }
      view.group.visible = true
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
      view.presenceOpacity = opacityFactor
      view.group.scale.setScalar(view.scale * scaleFactor)

      if (view.parentKey) {
        const parentName = state.agents.get(view.parentKey)?.name ?? view.parentKey
        terminals.ensure?.(view.key, `${parentName} > ${entry?.name ?? view.name}`)
        terminals.setVisible?.(view.key, true)
        terminals.setFade?.(view.key, fade)
        if (fade <= 0) ended.push({ view, entry })
      } else {
        terminals.setVisible?.(view.key, !presence.dim)
      }

      const working = (status === 'working' || status === 'queued') && Boolean(entry?.label)
      if (!view.group.position.equals(view.home)) {
        if (isStill) view.group.position.copy(view.home)
        else view.group.position.lerp(view.home, easeRate(delta, 4, false))
      }
      const parentChipSide = view.parentKey ? views.get(view.parentKey)?.chipSide : null
      view.chipSide = parentChipSide ? -parentChipSide : view.home.x < 0 ? -1 : 1

      const fresh = status === 'done' && now - view.doneAt < DONE_GLOW_MS
      const opacity = status === 'done' ? (fresh ? 1 : 0.6) : style.opacity
      view.shape.material.color.setHex(style.color)
      view.shape.material.opacity = opacity * fade * opacityFactor
      view.label.material.opacity = fade * opacityFactor
      const ringColor = status === 'working' || status === 'queued' ? YELLOW : style.color
      view.rings.forEach((ring, index) => {
        ring.material.color.setHex(ringColor)
        ring.material.opacity = opacity * fade * opacityFactor * (index === 0 ? 0.55 : 0.4)
      })
      if (!isStill) {
        view.shape.rotation.y += delta * style.spin
        view.shape.rotation.x += delta * style.spin * 0.4
      }
      view.dance = isStill ? 0 : Math.max(0, view.dance - delta * DANCE_DECAY)
      let pulse = 0
      if ((status === 'working' || status === 'queued') && !isStill) {
        pulse = 0.05 * (0.5 + 0.5 * Math.sin(now * 0.0022))
      }
      if (!isStill) {
        pulse = Math.max(pulse, danceScale(view.dance, view.orchestrator || view.subOrchestrator) - 1)
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
      if (view.calloutCompact !== compact) {
        view.calloutCompact = compact
        view.callout.task.style.display = compact ? 'none' : ''
        view.callout.cmd.style.display = compact ? 'none' : ''
      }

      if (calloutTone && fade > 0.01) {
        view.callout.object.visible = true
        const calloutClass = `mr-callout is-${calloutTone}`
        if (view.callout.element.className !== calloutClass) {
          view.callout.element.className = calloutClass
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
        view.calloutLine.material.color.setHex(WHITE)
        view.calloutLine.visible = true
      } else {
        view.callout.object.visible = false
        view.calloutLine.visible = false
      }

      terminals.edgePoint(view.key, -view.chipSide, chipNear)
      setEnds(view.link, view.group.position, chipNear)
      view.link.material.color.setHex(style.color)
      view.link.material.opacity = (working ? 0.6 : status === 'idle' ? 0.18 : 0.4) * fade * opacityFactor
      view.link.visible = !presence.dim
      if (view.parentLink) {
        const parentView = views.get(view.parentKey)
        if (parentView) {
          setEnds(view.parentLink, parentView.group.position, view.group.position)
          view.parentLink.material.color.setHex(parentView.shape.material.color.getHex())
          view.parentLink.material.opacity = 0.3 * fade
          view.parentLink.visible = fade > 0.01
        } else {
          view.parentLink.visible = false
        }
      }
      if (view.orchestratorLink) {
        aimOrchestratorLine(view, mainView)
        view.orchestratorLink.material.color.setHex(WHITE)
        view.orchestratorLink.material.opacity = view.subOrchestrator ? SUB_ORCHESTRATOR_LINK_OPACITY : ORCHESTRATOR_LINK_OPACITY
        view.orchestratorLink.visible = true
      }

      if (view.web && (!online || (status !== 'working' && status !== 'queued'))) view.web = false
      const webOn = view.web && online && (status === 'working' || status === 'queued')
      const beamReturning = !isStill && now < view.beamReturnUntil
      const pointer = view.pointer ?? (working ? focusPointer(state, entry) : null)
      let color = null
      if (pointer) {
        if (working && lastFailed) color = RED
        else if (working) color = YELLOW
        else if (fresh) color = GREEN
        else if (status === 'error') color = RED
      }
      const stripOn = Boolean(pointer) && color !== null
      if (color !== null) view.stripColor = color
      view.stripOpacity += ((stripOn ? STRIP_OPACITY : 0) - view.stripOpacity) * easeRate(delta, 6, isStill)
      const stripVisible = view.stripOpacity > 0.02 && fade > 0.01
      view.strip.visible = stripVisible
      if (pointer) {
        view.side = world.side(pointer.dir)
        world.edge(pointer.dir, pointer.file, view.side, traceEnd)
        view.touch.copy(traceEnd)
      } else if (!webOn && !beamReturning) {
        view.touch.copy(view.home)
      }
      if (stripVisible) {
        stripStart.copy(view.group.position)
        if (pointer) {
          const chain = litChain(pointer.dir, world.links, world.mask, view.chain, chainCache)
          setPath(view.strip, speckPolyline(stripStart, chain, world.center, view.touch, view.path))
        } else {
          setPath(view.strip, stripPoints(stripStart, view.touch, view.path))
        }
        view.stripMaterial.color.setHex(view.stripColor)
        view.stripMaterial.opacity = view.stripOpacity * fade
      }
      if (webOn || beamReturning) {
        webTunnelEnd(view.group.position, view.webPlace, INTERNET_RADIUS, webEdgePoint)
      }
      const beamVisible = webOn && fade > 0.01
      view.beam.visible = beamVisible
      if (beamVisible) {
        setEnds(view.beam, view.group.position, webEdgePoint)
        view.beam.material.opacity = BEAM_OPACITY * fade
      }
      if (beamVisible && !isStill) {
        if (view.beamNextAt === 0 || now >= view.beamNextAt) {
          queueBeamPacket(view, now)
          view.beamNextAt = now + BEAM_PACKET_INTERVAL
        }
        drawBeamPackets(view, now, fade, true)
      } else if (beamReturning) {
        drawBeamPackets(view, now, fade, false)
      } else {
        hideBeamPackets(view)
      }
      if (stripVisible) {
        if (!isStill) {
          updatePackets(view, now, fade, status === 'working' && stripOn, view.path)
        } else {
          hidePackets(view)
        }
      } else {
        hidePackets(view)
      }
    }
    for (const item of ended) {
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
      view.strip.visible = false
      view.web = false
      view.beamReturnUntil = 0
      hideBeam(view)
      hidePackets(view)
      view.packetBurstAt = -Infinity
      view.group.position.copy(view.home)
      view.touch.copy(view.home)
      view.style = 'idle'
      view.fadeStart = 0
      view.doneAt = 0
      view.presence = 0
      view.presenceReady = false
      view.presenceOpacity = 1
      view.dance = 0
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

  return { views, pickables, update, snap, aimAt, setTasks, setLadder, setLabels, setRoster, setBands, dispose, beat, webStart, webEnd, webActive, setOnline }
}
