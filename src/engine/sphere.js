import { dirname } from '../model/paths.js'
import { HUB_CENTER, HUB_Y } from './hub.js'

export const SPHERE_CENTER = HUB_CENTER
export const ROOT_DROP = 1000
export const POLE_CAP = (25 * Math.PI) / 180
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
export const CARD_CLEARANCE = 40
export const TOP_MIN_RADIUS = 1100
export const TOP_MAX_RADIUS = 2600
export const TOP_SPACING = 0.6
export const OPEN_STEP = 650
export const STACK_STEP = 50
export const STACK_LIFT = 12
export const STACK_SIDE = 16
export const STACK_LIMIT = 4
export const OPEN_CONE = 0.22
export const FAN_CONE_MIN = 0.1
export const FAN_CONE_MAX = 0.35

const ROOT_SIZE = { width: 248, height: 64 }
const DEFAULT_CARD = { width: 248, height: 64 }
const TOP_SEPARATION_PASSES = 60
const TOP_SEPARATION_STEP = 0.5
const SEARCH_STEP = 0.055
const SEARCH_LIMIT = 4200
const SEPARATION_EPS = 0.01

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

function byName(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function depthOf(path) {
  return path === '' ? 0 : path.split('/').length
}

function sizeOf(entry, fallback = ROOT_SIZE) {
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
    radius: Math.hypot(size.width, size.height) / 2 + CARD_CLEARANCE / 2,
  }
}

function normalizeObstacles(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    const x = Number(item?.x)
    const y = Number(item?.y)
    const z = Number(item?.z)
    const radius = Number(item?.radius)
    if (![x, y, z, radius].every(Number.isFinite) || radius < 0) continue
    out.push({ x, y, z, radius, pad: CARD_CLEARANCE })
  }
  return out
}

function obstacleDistance(node, obstacle) {
  return node.radius + obstacle.radius + (obstacle.pad ?? 0)
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
  if (!nodes.has('')) nodes.set('', makeNode('', ROOT_SIZE))
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

function normalizeOpen(value) {
  if (value instanceof Set) return new Set([...value].filter((path) => typeof path === 'string'))
  if (Array.isArray(value)) return new Set(value.filter((path) => typeof path === 'string'))
  return new Set()
}

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z

function unit(value) {
  const length = Math.hypot(value.x, value.y, value.z)
  if (!Number.isFinite(length) || length === 0) return { x: 0, y: 1, z: 0 }
  return { x: value.x / length, y: value.y / length, z: value.z / length }
}

function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function directionOf(position) {
  return unit({ x: position.x - SPHERE_CENTER.x, y: position.y - SPHERE_CENTER.y, z: position.z - SPHERE_CENTER.z })
}

function radiusOf(position) {
  return Math.hypot(position.x - SPHERE_CENTER.x, position.y - SPHERE_CENTER.y, position.z - SPHERE_CENTER.z)
}

function pointAt(direction, radius) {
  return {
    x: SPHERE_CENTER.x + direction.x * radius,
    y: SPHERE_CENTER.y + direction.y * radius,
    z: SPHERE_CENTER.z + direction.z * radius,
  }
}

function tangentBasis(direction) {
  const up = Math.abs(direction.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const first = unit(cross(up, direction))
  return { first, second: cross(direction, first) }
}

function directionAround(axis, angle, azimuth) {
  const { first, second } = tangentBasis(axis)
  const sine = Math.sin(angle)
  const cosine = Math.cos(angle)
  const around = Math.cos(azimuth)
  const across = Math.sin(azimuth)
  return unit({
    x: axis.x * cosine + (first.x * around + second.x * across) * sine,
    y: axis.y * cosine + (first.y * around + second.y * across) * sine,
    z: axis.z * cosine + (first.z * around + second.z * across) * sine,
  })
}

function clampTop(direction) {
  const top = Math.cos(POLE_CAP)
  if (Math.abs(direction.y) <= top) return direction
  const y = Math.sign(direction.y) * top
  const ring = Math.sqrt(Math.max(0, 1 - y * y))
  const flat = Math.hypot(direction.x, direction.z)
  if (flat === 0) return { x: ring, y, z: 0 }
  return { x: (direction.x / flat) * ring, y, z: (direction.z / flat) * ring }
}

function fibonacciTop(count) {
  const top = Math.cos(POLE_CAP)
  return Array.from({ length: count }, (_, index) => {
    const y = top - ((index + 0.5) / Math.max(1, count)) * 2 * top
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    const angle = index * GOLDEN_ANGLE
    return { x: Math.cos(angle) * ring, y, z: Math.sin(angle) * ring }
  })
}

export function topShellRadius(count, size = DEFAULT_CARD) {
  const width = Number(size?.width)
  const height = Number(size?.height)
  const safeWidth = Number.isFinite(width) && width > 0 ? width : DEFAULT_CARD.width
  const safeHeight = Number.isFinite(height) && height > 0 ? height : DEFAULT_CARD.height
  const diagonal = Math.hypot(safeWidth, safeHeight)
  const wanted = diagonal * Math.sqrt(Math.max(0, count) / 2)
  return clamp(wanted, TOP_MIN_RADIUS, TOP_MAX_RADIUS)
}

function topSize(tops, nodes) {
  if (tops.length === 0) return DEFAULT_CARD
  let width = 0
  let height = 0
  for (const path of tops) {
    const node = nodes.get(path)
    width += node.width
    height += node.height
  }
  return { width: width / tops.length, height: height / tops.length }
}

function clearOfObstacles(direction, radius, node, obstacles) {
  const place = pointAt(direction, radius)
  for (const obstacle of obstacles) {
    const distance = Math.hypot(place.x - obstacle.x, place.y - obstacle.y, place.z - obstacle.z)
    if (distance + SEPARATION_EPS < obstacleDistance(node, obstacle)) return false
  }
  return true
}

function clearDirection(direction, radius, node, obstacles, top = false) {
  let next = top ? clampTop(direction) : direction
  if (clearOfObstacles(next, radius, node, obstacles)) return next
  for (let attempt = 1; attempt < SEARCH_LIMIT; attempt += 1) {
    const angle = SEARCH_STEP * Math.sqrt(attempt)
    if (angle > Math.PI) break
    next = directionAround(direction, angle, attempt * GOLDEN_ANGLE)
    if (top) next = clampTop(next)
    if (clearOfObstacles(next, radius, node, obstacles)) return next
  }
  return top ? clampTop(direction) : direction
}

function separateTopDirections(nodes, directions, shell) {
  const work = directions.map((direction) => ({ ...direction }))
  for (let pass = 0; pass < TOP_SEPARATION_PASSES; pass += 1) {
    let moved = false
    for (let i = 0; i < work.length; i += 1) {
      const a = nodes[i]
      const da = work[i]
      const pa = pointAt(da, shell)
      for (let j = i + 1; j < work.length; j += 1) {
        const b = nodes[j]
        const db = work[j]
        const pb = pointAt(db, shell)
        const dx = pa.x - pb.x
        const dy = pa.y - pb.y
        const dz = pa.z - pb.z
        const distance = Math.hypot(dx, dy, dz)
        const needed = TOP_SPACING * Math.min(a.width, b.width)
        if (distance >= needed || distance < 1e-6) continue
        moved = true
        const side = unit({ x: dx / distance, y: dy / distance, z: dz / distance })
        const alongA = dot(side, da)
        const sideA = unit({ x: side.x - da.x * alongA, y: side.y - da.y * alongA, z: side.z - da.z * alongA })
        const alongB = dot(side, db)
        const sideB = unit({ x: -side.x + db.x * alongB, y: -side.y + db.y * alongB, z: -side.z + db.z * alongB })
        const step = ((needed - distance) * TOP_SEPARATION_STEP) / shell
        const nextA = unit({ x: da.x + sideA.x * step, y: da.y + sideA.y * step, z: da.z + sideA.z * step })
        const nextB = unit({ x: db.x + sideB.x * step, y: db.y + sideB.y * step, z: db.z + sideB.z * step })
        work[i] = clampTop(nextA)
        work[j] = clampTop(nextB)
      }
    }
    if (!moved) break
  }
  return work
}

function fanCone(count) {
  return clamp(FAN_CONE_MIN + 0.05 * Math.sqrt(Math.max(1, count)), FAN_CONE_MIN, FAN_CONE_MAX)
}

function separateWarmTops(nodes, positions, previous) {
  const changed = nodes.map((node) => {
    const before = previousAt(previous, node.path)
    return !before || before.width !== node.width || before.height !== node.height
  })
  for (let pass = 0; pass < TOP_SEPARATION_PASSES; pass += 1) {
    let moved = false
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i]
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j]
        const pa = positions.get(a.path)
        const pb = positions.get(b.path)
        const dx = pa.x - pb.x
        const dy = pa.y - pb.y
        const dz = pa.z - pb.z
        const distance = Math.hypot(dx, dy, dz)
        const needed = TOP_SPACING * Math.min(a.width, b.width)
        if (distance >= needed || distance < 1e-6) continue
        moved = true
        const moveA = changed[i] || !changed[j]
        const moveB = changed[j] || !changed[i]
        const share = moveA && moveB ? 0.5 : 1
        const side = unit({ x: dx / distance, y: dy / distance, z: dz / distance })
        const push = (node, position, away) => {
          const at = directionOf(position)
          const along = dot(away, at)
          const sideStep = unit({ x: away.x - at.x * along, y: away.y - at.y * along, z: away.z - at.z * along })
          const angle = ((needed - distance) * share) / Math.max(1, radiusOf(position))
          const next = clampTop(unit({ x: at.x + sideStep.x * angle, y: at.y + sideStep.y * angle, z: at.z + sideStep.z * angle }))
          positions.set(node.path, tagPosition(pointAt(next, radiusOf(position)), node))
        }
        if (moveA) push(a, pa, side)
        if (moveB) push(b, pb, { x: -side.x, y: -side.y, z: -side.z })
      }
    }
    if (!moved) break
  }
}

function fanDirections(axis, kids, open, count) {
  const cone = fanCone(count)
  const pathKids = kids.filter((path) => open.has(path))
  const otherKids = kids.filter((path) => !open.has(path))
  const out = new Map()
  if (pathKids.length === 1) out.set(pathKids[0], axis)
  pathKids.forEach((path, index) => {
    if (index === 0 && pathKids.length === 1) return
    const angle = 0.04 + 0.06 * index
    out.set(path, directionAround(axis, angle, index * Math.PI))
  })
  otherKids.forEach((path, index) => {
    const share = otherKids.length === 1 ? 1 : 0.45 + (0.55 * Math.sqrt((index + 0.5) / otherKids.length))
    out.set(path, directionAround(axis, cone * share, 0.7 + index * GOLDEN_ANGLE))
  })
  return out
}

function stackPosition(parentDirection, parentRadius, index) {
  const step = index + 1
  const base = pointAt(parentDirection, parentRadius + step * STACK_STEP)
  const side = tangentBasis(parentDirection).first
  return {
    x: base.x + side.x * step * STACK_SIDE,
    y: base.y + step * STACK_LIFT,
    z: base.z + side.z * step * STACK_SIDE,
  }
}

function tagPosition(position, node) {
  position.width = node.width
  position.height = node.height
  return position
}

function previousAt(previous, path) {
  if (!previous) return null
  const value = typeof previous.get === 'function' ? previous.get(path) : previous[path]
  if (!value) return null
  return [value.x, value.y, value.z].every(Number.isFinite) ? value : null
}

const distanceBetween = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

function placeCold(model, open, obstacles) {
  const { nodes, children, root } = model
  const positions = new Map()
  const rootPosition = tagPosition({ x: 0, y: HUB_Y - ROOT_DROP, z: 0 }, root)
  positions.set('', rootPosition)

  const tops = children.get('')
  const shell = topShellRadius(tops.length, topSize(tops, nodes))
  const topNodes = tops.map((path) => nodes.get(path))
  const topDirections = separateTopDirections(topNodes, fibonacciTop(tops.length), shell)
  tops.forEach((path, index) => {
    const node = nodes.get(path)
    const direction = clearDirection(topDirections[index], shell, node, obstacles, true)
    positions.set(path, tagPosition(pointAt(direction, shell), node))
  })

  const queue = [...tops]
  while (queue.length > 0) {
    const parentPath = queue.shift()
    const parentPosition = positions.get(parentPath)
    const parentDirection = directionOf(parentPosition)
    const parentRadius = radiusOf(parentPosition)
    const kids = children.get(parentPath)
    if (!kids || kids.length === 0) continue
    const pathKids = kids.filter((path) => open.has(path))
    const stackKids = kids.filter((path) => !open.has(path))
    const fan = open.has(parentPath) || pathKids.length > 0
    if (fan) {
      const directions = fanDirections(parentDirection, kids, open, kids.length)
      for (const path of kids) {
        const node = nodes.get(path)
        const direction = clearDirection(directions.get(path) ?? parentDirection, parentRadius + OPEN_STEP, node, obstacles)
        positions.set(path, tagPosition(pointAt(direction, parentRadius + OPEN_STEP), node))
        queue.push(path)
      }
      continue
    }

    stackKids.slice(0, STACK_LIMIT).forEach((path, index) => {
      const node = nodes.get(path)
      const base = stackPosition(parentDirection, parentRadius, index)
      const at = pointAt(clearDirection(directionOf(base), radiusOf(base), node, obstacles), radiusOf(base))
      positions.set(path, tagPosition(at, node))
      queue.push(path)
    })
  }
  return positions
}

function placeWarm(model, open, previous, obstacles) {
  const { nodes, children, root } = model
  const positions = new Map()
  const rootPosition = tagPosition({ x: 0, y: HUB_Y - ROOT_DROP, z: 0 }, root)
  positions.set('', rootPosition)

  const tops = children.get('')
  const shell = topShellRadius(tops.length, topSize(tops, nodes))
  const topSpots = fibonacciTop(tops.length)
  const placedTops = []
  tops.forEach((path, index) => {
    const node = nodes.get(path)
    const before = previousAt(previous, path)
    if (before) {
      const position = tagPosition({ x: before.x, y: before.y, z: before.z }, node)
      positions.set(path, position)
      placedTops.push({ node, position })
      return
    }
    let direction = topSpots[index]
    for (let attempt = 0; attempt < SEARCH_LIMIT; attempt += 1) {
      direction = attempt === 0 ? topSpots[index] : directionAround(topSpots[index], SEARCH_STEP * Math.sqrt(attempt), attempt * GOLDEN_ANGLE)
      direction = clampTop(direction)
      const place = pointAt(direction, shell)
      const apart = placedTops.every((other) => distanceBetween(place, other.position) >= TOP_SPACING * Math.min(node.width, other.node.width))
      if (apart && clearOfObstacles(direction, shell, node, obstacles)) break
    }
    const position = tagPosition(pointAt(direction, shell), node)
    positions.set(path, position)
    placedTops.push({ node, position })
  })

  separateWarmTops(tops.map((path) => nodes.get(path)), positions, previous)

  const queue = [...tops]
  while (queue.length > 0) {
    const parentPath = queue.shift()
    const parentPosition = positions.get(parentPath)
    const parentDirection = directionOf(parentPosition)
    const parentRadius = radiusOf(parentPosition)
    const kids = children.get(parentPath)
    if (!kids || kids.length === 0) continue
    const parentFan = open.has(parentPath) || kids.some((path) => open.has(path))
    const stackKids = kids.filter((path) => !open.has(path))
    const stackIndex = new Map(stackKids.map((path, index) => [path, index]))
    const freshFan = parentFan ? kids : []
    const directions = fanDirections(parentDirection, freshFan, open, freshFan.length)
    const previousParent = previousAt(previous, parentPath) ?? parentPosition

    for (const path of kids) {
      const node = nodes.get(path)
      const fan = parentFan
      const slot = stackIndex.get(path)
      if (!fan && (slot === undefined || slot >= STACK_LIMIT)) continue
      const before = previousAt(previous, path)
      const wasFan = Boolean(before) && distanceBetween(before, previousParent) >= OPEN_STEP * 0.5
      if (before && fan === wasFan) {
        positions.set(path, tagPosition({ x: before.x, y: before.y, z: before.z }, node))
        queue.push(path)
        continue
      }
      if (fan) {
        const direction = clearDirection(directions.get(path) ?? parentDirection, parentRadius + OPEN_STEP, node, obstacles)
        positions.set(path, tagPosition(pointAt(direction, parentRadius + OPEN_STEP), node))
      } else {
        const base = stackPosition(parentDirection, parentRadius, slot)
        const at = pointAt(clearDirection(directionOf(base), radiusOf(base), node, obstacles), radiusOf(base))
        positions.set(path, tagPosition(at, node))
      }
      queue.push(path)
    }
  }
  return positions
}

function clearMovedObstacles(model, positions, obstacles) {
  if (obstacles.length === 0) return
  for (const path of [...positions.keys()].sort(byName)) {
    if (path === '') continue
    const node = model.nodes.get(path)
    const position = positions.get(path)
    const direction = directionOf(position)
    const radius = radiusOf(position)
    if (clearOfObstacles(direction, radius, node, obstacles)) continue
    const safe = clearDirection(direction, radius, node, obstacles, node.depth === 1)
    const at = pointAt(safe, radius)
    positions.set(path, tagPosition(at, node))
  }
}

export function layoutSphere(entries, { previous, obstacles, open } = {}) {
  const model = buildModel(entries)
  const openPaths = normalizeOpen(open)
  const clear = normalizeObstacles(obstacles)
  const hasPrevious = previous && (typeof previous.size === 'number' ? previous.size > 0 : Object.keys(previous).length > 0)
  const positions = hasPrevious ? placeWarm(model, openPaths, previous, clear) : placeCold(model, openPaths, clear)
  clearMovedObstacles(model, positions, clear)
  return positions
}
