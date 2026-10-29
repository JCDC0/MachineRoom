import { dirname } from '../model/paths.js'
import { OVERVIEW } from './camera.js'
import { HUB_Y } from './hub.js'

export const RING_CENTER = { x: 0, y: HUB_Y, z: 0 }
export const RING_YAW = OVERVIEW.yaw
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
export const RING_MAX_TOP = 12
export const CHILD_STEP = 450
export const SHOTGUN_ROW_STEP = 380
export const FAN_STEP = 0.22
export const FAN_LIMIT = 0.9
export const CARD_GAP = 40
export const SPRAY_LIFT = 140

const TURNS = Math.PI * 2

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

function byName(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function depthOf(path) {
  return path === '' ? 0 : path.split('/').length
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
    depth: depthOf(path),
    radius: Math.hypot(size.width, size.height) / 2,
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

export function ringAngle(index, count) {
  const total = Math.max(1, Math.floor(Number(count) || 0))
  const slot = clamp(Math.floor(Number(index) || 0), 0, total - 1)
  return (slot / total) * TURNS
}

export function ringPoint(radius, angle, y = RING_CENTER.y) {
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

export function ringRadius(count, cards = []) {
  const total = Math.max(0, Math.floor(Number(count) || 0))
  if (total < 2) return TOP_MIN_RADIUS
  let radius = TOP_MIN_RADIUS
  for (let index = 0; index < total; index += 1) {
    const card = cards[index] ?? DEFAULT_CARD
    for (let other = index + 1; other < total; other += 1) {
      const next = cards[other] ?? DEFAULT_CARD
      const apart = Math.min(other - index, total - (other - index))
      const chord = 2 * Math.sin((Math.PI * apart) / total)
      const span = Math.hypot(card.width, card.height) / 2 + Math.hypot(next.width, next.height) / 2 + CARD_GAP
      radius = Math.max(radius, span / chord)
    }
  }
  return radius
}

export function shotgunOffset(index, count) {
  const total = Math.max(0, Math.floor(Number(count) || 0))
  if (total <= 1) return { angleOffset: 0, radiusStep: CHILD_STEP, row: 0, col: 0, cols: 1, rows: 1 }
  const cols = Math.max(1, Math.ceil(Math.sqrt(total)))
  const rows = Math.max(1, Math.ceil(total / cols))
  const slot = Math.max(0, Math.floor(Number(index) || 0))
  const row = Math.floor(slot / cols)
  const col = slot % cols
  const colsInRow = row === rows - 1 ? total - row * cols : cols
  const centered = col - (colsInRow - 1) / 2
  const spreadFactor = 1 + Math.min(total, 20) * 0.035
  const stepAngle = Math.min(0.38, FAN_STEP * spreadFactor)
  const angleOffset = colsInRow <= 1 ? 0 : centered * stepAngle
  const radiusStep = CHILD_STEP + row * SHOTGUN_ROW_STEP
  return { angleOffset, radiusStep, row, col, cols, rows }
}

export function fanAngle(index, count) {
  return shotgunOffset(index, count).angleOffset
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
  const { previous, sprayed } = options
  const model = buildModel(entries)
  const { nodes, children, root } = model
  const positions = new Map()
  const rootSpot = {
    x: ROOT_PLACE.x,
    y: RING_CENTER.y - ROOT_DROP - root.height / 2,
    z: ROOT_PLACE.z,
  }
  positions.set('', tagPosition(rootSpot, root, 'root'))

  const tops = children.get('')
  const ringCount = Math.min(RING_MAX_TOP, tops.length)
  const ringTops = tops.slice(0, ringCount)
  const overflow = tops.slice(RING_MAX_TOP)
  const radius = ringRadius(ringCount, ringTops.map((path) => nodes.get(path)))
  const ringSlot = `radius:${radius.toFixed(3)}`
  ringTops.forEach((path, index) => {
    const node = nodes.get(path)
    const slot = `${ringSlot}>${index}/${ringCount}${sprayedAt(sprayed, path) ? ':spray' : ''}`
    const spot = tagPosition(ringPoint(radius, ringAngle(index, ringCount)), node, slot)
    positions.set(path, keepPlace(previous, path, lifted(spot, sprayed, path)))
  })
  overflow.forEach((path, index) => {
    const node = nodes.get(path)
    const off = shotgunOffset(index, overflow.length)
    const slot = `${ringSlot}>spray>${index}/${overflow.length}${sprayedAt(sprayed, path) ? ':spray' : ''}`
    const spot = tagPosition(ringPoint(radius + off.radiusStep, off.angleOffset), node, slot)
    positions.set(path, keepPlace(previous, path, lifted(spot, sprayed, path)))
  })

  const queue = [...tops]
  function placeChildren(parentPath) {
    const parent = positions.get(parentPath)
    const parentSpot = ringOf(parent)
    const kids = children.get(parentPath) ?? []
    kids.forEach((path, index) => {
      const node = nodes.get(path)
      const off = shotgunOffset(index, kids.length)
      const slot = `${parent.slot}>${index}/${kids.length}${sprayedAt(sprayed, path) ? ':spray' : ''}`
      const angle = parentSpot.angle + off.angleOffset
      const spot = tagPosition(ringPoint(parentSpot.radius + off.radiusStep, angle), node, slot)
      positions.set(path, keepPlace(previous, path, lifted(spot, sprayed, path)))
      queue.push(path)
    })
  }
  while (queue.length > 0) placeChildren(queue.shift())
  return positions
}
