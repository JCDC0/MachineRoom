import { CARD_W, CARD_SCALES, FILE_LIMIT_DEFAULT, cardHeight } from './cards.js'
import { dirname } from '../model/paths.js'
import { OVERVIEW } from './camera.js'
import { HUB_Y } from './hub.js'

export const RING_CENTER = { x: 0, y: HUB_Y, z: 0 }
const RING_YAW = OVERVIEW.yaw
export const RING_BACK = { x: -Math.sin(RING_YAW), y: 0, z: -Math.cos(RING_YAW) }
export const RING_RIGHT = { x: Math.cos(RING_YAW), y: 0, z: -Math.sin(RING_YAW) }
export const RING_FRONT = { x: Math.sin(RING_YAW), y: 0, z: Math.cos(RING_YAW) }
export const ROOT_AHEAD = 0
export const ROOT_DROP = 240
const DEFAULT_CARD = { width: 248, height: 64 }
export const ROOT_PLACE = {
  x: 0,
  y: RING_CENTER.y - ROOT_DROP - DEFAULT_CARD.height / 2,
  z: 0,
}
export const TOP_MIN_RADIUS = 900
export const FOLDER_SPACING_MIN = 600
export const FOLDER_SPACING_MAX = 2000
export const FOLDER_SPACING_DEFAULT = 1200
export const FOLDER_SPACING_STEP = 100
export const RING_MAX_TOP = 12
export const FAN_LIMIT = 0.9
export const SPRAY_LIFT = 140
export const SMALL_TOP = 4
export const SMALL_RADIUS = TOP_MIN_RADIUS
const SMALL_TURN = 0.3
export const SMALL_CHILD_TURN = 0.5

const TURNS = Math.PI * 2
const RING_PERIOD = 480
export const FOLDER_DRIFT_RADIUS = 40

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

export function clampFolderSpacing(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return FOLDER_SPACING_DEFAULT
  const number = Number(value)
  if (!Number.isFinite(number)) return FOLDER_SPACING_DEFAULT
  return clamp(Math.round(number / FOLDER_SPACING_STEP) * FOLDER_SPACING_STEP, FOLDER_SPACING_MIN, FOLDER_SPACING_MAX)
}

function byName(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function sizeOf(entry, fallback = DEFAULT_CARD) {
  const width = Number(entry?.width)
  const height = Number(entry?.height)
  return {
    width: Number.isFinite(width) && width > 0 ? width : fallback.width,
    height: Number.isFinite(height) && height > 0 ? height : fallback.height,
  }
}

function makeNode(path, entry) {
  const size = sizeOf(entry)
  return {
    path,
    width: size.width,
    height: size.height,
  }
}

function parentPathOf(path, nodes) {
  let at = dirname(path)
  while (at !== '') {
    if (nodes.has(at)) return at
    at = dirname(at)
  }
  return ''
}

function buildModel(entries) {
  const source = Array.isArray(entries) ? entries : entries ? [...entries] : []
  const nodes = new Map()
  for (const entry of source) {
    if (!entry || typeof entry.path !== 'string' || nodes.has(entry.path)) continue
    nodes.set(entry.path, makeNode(entry.path, entry))
  }
  if (!nodes.has('')) nodes.set('', makeNode('', DEFAULT_CARD))
  const paths = [...nodes.keys()].sort(byName)
  const children = new Map(paths.map((path) => [path, []]))
  for (const path of paths) {
    if (path === '') continue
    const parent = parentPathOf(path, nodes)
    nodes.get(path).parent = parent
    children.get(parent).push(path)
  }
  for (const list of children.values()) list.sort(byName)
  return { nodes, paths, children, root: nodes.get('') }
}

function ringAngle(index, count) {
  const total = Math.max(1, Math.floor(Number(count) || 0))
  const slot = clamp(Math.floor(Number(index) || 0), 0, total - 1)
  return (slot / total) * TURNS
}

function smallRingAngle(index, count) {
  const total = Math.max(1, Math.floor(Number(count) || 0))
  const slot = clamp(Math.floor(Number(index) || 0), 0, total - 1)
  return ((slot + SMALL_TURN) / total) * TURNS
}

function smallRing(count) {
  const total = Math.floor(Number(count) || 0)
  return total >= 1 && total <= SMALL_TOP
}

function ringPoint(radius, angle, y = RING_CENTER.y) {
  const r = Number.isFinite(Number(radius)) ? Number(radius) : 0
  const a = Number.isFinite(Number(angle)) ? Number(angle) : 0
  const along = r * Math.cos(a)
  const across = r * Math.sin(a)
  return {
    x: RING_CENTER.x + RING_BACK.x * along + RING_RIGHT.x * across,
    y: Number.isFinite(Number(y)) ? Number(y) : RING_CENTER.y,
    z: RING_CENTER.z + RING_BACK.z * along + RING_RIGHT.z * across,
  }
}

export function ringOf(position) {
  const dx = Number(position?.x) - RING_CENTER.x
  const dz = Number(position?.z) - RING_CENTER.z
  const along = dx * RING_BACK.x + dz * RING_BACK.z
  const across = dx * RING_RIGHT.x + dz * RING_RIGHT.z
  const radius = Math.hypot(along, across)
  const angle = ((Math.atan2(across, along) % TURNS) + TURNS) % TURNS
  return { radius, angle }
}

export function ringRotation(seconds) {
  const angle = ((seconds % RING_PERIOD) / RING_PERIOD) * TURNS
  return { cos: Math.cos(angle), sin: Math.sin(angle) }
}

export function folderDrift(path) {
  let hash = 2166136261
  for (let index = 0; index < path.length; index += 1) {
    hash = Math.imul(hash ^ path.charCodeAt(index), 16777619)
  }
  const seed = hash >>> 0
  return { phase: (seed / 0x100000000) * TURNS, period: 24 + (seed % 24001) / 1000 }
}

export function orbitPlace(place, rotation, drift, seconds) {
  const x = place.x - RING_CENTER.x
  const z = place.z - RING_CENTER.z
  const angle = drift.phase + ((seconds % drift.period) / drift.period) * TURNS
  return {
    x: RING_CENTER.x + (rotation ? x * rotation.cos - z * rotation.sin : x) + FOLDER_DRIFT_RADIUS * Math.cos(angle),
    y: place.y,
    z: RING_CENTER.z + (rotation ? x * rotation.sin + z * rotation.cos : z) + FOLDER_DRIFT_RADIUS * Math.sin(angle),
  }
}

function cardGapFloor() {
  return Math.hypot(CARD_W, cardHeight(FILE_LIMIT_DEFAULT)) * CARD_SCALES.files + 2 * FOLDER_DRIFT_RADIUS
}

export function ringRadius(count, spacing = FOLDER_SPACING_DEFAULT) {
  const total = Math.max(0, Math.floor(Number(count) || 0))
  const gap = clampFolderSpacing(spacing)
  return Math.max(TOP_MIN_RADIUS * gap / FOLDER_SPACING_DEFAULT, total * gap / TURNS, total > 1 ? cardGapFloor() / (2 * Math.sin(Math.PI / total)) : 0)
}

export function shotgunOffset(index, count, spacing = FOLDER_SPACING_DEFAULT, parentRadius = ringRadius(1, spacing)) {
  const total = Math.max(0, Math.floor(Number(count) || 0))
  const floor = cardGapFloor()
  const gap = Math.max(clampFolderSpacing(spacing) * 0.6, floor)
  if (total <= 1) return { angleOffset: 0, radiusStep: gap, row: 0, col: 0, cols: 1, rows: 1 }
  const firstRadius = parentRadius + gap
  const firstAngle = 2 * Math.asin(Math.min(1, gap / (2 * firstRadius)))
  const capacity = Math.max(1, Math.floor(2 * FAN_LIMIT / firstAngle) + 1)
  const cols = Math.min(Math.ceil(Math.sqrt(total)), capacity)
  const rows = Math.ceil(total / cols)
  const slot = Math.max(0, Math.floor(Number(index) || 0))
  const row = Math.floor(slot / cols)
  const col = slot % cols
  const colsInRow = row === rows - 1 ? total - row * cols : cols
  const radiusStep = gap * (row + 1)
  const stepAngle = 2 * Math.asin(Math.min(1, gap / (2 * (parentRadius + radiusStep))))
  const angleOffset = (col - (colsInRow - 1) / 2) * stepAngle
  return { angleOffset, radiusStep, row, col, cols, rows }
}

function tagPosition(spot, node, slot) {
  return { x: spot.x, y: spot.y, z: spot.z, width: node.width, height: node.height, slot }
}

function previousAt(previous, path, slot) {
  if (!previous) return null
  const value = typeof previous.get === 'function' ? previous.get(path) : previous[path]
  if (!value || value.slot !== slot) return null
  return [value.x, value.y, value.z].every(Number.isFinite) ? value : null
}

function keepPlace(previous, path, spot) {
  const before = previousAt(previous, path, spot.slot)
  if (!before) return spot
  return { ...spot, x: before.x, y: before.y, z: before.z }
}

function sprayedAt(sprayed, path) {
  if (!sprayed) return false
  if (typeof sprayed.has === 'function') return sprayed.has(path)
  return Array.isArray(sprayed) && sprayed.includes(path)
}

function lifted(spot, sprayed, path) {
  if (!sprayedAt(sprayed, path)) return spot
  return { ...spot, y: spot.y + SPRAY_LIFT }
}

export function layoutRing(entries, options = {}) {
  const { previous, sprayed, small, spacing = FOLDER_SPACING_DEFAULT } = options
  const model = buildModel(entries)
  const { nodes, children, root } = model
  const positions = new Map()
  const tops = children.get('')
  const ringCount = Math.min(RING_MAX_TOP, tops.length)
  const ringTops = tops.slice(0, ringCount)
  const overflow = tops.slice(RING_MAX_TOP)
  const smallRingNow = small === true && smallRing(ringCount)
  const rootSpot = {
    x: ROOT_PLACE.x,
    y: RING_CENTER.y - ROOT_DROP - root.height / 2,
    z: ROOT_PLACE.z,
  }
  positions.set('', tagPosition(rootSpot, root, 'root'))

  const radius = ringRadius(ringCount, spacing)
  const ringSlot = `radius:${radius.toFixed(3)}${smallRingNow ? ':small' : ''}`
  ringTops.forEach((path, index) => {
    const node = nodes.get(path)
    const slot = `${ringSlot}>${index}/${ringCount}${sprayedAt(sprayed, path) ? ':spray' : ''}`
    const angle = smallRingNow ? smallRingAngle(index, ringCount) : ringAngle(index, ringCount)
    const spot = tagPosition(ringPoint(radius, angle), node, slot)
    positions.set(path, keepPlace(previous, path, lifted(spot, sprayed, path)))
  })
  const angleOf = smallRingNow ? smallRingAngle : ringAngle
  const overflowAngle = (angleOf(ringCount - 2, ringCount) + angleOf(ringCount - 1, ringCount)) / 2
  overflow.forEach((path, index) => {
    const node = nodes.get(path)
    const off = shotgunOffset(index, overflow.length, spacing, radius)
    const slot = `${ringSlot}>spray>${index}/${overflow.length}${sprayedAt(sprayed, path) ? ':spray' : ''}`
    const spot = tagPosition(ringPoint(radius + off.radiusStep, overflowAngle + off.angleOffset), node, slot)
    positions.set(path, keepPlace(previous, path, lifted(spot, sprayed, path)))
  })

  const queue = [...tops]
  function placeChildren(parentPath) {
    const parent = positions.get(parentPath)
    const parentSpot = ringOf(parent)
    const kids = children.get(parentPath) ?? []
    kids.forEach((path, index) => {
      const node = nodes.get(path)
      const off = shotgunOffset(index, kids.length, spacing, parentSpot.radius)
      const slot = `${parent.slot}>${index}/${kids.length}${sprayedAt(sprayed, path) ? ':spray' : ''}`
      const turn = smallRingNow ? SMALL_CHILD_TURN : 0
      const angle = parentSpot.angle + off.angleOffset + turn
      const spot = tagPosition(ringPoint(parentSpot.radius + off.radiusStep, angle), node, slot)
      positions.set(path, keepPlace(previous, path, lifted(spot, sprayed, path)))
      queue.push(path)
    })
  }
  for (let at = 0; at < queue.length; at += 1) placeChildren(queue[at])
  return positions
}
