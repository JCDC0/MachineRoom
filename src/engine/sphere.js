import { dirname } from '../model/paths.js'
import { HUB_CENTER, HUB_RADIUS, HUB_Y } from './hub.js'

export const SPHERE_CENTER = HUB_CENTER
export const SHELL_RADIUS = 1700
export const SHELL_STEP = 1000
export const FULL_SHELLS = 3
export const DEEP_STEP = 400
export const ROOT_DROP = 1000
export const POLE_CAP = (25 * Math.PI) / 180
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
export const CARD_CLEARANCE = 40
export const HUB_CLEARANCE = HUB_RADIUS + 200

const ROOT_SIZE = { width: 440, height: 160 }
const CONE_PACK = 0.55
const SETTLE_PASSES = 600
const SETTLE_STEP = 0.45
const SETTLE_ANCHOR = 0.008
const SETTLE_DONE = 2
const SETTLE_STALL = 25
const SEARCH_STEP = 0.055
const SEARCH_LIMIT = 4200
const SEPARATION_EPS = 10
const OVERLAP_EPS = 0.001

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

function byName(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function depthOf(path) {
  return path === '' ? 0 : path.split('/').length
}

function shellOf(depth) {
  if (depth === 0) return 0
  const near = Math.min(depth, FULL_SHELLS)
  return SHELL_RADIUS + (near - 1) * SHELL_STEP + (depth - near) * DEEP_STEP
}

function sizeOf(entry) {
  const width = Number(entry?.width)
  const height = Number(entry?.height)
  return {
    width: Number.isFinite(width) && width > 0 ? width : ROOT_SIZE.width,
    height: Number.isFinite(height) && height > 0 ? height : ROOT_SIZE.height,
  }
}

function makeNode(path, entry) {
  const size = sizeOf(entry)
  const depth = depthOf(path)
  return {
    path,
    width: size.width,
    height: size.height,
    depth,
    shell: shellOf(depth),
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

function angleBetween(a, b) {
  return Math.acos(clamp(dot(a, b), -1, 1))
}

function tangentToward(target, direction) {
  const along = dot(target, direction)
  return unit({ x: target.x - direction.x * along, y: target.y - direction.y * along, z: target.z - direction.z * along })
}

function rotateToward(direction, target, amount) {
  const side = tangentToward(target, direction)
  return unit({
    x: direction.x + side.x * amount,
    y: direction.y + side.y * amount,
    z: direction.z + side.z * amount,
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
    const y = top - ((index + 0.5) / count) * 2 * top
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    const angle = index * GOLDEN_ANGLE
    return { x: Math.cos(angle) * ring, y, z: Math.sin(angle) * ring }
  })
}

function conePoint(axis, angle, index, count) {
  const spread = angle * Math.sqrt((index + 0.5) / Math.max(1, count))
  return directionAround(axis, spread, index * GOLDEN_ANGLE)
}

function coneAngle(radii, shell) {
  const total = radii.reduce((sum, radius) => sum + radius * radius, 0)
  const ratio = total / (2 * shell * shell * CONE_PACK)
  const angle = Math.acos(clamp(1 - ratio, -1, 1))
  return Math.max(0.06, Math.min(Math.PI * 0.92, angle))
}

function settleDirections(list, initial, { obstacles = [], top = false, passes = SETTLE_PASSES } = {}) {
  const dirs = new Map(list.map((node) => [node.path, { ...initial.get(node.path) }]))
  let best = Infinity
  let bestPass = 0
  for (let pass = 0; pass < passes; pass += 1) {
    const moves = new Map(list.map((node) => [node.path, { x: 0, y: 0, z: 0 }]))
    let worst = 0
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i]
      const da = dirs.get(a.path)
      const pa = pointAt(da, a.shell)
      for (let j = i + 1; j < list.length; j += 1) {
        const b = list[j]
        const db = dirs.get(b.path)
        const pb = pointAt(db, b.shell)
        const dx = pa.x - pb.x
        const dy = pa.y - pb.y
        const dz = pa.z - pb.z
        const distance = Math.hypot(dx, dy, dz)
        const needed = a.radius + b.radius + SEPARATION_EPS
        if (distance >= needed) continue
        const overlap = needed - distance
        worst = Math.max(worst, overlap)
        const away = distance < 1e-6 ? tangentBasis(da).first : { x: dx / distance, y: dy / distance, z: dz / distance }
        const alongA = dot(away, da)
        const sideA = unit({ x: away.x - da.x * alongA, y: away.y - da.y * alongA, z: away.z - da.z * alongA })
        const moveA = moves.get(a.path)
        moveA.x += sideA.x * ((overlap * SETTLE_STEP) / a.shell)
        moveA.y += sideA.y * ((overlap * SETTLE_STEP) / a.shell)
        moveA.z += sideA.z * ((overlap * SETTLE_STEP) / a.shell)
        const alongB = dot(away, db)
        const sideB = unit({ x: -away.x + db.x * alongB, y: -away.y + db.y * alongB, z: -away.z + db.z * alongB })
        const moveB = moves.get(b.path)
        moveB.x += sideB.x * ((overlap * SETTLE_STEP) / b.shell)
        moveB.y += sideB.y * ((overlap * SETTLE_STEP) / b.shell)
        moveB.z += sideB.z * ((overlap * SETTLE_STEP) / b.shell)
      }
      for (const obstacle of obstacles) {
        const dx = pa.x - obstacle.x
        const dy = pa.y - obstacle.y
        const dz = pa.z - obstacle.z
        const distance = Math.hypot(dx, dy, dz)
        const needed = obstacleDistance(a, obstacle) + SEPARATION_EPS
        if (distance >= needed) continue
        worst = Math.max(worst, needed - distance)
        const away = distance < 1e-6 ? tangentBasis(da).first : { x: dx / distance, y: dy / distance, z: dz / distance }
        const along = dot(away, da)
        const side = unit({ x: away.x - da.x * along, y: away.y - da.y * along, z: away.z - da.z * along })
        const move = moves.get(a.path)
        move.x += side.x * (((needed - distance) * SETTLE_STEP) / a.shell)
        move.y += side.y * (((needed - distance) * SETTLE_STEP) / a.shell)
        move.z += side.z * (((needed - distance) * SETTLE_STEP) / a.shell)
      }
    }
    for (const node of list) {
      const direction = dirs.get(node.path)
      const move = moves.get(node.path)
      let next = unit({ x: direction.x + move.x, y: direction.y + move.y, z: direction.z + move.z })
      next = rotateToward(next, initial.get(node.path), SETTLE_ANCHOR)
      if (top) next = clampTop(next)
      dirs.set(node.path, next)
    }
    if (worst < SETTLE_DONE) break
    if (worst < best * 0.99) {
      best = worst
      bestPass = pass
    } else if (pass - bestPass >= SETTLE_STALL) break
  }
  return dirs
}

function regionAllows(direction, region) {
  if (!region || region.kind === 'free') return true
  if (region.kind === 'top') return Math.abs(direction.y) <= Math.cos(POLE_CAP) + 1e-9
  if (region.kind === 'cone') return angleBetween(direction, region.axis) <= region.maxAngle + 1e-9
  return true
}

function clearanceAt(direction, node, shell, others, obstacles = []) {
  const place = pointAt(direction, shell)
  let best = Math.hypot(place.x - SPHERE_CENTER.x, place.y - SPHERE_CENTER.y, place.z - SPHERE_CENTER.z) - HUB_CLEARANCE - node.radius
  for (const other of others) {
    const distance = Math.hypot(place.x - other.pos.x, place.y - other.pos.y, place.z - other.pos.z)
    best = Math.min(best, distance - node.radius - other.radius)
  }
  for (const obstacle of obstacles) {
    const distance = Math.hypot(place.x - obstacle.x, place.y - obstacle.y, place.z - obstacle.z)
    best = Math.min(best, distance - obstacleDistance(node, obstacle))
  }
  return best
}

function clearAt(direction, node, shell, others, region, obstacles) {
  if (!regionAllows(direction, region)) return false
  return clearanceAt(direction, node, shell, others, obstacles) >= SEPARATION_EPS
}

function searchDirection(preferred, node, shell, region, others, obstacles = []) {
  const base = unit(preferred)
  if (clearAt(base, node, shell, others, region, obstacles)) return base
  const limits = []
  if (region?.kind === 'cone') {
    limits.push(region.maxAngle)
    limits.push(Math.min(Math.PI, region.maxAngle * 1.4 + 0.2))
    limits.push(Math.PI)
  } else {
    limits.push(Math.PI)
  }
  let best = null
  for (const limit of limits) {
    const active = region?.kind === 'cone' ? { ...region, maxAngle: limit } : region
    for (let attempt = 0; attempt < SEARCH_LIMIT; attempt += 1) {
      const angle = attempt === 0 ? 0 : SEARCH_STEP * Math.sqrt(attempt)
      if (angle > limit) break
      const direction = directionAround(base, angle, attempt * GOLDEN_ANGLE)
      if (!regionAllows(direction, active)) continue
      const clearance = clearanceAt(direction, node, shell, others, obstacles)
      if (!best || clearance > best.clearance) best = { direction, clearance }
      if (clearance >= SEPARATION_EPS) return direction
    }
  }
  return best?.direction ?? base
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

function previousSize(value) {
  const width = value?.width
  const height = value?.height
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null
}

function sizeChanged(before, node) {
  const size = previousSize(before)
  return size ? size.width !== node.width || size.height !== node.height : false
}

function chooseMover(a, b, previous) {
  if (a.node.path === '') return b
  if (b.node.path === '') return a
  const beforeA = previousAt(previous, a.node.path)
  const beforeB = previousAt(previous, b.node.path)
  const newA = !beforeA
  const newB = !beforeB
  if (newA !== newB) return newA ? a : b
  const changedA = beforeA ? sizeChanged(beforeA, a.node) : false
  const changedB = beforeB ? sizeChanged(beforeB, b.node) : false
  if (changedA !== changedB) return changedA ? a : b
  if (a.node.radius !== b.node.radius) return a.node.radius > b.node.radius ? a : b
  if (a.node.depth !== b.node.depth) return a.node.depth > b.node.depth ? a : b
  return byName(a.node.path, b.node.path) > 0 ? a : b
}

function firstOverlap(occupied) {
  for (let i = 0; i < occupied.length; i += 1) {
    const a = occupied[i]
    for (let j = i + 1; j < occupied.length; j += 1) {
      const b = occupied[j]
      const distance = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z)
      if (distance + OVERLAP_EPS < a.radius + b.radius) return [a, b]
    }
  }
  return null
}

function firstObstacleHit(occupied, obstacles) {
  for (const item of occupied) {
    if (item.path === '') continue
    for (const obstacle of obstacles) {
      const distance = Math.hypot(item.pos.x - obstacle.x, item.pos.y - obstacle.y, item.pos.z - obstacle.z)
      if (distance + OVERLAP_EPS < obstacleDistance(item, obstacle)) return item
    }
  }
  return null
}

function repairOverlaps(occupied, positions, previous, obstacles = []) {
  const limit = occupied.length * 2 + 4
  for (let pass = 0; pass < limit; pass += 1) {
    const pair = firstOverlap(occupied)
    let mover = null
    if (pair) mover = chooseMover(pair[0], pair[1], previous)
    else mover = firstObstacleHit(occupied, obstacles)
    if (!mover) return
    const node = mover.node
    const region = node.depth === 1 ? { kind: 'top' } : { kind: 'free' }
    const others = occupied.filter((item) => item !== mover)
    let direction = searchDirection(directionOf(mover.pos), node, node.shell, region, others, obstacles)
    if (node.depth === 1) direction = clampTop(direction)
    mover.pos = tagPosition(pointAt(direction, node.shell), node)
    positions.set(node.path, mover.pos)
  }
}

function moveOffObstacles(occupied, positions, obstacles) {
  if (obstacles.length === 0) return
  for (const item of occupied) {
    if (item.path === '') continue
    if (!firstObstacleHit([item], obstacles)) continue
    const node = item.node
    const region = node.depth === 1 ? { kind: 'top' } : { kind: 'free' }
    const others = occupied.filter((other) => other !== item)
    let direction = searchDirection(directionOf(item.pos), node, node.shell, region, others, obstacles)
    if (node.depth === 1) direction = clampTop(direction)
    item.pos = tagPosition(pointAt(direction, node.shell), node)
    positions.set(node.path, item.pos)
  }
}

function addPlacement(occupied, positions, node, direction) {
  const position = tagPosition(pointAt(direction, node.shell), node)
  positions.set(node.path, position)
  occupied.push({ path: node.path, node, pos: position, radius: node.radius })
  return position
}

function placeFromPrevious(occupied, positions, node, before) {
  const position = tagPosition({ x: before.x, y: before.y, z: before.z }, node)
  positions.set(node.path, position)
  occupied.push({ path: node.path, node, pos: position, radius: node.radius })
  return position
}

function groupCone(kids, model) {
  const radii = kids.map((path) => model.nodes.get(path).radius)
  const shell = Math.min(...kids.map((path) => model.nodes.get(path).shell))
  const needed = coneAngle(radii, shell)
  return Math.min(Math.PI * 0.92, Math.max(needed * 1.08, 0.1))
}

function placeCold(model, obstacles) {
  const { nodes, paths, children, root } = model
  const positions = new Map()
  const occupied = []
  const rootPosition = tagPosition({ x: 0, y: HUB_Y - ROOT_DROP, z: 0 }, root)
  positions.set('', rootPosition)
  occupied.push({ path: '', node: root, pos: rootPosition, radius: root.radius })

  const tops = children.get('')
  const topSpots = fibonacciTop(tops.length)
  const topInitial = new Map(tops.map((path, index) => [path, topSpots[index]]))
  const topNodes = tops.map((path) => nodes.get(path))
  const rootObstacle = { x: rootPosition.x, y: rootPosition.y, z: rootPosition.z, radius: root.radius }
  const topDirs = settleDirections(topNodes, topInitial, { obstacles: [rootObstacle, ...obstacles], top: true })
  for (const path of tops) addPlacement(occupied, positions, nodes.get(path), topDirs.get(path))

  const maxDepth = paths.reduce((high, path) => Math.max(high, nodes.get(path).depth), 0)
  for (let depth = 2; depth <= maxDepth; depth += 1) {
    const level = paths.filter((path) => nodes.get(path).depth === depth)
    if (level.length === 0) continue
    const groups = new Map()
    for (const path of level) {
      const parent = nodes.get(path).parent
      const list = groups.get(parent)
      if (list) list.push(path)
      else groups.set(parent, [path])
    }
    const initial = new Map()
    for (const [parentPath, kids] of groups) {
      const axis = directionOf(positions.get(parentPath))
      const kidNodes = kids.map((path) => nodes.get(path))
      const cone = coneAngle(kidNodes.map((node) => node.radius), Math.min(...kidNodes.map((node) => node.shell)))
      kidNodes.forEach((node, index) => {
        initial.set(node.path, conePoint(axis, cone, index, kidNodes.length))
      })
    }
    const levelNodes = level.map((path) => nodes.get(path))
    const placedBefore = occupied.map((item) => ({ x: item.pos.x, y: item.pos.y, z: item.pos.z, radius: item.radius }))
    const dirs = settleDirections(levelNodes, initial, { obstacles: [...placedBefore, ...obstacles] })
    for (const node of levelNodes) addPlacement(occupied, positions, node, dirs.get(node.path))
  }

  moveOffObstacles(occupied, positions, obstacles)
  repairOverlaps(occupied, positions, null, obstacles)
  return positions
}

function placeWarm(model, previous, obstacles) {
  const { nodes, children, root } = model
  const positions = new Map()
  const occupied = []
  const rootPosition = tagPosition({ x: 0, y: HUB_Y - ROOT_DROP, z: 0 }, root)
  positions.set('', rootPosition)
  occupied.push({ path: '', node: root, pos: rootPosition, radius: root.radius })

  const queue = []
  const tops = children.get('')
  const topDirections = fibonacciTop(tops.length)
  tops.forEach((path, index) => {
    const node = nodes.get(path)
    const before = previousAt(previous, path)
    if (before) placeFromPrevious(occupied, positions, node, before)
    else {
      const direction = searchDirection(topDirections[index], node, node.shell, { kind: 'top' }, occupied, obstacles)
      addPlacement(occupied, positions, node, direction)
    }
    if (children.get(path).length > 0) queue.push(path)
  })

  let at = 0
  while (at < queue.length) {
    const parentPath = queue[at]
    at += 1
    const kids = children.get(parentPath)
    const axis = directionOf(positions.get(parentPath))
    const cone = groupCone(kids, model)
    const kidNodes = kids.map((path) => nodes.get(path))
    kidNodes.forEach((node, index) => {
      const before = previousAt(previous, node.path)
      if (before) placeFromPrevious(occupied, positions, node, before)
      else {
        const preferred = conePoint(axis, cone, index, kidNodes.length)
        const direction = searchDirection(preferred, node, node.shell, { kind: 'cone', axis, maxAngle: cone }, occupied, obstacles)
        addPlacement(occupied, positions, node, direction)
      }
      if (children.get(node.path).length > 0) queue.push(node.path)
    })
  }

  moveOffObstacles(occupied, positions, obstacles)
  repairOverlaps(occupied, positions, previous, obstacles)
  return positions
}

export function layoutSphere(entries, { previous, obstacles } = {}) {
  const model = buildModel(entries)
  const clear = normalizeObstacles(obstacles)
  const hasPrevious = previous && (typeof previous.size === 'number' ? previous.size > 0 : Object.keys(previous).length > 0)
  return hasPrevious ? placeWarm(model, previous, clear) : placeCold(model, clear)
}

export function sphereOverlaps(entries, placed) {
  const model = buildModel(entries)
  const boxes = []
  for (const node of model.nodes.values()) {
    const at = placed?.get?.(node.path)
    if (!at) continue
    boxes.push({ path: node.path, node, pos: at })
  }
  const out = []
  for (let i = 0; i < boxes.length; i += 1) {
    const a = boxes[i]
    for (let j = i + 1; j < boxes.length; j += 1) {
      const b = boxes[j]
      const distance = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z)
      const needed = a.node.radius + b.node.radius
      if (distance + OVERLAP_EPS < needed) out.push({ a: a.path, b: b.path, distance, needed })
    }
  }
  return out
}
